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

interface ActionQueueItem {
  actionId: string;
  repeatCount: number;
  currentRepeat: number;
  createTime: number;
}

type CacheKey = 'userInfo' | 'inventory' | 'actionQueue' | 'tavern';

interface CacheMap {
  userInfo: UserInfo;
  inventory: Inventory;
  actionQueue: ActionQueueItem[];
  tavern: TavernExpert[];
}

const DEFAULT_TIMEOUT = 10000;
const INVENTORY_TIMEOUT = 30000;
const RETRYABLE_KEYS: CacheKey[] = ['inventory'];

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

    this.registerEventListeners();
    this.isInitialized = true;
    logger.success('数据缓存管理器初始化完成');
  }

  /**
   * 注册 WebSocket 事件监听器
   */
  private registerEventListeners(): void {
    ws.once('characterInitData', (data) => {
      const { kittyInfo, quest, inventory, tavern } = data.payload.data.data;
      this.updateCache('userInfo', { kittyInfo, quest });
      if (inventory) this.updateCache('inventory', this.filterInventory(inventory));
      if (tavern) this.updateCache('tavern', tavern);
    });

    ws.on(
      'dispatchInventoryInfo',
      debounce((data) => {
        this.updateCache('inventory', this.filterInventory(data.payload.data));
      }, 300),
    );

    ws.on(
      'dispatchTaskQueueToClient',
      debounce((data) => {
        const actionQueue = data.payload.data;
        this.updateCache('actionQueue', actionQueue);
        eventBus.emit('actionQueueUpdated', actionQueue);
      }, 200),
    );

    ws.on(
      'tavern:getMyExperts:success',
      debounce((data) => {
        this.updateCache('tavern', data.payload.data);
      }, 500),
    );
  }

  /**
   * 同步获取缓存数据
   */
  get<K extends CacheKey>(key: K): CacheMap[K] | null {
    return this.caches[key].data;
  }

  /**
   * 获取指定物品的库存数量
   */
  getItemCount(itemId: string): number {
    return this.caches.inventory.data?.[itemId]?.count || 0;
  }

  /**
   * 异步获取指定物品的库存数量
   */
  async getItemCountAsync(itemId: string, timeout = INVENTORY_TIMEOUT): Promise<number> {
    const inventory = await this.getAsync('inventory', timeout);
    return inventory[itemId]?.count || 0;
  }

  /**
   * 异步获取缓存数据
   */
  async getAsync<K extends CacheKey>(key: K, timeout = DEFAULT_TIMEOUT): Promise<CacheMap[K]> {
    const cache = this.caches[key];

    if (cache.data !== null) {
      return cache.data;
    }

    if (cache.loading) {
      return this.createPendingPromise(key, cache, timeout);
    }

    cache.loading = true;
    this.requestData(key);

    return this.createPendingPromise(key, cache, timeout);
  }

  /**
   * 创建等待中的 Promise
   */
  private createPendingPromise<K extends CacheKey>(
    key: K,
    cache: CacheEntry<CacheMap[K]>,
    timeout: number,
  ): Promise<CacheMap[K]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handleTimeout(key, cache, timer);
        reject(new Error(`获取 ${key} 数据超时`));
      }, timeout);

      cache.pendingRequests.push({ resolve, reject, timer });
    });
  }

  /**
   * 处理超时
   */
  private handleTimeout<K extends CacheKey>(key: K, cache: CacheEntry<CacheMap[K]>, timer: NodeJS.Timeout): void {
    const index = cache.pendingRequests.findIndex((req) => req.timer === timer);
    if (index !== -1) {
      cache.pendingRequests.splice(index, 1);
    }

    const canRetry = RETRYABLE_KEYS.includes(key);
    if (canRetry) {
      cache.loading = false;
      logger.error(`获取 ${key} 数据超时，已重置加载状态，可重试`);
    } else {
      logger.error(`获取 ${key} 数据超时，该数据由系统自动触发，无法重试`);
    }
  }

  /**
   * 请求数据
   */
  private requestData(key: CacheKey): void {
    if (key === 'inventory') {
      ws.send('requestInventoryInfo');
      logger.info('已发送库存数据请求');
    }
  }

  /**
   * 更新缓存数据
   */
  private updateCache<K extends CacheKey>(key: K, data: CacheMap[K]): void {
    const cache = this.caches[key];
    cache.data = data;
    cache.loading = false;

    logger.debug(`${key} 缓存已更新，处理 ${cache.pendingRequests.length} 个待处理请求`);

    this.resolvePendingRequests(cache, data);
  }

  /**
   * 处理所有待处理的请求
   */
  private resolvePendingRequests<T>(cache: CacheEntry<T>, data: T): void {
    const requests = cache.pendingRequests.splice(0);
    requests.forEach((request) => {
      clearTimeout(request.timer);
      request.resolve(data);
    });
  }

  /**
   * 过滤库存数据，去掉 count 为 0 的物品以减小缓存大小
   */
  private filterInventory(inventory: Inventory): Inventory {
    return Object.fromEntries(Object.entries(inventory).filter(([, item]) => item.count > 0));
  }
}

// 导出单例实例
export const dataCache = new DataCacheManager();
