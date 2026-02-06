/**
 * 资源监控功能模块
 * 包含资源监控器和提醒组件
 */

import { render } from 'preact';
import { logger, toast, dataCache, ws, eventBus, EVENTS, BaseFeature } from '@/core';
import { getWsErrorMessage } from '@/utils';
import type { PanelButton } from '@/types';
import { DEFAULT_RESOURCES } from '@/config/defaults';
import type { MonitorType, ResourceConfig, ResourceCategory } from '@/config/defaults';
import { appConfig } from '@/config/gm-settings';
import { getTAllGameResource, sleep } from '@/utils';

// ==================== 类型定义 ====================

export interface ResourceItem {
  name: string;
  count: number;
  threshold: number;
  type: 'insufficient' | 'excess';
}

// ==================== 资源提醒组件 ====================

interface ResourceAlertProps {
  insufficientCount: number;
  excessCount: number;
  categories: Array<{ name: string; items: ResourceItem[] }>;
}

export function ResourceAlert({ insufficientCount, excessCount, categories }: ResourceAlertProps) {
  const title =
    insufficientCount > 0 && excessCount > 0
      ? `⚠️ 资源监控警告 (${insufficientCount}项不足, ${excessCount}项超过)`
      : insufficientCount > 0
        ? `⚠️ 资源不足警告 (${insufficientCount}项)`
        : `📦 资源超过警告 (${excessCount}项)`;

  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>{title}</div>
      {categories.map((cat) => (
        <div key={cat.name} style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#666', marginBottom: '4px' }}>{cat.name}</div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              paddingLeft: '12px',
            }}
          >
            {cat.items.map((item) => {
              const diff = item.type === 'insufficient' ? item.threshold - item.count : item.count - item.threshold;
              const diffText = item.type === 'insufficient' ? `-${diff}` : `+${diff}`;
              return (
                <div
                  key={item.name}
                  style={{
                    width: 'calc(50% - 2px)',
                    boxSizing: 'border-box',
                    fontSize: '12px',
                  }}
                >
                  {item.name}: {item.count}/{item.threshold} ({diffText})
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function createResourceAlertHTML(
  insufficientCount: number,
  excessCount: number,
  categories: Array<{ name: string; items: ResourceItem[] }>,
): string {
  const container = document.createElement('div');
  render(
    <ResourceAlert insufficientCount={insufficientCount} excessCount={excessCount} categories={categories} />,
    container,
  );
  return container.innerHTML;
}

// ==================== 资源监控器 ====================

const BASE_RESOURCES = ['berry', 'fish', 'wood', 'stone', 'coal'] as const;
const PROGRESS_ID = 'resource-monitor';

class ResourceMonitor extends BaseFeature {
  private resources: Record<string, ResourceConfig>;
  private enabled = false;
  private autoBuyEnabled = false;
  private nameToIdCache: Map<string, string> | null = null;

  constructor() {
    super();
    this.resources = this.flattenCategories(DEFAULT_RESOURCES);
  }

  protected async onInit(): Promise<void> {
    this.enabled = await appConfig.RESOURCE_MONITOR_ENABLED.get();
    this.autoBuyEnabled = await appConfig.AUTO_BUY_BASE_RESOURCES.get();
    this.resources = await this.loadResources();
    eventBus.on(EVENTS.SETTINGS_UPDATED, () => this.reload());
    logger.success('资源监控器初始化完成');
  }

  protected async onReload(): Promise<void> {
    this.enabled = await appConfig.RESOURCE_MONITOR_ENABLED.get();
    this.autoBuyEnabled = await appConfig.AUTO_BUY_BASE_RESOURCES.get();
    this.resources = await this.loadResources();
    logger.info('资源监控配置已刷新');
  }

  private flattenCategories(categories: ResourceCategory[]): Record<string, ResourceConfig> {
    return categories.reduce((acc, cat) => ({ ...acc, ...cat.items }), {});
  }

  private async loadResources(): Promise<Record<string, ResourceConfig>> {
    const saved = await appConfig.MONITORED_RESOURCES.get();
    if (!saved || saved === '{}') return this.flattenCategories(DEFAULT_RESOURCES);

    try {
      const savedData = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (typeof savedData !== 'object' || Object.keys(savedData).length === 0) {
        return this.flattenCategories(DEFAULT_RESOURCES);
      }

      const defaults = this.flattenCategories(DEFAULT_RESOURCES);

      if (this.hasConfigChanged(savedData, defaults)) {
        logger.info('检测到默认配置变更，合并新资源项');
        const merged = this.mergeResources(savedData, defaults);
        await appConfig.MONITORED_RESOURCES.set(JSON.stringify(merged));
        return merged;
      }

      return savedData;
    } catch (error) {
      logger.error('解析资源配置失败，使用默认配置', error);
      return this.flattenCategories(DEFAULT_RESOURCES);
    }
  }

  private hasConfigChanged(saved: Record<string, ResourceConfig>, defaults: Record<string, ResourceConfig>): boolean {
    const savedKeys = Object.keys(saved).sort();
    const defaultKeys = Object.keys(defaults).sort();
    return JSON.stringify(savedKeys) !== JSON.stringify(defaultKeys);
  }

  private mergeResources(
    saved: Record<string, ResourceConfig>,
    defaults: Record<string, ResourceConfig>,
  ): Record<string, ResourceConfig> {
    const merged = { ...defaults };
    for (const key of Object.keys(saved)) {
      if (key in merged) {
        merged[key] = saved[key];
      }
    }
    return merged;
  }

  async checkResources(persistent: boolean = true): Promise<void> {
    if (!this.enabled) {
      logger.debug('资源监控未启用');
      return;
    }

    try {
      await this.performCheck(true, persistent);
    } catch (error) {
      toast.hideProgress(PROGRESS_ID);
      logger.error('获取库存数据失败', error);
      toast.error(getWsErrorMessage(error, '获取库存数据失败，请稍后重试'));
    }
  }

  private async performCheck(showAlert: boolean, persistent: boolean = true): Promise<void> {
    const gameResources = await getTAllGameResource();

    this.buildNameToIdCache(gameResources);

    let problematicItems = await this.findProblematicItems(gameResources);

    const hasBought = await this.autoBuyBaseResources(problematicItems);

    if (hasBought) {
      await sleep(500);
      problematicItems = await this.findProblematicItems(gameResources);
    }

    toast.hideProgress(PROGRESS_ID);

    const remainingItems = this.autoBuyEnabled
      ? problematicItems.filter((item) => {
        const id = this.nameToIdCache?.get(item.name);
        return item.type !== 'insufficient' || !id || !BASE_RESOURCES.includes(id as any);
      })
      : problematicItems;

    const insufficientCount = remainingItems.filter((item) => item.type === 'insufficient').length;
    const excessCount = remainingItems.filter((item) => item.type === 'excess').length;

    logger.info(`资源检查完成: ${insufficientCount} 项不足, ${excessCount} 项超过`);

    if (showAlert) {
      if (remainingItems.length > 0) {
        this.showAlert(remainingItems, persistent);
      } else {
        toast.success('✅ 所有资源充足，无需补充', 3000);
      }
    }
  }

  private async findProblematicItems(gameResources: any): Promise<ResourceItem[]> {
    const items: ResourceItem[] = [];

    try {
      toast.progress('📦 正在获取库存数据...', PROGRESS_ID);
      const inventory = await dataCache.getAsync('inventory', true);

      for (const [id, config] of Object.entries(this.resources)) {
        if (config.threshold === 0) continue;
        const count = inventory[id]?.count || 0;
        const isProblematic = config.type === 'insufficient' ? count < config.threshold : count >= config.threshold;

        if (isProblematic) {
          items.push({
            name: gameResources[id]?.name || id,
            count,
            threshold: config.threshold,
            type: config.type,
          });
        }
      }
    } catch (error) {
      toast.hideProgress(PROGRESS_ID);
      throw error;
    }

    return items;
  }

  private buildNameToIdCache(gameResources: any): void {
    if (this.nameToIdCache) return;
    this.nameToIdCache = new Map();
    for (const [id, resource] of Object.entries(gameResources)) {
      if (resource && typeof resource === 'object' && 'name' in resource && typeof resource.name === 'string') {
        this.nameToIdCache.set(resource.name, id);
      }
    }
  }

  private async autoBuyBaseResources(problematicItems: ResourceItem[]): Promise<boolean> {
    if (!this.autoBuyEnabled || !this.nameToIdCache) {
      toast.hideProgress(PROGRESS_ID);
      return false;
    }

    let hasBought = false;
    const boughtItems: string[] = [];

    for (const item of problematicItems) {
      if (item.type !== 'insufficient') continue;

      const resourceId = this.nameToIdCache.get(item.name);
      if (!resourceId || !BASE_RESOURCES.includes(resourceId as any)) continue;

      const targetAmount = Math.floor(item.threshold * 1.1);
      const needed = targetAmount - item.count;
      if (needed > 0) {
        try {
          toast.progress(`🛍️ 正在购买: ${item.name} x${needed}`, PROGRESS_ID);
          await ws.emit('requestShopBuyResource', { id: resourceId, count: needed });
          logger.info(`自动购买基础资源: ${item.name} x${needed} (目标: ${targetAmount})`);
          boughtItems.push(`${item.name}x${needed}`);
          hasBought = true;
        } catch (error) {
          toast.hideProgress(PROGRESS_ID);
          logger.error(`购买 ${item.name} 失败`, error);
          toast.warning(`购买 ${item.name} 失败: ${getWsErrorMessage(error, '未知错误')}`);
          return false;
        }
      }
    }

    if (!hasBought) {
      toast.hideProgress(PROGRESS_ID);
    }

    return hasBought;
  }

  private showAlert(items: ResourceItem[], persistent: boolean = true): void {
    const categorized = this.categorizeItems(items);
    const insufficientCount = items.filter((item) => item.type === 'insufficient').length;
    const excessCount = items.filter((item) => item.type === 'excess').length;
    const content = createResourceAlertHTML(insufficientCount, excessCount, categorized);

    if (persistent) {
      toast.confirm(content);
    } else {
      toast.warning(content, 5000);
    }
  }

  private categorizeItems(items: ResourceItem[]): Array<{ name: string; items: ResourceItem[] }> {
    if (!this.nameToIdCache) return [];

    const result: Array<{ name: string; items: ResourceItem[] }> = [];

    for (const category of DEFAULT_RESOURCES) {
      const categoryItems = items.filter((item) => {
        const itemId = this.nameToIdCache!.get(item.name);
        return itemId && itemId in category.items;
      });

      if (categoryItems.length > 0) {
        result.push({ name: category.name, items: categoryItems });
      }
    }

    return result;
  }

  getButton(): PanelButton | null {
    return this.enabled ? { text: '📦 查看库存', onClick: () => void this.checkResources() } : null;
  }

  getMonitoredResources(): Record<string, ResourceConfig> {
    return { ...this.resources };
  }

  async getMonitoredResourcesWithNames(): Promise<
    Array<{ id: string; name: string; threshold: number; type: MonitorType }>
  > {
    const gameResources = await getTAllGameResource();
    return Object.entries(this.resources).map(([id, config]) => ({
      id,
      name: gameResources[id]?.name || id,
      threshold: config.threshold,
      type: config.type,
    }));
  }

  async getMonitoredResourcesByCategory(): Promise<ResourceCategory[]> {
    const gameResources = await getTAllGameResource();
    if (!gameResources) return [];
    return DEFAULT_RESOURCES.map((category) => ({
      name: category.name,
      items: Object.fromEntries(
        Object.keys(category.items).map((id) => [id, this.resources[id] ?? category.items[id]]),
      ),
    }));
  }

  async setMonitoredResources(resources: Record<string, ResourceConfig>): Promise<void> {
    this.resources = resources;
    const defaults = this.flattenCategories(DEFAULT_RESOURCES);
    const isEqual = JSON.stringify(resources) === JSON.stringify(defaults);
    if (isEqual) {
      await GM.deleteValue(appConfig.MONITORED_RESOURCES.key);
    } else {
      await appConfig.MONITORED_RESOURCES.set(JSON.stringify(resources));
    }
    logger.info('资源配置已更新');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isAutoBuyEnabled(): boolean {
    return this.autoBuyEnabled;
  }
}

export const resourceMonitor = new ResourceMonitor();
