/**
 * 数据缓存管理器 (简化版)
 *
 * 功能：
 * - 统一管理游戏数据缓存
 * - 监听 WebSocket 事件自动更新缓存
 * - 提供同步和异步数据获取接口
 */

import { createLogger } from './logger';

const logger = createLogger('DataCache');
import { ws } from './websocket';
import { eventBus } from './event-bus';
import type { UserInfo, Inventory, TavernExpert } from '@/types/game-data';

/** 行动队列项 */
interface ActionQueueItem {
  actionId: string;
  repeatCount: number;
  currentRepeat: number;
  createTime: number;
}

/** 缓存键类型 */
type CacheKey = 'userInfo' | 'inventory' | 'actionQueue' | 'tavern';

/** 缓存数据结构 */
interface CacheData {
  userInfo: UserInfo | null;
  inventory: Inventory | null;
  actionQueue: ActionQueueItem[] | null;
  tavern: TavernExpert[] | null;
}

/** 等待中的 Promise 解析器 */
interface PendingResolver<T = unknown> {
  resolve: (data: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT = 10000;

/**
 * 数据缓存管理器
 */
class DataCacheManager {
  private cache: CacheData = {
    userInfo: null,
    inventory: null,
    actionQueue: null,
    tavern: null,
  };

  /** 已学习技能ID（衍生自 characterInitData，不参与缓存等待机制） */
  private learnedSkillIds: Set<string> | null = null;

  /** 等待中的 Promise 解析器队列 */
  private pendingResolvers = new Map<CacheKey, PendingResolver[]>();

  private initialized = false;

  /** 初始化缓存管理器 */
  init(): void {
    if (this.initialized) {
      logger.warn('数据缓存管理器已初始化');
      return;
    }

    this.setupListeners();
    this.initialized = true;
    logger.success('数据缓存管理器初始化完成');
  }

  /** 注册 WebSocket 事件监听 */
  private setupListeners(): void {
    // 初始化数据
    ws.once('characterInitData', (data) => {
      const { kittyInfo, quest, inventory, tavern, skills } = data.payload.data.data;
      this.cache.userInfo = { kittyInfo, quest };
      this.notifyDataReady('userInfo');

      if (inventory) {
        this.cache.inventory = this.filterInventory(inventory);
        this.notifyDataReady('inventory');
      }
      if (tavern) {
        this.cache.tavern = tavern;
        this.notifyDataReady('tavern');
      }
      if (skills) {
        this.learnedSkillIds = new Set((skills as Array<{ skillId: string }>).map((s) => s.skillId));
        logger.info(`已缓存 ${this.learnedSkillIds.size} 个已学习技能`);
      }
    });

    // 库存更新
    ws.on('dispatchInventoryInfo', (data) => {
      this.cache.inventory = this.filterInventory(data.payload.data);
      this.notifyDataReady('inventory');
    });

    // 任务队列更新
    ws.on('dispatchTaskQueueToClient', (data) => {
      this.cache.actionQueue = data.payload.data;
      this.notifyDataReady('actionQueue');
      eventBus.emit('actionQueueUpdated', this.cache.actionQueue);
    });

    // 酒馆专家更新
    ws.on('tavern:getMyExperts:success', (data) => {
      this.cache.tavern = data.payload.data;
      this.notifyDataReady('tavern');
      eventBus.emit('tavernUpdated', this.cache.tavern);
    });
  }

  /** 检查缓存是否存在 */
  has(key: CacheKey): boolean {
    return this.cache[key] !== null;
  }

  /** 获取物品数量 */
  getItemCount(itemId: string): number {
    return this.cache.inventory?.[itemId]?.count || 0;
  }

  /** 获取已学习的技能ID集合 */
  getLearnedSkillIds(): ReadonlySet<string> | null {
    return this.learnedSkillIds;
  }

  /** 异步获取缓存（等待数据加载） */
  async getAsync<K extends CacheKey>(key: K, forceRefresh = false): Promise<NonNullable<CacheData[K]>> {
    if (!forceRefresh && this.cache[key] !== null) {
      return this.cache[key] as NonNullable<CacheData[K]>;
    }

    // 强制刷新时清空缓存
    if (forceRefresh) {
      this.cache[key] = null;
    }

    // 库存可主动请求
    if (key === 'inventory') {
      ws.emit('requestInventoryInfo');
    }

    return this.waitForData(key);
  }

  /** 异步获取物品数量 */
  async getItemCountAsync(itemId: string): Promise<number> {
    const inventory = await this.getAsync('inventory');
    return inventory[itemId]?.count || 0;
  }

  /** 事件驱动等待数据 */
  private waitForData<K extends CacheKey>(key: K): Promise<NonNullable<CacheData[K]>> {
    return new Promise((resolve, reject) => {
      // 设置超时定时器
      const timer = setTimeout(() => {
        this.removePendingResolver(key, resolver);
        reject(new Error(`获取 ${key} 数据超时`));
      }, DEFAULT_TIMEOUT);

      const resolver: PendingResolver = {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      };

      // 添加到等待队列
      if (!this.pendingResolvers.has(key)) {
        this.pendingResolvers.set(key, []);
      }
      this.pendingResolvers.get(key)!.push(resolver);
    });
  }

  /** 数据到达时通知所有等待者 */
  private notifyDataReady(key: CacheKey): void {
    const resolvers = this.pendingResolvers.get(key);
    if (resolvers?.length) {
      resolvers.forEach(({ resolve, timer }) => {
        clearTimeout(timer);
        resolve(this.cache[key]);
      });
      this.pendingResolvers.delete(key);
    }
  }

  /** 移除特定的 resolver */
  private removePendingResolver(key: CacheKey, resolver: PendingResolver): void {
    const resolvers = this.pendingResolvers.get(key);
    if (resolvers) {
      const index = resolvers.indexOf(resolver);
      if (index > -1) {
        resolvers.splice(index, 1);
      }
    }
  }

  /** 过滤库存（移除数量为0的物品，原地修改减少对象创建） */
  private filterInventory(inventory: Inventory): Inventory {
    // 直接遍历并删除，避免创建中间数组
    for (const key in inventory) {
      if (inventory[key].count <= 0) {
        delete inventory[key];
      }
    }
    return inventory;
  }
}

export const dataCache = new DataCacheManager();
