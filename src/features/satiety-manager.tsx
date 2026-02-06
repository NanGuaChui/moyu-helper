/**
 * 饱食度管理器
 * 自动监控饱食度并使用食物
 */

import { logger, toast, dataCache, ws, eventBus, EVENTS } from '@/core';
import { getWsErrorMessage } from '@/utils';
import { type FoodType } from '@/config/defaults';
import { appConfig } from '@/config/gm-settings';

class SatietyManager {
  private isInitialized = false;
  private isChecking = false;
  private enabled = false;
  private foodType: FoodType = 'berry';

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.enabled = await appConfig.AUTO_USE_BERRY_ENABLED.get();
    this.foodType = await appConfig.AUTO_USE_BERRY_FOOD_TYPE.get();

    ws.once('dispatchInventoryInfo', () => {
      setTimeout(() => this.checkAndUseFood(), 1000);
    });

    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());

    this.isInitialized = true;
    logger.success('饱食度管理器初始化完成');
  }

  private async checkAndUseFood(): Promise<void> {
    if (this.isChecking || !this.enabled) return;
    this.isChecking = true;

    try {
      const currentSatiety = await dataCache.getItemCountAsync('__satiety');

      const threshold = await appConfig.AUTO_USE_BERRY_THRESHOLD.get();
      const target = await appConfig.AUTO_USE_BERRY_TARGET.get();

      if (currentSatiety < threshold) {
        let remaining = target - currentSatiety;
        let totalUsed = 0;

        while (remaining > 0) {
          const useAmount = Math.min(remaining, 100000);
          await ws.request('effectAction:useItem', { itemId: this.foodType, multiple: useAmount });
          totalUsed += useAmount;
          remaining -= useAmount;
        }

        const foodName = this.foodType === 'berry' ? '浆果' : this.foodType === 'fish' ? '鱼' : '豪华猫粮';
        logger.info(`当前饱食度: ${currentSatiety}, 已使用${foodName}: ${totalUsed}`);
        toast.success(`✅ 已使用 ${totalUsed} ${foodName}`);
      }
    } catch (error) {
      logger.error('检查饱食度失败', error);
      toast.error(getWsErrorMessage(error, '检查饱食度失败'));
    } finally {
      this.isChecking = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getFoodType(): FoodType {
    return this.foodType;
  }

  async reload(): Promise<void> {
    this.enabled = await appConfig.AUTO_USE_BERRY_ENABLED.get();
    this.foodType = await appConfig.AUTO_USE_BERRY_FOOD_TYPE.get();
    logger.info('饱食度管理配置已刷新');
  }
}

export const satietyManager = new SatietyManager();
