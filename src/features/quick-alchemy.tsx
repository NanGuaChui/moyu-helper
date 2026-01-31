/**
 * 快速炼金功能模块
 */

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { logger, toast, ws, dataCache } from '@/core';
import { Modal, Card, FormGroup, Select, Input, Button } from '@/ui/components';
import { analytics, getResourceDetail } from '@/utils';
import ESSENCE_CLASSIFICATION from '@/config/monster-essence-classification.json';
import { ALCHEMY_RECIPES, ESSENCE_LEVEL_MAP, TAG_RESOURCE_MAP, type AlchemyItem } from '@/config/alchemy-recipes';

interface RecipeInput {
  [key: string]: { count: number };
}

const nameCache = new Map<string, string>();

function getCachedResourceName(id: string): string {
  if (!nameCache.has(id)) {
    nameCache.set(id, getResourceDetail(id)?.name || id);
  }
  return nameCache.get(id)!;
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
  const [groupedOptions, setGroupedOptions] = useState<Array<{ label: string; options: Array<{ value: string; label: string }> }>>([]);
  const [materialOptions, setMaterialOptions] = useState<{ value: string; label: string }[]>([]);
  const [tagSelections, setTagSelections] = useState<Record<string, string>>({});
  const [tagOptions, setTagOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [materialPreview, setMaterialPreview] = useState<Array<{ name: string; required: number; available: number }> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipeData, setRecipeData] = useState<AlchemyItem | null>(null);

  const findRecipeItem = (recipeId: string): AlchemyItem | null => {
    for (const category of ALCHEMY_RECIPES) {
      const item = category.items.find((i) => i.value === recipeId);
      if (item) return item;
    }
    return null;
  };

  useEffect(() => {
    const loadOptions = async () => {
      const inventory = await dataCache.getAsync('inventory', true);
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

      const inventory = await dataCache.getAsync('inventory', true);
      const recipe = findRecipeItem(selectedRecipe);
      setRecipeData(recipe);

      if (recipe) {
        const currentRecipe = recipe.recipes[selectedRecipeIndex];
        const newTagSelections: Record<string, string> = {};
        const newTagOptions: Record<string, { value: string; label: string }[]> = {};

        for (const materialId of Object.keys(currentRecipe.inputs)) {
          if (TAG_RESOURCE_MAP[materialId]) {
            const resources = TAG_RESOURCE_MAP[materialId];
            const opts = resources
              .map((id) => ({ id, count: inventory[id]?.count || 0, label: `${getCachedResourceName(id)} (${inventory[id]?.count || 0})` }))
              .sort((a, b) => b.count - a.count);
            newTagOptions[materialId] = opts.map((o) => ({ value: o.id, label: o.label }));
            newTagSelections[materialId] = opts[0]?.id || resources[0];
          } else if (materialId.startsWith('(monster_essence_lv')) {
            const level = ESSENCE_LEVEL_MAP[selectedRecipe];
            if (level) {
              const essenceKey = `monster_essence_lv${level}` as keyof typeof ESSENCE_CLASSIFICATION;
              const materials = ESSENCE_CLASSIFICATION[essenceKey];
              if (materials?.length > 0) {
                const options = materials
                  .map((id) => ({ value: id, label: `${getCachedResourceName(id)} (${inventory[id]?.count || 0})`, count: inventory[id]?.count || 0 }))
                  .sort((a, b) => b.count - a.count);
                setMaterialOptions(options);
                setSelectedMaterial(options[0]?.value || '');
              }
            }
          }
        }
        setTagSelections(newTagSelections);
        setTagOptions(newTagOptions);
      }
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
      const inventory = await dataCache.getAsync('inventory', true);
      const preview: Array<{ name: string; required: number; available: number }> = [];

      for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
        if (TAG_RESOURCE_MAP[materialId]) {
          const selectedResource = tagSelections[materialId];
          if (selectedResource) {
            preview.push({ name: getCachedResourceName(selectedResource), required: count * times, available: inventory[selectedResource]?.count || 0 });
          }
        } else if (materialId.startsWith('(monster_essence_lv')) {
          if (selectedMaterial) {
            preview.push({ name: getCachedResourceName(selectedMaterial), required: count * times, available: inventory[selectedMaterial]?.count || 0 });
          }
        } else {
          preview.push({ name: getCachedResourceName(materialId), required: count * times, available: inventory[materialId]?.count || 0 });
        }
      }
      setMaterialPreview(preview);
    };
    updatePreview();
  }, [selectedRecipe, selectedRecipeIndex, selectedMaterial, tagSelections, times, recipeData]);

  const handleSubmit = async () => {
    if (!selectedRecipe || !recipeData) {
      toast.warning('请选择配方');
      return;
    }

    const currentRecipe = recipeData.recipes[selectedRecipeIndex];
    const finalInputs: RecipeInput = {};

    for (const [materialId, { count }] of Object.entries(currentRecipe.inputs)) {
      if (TAG_RESOURCE_MAP[materialId]) {
        const selectedResource = tagSelections[materialId];
        if (!selectedResource) {
          toast.warning(`请选择 ${materialId} 的材料`);
          return;
        }
        finalInputs[selectedResource] = { count };
      } else if (materialId.startsWith('(monster_essence_lv')) {
        if (!selectedMaterial) {
          toast.warning('请选择怪物精华');
          return;
        }
        finalInputs[selectedMaterial] = { count };
      } else {
        finalInputs[materialId] = { count };
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
            options={recipeData.recipes.map((r, idx) => ({ value: String(idx), label: r.description || `配方 ${idx + 1}` }))}
          />
        </FormGroup>
      )}

      {materialOptions.length > 0 && (
        <FormGroup label="选择怪物精华">
          <Select value={selectedMaterial} onChange={(value) => setSelectedMaterial(value)} options={materialOptions} />
        </FormGroup>
      )}

      {Object.entries(tagOptions).map(([tag, options]) => (
        <FormGroup key={tag} label={`选择 ${tag}`}>
          <Select value={tagSelections[tag] || ''} onChange={(value) => setTagSelections({ ...tagSelections, [tag]: value })} options={options} />
        </FormGroup>
      ))}

      <FormGroup label="制作次数">
        <Input type="number" value={times} onChange={(value) => setTimes(Math.min(1000, Number(value)))} min={1} max={1000} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {[10, 100, 1000].map((value) => (
            <Button key={value} variant="secondary" onClick={() => setTimes((prev) => Math.min(1000, prev + value))} style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}>
              +{value}
            </Button>
          ))}
        </div>
      </FormGroup>

      {materialPreview && (
        <Card title="材料预览" style={{ minHeight: '60px' }}>
          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
            {materialPreview.map((item, idx) => (
              <div key={idx} style={{ color: item.available >= item.required ? '#52c41a' : '#ff4d4f' }}>
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
