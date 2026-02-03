import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 常量配置
const FILTERED_RESOURCES = new Set(['berry', 'fish', 'wood', 'stone', 'bamboo', 'coal', '__satiety']);
const EXCLUDED_CATEGORIES = ['基础资源', '其他', '种子'];
const REQUIRED_ACTIONS = [
  'miningFishscaleMineral',
  'cutBamboo',
  'pearlCultivation',
  'refinePureEssence',
  'compileBookOfWorkSkillTreePoint',
  'compileBookOfBattleSkillTreePoint',
  'refineGenesisEssence',
];
const COLLECTION_ACTIONS = ['reading', 'swim', 'charcoalMaking', 'pickRainbowShard'];
const EXCLUDED_ACTIONS = new Set(['farming', 'farmingRye', 'windBellHerb', 'dawnBlossom']);
const SPECIAL_CATEGORY_MAPPING = { brewMysticalCatnipPotion: '特殊制造' };

// 一级分类定义
const PRIMARY_CATEGORIES = [
  { key: '烹饪', tags: ['cooking'], secondaries: ['通用', '美食', '鱼饵', '酿造', '饮品', '罐头', '甜点'] },
  { key: '养殖', tags: ['farmingAnimal'], secondaries: ['通用'] },
  {
    key: '缝制',
    tags: ['sewing'],
    secondaries: ['基础缝纫', '羊毛制品', '工作服', '饰品', '丝制品', '特殊物品', '绒毛制品'],
  },
  {
    key: '制造',
    tags: ['manufacturing', 'forging'],
    secondaries: ['工具', '通用', '武器', '法杖', '饰品', '道具', '渔具', '猫舍家具', '文具'],
  },
  { key: '探索', tags: ['exploring'] },
  {
    key: '自我提升',
    tags: ['dexterity', 'stamina', 'strength', 'intelligence', 'attacking', 'defencing'],
    secondaries: ['锻炼', '实战', '室内训练', '学习'],
  },
  {
    key: '炼金',
    tags: ['mysterious'],
    secondaries: ['猫咪自学点金术', '基础点金术', '精华点金术', '提炼', '制药', '净化'],
  },
  { key: '采集', tags: ['gathering'], secondaries: ['种植', '野外', '农田', '海边', '天空'] },
  { key: '钓鱼', tags: ['fishing'], secondaries: ['近海'] },
  { key: '挖掘', tags: ['mining'], secondaries: ['矿洞', '神秘矿洞'] },

  { key: '种植', tags: ['planting'], secondaries: ['森林'] },
  { key: '特殊制造', tags: ['knowledge'] },
];

// 构建分类映射
const CATEGORY_MAPS = (() => {
  const secondary = {};
  const tag = {};
  const order = {};

  PRIMARY_CATEGORIES.forEach(({ key, tags, secondaries }, index) => {
    tags.forEach((t) => (tag[t] = key));
    secondaries?.forEach((s) => (secondary[s] = key));
    order[key] = index;
  });

  return { secondary, tag, order };
})();

// 读取并解析源数据
function loadRawData() {
  const sourceFile = path.join(__dirname, './source.js');
  const content = fs.readFileSync(sourceFile, 'utf-8');
  const match = content.match(/export const RAW_DATA = ({[\s\S]*});/);

  if (!match) {
    console.error('无法找到 RAW_DATA');
    process.exit(1);
  }

  return eval('(' + match[1] + ')');
}

// 从 defaults.ts 提取目标物品 ID
function extractTargetItemIds() {
  const defaultsFile = path.join(__dirname, '../src/config/defaults.ts');
  const content = fs.readFileSync(defaultsFile, 'utf-8');
  const targetIds = new Set();

  const categoryRegex = /\{\s*name:\s*['"]([^'"]+)['"],\s*items:\s*\{/g;
  let match;

  while ((match = categoryRegex.exec(content)) !== null) {
    if (EXCLUDED_CATEGORIES.includes(match[1])) continue;

    const itemsBlock = extractBracketContent(content, match.index + match[0].length);
    const itemIds = itemsBlock.matchAll(/([a-zA-Z0-9_]+):\s*\{/g);

    for (const [, itemId] of itemIds) {
      targetIds.add(itemId);
    }
  }

  return targetIds;
}

// 提取大括号内容
function extractBracketContent(text, startPos) {
  let braceCount = 1;
  let endPos = startPos;

  while (braceCount > 0 && endPos < text.length) {
    if (text[endPos] === '{') braceCount++;
    if (text[endPos] === '}') braceCount--;
    endPos++;
  }

  return text.substring(startPos, endPos - 1);
}

// 计算 action 效率
function calculateEfficiency(action, reward) {
  const baseCount = reward.range?.min || reward.count || 1;
  const percent = reward.percent || 1;
  const baseDuration = action.baseDuration || 1000;
  return (percent * baseCount) / (baseDuration / 1000);
}

// 提取非基础资源依赖
function extractDependencies(action) {
  return action.requirement?.resource?.filter((req) => !FILTERED_RESOURCES.has(req.id)) || [];
}

// 构建物品生产索引
function buildItemProducerIndex(rawData) {
  const index = {};
  Object.entries(rawData).forEach(([actionId, action]) => {
    if (EXCLUDED_ACTIONS.has(actionId)) return;
    action.rewards?.forEach((reward) => {
      if (!index[reward.id]) index[reward.id] = [];
      index[reward.id].push(actionId);
    });
  });
  return index;
}

// 找到生产目标物品的最优 action
function findOptimalActions(rawData, targetItemIds, producerIndex) {
  const optimalActions = new Set();

  targetItemIds.forEach((itemId) => {
    const producers = producerIndex[itemId]?.map((actionId) => {
      const action = rawData[actionId];
      const reward = action.rewards.find((r) => r.id === itemId);
      return {
        actionId,
        depCount: extractDependencies(action).length,
        efficiency: calculateEfficiency(action, reward),
      };
    });

    if (producers?.length) {
      producers.sort((a, b) => a.depCount - b.depCount || b.efficiency - a.efficiency);
      optimalActions.add(producers[0].actionId);
    }
  });

  return optimalActions;
}

// 递归收集所有依赖的 action
function collectDependentActions(rawData, actionIds, producerIndex) {
  const visited = new Set();
  const queue = Array.from(actionIds);

  while (queue.length > 0) {
    const actionId = queue.shift();
    if (visited.has(actionId)) continue;
    visited.add(actionId);

    const dependencies = extractDependencies(rawData[actionId]);
    dependencies.forEach((req) => {
      producerIndex[req.id]?.forEach((depActionId) => {
        if (!visited.has(depActionId) && !EXCLUDED_ACTIONS.has(depActionId)) {
          queue.push(depActionId);
        }
      });
    });
  }

  return visited;
}

// 获取 action 分类
function getActionCategory(actionId, action) {
  return (
    SPECIAL_CATEGORY_MAPPING[actionId] ||
    CATEGORY_MAPS.secondary[action.secondaryClassification] ||
    action.secondaryClassification ||
    CATEGORY_MAPS.tag[action.characterImprove?.[0]?.status] ||
    '其他'
  );
}

// 转换 action 为目标格式
function transformAction(actionId, action) {
  const rewards =
    action.rewards?.map((r) => ({
      itemId: r.id,
      count: (r.range?.min || r.count || 1) * (r.percent || 1),
    })) || [];

  const dependencies = extractDependencies(action).map((req) => ({
    itemId: req.id,
    count: req.count,
  }));

  return {
    id: actionId,
    name: action.name,
    actionId,
    rewards,
    dependencies,
    category: getActionCategory(actionId, action),
    banToKitty: action.banToKitty || false,
  };
}

// 转换为树形结构
function toTreeItem(action) {
  return {
    value: action.id,
    label: action.name,
    actionId: action.actionId,
    rewards: action.rewards,
    ...(action.dependencies.length && { dependencies: action.dependencies }),
    ...(action.banToKitty && { banToKitty: action.banToKitty }),
  };
}

// 生成最终数据结构
function generateFinalData(rawData, normalActionIds, collectionActionIds) {
  const actions = Array.from(normalActionIds)
    .filter((id) => rawData[id] && !EXCLUDED_ACTIONS.has(id))
    .map((id) => transformAction(id, rawData[id]));

  // 按分类分组
  const grouped = {};
  actions.forEach((action) => {
    (grouped[action.category] ||= []).push(action);
  });

  // 按 PRIMARY_CATEGORIES 顺序排序并转换
  const categories = Object.entries(grouped)
    .sort(([a], [b]) => {
      const orderA = CATEGORY_MAPS.order[a] ?? 999;
      const orderB = CATEGORY_MAPS.order[b] ?? 999;
      return orderA - orderB || a.localeCompare(b, 'zh-CN');
    })
    .map(([category, items]) => ({
      value: category,
      label: category,
      items: items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map(toTreeItem),
    }));

  // 添加收藏分类
  if (collectionActionIds.length) {
    categories.unshift({
      value: 'collection',
      label: '收藏',
      items: collectionActionIds.filter((id) => rawData[id]).map((id) => toTreeItem(transformAction(id, rawData[id]))),
    });
  }

  return categories;
}

// 生成并写入文件
function writeOutputFile(data, targetItemCount) {
  const outputDir = path.join(__dirname, '../src/config');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, 'craft-items.json');
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf-8');

  const totalItems = data.reduce((sum, group) => sum + group.items.length, 0);
  console.log(`转换完成！共处理 ${totalItems} 条数据，分为 ${data.length} 个分类`);
  console.log(`目标物品数：${targetItemCount}`);
  console.log(`输出文件：${outputFile}`);
  console.log('提示：已按最少依赖优先，效率次之的原则选择 action');
}

// 主流程
function main() {
  const rawData = loadRawData();
  const targetItemIds = extractTargetItemIds();
  const producerIndex = buildItemProducerIndex(rawData);
  const optimalActions = findOptimalActions(rawData, targetItemIds, producerIndex);
  const allActions = collectDependentActions(rawData, optimalActions, producerIndex);

  REQUIRED_ACTIONS.forEach((id) => !EXCLUDED_ACTIONS.has(id) && allActions.add(id));

  const finalData = generateFinalData(rawData, allActions, COLLECTION_ACTIONS);
  writeOutputFile(finalData, targetItemIds.size);
}

main();
