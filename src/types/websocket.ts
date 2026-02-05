/**
 * WebSocket 类型定义
 */

/**
 * WebSocket 消息结构
 */
export interface WebSocketMessage {
  event: string;
  payload: any;
}

/**
 * WebSocket 事件处理器
 */
export type WebSocketEventHandler = (data: WebSocketMessage) => void;

/**
 * 取消订阅函数
 */
export type Unsubscribe = () => void;

/**
 * 用户信息
 */
export interface WSUserInfo {
  name: string;
  [key: string]: any;
}
