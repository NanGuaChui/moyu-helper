/**
 * 酒馆专家管理器
 * 快速启用/禁用强化专家猫猫
 */

import { logger, toast, ws, dataCache } from '@/core';
import type { TavernExpert } from '@/types/game-data';

class TavernExpertManager {
  private isLoading = false;

  async toggle(): Promise<void> {
    if (this.isLoading) {
      toast.warning('操作进行中，请稍候...');
      return;
    }

    this.isLoading = true;

    try {
      const tavern: TavernExpert[] = await dataCache.getAsync('tavern');
      const enhanceExpert = tavern.find((expert) => expert.type === 'enhanceExpert');

      if (!enhanceExpert) {
        await ws.request('tavern:hireExpert', { catId: 'enhanceExpert', hours: 1 });
        toast.success('✅ 强化专家已启用');
      } else if (enhanceExpert.state === 'WORKING') {
        await ws.request('tavern:pause', { catId: 'enhanceExpert' });
        toast.success('✅ 强化专家已暂停');
      } else {
        const res = await ws.request('tavern:resume', { catId: 'enhanceExpert' });

        // 检查结束时间
        if (res?.payload?.data?.record?.end_date) {
          const endTime = new Date(res.payload.data.record.end_date).getTime();
          const now = Date.now();
          const remainingMs = endTime - now;
          const remainingHours = remainingMs / (1000 * 60 * 60);

          if (remainingHours < 1) {
            const remainingMinutes = Math.floor(remainingMs / 60000);
            await ws.request('tavern:renewExpert', { catId: 'enhanceExpert', hours: 1 });
            toast.success(`✅ 强化专家已恢复，剩余${remainingMinutes}分钟，已自动续约1小时`);
          } else {
            toast.success('✅ 强化专家已恢复');
          }
        } else {
          toast.success('✅ 强化专家已恢复');
        }
      }
      // 触发dataCache更新
      ws.emit('tavern:getMyExperts');
    } catch (error) {
      logger.error('切换强化专家状态失败', error);
      toast.error('操作失败，请稍后重试');
    } finally {
      this.isLoading = false;
    }
  }

  async getButtonText(): Promise<string> {
    try {
      if (!dataCache.has('tavern')) return '⚒️ 强化专家';

      const tavern = await dataCache.getAsync('tavern');
      const enhanceExpert = tavern.find((expert) => expert.type === 'enhanceExpert');

      if (!enhanceExpert) return '⚒️ 启用强化';
      if (enhanceExpert.state === 'WORKING') return '⚒️ 暂停强化';
      return '⚒️ 恢复强化';
    } catch {
      return '⚒️ 强化专家';
    }
  }
}

export const tavernExpertManager = new TavernExpertManager();
