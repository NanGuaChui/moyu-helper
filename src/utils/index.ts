/**
 * 工具模块导出
 */

export * from './task-queue';
export * from './resource';
export * from './analytics';

/** 等待指定时间 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 防抖函数 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** 节流函数 */
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

/** 从 WebSocket 错误响应中提取错误信息 */
export function getWsErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!error) return fallback;
  const serverMessage = (error as any)?.payload?.data?.message || (error as any)?.payload?.data?.msg;
  if (serverMessage) return serverMessage;
  const errorMessage = (error as any)?.message;
  if (errorMessage && typeof errorMessage === 'string') return errorMessage;
  return fallback;
}

/** 等待指定 DOM 元素出现（轮询方式） */
export function waitForElement(selector: string, interval = 500): Promise<Element> {
  return new Promise((resolve) => {
    const check = () => {
      const el = document.querySelector(selector);
      if (el) resolve(el);
      else setTimeout(check, interval);
    };
    check();
  });
}
