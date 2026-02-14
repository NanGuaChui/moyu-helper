/**
 * 饱食度管理器
 * 自动监控饱食度和猫咪心情并使用食物
 */

import { toast, dataCache, ws, eventBus, EVENTS, BaseFeature, createLogger } from '@/core';

const logger = createLogger('SatietyManager');
import { getWsErrorMessage } from '@/utils';
import { type FoodType } from '@/config/defaults';
import { appConfig } from '@/config/gm-settings';

// 宠物数据接口
interface Kitty {
  uuid: string;
  name: string;
  mood: number; // 心情
}

class SatietyManager extends BaseFeature {
  private isChecking = false;
  private enabled = false;
  private kittyFeedEnabled = false;
  private foodType: FoodType = 'berry';
  private kittyFeedFoodType: 'luxuryCatFood' | 'catMint' = 'luxuryCatFood';
  private kittyCheckTimer: NodeJS.Timeout | null = null;

  protected async onInit(): Promise<void> {
    this.enabled = await appConfig.AUTO_USE_BERRY_ENABLED.get();
    this.foodType = await appConfig.AUTO_USE_BERRY_FOOD_TYPE.get();
    this.kittyFeedEnabled = await appConfig.KITTY_FEED_ENABLED.get();
    this.kittyFeedFoodType = await appConfig.KITTY_FEED_FOOD_TYPE.get();

    ws.once('dispatchInventoryInfo', () => {
      setTimeout(() => this.checkAndUseFood(), 1000);
      setTimeout(() => this.checkKittyMood(), 1000);
    });

    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
    logger.success('饱食度管理器初始化完成');
  }

  protected async onReload(): Promise<void> {
    this.enabled = await appConfig.AUTO_USE_BERRY_ENABLED.get();
    this.foodType = await appConfig.AUTO_USE_BERRY_FOOD_TYPE.get();
    this.kittyFeedEnabled = await appConfig.KITTY_FEED_ENABLED.get();
    this.kittyFeedFoodType = await appConfig.KITTY_FEED_FOOD_TYPE.get();
    logger.info('饱食度管理配置已刷新');
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

  private async checkKittyMood(): Promise<void> {
    if (!this.kittyFeedEnabled) return;

    // 防抖：1秒内只检查一次
    if (this.kittyCheckTimer) {
      clearTimeout(this.kittyCheckTimer);
    }

    this.kittyCheckTimer = setTimeout(async () => {
      try {
        const userInfo = await dataCache.getAsync('userInfo');
        const kitties = (userInfo.kittyInfo || []) as Kitty[];

        if (!Array.isArray(kitties) || kitties.length === 0) {
          return;
        }

        const moodThreshold = await appConfig.KITTY_FEED_MOOD_THRESHOLD.get();

        for (const kitty of kitties) {
          if (kitty.mood < moodThreshold) {
            await this.feedKitty(kitty, moodThreshold);
          }
        }
      } catch (error) {
        logger.error('检查宠物心情失败', error);
      } finally {
        this.kittyCheckTimer = null;
      }
    }, 1000);
  }

  private async feedKitty(kitty: Kitty, moodThreshold: number): Promise<void> {
    try {
      // 每次喂食增加的心情值
      const moodGainPerFeed = this.kittyFeedFoodType === 'luxuryCatFood' ? 8 : 3;

      // 计算需要喂食的数量
      const needed = Math.ceil((moodThreshold - kitty.mood) / moodGainPerFeed);
      const count = Math.max(1, needed);

      await ws.request('kitty:feed', {
        kittyUuid: kitty.uuid,
        resourceId: this.kittyFeedFoodType,
        count,
      });

      const foodName = this.kittyFeedFoodType === 'luxuryCatFood' ? '豪华猫粮' : '猫咪零食';
      const expectedMood = kitty.mood + count * moodGainPerFeed;
      logger.info(
        `宠物 ${kitty.name} 已喂食 ${count} 个${foodName}，当前心情: ${kitty.mood}，预期心情: ${expectedMood}`,
      );
      toast.success(`✅ 已为 ${kitty.name} 喂食 ${count} 个${foodName}，预期心情: ${expectedMood}`);
    } catch (error) {
      logger.error(`宠物 ${kitty.name} 喂食失败`, error);
      toast.error(getWsErrorMessage(error, `宠物 ${kitty.name} 喂食失败`));
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getFoodType(): FoodType {
    return this.foodType;
  }

  isKittyFeedEnabled(): boolean {
    return this.kittyFeedEnabled;
  }

  getKittyFeedFoodType(): 'luxuryCatFood' | 'catMint' {
    return this.kittyFeedFoodType;
  }
}

export const satietyManager = new SatietyManager();
