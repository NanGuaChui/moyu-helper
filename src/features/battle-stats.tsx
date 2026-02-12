/**
 * 战斗统计功能模块
 * 从 zhandou.js 移植，使用项目现有 ws 模块和 UI 组件
 */

import { render } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { BaseFeature, ws, logger, toast } from '@/core';
import { Modal, Button, Card, Section } from '@/ui/components';
import type { Unsubscribe } from '@/types';
import type { PlayerStats, SkillStats, BattleMeta, GlobalPlayerInfo, SummonInfo } from '@/types/battle-stats';
import { getSkillName, isZeroDamageSkill, findSkillIdByName } from '@/config/skill-defs';

// ── 技能名称缓存 ──────────────────────────────────────────────
const skillNameCache = new Map<string, string>();
const discoveredSkills = new Set<string>();

function getSkillDisplayName(skillId: string): string {
  if (skillNameCache.has(skillId)) return skillNameCache.get(skillId)!;
  const name = getSkillName(skillId);
  skillNameCache.set(skillId, name);
  if (name === skillId && !discoveredSkills.has(skillId)) {
    discoveredSkills.add(skillId);
    logger.warn(`[战斗统计] 未知技能: ${skillId}`);
  }
  return name;
}

// ── 浮动文本关键词 ─────────────────────────────────────────────
const FLOAT_TEXT_KEYWORDS = [
  '静电', '超级静电', '协同射击', '精准射击', '追击', '连袭',
  '星辉奔涌', '狱卒的催促', '光明法典', '黑暗法典', '龙之咆哮', '瞬影', '交织',
];

// ── 工具函数 ───────────────────────────────────────────────────
function formatNum(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return Math.floor(value).toLocaleString();
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function createSkillStats(): SkillStats {
  return { totalDamage: 0, totalLossMP: 0, actionCount: 0, maxDamage: 0, averageDamage: 0, firstTime: null, lastTime: null };
}

function createPlayerStats(name: string): PlayerStats {
  return {
    name, totalDamage: 0, totalLossMP: 0, totalRestoreMP: 0, totalHeal: 0,
    totalReceivedDamage: 0, totalActions: 0, totalSSCC: 0,
    firstActionTime: null, lastActionTime: null, skills: {},
  };
}

// ── 核心管理器 ─────────────────────────────────────────────────
class BattleStatsManager extends BaseFeature {
  private container: HTMLDivElement | null = null;
  private isOpen = false;
  private unsubscribers: Unsubscribe[] = [];
  private isListening = false;

  // 缓存
  private playerCache = new Map<string, GlobalPlayerInfo>();
  private playerUuidSet = new Set<string>();
  private summonToOwnerMap = new Map<string, SummonInfo>();
  private sourceToSkillMap = new Map<string, { skillDisplayName: string; timestamp: number }>();

  // 浮动伤害追踪
  private floatDamageTracker = new Map<string, { floatType: string; events: any[]; isProcessing: boolean }>();
  private darkBookTracker = new Map<string, { floatType: string; events: any[]; isProcessing: boolean }>();
  private lumenBookTracker = new Map<string, { floatType: string; events: any[]; isProcessing: boolean }>();
  private isDarkBookEvent = false;
  private isLumenBookEvent = false;

  // 统计数据
  playerStats = new Map<string, PlayerStats>();
  battleMeta: BattleMeta = { startTime: null, totalActions: 0, totalWaves: 0 };

  // UI 更新防抖
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private renderCallback: (() => void) | null = null;

  // progress toast
  private static readonly PROGRESS_ID = 'battle-stats-progress';
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  protected onInit(): void { }
  protected onReload(): void { }

  setRenderCallback(cb: () => void): void {
    this.renderCallback = cb;
  }

  private debouncedUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      if (this.isOpen) this.renderCallback?.();
    }, 500);
  }

  // ── 监听控制 ─────────────────────────────────────────────────
  startListening(): void {
    if (this.isListening) return;
    this.isListening = true;

    const events = [
      'battle:fullInfo:success',
      'battle:dealDamage:success',
      'battle:castSkill:success',
      'battle:lossMp:success',
      'battle:restoreMp:success',
      'battle:heal:success',
      'battle:floatText:success',
      'battleRoom:startBattle:success',
    ];

    const handlers: Record<string, (msg: any) => void> = {
      'battle:fullInfo:success': (msg) => this.handleFullInfo(msg),
      'battle:dealDamage:success': (msg) => this.handleDealDamage(msg),
      'battle:castSkill:success': (msg) => this.handleCastSkill(msg),
      'battle:lossMp:success': (msg) => this.handleLossMp(msg),
      'battle:restoreMp:success': (msg) => this.handleRestoreMp(msg),
      'battle:heal:success': (msg) => this.handleHeal(msg),
      'battle:floatText:success': (msg) => this.handleFloatText(msg),
      'battleRoom:startBattle:success': (msg) => this.handleStartBattle(msg),
    };

    for (const event of events) {
      const unsub = ws.on(event, handlers[event]);
      this.unsubscribers.push(unsub);
    }

    if (!this.battleMeta.startTime) this.battleMeta.startTime = Date.now();

    // 通知服务器开启详细战斗日志推送（离开战斗页面后仍能收到事件）
    void this.setBattleLogPreference(true);
    logger.success('[战斗统计] 开始监听');
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.hideProgressToast();
    void this.setBattleLogPreference(false);
    logger.info('[战斗统计] 停止监听');
  }

  private async setBattleLogPreference(enable: boolean): Promise<void> {
    try {
      await ws.emit('msgPref:battle:set', { enable });
      logger.debug(`[战斗统计] 详细战斗日志已${enable ? '开启' : '关闭'}`);
    } catch {
      logger.warn('[战斗统计] 发送战斗日志偏好失败');
    }
  }

  get listening(): boolean {
    return this.isListening;
  }

  clear(): void {
    this.playerStats.clear();
    this.playerCache.clear();
    this.playerUuidSet.clear();
    this.summonToOwnerMap.clear();
    this.sourceToSkillMap.clear();
    this.floatDamageTracker.clear();
    this.darkBookTracker.clear();
    this.lumenBookTracker.clear();
    this.battleMeta = { startTime: this.isListening ? Date.now() : null, totalActions: 0, totalWaves: 0 };
    this.debouncedUpdate();
  }

  // ── 玩家管理 ─────────────────────────────────────────────────
  private getPlayerName(uuid: string): string {
    return this.playerCache.get(uuid)?.name ?? `${uuid.substring(0, 8)}...`;
  }

  private ensurePlayerStats(uuid: string, name?: string): PlayerStats | null {
    // 只统计玩家
    const info = this.playerCache.get(uuid);
    const isPlayer = info?.isPlayer ?? false;
    const isCurrentUser = uuid === ws.user?.uuid;
    const shouldReturnNull = !isPlayer && !isCurrentUser;

    if (shouldReturnNull) return null;

    if (!this.playerStats.has(uuid)) {
      this.playerStats.set(uuid, createPlayerStats(name ?? this.getPlayerName(uuid)));
    }
    const ps = this.playerStats.get(uuid)!;
    if (ps.name.includes('...') && name && !name.includes('...')) {
      ps.name = name;
    }
    return ps;
  }

  // ── 事件处理 ─────────────────────────────────────────────────
  private handleFullInfo(msg: any): void {
    const battleInfo = msg.payload?.data?.battleInfo;
    if (!battleInfo?.members) return;

    // 初始化玩家映射
    this.playerUuidSet.clear();
    for (const m of battleInfo.members) {
      if (!m?.uuid || !m?.name) continue;
      this.playerCache.set(m.uuid, { name: m.name, uuid: m.uuid, isPlayer: m.isPlayer ?? false });
      if (m.isPlayer) this.playerUuidSet.add(m.uuid);
    }

    // 调试日志：查看缓存的玩家
    // console.log('[战斗统计] playerCache after fullInfo:', Array.from(this.playerCache.entries()).map(([k, v]) => ({
    //   uuid: k,
    //   name: v.name,
    //   isPlayer: v.isPlayer
    // })));

    // 建立召唤物映射
    for (const m of battleInfo.members) {
      if (m?.summonedBy && !m.isPlayer && this.playerUuidSet.has(m.summonedBy)) {
        this.summonToOwnerMap.set(m.uuid, {
          ownerUuid: m.summonedBy,
          summonName: m.name ?? '未知召唤物',
          summonUuid: m.uuid,
        });
      }
    }

    // 更新行动次数
    const actor = battleInfo.members.find((m: any) => m.uuid === battleInfo.currentTurnUnitUuid);
    if (actor?.isPlayer) {
      this.battleMeta.totalActions++;
      this.ensurePlayerStats(actor.uuid, actor.name);
    }

    this.debouncedUpdate();
  }

  private handleStartBattle(_msg: any): void {
    this.battleMeta.totalWaves++;
    this.debouncedUpdate();
  }

  private handleDealDamage(msg: any): void {
    let user = msg.payload?.data?.source;
    const targets = msg.payload?.data?.target;
    if (!targets || !Array.isArray(targets)) return;

    // 统计承受伤害
    for (const t of targets) {
      if (!t?.unit) continue;
      const ps = this.playerStats.get(t.unit) ?? (this.playerCache.get(t.unit)?.isPlayer ? this.ensurePlayerStats(t.unit) : null);
      if (ps) {
        ps.totalReceivedDamage += (t.shieldDamage ?? 0) + (t.value ?? 0);
      }
    }

    if (!user) return;

    // 召唤物伤害归属
    const summon = this.summonToOwnerMap.get(user);
    if (summon) {
      const summonName = summon.summonName;
      user = summon.ownerUuid;
      for (const t of targets) {
        if (t) {
          if (!t.causeBy) t.causeBy = {};
          t.causeBy.skillId = summonName;
        }
      }
    }

    // 回响铃饰处理
    let isEchoBell = false;
    if (typeof user === 'string' && user.includes('_echoBellCharm_')) {
      isEchoBell = true;
      user = user.slice(0, user.indexOf('_echoBellCharm_'));
    }

    const ps = this.ensurePlayerStats(user);
    if (!ps) return;

    const skillId = targets[0]?.causeBy?.skillId;

    if (!skillId) {
      // 无技能ID → 可能是浮动伤害追踪
      this.handleTrackerDamage(user, msg.payload?.data, targets);
      return;
    }

    // 检查是否是零伤害技能 + 光明法典
    const displayName = getSkillDisplayName(skillId);
    if (isZeroDamageSkill(skillId) && this.isLumenBookEvent) {
      this.appendToTracker(this.lumenBookTracker, user, 'damage', msg.payload?.data);
      this.isLumenBookEvent = false;
      return;
    }

    // 分析伤害
    const analysis = this.analyzeDamage(targets);
    if (!analysis.isValid) return;

    let finalName = isEchoBell ? `回响铃饰-${displayName}` : displayName;
    this.recordDamage(user, ps, finalName, analysis);
  }

  private handleTrackerDamage(user: string, data: any, _targets: any[]): void {
    if (this.isDarkBookEvent) {
      this.ensureTrackerEntry(this.darkBookTracker, user);
      this.appendToTracker(this.darkBookTracker, user, 'damage', data);
      this.isDarkBookEvent = false;
      return;
    }
    if (this.isLumenBookEvent) {
      this.ensureTrackerEntry(this.lumenBookTracker, user);
      this.appendToTracker(this.lumenBookTracker, user, 'damage', data);
      this.isLumenBookEvent = false;
      return;
    }
    this.ensureTrackerEntry(this.floatDamageTracker, user);
    this.appendToTracker(this.floatDamageTracker, user, 'damage', data);
  }

  private appendToTracker(tracker: Map<string, any>, user: string, type: string, data: any): void {
    const seq = tracker.get(user);
    if (!seq || seq.isProcessing) return;

    // 如果是新的 floatText，先处理旧的配对（避免跨技能配对）
    if (type === 'floatText') {
      const existingFloatText = seq.events.find((e: any) => e.type === 'floatText');
      if (existingFloatText) {
        this.processTrackerDamageForUser(tracker, user);
      }
    }

    seq.events.push({ type, data: JSON.parse(JSON.stringify(data)), timestamp: Date.now() });

    // 如果是 damage 事件且已有 floatText，延迟 100ms 后处理（等待更多 damage 事件到达）
    if (type === 'damage') {
      const hasFloatText = seq.events.some((e: any) => e.type === 'floatText');
      if (hasFloatText) {
        // 清除之前的定时器
        if (seq.processTimer) clearTimeout(seq.processTimer);
        // 延迟处理，让多个 damage 事件收集起来
        seq.processTimer = setTimeout(() => {
          this.processTrackerDamageForUser(tracker, user);
        }, 100);
      }
    }
  }

  private handleFloatText(msg: any): void {
    const fromUser = msg.payload?.data?.unit;
    const text = msg.payload?.data?.text;
    if (!fromUser || !text) return;

    let matched = '';
    for (const kw of FLOAT_TEXT_KEYWORDS) {
      if (text.startsWith(kw)) { matched = kw; break; }
    }

    // if (matched) {
    //   console.log(`[战斗统计] floatText: fromUser=${fromUser}, text=${text}, matched=${matched}`);
    // }

    if (matched === '黑暗法典') {
      this.isDarkBookEvent = true;
      this.ensureTrackerEntry(this.darkBookTracker, fromUser);
      this.appendToTracker(this.darkBookTracker, fromUser, 'floatText', msg.payload);
      return;
    }

    if (matched === '光明法典') {
      this.isLumenBookEvent = true;
      this.ensureTrackerEntry(this.lumenBookTracker, fromUser);
      this.appendToTracker(this.lumenBookTracker, fromUser, 'floatText', msg.payload);
      return;
    }

    if (matched === '交织') {
      const skillName = text.split('-')[1];
      const skillId = findSkillIdByName(skillName);
      if (skillId && isZeroDamageSkill(skillId)) {
        this.recordSupportSkill(fromUser, skillId, `交织-${getSkillDisplayName(skillId)}`)
        return;
      }
    }

    if (matched) {
      this.ensureTrackerEntry(this.floatDamageTracker, fromUser);
      this.appendToTracker(this.floatDamageTracker, fromUser, 'floatText', msg.payload);
    }
  }

  private ensureTrackerEntry(tracker: Map<string, any>, user: string): void {
    if (!tracker.has(user)) {
      tracker.set(user, { floatType: '', events: [], isProcessing: false, processTimer: null });
    }
  }

  private processTrackerDamageForUser(tracker: Map<string, any>, user: string): boolean {
    const seq = tracker.get(user);
    if (!seq || seq.isProcessing || seq.events.length === 0) return false;

    seq.isProcessing = true;

    // 分离 floatText 和 damage 事件
    const floatEvents = seq.events.filter((e: any) => e.type === 'floatText');
    const damageEvents = seq.events.filter((e: any) => e.type === 'damage');

    let processed = false;
    // 只有同时有 floatText 和 damage 事件时才处理
    if (floatEvents.length > 0 && damageEvents.length > 0) {
      const floatEvent = floatEvents[0];
      let totalDamage = 0;
      for (const de of damageEvents) {
        const targets = de.data?.target ?? [];
        const a = this.analyzeDamage(targets);
        if (a.isValid) totalDamage += a.totalDamage;
      }
      if (totalDamage > 0) {
        const playerUuid = floatEvent.data?.data?.unit;
        const text = floatEvent.data?.data?.text;
        const ps = playerUuid ? this.playerStats.get(playerUuid) : null;
        if (ps && text) {
          // console.log(`[战斗统计] 浮动伤害记录: user=${playerUuid}, skill=${text}, damage=${totalDamage}`);
          ps.totalDamage += totalDamage;
          if (!ps.skills[text]) ps.skills[text] = createSkillStats();
          const sk = ps.skills[text];
          sk.totalDamage += totalDamage;
          // 同一回合的同一个技能只记一次（1.5s 内视为同一回合）
          const now = Date.now();
          if (!sk.lastTime || now - sk.lastTime > 1500) sk.actionCount++;
          sk.lastTime = now;
          if (!sk.firstTime) sk.firstTime = now;
          sk.averageDamage = sk.actionCount > 0 ? sk.totalDamage / sk.actionCount : 0;
        }
      }
      // 处理完后清空已配对的事件（floatText 和所有 damage）
      seq.events = [];
      processed = true;
    }

    seq.isProcessing = false;
    return processed;
  }

  private handleCastSkill(msg: any): void {
    const user = msg.payload?.data?.source;
    const skillId = msg.payload?.data?.skillId;
    if (!user || !skillId) return;

    let finalUser = user;
    let isEchoBell = false;
    if (typeof user === 'string' && user.includes('_echoBellCharm_')) {
      isEchoBell = true;
      finalUser = user.slice(0, user.indexOf('_echoBellCharm_'));
    }

    this.ensurePlayerStats(finalUser);

    if (isZeroDamageSkill(skillId)) {
      let displayName = getSkillDisplayName(skillId);
      if (isEchoBell) displayName = `回响铃饰-${displayName}`;
      this.recordSupportSkill(finalUser, skillId, displayName);
    }
  }

  private recordSupportSkill(uuid: string, _skillId: string, displayName: string): void {
    const ps = this.playerStats.get(uuid);
    if (!ps) return;
    if (!ps.skills[displayName]) ps.skills[displayName] = createSkillStats();
    const sk = ps.skills[displayName];
    const now = Date.now();
    if (!sk.lastTime || now - sk.lastTime > 100) sk.actionCount++;
    sk.lastTime = now;
    if (!sk.firstTime) sk.firstTime = now;
    ps.totalSSCC++;
    this.debouncedUpdate();
  }

  private handleLossMp(msg: any): void {
    const target = msg.payload?.data?.target;
    const value = msg.payload?.data?.value;
    const source = msg.payload?.data?.source;
    if (!target || !value) return;
    const ps = this.playerStats.get(target);
    if (!ps) return;
    ps.totalLossMP += value;

    // 关联技能
    const info = this.sourceToSkillMap.get(source);
    if (info && ps.skills[info.skillDisplayName]) {
      ps.skills[info.skillDisplayName].totalLossMP += value;
    }
  }

  private handleRestoreMp(msg: any): void {
    const target = msg.payload?.data?.target;
    const value = msg.payload?.data?.value;
    if (!target || !value) return;
    const ps = this.playerStats.get(target);
    if (ps) ps.totalRestoreMP += value;
  }

  private handleHeal(msg: any): void {
    const source = msg.payload?.data?.source;
    const value = msg.payload?.data?.value;
    if (!source || !value) return;
    const ps = this.playerStats.get(source);
    if (ps) ps.totalHeal += value;
  }

  // ── 伤害分析与记录 ───────────────────────────────────────────
  private analyzeDamage(targets: any[]): { isValid: boolean; totalDamage: number; maxDamage: number } {
    let totalDamage = 0;
    let maxDamage = 0;
    for (const t of targets) {
      const dmg = t?.value ?? 0;
      if (dmg > 0) {
        totalDamage += dmg;
        maxDamage = Math.max(maxDamage, dmg);
      }
    }
    return { isValid: totalDamage > 0, totalDamage, maxDamage };
  }

  private recordDamage(uuid: string, ps: PlayerStats, skillDisplayName: string, analysis: { totalDamage: number; maxDamage: number }): void {
    const now = Date.now();

    // console.log(`[战斗统计] 伤害记录: user=${uuid}, skill=${skillDisplayName}, damage=${analysis.totalDamage}`);

    // source → skill 映射（用于关联 lossMp）
    this.sourceToSkillMap.set(uuid, { skillDisplayName, timestamp: now });
    // 清理过期映射
    for (const [k, v] of this.sourceToSkillMap) {
      if (now - v.timestamp > 5000) this.sourceToSkillMap.delete(k);
    }

    ps.totalDamage += analysis.totalDamage;
    ps.totalActions++;
    if (!ps.firstActionTime) ps.firstActionTime = now;
    ps.lastActionTime = now;

    if (!ps.skills[skillDisplayName]) ps.skills[skillDisplayName] = createSkillStats();
    const sk = ps.skills[skillDisplayName];
    sk.totalDamage += analysis.totalDamage;
    sk.maxDamage = Math.max(sk.maxDamage, analysis.maxDamage);
    if (!sk.lastTime || now - sk.lastTime > 100) sk.actionCount++;
    if (!sk.firstTime) sk.firstTime = now;
    sk.lastTime = now;
    sk.averageDamage = sk.actionCount > 0 ? sk.totalDamage / sk.actionCount : 0;

    this.debouncedUpdate();
  }

  // ── Modal 控制 ──────────────────────────────────────────────
  openModal(): void {
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

  private buildProgressSummary(): string {
    const meta = this.battleMeta;
    const runTime = meta.startTime ? formatTime(Date.now() - meta.startTime) : '-';
    const totalDamage = Array.from(this.playerStats.values()).reduce((sum, p) => sum + p.totalDamage, 0);
    return `⚔️ 监听中 | ⏱${runTime} | 🌊${meta.totalWaves}波 | 总伤害:${formatNum(totalDamage)}`;
  }

  private showProgressToast(): void {
    toast.progress(this.buildProgressSummary(), BattleStatsManager.PROGRESS_ID);
    this.progressTimer = setInterval(() => {
      if (!this.isListening) {
        this.hideProgressToast();
        return;
      }
      toast.progress(this.buildProgressSummary(), BattleStatsManager.PROGRESS_ID);
    }, 2000);
  }

  private hideProgressToast(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    toast.hideProgress(BattleStatsManager.PROGRESS_ID);
  }

  renderUI(): void {
    if (!this.container) return;
    render(
      <BattleStatsModal
        isOpen={this.isOpen}
        onClose={this.closeModal}
        manager={this}
      />,
      this.container,
    );
  }
}

export const battleStatsManager = new BattleStatsManager();

// ── UI 组件 ────────────────────────────────────────────────────

interface BattleStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  manager: BattleStatsManager;
}

function BattleStatsModal({ isOpen, onClose, manager }: BattleStatsModalProps) {
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    manager.setRenderCallback(forceUpdate);
    return () => manager.setRenderCallback(() => { });
  }, [manager, forceUpdate]);

  // 运行时间定时刷新
  useEffect(() => {
    if (isOpen && manager.listening) {
      tickRef.current = setInterval(forceUpdate, 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [isOpen, manager.listening, forceUpdate]);

  const handleToggle = () => {
    if (manager.listening) manager.stopListening();
    else manager.startListening();
    forceUpdate();
  };

  const handleClear = () => {
    manager.clear();
    forceUpdate();
  };

  const meta = manager.battleMeta;
  const runTime = meta.startTime ? formatTime(Date.now() - meta.startTime) : '-';
  const players = Array.from(manager.playerStats.entries())
    .sort(([, a], [, b]) => b.totalDamage - a.totalDamage);
  const totalDamage = players.reduce((sum, [, p]) => sum + p.totalDamage, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📊 战斗统计" maxWidth="480px" maxHeight="85vh">
      {/* 控制栏 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <Button
          variant={manager.listening ? 'danger' : 'primary'}
          onClick={handleToggle}
          style={{ flex: 1 }}
        >
          {manager.listening ? '⏹ 停止' : '▶ 开始'}
        </Button>
        <Button variant="secondary" onClick={handleClear} style={{ flex: 1 }}>
          🗑 清空
        </Button>
      </div>

      {/* 概览 */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#555' }}>
          <span>⏱ {runTime}</span>
          <span>🌊 {meta.totalWaves} 波</span>
          <span>⚔️ {formatNum(totalDamage)}</span>
        </div>
      </Card>

      {/* 角色列表 */}
      {players.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', fontSize: '13px', padding: '20px 0' }}>
          {manager.listening ? '等待战斗数据...' : '点击「开始」按钮开始统计'}
        </div>
      ) : (
        players.map(([uuid, ps]) => (
          <PlayerCard key={uuid} stats={ps} />
        ))
      )}
    </Modal>
  );
}

// ── PlayerCard 组件 ─────────────────────────────────────────────

interface PlayerCardProps {
  stats: PlayerStats;
}

function PlayerCard({ stats }: PlayerCardProps) {
  const dpa = stats.totalActions > 0 ? stats.totalDamage / stats.totalActions : 0;
  const manaEfficiency = stats.totalLossMP > 0 ? ((stats.totalRestoreMP / stats.totalLossMP) * 100).toFixed(1) : '-';

  const skills = Object.entries(stats.skills)
    .sort(([, a], [, b]) => b.totalDamage - a.totalDamage);

  const title = `${stats.name}  伤害:${formatNum(stats.totalDamage)}  DPA:${formatNum(dpa)}  承伤:${formatNum(stats.totalReceivedDamage)}`;

  return (
    <Section title={title} defaultExpanded={false}>
      {/* 法力信息 */}
      <Card style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
          <span>💧 消耗: {formatNum(stats.totalLossMP)}</span>
          <span>💧 恢复: {formatNum(stats.totalRestoreMP)}</span>
          <span>⚡ 效率: {manaEfficiency}%</span>
        </div>
      </Card>

      {/* 技能列表 */}
      {skills.length > 0 && (
        <div style={{ fontSize: '11px' }}>
          {skills.map(([name, sk]) => (
            <SkillItem key={name} name={name} skill={sk} />
          ))}
        </div>
      )}
    </Section>
  );
}

// ── SkillItem 组件 ──────────────────────────────────────────────

const SKILL_ROW_STYLE = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: '4px',
  marginBottom: '2px',
  background: 'rgba(0,0,0,0.02)',
  fontSize: '11px',
  color: '#444',
} as const;

interface SkillItemProps {
  name: string;
  skill: SkillStats;
}

function SkillItem({ name, skill }: SkillItemProps) {
  const icon = skill.totalDamage > 0 ? '🔥' : '✨';
  const avg = skill.actionCount > 0 ? formatNum(skill.totalDamage / skill.actionCount) : '-';

  return (
    <div style={SKILL_ROW_STYLE}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {icon} {name}
      </span>
      <span style={{ minWidth: '60px', textAlign: 'right' }}>{formatNum(skill.totalDamage)}</span>
      <span style={{ minWidth: '40px', textAlign: 'right' }}>×{skill.actionCount}</span>
      <span style={{ minWidth: '50px', textAlign: 'right' }}>均{avg}</span>
    </div>
  );
}
