import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { toast, ws, dataCache, BaseFeature, createLogger } from '@/core';

const logger = createLogger('Alchemy');
import { getWsErrorMessage } from '@/utils';
import { Modal, Card, FormGroup, Select, Button, Slider } from '@/ui/components';
import { getResourceDetail, getTAllGameResource } from '@/utils';
import ESSENCE_CLASSIFICATION from '@/config/monster-essence-classification.json';
import { ALCHEMY_RECIPES, ESSENCE_LEVEL_MAP, type AlchemyItem } from '@/config/alchemy-recipes';

const MAX_LIMIT = 1000;
const resourceNameCache = new Map<string, string>();

// 计算材料可用性的公共函数
function calculateMaxAvailable(
  inputs: Record<string, { count: number }>,
  inventory: Record<string, { count: number }>,
  tagMap: Record<string, string>,
  essence: string,
  currentMult: number = 1,
  maxLimit: number = MAX_LIMIT
): { maxMult: number; maxTimes: number } {
  let maxMult = maxLimit;

  // 计算最大倍数
  for (const [matId, { count }] of Object.entries(inputs)) {
    let avail = 0;
    if (isTag(matId)) avail = inventory[tagMap[matId]]?.count || 0;
    else if (isEssence(matId)) avail = inventory[essence]?.count || 0;
    else avail = inventory[matId]?.count || 0;

    maxMult = Math.min(maxMult, Math.floor(avail / count), Math.floor(maxLimit / count));
  }
  maxMult = Math.max(1, maxMult);

  // 计算最大次数
  let maxTimes = maxLimit;
  for (const [matId, { count }] of Object.entries(inputs)) {
    let avail = 0;
    if (isTag(matId)) avail = inventory[tagMap[matId]]?.count || 0;
    else if (isEssence(matId)) avail = inventory[essence]?.count || 0;
    else avail = inventory[matId]?.count || 0;

    maxTimes = Math.min(maxTimes, Math.floor(avail / (count * currentMult)));
  }
  maxTimes = Math.min(Math.max(1, maxTimes), maxLimit);

  return { maxMult, maxTimes };
}

const getResourceName = (id: string) => {
  if (!resourceNameCache.has(id)) {
    resourceNameCache.set(id, getResourceDetail(id)?.name || id);
  }
  return resourceNameCache.get(id)!;
};

const isEssence = (id: string) => id.startsWith('(monster_essence_lv');
const isTag = (id: string) => id.startsWith('(') && id.endsWith(')');

const fetchTagResources = async (tag: string): Promise<string[]> => {
  const cacheKey = `alchemy_tag_${tag}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const match = tag.match(/^\(([^)]+)\)$/);
  if (!match) return [];

  const tags = match[1].split(',').map((t) => t.trim());
  const allResources = await getTAllGameResource();
  const filtered = Object.keys(allResources).filter((key) => {
    const alchemyTag = allResources[key]?.alchemyTag;
    return Array.isArray(alchemyTag) && tags.every((t) => alchemyTag.includes(t));
  });

  sessionStorage.setItem(cacheKey, JSON.stringify(filtered));
  return filtered;
};

class AlchemyService extends BaseFeature {
  protected onInit(): void {
    logger.info('炼金服务初始化完成');
  }

  protected onReload(): void {
    // 炼金服务没有配置项需要重载
  }

  async submit(recipeId: string, inputs: Record<string, { count: number }>, times: number): Promise<boolean> {
    if (this.isRunning) {
      toast.warning('炼金任务进行中');
      return false;
    }

    this._running = true;
    try {
      toast.info(`正在提交炼金任务 ${getResourceName(recipeId)} x${times}...`);
      await ws.request('alchemy:auto:create', { input: inputs, times }, 30000);
      toast.success('✅ 炼金任务提交成功！');
      return true;
    } catch (error) {
      logger.error('炼金失败', error);
      toast.error(getWsErrorMessage(error, '炼金任务提交失败'));
      return false;
    } finally {
      this._running = false;
    }
  }
}

export const alchemyManager = new AlchemyService();

const AlchemyForm = ({ onClose }: { onClose: () => void }) => {
  const [recipe, setRecipe] = useState('');
  const [recipeIdx, setRecipeIdx] = useState(0);
  const [recipeData, setRecipeData] = useState<AlchemyItem | null>(null);
  const [essence, setEssence] = useState('');
  const [essenceOpts, setEssenceOpts] = useState<{ value: string; label: string }[]>([]);
  const [tagMap, setTagMap] = useState<Record<string, string>>({});
  const [tagOptsMap, setTagOptsMap] = useState<Record<string, { value: string; label: string }[]>>({});
  const [mult, setMult] = useState(1);
  const [maxMult, setMaxMult] = useState(MAX_LIMIT);
  const [times, setTimes] = useState(1);
  const [maxTimes, setMaxTimes] = useState(MAX_LIMIT);
  const [preview, setPreview] = useState<{ name: string; required: number; available: number }[] | null>(null);
  const [recipeOpts, setRecipeOpts] = useState<{ label: string; options: { value: string; label: string }[] }[]>([]);

  useEffect(() => {
    (async () => {
      const inv = await dataCache.getAsync('inventory');
      setRecipeOpts(
        ALCHEMY_RECIPES.map((cat) => ({
          label: cat.label,
          options: cat.items.map((item) => ({
            value: item.value,
            label: `${item.label} (${inv[item.value]?.count || 0})`,
          })),
        })),
      );
    })();
  }, []);

  useEffect(() => {
    if (!recipe) {
      setRecipeData(null);
      setEssenceOpts([]);
      setEssence('');
      setTagMap({});
      setTagOptsMap({});
      setPreview(null);
      return;
    }

    (async () => {
      const found = ALCHEMY_RECIPES.flatMap((c) => c.items).find((i) => i.value === recipe);
      setRecipeData(found || null);
      if (!found) return;

      const inv = await dataCache.getAsync('inventory');
      const curr = found.recipes[recipeIdx];
      const newTagMap: Record<string, string> = {};
      const newTagOpts: Record<string, { value: string; label: string }[]> = {};
      let newEssence = '';
      const newEssenceOpts: { value: string; label: string; count: number }[] = [];

      for (const matId of Object.keys(curr.inputs)) {
        if (isTag(matId)) {
          const res = await fetchTagResources(matId);
          const opts = res
            .map((id) => ({ id, count: inv[id]?.count || 0, label: `${getResourceName(id)} (${inv[id]?.count || 0})` }))
            .sort((a, b) => b.count - a.count);
          newTagOpts[matId] = opts.map((o) => ({ value: o.id, label: o.label }));
          newTagMap[matId] = opts[0]?.id || res[0];
        } else if (isEssence(matId)) {
          const lvl = ESSENCE_LEVEL_MAP[recipe];
          if (lvl) {
            const key = `monster_essence_lv${lvl}` as keyof typeof ESSENCE_CLASSIFICATION;
            const mats = ESSENCE_CLASSIFICATION[key];
            if (mats?.length) {
              const opts = mats
                .map((id) => ({ value: id, label: `${getResourceName(id)} (${inv[id]?.count || 0})`, count: inv[id]?.count || 0 }))
                .sort((a, b) => b.count - a.count);
              newEssenceOpts.push(...opts);
              newEssence = opts[0]?.value || '';
            }
          }
        }
      }

      const { maxMult: calcMaxMult, maxTimes: calcMaxTimes } = calculateMaxAvailable(
        curr.inputs,
        inv,
        newTagMap,
        newEssence,
        1,
        MAX_LIMIT
      );

      setEssenceOpts(newEssenceOpts);
      setEssence(newEssence);
      setTagMap(newTagMap);
      setTagOptsMap(newTagOpts);
      setMaxMult(calcMaxMult);
      setMult(calcMaxMult);
      setMaxTimes(calcMaxTimes);
      setTimes(calcMaxTimes);
    })();
  }, [recipe, recipeIdx]);

  useEffect(() => {
    if (!recipe || !recipeData) {
      setPreview(null);
      return;
    }

    (async () => {
      const inv = await dataCache.getAsync('inventory');
      const curr = recipeData.recipes[recipeIdx];
      const prev: { name: string; required: number; available: number }[] = [];

      for (const [matId, { count }] of Object.entries(curr.inputs)) {
        let resId = matId;
        if (isTag(matId)) {
          resId = tagMap[matId];
          if (!resId) continue;
        } else if (isEssence(matId)) {
          resId = essence;
          if (!resId) continue;
        }
        prev.push({ name: getResourceName(resId), required: count * mult * times, available: inv[resId]?.count || 0 });
      }
      setPreview(prev);
    })();
  }, [essence, tagMap, times, mult, recipeData]);

  useEffect(() => {
    if (!recipeData) return;

    (async () => {
      const inv = await dataCache.getAsync('inventory');
      const curr = recipeData.recipes[recipeIdx];

      const { maxMult: calcMaxMult } = calculateMaxAvailable(curr.inputs, inv, tagMap, essence, 1, MAX_LIMIT);
      setMaxMult(calcMaxMult);
      if (mult > calcMaxMult) setMult(calcMaxMult);

      const { maxTimes: calcMaxTimes } = calculateMaxAvailable(curr.inputs, inv, tagMap, essence, mult > calcMaxMult ? calcMaxMult : mult, MAX_LIMIT);
      setMaxTimes(calcMaxTimes);
      if (times > calcMaxTimes) setTimes(calcMaxTimes);
    })();
  }, [essence, tagMap]);

  useEffect(() => {
    if (!recipeData) return;

    (async () => {
      const inv = await dataCache.getAsync('inventory');
      const curr = recipeData.recipes[recipeIdx];
      const { maxTimes: calcMaxTimes } = calculateMaxAvailable(curr.inputs, inv, tagMap, essence, mult, MAX_LIMIT);
      setMaxTimes(calcMaxTimes);
      setTimes(calcMaxTimes);
    })();
  }, [mult]);

  const handleSubmit = async () => {
    if (!recipe || !recipeData) {
      toast.warning('请选择配方');
      return;
    }

    const curr = recipeData.recipes[recipeIdx];
    const inputs: Record<string, { count: number }> = {};

    for (const [matId, { count }] of Object.entries(curr.inputs)) {
      if (isTag(matId)) {
        const sel = tagMap[matId];
        if (!sel) {
          toast.warning(`请选择 ${matId} 的材料`);
          return;
        }
        inputs[sel] = { count: count * mult };
      } else if (isEssence(matId)) {
        if (!essence) {
          toast.warning('请选择怪物精华');
          return;
        }
        inputs[essence] = { count: count * mult };
      } else {
        inputs[matId] = { count: count * mult };
      }
    }

    const success = await alchemyManager.submit(recipe, inputs, times);
    if (success) {
      onClose();
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
          value={recipe}
          onChange={(v) => {
            setRecipe(v);
            setRecipeIdx(0);
          }}
          options={recipeOpts}
          placeholder="-- 请选择配方 --"
        />
      </FormGroup>

      {recipeData && recipeData.recipes.length > 1 && (
        <FormGroup label="配方选项">
          <Select
            value={String(recipeIdx)}
            onChange={(v) => setRecipeIdx(Number(v))}
            options={recipeData.recipes.map((r, i) => ({ value: String(i), label: r.description || `配方 ${i + 1}` }))}
          />
        </FormGroup>
      )}

      {essenceOpts.length > 0 && (
        <FormGroup label="选择怪物精华">
          <Select value={essence} onChange={setEssence} options={essenceOpts} />
        </FormGroup>
      )}

      {Object.entries(tagOptsMap).map(([tag, opts]) => (
        <FormGroup key={tag} label={`选择 ${tag}`}>
          <Select value={tagMap[tag] || ''} onChange={(v) => setTagMap({ ...tagMap, [tag]: v })} options={opts} />
        </FormGroup>
      ))}

      <FormGroup label={`材料倍数: ${mult} (1 - ${maxMult})`}>
        <Slider value={mult} onInput={setMult} min={1} max={maxMult} step={1} />
      </FormGroup>

      <FormGroup label={`制作次数: ${times} (1 - ${maxTimes})`}>
        <Slider value={times} onInput={setTimes} min={1} max={maxTimes} step={1} />
      </FormGroup>

      {preview && (
        <Card title={`材料预览 (总计: ${mult} × ${times} = ${mult * times})`} style={{ minHeight: '60px' }}>
          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
            {preview.map((p, i) => (
              <div key={i} style={{ color: '#52c41a' }}>
                {p.name}: {p.required} / {p.available}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
        <Button variant="secondary" onClick={onClose} style={{ flex: 1 }} disabled={alchemyManager.isRunning}>
          取消
        </Button>
        <Button onClick={handleSubmit} style={{ flex: 1 }} disabled={alchemyManager.isRunning}>
          {alchemyManager.isRunning ? '提交中...' : '提交'}
        </Button>
      </div>
    </>
  );
};

export class AlchemyPanel {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  show() {
    if (this.isOpen) return;
    this.isOpen = true;

    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    render(
      <Modal isOpen={true} onClose={() => this.hide()} title="⚗️ 快速炼金">
        <AlchemyForm onClose={() => this.hide()} />
      </Modal>,
      this.container,
    );
  }

  hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.container) render(null, this.container);
  }
}
