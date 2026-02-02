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
  batchSize: number;
  batchDelay: number;
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
  private countdownToast: boolean = false;
  private config: TaskQueueConfig;

  constructor(config: TaskQueueConfig) {
    this.config = config;
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
  }

  setConfig(config: Partial<TaskQueueConfig>): void {
    Object.assign(this.config, config);
    logger.debug('任务队列配置已更新', this.config);
  }

  setBatchDelay(ms: number): void {
    this.config.batchDelay = Math.max(0, ms);
  }

  setBatchSize(size: number): void {
    this.config.batchSize = Math.max(1, size);
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

  private async waitForBatch(): Promise<void> {
    const seconds = Math.floor(this.config.batchDelay / 1000);
    toast.progress(`已执行 ${this.taskCount} 个任务，暂停 ${seconds} 秒...`);

    for (let i = seconds; i > 0; i--) {
      toast.progress(`已执行 ${this.taskCount} 个任务，暂停 ${i} 秒...`);
      await sleep(1000);
    }

    toast.hideProgress();

    // 自动重置计数器（如果队列为空）
    if (this.queue.length === 0) {
      this.resetCount();
    }
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

          // 批次控制
          if (this.taskCount % this.config.batchSize === 0 && this.queue.length > 0) {
            await this.waitForBatch();
          } else if (this.config.interval > 0) {
            await sleep(this.config.interval);
          }
        } catch (error) {
          logger.error('任务执行失败', error);
          item.reject(error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  destroy(): void {
    this.queue.forEach((item) => item.reject(new Error('任务队列已销毁')));
    this.queue = [];
    this.processing = false;
    this.taskCount = 0;
    toast.hideProgress();
    this.countdownToast = false;
    logger.info('任务队列已销毁');
  }

  async reload(): Promise<void> {
    this.config.batchSize = await appConfig.QUEST_BATCH_SIZE.get();
    this.config.interval = await appConfig.TASK_INTERVAL.get();
    this.config.batchDelay = await appConfig.BATCH_DELAY.get();
    logger.info('任务队列配置已刷新');
  }
}

export const taskQueue = new TaskQueue({
  interval: appConfig.TASK_INTERVAL.defaultValue,
  batchSize: appConfig.QUEST_BATCH_SIZE.defaultValue,
  batchDelay: appConfig.BATCH_DELAY.defaultValue,
});

// 初始化配置
(async () => {
  taskQueue.setBatchSize(await appConfig.QUEST_BATCH_SIZE.get());
  taskQueue.setInterval(await appConfig.TASK_INTERVAL.get());
  taskQueue.setBatchDelay(await appConfig.BATCH_DELAY.get());
})();
