/**
 * 战斗统计类型定义
 */

/** 技能统计数据 */
export interface SkillStats {
  totalDamage: number;
  totalLossMP: number;
  actionCount: number;
  maxDamage: number;
  averageDamage: number;
  firstTime: number | null;
  lastTime: number | null;
}

/** 玩家统计数据 */
export interface PlayerStats {
  name: string;
  totalDamage: number;
  totalLossMP: number;
  totalRestoreMP: number;
  totalHeal: number;
  totalReceivedDamage: number;
  totalActions: number;
  totalSSCC: number;
  firstActionTime: number | null;
  lastActionTime: number | null;
  skills: Record<string, SkillStats>;
}

/** 战斗元数据 */
export interface BattleMeta {
  startTime: number | null;
  totalActions: number;
  totalWaves: number;
}

/** 全局玩家信息 */
export interface GlobalPlayerInfo {
  name: string;
  uuid: string;
  isPlayer: boolean;
}

/** 召唤物映射信息 */
export interface SummonInfo {
  ownerUuid: string;
  summonName: string;
  summonUuid: string;
}
