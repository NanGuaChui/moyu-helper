/**
 * 技能点分配功能模块
 * 包含技能点分配管理器和面板
 *
 * 2026/1/29  参照鱼类自动化养殖技术交流群文件 天赋加点2.js 重写
 * 2026/2/5   增加了产出+材料优先的新策略
 */

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { appConfig } from '@/config/gm-settings';
import type { SkillAllocationSummary, AllocationResult } from '@/types/features';
import { ws, toast, BaseFeature, createLogger } from '@/core';

const logger = createLogger('SkillAllocation');
import { sleep } from '@/utils';
import { Modal, FormGroup, Select, Checkbox, Button } from '@/ui/components';

// ==================== 常量 ====================

export const SPECIALTY_MAP: Record<string, string> = {
  mining: '采矿',
  mysterious: '炼金',
  collecting: '采集',
  knowledge: '自我提升',
  forging: '锻造',
  exploring: '探索',
  manufacturing: '制造',
  cooking: '烹饪',
  farmingAnimal: '养殖',
  farmingPlant: '种植',
  sewing: '缝纫',
  specialManufacture: '特殊制造',
  fishing: '钓鱼',
};

/**
 * 根据节点ID生成完整的节点名称
 */
export function getNodeDisplayName(nodeId: string): string {
  if (nodeId === 'l_efficiency_basics') return '效率基础';
  if (nodeId === 'l_lucky_basics') return '幸运';

  const specialty = nodeId.match(/l_([^_]+)_(.+)/);
  if (specialty) {
    const spec = specialty[1];
    const type = specialty[2];
    const specialtyName = SPECIALTY_MAP[spec] || spec;

    const typeMap: Record<string, string> = {
      focus: '专精',
      extraReward: '额外产出',
      returnResource: '返还消耗',
      extraExp: '额外经验',
    };

    const typeName = typeMap[type] || type;
    return `${specialtyName}${typeName}`;
  }

  return nodeId;
}

// ==================== 天赋节点定义 ====================

interface TalentNode {
  id: string;
  name: string;
  tier: number;
  maxLevel: number;
  getCost: (level: number) => number;
  unlockRequirement?: { nodeId: string; level: number };
}

// ==================== 加点策略计算函数 ====================

function calculateTalentAllocation(
  totalPoints: number,
  luckyFirst: boolean,
  strategy: string,
  specialty: string,
): { allocation: Record<string, number>; summary: AllocationResult['summary'] } {
  const allocation: Record<string, number> = {};

  // 定义基础节点
  const baseNodes: TalentNode[] = [
    {
      id: 'l_efficiency_basics',
      name: '效率基础',
      tier: 1,
      maxLevel: 20,
      getCost: (level) => 1 + Math.floor(level / 4),
    },
    { id: 'l_lucky_basics', name: '幸运', tier: 1, maxLevel: 10, getCost: () => 15 },
  ];

  // 定义专精节点
  const getSpecialtyNodes = (spec: string): TalentNode[] => [
    {
      id: `l_${spec}_focus`,
      name: '专精',
      tier: 2,
      maxLevel: 10,
      getCost: (level) => 1 + Math.floor(level / 2),
      unlockRequirement: { nodeId: 'l_efficiency_basics', level: 2 },
    },
    {
      id: `l_${spec}_extraReward`,
      name: '额外产出',
      tier: 3,
      maxLevel: 10,
      getCost: (level) => 4 + Math.floor(level / 2),
      unlockRequirement: { nodeId: `l_${spec}_focus`, level: 7 },
    },
    {
      id: `l_${spec}_returnResource`,
      name: '返还消耗',
      tier: 3,
      maxLevel: 10,
      getCost: (level) => 4 + Math.floor(level / 2),
      unlockRequirement: { nodeId: `l_${spec}_focus`, level: 7 },
    },
    {
      id: `l_${spec}_extraExp`,
      name: '额外经验',
      tier: 3,
      maxLevel: 10,
      getCost: (level) => 4 + Math.floor(level / 2),
      unlockRequirement: { nodeId: `l_${spec}_focus`, level: 8 },
    },
  ];

  const allNodes: TalentNode[] = [...baseNodes, ...getSpecialtyNodes(specialty)];

  // 初始化所有节点等级为0
  allNodes.forEach((node) => {
    allocation[node.id] = 0;
  });

  let remainingPoints = totalPoints;

  // 计算升级所需点数
  const getUpgradeCost = (nodeId: string, currentLevel: number): number => {
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) return Infinity;

    if (node.id === 'l_lucky_basics') return 15;
    if (node.id === 'l_efficiency_basics') return 1 + Math.floor(currentLevel / 4);
    if (node.id.includes('_focus')) return 1 + Math.floor(currentLevel / 2);
    return 4 + Math.floor(currentLevel / 2);
  };

  // 检查节点是否可以升级
  const canUpgrade = (nodeId: string, currentLevel: number): boolean => {
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) return false;

    if (currentLevel >= node.maxLevel) return false;

    // 检查解锁条件
    if (node.unlockRequirement) {
      const requiredNode = allocation[node.unlockRequirement.nodeId];
      if (requiredNode < node.unlockRequirement.level) {
        return false;
      }
    }

    return true;
  };

  // 尝试升级一个节点
  const tryUpgradeNode = (nodeId: string): boolean => {
    if (!canUpgrade(nodeId, allocation[nodeId])) {
      return false;
    }

    const cost = getUpgradeCost(nodeId, allocation[nodeId]);
    if (cost <= remainingPoints) {
      allocation[nodeId]++;
      remainingPoints -= cost;
      return true;
    }

    return false;
  };

  // 幸运节点加点
  const allocateLucky = () => {
    while (allocation['l_lucky_basics'] < 10) {
      const cost = getUpgradeCost('l_lucky_basics', allocation['l_lucky_basics']);
      if (remainingPoints >= cost) {
        allocation['l_lucky_basics']++;
        remainingPoints -= cost;
      } else {
        break;
      }
    }
  };

  // 计算节点升级的效率提升
  const getEfficiencyPerPoint = (nodeId: string, currentLevel: number): number => {
    if (!canUpgrade(nodeId, currentLevel)) return 0;

    const cost = getUpgradeCost(nodeId, currentLevel);
    let efficiencyGain = 0;

    if (nodeId === 'l_efficiency_basics') {
      efficiencyGain = 0.003;
    } else if (nodeId.includes('_focus')) {
      efficiencyGain = 0.005;
    } else if (nodeId.includes('_extraReward')) {
      efficiencyGain = 0.001;
    } else if (nodeId.includes('_returnResource')) {
      efficiencyGain = 0.00066;
    } else if (nodeId.includes('_extraExp')) {
      efficiencyGain = 0;
    }

    return efficiencyGain / cost;
  };

  // 产出优先策略
  const allocateOutputFirst = () => {
    if (totalPoints < 22) {
      allocateEfficiencyFirst();
      return;
    }

    // 阶段1: 解锁基础效率节点
    if (allocation['l_efficiency_basics'] < 2) {
      while (allocation['l_efficiency_basics'] < 2 && remainingPoints > 0) {
        if (!tryUpgradeNode('l_efficiency_basics')) {
          break;
        }
      }
    }

    // 阶段2: 点专精效率到7级
    while (allocation[`l_${specialty}_focus`] < 7 && remainingPoints > 0) {
      if (!tryUpgradeNode(`l_${specialty}_focus`)) {
        break;
      }
    }

    // 阶段3: 所有点数投入额外产出
    while (remainingPoints > 0 && allocation[`l_${specialty}_extraReward`] < 10) {
      if (canUpgrade(`l_${specialty}_extraReward`, allocation[`l_${specialty}_extraReward`])) {
        if (!tryUpgradeNode(`l_${specialty}_extraReward`)) {
          break;
        }
      } else {
        break;
      }
    }

    // 阶段4: 按效率优先分配剩余点数（排除额外产出、额外经验）
    allocateRemainingPointsByEfficiency(['_extraReward', '_extraExp']);

    // 阶段5: 如果还有剩余点数，投入经验获取节点
    if (remainingPoints > 0) {
      tryAllocateExpNode();
    }
  };

  // 材料节省优先策略
  const allocateMaterialFirst = () => {
    if (totalPoints < 22) {
      allocateEfficiencyFirst();
      return;
    }

    // 阶段1: 解锁基础效率节点
    if (allocation['l_efficiency_basics'] < 2) {
      while (allocation['l_efficiency_basics'] < 2 && remainingPoints > 0) {
        if (!tryUpgradeNode('l_efficiency_basics')) {
          break;
        }
      }
    }

    // 阶段2: 点专精效率到7级
    while (allocation[`l_${specialty}_focus`] < 7 && remainingPoints > 0) {
      if (!tryUpgradeNode(`l_${specialty}_focus`)) {
        break;
      }
    }

    // 阶段3: 所有点数投入返还材料
    while (remainingPoints > 0 && allocation[`l_${specialty}_returnResource`] < 10) {
      if (canUpgrade(`l_${specialty}_returnResource`, allocation[`l_${specialty}_returnResource`])) {
        if (!tryUpgradeNode(`l_${specialty}_returnResource`)) {
          break;
        }
      } else {
        break;
      }
    }

    // 阶段4: 按效率优先分配剩余点数（排除返还材料、额外经验）
    allocateRemainingPointsByEfficiency(['_returnResource', '_extraExp']);

    // 阶段5: 如果还有剩余点数，投入经验获取节点
    if (remainingPoints > 0) {
      tryAllocateExpNode();
    }
  };

  const allocateRemainingPointsByEfficiency = (excludeNodes: string[] = []) => {
    let upgraded = true;

    while (remainingPoints > 0 && upgraded) {
      upgraded = false;

      const upgradeableNodes = allNodes
        .filter((node) => {
          if (node.id === 'l_lucky_basics') return false;
          if (excludeNodes.some((exclude) => node.id.includes(exclude))) return false;
          if (!canUpgrade(node.id, allocation[node.id])) return false;

          return true;
        })
        .map((node) => {
          const cost = getUpgradeCost(node.id, allocation[node.id]);
          const efficiency = getEfficiencyPerPoint(node.id, allocation[node.id]);
          return {
            id: node.id,
            efficiencyPerPoint: efficiency,
            cost: cost,
            efficiency: efficiency * cost,
          };
        })
        .filter((node) => node.efficiencyPerPoint > 0 && node.cost <= remainingPoints)
        .sort((a, b) => {
          if (b.efficiencyPerPoint !== a.efficiencyPerPoint) {
            return b.efficiencyPerPoint - a.efficiencyPerPoint;
          }
          return b.efficiency - a.efficiency;
        });

      if (upgradeableNodes.length === 0) {
        break;
      }

      const bestNode = upgradeableNodes[0];

      if (canUpgrade(bestNode.id, allocation[bestNode.id])) {
        const cost = getUpgradeCost(bestNode.id, allocation[bestNode.id]);

        if (cost <= remainingPoints) {
          allocation[bestNode.id]++;
          remainingPoints -= cost;
          upgraded = true;
        }
      }

      if (!upgraded) {
        break;
      }
    }

    // 如果还有剩余点数，尝试寻找更便宜的升级
    if (remainingPoints > 0) {
      const affordableNodes = allNodes
        .filter((node) => {
          if (node.id === 'l_lucky_basics') return false;
          if (excludeNodes.some((exclude) => node.id.includes(exclude))) return false;
          if (!canUpgrade(node.id, allocation[node.id])) return false;

          const cost = getUpgradeCost(node.id, allocation[node.id]);
          return cost <= remainingPoints;
        })
        .sort((a, b) => {
          const costA = getUpgradeCost(a.id, allocation[a.id]);
          const costB = getUpgradeCost(b.id, allocation[b.id]);
          return costA - costB;
        });

      if (affordableNodes.length > 0) {
        const cheapestNode = affordableNodes[0];
        const cost = getUpgradeCost(cheapestNode.id, allocation[cheapestNode.id]);

        if (cost <= remainingPoints) {
          allocation[cheapestNode.id]++;
          remainingPoints -= cost;
        }
      }
    }
  };

  // 尝试为经验获取节点加点
  const tryAllocateExpNode = () => {
    const expNodeId = `l_${specialty}_extraExp`;

    if (allocation[expNodeId] >= 10) {
      return;
    }

    if (allocation[`l_${specialty}_focus`] < 8) {
      while (allocation[`l_${specialty}_focus`] < 8 && remainingPoints > 0) {
        if (!tryUpgradeNode(`l_${specialty}_focus`)) {
          break;
        }
      }
    }

    if (allocation[`l_${specialty}_focus`] >= 8) {
      while (remainingPoints > 0 && allocation[expNodeId] < 10) {
        if (!tryUpgradeNode(expNodeId)) {
          break;
        }
      }
    }
  };

  // 效率优先策略
  const allocateEfficiencyFirst = () => {
    // 阶段1: 基础效率至少2级
    while (allocation['l_efficiency_basics'] < 2 && remainingPoints > 0) {
      if (!tryUpgradeNode('l_efficiency_basics')) {
        break;
      }
    }

    // 阶段2: 如果总点数>=22，解锁专精7级
    if (totalPoints >= 22) {
      while (allocation[`l_${specialty}_focus`] < 7 && remainingPoints > 0) {
        if (!tryUpgradeNode(`l_${specialty}_focus`)) {
          break;
        }
      }

      if (
        allocation[`l_${specialty}_focus`] >= 7 &&
        allocation[`l_${specialty}_extraReward`] === 0 &&
        remainingPoints > 0
      ) {
        tryUpgradeNode(`l_${specialty}_extraReward`);
      }

      if (totalPoints >= 28) {
        if (
          allocation[`l_${specialty}_focus`] >= 7 &&
          allocation[`l_${specialty}_returnResource`] === 0 &&
          remainingPoints > 0
        ) {
          tryUpgradeNode(`l_${specialty}_returnResource`);
        }
      }
    }

    // 阶段3: 按效率优先分配剩余点数（排除额外经验）
    allocateRemainingPointsByEfficiency(['_extraExp']);

    // 阶段4: 如果还有剩余点数，尝试解锁并投入额外经验节点
    if (remainingPoints > 0) {
      tryAllocateExpNode();
    }
  };

  // 经验优先策略
  const allocateExperienceFirst = () => {
    if (totalPoints < 24) {
      allocateEfficiencyFirst();
      return;
    }

    // 阶段1: 解锁基础效率节点
    if (allocation['l_efficiency_basics'] < 2) {
      while (allocation['l_efficiency_basics'] < 2 && remainingPoints > 0) {
        if (!tryUpgradeNode('l_efficiency_basics')) {
          break;
        }
      }
    }

    // 阶段2: 点专精效率到8级
    while (allocation[`l_${specialty}_focus`] < 8 && remainingPoints > 0) {
      if (!tryUpgradeNode(`l_${specialty}_focus`)) {
        break;
      }
    }

    // 阶段3: 所有点数投入额外经验
    while (remainingPoints > 0 && allocation[`l_${specialty}_extraExp`] < 10) {
      if (canUpgrade(`l_${specialty}_extraExp`, allocation[`l_${specialty}_extraExp`])) {
        if (!tryUpgradeNode(`l_${specialty}_extraExp`)) {
          break;
        }
      } else {
        break;
      }
    }

    // 阶段4: 按效率优先分配剩余点数（排除额外经验）
    allocateRemainingPointsByEfficiency(['_extraExp']);
  };

  // 产出+材料优先：额外产出和返还材料按1:1平均加点
  const allocateBalanced = () => {
    // 阶段1: 解锁基础效率节点
    if (allocation['l_efficiency_basics'] < 2) {
      while (allocation['l_efficiency_basics'] < 2 && remainingPoints > 0) {
        if (!tryUpgradeNode('l_efficiency_basics')) {
          break;
        }
      }
    }

    // 阶段2: 点专精效率到7级
    while (allocation[`l_${specialty}_focus`] < 7 && remainingPoints > 0) {
      if (!tryUpgradeNode(`l_${specialty}_focus`)) {
        break;
      }
    }

    // 阶段3: 按照1额外产出1返还材料的策略平均加点
    const extraRewardNodeId = `l_${specialty}_extraReward`;
    const returnResourceNodeId = `l_${specialty}_returnResource`;

    while (remainingPoints > 0) {
      const canUpgradeReward =
        allocation[extraRewardNodeId] < 10 && canUpgrade(extraRewardNodeId, allocation[extraRewardNodeId]);
      const canUpgradeReturn =
        allocation[returnResourceNodeId] < 10 && canUpgrade(returnResourceNodeId, allocation[returnResourceNodeId]);

      // 如果两个节点都达到上限或都无法升级，退出
      if (!canUpgradeReward && !canUpgradeReturn) {
        break;
      }

      // 优先升级等级较低的节点，保持1:1平衡
      const nodeToUpgrade = !canUpgradeReward
        ? returnResourceNodeId
        : !canUpgradeReturn
          ? extraRewardNodeId
          : allocation[extraRewardNodeId] <= allocation[returnResourceNodeId]
            ? extraRewardNodeId
            : returnResourceNodeId;

      const cost = getUpgradeCost(nodeToUpgrade, allocation[nodeToUpgrade]);
      if (cost <= remainingPoints) {
        allocation[nodeToUpgrade]++;
        remainingPoints -= cost;
      } else {
        break;
      }
    }

    // 阶段4: 剩余点数按效率优先级分配
    allocateRemainingPointsByEfficiency(['_extraExp']);

    // 阶段5: 如果还有剩余点数，投入经验获取节点
    if (remainingPoints > 0) {
      tryAllocateExpNode();
    }
  };

  // 主加点逻辑
  if (luckyFirst) {
    allocateLucky();
  }

  switch (strategy) {
    case '效率优先':
      allocateEfficiencyFirst();
      break;
    case '产出优先':
      allocateOutputFirst();
      break;
    case '材料优先':
      allocateMaterialFirst();
      break;
    case '经验优先':
      allocateExperienceFirst();
      break;
    case '产出+材料优先':
      allocateBalanced();
      break;
    default:
      allocateEfficiencyFirst();
  }

  if (!luckyFirst) {
    allocateLucky();
  }

  // 最终优化：如果还有剩余点数，尝试升级任何节点
  if (remainingPoints > 0) {
    // 优先尝试升级幸运
    while (allocation['l_lucky_basics'] < 10) {
      const cost = getUpgradeCost('l_lucky_basics', allocation['l_lucky_basics']);
      if (remainingPoints >= cost) {
        allocation['l_lucky_basics']++;
        remainingPoints -= cost;
      } else {
        break;
      }
    }

    const allRemainingNodes = allNodes
      .filter((node) => canUpgrade(node.id, allocation[node.id]))
      .map((node) => ({
        id: node.id,
        cost: getUpgradeCost(node.id, allocation[node.id]),
      }))
      .filter((node) => node.cost <= remainingPoints)
      .sort((a, b) => a.cost - b.cost);

    for (const node of allRemainingNodes) {
      if (remainingPoints >= node.cost) {
        allocation[node.id]++;
        remainingPoints -= node.cost;
      }
    }
  }

  // 移除等级为0的节点
  const result: Record<string, number> = {};
  Object.keys(allocation).forEach((nodeId) => {
    if (allocation[nodeId] > 0) {
      result[nodeId] = allocation[nodeId];
    }
  });

  // 计算实际消耗的技能点（每次升级的成本累加）
  const usedPoints = Object.entries(result).reduce((sum, [nodeId, targetLevel]) => {
    let cost = 0;
    for (let level = 0; level < targetLevel; level++) {
      cost += getUpgradeCost(nodeId, level);
    }
    return sum + cost;
  }, 0);

  return {
    allocation: result,
    summary: {
      totalPoints,
      usedPoints,
      remainingPoints: totalPoints - usedPoints,
    },
  };
}

// ==================== 技能分配管理器 ====================

class SkillAllocationManager extends BaseFeature {
  private currentSummary: SkillAllocationSummary | null = null;

  protected onInit(): void {
    logger.info('技能分配管理器初始化完成');
  }

  protected onReload(): void {
    // 技能分配管理器没有配置项需要重载
  }

  async reset(treeId: string = 'life'): Promise<SkillAllocationSummary> {
    logger.info(`重置技能点: ${treeId}`);
    // 先发送重置消息，再等待 `skillTree:reset:success` 事件
    const timeoutMs = 10000;

    // 先准备监听器 promise
    const listenPromise = ws.waitFor('skillTree:reset:success');

    // 发送重置请求（不等待响应）
    try {
      await ws.emit('skillTree:reset', { treeId });
    } catch (err) {
      logger.warn('发送重置消息失败（可能尚未连接），继续等待事件', err);
    }

    let response: any = null;
    try {
      response = await Promise.race([
        listenPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('重置超时')), timeoutMs)),
      ]);
      logger.debug('重置响应事件:', response);
    } catch (err: any) {
      logger.error('重置等待超时或失败', err);

      // 尝试短时监听延迟到达的响应以便排查
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

    // 如果响应包含 summary，则直接使用
    if (response?.payload?.data?.summary) {
      this.currentSummary = response.payload.data.summary as SkillAllocationSummary;
      logger.success('技能点重置成功', this.currentSummary);
      return this.currentSummary;
    }

    throw new Error('重置失败: 未返回有效数据');
  }

  async allocate(nodeId: string, treeId: string = 'life'): Promise<SkillAllocationSummary> {
    const timeoutMs = 8000;
    const responsePromise = ws.requestRaw('skillTree:allocate', 'skillTree:summary:success', {
      treeId,
      nodeId,
    });
    let response: any;
    try {
      response = await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('加点超时')), timeoutMs)),
      ]);
    } catch (err: any) {
      logger.error('加点请求超时或失败', err);

      if (err && /超时/.test(String(err.message || ''))) {
        try {
          const lateEvent = 'skillTree:summary:success';
          const unsub = ws.once(lateEvent, (data) => {
            logger.warn('检测到延迟到达的加点响应', data);
            unsub();
          });
          setTimeout(() => unsub(), 5000);
        } catch (err) {
          logger.debug('延迟响应监听注册失败', err);
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
    strategy: string,
    specialty: string,
    luckyFirst: boolean = false,
    treeId: string = 'life',
    onProgress?: (remaining: number, total: number, nodeId: string) => void,
    onResetComplete?: () => void,
  ): Promise<AllocationResult | null> {
    if (this.isRunning) {
      toast.warning('技能加点进行中');
      return null;
    }

    this._running = true;
    logger.info(`开始自动加点: 策略=${strategy}, 专精=${specialty}, 幸运优先=${luckyFirst}`);

    try {
      const summary = await this.reset(treeId);

      // reset 完成后调用回调
      onResetComplete?.();

      const totalPoints = summary.available;

      // 计算加点方案
      const result = calculateTalentAllocation(totalPoints, luckyFirst, strategy, specialty);

      // 按优先级执行加点
      const baseEfficiencyNodes: string[] = [];
      const specialtyFocusNodes: string[] = [];
      const otherNodes: string[] = [];

      Object.entries(result.allocation).forEach(([nodeId, targetLevel]) => {
        if (targetLevel === 0) return;

        if (nodeId === 'l_lucky_basics') {
          baseEfficiencyNodes.unshift(nodeId);
        } else if (nodeId === 'l_efficiency_basics') {
          baseEfficiencyNodes.push(nodeId);
        } else if (nodeId.includes('_focus')) {
          specialtyFocusNodes.push(nodeId);
        } else {
          otherNodes.push(nodeId);
        }
      });

      const orderedNodes = [...baseEfficiencyNodes, ...specialtyFocusNodes, ...otherNodes];

      let totalUsedPoints = 0;

      // 等待一下，让用户看到"正在计算加点方案..."的提示
      await sleep(300);

      // 显示第一个要加的节点
      if (orderedNodes.length > 0) {
        const firstNodeId = orderedNodes[0];
        const firstNodeName = getNodeDisplayName(firstNodeId);
        onProgress?.(totalPoints - totalUsedPoints, totalPoints, firstNodeName);
      }

      // 按照优先级顺序执行加点
      for (const nodeId of orderedNodes) {
        const targetLevel = result.allocation[nodeId];
        if (!targetLevel || targetLevel === 0) continue;

        let nodeCompletedUpgrades = 0;

        while (nodeCompletedUpgrades < targetLevel) {
          const batchSize = Math.min(targetLevel - nodeCompletedUpgrades, 5);
          let successCount = 0;

          for (let i = 0; i < batchSize; i++) {
            try {
              const currentLevel = nodeCompletedUpgrades + i;
              // 计算升级成本
              let cost: number;
              if (nodeId === 'l_lucky_basics') {
                cost = 15;
              } else if (nodeId === 'l_efficiency_basics') {
                cost = 1 + Math.floor(currentLevel / 4);
              } else if (nodeId.includes('_focus')) {
                cost = 1 + Math.floor(currentLevel / 2);
              } else {
                cost = 4 + Math.floor(currentLevel / 2);
              }

              await this.allocate(nodeId, treeId);
              successCount++;
              totalUsedPoints += cost;

              const nodeName = getNodeDisplayName(nodeId);
              onProgress?.(totalPoints - totalUsedPoints, totalPoints, nodeName);

              await sleep(200);
            } catch (error) {
              logger.warn(`加点失败: ${nodeId}`, error);
            }
          }

          nodeCompletedUpgrades += successCount;
        }
      }

      logger.success(`自动加点完成: 总点数=${totalPoints}, 剩余=${totalPoints - totalUsedPoints}`);

      return { allocation: result.allocation, summary: result.summary };
    } catch (error) {
      logger.error('加点失败', error);
      throw error;
    } finally {
      this._running = false;
    }
  }

  getCurrentSummary(): SkillAllocationSummary | null {
    return this.currentSummary;
  }
}

export const skillAllocationManager = new SkillAllocationManager();

// ==================== 技能分配面板 ====================

function SkillAllocationPanelContent({ onClose }: { onClose: () => void }) {
  const [specialty, setSpecialty] = useState('knowledge');
  const [strategy, setStrategy] = useState('产出优先');
  const [luckyFirst, setLuckyFirst] = useState(true);
  const [isProcessing, setIsProcessing] = useState(skillAllocationManager.isRunning);

  // 加载保存的设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setSpecialty(await appConfig.SKILL_ALLOCATION_SPECIALTY.get());
        setStrategy(await appConfig.SKILL_ALLOCATION_STRATEGY.get());
        setLuckyFirst(await appConfig.SKILL_ALLOCATION_LUCKY_FIRST.get());
        setIsProcessing(skillAllocationManager.isRunning);
      } catch (error) {
        logger.warn('加载设置失败', error);
      }
    };
    loadSettings();
  }, []);

  const handleSpecialtyChange = async (value: string) => {
    setSpecialty(value);
    try {
      await appConfig.SKILL_ALLOCATION_SPECIALTY.set(value);
    } catch (error) {
      logger.warn('保存设置失败: specialty', error);
    }
  };

  const handleStrategyChange = async (value: string) => {
    setStrategy(value);
    try {
      await appConfig.SKILL_ALLOCATION_STRATEGY.set(value);
    } catch (error) {
      logger.warn('保存设置失败: strategy', error);
    }
  };

  const handleLuckyFirstChange = async (value: boolean) => {
    setLuckyFirst(value);
    try {
      await appConfig.SKILL_ALLOCATION_LUCKY_FIRST.set(value);
    } catch (error) {
      logger.warn('保存设置失败: luckyFirst', error);
    }
  };

  const specialtyOptions = Object.entries(SPECIALTY_MAP).map(([key, name]) => ({
    value: key,
    label: name,
  }));

  const strategyOptions = [
    { value: '效率优先', label: '效率优先' },
    { value: '产出优先', label: '产出优先' },
    { value: '材料优先', label: '材料优先' },
    { value: '产出+材料优先', label: '产出+材料优先' },
    { value: '经验优先', label: '经验优先' },
  ];

  const handleAllocate = async () => {
    // 点击后立即关闭窗口
    onClose();

    // 异步执行加点操作,通过持续显示的 toast 显示进度
    try {
      toast.progress('正在获取专精点数信息...', 'skill-allocation');

      await sleep(500);

      const result = await skillAllocationManager.autoAllocate(
        strategy,
        specialty,
        luckyFirst,
        'life',
        (remaining, total, nodeId) => {
          const nodeName = getNodeDisplayName(nodeId);
          toast.progress(
            `⬆️ 生活专精加点中！当前: ${nodeName}（剩余技能点: ${remaining}/${total}）`,
            'skill-allocation',
          );
        },
        () => {
          toast.progress('🧮 正在计算加点方案...', 'skill-allocation');
        },
      );

      if (result) {
        const allocationDetails = Object.entries(result.allocation)
          .map(([nodeId, level]) => `${getNodeDisplayName(nodeId)}: ${level}`)
          .join('<br>');
        toast.hideProgress('skill-allocation');
        toast.success(
          `✅ 加点完成！<br><br>已使用技能点：${result.summary.usedPoints}/${result.summary.totalPoints}<br><br>💡加点详情:<br>${allocationDetails}`,
          10000,
        );
      } else {
        toast.hideProgress('skill-allocation');
        toast.error('❌ 加点失败');
      }
    } catch (error) {
      logger.error('加点失败', error);
      const msg = error instanceof Error ? error.message : '未知错误';
      toast.hideProgress('skill-allocation');
      toast.error(`❌ 加点失败: ${msg}`);
    }
  };

  return (
    <>
      <FormGroup label="专精:">
        <Select value={specialty} onChange={handleSpecialtyChange} options={specialtyOptions} />
      </FormGroup>

      <FormGroup label="优先级:">
        <Select value={strategy} onChange={handleStrategyChange} options={strategyOptions} />
      </FormGroup>

      <FormGroup>
        <Checkbox
          checked={luckyFirst}
          onChange={handleLuckyFirstChange}
          label="幸运优先"
          style={{ fontWeight: '600' }}
        />
      </FormGroup>

      <Button onClick={handleAllocate} disabled={isProcessing}>
        {isProcessing ? '加点中...' : '开始加点'}
      </Button>

    </>
  );
}

export class SkillAllocationPanel {
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
      <Modal isOpen={true} onClose={() => this.hide()} title="🌳 生活专精加点">
        <SkillAllocationPanelContent onClose={() => this.hide()} />
      </Modal>,
      this.container,
    );
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.container) {
      render(null, this.container);
      this.container.remove();
      this.container = null;
    }
  }
}
