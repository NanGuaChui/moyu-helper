/**
 * 快速炼金功能模块
 */

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { logger, toast, ws, dataCache } from '@/core';
import { Modal, Card, FormGroup, Select, Button, Slider } from '@/ui/components';
import { analytics, getResourceDetail, debounce, sleep } from '@/utils';
import ESSENCE_CLASSIFICATION from '@/config/monster-essence-classification.json';
import { ALCHEMY_RECIPES, ESSENCE_LEVEL_MAP, TAG_RESOURCE_MAP, type AlchemyItem } from '@/config/alchemy-recipes';

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

const MAX_LIMIT = 1000;
const nameCache = new Map<string, string>();

function getCachedResourceName(id: string): string {
  if (!nameCache.has(id)) {
    nameCache.set(id, getResourceDetail(id)?.name || id);
  }
  return nameCache.get(id)!;
}

function isMonsterEssence(materialId: string): boolean {
  return materialId.startsWith('(monster_essence_lv');
}

function isTagResource(materialId: string): boolean {
  return !!TAG_RESOURCE_MAP[materialId];
}

class AlchemyManager {
  async quickAlchemy(recipeId: string, inputs: RecipeInput, times: number): Promise<void> {
    try {
      const alchemyData = { input: inputs, times };
      toast.info(`正在提交炼金任务 ${getCachedResourceName(recipeId)} x${times}...`);
      await ws.sendAndListen('alchemy:auto:create', alchemyData, 30000);
      toast.success(`✅ 炼金任务提交成功！`);
      analytics.track('炼金', 'quick_alchemy_success', `${getCachedResourceName(recipeId)} x${times}`);
    } catch (error: any) {
      logger.error('炼金失败', error);
      toast.error(error?.payload?.data?.msg || '炼金任务提交失败');
    }
  }
}

export const alchemyManager = new AlchemyManager();

interface AlchemyPanelProps {
  onClose: () => void;
}

function AlchemyPanelContent({ onClose }: AlchemyPanelProps) {
  const [selectedRecipe, setSelectedRecipe] = useState('');
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(0);
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [times, setTimes] = useState(1);
  const [maxTimes, setMaxTimes] = useState(MAX_LIMIT);
  const [multiplier, setMultiplier] = useState(1);
  const [maxMultiplier, setMaxMultiplier] = useState(MAX_LIMIT);
  const [groupedOptions, setGroupedOptions] = useState<
    Array<{ label: string; options: Array<{ value: string; label: string }> }>
  >([]);
  const [materialOptions, setMaterialOptions] = useState<{ value: string; label: string }[]>([]);
  const [tagSelections, setTagSelections] = useState<Record<string, string>>({});
  const [tagOptions, setTagOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [materialPreview, setMaterialPreview] = useState<MaterialPreview[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipeData, setRecipeData] = useState<AlchemyItem | null>(null);

  const findRecipeItem = (recipeId: string): AlchemyItem | null => {
    for (const category of ALCHEMY_RECIPES) {
      const item = category.items.find((i) => i.value === recipeId);
      if (item) return item;
    }
    return null;
  };

  const getMaterialAvailable = (materialId: string, inventory: Inventory): number => {
    if (isTagResource(materialId)) {
      const selectedResource = tagSelections[materialId];
      return selectedResource ? inventory[selectedResource]?.count || 0 : 0;
    }
    if (isMonsterEssence(materialId)) {
      return selectedMaterial ? inventory[selectedMaterial]?.count || 0 : 0;
    }
    return inventory[materialId]?.count || 0;
  };

  const calculateMaxMultiplier = async (): Promise<number> => {
    if (!recipeData) return 1;
    const currentRecipe = recipeData.recipes[selectedRecipeIndex];
    const inventory = await dataCache.getAsync('inventory');
    let maxMult = MAX_LIMIT;

    for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
      const available = getMaterialAvailable(materialId, inventory);
      maxMult = Math.min(maxMult, Math.floor(available / count), Math.floor(MAX_LIMIT / count));
    }
    return Math.max(1, maxMult);
  };

  const calculateMaxTimes = async (mult: number): Promise<number> => {
    if (!recipeData) return MAX_LIMIT;
    const currentRecipe = recipeData.recipes[selectedRecipeIndex];
    const inventory = await dataCache.getAsync('inventory');
    let maxT = MAX_LIMIT;

    for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
      const available = getMaterialAvailable(materialId, inventory);
      maxT = Math.min(maxT, Math.floor(available / (count * mult)));
    }
    return Math.min(Math.max(1, maxT), MAX_LIMIT);
  };

  useEffect(() => {
    const loadOptions = async () => {
      const inventory = await dataCache.getAsync('inventory');
      const options = ALCHEMY_RECIPES.map((category) => ({
        label: category.label,
        options: category.items.map((item) => ({
          value: item.value,
          label: `${item.label} (${inventory[item.value]?.count || 0})`,
        })),
      }));
      setGroupedOptions(options);
    };
    loadOptions();
  }, []);

  useEffect(() => {
    const updateMaterials = async () => {
      if (!selectedRecipe) {
        setMaterialOptions([]);
        setSelectedMaterial('');
        setTagSelections({});
        setTagOptions({});
        setMaterialPreview(null);
        setRecipeData(null);
        return;
      }

      const inventory = await dataCache.getAsync('inventory');
      const recipe = findRecipeItem(selectedRecipe);
      setRecipeData(recipe);

      if (!recipe) return;

      const currentRecipe = recipe.recipes[selectedRecipeIndex];
      const newTagSelections: Record<string, string> = {};
      const newTagOptions: Record<string, { value: string; label: string }[]> = {};
      let newSelectedMaterial = '';

      for (const materialId of Object.keys(currentRecipe.inputs)) {
        if (isTagResource(materialId)) {
          const resources = TAG_RESOURCE_MAP[materialId];
          const opts = resources
            .map((id) => ({
              id,
              count: inventory[id]?.count || 0,
              label: `${getCachedResourceName(id)} (${inventory[id]?.count || 0})`,
            }))
            .sort((a, b) => b.count - a.count);
          newTagOptions[materialId] = opts.map((o) => ({ value: o.id, label: o.label }));
          newTagSelections[materialId] = opts[0]?.id || resources[0];
        } else if (isMonsterEssence(materialId)) {
          const level = ESSENCE_LEVEL_MAP[selectedRecipe];
          if (level) {
            const essenceKey = `monster_essence_lv${level}` as keyof typeof ESSENCE_CLASSIFICATION;
            const materials = ESSENCE_CLASSIFICATION[essenceKey];
            if (materials?.length > 0) {
              const options = materials
                .map((id) => ({
                  value: id,
                  label: `${getCachedResourceName(id)} (${inventory[id]?.count || 0})`,
                  count: inventory[id]?.count || 0,
                }))
                .sort((a, b) => b.count - a.count);
              setMaterialOptions(options);
              newSelectedMaterial = options[0]?.value || '';
              setSelectedMaterial(newSelectedMaterial);
            }
          }
        }
      }
      setTagSelections(newTagSelections);
      setTagOptions(newTagOptions);

      await sleep(0);

      const maxMult = await calculateMaxMultiplier();
      setMaxMultiplier(maxMult);
      setMultiplier(maxMult);

      const maxT = await calculateMaxTimes(maxMult);
      setMaxTimes(maxT);
      setTimes(maxT);
    };
    updateMaterials();
  }, [selectedRecipe, selectedRecipeIndex]);

  useEffect(() => {
    const updatePreview = async () => {
      if (!selectedRecipe || !recipeData) {
        setMaterialPreview(null);
        return;
      }

      const currentRecipe = recipeData.recipes[selectedRecipeIndex];
      const inventory = await dataCache.getAsync('inventory');
      const preview: MaterialPreview[] = [];

      for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
        let resourceId = materialId;
        if (isTagResource(materialId)) {
          resourceId = tagSelections[materialId];
          if (!resourceId) continue;
        } else if (isMonsterEssence(materialId)) {
          resourceId = selectedMaterial;
          if (!resourceId) continue;
        }

        preview.push({
          name: getCachedResourceName(resourceId),
          required: count * multiplier * times,
          available: inventory[resourceId]?.count || 0,
        });
      }
      setMaterialPreview(preview);
    };
    const debouncedUpdate = debounce(updatePreview, 200);
    debouncedUpdate();
  }, [selectedMaterial, tagSelections, times, multiplier, recipeData]);

  useEffect(() => {
    const updateMaxValues = async () => {
      const maxMult = await calculateMaxMultiplier();
      setMaxMultiplier(maxMult);
      setMultiplier(maxMult);

      const maxT = await calculateMaxTimes(maxMult);
      setMaxTimes(maxT);
      setTimes(maxT);
    };
    const debouncedUpdate = debounce(updateMaxValues, 300);
    if (recipeData) debouncedUpdate();
  }, [selectedMaterial, tagSelections, recipeData]);

  useEffect(() => {
    const updateMaxTimes = async () => {
      const maxT = await calculateMaxTimes(multiplier);
      setMaxTimes(maxT);
      setTimes(maxT);
    };
    const debouncedUpdate = debounce(updateMaxTimes, 200);
    if (recipeData) debouncedUpdate();
  }, [multiplier]);

  const handleSubmit = async () => {
    if (!selectedRecipe || !recipeData) {
      toast.warning('请选择配方');
      return;
    }

    const currentRecipe = recipeData.recipes[selectedRecipeIndex];
    const finalInputs: RecipeInput = {};

    for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
      if (isTagResource(materialId)) {
        const selectedResource = tagSelections[materialId];
        if (!selectedResource) {
          toast.warning(`请选择 ${materialId} 的材料`);
          return;
        }
        finalInputs[selectedResource] = { count: count * multiplier };
      } else if (isMonsterEssence(materialId)) {
        if (!selectedMaterial) {
          toast.warning('请选择怪物精华');
          return;
        }
        finalInputs[selectedMaterial] = { count: count * multiplier };
      } else {
        finalInputs[materialId] = { count: count * multiplier };
      }
    }

    setIsSubmitting(true);
    try {
      await alchemyManager.quickAlchemy(selectedRecipe, finalInputs, times);
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
          value={selectedRecipe}
          onChange={(value) => {
            setSelectedRecipe(value);
            setSelectedRecipeIndex(0);
          }}
          options={groupedOptions}
          placeholder="-- 请选择配方 --"
        />
      </FormGroup>

      {recipeData && recipeData.recipes.length > 1 && (
        <FormGroup label="配方选项">
          <Select
            value={String(selectedRecipeIndex)}
            onChange={(value) => setSelectedRecipeIndex(Number(value))}
            options={recipeData.recipes.map((r, idx) => ({
              value: String(idx),
              label: r.description || `配方 ${idx + 1}`,
            }))}
          />
        </FormGroup>
      )}

      {materialOptions.length > 0 && (
        <FormGroup label="选择怪物精华">
          <Select value={selectedMaterial} onChange={setSelectedMaterial} options={materialOptions} />
        </FormGroup>
      )}

      {Object.entries(tagOptions).map(([tag, options]) => (
        <FormGroup key={tag} label={`选择 ${tag}`}>
          <Select
            value={tagSelections[tag] || ''}
            onChange={(value) => setTagSelections({ ...tagSelections, [tag]: value })}
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

      {materialPreview && (
        <Card title="材料预览" style={{ minHeight: '60px' }}>
          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
            {materialPreview.map((item, idx) => (
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
