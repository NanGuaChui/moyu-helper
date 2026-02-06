/**
 * 战斗防掉线模块
 * 自动禁用战斗功能，防止因战斗导致的连接问题
 */

import { ws, eventBus, EVENTS } from '@/core';
import { logger } from '@/core/logger';
import { appConfig } from '@/config/gm-settings';

interface BattleGuardConfig {
  maxRetries: number;
  retryDelay: number;
}

const DEFAULT_CONFIG: BattleGuardConfig = {
  maxRetries: 5,
  retryDelay: 2000,
};

class BattleGuard {
  private retryCount = 0;
  private isMessageSent = false;
  private config: BattleGuardConfig = DEFAULT_CONFIG;

  /**
   * 初始化战斗防护
   */
  init(): void {
    logger.info('[战斗防护] 初始化');

    // 监听 WebSocket 连接状态
    this.setupListeners();

    // 延迟发送禁用消息
    setTimeout(() => this.trySendDisableMessage(), 1500);

    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
  }

  /**
   * 设置监听器
   */
  private setupListeners(): void {
    // 监听战斗相关消息
    ws.on('msgPref:battle:set', (data) => {
      const enable = data.payload?.data?.enable;
      if (enable === true) {
        logger.warn('[战斗防护] 检测到战斗被启用，重新禁用');
        this.isMessageSent = false;
        setTimeout(() => this.trySendDisableMessage(), 1000);
      }
    });
  }

  /**
   * 尝试发送禁用消息
   */
  private async trySendDisableMessage(): Promise<void> {
    if (this.isMessageSent) {
      return;
    }

    if (this.retryCount >= this.config.maxRetries) {
      logger.error('[战斗防护] 达到最大重试次数');
      return;
    }

    this.retryCount++;
    logger.info(`[战斗防护] 尝试禁用战斗 (第${this.retryCount}次)`);

    try {
      await ws.emit('msgPref:battle:set', { enable: false });
      logger.success('[战斗防护] 战斗已禁用');
      this.isMessageSent = true;
      this.retryCount = 0;
    } catch {
      logger.warn('[战斗防护] 发送失败，等待重试');
      setTimeout(() => this.trySendDisableMessage(), this.config.retryDelay);
    }
  }

  /**
   * 销毁/重置状态
   */
  destroy(): void {
    this.isMessageSent = false;
    this.retryCount = 0;
    logger.info('[战斗防护] 已销毁');
  }

  async reload(): Promise<void> {
    const enabled = await appConfig.BATTLE_GUARD_ENABLED.get();
    if (enabled && !this.isMessageSent) {
      setTimeout(() => this.trySendDisableMessage(), 500);
    }
    logger.info('[战斗防护] 配置已刷新');
  }
}

export const battleGuard = new BattleGuard();
