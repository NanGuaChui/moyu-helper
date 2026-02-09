/**
 * 制造功能模块
 * 包含制造管理器和制造面板
 */

import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import DEFAULT_CRAFT_ITEMS from '@/config/craft-items.json';
import { toast, ws, dataCache, eventBus, BaseFeature, createLogger } from '@/core';
const logger = createLogger('Craft');
import type { CraftItem, CraftItemCategory } from '@/types';
import { Card, FormGroup, Select, Input, Checkbox, Button, Row } from '@/ui/components';
import { BasePanel } from '@/ui/base-panel';
import { debounce, throttle, getWsErrorMessage } from '@/utils';
import { appConfig } from '@/config/gm-settings';

interface CraftStep {
  name: string;
  actionId: string;
  count: number;
}

/** 制造计划条目 */
interface PlanEntry {
  actionId: string;
  count: number;
}

/** 单个物品的制造计划（含依赖和缺失资源） */
interface PlanItemDetail {
  actionId: string;
  count: number;
  label: string;
  steps: CraftStep[];
  missingResources: Array<{ itemId: string; need: number; stock: number }>;
}

/** 构建任务数据对象 */
function buildTaskData(step: CraftStep) {
  return {
    actionId: step.actionId,
    repeatCount: step.count,
    currentRepeat: 0,
    createTime: Date.now(),
  };
}

/** 添加制造任务到队列的公共函数 */
async function addTasksToQueue(tasks: CraftStep[], kittyUuid?: string): Promise<void> {
  for (let i = 0; i < tasks.length; i++) {
    const step = tasks[i];
    toast.progress(`正在添加 ${step.name} ×${step.count} (${i + 1}/${tasks.length})`, 'craft');

    if (kittyUuid) {
      await ws.request('kitty:addTask', {
        kittyUuid,
        task: buildTaskData(step),
      });
    } else {
      const waitPromise = eventBus.waitFor('actionQueueUpdated');
      await ws.emit('addTaskToQueue', buildTaskData(step));
      await waitPromise;
    }
  }
}


// ==================== 制造管理器 ====================

class CraftManager extends BaseFeature {
  private categories: CraftItemCategory[] = DEFAULT_CRAFT_ITEMS;

  protected onInit(): void {
    logger.info('制造管理器初始化完成');
  }

  protected onReload(): void {
    // 制造管理器没有配置项需要重载
  }

  /** 获取物品中文名称 */
  getItemName(itemId: string): string {
    // 从 craft-items 的 rewards 中查找
    for (const category of this.categories) {
      for (const item of category.items) {
        for (const reward of item.rewards) {
          if (reward.itemId === itemId && reward.label) {
            return reward.label;
          }
        }
      }
    }

    // 从 craft-items 的 dependencies 中查找
    for (const category of this.categories) {
      for (const item of category.items) {
        if (item.dependencies) {
          for (const dep of item.dependencies) {
            if (dep.itemId === itemId && dep.label) {
              return dep.label;
            }
          }
        }
      }
    }

    // 备选：返回 itemId
    return itemId;
  }

  /** 获取物品标签名 */
  getItemLabel(actionId: string): string {
    const item = this.findByActionId(actionId);
    return item?.label || actionId;
  }

  getCraftCategories(): CraftItemCategory[] {
    return this.categories;
  }

  getCraftItems(): CraftItem[] {
    return this.categories.flatMap((category) => category.items);
  }

  private findByActionId(actionId: string): CraftItem | undefined {
    for (const category of this.categories) {
      const item = category.items.find((item) => item.actionId === actionId);
      if (item) return item;
    }
    return undefined;
  }

  private findByRewardId(rewardId: string): CraftItem | undefined {
    const candidates: CraftItem[] = [];
    for (const category of this.categories) {
      for (const item of category.items) {
        if (item.rewards.some((r) => r.itemId === rewardId)) {
          candidates.push(item);
        }
      }
    }

    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    const basicResources = new Set(['berry', 'fish', 'wood', 'stone', 'coal', 'treasureMap']);

    const countNonBasicDeps = (item: CraftItem): number => {
      if (!item.dependencies) return 0;
      return item.dependencies.filter((dep) => !basicResources.has(dep.itemId)).length;
    };

    const best = candidates.reduce((best, current) =>
      countNonBasicDeps(current) < countNonBasicDeps(best) ? current : best,
    );
    return best;
  }

  isBannedForKitty(actionId: string): boolean {
    const item = this.findByActionId(actionId);
    return item?.banToKitty === true;
  }
  /** 根据产出物品ID查找可制造的物品，返回 actionId、label 和单次产出数量 */
  findCraftableByRewardId(rewardId: string): { actionId: string; label: string; rewardCount: number } | null {
    const item = this.findByRewardId(rewardId);
    if (!item) return null;
    const reward = item.rewards.find((r) => r.itemId === rewardId);
    return { actionId: item.actionId, label: item.label, rewardCount: reward?.count || 1 };
  }

  /** 检查整个计划列表中是否有任何物品被禁止猫咪制造 */
  hasKittyBannedItem(entries: PlanEntry[]): boolean {
    return entries.some((e) => this.isBannedForKitty(e.actionId));
  }

  buildPlan(actionId: string, targetCount: number): CraftStep[] {
    const item = this.findByActionId(actionId);
    if (!item) {
      toast.error('未找到制造配方');
      return [];
    }

    const needs = new Map<string, number>();
    const plan: CraftStep[] = [];
    const calculating = new Set<string>();

    const calculate = (id: string, count: number) => {
      if (calculating.has(id)) return;  // 防止循环依赖
      calculating.add(id);

      const current = this.findByActionId(id);
      if (!current) return;

      // 累加需求量，因为同一配方可能被多个地方需要
      needs.set(id, (needs.get(id) || 0) + count);

      // 收集所有依赖的生产者及其需求次数
      const producerRequests = new Map<string, number>();
      if (current.dependencies) {
        for (const dep of current.dependencies) {
          const producer = this.findByRewardId(dep.itemId);
          if (producer) {
            const reward = producer.rewards.find((r) => r.itemId === dep.itemId)!;
            const times = Math.ceil((dep.count * count) / reward.count);
            // 同一生产者的多个依赖，取最大次数
            producerRequests.set(
              producer.actionId,
              Math.max(producerRequests.get(producer.actionId) || 0, times)
            );
          }
        }
      }

      // 递归计算所有生产者
      for (const [producerId, producerCount] of producerRequests) {
        calculate(producerId, producerCount);
      }

      calculating.delete(id);  // 允许从其他路径再次访问
    };

    const sort = (id: string) => {
      const current = this.findByActionId(id);
      if (!current || plan.some((p) => p.actionId === id)) return;

      if (current.dependencies) {
        for (const dep of current.dependencies) {
          const producer = this.findByRewardId(dep.itemId);
          if (producer) sort(producer.actionId);
        }
      }

      const count = needs.get(id) || 0;
      if (count > 0) {
        plan.push({ name: current.label, actionId: id, count });
      }
    };

    calculate(actionId, targetCount);
    sort(actionId);

    return plan;
  }

  async optimizePlan(plan: CraftStep[], targetActionId: string): Promise<{
    optimized: CraftStep[];
    missingResources: Array<{ itemId: string; need: number; stock: number }>;
  }> {
    try {
      const optimized: CraftStep[] = [];
      const resourceNeeds = new Map<string, number>();
      const missingResources: Array<{ itemId: string; need: number; stock: number }> = [];

      for (let i = plan.length - 1; i >= 0; i--) {
        const step = plan[i];
        const item = this.findByActionId(step.actionId);
        if (!item) continue;

        let count = step.count;

        // 目标物品始终制造，不检查库存和产出
        if (step.actionId === targetActionId) {
          optimized.unshift({ ...step, count });
          if (item.dependencies) {
            for (const dep of item.dependencies) {
              const need = dep.count * count;
              resourceNeeds.set(dep.itemId, (resourceNeeds.get(dep.itemId) || 0) + need);

              // 检查依赖品是否有库存
              const stock = await dataCache.getItemCountAsync(dep.itemId);
              const currentNeed = resourceNeeds.get(dep.itemId) || 0;
              if (stock < currentNeed) {
                const existing = missingResources.find(m => m.itemId === dep.itemId);
                if (existing) {
                  existing.need = Math.max(existing.need, currentNeed);
                } else {
                  missingResources.push({ itemId: dep.itemId, need: currentNeed, stock });
                }
              }
            }
          }
          continue;
        }

        // 依赖项需要检查产出和库存
        let maxCount = 0;
        for (const reward of item.rewards) {
          const stock = await dataCache.getItemCountAsync(reward.itemId);
          const need = resourceNeeds.get(reward.itemId) || 0;
          const netNeed = Math.max(0, need - stock);
          const requiredCount = Math.ceil(netNeed / reward.count);
          maxCount = Math.max(maxCount, requiredCount);
        }

        count = maxCount;

        if (count <= 0) {
          logger.info(`跳过 ${step.name}（库存充足）`);
          continue;
        }

        optimized.unshift({ ...step, count });

        if (item.dependencies) {
          for (const dep of item.dependencies) {
            const need = dep.count * count;
            resourceNeeds.set(dep.itemId, (resourceNeeds.get(dep.itemId) || 0) + need);

            const stock = await dataCache.getItemCountAsync(dep.itemId);
            const currentNeed = resourceNeeds.get(dep.itemId) || 0;
            if (stock < currentNeed) {
              const existing = missingResources.find(m => m.itemId === dep.itemId);
              if (existing) {
                existing.need = Math.max(existing.need, currentNeed);
              } else {
                missingResources.push({ itemId: dep.itemId, need: currentNeed, stock });
              }
            }
          }
        }
      }

      return { optimized, missingResources };
    } catch {
      return { optimized: plan, missingResources: [] };
    }
  }

  async clearPlayerTasks(): Promise<void> {
    let actionQueue = await dataCache.getAsync('actionQueue');
    if (actionQueue.length > 0) {
      const totalCount = actionQueue.length;
      toast.progress(`正在清空任务 (0/${totalCount})`, 'craft');
      for (let i = actionQueue.length - 1; i >= 0; i--) {
        toast.progress(`正在清空任务 (${totalCount - i}/${totalCount})`, 'craft');
        const waitPromise = eventBus.waitFor('actionQueueUpdated');
        await ws.emit('removeTaskFromQueue', i);
        await waitPromise;
        actionQueue = await dataCache.getAsync('actionQueue');
      }
    }
  }

  async clearKittyTasks(kittyUuid: string, kittyName: string): Promise<void> {
    const data = await ws.request('kitty:getAllTask', { kittyUuid });
    const existingTasks = data.payload.data.taskQueue;

    if (existingTasks.length > 0) {
      const totalCount = existingTasks.length;
      toast.progress(`正在清空 ${kittyName} 的任务 (0/${totalCount})`, 'craft');
      for (let i = existingTasks.length - 1; i >= 0; i--) {
        toast.progress(`正在清空 ${kittyName} 的任务 (${totalCount - i}/${totalCount})`, 'craft');
        await ws.request('kitty:removeTask', { kittyUuid, index: i });
      }
    }
  }

  /** 批量制造：按顺序执行多个物品的制造计划 */
  async craftBatchWithDependencies(entries: PlanEntry[], clearTasks = true, addDefaultTasks = true): Promise<void> {
    if (this.isRunning) {
      toast.warning('制造任务进行中');
      return;
    }

    this._running.value = true;
    try {
      toast.info('正在计算制造计划...');

      const allOptimized: CraftStep[] = [];
      for (const entry of entries) {
        const plan = this.buildPlan(entry.actionId, entry.count);
        if (plan.length === 0) continue;
        const { optimized } = await this.optimizePlan(plan, entry.actionId);
        allOptimized.push(...optimized);
      }

      if (allOptimized.length === 0) {
        toast.info('无需制造');
        toast.hideProgress('craft');
        return;
      }

      if (clearTasks) {
        await this.clearPlayerTasks();
      }

      toast.progress('正在添加制造任务...', 'craft');
      await addTasksToQueue(allOptimized);

      if (addDefaultTasks) {
        toast.progress('正在添加默认任务...', 'craft');
        const defaultTasks = await appConfig.PLAYER_DEFAULT_TASKS.get();
        for (const taskId of defaultTasks) {
          if (taskId) {
            const waitPromise = eventBus.waitFor('actionQueueUpdated');
            await ws.emit('addTaskToQueue', {
              actionId: taskId,
              repeatCount: 999999,
              currentRepeat: 0,
              createTime: Date.now(),
            });
            await waitPromise;
          }
        }
      }

      toast.hideProgress('craft');
      toast.success(`已提交 ${allOptimized.length} 个制造任务`);
    } catch (error) {
      logger.error('制造失败', error);
      toast.error(getWsErrorMessage(error, '制造失败'));
      toast.hideProgress('craft');
    } finally {
      this._running.value = false;
    }
  }

  /** 批量猫咪制造 */
  async craftBatchWithKitty(
    kittyUuid: string,
    kittyName: string,
    kittyIndex: number,
    entries: PlanEntry[],
    clearTasks = true,
    addDefaultTasks = true,
  ): Promise<void> {
    if (this.isRunning) {
      toast.warning('制造任务进行中');
      return;
    }

    this._running.value = true;
    try {
      const allOptimized: CraftStep[] = [];
      for (const entry of entries) {
        const plan = this.buildPlan(entry.actionId, entry.count);
        if (plan.length === 0) continue;
        const { optimized } = await this.optimizePlan(plan, entry.actionId);
        allOptimized.push(...optimized);
      }

      if (allOptimized.length === 0) {
        toast.info(`🐱 ${kittyName} 无需制造`);
        toast.hideProgress('craft');
        return;
      }

      const maxTasks = addDefaultTasks ? 2 : 3;
      const tasks = allOptimized.slice(0, maxTasks);
      toast.progress(`正在为 ${kittyName} 安排制造任务...`, 'craft');

      if (clearTasks) {
        await this.clearKittyTasks(kittyUuid, kittyName);
      }

      await addTasksToQueue(tasks, kittyUuid);

      let addedDefaultTask = false;
      if (addDefaultTasks) {
        const defaultTask = await this.getKittyDefaultTask(kittyIndex);
        if (defaultTask && tasks.length < 3) {
          await ws.request('kitty:addTask', {
            kittyUuid,
            task: {
              actionId: defaultTask,
              repeatCount: 999999,
              currentRepeat: 0,
              createTime: Date.now(),
            },
          });
          addedDefaultTask = true;
        }
      }

      toast.hideProgress('craft');
      const taskCount = addedDefaultTask ? tasks.length + 1 : tasks.length;
      toast.success(`🐱 ${kittyName} 已提交 ${taskCount} 个任务`);
    } catch (error) {
      logger.error(`🐱 ${kittyName} 制造失败`, error);
      toast.error(`🐱 ${kittyName}: ${getWsErrorMessage(error, '制造失败')}`);
      toast.hideProgress('craft');
    } finally {
      this._running.value = false;
    }
  }

  async getKittyDefaultTask(kittyIndex: number): Promise<string | null> {
    const tasks = await appConfig.KITTY_DEFAULT_TASKS.get();
    return tasks[kittyIndex] ?? null;
  }

  async setKittyDefaultTask(kittyIndex: number, actionId: string): Promise<void> {
    const tasks = await appConfig.KITTY_DEFAULT_TASKS.get();
    if (actionId) {
      tasks[kittyIndex] = actionId;
    } else {
      delete tasks[kittyIndex];
    }
    await appConfig.KITTY_DEFAULT_TASKS.set(tasks);
  }
}

export const craftManager = new CraftManager();


// ==================== 制造面板 ====================

interface CraftPanelProps {
  onClose: () => void;
  initialEntries?: PlanEntry[];
}

/** 计算单个物品的制造详情（依赖步骤 + 缺失资源） */
async function computePlanDetail(entry: PlanEntry): Promise<PlanItemDetail> {
  const label = craftManager.getItemLabel(entry.actionId);
  const plan = craftManager.buildPlan(entry.actionId, entry.count);

  if (plan.length === 0) {
    return { actionId: entry.actionId, count: entry.count, label, steps: [], missingResources: [] };
  }

  const { optimized, missingResources } = await craftManager.optimizePlan(plan, entry.actionId);

  // 过滤掉可以通过制造获得的资源
  const craftItems = craftManager.getCraftItems();
  const canCraftItems = new Set(
    plan.flatMap((p) => {
      const item = craftItems.find((ci) => ci.actionId === p.actionId);
      return item?.rewards.map((r) => r.itemId) || [];
    }),
  );
  const filteredMissing = missingResources.filter((m) => !canCraftItems.has(m.itemId));

  return { actionId: entry.actionId, count: entry.count, label, steps: optimized, missingResources: filteredMissing };
}

function CraftPanelContent({ onClose, initialEntries }: CraftPanelProps) {
  // 添加区域状态
  const [selectedItem, setSelectedItem] = useState('');
  const [addCount, setAddCount] = useState(1);

  // 制造计划列表：Map<actionId, count>
  const [planEntries, setPlanEntries] = useState<PlanEntry[]>(initialEntries || []);

  // 每个物品的详细制造计划（异步计算）
  const [planDetails, setPlanDetails] = useState<PlanItemDetail[]>([]);

  const [clearTasks, setClearTasks] = useState(true);
  const [addDefaultTasks, setAddDefaultTasks] = useState(true);
  const [kitties, setKitties] = useState<any[]>([]);
  const [playerDefaultTasks, setPlayerDefaultTasks] = useState<string[]>(appConfig.PLAYER_DEFAULT_TASKS.defaultValue);
  const [kittyDefaultTasks, setKittyDefaultTasks] = useState<Record<number, string>>({});

  const hasKittyBanned = useMemo(
    () => craftManager.hasKittyBannedItem(planEntries),
    [planEntries],
  );

  const itemOptions = craftManager.getCraftCategories().map((category) => ({
    label: category.label,
    value: category.value,
    options: category.items.map((item) => ({
      value: item.actionId,
      label: item.label,
    })),
  }));

  const actionOptions = craftManager.getCraftCategories().map((category) => ({
    label: category.label,
    value: category.value,
    options: category.items.map((item) => ({
      value: item.actionId,
      label: item.label,
    })),
  }));

  useEffect(() => {
    const loadData = async () => {
      try {
        const userInfo = await dataCache.getAsync('userInfo');
        setKitties(userInfo.kittyInfo || []);
      } catch {
        setKitties([]);
      }

      const savedPlayerTasks = await appConfig.PLAYER_DEFAULT_TASKS.get();
      const savedKittyTasks = await appConfig.KITTY_DEFAULT_TASKS.get();

      setPlayerDefaultTasks(savedPlayerTasks);
      setKittyDefaultTasks(savedKittyTasks);
    };

    void loadData();
  }, []);

  // 当 planEntries 变化时，重新计算所有物品的制造详情
  const debouncedComputeDetails = useMemo(
    () =>
      debounce(async (entries: PlanEntry[]) => {
        if (entries.length === 0) {
          setPlanDetails([]);
          return;
        }
        const details = await Promise.all(entries.map(computePlanDetail));
        setPlanDetails(details);
      }, 300),
    [],
  );

  useEffect(() => {
    debouncedComputeDetails(planEntries);
  }, [planEntries, debouncedComputeDetails]);

  // 添加物品到计划
  const handleAdd = useCallback(() => {
    if (!selectedItem) {
      toast.warning('请先选择物品');
      return;
    }
    if (addCount <= 0) {
      toast.warning('数量必须大于 0');
      return;
    }

    setPlanEntries((prev) => {
      const existing = prev.find((e) => e.actionId === selectedItem);
      if (existing) {
        // 合并数量
        return prev.map((e) =>
          e.actionId === selectedItem ? { ...e, count: e.count + addCount } : e,
        );
      }
      return [...prev, { actionId: selectedItem, count: addCount }];
    });

    // 重置添加区域
    setAddCount(1);
  }, [selectedItem, addCount]);

  // 修改计划中某个物品的数量
  const handleEntryCountChange = useCallback((actionId: string, newCount: number) => {
    const count = Math.max(1, newCount || 1);
    setPlanEntries((prev) =>
      prev.map((e) => (e.actionId === actionId ? { ...e, count } : e)),
    );
  }, []);

  // 删除计划中的物品
  const handleRemoveEntry = useCallback((actionId: string) => {
    setPlanEntries((prev) => prev.filter((e) => e.actionId !== actionId));
  }, []);

  const handleQuickAdd = (value: number) => {
    setAddCount((prev) => prev + value);
  };

  const handleCraft = useMemo(
    () =>
      throttle(async () => {
        if (planEntries.length === 0) {
          toast.warning('请先添加要制造的物品');
          return;
        }
        await craftManager.craftBatchWithDependencies(planEntries, clearTasks, addDefaultTasks);
        onClose();
      }, 1000),
    [planEntries, clearTasks, addDefaultTasks, onClose],
  );

  const handleKittyCraft = useMemo(
    () =>
      throttle(async (kittyUuid: string, kittyName: string, kittyIndex: number) => {
        if (planEntries.length === 0) {
          toast.warning('请先添加要制造的物品');
          return;
        }
        await craftManager.craftBatchWithKitty(kittyUuid, kittyName, kittyIndex, planEntries, clearTasks, addDefaultTasks);
        onClose();
      }, 1000),
    [planEntries, clearTasks, addDefaultTasks, onClose],
  );

  const handlePlayerDefaultTaskChange = async (index: number, value: string) => {
    const newTasks = [...playerDefaultTasks];
    newTasks[index] = value;
    setPlayerDefaultTasks(newTasks);
    await appConfig.PLAYER_DEFAULT_TASKS.set(newTasks);
  };

  const handleKittyDefaultTaskChange = async (kittyIndex: number, actionId: string) => {
    const newTasks = { ...kittyDefaultTasks };
    if (actionId) {
      newTasks[kittyIndex] = actionId;
    } else {
      delete newTasks[kittyIndex];
    }
    setKittyDefaultTasks(newTasks);
    await appConfig.KITTY_DEFAULT_TASKS.set(newTasks);
  };

  const handleClearPlayerTasks = useMemo(
    () =>
      throttle(async () => {
        try {
          const actionQueue = await dataCache.getAsync('actionQueue');
          if (actionQueue.length === 0) {
            toast.info('任务队列已为空');
            return;
          }
          await craftManager.clearPlayerTasks();
          toast.success('✅ 已清空当前角色任务');
        } catch (error) {
          logger.error('清空当前角色任务失败', error);
          toast.error(getWsErrorMessage(error, '清空任务失败'));
        }
      }, 1000),
    [],
  );

  const handleClearKittyTasks = useMemo(
    () =>
      throttle(async (kittyUuid: string, kittyName: string) => {
        try {
          const data = await ws.request('kitty:getAllTask', { kittyUuid });
          const existingTasks = data.payload.data.taskQueue;

          if (existingTasks.length === 0) {
            toast.info(`${kittyName} 任务队列已为空`);
            return;
          }

          await craftManager.clearKittyTasks(kittyUuid, kittyName);
          toast.success(`✅ 已清空 ${kittyName} 的任务`);
        } catch (error) {
          logger.error(`清空 ${kittyName} 任务失败`, error);
          toast.error(`清空 ${kittyName} 任务失败: ${getWsErrorMessage(error, '未知错误')}`);
        }
      }, 1000),
    [],
  );

  return (
    <>
      {/* 上方 - 添加区域 */}
      <FormGroup label="选择物品">
        <Select value={selectedItem} onChange={setSelectedItem} options={itemOptions} placeholder="-- 请选择物品 --" />
      </FormGroup>

      <FormGroup label="数量">
        <Input type="number" value={addCount} onChange={(v) => setAddCount(parseInt(v) || 1)} min={1} step={1} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {[10, 100, 1000, 10000].map((value) => (
            <Button
              key={value}
              variant="secondary"
              onClick={() => handleQuickAdd(value)}
              style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
            >
              +{value}
            </Button>
          ))}
        </div>
      </FormGroup>

      <Button variant="secondary" onClick={handleAdd} style={{ marginBottom: '12px' }}>
        添加到制造计划
      </Button>

      {/* 中间 - 制造计划预览 */}
      <Card title="制造计划预览" style={{ minHeight: '60px' }}>
        {planEntries.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#999', textAlign: 'center', padding: '12px 0' }}>
            请添加物品
          </div>
        ) : (
          planEntries.map((entry) => {
            const detail = planDetails.find((d) => d.actionId === entry.actionId);
            return (
              <PlanItemBlock
                key={entry.actionId}
                entry={entry}
                detail={detail}
                onCountChange={handleEntryCountChange}
                onRemove={handleRemoveEntry}
              />
            );
          })
        )}
      </Card>

      {/* 下方 - 操作区域 */}
      <FormGroup>
        <Checkbox checked={clearTasks} onChange={setClearTasks} label="清空猫咪之前的任务" />
        <div style={{ marginTop: '6px' }}>
          <Checkbox checked={addDefaultTasks} onChange={setAddDefaultTasks} label="完成后添加默认任务" />
        </div>
      </FormGroup>

      <Button onClick={handleCraft} disabled={craftManager.running.value || planEntries.length === 0}>
        {craftManager.running.value ? '制造中...' : '开始制造'}
      </Button>

      {kitties.length > 0 && !hasKittyBanned && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {kitties.map((kitty, index) => (
            <Button
              key={kitty.uuid}
              variant="kitty"
              onClick={() => handleKittyCraft(kitty.uuid, kitty.name || `猫咪${index + 1}`, index)}
              style={{ flex: 1 }}
              disabled={craftManager.running.value || planEntries.length === 0}
            >
              🐱 {kitty.name || `猫咪${index + 1}`}
            </Button>
          ))}
        </div>
      )}

      <Card title="🗑️ 清空任务" style={{ margin: '16px 0' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={handleClearPlayerTasks} style={{ flex: 1, padding: '8px 12px' }}>
            主角色
          </Button>
          {kitties.map((kitty, index) => (
            <Button
              key={kitty.uuid}
              variant="secondary"
              onClick={() => handleClearKittyTasks(kitty.uuid, kitty.name || `猫咪${index + 1}`)}
              style={{ flex: 1 }}
            >
              🐱 {kitty.name || `猫咪${index + 1}`}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="👤 当前角色默认任务" style={{ marginTop: '16px' }}>
        <Row label="默认任务1:">
          <Select
            value={playerDefaultTasks[0] || ''}
            onChange={(v) => handlePlayerDefaultTaskChange(0, v)}
            options={[{ value: '', label: '无' }, ...actionOptions]}
            style={{ flex: 1 }}
          />
        </Row>
        <Row label="默认任务2:">
          <Select
            value={playerDefaultTasks[1] || ''}
            onChange={(v) => handlePlayerDefaultTaskChange(1, v)}
            options={[{ value: '', label: '无' }, ...actionOptions]}
            style={{ flex: 1 }}
          />
        </Row>
      </Card>

      {kitties.length > 0 && (
        <Card title="🐱 猫咪默认任务配置" style={{ marginTop: '0' }}>
          {kitties.map((kitty, index) => {
            const kittyName = kitty.name || `猫咪${index + 1}`;
            const defaultTask = kittyDefaultTasks[index] || '';

            return (
              <Row key={kitty.uuid} label={`${kittyName}:`}>
                <Select
                  value={defaultTask}
                  onChange={(v) => handleKittyDefaultTaskChange(index, v)}
                  options={[{ value: '', label: '无' }, ...actionOptions]}
                  style={{ flex: 1 }}
                />
              </Row>
            );
          })}
        </Card>
      )}
    </>
  );
}


// ==================== 制造计划物品块 ====================

interface PlanItemBlockProps {
  entry: PlanEntry;
  detail?: PlanItemDetail;
  onCountChange: (actionId: string, count: number) => void;
  onRemove: (actionId: string) => void;
}

const ITEM_BLOCK_STYLE: Record<string, any> = {
  container: {
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    paddingBottom: '8px',
    marginBottom: '8px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  countInput: {
    width: '80px',
    padding: '4px 6px',
    fontSize: '12px',
    textAlign: 'center' as const,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '2px 6px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  steps: {
    fontSize: '12px',
    color: '#666',
    lineHeight: '1.6',
    paddingLeft: '8px',
  },
  missing: {
    fontSize: '12px',
    color: '#856404',
    lineHeight: '1.6',
    paddingLeft: '8px',
    marginTop: '4px',
  },
};

function PlanItemBlock({ entry, detail, onCountChange, onRemove }: PlanItemBlockProps) {
  const label = detail?.label || craftManager.getItemLabel(entry.actionId);

  return (
    <div style={ITEM_BLOCK_STYLE.container}>
      <div style={ITEM_BLOCK_STYLE.header}>
        <span style={ITEM_BLOCK_STYLE.label}>📦 {label}</span>
        <Input
          type="number"
          value={entry.count}
          onChange={(v) => onCountChange(entry.actionId, parseInt(v) || 1)}
          min={1}
          style={ITEM_BLOCK_STYLE.countInput}
        />
        <button
          style={ITEM_BLOCK_STYLE.deleteBtn}
          onClick={() => onRemove(entry.actionId)}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.color = '#ef4444';
            (e.target as HTMLElement).style.background = 'rgba(239,68,68,0.1)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.color = '#999';
            (e.target as HTMLElement).style.background = 'none';
          }}
        >
          ✕
        </button>
      </div>

      {detail && detail.steps.length > 0 && (
        <div style={ITEM_BLOCK_STYLE.steps}>
          {detail.steps.map((step, i) => (
            <div key={step.actionId}>
              {i + 1}. {step.name} ×{step.count}
            </div>
          ))}
        </div>
      )}

      {detail && detail.missingResources.length > 0 && (
        <div style={ITEM_BLOCK_STYLE.missing}>
          {detail.missingResources.map((m) => (
            <div key={m.itemId}>
              ⚠️ {craftManager.getItemName(m.itemId)}: 需要 {m.need}, 库存 {m.stock}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CraftPanelShowProps {
  initialEntries?: PlanEntry[];
}

export class CraftPanel extends BasePanel<CraftPanelShowProps> {
  get title() { return '🔨 物品制造'; }
  renderContent() {
    return <CraftPanelContent onClose={() => this.hide()} initialEntries={this.props.initialEntries} />;
  }
}

/** 共享制造面板实例 */
export const craftPanel = new CraftPanel();