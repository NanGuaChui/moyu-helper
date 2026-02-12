/**
 * 技能名称与分类配置
 *
 * zeroDamage: 标记为 true 的技能在释放时不直接造成伤害（辅助/召唤/Debuff 类），
 *             战斗统计中仅记录使用次数。
 *             新增伤害技能无需添加此标记，默认走伤害统计路径。
 */

export interface SkillDef {
  name: string;
  /** 释放时不直接造成伤害的技能标记为 true */
  zeroDamage?: true;
}

const skillDefs: Record<string, SkillDef> = {
  // ── 玩家 / 装备技能 ──────────────────────────────────────────
  echoShieldBash: { name: '黑岩盾击' },
  boneBreaker: { name: '碎骨重击' },
  quakeSlam: { name: '震地猛击' },
  voidSpawn: { name: '渊裔唤生', zeroDamage: true },
  siphonPulse: { name: '魔力汲取', zeroDamage: true },
  cdhbFormShiftSkill: { name: '深渊之触', zeroDamage: true },
  abyssalTideForCdHb: { name: '深渊洪流' },
  brainwashing: { name: '洗脑', zeroDamage: true },
  qeDirgeCataclysm: { name: '寂鸣灾谣', zeroDamage: true },
  bcScepterOfNigh: { name: '问罪', zeroDamage: true },
  bcCrowningMidnight: { name: '临御', zeroDamage: true },
  knowledgeCrownSkill: { name: '集智', zeroDamage: true },
  dominationSealSkill: { name: '统御', zeroDamage: true },
  blinkshadowGirdleSkill: { name: '瞬影' },
  intertwinedCatEyeGenesisEssenceStaffSkill: { name: '交织' },
  meowColossusLaser: { name: '巨像激光' },
  denseFogSpriteAttack: { name: '迷雾幽灵攻击' },
  denseFogSpriteAttackBoss: { name: '迷雾幽灵攻击' },
  beastpackRoar: { name: '兽群咆哮' },

  // ── 生活技能 ─────────────────────────────────────────────────
  chefSkill: { name: '爆炒' },
  forgeSkillCraftMeowColossus: { name: '制造喵喵巨像', zeroDamage: true },
  forgeSkillCraftTurret: { name: '制造炮台', zeroDamage: true },
  natureGift: { name: '自然馈赠', zeroDamage: true },
  threadingNeedle: { name: '穿针引线' },
  knowledgeInspiration: { name: '知识启迪', zeroDamage: true },
  sowMelonsReapMelons: { name: '种瓜得瓜', zeroDamage: true },
  enhanceEmpower: { name: '强化赋能', zeroDamage: true },
  enhanceStrike: { name: '强化冲击' },
  fishmanSkill: { name: 'fishmanSkill', zeroDamage: true },

  // ── 怪物 / 通用技能 ─────────────────────────────────────────
  baseAttack: { name: '普通攻击' },
  boneShield: { name: '骨盾', zeroDamage: true },
  corrosiveBreath: { name: '腐蚀吐息' },
  summonBerryBird: { name: '召唤浆果鸟', zeroDamage: true },
  baseHeal: { name: '基础治疗', zeroDamage: true },
  poison: { name: '中毒', zeroDamage: true },
  selfHeal: { name: '自我疗愈', zeroDamage: true },
  sweep: { name: '横扫' },
  baseGroupHeal: { name: '基础群体治疗', zeroDamage: true },
  powerStrike: { name: '重击' },
  guardianLaser: { name: '守护者激光' },
  lavaBreath: { name: '熔岩吐息' },
  dragonRoar: { name: '龙之咆哮' },
  doubleStrike: { name: '双重打击' },
  lowestHpStrike: { name: '弱点打击' },
  explosiveShot: { name: '爆炸射击' },
  freeze: { name: '冻结' },
  iceBomb: { name: '冰弹' },
  lifeDrain: { name: '吸血' },
  roar: { name: '咆哮' },
  blizzard: { name: '暴风雪' },
  ironWall: { name: '铁壁', zeroDamage: true },
  curse: { name: '诅咒', zeroDamage: true },
  shadowBurst: { name: '暗影爆发' },
  groupCurse: { name: '群体诅咒', zeroDamage: true },
  holyLight: { name: '神圣之光', zeroDamage: true },
  bless: { name: '祝福', zeroDamage: true },
  revive: { name: '复活', zeroDamage: true },
  groupRegen: { name: '群体再生', zeroDamage: true },
  astralBarrier: { name: '星辉结界', zeroDamage: true },
  astralBlast: { name: '星辉冲击' },
  groupSilence: { name: '群体沉默', zeroDamage: true },
  selfRepair: { name: '自我修复', zeroDamage: true },
  cleanse: { name: '驱散', zeroDamage: true },
  cometStrike: { name: '彗星打击' },
  armorBreak: { name: '破甲' },
  starTrap: { name: '星辰陷阱', zeroDamage: true },
  emperorCatFinale_forAstralEmpressBoss: { name: '星辉终极裁决' },
  astralStorm: { name: '星辉风暴' },
  groupShield: { name: '群体护盾', zeroDamage: true },

  // ── 刺客 / 影爪 ─────────────────────────────────────────────
  sneak: { name: '潜行', zeroDamage: true },
  ambush: { name: '偷袭' },
  poisonClaw: { name: '毒爪' },
  shadowStep: { name: '暗影步', zeroDamage: true },
  silenceStrike: { name: '沉默打击' },
  slientSmokeScreen: { name: '静默烟雾弹', zeroDamage: true },
  mirrorImage: { name: '镜像影分身', zeroDamage: true },
  shadowAssassinUlt: { name: '绝影连杀' },

  // ── 嘉年华 ──────────────────────────────────────────────────
  stardustMouseSwap: { name: '偷天换日', zeroDamage: true },
  dizzySpin: { name: '眩晕旋转' },
  carouselOverdrive: { name: '失控加速' },
  candyBomb: { name: '糖果爆裂' },
  prankSmoke: { name: '恶作剧烟雾', zeroDamage: true },
  mercenaryTaunt: { name: '嘲讽', zeroDamage: true },
  plushTaunt: { name: '毛绒嘲讽', zeroDamage: true },
  starlightSanctuary: { name: '星光治愈', zeroDamage: true },
  ghostlyStrike: { name: '鬼影冲锋' },
  paradeHorn: { name: '狂欢号角', zeroDamage: true },
  clownSummon: { name: '小丑召集令', zeroDamage: true },
  kingAegis: { name: '猫王庇护', zeroDamage: true },

  // ── 禁魔图书馆 ──────────────────────────────────────────────
  sealMagic: { name: '封印魔法' },
  banish: { name: '驱逐' },
  bind: { name: '束缚' },
  detectMagic: { name: '识破魔法' },
  punish: { name: '惩戒' },
  confuse: { name: '扰乱', zeroDamage: true },
  forbiddenMagic: { name: '禁忌魔法' },
  ultimateLibraryJudgement: { name: '禁魔审判' },

  // ── 恶魔监狱 ────────────────────────────────────────────────
  chainWhip: { name: '锁链鞭打' },
  fearInduction: { name: '恐惧', zeroDamage: true },
  soulDrain: { name: '灵魂吸取' },
  demonicRage: { name: '恶魔狂怒', zeroDamage: true },
  spectralClaw: { name: '幽灵利爪' },
  hauntingWail: { name: '哀嚎怨声' },
  vengeanceStrike: { name: '复仇一击' },
  despairAura: { name: '绝望光环', zeroDamage: true },
  phantomStrike: { name: '幽灵突击' },
  mentalBreak: { name: '精神崩溃' },
  painAmplifier: { name: '痛苦放大', zeroDamage: true },
  tortureProtocol: { name: '酷刑程序' },
  mechanicalGrip: { name: '机械钳制' },
  shadowCorruption: { name: '暗影腐蚀' },
  nightmareSlam: { name: '噩梦重击' },
  apocalypticRoar: { name: '末日咆哮' },
  prisonDomination: { name: '监狱统治' },
  darkRitual: { name: '黑暗仪式', zeroDamage: true },
  strengthInKittyNumbers: { name: '喵多势众' },
  lightsOut: { name: '熄灯', zeroDamage: true },
};

// ── 导出工具函数 ───────────────────────────────────────────────

/** 获取技能中文名，未知技能返回 skillId 本身 */
export function getSkillName(skillId: string): string {
  return skillDefs[skillId]?.name ?? skillId;
}

/** 判断技能是否为零伤害技能（辅助/召唤/Debuff 类） */
export function isZeroDamageSkill(skillId: string): boolean {
  return skillDefs[skillId]?.zeroDamage === true;
}

/** 通过中文名反查 skillId */
export function findSkillIdByName(name: string): string | undefined {
  return Object.entries(skillDefs).find(([, def]) => def.name === name)?.[0];
}

export default skillDefs;
