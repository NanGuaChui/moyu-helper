/**
 * 强化助手功能模块
 * 从 qh.js 移植，使用项目现有 ws 模块和 UI 组件
 */

import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { BaseFeature, ws, logger, toast } from '@/core';
import { Modal, Button, Card, Row, Input } from '@/ui/components';
import { getResourceDetail } from '@/utils/resource';
import { appConfig } from '@/config/gm-settings';
import type { Unsubscribe } from '@/types';

// ── 工具函数 ───────────────────────────────────────────────────

function parseItemLevel(itemId: string): { baseItem: string; level: number } {
  const match = itemId.match(/(.+?)\+(\d+)$/);
  return match ? { baseItem: match[1], level: parseInt(match[2], 10) } : { baseItem: itemId, level: 0 };
}

function getItemDisplayName(resourceId: string): string {
  const { baseItem, level } = parseItemLevel(resourceId);
  const detail = getResourceDetail(baseItem);
  const name = detail?.name || baseItem;
  return level > 0 ? `${name}+${level}` : name;
}

// ── 类型定义 ───────────────────────────────────────────────────

type ProtectMode = 'none' | 'item' | 'essence';

interface LevelStat {
  attempts: number;
  success: number;
}

interface EnhanceStats {
  baseItem: string;
  startLevel: number;
  currentLevel: number;
  targetLevel: number;
  maxReachedLevel: number;
  levelStats: Record<number, LevelStat>;
  totalAttempts: number;
  totalSuccess: number;
  startTime: number | null;
}

// ── 核心管理器 ─────────────────────────────────────────────────

class EnhanceManager extends BaseFeature {
  // 监听与运行状态
  private isListening = false;
  private isAutoEnhancing = false;
  private enhanceTimer: ReturnType<typeof setTimeout> | null = null;

  // 捕获的数据
  private currentItem: { resourceId: string } | null = null;

  // 配置项
  private targetLevel = 10;
  private interval = 3000;
  private batchCount = 1;
  private protectMode: ProtectMode = 'essence';
  private protectStartLevel = 2;

  // 统计数据
  private enhanceStats: EnhanceStats = {
    baseItem: '',
    startLevel: 0,
    currentLevel: 0,
    targetLevel: 0,
    maxReachedLevel: 0,
    levelStats: {},
    totalAttempts: 0,
    totalSuccess: 0,
    startTime: null,
  };

  // UI 状态
  private container: HTMLDivElement | null = null;
  private isOpen = false;
  private unsubscribers: Unsubscribe[] = [];
  private renderCallback: (() => void) | null = null;

  // Progress toast
  private static readonly PROGRESS_ID = 'enhance-progress';
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  protected async onInit(): Promise<void> {
    await this.loadCachedConfig();
  }

  protected onReload(): void {}

  setRenderCallback(cb: () => void): void {
    this.renderCallback = cb;
  }

  // ── 缓存管理 ─────────────────────────────────────────────────

  private async loadCachedConfig(): Promise<void> {
    try {
      const config = await appConfig.ENHANCE_CONFIG.get();
      if (config.item) {
        this.currentItem = { resourceId: config.item };
        logger.info(`[强化助手] 加载缓存物品: ${getItemDisplayName(config.item)}`);
      }
      this.targetLevel = config.targetLevel;
      this.interval = config.interval;
      this.batchCount = config.batchCount;
      this.protectMode = config.protectMode;
      this.protectStartLevel = config.protectStartLevel;

      // 触发 UI 更新
      this.renderCallback?.();
    } catch (err) {
      logger.error('[强化助手] 加载缓存失败', err);
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await appConfig.ENHANCE_CONFIG.set({
        item: this.currentItem?.resourceId || null,
        targetLevel: this.targetLevel,
        interval: this.interval,
        batchCount: this.batchCount,
        protectMode: this.protectMode,
        protectStartLevel: this.protectStartLevel,
      });
    } catch (err) {
      logger.error('[强化助手] 保存配置失败', err);
    }
  }

  async clearCachedItem(): Promise<void> {
    try {
      const config = await appConfig.ENHANCE_CONFIG.get();
      await appConfig.ENHANCE_CONFIG.set({ ...config, item: null });
      this.currentItem = null;
      logger.info('[强化助手] 已清除缓存物品');
      this.renderCallback?.();
    } catch (err) {
      logger.error('[强化助手] 清除缓存失败', err);
    }
  }

  // ── 监听控制 ─────────────────────────────────────────────────

  startListening(): void {
    if (this.isListening) return;
    this.isListening = true;

    // 监听强化结果
    const unsubResult = ws.on('enhance:require:success', (msg) => {
      this.handleEnhanceResult(msg);
    });
    this.unsubscribers.push(unsubResult);

    // 监听强化失败（背包没有物品等）
    const unsubFail = ws.on(['enhance:require:fail', 'enhance:result:error'], (msg) => {
      this.handleEnhanceFail(msg);
    });
    this.unsubscribers.push(unsubFail);

    logger.success('[强化助手] 开始监听');
    this.renderCallback?.();
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    if (this.isAutoEnhancing) {
      this.stopAutoEnhance();
    }
    logger.info('[强化助手] 停止监听');
    this.renderCallback?.();
  }

  get listening(): boolean {
    return this.isListening;
  }

  get autoEnhancing(): boolean {
    return this.isAutoEnhancing;
  }

  get stats(): EnhanceStats {
    return this.enhanceStats;
  }

  get item(): { resourceId: string } | null {
    return this.currentItem;
  }

  // ── 强化结果处理 ─────────────────────────────────────────────

  private handleEnhanceResult(msg: any): void {
    const data = msg.payload?.data;
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'success') || !data.enhanceResultId) return;

    const resultId: string = data.enhanceResultId;
    const success: boolean = data.success;
    const { baseItem, level } = parseItemLevel(resultId);

    // 更新当前物品
    this.currentItem = { resourceId: resultId };
    // 保存到缓存
    this.saveConfig();

    // 更新统计
    if (this.isAutoEnhancing || this.enhanceStats.baseItem === baseItem) {
      const attemptLevel = this.enhanceStats.currentLevel;
      if (!this.enhanceStats.levelStats[attemptLevel]) {
        this.enhanceStats.levelStats[attemptLevel] = { attempts: 0, success: 0 };
      }
      this.enhanceStats.levelStats[attemptLevel].attempts++;
      this.enhanceStats.totalAttempts++;
      if (success) {
        this.enhanceStats.levelStats[attemptLevel].success++;
        this.enhanceStats.totalSuccess++;
      }
      this.enhanceStats.currentLevel = level;
      if (level > this.enhanceStats.maxReachedLevel) {
        this.enhanceStats.maxReachedLevel = level;
      }
    }

    // 自动强化逻辑
    if (this.isAutoEnhancing) {
      // 目标达成判断
      if (this.enhanceStats.currentLevel >= this.enhanceStats.targetLevel) {
        if (this.batchCount > 1) {
          this.batchCount--;
          // 重置为 baseItem +0
          const baseItemId = this.enhanceStats.baseItem;
          this.currentItem = { resourceId: baseItemId };
          this.initStats(baseItemId, this.targetLevel);
          this.renderCallback?.();
          this.scheduleNextEnhance();
        } else {
          this.stopAutoEnhance(true);
        }
        return;
      }
      this.scheduleNextEnhance();
    }

    this.renderCallback?.();
  }

  private handleEnhanceFail(msg: any): void {
    const failMsg = msg.payload?.data?.msg;
    if (!this.isAutoEnhancing) return;

    if (failMsg === '背包中没有该装备，无法强化') {
      const nextItem = this.findNextItem();
      if (nextItem) {
        this.currentItem = nextItem;
        this.renderCallback?.();
        this.scheduleNextEnhance();
      } else {
        logger.warn('[强化助手] 找不到可用的同类物品，停止强化');
        this.stopAutoEnhance();
      }
    } else if (failMsg === '操作过于频繁，请稍后再试') {
      this.scheduleNextEnhance();
    } else {
      logger.warn(`[强化助手] 强化失败: ${failMsg}`);
      this.stopAutoEnhance();
    }
  }

  private findNextItem(): { resourceId: string } | null {
    if (!this.currentItem) return null;
    const { baseItem, level } = parseItemLevel(this.currentItem.resourceId);
    for (let l = level - 1; l >= 0; l--) {
      const nextId = l > 0 ? `${baseItem}+${l}` : baseItem;
      return { resourceId: nextId };
    }
    return null;
  }

  // ── 自动强化控制 ─────────────────────────────────────────────

  startAutoEnhance(): void {
    if (this.isAutoEnhancing || !this.currentItem) return;

    // 如果还没有开始监听，自动开始监听
    if (!this.isListening) {
      this.startListening();
    }

    this.isAutoEnhancing = true;
    this.initStats(this.currentItem.resourceId, this.targetLevel);
    this.scheduleNextEnhance();
    this.renderCallback?.();
  }

  stopAutoEnhance(isFinished = false): void {
    if (this.enhanceTimer) {
      clearTimeout(this.enhanceTimer);
      this.enhanceTimer = null;
    }
    this.isAutoEnhancing = false;

    // 自动强化停止时，同时停止监听
    if (this.isListening) {
      this.isListening = false;
      this.unsubscribers.forEach((fn) => fn());
      this.unsubscribers = [];
      logger.info('[强化助手] 自动强化停止，已同时停止监听');
    }

    this.hideProgressToast();
    if (isFinished) {
      toast.success(`🎉 强化完成！${getItemDisplayName(this.currentItem?.resourceId || '')}`);
    }
    this.renderCallback?.();
  }

  private scheduleNextEnhance(): void {
    if (this.enhanceTimer) clearTimeout(this.enhanceTimer);
    this.enhanceTimer = setTimeout(() => this.sendEnhanceRequest(), this.interval);
  }

  private async sendEnhanceRequest(): Promise<void> {
    if (!this.isAutoEnhancing || !this.currentItem) return;

    const data: any = { resourceId: this.currentItem.resourceId };

    // 保护逻辑
    if (this.enhanceStats.currentLevel >= this.protectStartLevel && this.protectMode !== 'none') {
      if (this.protectMode === 'essence') {
        data.protectedResourceId = 'starEssence';
      } else if (this.protectMode === 'item') {
        const info = parseItemLevel(this.currentItem.resourceId);
        const protectLevel = Math.max(0, info.level - 4);
        data.protectedResourceId = protectLevel > 0 ? `${info.baseItem}+${protectLevel}` : info.baseItem;
      }
    }

    try {
      await ws.emit('enhance:require', data);
    } catch (err) {
      logger.error('[强化助手] 发送强化请求失败', err);
      this.stopAutoEnhance();
    }
  }

  private initStats(itemId: string, targetLevel: number): void {
    const { baseItem, level } = parseItemLevel(itemId);
    this.enhanceStats = {
      baseItem,
      startLevel: level,
      currentLevel: level,
      targetLevel,
      maxReachedLevel: level,
      levelStats: {},
      totalAttempts: 0,
      totalSuccess: 0,
      startTime: Date.now(),
    };
    for (let i = level; i < targetLevel; i++) {
      this.enhanceStats.levelStats[i] = { attempts: 0, success: 0 };
    }
  }

  // ── 配置 getter/setter ──────────────────────────────────────

  getConfig() {
    return {
      targetLevel: this.targetLevel,
      interval: this.interval,
      batchCount: this.batchCount,
      protectMode: this.protectMode,
      protectStartLevel: this.protectStartLevel,
    };
  }

  setTargetLevel(v: number): void {
    this.targetLevel = Math.max(1, Math.min(15, v));
    this.saveConfig();
  }
  setInterval(v: number): void {
    this.interval = Math.max(100, v);
    this.saveConfig();
  }
  setBatchCount(v: number): void {
    this.batchCount = Math.max(1, v);
    this.saveConfig();
  }
  setProtectMode(v: ProtectMode): void {
    this.protectMode = v;
    this.saveConfig();
  }
  setProtectStartLevel(v: number): void {
    this.protectStartLevel = Math.max(0, Math.min(15, v));
    this.saveConfig();
  }

  // ── Modal 控制 ──────────────────────────────────────────────

  async openModal(): Promise<void> {
    // 确保已初始化（懒加载）
    if (!this.isInitialized) {
      await this.init();
    }

    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }
    this.isOpen = true;
    this.hideProgressToast();
    this.renderUI();
  }

  private closeModal = (): void => {
    this.isOpen = false;
    if (this.isListening) {
      this.showProgressToast();
    }
    this.renderUI();
  };

  // ── Progress Toast ──────────────────────────────────────────

  private buildProgressSummary(): string {
    if (this.isAutoEnhancing) {
      const s = this.enhanceStats;
      const name = getItemDisplayName(s.baseItem);
      return `🔨 强化中 | ${name} +${s.currentLevel} → +${s.targetLevel}`;
    }
    const itemName = this.currentItem ? getItemDisplayName(this.currentItem.resourceId) : '';
    return `🔨 监听中${itemName ? ` | ${itemName}` : ''} | 等待强化事件...`;
  }

  private showProgressToast(): void {
    const onClick = () => this.openModal();
    toast.progress(this.buildProgressSummary(), EnhanceManager.PROGRESS_ID, onClick);
    this.progressTimer = setInterval(() => {
      if (!this.isListening) {
        this.hideProgressToast();
        return;
      }
      toast.progress(this.buildProgressSummary(), EnhanceManager.PROGRESS_ID, onClick);
    }, 2000);
  }

  private hideProgressToast(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    toast.hideProgress(EnhanceManager.PROGRESS_ID);
  }

  renderUI(): void {
    if (!this.container) return;
    render(<EnhanceModal isOpen={this.isOpen} onClose={this.closeModal} manager={this} />, this.container);
  }
}

export const enhanceManager = new EnhanceManager();

// ── UI 组件 ────────────────────────────────────────────────────

interface EnhanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  manager: EnhanceManager;
}

function EnhanceModal({ isOpen, onClose, manager }: EnhanceModalProps) {
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    manager.setRenderCallback(forceUpdate);
    return () => manager.setRenderCallback(() => {});
  }, [manager, forceUpdate]);

  const config = manager.getConfig();
  const stats = manager.stats;
  const item = manager.item;
  const isListening = manager.listening;
  const isAutoEnhancing = manager.autoEnhancing;

  const handleToggleListening = () => {
    if (isListening) manager.stopListening();
    else manager.startListening();
    forceUpdate();
  };

  const handleToggleEnhance = () => {
    if (isAutoEnhancing) manager.stopAutoEnhance();
    else manager.startAutoEnhance();
    forceUpdate();
  };

  const successRate = stats.totalAttempts > 0 ? ((stats.totalSuccess / stats.totalAttempts) * 100).toFixed(1) : '0.0';

  const PROTECT_BTN_STYLE = (active: boolean) => ({
    flex: 1,
    fontSize: '11px',
    padding: '6px 4px',
    ...(active ? {} : { background: '#f3f4f6', color: '#374151', border: '1px solid rgba(0,0,0,0.08)' }),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🔨 强化助手" maxWidth="420px" maxHeight="85vh">
      {/* 监听控制 */}
      <div style={{ marginBottom: '10px' }}>
        <Button variant={isListening ? 'danger' : 'primary'} onClick={handleToggleListening} disabled={isAutoEnhancing}>
          {isListening ? '⏹ 停止监听' : '▶ 开始监听'}
        </Button>
      </div>

      {/* 当前物品 */}
      <Card title="📦 当前物品">
        <div style={{ fontSize: '14px', color: item ? '#f59e0b' : '#999', fontWeight: item ? '600' : '400' }}>
          {item ? getItemDisplayName(item.resourceId) : '等待监听强化结果...'}
        </div>
        {item && (
          <>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>💾 已缓存，下次打开将自动加载</div>
            <Button
              variant="secondary"
              onClick={() => manager.clearCachedItem()}
              disabled={isAutoEnhancing}
              style={{ fontSize: '11px', padding: '4px 8px', marginTop: '8px', width: '100%' }}
            >
              清除
            </Button>
          </>
        )}
      </Card>

      {/* 强化设置 - 监听到物品后才显示 */}
      {item && (
        <Card title="⚙️ 强化设置">
          <Row label="目标等级">
            <Input
              type="number"
              value={config.targetLevel}
              min={1}
              max={15}
              onChange={(v) => {
                manager.setTargetLevel(parseInt(v) || 5);
                forceUpdate();
              }}
              style={{ width: '116px' }}
              disabled={isAutoEnhancing}
            />
          </Row>
          <Row label="强化间隔">
            <Input
              type="number"
              value={config.interval}
              min={100}
              onChange={(v) => {
                manager.setInterval(parseInt(v) || 3000);
                forceUpdate();
              }}
              style={{ width: '116px' }}
              disabled={isAutoEnhancing}
              suffix="ms"
            />
          </Row>
          <Row label="批量次数">
            <Input
              type="number"
              value={config.batchCount}
              min={1}
              onChange={(v) => {
                manager.setBatchCount(parseInt(v) || 1);
                forceUpdate();
              }}
              style={{ width: '116px' }}
              disabled={isAutoEnhancing}
            />
          </Row>

          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px', marginTop: '4px' }}>保护模式:</div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <Button
              variant={config.protectMode === 'none' ? 'primary' : 'secondary'}
              onClick={() => {
                manager.setProtectMode('none');
                forceUpdate();
              }}
              style={PROTECT_BTN_STYLE(config.protectMode === 'none')}
              disabled={isAutoEnhancing}
            >
              不使用
            </Button>
            <Button
              variant={config.protectMode === 'item' ? 'primary' : 'secondary'}
              onClick={() => {
                manager.setProtectMode('item');
                forceUpdate();
              }}
              style={PROTECT_BTN_STYLE(config.protectMode === 'item')}
              disabled={isAutoEnhancing}
            >
              物品保护
            </Button>
            <Button
              variant={config.protectMode === 'essence' ? 'primary' : 'secondary'}
              onClick={() => {
                manager.setProtectMode('essence');
                forceUpdate();
              }}
              style={PROTECT_BTN_STYLE(config.protectMode === 'essence')}
              disabled={isAutoEnhancing}
            >
              精华保护
            </Button>
          </div>

          {config.protectMode !== 'none' && (
            <Row label="保护起始等级">
              <Input
                type="number"
                value={config.protectStartLevel}
                min={0}
                max={15}
                onChange={(v) => {
                  manager.setProtectStartLevel(parseInt(v) || 3);
                  forceUpdate();
                }}
                style={{ width: '116px' }}
                disabled={isAutoEnhancing}
              />
            </Row>
          )}
        </Card>
      )}

      {/* 开始/停止强化 */}
      {item && (
        <div style={{ marginBottom: '10px' }}>
          <Button variant={isAutoEnhancing ? 'danger' : 'kitty'} onClick={handleToggleEnhance} disabled={!item}>
            {isAutoEnhancing ? '⏹ 停止强化' : '🚀 开始强化'}
          </Button>
        </div>
      )}

      {/* 强化统计 */}
      {stats.totalAttempts > 0 && (
        <Card title="📊 强化统计">
          <div style={{ fontSize: '13px', color: '#333', marginBottom: '6px' }}>
            {getItemDisplayName(stats.baseItem)} 进度: Lv{stats.currentLevel}/{stats.targetLevel}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
            总计: {stats.totalAttempts}次 ({successRate}%)
          </div>
          {Object.entries(stats.levelStats)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([level, stat]) => {
              const rate = stat.attempts > 0 ? ((stat.success / stat.attempts) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={level}
                  style={{
                    fontSize: '12px',
                    color: '#555',
                    marginBottom: '2px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Lv{level}</span>
                  <span>
                    {stat.attempts}次 ({rate}%)
                  </span>
                </div>
              );
            })}
        </Card>
      )}
    </Modal>
  );
}
