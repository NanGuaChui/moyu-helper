/**
 * 快速炼金功能模块
 */

import { render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { logger, toast, ws, dataCache } from '@/core';
import { Modal, Card, FormGroup, Select, Button, Slider } from '@/ui/components';
import { analytics, getResourceDetail, getTAllGameResource } from '@/utils';
import ESSENCE_CLASSIFICATION from '@/config/monster-essence-classification.json';
import { ALCHEMY_RECIPES, ESSENCE_LEVEL_MAP, type AlchemyItem } from '@/config/alchemy-recipes';

// ==================== 类型定义 ====================

interface RecipeInput {
  [key: string]: { count: number };
}

interface MaterialPreview {
  name: string;
  required: number;
  available: number;
}

interface Inventory {
  [key: string]: { count: number };
}

interface MaterialSelection {
  essence: string;
  tags: Record<string, string>;
}

interface SelectOption {
  value: string;
  label: string;
}

// ==================== 常量 ====================

const MAX_LIMIT = 1000;
const nameCache = new Map<string, string>();

// ==================== 工具函数 ====================

function getResourceName(id: string): string {
  if (!nameCache.has(id)) {
    nameCache.set(id, getResourceDetail(id)?.name || id);
  }
  return nameCache.get(id)!;
}

function isMonsterEssence(materialId: string): boolean {
  return materialId.startsWith('(monster_essence_lv');
}

function isTagResource(materialId: string): boolean {
  return materialId.startsWith('(') && materialId.endsWith(')') && !isMonsterEssence(materialId);
}

async function getTagResources(tagStr: string): Promise<string[]> {
  const cached = sessionStorage.getItem(`alchemy_tag_${tagStr}`);
  if (cached) return JSON.parse(cached);

  const match = tagStr.match(/^\(([^)]+)\)$/);
  if (!match) return [];

  const tags = match[1].split(',').map((t) => t.trim());
  const resources = await getTAllGameResource();

  const result = Object.keys(resources).filter((key) => {
    const alchemyTag = resources[key]?.alchemyTag;
    if (!alchemyTag || !Array.isArray(alchemyTag)) return false;
    return tags.every((tag) => alchemyTag.includes(tag));
  });

  sessionStorage.setItem(`alchemy_tag_${tagStr}`, JSON.stringify(result));
  return result;
}

function findRecipe(recipeId: string): AlchemyItem | null {
  for (const category of ALCHEMY_RECIPES) {
    const item = category.items.find((i) => i.value === recipeId);
    if (item) return item;
  }
  return null;
}

// ==================== 核心逻辑 ====================

function calculateMaxValues(
  recipe: AlchemyItem,
  recipeIndex: number,
  selection: MaterialSelection,
  inventory: Inventory,
): { maxMultiplier: number; maxTimes: number } {
  const currentRecipe = recipe.recipes[recipeIndex];
  let maxMultiplier = MAX_LIMIT;

  // 计算最大倍数
  for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
    let available = 0;

    if (isTagResource(materialId)) {
      const resourceId = selection.tags[materialId];
      available = resourceId ? inventory[resourceId]?.count || 0 : 0;
    } else if (isMonsterEssence(materialId)) {
      available = selection.essence ? inventory[selection.essence]?.count || 0 : 0;
    } else {
      available = inventory[materialId]?.count || 0;
    }

    maxMultiplier = Math.min(maxMultiplier, Math.floor(available / count), Math.floor(MAX_LIMIT / count));
  }

  maxMultiplier = Math.max(1, maxMultiplier);

  // 计算最大次数
  let maxTimes = MAX_LIMIT;
  for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
    let available = 0;

    if (isTagResource(materialId)) {
      const resourceId = selection.tags[materialId];
      available = resourceId ? inventory[resourceId]?.count || 0 : 0;
    } else if (isMonsterEssence(materialId)) {
      available = selection.essence ? inventory[selection.essence]?.count || 0 : 0;
    } else {
      available = inventory[materialId]?.count || 0;
    }

    maxTimes = Math.min(maxTimes, Math.floor(available / (count * maxMultiplier)));
  }

  maxTimes = Math.min(Math.max(1, maxTimes), MAX_LIMIT);

  return { maxMultiplier, maxTimes };
}

async function buildMaterialPreview(
  recipe: AlchemyItem,
  recipeIndex: number,
  selection: MaterialSelection,
  multiplier: number,
  times: number,
  inventory: Inventory,
): Promise<MaterialPreview[]> {
  const currentRecipe = recipe.recipes[recipeIndex];
  const preview: MaterialPreview[] = [];

  for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
    let resourceId = materialId;

    if (isTagResource(materialId)) {
      resourceId = selection.tags[materialId];
      if (!resourceId) continue;
    } else if (isMonsterEssence(materialId)) {
      resourceId = selection.essence;
      if (!resourceId) continue;
    }

    preview.push({
      name: getResourceName(resourceId),
      required: count * multiplier * times,
      available: inventory[resourceId]?.count || 0,
    });
  }

  return preview;
}

// ==================== 炼金管理器 ====================

class AlchemyManager {
  async quickAlchemy(recipeId: string, inputs: RecipeInput, times: number): Promise<void> {
    // 验证参数
    if (times > MAX_LIMIT) {
      toast.error(`制作次数不能超过 ${MAX_LIMIT}`);
      return;
    }

    for (const [materialId, { count }] of Object.entries(inputs)) {
      if (count > MAX_LIMIT) {
        toast.error(`材料 ${getResourceName(materialId)} 的数量不能超过 ${MAX_LIMIT}`);
        return;
      }
    }

    try {
      const alchemyData = { input: inputs, times };
      toast.info(`正在提交炼金任务 ${getResourceName(recipeId)} x${times}...`);
      await ws.request('alchemy:auto:create', alchemyData, 30000);
      toast.success(`✅ 炼金任务提交成功！`);
      analytics.track('炼金', 'quick_alchemy_success', `${getResourceName(recipeId)} x${times}`);
    } catch (error: any) {
      logger.error('炼金失败', error);
      toast.error(error?.payload?.data?.msg || '炼金任务提交失败');
    }
  }
}

export const alchemyManager = new AlchemyManager();

// ==================== 组件 ====================

interface AlchemyPanelProps {
  onClose: () => void;
}

function AlchemyPanelContent({ onClose }: AlchemyPanelProps) {
  // 配方状态
  const [recipeId, setRecipeId] = useState('');
  const [recipeIndex, setRecipeIndex] = useState(0);
  const [recipeOptions, setRecipeOptions] = useState<Array<{ label: string; options: SelectOption[] }>>([]);

  // 材料状态
  const [essenceOptions, setEssenceOptions] = useState<SelectOption[]>([]);
  const [tagOptions, setTagOptions] = useState<Record<string, SelectOption[]>>({});
  const [selection, setSelection] = useState<MaterialSelection>({ essence: '', tags: {} });

  // 数量状态
  const [multiplier, setMultiplier] = useState(1);
  const [times, setTimes] = useState(1);
  const [maxMultiplier, setMaxMultiplier] = useState(MAX_LIMIT);
  const [maxTimes, setMaxTimes] = useState(MAX_LIMIT);

  // UI状态
  const [preview, setPreview] = useState<MaterialPreview[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recipe = useMemo(() => (recipeId ? findRecipe(recipeId) : null), [recipeId]);

  // 初始化配方列表
  useEffect(() => {
    (async () => {
      const inventory = await dataCache.getAsync('inventory');
      const options = ALCHEMY_RECIPES.map((category) => ({
        label: category.label,
        options: category.items.map((item) => ({
          value: item.value,
          label: `${item.label} (${inventory[item.value]?.count || 0})`,
        })),
      }));
      setRecipeOptions(options);
    })();
  }, []);

  // 配方变化：加载材料选项并计算最大值
  useEffect(() => {
    if (!recipe) {
      setEssenceOptions([]);
      setTagOptions({});
      setSelection({ essence: '', tags: {} });
      setMaxMultiplier(MAX_LIMIT);
      setMaxTimes(MAX_LIMIT);
      setMultiplier(1);
      setTimes(1);
      setPreview([]);
      return;
    }

    (async () => {
      const inventory = await dataCache.getAsync('inventory');
      const currentRecipe = recipe.recipes[recipeIndex];
      const newSelection: MaterialSelection = { essence: '', tags: {} };
      const newEssenceOptions: SelectOption[] = [];
      const newTagOptions: Record<string, SelectOption[]> = {};

      // 加载材料选项
      for (const materialId of Object.keys(currentRecipe.inputs)) {
        if (isTagResource(materialId)) {
          const resources = await getTagResources(materialId);
          const options = resources
            .map((id) => ({
              id,
              count: inventory[id]?.count || 0,
              label: `${getResourceName(id)} (${inventory[id]?.count || 0})`,
            }))
            .sort((a, b) => b.count - a.count);

          newTagOptions[materialId] = options.map((o) => ({ value: o.id, label: o.label }));
          newSelection.tags[materialId] = options[0]?.id || resources[0] || '';
        } else if (isMonsterEssence(materialId)) {
          const level = ESSENCE_LEVEL_MAP[recipeId];
          if (level) {
            const essenceKey = `monster_essence_lv${level}` as keyof typeof ESSENCE_CLASSIFICATION;
            const materials = ESSENCE_CLASSIFICATION[essenceKey];
            if (materials?.length > 0) {
              const options = materials
                .map((id) => ({
                  value: id,
                  label: `${getResourceName(id)} (${inventory[id]?.count || 0})`,
                  count: inventory[id]?.count || 0,
                }))
                .sort((a, b) => b.count - a.count);

              newEssenceOptions.push(...options);
              newSelection.essence = options[0]?.value || '';
            }
          }
        }
      }

      // 计算最大值
      const { maxMultiplier: maxMult, maxTimes: maxT } = calculateMaxValues(
        recipe,
        recipeIndex,
        newSelection,
        inventory,
      );

      // 批量更新状态
      setEssenceOptions(newEssenceOptions);
      setTagOptions(newTagOptions);
      setSelection(newSelection);
      setMaxMultiplier(maxMult);
      setMaxTimes(maxT);
      setMultiplier(maxMult);
      setTimes(maxT);
    })();
  }, [recipe, recipeIndex, recipeId]);

  // 材料变化：重新计算最大值
  useEffect(() => {
    if (!recipe) return;

    (async () => {
      const inventory = await dataCache.getAsync('inventory');
      const { maxMultiplier: maxMult, maxTimes: maxT } = calculateMaxValues(
        recipe,
        recipeIndex,
        selection,
        inventory,
      );

      setMaxMultiplier(maxMult);
      setMaxTimes(maxT);
      if (multiplier > maxMult) setMultiplier(maxMult);
      if (times > maxT) setTimes(maxT);
    })();
  }, [selection.essence, JSON.stringify(selection.tags)]);

  // 倍数变化：重新计算最大次数
  useEffect(() => {
    if (!recipe) return;

    (async () => {
      const inventory = await dataCache.getAsync('inventory');
      const currentRecipe = recipe.recipes[recipeIndex];
      let maxT = MAX_LIMIT;

      for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
        let available = 0;

        if (isTagResource(materialId)) {
          const resourceId = selection.tags[materialId];
          available = resourceId ? inventory[resourceId]?.count || 0 : 0;
        } else if (isMonsterEssence(materialId)) {
          available = selection.essence ? inventory[selection.essence]?.count || 0 : 0;
        } else {
          available = inventory[materialId]?.count || 0;
        }

        maxT = Math.min(maxT, Math.floor(available / (count * multiplier)));
      }

      maxT = Math.min(Math.max(1, maxT), MAX_LIMIT);
      setMaxTimes(maxT);
      if (times > maxT) setTimes(maxT);
    })();
  }, [multiplier]);

  // 更新预览
  useEffect(() => {
    if (!recipe) {
      setPreview([]);
      return;
    }

    (async () => {
      const inventory = await dataCache.getAsync('inventory');
      const preview = await buildMaterialPreview(recipe, recipeIndex, selection, multiplier, times, inventory);
      setPreview(preview);
    })();
  }, [recipe, recipeIndex, selection.essence, JSON.stringify(selection.tags), multiplier, times]);

  // 提交炼金
  const handleSubmit = async () => {
    if (!recipe) {
      toast.warning('请选择配方');
      return;
    }

    const currentRecipe = recipe.recipes[recipeIndex];
    const finalInputs: RecipeInput = {};

    for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
      if (isTagResource(materialId)) {
        const resourceId = selection.tags[materialId];
        if (!resourceId) {
          toast.warning(`请选择 ${materialId} 的材料`);
          return;
        }
        finalInputs[resourceId] = { count: count * multiplier };
      } else if (isMonsterEssence(materialId)) {
        if (!selection.essence) {
          toast.warning('请选择怪物精华');
          return;
        }
        finalInputs[selection.essence] = { count: count * multiplier };
      } else {
        finalInputs[materialId] = { count: count * multiplier };
      }
    }

    setIsSubmitting(true);
    try {
      await alchemyManager.quickAlchemy(recipeId, finalInputs, times);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card title="💡 使用说明" style={{ marginBottom: '12px', fontSize: '12px', lineHeight: '1.5' }}>
        <div style={{ color: '#666' }}>
          • 选择配方后自动设置最大材料倍数和制作次数
          <br />
          • 切换材料时会重新计算最大值
          <br />• 材料预览显示：需求数量 / 库存数量
        </div>
      </Card>

      <FormGroup label="选择配方">
        <Select
          value={recipeId}
          onChange={(value) => {
            setRecipeId(value);
            setRecipeIndex(0);
          }}
          options={recipeOptions}
          placeholder="-- 请选择配方 --"
        />
      </FormGroup>

      {recipe && recipe.recipes.length > 1 && (
        <FormGroup label="配方选项">
          <Select
            value={String(recipeIndex)}
            onChange={(value) => setRecipeIndex(Number(value))}
            options={recipe.recipes.map((r, idx) => ({
              value: String(idx),
              label: r.description || `配方 ${idx + 1}`,
            }))}
          />
        </FormGroup>
      )}

      {essenceOptions.length > 0 && (
        <FormGroup label="选择怪物精华">
          <Select
            value={selection.essence}
            onChange={(value) => setSelection({ ...selection, essence: value })}
            options={essenceOptions}
          />
        </FormGroup>
      )}

      {Object.entries(tagOptions).map(([tag, options]) => (
        <FormGroup key={tag} label={`选择 ${tag}`}>
          <Select
            value={selection.tags[tag] || ''}
            onChange={(value) => setSelection({ ...selection, tags: { ...selection.tags, [tag]: value } })}
            options={options}
          />
        </FormGroup>
      ))}

      <FormGroup label={`材料倍数: ${multiplier} (1 - ${maxMultiplier})`}>
        <Slider value={multiplier} onInput={setMultiplier} min={1} max={maxMultiplier} step={1} />
      </FormGroup>

      <FormGroup label={`制作次数: ${times} (1 - ${maxTimes})`}>
        <Slider value={times} onInput={setTimes} min={1} max={maxTimes} step={1} />
      </FormGroup>

      {preview.length > 0 && (
        <Card title="材料预览" style={{ minHeight: '60px' }}>
          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
            {preview.map((item, idx) => (
              <div key={idx} style={{ color: '#52c41a' }}>
                {item.name}: {item.required} / {item.available}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
        <Button variant="secondary" onClick={onClose} style={{ flex: 1 }} disabled={isSubmitting}>
          取消
        </Button>
        <Button onClick={handleSubmit} style={{ flex: 1 }} disabled={isSubmitting}>
          {isSubmitting ? '提交中...' : '提交'}
        </Button>
      </div>
    </>
  );
}

export class AlchemyPanel {
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
      <Modal isOpen={true} onClose={() => this.hide()} title="⚗️ 快速炼金">
        <AlchemyPanelContent onClose={() => this.hide()} />
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
