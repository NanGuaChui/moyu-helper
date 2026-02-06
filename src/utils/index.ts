/**
 * 工具模块导出
 * 导出任务队列和资源工具函数
 */
import { render } from 'preact';
import type { ComponentChildren } from 'preact';

export * from './task-queue';
export * from './resource';
export * from './analytics';

/**
 * 等待指定时间
 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
}

/**
 * 将Preact组件渲染为HTML字符串
 */
export function renderToString(component: ComponentChildren): string {
  const container = document.createElement('div');
  render(component, container);
  return container.innerHTML;
}

/**
 * 从 WebSocket 错误响应中提取错误信息
 * 服务端错误格式: { payload: { data: { message: string } } } 或 { payload: { data: { msg: string } } }
 */
export function getWsErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!error) return fallback;

  // 尝试从服务端响应格式提取 (支持 message 和 msg 两种字段)
  const serverMessage = (error as any)?.payload?.data?.message || (error as any)?.payload?.data?.msg;
  if (serverMessage) return serverMessage;

  // 尝试从标准 Error 对象提取
  const errorMessage = (error as any)?.message;
  if (errorMessage && typeof errorMessage === 'string') return errorMessage;

  return fallback;
}
