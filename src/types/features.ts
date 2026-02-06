/**
 * 功能模块类型定义
 * 汇总所有功能模块的类型定义
 */

// ==================== 技能分配相关类型 ====================

export interface SkillAllocationSummary {
  treeId: string;
  totalEarned: number;
  totalSpent: number;
  effectiveSpent: number;
  available: number;
  nodeLevels: Record<string, number>;
  canAllocate: Record<string, boolean>;
  unmetReasons: Record<string, string[]>;
}

export interface AllocationResult {
  allocation: Record<string, number>;
  summary: {
    totalPoints: number;
    usedPoints: number;
    remainingPoints: number;
  };
}

// ==================== 资源监控相关类型 ====================

export interface ResourceItem {
  name: string;
  count: number;
  threshold: number;
  type: 'insufficient' | 'excess';
}
