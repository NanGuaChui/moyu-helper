/**
 * 日志系统
 * 支持多级别日志输出和日志级别过滤
 */

import { eventBus, EVENTS } from './event-bus';
import { appConfig } from '@/config/gm-settings';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'none';

interface LogConfig {
  emoji: string;
  color: string;
  method: 'log' | 'warn' | 'error';
  priority: number;
}

const LOG_CONFIGS: Record<LogLevel, LogConfig> = {
  debug: { emoji: '🔍', color: '#8b5cf6', method: 'log', priority: 0 },
  info: { emoji: 'ℹ️', color: '#3b82f6', method: 'log', priority: 1 },
  success: { emoji: '✅', color: '#10b981', method: 'log', priority: 2 },
  warn: { emoji: '⚠️', color: '#f59e0b', method: 'warn', priority: 3 },
  error: { emoji: '❌', color: '#ef4444', method: 'error', priority: 4 },
  none: { emoji: '', color: '', method: 'log', priority: 999 },
};

// 共享的日志配置状态
let enabledTypes: Record<string, boolean> = {};

function initLoggerEvents(): void {
  eventBus.on(EVENTS.SETTINGS_UPDATED, reloadLogConfig);
}

async function reloadLogConfig(): Promise<void> {
  enabledTypes = await appConfig.LOG_ENABLED_TYPES.get();
}

class Logger {
  constructor(private tag?: string) {}

  private log(level: LogLevel, ...args: any[]): void {
    if (enabledTypes[level] !== true) return;
    const { emoji, color, method } = LOG_CONFIGS[level];
    const prefix = this.tag ? `[🐟] [${this.tag}] ${emoji}` : `[🐟] ${emoji}`;
    console[method](`%c${prefix}`, `color: ${color}; font-weight: bold;`, ...args);
  }

  debug = (...args: any[]) => this.log('debug', ...args);
  info = (...args: any[]) => this.log('info', ...args);
  success = (...args: any[]) => this.log('success', ...args);
  warn = (...args: any[]) => this.log('warn', ...args);
  error = (...args: any[]) => this.log('error', ...args);

  async reload(): Promise<void> {
    return reloadLogConfig();
  }
}

initLoggerEvents();

export function createLogger(tag: string): Logger {
  return new Logger(tag);
}

export const logger = new Logger();
