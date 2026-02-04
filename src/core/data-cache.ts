/**
 * 数据缓存管理器 (简化版)
 *
 * 功能：
 * - 统一管理游戏数据缓存
 * - 监听 WebSocket 事件自动更新缓存
 * - 提供同步和异步数据获取接口
 */

import { logger } from './logger';
import { ws } from './websocket';
import { eventBus } from './event-bus';
import { debounce } from '@/utils';
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

const POLL_INTERVAL = 100;
const DEFAULT_TIMEOUT = 10000;
const INVENTORY_TIMEOUT = 30000;

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
      const { kittyInfo, quest, inventory, tavern } = data.payload.data.data;
      this.cache.userInfo = { kittyInfo, quest };
      if (inventory) this.cache.inventory = this.filterInventory(inventory);
      if (tavern) this.cache.tavern = tavern;
    });

    // 库存更新
    ws.on(
      'dispatchInventoryInfo',
      debounce((data) => {
        this.cache.inventory = this.filterInventory(data.payload.data);
      }, 300),
    );

    // 任务队列更新
    ws.on(
      'dispatchTaskQueueToClient',
      debounce((data) => {
        this.cache.actionQueue = data.payload.data;
        eventBus.emit('actionQueueUpdated', this.cache.actionQueue);
      }, 200),
    );

    // 酒馆专家更新
    ws.on(
      'tavern:getMyExperts:success',
      debounce((data) => {
        this.cache.tavern = data.payload.data;
      }, 500),
    );
  }

  /** 检查缓存是否存在 */
  has(key: CacheKey): boolean {
    return this.cache[key] !== null;
  }

  /** 获取物品数量 */
  getItemCount(itemId: string): number {
    return this.cache.inventory?.[itemId]?.count || 0;
  }

  /** 异步获取缓存（等待数据加载） */
  async getAsync<K extends CacheKey>(key: K, timeout = DEFAULT_TIMEOUT): Promise<NonNullable<CacheData[K]>> {
    if (this.cache[key] !== null) {
      return this.cache[key] as NonNullable<CacheData[K]>;
    }

    // 库存可主动请求
    if (key === 'inventory') {
      ws.emit('requestInventoryInfo');
    }

    return this.waitForData(key, timeout);
  }

  /** 异步获取物品数量 */
  async getItemCountAsync(itemId: string, timeout = INVENTORY_TIMEOUT): Promise<number> {
    const inventory = await this.getAsync('inventory', timeout);
    return inventory[itemId]?.count || 0;
  }

  /** 轮询等待数据 */
  private waitForData<K extends CacheKey>(key: K, timeout: number): Promise<NonNullable<CacheData[K]>> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const poll = () => {
        if (this.cache[key] !== null) {
          resolve(this.cache[key] as NonNullable<CacheData[K]>);
          return;
        }

        if (Date.now() - startTime > timeout) {
          logger.error(`获取 ${key} 数据超时`);
          reject(new Error(`获取 ${key} 数据超时`));
          return;
        }

        setTimeout(poll, POLL_INTERVAL);
      };

      poll();
    });
  }

  /** 过滤库存（移除数量为0的物品） */
  private filterInventory(inventory: Inventory): Inventory {
    return Object.fromEntries(Object.entries(inventory).filter(([, item]) => item.count > 0));
  }
}

export const dataCache = new DataCacheManager();
