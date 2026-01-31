/**
 * 任务管理器
 * 自动刷新和执行游戏任务
 */

import { toast, ws, logger, eventBus, EVENTS } from '@/core';
import { appConfig } from '@/config/gm-settings';
import { analytics } from '@/utils';

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
}

class QuestManager {
  private config: QuestManagerConfig = {
    goldLimit: appConfig.QUEST_GOLD_LIMIT.defaultValue,
    selectedTasks: {},
    autoExecute: appConfig.QUEST_AUTO_EXECUTE.defaultValue,
  };

  async init(): Promise<void> {
    this.config.goldLimit = await appConfig.QUEST_GOLD_LIMIT.get();
    this.config.selectedTasks = await appConfig.QUEST_SELECTED_TASKS.get();
    this.config.autoExecute = await appConfig.QUEST_AUTO_EXECUTE.get();
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
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

  private async fetchQuests(): Promise<Quest[]> {
    logger.debug('开始获取任务列表...');
    const res = await ws.sendAndListen('quest:list');
    logger.debug('任务列表响应:', res);
    return res.payload.data || [];
  }

  private async completeAllQuests(quests: Quest[]): Promise<Quest[]> {
    const hasCompletedQuests = quests.some((q) => q.status !== 'PENDING');
    if (hasCompletedQuests) {
      await ws.send('quest:completeAll');
      await new Promise((r) => setTimeout(r, 2000));
      return this.fetchQuests();
    }
    return quests;
  }

  private async rerollQuest(quest: Quest): Promise<Quest> {
    let current = quest;
    let attempts = 0;
    const maxAttempts = 50;

    while (!this.isValidQuest(current) && attempts < maxAttempts) {
      attempts++;

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

    return current;
  }

  private deduplicateQuests(quests: Quest[]): Quest[] {
    const map = new Map<string, Quest>();

    quests.forEach((quest) => {
      // 解析任务标题: "类型：任务名数量单位"
      const titleParts = quest.title.match(/^(\S+)：([^0-9]+?)(\d+)(\D+)$/);
      if (!titleParts) return;

      const category = titleParts[1].trim().replace(' ', '');
      const subCategory = titleParts[2].trim().replace(' ', '');
      // 使用 类型-任务名 作为唯一键
      const key = `${category}-${subCategory}`;

      const existing = map.get(key);

      // 保留 count 更大的任务
      if (!existing || quest.target.count > existing.target.count) {
        map.set(key, quest);
      }
    });

    return Array.from(map.values());
  }

  private async startQuests(quests: Quest[]): Promise<void> {
    if (quests.length === 0) {
      logger.info('没有需要执行的任务');
      return;
    }

    for (const quest of quests) {
      await ws.send('task:immediatelyStart', {
        actionId: quest.target.actionId,
        repeatCount: quest.target.count,
        currentRepeat: 0,
        createTime: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 2000));
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
      toast.info('没有符合条件的任务');
      return;
    }

    if (this.config.autoExecute) {
      toast.progress('开始执行任务...');
      await this.startQuests(uniqueQuests);
      toast.hideProgress();
    } else {
      toast.hideProgress();
      toast.confirm(
        `任务刷新完成，共 ${uniqueQuests.length} 个任务待执行，是否立即执行？`,
        async () => {
          await this.startQuests(uniqueQuests);
        },
      );
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
    const progress = toast.progress('正在获取任务列表...');

    try {
      let quests = await this.fetchQuests();

      // 提交已完成的任务
      if (quests.some((q) => q.status !== 'PENDING')) {
        progress.update('检测到已完成任务，正在提交...');
        quests = await this.completeAllQuests(quests);
      }

      // 筛选需要刷新的任务
      const toReroll = quests.filter((q) => q.status === 'PENDING' && !this.isValidQuest(q));

      // 如果不需要刷新，直接执行
      if (toReroll.length === 0) {
        const uniqueQuests = this.getValidUniqueQuests(quests);
        await this.handleQuestExecution(uniqueQuests);
        if (uniqueQuests.length > 0) {
          analytics.track('任务', 'refresh_quest', `${uniqueQuests.length}个`);
        }
        return;
      }

      // 刷新不符合条件的任务
      progress.update(`需要刷新 ${toReroll.length} 个任务`);
      for (let i = 0; i < toReroll.length; i++) {
        progress.update(`[${i + 1}/${toReroll.length}] 刷新中: ${toReroll[i].title}`);
        await this.rerollQuest(toReroll[i]);
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 获取最终任务列表并执行
      const finalQuests = await this.fetchQuests();
      const uniqueQuests = this.getValidUniqueQuests(finalQuests);
      await this.handleQuestExecution(uniqueQuests);
      if (uniqueQuests.length > 0) {
        analytics.track('任务', 'refresh_quest', `${uniqueQuests.length}个`);
      }
    } catch (error) {
      logger.error('任务处理失败', error);
      progress.hide();
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
    logger.info('任务管理配置已刷新');
  }
}

export const questManager = new QuestManager();
