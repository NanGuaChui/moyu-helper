/**
 * 制造功能模块
 * 包含制造管理器和制造面板
 */

import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import DEFAULT_CRAFT_ITEMS from '@/config/craft-items.json';
import { toast, ws, dataCache, eventBus, BaseFeature, createLogger } from '@/core';
const logger = createLogger('Craft');
import type { CraftItem, CraftItemCategory } from '@/types';
import { Modal, Card, FormGroup, Select, Input, Checkbox, Button, Row } from '@/ui/components';
import { debounce, throttle, getWsErrorMessage } from '@/utils';
import { appConfig } from '@/config/gm-settings';

interface CraftStep {
  name: string;
  actionId: string;
  count: number;
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
        // 计算需要制造的数量：找到所有需要的产出物品，计算最大需求
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

  async craftWithDependencies(actionId: string, count: number, clearTasks = true): Promise<void> {
    if (this.isRunning) {
      toast.warning('制造任务进行中');
      return;
    }

    this._running = true;
    try {
      toast.info('正在计算制造计划...');
      const plan = this.buildPlan(actionId, count);
      if (plan.length === 0) {
        toast.hideProgress('craft');
        return;
      }

      const { optimized } = await this.optimizePlan(plan, actionId);
      if (optimized.length === 0) {
        toast.info('无需制造');
        toast.hideProgress('craft');
        return;
      }

      if (clearTasks) {
        await this.clearPlayerTasks();
      }

      toast.progress('正在添加制造任务...', 'craft');

      for (let i = 0; i < optimized.length; i++) {
        const step = optimized[i];
        toast.progress(`正在添加 ${step.name} ×${step.count} (${i + 1}/${optimized.length})`, 'craft');

        const waitPromise = eventBus.waitFor('actionQueueUpdated');
        await ws.emit('addTaskToQueue', {
          actionId: step.actionId,
          repeatCount: step.count,
          currentRepeat: 0,
          createTime: Date.now(),
        });
        await waitPromise;
      }

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

      toast.hideProgress('craft');
      toast.success(`已提交 ${optimized.length} 个制造任务`);
    } catch (error) {
      logger.error('制造失败', error);
      toast.error(getWsErrorMessage(error, '制造失败'));
      toast.hideProgress('craft');
    } finally {
      this._running = false;
    }
  }

  async craftWithKitty(
    kittyUuid: string,
    kittyName: string,
    kittyIndex: number,
    actionId: string,
    count: number,
    clearTasks = true,
  ): Promise<void> {
    if (this.isRunning) {
      toast.warning('制造任务进行中');
      return;
    }

    this._running = true;
    try {
      const plan = this.buildPlan(actionId, count);
      if (plan.length === 0) {
        toast.hideProgress('craft');
        return;
      }

      const { optimized } = await this.optimizePlan(plan, actionId);
      if (optimized.length === 0) {
        toast.info(`🐱 ${kittyName} 无需制造`);
        toast.hideProgress('craft');
        return;
      }

      const tasks = optimized.slice(0, 2);
      toast.progress(`正在为 ${kittyName} 安排制造任务...`, 'craft');

      if (clearTasks) {
        await this.clearKittyTasks(kittyUuid, kittyName);
      }

      for (let i = 0; i < tasks.length; i++) {
        const step = tasks[i];
        toast.progress(`正在为 ${kittyName} 添加 ${step.name} ×${step.count} (${i + 1}/${tasks.length})`, 'craft');

        await ws.request('kitty:addTask', {
          kittyUuid,
          task: {
            actionId: step.actionId,
            repeatCount: step.count,
            currentRepeat: 0,
            createTime: Date.now(),
          },
        });
      }

      const defaultTask = await this.getKittyDefaultTask(kittyIndex);
      let addedDefaultTask = false;
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

      toast.hideProgress('craft');
      const taskCount = addedDefaultTask ? tasks.length + 1 : tasks.length;
      toast.success(`🐱 ${kittyName} 已提交 ${taskCount} 个任务`);
    } catch (error) {
      logger.error(`🐱 ${kittyName} 制造失败`, error);
      toast.error(`🐱 ${kittyName}: ${getWsErrorMessage(error, '制造失败')}`);
      toast.hideProgress('craft');
    } finally {
      this._running = false;
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
}

function CraftPanelContent({ onClose }: CraftPanelProps) {
  const [selectedItem, setSelectedItem] = useState('');
  const [count, setCount] = useState(1);
  const [clearTasks, setClearTasks] = useState(true);
  const [preview, setPreview] = useState('请选择物品');
  const [missingResources, setMissingResources] = useState<Array<{ itemId: string; need: number; stock: number }>>([]);
  const [kitties, setKitties] = useState<any[]>([]);
  const [playerDefaultTasks, setPlayerDefaultTasks] = useState<string[]>(appConfig.PLAYER_DEFAULT_TASKS.defaultValue);
  const [kittyDefaultTasks, setKittyDefaultTasks] = useState<Record<number, string>>({});
  const [isProcessing, setIsProcessing] = useState(craftManager.isRunning);

  const isKittyBanned = useMemo(() => craftManager.isBannedForKitty(selectedItem), [selectedItem]);

  const itemOptions = craftManager.getCraftCategories().map((category) => ({
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
      setIsProcessing(craftManager.isRunning);
    };

    void loadData();
  }, []);

  const debouncedUpdatePreview = useMemo(
    () =>
      debounce(async (item: string, num: number) => {
        if (!item) {
          setPreview('请选择物品');
          setMissingResources([]);
          return;
        }

        const plan = craftManager.buildPlan(item, num);
        if (plan.length === 0) {
          setPreview('⚠️ 无法计算制造计划');
          setMissingResources([]);
          return;
        }

        const { optimized, missingResources } = await craftManager.optimizePlan(plan, item);

        // 过滤掉无法快捷制造的物品（在制造配方中找不到生产者）
        const craftItems = craftManager.getCraftItems();
        const canCraftItems = new Set(
          plan.flatMap(p => {
            const item = craftItems.find(item => item.actionId === p.actionId);
            return item?.rewards.map(r => r.itemId) || [];
          })
        );
        const missingCanCraft = missingResources.filter(m => !canCraftItems.has(m.itemId));
        setMissingResources(missingCanCraft);

        if (optimized.length === 0) {
          if (missingResources.length > 0) {
            setPreview('⚠️ 库存不足，无法制造');
          } else {
            setPreview('✅ 库存充足，无需制造');
          }
          return;
        }

        let previewHTML = '';
        previewHTML += optimized
          .map((step: any, index: number) => `${index + 1}. ${step.name} ×${step.count}`)
          .join('\n');

        setPreview(previewHTML);
      }, 300),
    [],
  );

  useEffect(() => {
    debouncedUpdatePreview(selectedItem, count);
  }, [selectedItem, count, debouncedUpdatePreview]);

  const handleCountChange = useMemo(
    () =>
      debounce((v: string) => {
        setCount(parseInt(v) || 1);
      }, 300),
    [],
  );

  const handleQuickAdd = useMemo(
    () =>
      throttle((value: number) => {
        setCount((prev) => prev + value);
      }, 300),
    [],
  );

  const handleCraft = useMemo(
    () =>
      throttle(async () => {
        if (!selectedItem) {
          toast.warning('请先选择要制造的物品');
          return;
        }
        onClose();
        await craftManager.craftWithDependencies(selectedItem, count, clearTasks);
      }, 1000),
    [selectedItem, count, clearTasks, onClose],
  );

  const handleKittyCraft = useMemo(
    () =>
      throttle(async (kittyUuid: string, kittyName: string, kittyIndex: number) => {
        if (!selectedItem) {
          toast.warning('请先选择要制造的物品');
          return;
        }
        onClose();
        await craftManager.craftWithKitty(kittyUuid, kittyName, kittyIndex, selectedItem, count, clearTasks);
      }, 1000),
    [selectedItem, count, clearTasks, onClose],
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

  const actionOptions = craftManager.getCraftCategories().map((category) => ({
    label: category.label,
    value: category.value,
    options: category.items.map((item) => ({
      value: item.actionId,
      label: item.label,
    })),
  }));

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
      <FormGroup label="选择物品">
        <Select value={selectedItem} onChange={setSelectedItem} options={itemOptions} placeholder="-- 请选择物品 --" />
      </FormGroup>

      <FormGroup label="制造数量">
        <Input type="number" value={count} onChange={handleCountChange} min={1} step={1} />
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

      <FormGroup>
        <Checkbox checked={clearTasks} onChange={setClearTasks} label="清空猫咪之前的任务" />
      </FormGroup>

      <Card title="制造计划预览" style={{ minHeight: '60px' }}>
        <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{preview}</div>
      </Card>

      {missingResources.length > 0 && (
        <Card
          title="⚠️ 缺失资源（无法快捷制造）"
          style={{
            background: '#fff3cd',
            borderColor: '#ffc107',
          }}
        >
          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
            {missingResources.map(m => (
              <div key={m.itemId} style={{ color: '#856404', marginBottom: '4px' }}>
                • {craftManager.getItemName(m.itemId)}: 需要 {m.need}, 库存 {m.stock}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Button onClick={handleCraft} disabled={isProcessing}>
        {isProcessing ? '制造中...' : '开始制造'}
      </Button>

      {kitties.length > 0 && !isKittyBanned && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {kitties.map((kitty, index) => (
            <Button
              key={kitty.uuid}
              variant="kitty"
              onClick={() => handleKittyCraft(kitty.uuid, kitty.name || `猫咪${index + 1}`, index)}
              style={{ flex: 1 }}
              disabled={isProcessing}
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

export class CraftPanel {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  show(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    render(
      <Modal isOpen={true} onClose={() => this.hide()} title="🔨 物品制造">
        <CraftPanelContent onClose={() => this.hide()} />
      </Modal>,
      this.container,
    );
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.container) {
      render(null, this.container);
    }
  }
}
