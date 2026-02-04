/**
 * 事件总线 - 统一事件管理
 */

type EventHandler = (...args: any[]) => void;

class EventBus {
  private events = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);

    // 返回取消订阅函数
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    this.events.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach((handler) => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`Event handler error [${event}]:`, error);
      }
    });
  }

  once(event: string, handler: EventHandler): void {
    const wrapper = (...args: any[]) => {
      handler(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * 等待事件触发（Promise 方式）
   * @param event 事件名称
   * @param timeout 超时时间（毫秒）
   * @returns Promise
   */
  waitFor<T = any>(event: string, timeout = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`等待事件 [${event}] 超时`));
      }, timeout);

      const unsubscribe = this.on(event, (data: T) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(data);
      });
    });
  }

  clear(): void {
    this.events.clear();
  }
}

export const eventBus = new EventBus();

/**
 * 事件常量定义
 * 统一管理所有事件名称
 */
export const EVENTS = {
  /** 设置更新事件 - 当用户保存设置时触发 */
  SETTINGS_UPDATED: 'settings:updated',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
