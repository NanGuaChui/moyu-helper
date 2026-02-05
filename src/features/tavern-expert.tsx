/**
 * 酒馆专家管理器
 * 快速启用/禁用酒馆中的各类专家猫猫
 */

import { logger, toast, ws, dataCache } from '@/core';
import type { TavernExpert } from '@/types/game-data';

/**
 * 酒馆专家类型定义
 */
export interface TavernExpertType {
  id: string;
  name: string;
  shortName: string;
  icon: string;
}

/**
 * 可用的酒馆专家类型列表
 */
export const TAVERN_EXPERT_TYPES: TavernExpertType[] = [
  { id: 'teacherExpert', name: '老师猫猫', shortName: '老师', icon: '🧑' },
  { id: 'battleLogisticsExpert', name: '战场后勤猫猫', shortName: '后勤', icon: '⚔️' },
  { id: 'fitnessCoachCat', name: '健身教练猫猫', shortName: '教练', icon: '🏋️' },
  { id: 'extraExpExpert', name: '卷王助教喵', shortName: '卷王', icon: '🐟' },
  { id: 'enhanceExpert', name: '强化专家猫猫', shortName: '强化', icon: '✨' },
  { id: 'farmingAnimalExpert', name: '畜牧专家猫猫', shortName: '畜牧', icon: '🐮' },
  { id: 'baseMercenary', name: '见习雇佣兵猫猫', shortName: '雇佣兵', icon: '🪖' },
  { id: 'sewingExpert', name: '缝纫专家猫猫', shortName: '缝纫', icon: '🧵' },
  { id: 'fishingExpert', name: '钓鱼专家猫猫', shortName: '钓鱼', icon: '🎣' },
];

class TavernExpertManager {
  private loadingExperts: Set<string> = new Set();

  /**
   * 获取专家类型信息
   */
  getExpertType(expertId: string): TavernExpertType | undefined {
    return TAVERN_EXPERT_TYPES.find((e) => e.id === expertId);
  }

  /**
   * 切换指定专家的状态
   */
  async toggle(expertId: string): Promise<void> {
    if (this.loadingExperts.has(expertId)) {
      toast.warning('操作进行中，请稍候...');
      return;
    }

    const expertType = this.getExpertType(expertId);
    const expertName = expertType?.name || expertId;

    this.loadingExperts.add(expertId);

    try {
      const tavern: TavernExpert[] = await dataCache.getAsync('tavern');
      const expert = tavern.find((e) => e.type === expertId);

      if (!expert) {
        await ws.request('tavern:hireExpert', { catId: expertId, hours: 1 });
        toast.success(`✅ ${expertName}已启用`);
      } else if (expert.state === 'WORKING') {
        await ws.request('tavern:pause', { catId: expertId });
        toast.success(`✅ ${expertName}已暂停`);
      } else {
        const res = await ws.request('tavern:resume', { catId: expertId });

        // 检查结束时间
        if (res?.payload?.data?.record?.end_date) {
          const endTime = new Date(res.payload.data.record.end_date).getTime();
          const now = Date.now();
          const remainingMs = endTime - now;
          const remainingHours = remainingMs / (1000 * 60 * 60);

          if (remainingHours < 1) {
            const remainingMinutes = Math.floor(remainingMs / 60000);
            await ws.request('tavern:renewExpert', { catId: expertId, hours: 1 });
            toast.success(`✅ ${expertName}已恢复，剩余${remainingMinutes}分钟，已自动续约1小时`);
          } else {
            toast.success(`✅ ${expertName}已恢复`);
          }
        } else {
          toast.success(`✅ ${expertName}已恢复`);
        }
      }
      // 触发dataCache更新
      ws.emit('tavern:getMyExperts');
    } catch (error) {
      logger.error(`切换${expertName}状态失败`, error);
      toast.error('操作失败，请稍后重试');
    } finally {
      this.loadingExperts.delete(expertId);
    }
  }

  /**
   * 获取指定专家的按钮文本
   */
  async getButtonText(expertId: string): Promise<string> {
    const expertType = this.getExpertType(expertId);
    const icon = expertType?.icon || '🐱';
    const shortName = expertType?.shortName || expertType?.name || expertId;

    try {
      if (!dataCache.has('tavern')) return `${icon} ${shortName}`;

      const tavern = await dataCache.getAsync('tavern');
      const expert = tavern.find((e) => e.type === expertId);

      if (!expert) return `${icon} 启用${shortName}`;
      if (expert.state === 'WORKING') return `${icon} 暂停${shortName}`;
      return `${icon} 恢复${shortName}`;
    } catch {
      return `${icon} ${shortName}`;
    }
  }

  /**
   * 获取当前激活的酒馆专家列表
   */
  async getActiveExperts(): Promise<TavernExpert[]> {
    try {
      if (!dataCache.has('tavern')) return [];
      const tavern: TavernExpert[] = await dataCache.getAsync('tavern');
      return tavern.filter((e) => e.state === 'WORKING');
    } catch {
      return [];
    }
  }

  /**
   * 获取所有已雇佣的酒馆专家列表
   */
  async getAllExperts(): Promise<TavernExpert[]> {
    try {
      if (!dataCache.has('tavern')) return [];
      return await dataCache.getAsync('tavern');
    } catch {
      return [];
    }
  }

  /**
   * 显示当前酒馆状态通知
   */
  async showTavernStatus(): Promise<void> {
    try {
      const activeExperts = await this.getActiveExperts();

      if (activeExperts.length === 0) {
        toast.info('🏠 当前没有工作中的酒馆专家', 3000);
        return;
      }

      const activeNames = activeExperts
        .map((e) => {
          const type = this.getExpertType(e.type);
          return type ? `${type.icon}${type.name}` : e.type;
        })
        .join('、');

      toast.info(`🏠 工作中: ${activeNames}`, 5000);
    } catch (error) {
      logger.error('获取酒馆状态失败', error);
    }
  }
}

export const tavernExpertManager = new TavernExpertManager();
