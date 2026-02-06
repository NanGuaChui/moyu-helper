/**
 * WebSocket 监控模块
 * 拦截游戏 WebSocket 连接，提供消息收发和事件订阅功能
 */

import * as pako from 'pako';
import { createLogger } from './logger';

const logger = createLogger('WebSocket');
import { taskQueue } from '@/utils/task-queue';
import type { WebSocketMessage, WebSocketEventHandler, WSUserInfo } from '@/types/websocket';

// ==================== 类型定义 ====================

type Unsubscribe = () => void;

interface PendingBinary {
  event: string;
  num: number;
}

interface PendingMessage {
  event: string;
  data: any;
}

// ==================== 常量 ====================

const MESSAGE_PREFIX = {
  STANDARD: '42',
  BINARY_HEADER: '451-',
} as const;

// ==================== WebSocket 管理器 ====================

class WebSocketManager {
  // 事件监听器
  private readonly listeners = new Map<string, Set<WebSocketEventHandler>>();

  // WebSocket 实例和用户状态
  private socket: WebSocket | null = null;
  private userInfo: WSUserInfo | null = null;

  // 用户就绪 Promise
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;

  // 待处理数据
  private readonly pendingBinary: PendingBinary[] = [];
  private readonly pendingMessages: PendingMessage[] = [];

  // 初始化状态
  private initialized = false;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  // ==================== 公共 API ====================

  /**
   * 初始化 WebSocket 监控
   */
  init(): void {
    if (this.initialized) {
      logger.warn('WebSocket 监控已初始化，跳过重复初始化');
      return;
    }

    this.interceptWebSocket();
    this.initialized = true;
    logger.success('WebSocket 监控初始化完成');
  }

  /**
   * 用户就绪 Promise
   */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * 是否已就绪
   */
  get isReady(): boolean {
    return this.userInfo !== null;
  }

  /**
   * 当前用户信息
   */
  get user(): WSUserInfo | null {
    return this.userInfo;
  }

  /**
   * 订阅事件
   * @param event 事件名称（支持单个或数组）
   * @param handler 事件处理器
   * @returns 取消订阅函数
   */
  on(event: string | string[], handler: WebSocketEventHandler): Unsubscribe {
    const events = Array.isArray(event) ? event : [event];

    for (const evt of events) {
      const handlers = this.listeners.get(evt) ?? new Set();
      handlers.add(handler);
      this.listeners.set(evt, handlers);
    }

    return () => {
      for (const evt of events) {
        this.listeners.get(evt)?.delete(handler);
      }
    };
  }

  /**
   * 订阅事件（仅触发一次）
   * @param event 事件名称（支持单个或数组）
   * @param handler 事件处理器
   * @returns 取消订阅函数
   */
  once(event: string | string[], handler: WebSocketEventHandler): Unsubscribe {
    let triggered = false;

    const wrapper: WebSocketEventHandler = (data) => {
      if (triggered) return;
      triggered = true;
      unsubscribe();
      handler(data);
    };

    const unsubscribe = this.on(event, wrapper);

    return () => {
      if (!triggered) {
        triggered = true;
        unsubscribe();
      }
    };
  }

  /**
   * 移除事件监听器
   * @param event 事件名称
   * @param handler 事件处理器
   */
  off(event: string, handler: WebSocketEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  /**
   * 等待事件（Promise 方式）
   * @param event 事件名称（支持单个或数组）
   * @param timeout 超时时间（毫秒）
   * @returns Promise<WebSocketMessage>
   */
  waitFor(event: string | string[], timeout = 10000): Promise<WebSocketMessage> {
    return new Promise((resolve, reject) => {
      const eventStr = Array.isArray(event) ? event.join(', ') : event;

      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`等待事件 [${eventStr}] 超时`));
      }, timeout);

      const unsubscribe = this.once(event, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  /**
   * 发送消息（不等待响应）
   * @param event 事件名称
   * @param data 消息数据
   */
  async emit(event: string, data: any = {}): Promise<void> {
    // 用户未就绪时加入待发送队列
    if (!this.userInfo) {
      const exists = this.pendingMessages.some((m) => m.event === event);
      if (!exists) {
        this.pendingMessages.push({ event, data });
        logger.warn(`消息 [${event}] 已加入待发送队列`);
      }
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    return taskQueue.add(() => {
      const message = MESSAGE_PREFIX.STANDARD + JSON.stringify([event, { user: this.userInfo, data }]);
      this.socket!.send(message);
      logger.debug(`发送消息: ${event}`);
    });
  }

  /**
   * 发送消息并等待响应（自动监听 success/fail/error）
   * @param event 事件名称
   * @param data 消息数据
   * @param timeout 超时时间（毫秒）
   */
  async request(event: string, data: any = {}, timeout = 10000): Promise<WebSocketMessage> {
    const responseEvents = [`${event}:success`, `${event}:fail`, `${event}:error`];

    const responsePromise = new Promise<WebSocketMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`请求 [${event}] 超时`));
      }, timeout);

      const unsubscribe = this.once(responseEvents, (response) => {
        clearTimeout(timer);
        if (response.event.endsWith(':fail') || response.event.endsWith(':error')) {
          reject(response);
        } else {
          resolve(response);
        }
      });
    });

    await this.emit(event, data);
    return responsePromise;
  }

  /**
   * 发送消息并等待指定事件响应
   * @param sendEvent 发送的事件名称
   * @param listenEvent 监听的事件名称（支持单个或数组）
   * @param data 消息数据
   * @param timeout 超时时间（毫秒）
   */
  async requestRaw(
    sendEvent: string,
    listenEvent: string | string[],
    data: any = {},
    timeout = 10000,
  ): Promise<WebSocketMessage> {
    const responsePromise = this.waitFor(listenEvent, timeout);
    await this.emit(sendEvent, data);
    return responsePromise;
  }

  /**
   * 销毁 WebSocket 监控
   */
  destroy(): void {
    this.listeners.clear();
    this.pendingBinary.length = 0;
    this.pendingMessages.length = 0;
    this.socket = null;
    this.userInfo = null;
    this.initialized = false;

    // 重置 ready Promise
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    logger.info('WebSocket 监控已销毁');
  }

  // ==================== 私有方法 - WebSocket 拦截 ====================

  /**
   * 拦截 WebSocket 连接
   */
  private interceptWebSocket(): void {
    const self = this;
    const proto = WebSocket.prototype;

    // 拦截 send 方法
    const originalSend = proto.send;
    proto.send = function (data: any) {
      if (self.isGameWebSocket(this)) {
        self.socket = this;
        self.handleOutgoing(data);
      }
      return originalSend.call(this, data);
    };

    // 拦截 onmessage 属性
    const msgDescriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (msgDescriptor?.set) {
      Object.defineProperty(proto, 'onmessage', {
        ...msgDescriptor,
        set(callback: ((event: MessageEvent) => void) | null) {
          const ws = this;
          const wrapped = callback
            ? (event: MessageEvent) => {
              self.handleIncoming(event.data);
              callback.call(ws, event);
            }
            : null;
          msgDescriptor.set!.call(this, wrapped);
        },
      });
    }

    // 拦截 addEventListener 方法
    const originalAddListener = proto.addEventListener;
    proto.addEventListener = function (type: string, listener: any, options?: any) {
      if (!self.isGameWebSocket(this) || type !== 'message') {
        return originalAddListener.call(this, type, listener, options);
      }

      const ws = this;
      const wrapped = (event: Event) => {
        const msgEvent = event as MessageEvent;
        self.handleIncoming(msgEvent.data);

        if (typeof listener === 'function') {
          listener.call(ws, event);
        } else {
          listener?.handleEvent?.(event);
        }
      };

      return originalAddListener.call(this, type, wrapped, options);
    };
  }

  /**
   * 判断是否为游戏 WebSocket
   */
  private isGameWebSocket(ws: any): ws is WebSocket {
    return ws instanceof WebSocket && ws.constructor === WebSocket;
  }

  // ==================== 私有方法 - 消息处理 ====================

  /**
   * 处理发送的消息（提取用户信息）
   */
  private handleOutgoing(data: any): void {
    if (this.userInfo) return;

    const user = this.extractUserInfo(data);
    if (user) {
      this.userInfo = user;
      logger.info('用户信息已获取', user.name);

      // 触发 ready
      this.readyResolve?.();

      // 处理待发送消息
      this.flushPendingMessages();
    }
  }

  /**
   * 从消息中提取用户信息
   */
  private extractUserInfo(data: any): WSUserInfo | null {
    try {
      if (typeof data !== 'string' || data.length <= 2) return null;
      const payload = JSON.parse(data.substring(2));
      const user = payload[1]?.user;
      return user?.name ? user : null;
    } catch {
      return null;
    }
  }

  /**
   * 处理待发送消息队列
   */
  private flushPendingMessages(): void {
    if (this.pendingMessages.length === 0) return;

    logger.info(`处理 ${this.pendingMessages.length} 条待发送消息`);

    for (const msg of this.pendingMessages) {
      void this.emit(msg.event, msg.data);
    }

    this.pendingMessages.length = 0;
  }

  /**
   * 处理接收的消息
   */
  private handleIncoming(data: any): void {
    // 二进制数据
    if (data instanceof ArrayBuffer) {
      if (this.pendingBinary.length > 0) {
        this.processBinaryMessage(data);
      }
      return;
    }

    // 字符串消息
    if (typeof data !== 'string') return;

    if (data.startsWith(MESSAGE_PREFIX.BINARY_HEADER)) {
      this.processBinaryHeader(data);
    } else if (data.startsWith(MESSAGE_PREFIX.STANDARD)) {
      this.processStandardMessage(data);
    }
  }

  /**
   * 检查事件是否有监听器
   */
  private hasListeners(event: string): boolean {
    const handlers = this.listeners.get(event);
    return !!(handlers && handlers.size > 0);
  }

  /**
   * 处理标准消息（42 前缀）
   * 优化：避免重复 slice，使用更高效的事件名提取
   */
  private processStandardMessage(data: string): void {
    try {
      const jsonStart = data.indexOf('[');
      if (jsonStart === -1) return;

      const jsonStr = data.slice(jsonStart);

      // 快速提取事件名：查找第一个引号对
      const firstQuote = jsonStr.indexOf('"');
      if (firstQuote === -1) return;
      const secondQuote = jsonStr.indexOf('"', firstQuote + 1);
      if (secondQuote === -1) return;

      const event = jsonStr.slice(firstQuote + 1, secondQuote);

      // 提前终止：没有监听器就不解析 payload
      if (!this.hasListeners(event)) {
        return;
      }

      // 有监听器才完整解析
      const [, payloadStr] = JSON.parse(jsonStr);
      const payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
      this.dispatch({ event, payload });
    } catch {
      // 解析失败静默跳过
    }
  }

  /**
   * 处理二进制消息头（451- 前缀）
   * 优化：避免重复 slice，使用更高效的事件名提取
   */
  private processBinaryHeader(data: string): void {
    try {
      const jsonStart = data.indexOf('[');
      if (jsonStart === -1) return;

      const jsonStr = data.slice(jsonStart);

      // 快速提取事件名：查找第一个引号对
      const firstQuote = jsonStr.indexOf('"');
      if (firstQuote === -1) return;
      const secondQuote = jsonStr.indexOf('"', firstQuote + 1);
      if (secondQuote === -1) return;

      const event = jsonStr.slice(firstQuote + 1, secondQuote);

      // 提前终止：没有监听器就不入队，后续二进制数据会被跳过
      if (!this.hasListeners(event)) {
        return;
      }

      // 有监听器才完整解析并入队
      const [, obj] = JSON.parse(jsonStr);
      if (obj?._placeholder === true) {
        this.pendingBinary.push({ event, num: obj.num || 0 });
      }
    } catch {
      // 解析失败静默跳过
    }
  }

  /**
   * 处理二进制消息体
   */
  private processBinaryMessage(data: ArrayBuffer): void {
    const pending = this.pendingBinary.shift();
    if (!pending) return;

    const binary = new Uint8Array(data);

    try {
      // 尝试解压
      const text = pako.inflate(binary, { to: 'string' });
      let payload: any;

      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }

      this.dispatch({ event: pending.event, payload });
    } catch {
      // 解压失败，传递原始数据
      this.dispatch({ event: pending.event, payload: binary });
    }
  }

  // ==================== 私有方法 - 事件分发 ====================

  /**
   * 分发事件到监听器
   */
  private dispatch(message: WebSocketMessage): void {
    if (!message?.event) return;

    const handlers = this.listeners.get(message.event);
    if (!handlers || handlers.size === 0) return;

    logger.debug(`接收事件: ${message.event}`, message.payload);

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        logger.error(`事件处理失败 [${message.event}]`, error);
      }
    }
  }
}

// ==================== 导出单例 ====================

export const ws = new WebSocketManager();
