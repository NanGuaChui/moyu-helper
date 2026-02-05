/**
 * 制造功能模块
 * 包含制造管理器和制造面板
 */

import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import DEFAULT_CRAFT_ITEMS from '@/config/craft-items.json';
import { logger, toast, ws, dataCache, eventBus } from '@/core';
import type { CraftItem, CraftItemCategory } from '@/types';
import { Modal, Card, FormGroup, Select, Input, Checkbox, Button, Row } from '@/ui/components';
import { analytics, debounce, throttle } from '@/utils';
import { appConfig } from '@/config/gm-settings';

interface CraftStep {
  name: string;
  actionId: string;
  count: number;
}

// ==================== 制造管理器 ====================

class CraftManager {
  private categories: CraftItemCategory[] = DEFAULT_CRAFT_ITEMS;
  private running = false;

  getCraftCategories(): CraftItemCategory[] {
    return this.categories;
  }

  getCraftItems(): CraftItem[] {
    return this.categories.flatMap((category) => category.items);
  }

  getDisplayName(name: string): string {
    const result = name.replace(/^(制作|酿造|缝制|熬制|烹饪|种植|锻造|熔炼|开采|烧制)/, '');
    return result || name;
  }

  calculateCraftPlan(actionId: string, targetCount: number): Array<{ itemName: string; count: number }> {
    const plan = this.buildPlan(actionId, targetCount);
    return plan.map((step) => ({ itemName: step.name, count: step.count }));
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

    return candidates.reduce((best, current) =>
      countNonBasicDeps(current) < countNonBasicDeps(best) ? current : best,
    );
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
    const visited = new Set<string>();

    const calculate = (id: string, count: number) => {
      if (visited.has(id)) return;
      visited.add(id);

      const current = this.findByActionId(id);
      if (!current) return;

      needs.set(id, (needs.get(id) || 0) + count);

      if (current.dependencies) {
        for (const dep of current.dependencies) {
          const producer = this.findByRewardId(dep.itemId);
          if (producer) {
            const reward = producer.rewards.find((r) => r.itemId === dep.itemId)!;
            const times = Math.ceil((dep.count * count) / reward.count);
            calculate(producer.actionId, times);
          }
        }
      }
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
    visited.clear();
    sort(actionId);

    return plan;
  }

  async optimizePlan(plan: CraftStep[], targetActionId: string): Promise<CraftStep[]> {
    try {
      const optimized: CraftStep[] = [];
      const resourceNeeds = new Map<string, number>();

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
              resourceNeeds.set(dep.itemId, (resourceNeeds.get(dep.itemId) || 0) + dep.count * count);
            }
          }
          continue;
        }

        // 依赖项需要检查产出和库存
        const mainReward = item.rewards[0];
        if (!mainReward) continue;

        const stock = await dataCache.getItemCountAsync(mainReward.itemId);
        const need = resourceNeeds.get(mainReward.itemId) || 0;
        const netNeed = Math.max(0, need - stock);
        count = Math.ceil(netNeed / mainReward.count);

        if (count <= 0) {
          logger.info(`跳过 ${step.name}（库存充足）`);
          continue;
        }

        optimized.unshift({ ...step, count });

        if (item.dependencies) {
          for (const dep of item.dependencies) {
            resourceNeeds.set(dep.itemId, (resourceNeeds.get(dep.itemId) || 0) + dep.count * count);
          }
        }
      }

      return optimized;
    } catch {
      return plan;
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
    if (this.running) {
      toast.warning('制造任务进行中');
      return;
    }

    this.running = true;

    try {
      toast.info('正在计算制造计划...');
      const plan = this.buildPlan(actionId, count);
      if (plan.length === 0) {
        toast.hideProgress('craft');
        return;
      }

      const optimized = await this.optimizePlan(plan, actionId);
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
      analytics.track('制造', 'player_craft', `${optimized.length}个任务`);
    } catch (error) {
      logger.error('制造失败', error);
      toast.error('制造失败');
      toast.hideProgress('craft');
    } finally {
      this.running = false;
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
    if (this.running) {
      toast.warning('制造任务进行中');
      return;
    }

    this.running = true;

    try {
      const plan = this.buildPlan(actionId, count);
      if (plan.length === 0) {
        toast.hideProgress('craft');
        return;
      }

      const optimized = await this.optimizePlan(plan, actionId);
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
      analytics.track('制造', 'kitty_craft', `${kittyName}-${taskCount}个任务`);
    } catch (error) {
      logger.error(`🐱 ${kittyName} 制造失败`, error);
      toast.error('制造失败');
      toast.hideProgress('craft');
    } finally {
      this.running = false;
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
  const [kitties, setKitties] = useState<any[]>([]);
  const [playerDefaultTasks, setPlayerDefaultTasks] = useState<string[]>(appConfig.PLAYER_DEFAULT_TASKS.defaultValue);
  const [kittyDefaultTasks, setKittyDefaultTasks] = useState<Record<number, string>>({});

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
    };

    void loadData();
  }, []);

  const debouncedUpdatePreview = useMemo(
    () =>
      debounce(async (item: string, num: number) => {
        if (!item) {
          setPreview('请选择物品');
          return;
        }

        const plan = craftManager.buildPlan(item, num);
        if (plan.length === 0) {
          setPreview('⚠️ 无法计算制造计划');
          return;
        }

        const optimized = await craftManager.optimizePlan(plan, item);
        if (optimized.length === 0) {
          setPreview('✅ 库存充足，无需制造');
          return;
        }

        const stepsHTML = optimized
          .map((step: any, index: number) => `${index + 1}. ${step.name} ×${step.count}`)
          .join('\n');
        setPreview(stepsHTML);
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
          toast.error('清空任务失败');
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
          toast.error('清空任务失败');
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

      <Button onClick={handleCraft}>开始制造</Button>

      {kitties.length > 0 && !isKittyBanned && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {kitties.map((kitty, index) => (
            <Button
              key={kitty.uuid}
              variant="kitty"
              onClick={() => handleKittyCraft(kitty.uuid, kitty.name || `猫咪${index + 1}`, index)}
              style={{ flex: 1 }}
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
