/**
 * 任务队列管理器
 * 控制任务执行速率，防止触发游戏反作弊机制
 */

import { toast } from '@/core/toast';
import { logger } from '@/core/logger';
import { eventBus, EVENTS } from '@/core/event-bus';
import { appConfig } from '@/config/gm-settings';
import { sleep } from '.';

interface TaskQueueConfig {
  interval: number;
}

interface QueuedTask<T> {
  task: () => T | Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

class TaskQueue {
  private queue: QueuedTask<any>[] = [];
  private processing = false;
  private taskCount = 0;
  private config: TaskQueueConfig;

  constructor(config: TaskQueueConfig) {
    this.config = config;
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
  }

  setConfig(config: Partial<TaskQueueConfig>): void {
    Object.assign(this.config, config);
    logger.debug('任务队列配置已更新', this.config);
  }

  setInterval(ms: number): void {
    this.config.interval = Math.max(0, ms);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getTaskCount(): number {
    return this.taskCount;
  }

  resetCount(): void {
    this.taskCount = 0;
    logger.debug('任务计数已重置');
  }

  add<T>(task: () => T | Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.processing) {
        void this.process();
      }
    });
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;

        try {
          const result = await item.task();
          item.resolve(result);
          this.taskCount++;

          if (this.config.interval > 0) {
            await sleep(this.config.interval);
          }
        } catch (error) {
          logger.error('任务执行失败', error);
          item.reject(error);
        }
      }
    } finally {
      this.processing = false;
      logger.debug(`任务队列处理完成，总计执行 ${this.taskCount} 个任务`);
    }
  }

  destroy(): void {
    this.queue.forEach((item) => item.reject(new Error('任务队列已销毁')));
    this.queue = [];
    this.processing = false;
    this.taskCount = 0;
    toast.hideProgress('task-queue');
    logger.info('任务队列已销毁');
  }

  async reload(): Promise<void> {
    this.config.interval = await appConfig.TASK_INTERVAL.get();
    logger.info('任务队列配置已刷新');
  }
}

export const taskQueue = new TaskQueue({
  interval: appConfig.TASK_INTERVAL.defaultValue,
});

// 初始化配置
(async () => {
  taskQueue.setInterval(await appConfig.TASK_INTERVAL.get());
})();
