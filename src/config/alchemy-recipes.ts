/**
 * 炼金配方配置
 */

export interface AlchemyRecipe {
  recipeIndex: number;
  inputs: Record<string, { count: number }>;
  description?: string;
}

export interface AlchemyItem {
  value: string;
  label: string;
  recipes: AlchemyRecipe[];
}

export interface AlchemyCategory {
  value: string;
  label: string;
  items: AlchemyItem[];
}

export const ALCHEMY_RECIPES: AlchemyCategory[] = [
  {
    value: 'combat_essence',
    label: '战力精华',
    items: [
      {
        value: 'pure_monster_essence_lv1',
        label: '战力精华Lv1',
        recipes: [
          { recipeIndex: 0, inputs: { '(monster_essence_lv1)': { count: 32 }, mysticalEssence: { count: 5 } } },
        ],
      },
      {
        value: 'pure_monster_essence_lv2',
        label: '战力精华Lv2',
        recipes: [
          { recipeIndex: 0, inputs: { '(monster_essence_lv2)': { count: 24 }, mysticalEssence: { count: 5 } } },
        ],
      },
      {
        value: 'pure_monster_essence_lv3',
        label: '战力精华Lv3',
        recipes: [
          { recipeIndex: 0, inputs: { '(monster_essence_lv3)': { count: 12 }, mysticalEssence: { count: 5 } } },
        ],
      },
      {
        value: 'pure_monster_essence_lv4',
        label: '战力精华Lv4',
        recipes: [{ recipeIndex: 0, inputs: { '(monster_essence_lv4)': { count: 4 }, mysticalEssence: { count: 5 } } }],
      },
    ],
  },
  {
    value: 'other_essence',
    label: '其他精华',
    items: [
      {
        value: 'sewingEssence',
        label: '织物精华',
        recipes: [
          { recipeIndex: 0, inputs: { catHairball: { count: 10 }, wool: { count: 33 } }, description: '猫毛球+羊毛' },
          {
            recipeIndex: 1,
            inputs: { catHairball: { count: 10 }, cashmere: { count: 1 } },
            description: '猫毛球+羊绒',
          },
          { recipeIndex: 2, inputs: { catHairball: { count: 10 }, silk: { count: 33 } }, description: '猫毛球+蚕丝' },
          {
            recipeIndex: 3,
            inputs: { catHairball: { count: 10 }, silkFabric: { count: 1 } },
            description: '猫毛球+丝绸',
          },
          { recipeIndex: 4, inputs: { catHairball: { count: 10 }, fluff: { count: 12 } }, description: '猫毛球+绒毛' },
          {
            recipeIndex: 5,
            inputs: { catHairball: { count: 10 }, fluffFabric: { count: 1 } },
            description: '猫毛球+绒布',
          },
        ],
      },
      {
        value: 'knowledgeEssence',
        label: '知识精华',
        recipes: [
          {
            recipeIndex: 0,
            inputs: { '(lv1SkillBook)': { count: 150 }, magicScroll: { count: 1 } },
            description: 'Lv1技能书',
          },
          {
            recipeIndex: 1,
            inputs: { '(lv2SkillBook)': { count: 75 }, magicScroll: { count: 1 } },
            description: 'Lv2技能书',
          },
          {
            recipeIndex: 2,
            inputs: { '(lv3SkillBook)': { count: 50 }, magicScroll: { count: 1 } },
            description: 'Lv3技能书',
          },
          {
            recipeIndex: 3,
            inputs: { '(lv4SkillBook)': { count: 25 }, magicScroll: { count: 1 } },
            description: 'Lv4技能书',
          },
        ],
      },
      {
        value: 'nutrientEssence',
        label: '营养精华',
        recipes: [
          { recipeIndex: 0, inputs: { '(lv1Food)': { count: 100 } }, description: 'Lv1食物' },
          { recipeIndex: 1, inputs: { '(lv2Food)': { count: 50 } }, description: 'Lv2食物' },
          { recipeIndex: 2, inputs: { '(lv3Food)': { count: 25 } }, description: 'Lv3食物' },
          { recipeIndex: 3, inputs: { '(lv4Food)': { count: 10 } }, description: 'Lv4食物' },
        ],
      },
      {
        value: 'craftingEssence',
        label: '矿物精华',
        recipes: [
          { recipeIndex: 0, inputs: { iron: { count: 10 }, steel: { count: 10 } }, description: '铁+钢' },
          { recipeIndex: 1, inputs: { iron: { count: 10 }, silverOre: { count: 33 } }, description: '铁+银矿' },
          { recipeIndex: 2, inputs: { iron: { count: 10 }, silverIngot: { count: 10 } }, description: '铁+银锭' },
          { recipeIndex: 3, inputs: { iron: { count: 10 }, mithrilOre: { count: 33 } }, description: '铁+秘银矿' },
          { recipeIndex: 4, inputs: { iron: { count: 10 }, mithrilIngot: { count: 10 } }, description: '铁+秘银锭' },
          {
            recipeIndex: 5,
            inputs: { iron: { count: 10 }, fishscaleMineral: { count: 35 } },
            description: '铁+鱼鳞矿',
          },
          {
            recipeIndex: 6,
            inputs: { iron: { count: 10 }, fishscaleMineralIgnot: { count: 6 } },
            description: '铁+鱼鳞锭',
          },
          { recipeIndex: 7, inputs: { iron: { count: 10 }, shadowSteel: { count: 4 } }, description: '铁+暗影钢' },
        ],
      },
    ],
  },
  {
    value: 'potion',
    label: '药水',
    items: [
      {
        value: 'manaPotion',
        label: '魔力药水',
        recipes: [
          { recipeIndex: 0, inputs: { berry: { count: 10 }, honey: { count: 1 }, '(glass,container)': { count: 1 } } },
        ],
      },
      {
        value: 'monoPolarElixir',
        label: '单极药剂',
        recipes: [
          {
            recipeIndex: 0,
            inputs: {
              slimeGel: { count: 5 },
              slimeCore: { count: 3 },
              honey: { count: 2 },
              '(glass,container)': { count: 1 },
            },
            description: '史莱姆凝胶+蜂蜜',
          },
          {
            recipeIndex: 1,
            inputs: {
              '(slime)': { count: 5 },
              slimeCore: { count: 3 },
              '(liquid)': { count: 2 },
              '(glass,container)': { count: 1 },
            },
            description: '史莱姆+液体',
          },
        ],
      },
      {
        value: 'magicalMonoPolarElixir',
        label: '魔法单极药剂',
        recipes: [
          {
            recipeIndex: 0,
            inputs: { magicalElixir: { count: 1 }, '(slime)': { count: 1 }, monoPolarElixir: { count: 1 } },
          },
        ],
      },
    ],
  },
];

export const ESSENCE_LEVEL_MAP: Record<string, number> = {
  pure_monster_essence_lv1: 1,
  pure_monster_essence_lv2: 2,
  pure_monster_essence_lv3: 3,
  pure_monster_essence_lv4: 4,
};
