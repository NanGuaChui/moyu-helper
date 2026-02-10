/**
 * 任务管理器
 * 自动刷新和执行游戏任务
 */

import { toast, ws, eventBus, EVENTS, BaseFeature, createLogger } from '@/core';

const logger = createLogger('Quest');
import { getWsErrorMessage } from '@/utils';
import { appConfig } from '@/config/gm-settings';
import { sleep } from '@/utils';

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

class QuestManager extends BaseFeature {
  private config: QuestManagerConfig = {
    goldLimit: appConfig.QUEST_GOLD_LIMIT.defaultValue,
    selectedTasks: {},
    autoExecute: appConfig.QUEST_AUTO_EXECUTE.defaultValue,
    autoSubmit: appConfig.QUEST_AUTO_SUBMIT.defaultValue,
  };

  protected async onInit(): Promise<void> {
    this.config.goldLimit = await appConfig.QUEST_GOLD_LIMIT.get();
    this.config.selectedTasks = await appConfig.QUEST_SELECTED_TASKS.get();
    this.config.autoExecute = await appConfig.QUEST_AUTO_EXECUTE.get();
    this.config.autoSubmit = await appConfig.QUEST_AUTO_SUBMIT.get();
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());

    if (this.config.autoSubmit) {
      setTimeout(async () => await this.fetchAndCompleteQuests(false), 3000);
    }
  }

  protected async onReload(): Promise<void> {
    this.config.goldLimit = await appConfig.QUEST_GOLD_LIMIT.get();
    this.config.selectedTasks = await appConfig.QUEST_SELECTED_TASKS.get();
    this.config.autoExecute = await appConfig.QUEST_AUTO_EXECUTE.get();
    this.config.autoSubmit = await appConfig.QUEST_AUTO_SUBMIT.get();
    logger.info('任务管理配置已刷新');
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

  private async fetchAndCompleteQuests(returnUpdatedList = true): Promise<Quest[]> {
    try {
      const res = await ws.request('quest:list');
      let quests = res.payload.data || [];

      const completedCount = quests.filter((q) => q.status === 'DONE').length;
      if (completedCount > 0) {
        toast.progress(`📦 检测到 ${completedCount} 个已完成任务，正在提交...`, 'quest');
        await sleep(1000);
        await this.completeAll();
        toast.hideProgress('quest');
        await sleep(1000);
        if (returnUpdatedList) {
          const res = await ws.request('quest:list');
          quests = res.payload.data || [];
        }
      }

      return quests;
    } catch (error) {
      logger.error('获取任务列表失败', error);
      toast.error(getWsErrorMessage(error, '获取任务列表超时，请稍后重试'));
      throw error;
    }
  }

  async completeAll(): Promise<void> {
    await ws.request('quest:completeAll');
    toast.success(`✅ 提交任务完成`);
    logger.success(`已提交任务完成`);
  }

  private async rerollQuest(
    quest: Quest,
    onProgress?: (attempts: number, quest: Quest) => void,
  ): Promise<{ quest: Quest; attempts: number }> {
    let current = quest;
    let attempts = 0;
    const maxAttempts = 50;

    while (!this.isValidQuest(current) && attempts < maxAttempts) {
      attempts++;
      onProgress?.(attempts, current);

      // 检查金币限制
      const goldAmount = (current.rerollCount + 1) * 250;
      if (goldAmount >= this.config.goldLimit) {
        logger.warn(`金币超过限制(${goldAmount} ≥ ${this.config.goldLimit})，停止刷新: ${current.title}`);
        break;
      }

      const res = await ws.request('quest:reroll', { questUuid: current.uuid });
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
      try {
        const waitPromise = eventBus.waitFor('actionQueueUpdated');
        await ws.emit('task:immediatelyStart', {
          actionId: quests[i].target.actionId,
          repeatCount: quests[i].target.count,
          currentRepeat: 0,
          createTime: Date.now(),
        });
        await waitPromise;
        // 不加这句会有重复的任务 不懂
        await sleep(1000);
      } catch (error) {
        logger.error(`添加任务失败: ${quests[i].target.actionId}`, error);
        // 继续执行下一个任务
      }
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
      toast.hideProgress('quest');
      toast.info('❌ 没有符合条件的任务');
      return;
    }

    if (this.config.autoExecute) {
      toast.progress(`⚡ 开始执行 ${uniqueQuests.length} 个任务...`, 'quest');
      await this.startQuests(uniqueQuests, (index, total) => {
        toast.progress(`⚡ 正在添加任务 [${index}/${total}]`, 'quest');
      });
      toast.hideProgress('quest');
    } else {
      toast.hideProgress('quest');
      const confirmed = await toast.confirm(`任务刷新完成，共 ${uniqueQuests.length} 个任务待执行，是否立即执行？`);
      if (confirmed) {
        await this.startQuests(uniqueQuests, (index, total) => {
          toast.progress(`⚡ 正在添加任务 [${index}/${total}]`, 'quest');
        });
        toast.hideProgress('quest');
      }
    }
  }

  async refreshCards(): Promise<void> {
    if (this.isRunning) {
      toast.warning('任务刷新进行中');
      return;
    }

    await this.executeRefresh();
  }

  private async executeRefresh(): Promise<void> {
    this._running.value = true;
    toast.progress('🔄 正在获取任务列表...', 'quest');

    try {
      const quests = await this.fetchAndCompleteQuests();
      toast.progress(`✅ 已获取 ${quests.length} 个任务`, 'quest');
      await sleep(500);

      // 筛选需要刷新的任务
      const toReroll = quests.filter((q) => q.status === 'PENDING' && !this.isValidQuest(q));
      const validCount = quests.filter((q) => q.status === 'PENDING' && this.isValidQuest(q)).length;

      toast.progress(`📊 分析完成: ${validCount} 个符合条件, ${toReroll.length} 个需要刷新`, 'quest');
      await sleep(500);

      // 如果不需要刷新，直接执行
      if (toReroll.length === 0) {
        const uniqueQuests = this.getValidUniqueQuests(quests);
        toast.progress(`🎯 准备执行 ${uniqueQuests.length} 个任务...`, 'quest');
        await sleep(500);
        await this.handleQuestExecution(uniqueQuests);
        return;
      }

      // 刷新不符合条件的任务
      toast.progress(`🔄 开始刷新 ${toReroll.length} 个任务...`, 'quest');
      await sleep(500);

      for (let i = 0; i < toReroll.length; i++) {
        const questIndex = quests.findIndex((q) => q.uuid === toReroll[i].uuid);
        toast.progress(`🎲 [${i + 1}/${toReroll.length}] 正在刷新: ${toReroll[i].title}`, 'quest');

        const { attempts, quest } = await this.rerollQuest(toReroll[i], (attempts, quest) => {
          toast.progress(`🎲 [${i + 1}/${toReroll.length}] [第${attempts}次] ${quest.title}`, 'quest');
        });

        quests[questIndex] = quest;
        const status = this.isValidQuest(quest) ? '✅' : '⚠️';
        toast.progress(`${status} [${i + 1}/${toReroll.length}] [共${attempts}次] ${quest.title}`, 'quest');
        await sleep(1000);
      }

      const uniqueQuests = this.getValidUniqueQuests(quests);
      toast.progress(`🎯 刷新完成，准备执行 ${uniqueQuests.length} 个任务...`, 'quest');
      await sleep(500);

      await this.handleQuestExecution(uniqueQuests);
    } catch (error) {
      logger.error('任务处理失败', error);
      toast.hideProgress('quest');
      toast.error(getWsErrorMessage(error, '任务处理失败，请稍后重试'));
    } finally {
      this._running.value = false;
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
}

export const questManager = new QuestManager();
