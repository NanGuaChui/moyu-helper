/**
 * 数据缓存管理器
 *
 * 功能说明：
 * - 统一管理游戏数据缓存（用户信息、库存等）
 * - 监听 WebSocket 事件自动更新缓存
 * - 提供带等待队列的异步数据获取接口
 * - 支持超时处理和重试机制
 */

import { logger } from './logger';
import { ws } from './websocket';
import { eventBus } from './event-bus';
import { debounce } from '@/utils';
import type { UserInfo, Inventory, CacheEntry, TavernExpert } from '@/types/game-data';

/**
 * 行动队列项
 */
interface ActionQueueItem {
  actionId: string;
  repeatCount: number;
  currentRepeat: number;
  createTime: number;
}

/**
 * 缓存键类型
 */
type CacheKey = 'userInfo' | 'inventory' | 'actionQueue' | 'tavern';

/**
 * 缓存映射类型
 */
interface CacheMap {
  userInfo: UserInfo;
  inventory: Inventory;
  actionQueue: ActionQueueItem[];
  tavern: TavernExpert[];
}

/**
 * 数据缓存管理器类
 */
class DataCacheManager {
  private caches: {
    [K in CacheKey]: CacheEntry<CacheMap[K]>;
  };

  private isInitialized = false;

  constructor() {
    this.caches = {
      userInfo: {
        data: null,
        loading: false,
        pendingRequests: [],
      },
      inventory: {
        data: null,
        loading: false,
        pendingRequests: [],
      },
      actionQueue: {
        data: null,
        loading: false,
        pendingRequests: [],
      },
      tavern: {
        data: null,
        loading: false,
        pendingRequests: [],
      },
    };
  }

  /**
   * 初始化数据缓存管理器
   * 注册 WebSocket 事件监听
   */
  init(): void {
    if (this.isInitialized) {
      logger.warn('数据缓存管理器已初始化，跳过重复初始化');
      return;
    }

    // 监听用户信息初始化事件
    ws.once('characterInitData', (data) => {
      const { kittyInfo, quest, inventory, tavern } = data.payload.data.data;
      const userInfo: UserInfo = { kittyInfo, quest };
      this.updateCache('userInfo', userInfo);

      // 同时更新库存缓存（避免额外的 requestInventoryInfo 请求）
      if (inventory) {
        this.updateCache('inventory', this.filterInventory(inventory));
      }

      // 更新酒馆专家列表
      if (tavern) {
        this.updateCache('tavern', tavern);
      }
    });

    // 监听库存更新事件（防抖 300ms）
    ws.on(
      'dispatchInventoryInfo',
      debounce((data) => {
        const inventory = this.filterInventory(data.payload.data);
        this.updateCache('inventory', inventory);
      }, 300),
    );

    // 监听行动队列更新事件（防抖 200ms）
    ws.on(
      'dispatchTaskQueueToClient',
      debounce((data) => {
        const actionQueue = data.payload.data;
        this.updateCache('actionQueue', actionQueue);
        eventBus.emit('actionQueueUpdated', actionQueue);
      }, 200),
    );

    // 监听酒馆专家列表更新（防抖 500ms）
    ws.on(
      'tavern:getMyExperts:success',
      debounce((data) => {
        const experts = data.payload.data;
        this.updateCache('tavern', experts);
      }, 500),
    );

    this.isInitialized = true;
    logger.success('数据缓存管理器初始化完成');
  }

  /**
   * 同步获取缓存数据
   * @param key 缓存键
   * @returns 缓存数据，如果不存在则返回 null
   */
  get<K extends CacheKey>(key: K): CacheMap[K] | null {
    const cache = this.caches[key];
    return cache.data;
  }

  /**
   * 获取指定物品的库存数量
   * @param itemId 物品 ID
   * @returns 物品数量，如果不存在则返回 0
   */
  getItemCount(itemId: string): number {
    const inventory = this.caches.inventory.data;
    return inventory?.[itemId]?.count || 0;
  }

  /**
   * 异步获取指定物品的库存数量
   * @param itemId 物品 ID
   * @param canRetry 是否允许超时后重试
   * @param timeout 超时时间（毫秒），默认 30 秒
   * @returns 物品数量的 Promise
   */
  async getItemCountAsync(itemId: string, canRetry: boolean = false, timeout: number = 30000): Promise<number> {
    const inventory = await this.getAsync('inventory', canRetry, timeout);
    return inventory[itemId]?.count || 0;
  }

  /**
   * 异步获取缓存数据
   * @param key 缓存键
   * @param canRetry 是否允许超时后重试
   * @param timeout 超时时间（毫秒），默认 30 秒
   * @returns 缓存数据的 Promise
   */
  async getAsync<K extends CacheKey>(key: K, canRetry: boolean = false, timeout: number = 30000): Promise<CacheMap[K]> {
    const cache = this.caches[key];

    // 如果有缓存，直接返回
    if (cache.data !== null) {
      return Promise.resolve(cache.data);
    }

    // 如果正在加载中，加入等待队列
    if (cache.loading) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // 超时处理
          const index = cache.pendingRequests.findIndex((req) => req.timer === timer);
          if (index !== -1) {
            cache.pendingRequests.splice(index, 1);
          }

          // 如果允许重试，重置 loading 状态
          if (canRetry) {
            cache.loading = false;
            logger.error(`获取 ${key} 数据超时（30秒），已重置加载状态，可重试`);
          } else {
            logger.error(`获取 ${key} 数据超时（30秒），该数据由系统自动触发，无法重试`);
          }

          reject(new Error(`获取 ${key} 数据超时`));
        }, timeout);

        cache.pendingRequests.push({ resolve, reject, timer });
      });
    }

    // 开始加载
    cache.loading = true;

    // 如果是库存数据，发起请求
    if (key === 'inventory') {
      ws.send('requestInventoryInfo');
      logger.info('已发送库存数据请求');
    }

    // 返回 Promise 并加入等待队列
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 超时处理
        const index = cache.pendingRequests.findIndex((req) => req.timer === timer);
        if (index !== -1) {
          cache.pendingRequests.splice(index, 1);
        }

        // 如果允许重试，重置 loading 状态
        if (canRetry) {
          cache.loading = false;
          logger.error(`获取 ${key} 数据超时（30秒），已重置加载状态，可重试`);
        } else {
          logger.error(`获取 ${key} 数据超时（30秒），该数据由系统自动触发，无法重试`);
        }

        reject(new Error(`获取 ${key} 数据超时`));
      }, timeout);

      cache.pendingRequests.push({ resolve, reject, timer });
    });
  }

  /**
   * 更新缓存数据
   * @param key 缓存键
   * @param data 新数据
   */
  private updateCache<K extends CacheKey>(key: K, data: CacheMap[K]): void {
    const cache = this.caches[key];

    // 更新缓存数据
    cache.data = data;
    cache.loading = false;

    logger.debug(`${key} 缓存已更新，处理 ${cache.pendingRequests.length} 个待处理请求`);

    // 处理所有待处理的请求
    const requests = cache.pendingRequests.splice(0);
    for (const request of requests) {
      clearTimeout(request.timer);
      request.resolve(data);
    }
  }

  /**
   * 过滤库存数据，去掉 count 为 0 的物品以减小缓存大小
   * @param inventory 原始库存数据
   * @returns 过滤后的库存数据
   */
  private filterInventory(inventory: Inventory): Inventory {
    const filtered: Inventory = {};
    for (const [itemId, item] of Object.entries(inventory)) {
      if (item.count > 0) {
        filtered[itemId] = item;
      }
    }
    return filtered;
  }
}

// 导出单例实例
export const dataCache = new DataCacheManager();
