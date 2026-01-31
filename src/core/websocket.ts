import { logger } from './logger';
import { eventBus } from './event-bus';
import * as pako from 'pako';
import { taskQueue } from '@/utils/task-queue';

interface WebSocketMessage {
  event: string;
  payload: any;
}

type EventHandler = (data: WebSocketMessage) => void;
type Unsubscribe = () => void;

interface PendingBinary {
  event: string;
  num: number;
}

const MESSAGE_PREFIX = {
  SEND: '42',
  BINARY_HEADER: '451-',
} as const;

const USER_CHECK_INTERVAL = 1000;

class WebSocketMonitor {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private socket: WebSocket | null = null;
  private userInfo: any = null;
  private readonly pendingBinary: PendingBinary[] = [];
  private readonly pendingMessages = new Map<string, any>();
  private checkTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  init(): void {
    if (this.isInitialized) {
      logger.warn('WebSocket 监控已初始化，跳过重复初始化');
      return;
    }
    this.interceptWebSocket();
    this.startUserCheck();
    this.isInitialized = true;
    logger.success('WebSocket 监控初始化完成');
  }

  private startUserCheck(): void {
    this.checkTimer = setInterval(() => {
      if (this.userInfo && this.pendingMessages.size > 0) {
        this.processPending();
      }
    }, USER_CHECK_INTERVAL);
  }

  private processPending(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    logger.info(`处理 ${this.pendingMessages.size} 条待发送消息`);
    this.pendingMessages.forEach((data, method) => void this.send(method, data));
    this.pendingMessages.clear();
  }

  on(event: string | string[], handler: EventHandler): Unsubscribe {
    const events = Array.isArray(event) ? event : [event];
    events.forEach((evt) => {
      const handlers = this.handlers.get(evt) ?? new Set<EventHandler>();
      handlers.add(handler);
      this.handlers.set(evt, handlers);
    });

    return () => events.forEach((evt) => this.handlers.get(evt)?.delete(handler));
  }

  once(event: string | string[], handler: EventHandler): Unsubscribe {
    const events = Array.isArray(event) ? event : [event];
    const wrapper = (data: WebSocketMessage) => {
      // 先清理所有事件的监听器，避免重复触发
      events.forEach((evt) => this.handlers.get(evt)?.delete(wrapper));
      handler(data);
    };
    return this.on(event, wrapper);
  }

  awaitOnce(event: string | string[], timeout = 10000): Promise<WebSocketMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`等待事件 [${Array.isArray(event) ? event.join(', ') : event}] 超时`));
      }, timeout);

      const unsubscribe = this.once(event, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  async sendAndListen(sendEvent: string, data: any = {}, timeout?: number): Promise<WebSocketMessage> {
    const promise = new Promise<WebSocketMessage>((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            unsubscribe();
            reject(new Error(`等待事件 [${sendEvent}] 超时`));
          }, timeout)
        : null;

      const unsubscribe = this.once([`${sendEvent}:success`, `${sendEvent}:fail`], (data) => {
        if (timer) clearTimeout(timer);
        if (data.event === `${sendEvent}:fail`) {
          reject(data);
        } else {
          resolve(data);
        }
      });
    });
    await this.send(sendEvent, data);
    return promise;
  }

  async sendAndListenCustom(
    sendEvent: string,
    listenEvent: string | string[],
    data: any = {},
    timeout?: number,
  ): Promise<WebSocketMessage> {
    const promise = this.awaitOnce(listenEvent, timeout);
    await this.send(sendEvent, data);
    return promise;
  }

  async sendAndWaitEvent(
    method: string,
    data: any,
    eventName: string,
    condition: (eventData: any) => boolean,
    timeout = 10000,
  ): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        eventBus.off(eventName, handler);
        reject(new Error(`等待事件 [${eventName}] 超时`));
      }, timeout);

      const handler = (eventData: any) => {
        try {
          if (condition(eventData)) {
            clearTimeout(timer);
            eventBus.off(eventName, handler);
            resolve();
          }
        } catch (error) {
          clearTimeout(timer);
          eventBus.off(eventName, handler);
          reject(error);
        }
      };
      eventBus.on(eventName, handler);
    });

    await this.send(method, data);
    return promise;
  }

  async send(method: string, data: any = {}): Promise<void> {
    if (!this.userInfo) {
      if (!this.pendingMessages.has(method)) {
        logger.warn(`消息 [${method}] 已加入待发送队列`);
        this.pendingMessages.set(method, data);
      }
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    return taskQueue.add(() => {
      const message = MESSAGE_PREFIX.SEND + JSON.stringify([method, { user: this.userInfo, data }]);
      this.socket!.send(message);
      logger.debug(`发送消息: ${method}`);
    });
  }

  private interceptWebSocket(): void {
    const proto = WebSocket.prototype;
    const self = this;

    // 拦截 send 方法
    const originalSend = proto.send;
    proto.send = function (data: any) {
      if (self.isRealWebSocket(this)) {
        self.socket = this;
        self.handleSend(data);
      }
      return originalSend.call(this, data);
    };

    // 拦截 onmessage 属性
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (descriptor) {
      Object.defineProperty(proto, 'onmessage', {
        ...descriptor,
        set(callback: any) {
          const ws = this;
          const wrapped = (event: MessageEvent) => {
            self.handleReceive(event.data);
            callback?.call(ws, event);
          };
          descriptor.set!.call(this, wrapped);
        },
      });
    }

    // 拦截 addEventListener 方法
    const originalAddListener = proto.addEventListener;
    proto.addEventListener = function (type: string, listener: any, options?: any) {
      if (!self.isRealWebSocket(this)) {
        return originalAddListener.call(this, type, listener, options);
      }

      if (type !== 'message') {
        return originalAddListener.call(this, type, listener, options);
      }

      const ws = this;
      const wrapped = (event: Event) => {
        const msgEvent = event as MessageEvent;
        self.handleReceive(msgEvent.data);
        if (typeof listener === 'function') {
          listener.call(ws, event);
        } else {
          listener?.handleEvent(event);
        }
      };
      return originalAddListener.call(this, type, wrapped, options);
    };
  }

  private isRealWebSocket(obj: any): obj is WebSocket {
    return obj instanceof WebSocket && obj.constructor === WebSocket;
  }

  private handleSend(data: any): void {
    if (this.userInfo) return;

    this.userInfo = this.extractUser(data);
    if (this.userInfo && this.pendingMessages.size > 0) {
      this.processPending();
    }
  }

  private extractUser(data: any): any {
    try {
      if (typeof data !== 'string' || data.length <= 2) return null;

      const payload = JSON.parse(data.substring(2));
      return payload[1]?.user?.name ? payload[1].user : null;
    } catch {
      return null;
    }
  }

  private handleReceive(data: any): void {
    // 二进制数据：仅在有待合并事件时处理
    if (data instanceof ArrayBuffer) {
      if (this.pendingBinary.length > 0) {
        this.handle451Binary(data);
      }
      return;
    }

    // 非字符串直接跳过
    if (typeof data !== 'string') return;

    // 仅处理 451- 开头的消息（socket.io 二进制消息头）
    if (data.startsWith(MESSAGE_PREFIX.BINARY_HEADER)) {
      this.handle451Header(data);
    }
    // 其他消息（如 42 开头的普通消息）直接忽略，避免不必要的解析
  }

  private handle451Header(data: string): void {
    try {
      const jsonStart = data.indexOf('[');
      if (jsonStart === -1) return;

      const [event, obj] = JSON.parse(data.slice(jsonStart));
      if (obj?._placeholder === true) {
        this.pendingBinary.push({ event, num: obj.num || 0 });
      }
    } catch {
      // 解析失败静默跳过
    }
  }

  private handle451Binary(data: ArrayBuffer): void {
    const evt = this.pendingBinary.shift();
    if (!evt) return;

    try {
      const bin = new Uint8Array(data);
      const text = pako.inflate(bin, { to: 'string' });

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      this.dispatch({ event: evt.event, payload: parsed });
    } catch {
      // 解压失败，可能是明文，直接传递原始数据
      this.dispatch({ event: evt.event, payload: new Uint8Array(data) });
    }
  }

  private dispatch(data: WebSocketMessage): void {
    if (!data?.event) return;

    const handlers = this.handlers.get(data.event);
    // 关键优化：没有监听器则直接跳过，避免不必要的日志和处理
    if (!handlers || handlers.size === 0) return;

    logger.debug(`接收事件: ${data.event}`, data.payload);

    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        logger.error(`事件处理失败 [${data.event}]`, error);
      }
    });
  }

  destroy(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.handlers.clear();
    this.pendingMessages.clear();
    this.pendingBinary.length = 0;
    this.socket = null;
    this.userInfo = null;
    this.isInitialized = false;
    logger.info('WebSocket 监控已销毁');
  }
}

export const ws = new WebSocketMonitor();
