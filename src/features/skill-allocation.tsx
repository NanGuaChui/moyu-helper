/**
 * 技能点分配功能模块
 * 使用 pipeline 函数组合模式实现策略配置化
 *
 * 2026/1/29  参照鱼类自动化养殖技术交流群文件 天赋加点2.js 重写
 * 2026/2/5   增加了产出+材料优先的新策略
 * 2026/2/10  重构为 pipeline 模式，消除重复代码
 */

import { useState, useEffect } from 'preact/hooks';
import { appConfig } from '@/config/gm-settings';
import { ws, toast, BaseFeature, createLogger } from '@/core';

const logger = createLogger('SkillAllocation');
import { sleep } from '@/utils';
import { FormGroup, Select, Checkbox, Button } from '@/ui/components';
import { BasePanel } from '@/ui/base-panel';

// ==================== 类型定义 ====================

interface SkillAllocationSummary {
  treeId: string;
  totalEarned: number;
  totalSpent: number;
  effectiveSpent: number;
  available: number;
  nodeLevels: Record<string, number>;
  canAllocate: Record<string, boolean>;
  unmetReasons: Record<string, string[]>;
}

interface AllocationResult {
  allocation: Record<string, number>;
  summary: { totalPoints: number; usedPoints: number; remainingPoints: number };
}

// ==================== 常量 ====================

const SPECIALTY_MAP: Record<string, string> = {
  mining: '采矿', mysterious: '炼金', collecting: '采集', knowledge: '自我提升',
  forging: '锻造', exploring: '探索', manufacturing: '制造', cooking: '烹饪',
  farmingAnimal: '养殖', farmingPlant: '种植', sewing: '缝纫',
  specialManufacture: '特殊制造', fishing: '钓鱼',
};

// ==================== 节点成本与显示名 ====================

type NodeType = 'lucky' | 'efficiency' | 'focus' | 'tier3';

function getNodeType(nodeId: string): NodeType {
  if (nodeId === 'l_lucky_basics') return 'lucky';
  if (nodeId === 'l_efficiency_basics') return 'efficiency';
  if (nodeId.includes('_focus')) return 'focus';
  return 'tier3';
}

function getCost(nodeId: string, level: number): number {
  switch (getNodeType(nodeId)) {
    case 'lucky': return 15;
    case 'efficiency': return 1 + Math.floor(level / 4);
    case 'focus': return 1 + Math.floor(level / 2);
    case 'tier3': return 4 + Math.floor(level / 2);
  }
}

const NODE_TYPE_NAMES: Record<string, string> = {
  focus: '专精', extraReward: '额外产出', returnResource: '返还消耗', extraExp: '额外经验',
};

function getNodeDisplayName(nodeId: string): string {
  if (nodeId === 'l_efficiency_basics') return '效率基础';
  if (nodeId === 'l_lucky_basics') return '幸运';
  const match = nodeId.match(/l_([^_]+)_(.+)/);
  if (match) return `${SPECIALTY_MAP[match[1]] || match[1]}${NODE_TYPE_NAMES[match[2]] || match[2]}`;
  return nodeId;
}

// ==================== 分配上下文 ====================

interface AllocContext {
  allocation: Record<string, number>;
  remaining: number;
  totalPoints: number;
  specialty: string;
  /** 所有节点ID列表 */
  allNodeIds: string[];
  /** 节点最大等级 */
  maxLevels: Record<string, number>;
  /** 节点解锁条件 */
  unlockReqs: Record<string, { nodeId: string; level: number }>;
}

/** 效率增益系数（每级） */
const EFFICIENCY_GAIN: Record<NodeType, number> = {
  lucky: 0, efficiency: 0.003, focus: 0.005, tier3: 0,
};
const TIER3_GAINS: Record<string, number> = {
  extraReward: 0.001, returnResource: 0.00066, extraExp: 0,
};

function getTier3Suffix(nodeId: string): string {
  const match = nodeId.match(/l_[^_]+_(.+)/);
  return match?.[1] ?? '';
}

function getEfficiencyGain(nodeId: string): number {
  const type = getNodeType(nodeId);
  if (type === 'tier3') return TIER3_GAINS[getTier3Suffix(nodeId)] ?? 0;
  return EFFICIENCY_GAIN[type];
}

// ==================== 上下文工具函数 ====================

function canUpgrade(ctx: AllocContext, nodeId: string): boolean {
  const level = ctx.allocation[nodeId] ?? 0;
  if (level >= (ctx.maxLevels[nodeId] ?? 0)) return false;
  const req = ctx.unlockReqs[nodeId];
  if (req && (ctx.allocation[req.nodeId] ?? 0) < req.level) return false;
  return true;
}

function tryUpgrade(ctx: AllocContext, nodeId: string): boolean {
  if (!canUpgrade(ctx, nodeId)) return false;
  const cost = getCost(nodeId, ctx.allocation[nodeId] ?? 0);
  if (cost > ctx.remaining) return false;
  ctx.allocation[nodeId] = (ctx.allocation[nodeId] ?? 0) + 1;
  ctx.remaining -= cost;
  return true;
}

function upgradeToLevel(ctx: AllocContext, nodeId: string, targetLevel: number): void {
  while ((ctx.allocation[nodeId] ?? 0) < targetLevel && ctx.remaining > 0) {
    if (!tryUpgrade(ctx, nodeId)) break;
  }
}

function createContext(totalPoints: number, specialty: string): AllocContext {
  const spec = specialty;
  const allNodeIds = [
    'l_efficiency_basics', 'l_lucky_basics',
    `l_${spec}_focus`, `l_${spec}_extraReward`, `l_${spec}_returnResource`, `l_${spec}_extraExp`,
  ];
  const maxLevels: Record<string, number> = {
    'l_efficiency_basics': 20, 'l_lucky_basics': 10,
    [`l_${spec}_focus`]: 10, [`l_${spec}_extraReward`]: 10,
    [`l_${spec}_returnResource`]: 10, [`l_${spec}_extraExp`]: 10,
  };
  const unlockReqs: Record<string, { nodeId: string; level: number }> = {
    [`l_${spec}_focus`]: { nodeId: 'l_efficiency_basics', level: 2 },
    [`l_${spec}_extraReward`]: { nodeId: `l_${spec}_focus`, level: 7 },
    [`l_${spec}_returnResource`]: { nodeId: `l_${spec}_focus`, level: 7 },
    [`l_${spec}_extraExp`]: { nodeId: `l_${spec}_focus`, level: 8 },
  };
  const allocation: Record<string, number> = {};
  allNodeIds.forEach((id) => (allocation[id] = 0));

  return { allocation, remaining: totalPoints, totalPoints, specialty, allNodeIds, maxLevels, unlockReqs };
}

// ==================== Phase 原语 ====================

type Phase = (ctx: AllocContext) => void;

/** 效率基础升到指定等级 */
const unlockBase = (level: number): Phase => (ctx) => upgradeToLevel(ctx, 'l_efficiency_basics', level);

/** 专精升到指定等级 */
const upgradeFocus = (level: number): Phase => (ctx) => upgradeToLevel(ctx, `l_${ctx.specialty}_focus`, level);

/** 把指定节点加满 */
const maxNode = (suffix: string): Phase => (ctx) => {
  const nodeId = `l_${ctx.specialty}_${suffix}`;
  while (ctx.remaining > 0 && canUpgrade(ctx, nodeId)) {
    if (!tryUpgrade(ctx, nodeId)) break;
  }
};

/** 多个节点 1:1 平衡加点 */
const balancedNodes = (suffixes: string[]): Phase => (ctx) => {
  const nodeIds = suffixes.map((s) => `l_${ctx.specialty}_${s}`);
  while (ctx.remaining > 0) {
    // 找等级最低且可升级的节点
    const upgradeable = nodeIds.filter((id) => canUpgrade(ctx, id));
    if (upgradeable.length === 0) break;
    upgradeable.sort((a, b) => (ctx.allocation[a] ?? 0) - (ctx.allocation[b] ?? 0));
    if (!tryUpgrade(ctx, upgradeable[0])) break;
  }
};

/** 按效率优先分配剩余点数 */
const fillByEfficiency = (excludeSuffixes: string[] = []): Phase => (ctx) => {
  let upgraded = true;
  while (ctx.remaining > 0 && upgraded) {
    upgraded = false;
    const candidates = ctx.allNodeIds
      .filter((id) => {
        if (id === 'l_lucky_basics') return false;
        if (excludeSuffixes.some((s) => id.includes(`_${s}`))) return false;
        return canUpgrade(ctx, id);
      })
      .map((id) => {
        const cost = getCost(id, ctx.allocation[id] ?? 0);
        const gain = getEfficiencyGain(id);
        return { id, cost, effPerPoint: gain / cost };
      })
      .filter((n) => n.effPerPoint > 0 && n.cost <= ctx.remaining)
      .sort((a, b) => b.effPerPoint - a.effPerPoint || (b.effPerPoint * b.cost) - (a.effPerPoint * a.cost));

    if (candidates.length > 0 && tryUpgrade(ctx, candidates[0].id)) {
      upgraded = true;
    }
  }

  // 尝试用剩余点数升级最便宜的节点
  if (ctx.remaining > 0) {
    const cheapest = ctx.allNodeIds
      .filter((id) => {
        if (id === 'l_lucky_basics') return false;
        if (excludeSuffixes.some((s) => id.includes(`_${s}`))) return false;
        return canUpgrade(ctx, id) && getCost(id, ctx.allocation[id] ?? 0) <= ctx.remaining;
      })
      .sort((a, b) => getCost(a, ctx.allocation[a] ?? 0) - getCost(b, ctx.allocation[b] ?? 0));
    if (cheapest.length > 0) tryUpgrade(ctx, cheapest[0]);
  }
};

/** 尝试解锁并加满经验节点 */
const tryExp = (): Phase => (ctx) => {
  const expNodeId = `l_${ctx.specialty}_extraExp`;
  if ((ctx.allocation[expNodeId] ?? 0) >= 10) return;
  // 需要专精8级才能解锁经验节点
  upgradeFocus(8)(ctx);
  if ((ctx.allocation[`l_${ctx.specialty}_focus`] ?? 0) >= 8) {
    maxNode('extraExp')(ctx);
  }
};

/** 幸运加满 */
const allocateLucky: Phase = (ctx) => upgradeToLevel(ctx, 'l_lucky_basics', 10);

/** 最终优化：用剩余点数升级任何可升级节点 */
const finalSweep: Phase = (ctx) => {
  allocateLucky(ctx);
  const affordable = ctx.allNodeIds
    .filter((id) => canUpgrade(ctx, id) && getCost(id, ctx.allocation[id] ?? 0) <= ctx.remaining)
    .sort((a, b) => getCost(a, ctx.allocation[a] ?? 0) - getCost(b, ctx.allocation[b] ?? 0));
  for (const id of affordable) {
    if (ctx.remaining <= 0) break;
    tryUpgrade(ctx, id);
  }
};

// ==================== 策略配置 ====================

/** 效率优先的核心逻辑（也作为低点数时的 fallback） */
const EFFICIENCY_PHASES: Phase[] = [
  unlockBase(2),
  (ctx) => {
    if (ctx.totalPoints >= 22) {
      upgradeFocus(7)(ctx);
      // 解锁产出和返还各1级
      tryUpgrade(ctx, `l_${ctx.specialty}_extraReward`);
      if (ctx.totalPoints >= 28) tryUpgrade(ctx, `l_${ctx.specialty}_returnResource`);
    }
  },
  fillByEfficiency(['extraExp']),
  tryExp(),
];

const STRATEGIES: Record<string, { phases: Phase[]; minPoints?: number }> = {
  '效率优先': {
    phases: EFFICIENCY_PHASES,
  },
  '产出优先': {
    minPoints: 22,
    phases: [
      unlockBase(2), upgradeFocus(7), maxNode('extraReward'),
      fillByEfficiency(['extraReward', 'extraExp']), tryExp(),
    ],
  },
  '材料优先': {
    minPoints: 22,
    phases: [
      unlockBase(2), upgradeFocus(7), maxNode('returnResource'),
      fillByEfficiency(['returnResource', 'extraExp']), tryExp(),
    ],
  },
  '产出+材料优先': {
    phases: [
      unlockBase(2), upgradeFocus(7), balancedNodes(['extraReward', 'returnResource']),
      fillByEfficiency(['extraExp']), tryExp(),
    ],
  },
  '经验优先': {
    minPoints: 24,
    phases: [
      unlockBase(2), upgradeFocus(8), maxNode('extraExp'),
      fillByEfficiency(['extraExp']),
    ],
  },
};

// ==================== 执行引擎 ====================

function executePipeline(phases: Phase[], ctx: AllocContext): void {
  for (const phase of phases) phase(ctx);
}

function calculateTalentAllocation(
  totalPoints: number, luckyFirst: boolean, strategy: string, specialty: string,
): AllocationResult {
  const ctx = createContext(totalPoints, specialty);

  // 幸运优先则先加幸运
  if (luckyFirst) allocateLucky(ctx);

  // 选择策略，点数不足时 fallback 到效率优先
  const config = STRATEGIES[strategy] ?? STRATEGIES['效率优先'];
  const phases = (config.minPoints && totalPoints < config.minPoints)
    ? EFFICIENCY_PHASES
    : config.phases;

  executePipeline(phases, ctx);

  // 幸运非优先则后加
  if (!luckyFirst) allocateLucky(ctx);

  // 最终扫尾
  finalSweep(ctx);

  // 过滤掉0级节点
  const result: Record<string, number> = {};
  for (const [id, level] of Object.entries(ctx.allocation)) {
    if (level > 0) result[id] = level;
  }

  // 计算实际消耗
  const usedPoints = Object.entries(result).reduce((sum, [nodeId, targetLevel]) => {
    let cost = 0;
    for (let lvl = 0; lvl < targetLevel; lvl++) cost += getCost(nodeId, lvl);
    return sum + cost;
  }, 0);

  return {
    allocation: result,
    summary: { totalPoints, usedPoints, remainingPoints: totalPoints - usedPoints },
  };
}

// ==================== 技能分配管理器 ====================

class SkillAllocationManager extends BaseFeature {
  private currentSummary: SkillAllocationSummary | null = null;

  protected onInit(): void {
    logger.info('技能分配管理器初始化完成');
  }

  protected onReload(): void { }

  async reset(treeId: string = 'life'): Promise<SkillAllocationSummary> {
    logger.info(`重置技能点: ${treeId}`);
    const listenPromise = ws.waitFor('skillTree:reset:success');

    try {
      await ws.emit('skillTree:reset', { treeId });
    } catch (err) {
      logger.warn('发送重置消息失败（可能尚未连接），继续等待事件', err);
    }

    let response: any;
    try {
      response = await Promise.race([
        listenPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('重置超时')), 10000)),
      ]);
      logger.debug('重置响应事件:', response);
    } catch (err) {
      logger.error('重置等待超时或失败', err);
      try {
        const unsub = ws.once('skillTree:reset:success', (data) => {
          logger.warn('检测到延迟到达的重置响应', data);
          unsub();
        });
        setTimeout(() => unsub(), 5000);
      } catch (e) {
        logger.debug('延迟响应监听注册失败', e);
      }
      throw err;
    }

    if (response?.payload?.data?.summary) {
      this.currentSummary = response.payload.data.summary as SkillAllocationSummary;
      logger.success('技能点重置成功', this.currentSummary);
      return this.currentSummary;
    }
    throw new Error('重置失败: 未返回有效数据');
  }

  async allocate(nodeId: string, treeId: string = 'life'): Promise<SkillAllocationSummary> {
    const responsePromise = ws.requestRaw('skillTree:allocate', 'skillTree:summary:success', { treeId, nodeId });
    let response: any;
    try {
      response = await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('加点超时')), 8000)),
      ]);
    } catch (err: any) {
      logger.error('加点请求超时或失败', err);
      if (/超时/.test(String(err?.message || ''))) {
        try {
          const unsub = ws.once('skillTree:summary:success', (data) => {
            logger.warn('检测到延迟到达的加点响应', data);
            unsub();
          });
          setTimeout(() => unsub(), 5000);
        } catch (e) {
          logger.debug('延迟响应监听注册失败', e);
        }
      }
      throw err;
    }

    if (response.payload?.data?.summary) {
      this.currentSummary = response.payload.data.summary as SkillAllocationSummary;
      await sleep(30);
      return this.currentSummary;
    }
    throw new Error('加点失败: 未返回有效数据');
  }

  async autoAllocate(
    strategy: string, specialty: string, luckyFirst: boolean = false, treeId: string = 'life',
    onProgress?: (remaining: number, total: number, nodeId: string) => void,
    onResetComplete?: () => void,
  ): Promise<AllocationResult | null> {
    if (this.isRunning) {
      toast.warning('技能加点进行中');
      return null;
    }

    this._running.value = true;
    logger.info(`开始自动加点: 策略=${strategy}, 专精=${specialty}, 幸运优先=${luckyFirst}`);

    try {
      const summary = await this.reset(treeId);
      onResetComplete?.();

      const totalPoints = summary.available;
      const result = calculateTalentAllocation(totalPoints, luckyFirst, strategy, specialty);

      // 按优先级排序节点
      const orderedNodes = Object.keys(result.allocation)
        .filter((id) => result.allocation[id] > 0)
        .sort((a, b) => {
          const order = (id: string) => {
            if (id === 'l_lucky_basics') return 0;
            if (id === 'l_efficiency_basics') return 1;
            if (id.includes('_focus')) return 2;
            return 3;
          };
          return order(a) - order(b);
        });

      let totalUsedPoints = 0;
      await sleep(300);

      if (orderedNodes.length > 0) {
        onProgress?.(totalPoints - totalUsedPoints, totalPoints, getNodeDisplayName(orderedNodes[0]));
      }

      for (const nodeId of orderedNodes) {
        const targetLevel = result.allocation[nodeId];
        let completed = 0;

        while (completed < targetLevel) {
          const batchSize = Math.min(targetLevel - completed, 5);
          let successCount = 0;

          for (let i = 0; i < batchSize; i++) {
            try {
              const cost = getCost(nodeId, completed + i);
              await this.allocate(nodeId, treeId);
              successCount++;
              totalUsedPoints += cost;
              onProgress?.(totalPoints - totalUsedPoints, totalPoints, getNodeDisplayName(nodeId));
              await sleep(200);
            } catch (error) {
              logger.warn(`加点失败: ${nodeId}`, error);
            }
          }
          completed += successCount;
        }
      }

      logger.success(`自动加点完成: 总点数=${totalPoints}, 剩余=${totalPoints - totalUsedPoints}`);
      return { allocation: result.allocation, summary: result.summary };
    } catch (error) {
      logger.error('加点失败', error);
      throw error;
    } finally {
      this._running.value = false;
    }
  }

  getCurrentSummary(): SkillAllocationSummary | null {
    return this.currentSummary;
  }
}

const skillAllocationManager = new SkillAllocationManager();

// ==================== 设置变更工厂 ====================

function createSettingHandler<T>(
  setter: (v: T) => void,
  configKey: { set: (v: T) => Promise<void> },
  name: string,
) {
  return async (value: T) => {
    setter(value);
    try {
      await configKey.set(value);
    } catch (error) {
      logger.warn(`保存设置失败: ${name}`, error);
    }
  };
}

// ==================== 技能分配面板 ====================

const STRATEGY_OPTIONS = [
  { value: '效率优先', label: '效率优先' },
  { value: '产出优先', label: '产出优先' },
  { value: '材料优先', label: '材料优先' },
  { value: '产出+材料优先', label: '产出+材料优先' },
  { value: '经验优先', label: '经验优先' },
];

const SPECIALTY_OPTIONS = Object.entries(SPECIALTY_MAP).map(([key, name]) => ({ value: key, label: name }));

function SkillAllocationPanelContent({ onClose }: { onClose: () => void }) {
  const [specialty, setSpecialty] = useState('knowledge');
  const [strategy, setStrategy] = useState('产出优先');
  const [luckyFirst, setLuckyFirst] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setSpecialty(await appConfig.SKILL_ALLOCATION_SPECIALTY.get());
        setStrategy(await appConfig.SKILL_ALLOCATION_STRATEGY.get());
        setLuckyFirst(await appConfig.SKILL_ALLOCATION_LUCKY_FIRST.get());
      } catch (error) {
        logger.warn('加载设置失败', error);
      }
    };
    loadSettings();
  }, []);

  const handleSpecialtyChange = createSettingHandler(setSpecialty, appConfig.SKILL_ALLOCATION_SPECIALTY, 'specialty');
  const handleStrategyChange = createSettingHandler(setStrategy, appConfig.SKILL_ALLOCATION_STRATEGY, 'strategy');
  const handleLuckyFirstChange = createSettingHandler(setLuckyFirst, appConfig.SKILL_ALLOCATION_LUCKY_FIRST, 'luckyFirst');

  const handleAllocate = async () => {
    onClose();
    try {
      toast.progress('正在获取专精点数信息...', 'skill-allocation');
      await sleep(500);

      const result = await skillAllocationManager.autoAllocate(
        strategy, specialty, luckyFirst, 'life',
        (remaining, total, nodeName) => {
          toast.progress(`⬆️ 生活专精加点中！当前: ${nodeName}（剩余技能点: ${remaining}/${total}）`, 'skill-allocation');
        },
        () => {
          toast.progress('🧮 正在计算加点方案...', 'skill-allocation');
        },
      );

      toast.hideProgress('skill-allocation');
      if (result) {
        const details = Object.entries(result.allocation)
          .map(([nodeId, level]) => `${getNodeDisplayName(nodeId)}: ${level}`)
          .join('<br>');
        toast.success(
          `✅ 加点完成！<br><br>已使用技能点：${result.summary.usedPoints}/${result.summary.totalPoints}<br><br>💡加点详情:<br>${details}`,
          10000,
        );
      } else {
        toast.error('❌ 加点失败');
      }
    } catch (error) {
      logger.error('加点失败', error);
      toast.hideProgress('skill-allocation');
      toast.error(`❌ 加点失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  return (
    <>
      <FormGroup label="专精:">
        <Select value={specialty} onChange={handleSpecialtyChange} options={SPECIALTY_OPTIONS} />
      </FormGroup>
      <FormGroup label="优先级:">
        <Select value={strategy} onChange={handleStrategyChange} options={STRATEGY_OPTIONS} />
      </FormGroup>
      <FormGroup>
        <Checkbox checked={luckyFirst} onChange={handleLuckyFirstChange} label="幸运优先" style={{ fontWeight: '600' }} />
      </FormGroup>
      <Button onClick={handleAllocate} disabled={skillAllocationManager.running.value}>
        {skillAllocationManager.running.value ? '加点中...' : '开始加点'}
      </Button>
    </>
  );
}

export class SkillAllocationPanel extends BasePanel {
  get title() { return '🌳 生活专精加点'; }
  renderContent() { return <SkillAllocationPanelContent onClose={() => this.hide()} />; }
}
