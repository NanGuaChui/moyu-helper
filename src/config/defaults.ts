/**
 * 监控类型
 * - insufficient: 资源不足监控（低于阈值时报警）
 * - excess: 资源过量监控（高于阈值时报警）
 */
export type MonitorType = 'insufficient' | 'excess';

/**
 * 食物类型
 */
export type FoodType = 'berry' | 'fish' | 'luxuryCatFood';

/**
 * 资源配置接口
 */
export interface ResourceConfig {
  threshold: number;
  type: MonitorType;
}

/**
 * 资源分类接口
 */
export interface ResourceCategory {
  name: string;
  items: Record<string, ResourceConfig>;
}

/**
 * 默认监控资源配置
 */
export const DEFAULT_RESOURCES: ResourceCategory[] = [
  {
    name: '基础资源',
    items: {
      berry: { threshold: 600000, type: 'insufficient' },
      fish: { threshold: 100000, type: 'insufficient' },
      wood: { threshold: 1000000, type: 'insufficient' },
      stone: { threshold: 1000000, type: 'insufficient' },
      coal: { threshold: 1000000, type: 'insufficient' },
      treasureMap: { threshold: 0, type: 'insufficient' },
    },
  },
  {
    name: '制作材料',
    items: {
      paper: { threshold: 500, type: 'insufficient' },
      book: { threshold: 100, type: 'insufficient' },
      pencil: { threshold: 5, type: 'insufficient' },
    },
  },
  {
    name: '食物',
    items: {
      simpleSalad: { threshold: 2000, type: 'insufficient' },
      fishSoup: { threshold: 96, type: 'insufficient' },
      ryeBread: { threshold: 288, type: 'insufficient' },
      custardPudding: { threshold: 96, type: 'insufficient' },
      cloudFluffCandy: { threshold: 96, type: 'insufficient' },
    },
  },
  {
    name: '饮品',
    items: {
      berryWine: { threshold: 192, type: 'insufficient' },
      dawnBlossomWine: { threshold: 48, type: 'insufficient' },
      windBellWine: { threshold: 48, type: 'insufficient' },
    },
  },
  {
    name: '种子',
    items: {
      berrySeed: { threshold: 500, type: 'insufficient' },
      grapeSeed: { threshold: 500, type: 'insufficient' },
      ryeSeed: { threshold: 500, type: 'insufficient' },
      dawnBlossomSeed: { threshold: 500, type: 'insufficient' },
      windBellHerbSeed: { threshold: 500, type: 'insufficient' },
    },
  },
  {
    name: '猫咪用品',
    items: {
      autoFeeder: { threshold: 3, type: 'insufficient' },
      scratchingPost: { threshold: 3, type: 'insufficient' },
      cashmereToy: { threshold: 3, type: 'insufficient' },
      silkKittyNest: { threshold: 3, type: 'insufficient' },
      silkCurtain: { threshold: 3, type: 'insufficient' },
    },
  },
  {
    name: '其他',
    items: {
      moonPearl: { threshold: 5, type: 'excess' },
      cutePoint: { threshold: 120, type: 'excess' },
      bookOfWorkSkillTreePoint: { threshold: 1, type: 'excess' },
      bookOfBattleSkillTreePoint: { threshold: 1, type: 'excess' },
    },
  },
];

/**
 * 任务类型分类配置
 */
export const QUEST_TASK_TYPES: Record<string, string[]> = {
  采集: [
    '种植',
    '种植葡萄',
    '种植黑麦',
    '采蘑菇',
    '采浆果',
    '采草药',
    '采集花草',
    '采蜂蜜',
    '砍树',
    '砍竹子',
    '捡贝壳',
    '挖沙',
    '收集云絮',
    '收集彩虹碎片',
  ],
  钓鱼: ['钓鱼', '捞鱼', '猫咪捕鱼', '深海捕鱼', '神秘钓鱼'],
  烹饪: [
    '制作野草沙拉',
    '制作野果拼盘',
    '熬制鱼汤',
    '炖蘑菇汤',
    '制作猫薄荷饼干',
    '制作猫咪零食',
    '烤制浆果派',
    '制作豪华猫粮',
    '制作鲜鱼刺身拼盘',
    '制作蛋奶布丁',
    '制作幸运曲奇',
    '制作幸运鲜鱼刺身',
    '制作超级幸运浆果派',
    '制作超级香浓蘑菇汤',
    '制作黑麦面包',
    '制作软软棉花糖',
    '制作新手用鱼饵',
    '制作普通鱼饵',
    '制作精华鱼饵',
    '酿造浆果酒',
    '酿造晨露精酿',
    '酿造铃语精酿',
    '酿造战斗知识鸡尾酒',
    '制作浆果奶昔',
    '制作铃语奶昔',
    '制作葡萄浆果奶昔',
    '制作葡萄铃语奶昔',
    '制作金枪鱼罐头',
    '制作风味虾仁罐头',
    '制作彩虹鱼干罐头',
    '制作神秘锦鲤罐头',
    '制作水晶金枪鱼罐头',
    '制作风味水晶虾仁罐头',
    '制作彩虹水晶鱼干罐头',
    '制作神秘水晶锦鲤罐头',
    '制作采集助力蛋挞',
    '制作钓鱼助力蛋挞',
    '制作畜牧助力蛋挞',
    '制作挖掘助力蛋挞',
    '制作缝纫助力蛋挞',
    '制作烹饪助力蛋挞',
    '制作制造助力蛋挞',
    '制作知识助力蛋挞',
    '制作探索助力蛋挞',
    '制作采集增幅蛋挞',
    '制作钓鱼增幅蛋挞',
    '制作畜牧增幅蛋挞',
    '制作挖掘增幅蛋挞',
    '制作缝纫增幅蛋挞',
    '制作烹饪增幅蛋挞',
    '制作制造增幅蛋挞',
    '制作知识增幅蛋挞',
    '制作探索增幅蛋挞',
  ],
  提升自我: [
    '跑步',
    '举重',
    '读书',
    '战斗练习',
    '基础攻击练习',
    '基础防御练习',
    '游泳',
    '搏击训练',
    '抗打击训练',
    '瑜伽练习',
    '复习战斗知识-力量',
    '复习战斗知识-敏捷',
    '复习战斗知识-智力',
    '编写生活专精手册',
    '编写战斗专精手册',
  ],
};
