/**
 * 任务管理器
 * 自动刷新和执行游戏任务
 */

import { toast, ws, logger, eventBus, EVENTS } from '@/core';
import { appConfig } from '@/config/gm-settings';
import { analytics, sleep } from '@/utils';

interface Quest {
  uuid: string;
  title: string;
  actionMainType: string;
  status: string;
  rerollCount: number;
  target: {
    actionId: string;
    count: number;
    current: number;
  };
}

interface QuestManagerConfig {
  goldLimit: number;
  selectedTasks: Record<string, Record<string, boolean>>;
  autoExecute: boolean;
  autoSubmit: boolean;
}

class QuestManager {
  private config: QuestManagerConfig = {
    goldLimit: appConfig.QUEST_GOLD_LIMIT.defaultValue,
    selectedTasks: {},
    autoExecute: appConfig.QUEST_AUTO_EXECUTE.defaultValue,
    autoSubmit: appConfig.QUEST_AUTO_SUBMIT.defaultValue,
  };

  async init(): Promise<void> {
    this.config.goldLimit = await appConfig.QUEST_GOLD_LIMIT.get();
    this.config.selectedTasks = await appConfig.QUEST_SELECTED_TASKS.get();
    this.config.autoExecute = await appConfig.QUEST_AUTO_EXECUTE.get();
    this.config.autoSubmit = await appConfig.QUEST_AUTO_SUBMIT.get();
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());

    if (this.config.autoSubmit) {
      await this.fetchAndCompleteQuests();
    }
  }

  private isValidQuest(quest: Quest): boolean {
    // 解析任务标题: "类型：任务名数量单位"
    const titleParts = quest.title.match(/^(\S+)：([^0-9]+?)(\d+)(\D+)$/);
    if (!titleParts) return false;

    const category = titleParts[1].trim();
    const subCategory = titleParts[2].trim();

    // 检查是否在选中的任务列表中
    if (this.config.selectedTasks[category]) {
      return this.config.selectedTasks[category][subCategory] === true;
    }

    return false;
  }

  private async fetchAndCompleteQuests(): Promise<Quest[]> {
    const res = await ws.sendAndListen('quest:list');
    let quests = res.payload.data || [];

    const completedCount = quests.filter((q) => q.status !== 'PENDING').length;
    if (completedCount > 0) {
      toast.progress(`📦 检测到 ${completedCount} 个已完成任务，正在提交...`);
      await this.completeAll();
      await sleep(2000);
      const res = await ws.sendAndListen('quest:list');
      quests = res.payload.data || [];
    }

    return quests;
  }

  async completeAll(): Promise<void> {
    const res = await ws.sendAndListen('quest:completeAll');
    const count = res.payload?.data?.completedCount || 0;
    if (count > 0) {
      toast.success(`✅ 已提交 ${count} 个任务`);
      logger.success(`已提交 ${count} 个任务`);
    }
  }

  private async rerollQuest(
    quest: Quest,
    onProgress?: (attempts: number) => void,
  ): Promise<{ quest: Quest; attempts: number }> {
    let current = quest;
    let attempts = 0;
    const maxAttempts = 50;

    while (!this.isValidQuest(current) && attempts < maxAttempts) {
      attempts++;
      onProgress?.(attempts);

      // 检查金币限制
      const goldAmount = (current.rerollCount + 1) * 250;
      if (goldAmount >= this.config.goldLimit) {
        logger.warn(`金币超过限制(${goldAmount} ≥ ${this.config.goldLimit})，停止刷新: ${current.title}`);
        break;
      }

      const res = await ws.sendAndListen('quest:reroll', { questUuid: current.uuid });
      const updated = res.payload?.data?.newQuest;

      if (!updated?.title) {
        logger.warn(`任务刷新失败，保留原任务: ${current.title}`);
        break;
      }

      current = updated;
    }

    if (attempts >= maxAttempts) {
      logger.warn(`任务刷新达到最大尝试次数: ${quest.title}`);
    }

    return { quest: current, attempts };
  }

  private deduplicateQuests(quests: Quest[]): Quest[] {
    const map = new Map<string, Quest>();

    quests.forEach((quest) => {
      const key = quest.target.actionId;
      const existing = map.get(key);

      // 保留 count 更大的任务
      if (!existing || quest.target.count > existing.target.count) {
        map.set(key, quest);
      }
    });

    return Array.from(map.values());
  }

  private async startQuests(quests: Quest[], onProgress?: (index: number, total: number) => void): Promise<void> {
    if (quests.length === 0) {
      logger.info('没有需要执行的任务');
      return;
    }

    for (let i = 0; i < quests.length; i++) {
      onProgress?.(i + 1, quests.length);
      await ws.sendAndWaitEvent(
        'task:immediatelyStart',
        {
          actionId: quests[i].target.actionId,
          repeatCount: quests[i].target.count,
          currentRepeat: 0,
          createTime: Date.now(),
        },
        'actionQueueUpdated',
      );
      // 不加这句会有重复的任务 不懂
      await sleep(1000);
    }

    toast.success(`✅ 已添加 ${quests.length} 个任务到执行队列`);
    logger.success(`已添加 ${quests.length} 个任务`);
  }

  private getValidUniqueQuests(quests: Quest[]): Quest[] {
    const validQuests = quests.filter((q) => q.status === 'PENDING' && this.isValidQuest(q));
    return this.deduplicateQuests(validQuests);
  }

  private async handleQuestExecution(uniqueQuests: Quest[]): Promise<void> {
    if (uniqueQuests.length === 0) {
      toast.hideProgress();
      toast.info('❌ 没有符合条件的任务');
      return;
    }

    if (this.config.autoExecute) {
      toast.progress(`⚡ 开始执行 ${uniqueQuests.length} 个任务...`);
      await this.startQuests(uniqueQuests, (index, total) => {
        toast.progress(`⚡ 正在添加任务 [${index}/${total}]`);
      });
      toast.hideProgress();
    } else {
      toast.hideProgress();
      toast.confirm(`任务刷新完成，共 ${uniqueQuests.length} 个任务待执行，是否立即执行？`, async () => {
        await this.startQuests(uniqueQuests, (index, total) => {
          toast.progress(`⚡ 正在添加任务 [${index}/${total}]`);
        });
        toast.hideProgress();
      });
    }
  }

  async refreshCards(): Promise<void> {
    await this.init();

    // 首次运行提示
    const isFirstRun = await appConfig.QUEST_FIRST_RUN.get();
    if (isFirstRun) {
      return new Promise((resolve) => {
        toast.confirm(
          `<strong>任务自动刷新说明</strong><br><br>
          • 自动提交已完成的任务<br>
          • 刷新不符合条件的任务（按任务类型筛选）<br>
          • 自动去重并添加到执行队列<br><br>
          <small>可在设置中修改筛选条件</small>`,
          async () => {
            await appConfig.QUEST_FIRST_RUN.set(false);
            await this.executeRefresh();
            resolve();
          },
        );
      });
    }

    await this.executeRefresh();
  }

  private async executeRefresh(): Promise<void> {
    toast.progress('🔄 正在获取任务列表...');

    try {
      const quests = await this.fetchAndCompleteQuests();
      toast.progress(`✅ 已获取 ${quests.length} 个任务`);
      await sleep(500);

      // 筛选需要刷新的任务
      const toReroll = quests.filter((q) => q.status === 'PENDING' && !this.isValidQuest(q));
      const validCount = quests.filter((q) => q.status === 'PENDING' && this.isValidQuest(q)).length;

      toast.progress(`📊 分析完成: ${validCount} 个符合条件, ${toReroll.length} 个需要刷新`);
      await sleep(500);

      // 如果不需要刷新，直接执行
      if (toReroll.length === 0) {
        const uniqueQuests = this.getValidUniqueQuests(quests);
        toast.progress(`🎯 准备执行 ${uniqueQuests.length} 个任务...`);
        await sleep(500);
        await this.handleQuestExecution(uniqueQuests);
        if (uniqueQuests.length > 0) {
          analytics.track('任务', 'refresh_quest', `${uniqueQuests.length}个`);
        }
        return;
      }

      // 刷新不符合条件的任务
      toast.progress(`🔄 开始刷新 ${toReroll.length} 个任务...`);
      await sleep(500);

      for (let i = 0; i < toReroll.length; i++) {
        const questIndex = quests.findIndex((q) => q.uuid === toReroll[i].uuid);
        toast.progress(`🎲 [${i + 1}/${toReroll.length}] 正在刷新: ${toReroll[i].title}`);

        const { attempts, quest } = await this.rerollQuest(toReroll[i], (attempts) => {
          toast.progress(`🎲 [${i + 1}/${toReroll.length}] 刷新中: ${toReroll[i].title} (第${attempts}次)`);
        });

        quests[questIndex] = quest;
        const status = this.isValidQuest(quest) ? '✅ 成功' : '⚠️ 已达限制';
        toast.progress(`${status} [${i + 1}/${toReroll.length}] ${quest.title} (共${attempts}次)`);
        await sleep(1000);
      }

      const uniqueQuests = this.getValidUniqueQuests(quests);
      toast.progress(`🎯 刷新完成，准备执行 ${uniqueQuests.length} 个任务...`);
      await sleep(500);

      await this.handleQuestExecution(uniqueQuests);
      if (uniqueQuests.length > 0) {
        analytics.track('任务', 'refresh_quest', `${uniqueQuests.length}个`);
      }
    } catch (error) {
      logger.error('任务处理失败', error);
      toast.hideProgress();
      toast.error('任务处理失败，请稍后重试');
    }
  }

  async setGoldLimit(limit: number): Promise<void> {
    this.config.goldLimit = limit;
    await appConfig.QUEST_GOLD_LIMIT.set(limit);
    logger.info(`任务刷新金币限制已设置为: ${limit}`);
  }

  async setSelectedTasks(tasks: Record<string, Record<string, boolean>>): Promise<void> {
    this.config.selectedTasks = tasks;
    await appConfig.QUEST_SELECTED_TASKS.set(tasks);
    logger.info('任务选择已更新');
  }

  async reload(): Promise<void> {
    this.config.goldLimit = await appConfig.QUEST_GOLD_LIMIT.get();
    this.config.selectedTasks = await appConfig.QUEST_SELECTED_TASKS.get();
    this.config.autoExecute = await appConfig.QUEST_AUTO_EXECUTE.get();
    this.config.autoSubmit = await appConfig.QUEST_AUTO_SUBMIT.get();
    logger.info('任务管理配置已刷新');
  }
}

export const questManager = new QuestManager();
