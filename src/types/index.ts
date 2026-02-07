/**
 * 类型定义模块导出
 * 只导出实际使用的类型
 */
export * from './panel';
export * from './websocket';
export * from './game-data';

/**
 * 物品制造依赖配置
 */
export interface CraftDependency {
  itemId: string;
  count: number;
  label?: string; // 中文名称
}

/**
 * 物品产出配置
 */
export interface CraftReward {
  itemId: string;
  count: number; // 期望产出数量（基础数量 × 概率）
  label?: string; // 中文名称
}

/**
 * 可制造物品配置
 */
export interface CraftItem {
  label: string;
  value: string;
  actionId: string;
  rewards: CraftReward[]; // 所有产出物品
  dependencies?: CraftDependency[];
  banToKitty?: boolean; // 是否禁止小猫制造
}

/**
 * 按分类组织的制造物品配置
 */
export interface CraftItemCategory {
  label: string;
  value: string;
  items: CraftItem[];
}
