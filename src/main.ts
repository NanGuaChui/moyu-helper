/**
 * 摸鱼放置游戏辅助脚本 - 主入口文件
 *
 * 初始化核心模块 → 注册功能模块 → 创建用户界面
 */

import type { PanelButton } from './types';
import { FloatingPanel, settingsPanel } from './ui';
import { craftPanel } from './features/craft';
import { SkillAllocationPanel } from './features/skill-allocation';
import { AlchemyPanel } from './features/quick-alchemy';
import { logger, ws, dataCache, toast } from './core';
import { getWsErrorMessage, mountResourceUtils, waitForElement, analytics } from './utils';
import {
  questManager,
  qualityToolbarManager,
  satietyManager,
  resourceMonitor,
  battleGuard,
  tavernExpertManager,
  quickActions,
  battleStatsManager,
  enhanceManager,
} from './features';
import { appConfig } from './config/gm-settings';

// ── 懒初始化的面板实例 ──────────────────────────────────────────
const skillAllocationPanel = new SkillAllocationPanel();
const alchemyPanel = new AlchemyPanel();

// ── 菜单按钮定义（数据驱动） ────────────────────────────────────
interface MenuButtonDef {
  flag: keyof typeof appConfig;
  text: string;
  onClick: () => void;
  order: number;
}

const MENU_BUTTON_DEFS: MenuButtonDef[] = [
  { flag: 'CRAFT_PANEL_ENABLED', text: '🔨 物品制造', onClick: () => craftPanel.show({}), order: 1 },
  { flag: 'QUEST_MANAGER_ENABLED', text: '📜 刷新任务', onClick: () => questManager.refreshCards(), order: 2 },
  { flag: 'SKILL_ALLOCATION_ENABLED', text: '🌳 技能加点', onClick: () => skillAllocationPanel.show(), order: 4 },
  { flag: 'QUICK_ALCHEMY_ENABLED', text: '⚗️ 快速炼金', onClick: () => alchemyPanel.show(), order: 5 },
  { flag: 'TAVERN_EXPERT_ENABLED', text: '🏠 酒馆管理', onClick: () => tavernExpertManager.openPanel(), order: 6 },
  { flag: 'QUICK_ACTIONS_ENABLED', text: '⚡ 快捷功能', onClick: () => quickActions.openModal(), order: 7 },
  { flag: 'BATTLE_STATS_ENABLED', text: '📊 战斗统计', onClick: () => battleStatsManager.openModal(), order: 8 },
  { flag: 'ENHANCE_ENABLED', text: '🔨 强化助手', onClick: () => enhanceManager.openModal(), order: 9 },
];

/**
 * 批量读取功能开关，返回 flag → boolean 映射
 */
async function loadFeatureFlags<K extends keyof typeof appConfig>(keys: K[]): Promise<Record<K, boolean>> {
  const values = await Promise.all(keys.map((k) => appConfig[k].get() as Promise<boolean>));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, boolean>;
}

/**
 * 动态生成菜单按钮列表
 */
async function getMenuButtons(): Promise<PanelButton[]> {
  const flags = await loadFeatureFlags(MENU_BUTTON_DEFS.map((d) => d.flag));

  const buttons: PanelButton[] = MENU_BUTTON_DEFS.filter((def) => flags[def.flag]).map(({ text, onClick, order }) => ({
    text,
    onClick,
    order,
  }));

  // 资源监控按钮（由模块自身控制可见性）
  const resourceButton = resourceMonitor.getButton();
  if (resourceButton) {
    buttons.push({ ...resourceButton, order: 3 });
  }

  // 设置按钮始终显示
  buttons.push({ text: '⚙️ 脚本设置', onClick: () => settingsPanel.show(), order: 999 });

  return buttons.sort((a, b) => (b.order ?? -1) - (a.order ?? -1));
}

// ── 所有功能开关 key（用于"无功能启用"检测） ───────────────────
const ALL_FEATURE_FLAGS = [
  'CRAFT_PANEL_ENABLED',
  'SKILL_ALLOCATION_ENABLED',
  'TAVERN_EXPERT_ENABLED',
  'BATTLE_GUARD_ENABLED',
  'QUEST_MANAGER_ENABLED',
  'RESOURCE_MONITOR_ENABLED',
  'AUTO_USE_BERRY_ENABLED',
  'QUICK_ACTIONS_ENABLED',
  'QUICK_ALCHEMY_ENABLED',
  'BATTLE_STATS_ENABLED',
  'ENHANCE_ENABLED',
] as const;

/**
 * 初始化用户界面
 */
async function initUI(): Promise<void> {
  try {
    new FloatingPanel({ subButtons: getMenuButtons });
    logger.success('悬浮面板初始化完成');

    // 检查是否有任何功能启用
    const flags = await loadFeatureFlags([...ALL_FEATURE_FLAGS]);
    if (!Object.values(flags).some(Boolean)) {
      toast.info('💡 当前未启用任何功能，请点击右下角浮动按钮进行配置', 3000);
    }
  } catch (error) {
    logger.error('悬浮面板初始化失败', error);
    toast.error(getWsErrorMessage(error, '界面初始化失败，请刷新页面'));
  }
}

/**
 * 初始化功能模块
 */
async function initFeatureModules(): Promise<void> {
  mountResourceUtils();

  const flags = await loadFeatureFlags([
    'BATTLE_GUARD_ENABLED',
    'TOOLBAR_TOGGLE_ENABLED',
    'QUEST_MANAGER_ENABLED',
    'RESOURCE_MONITOR_ENABLED',
  ]);

  if (flags.TOOLBAR_TOGGLE_ENABLED) qualityToolbarManager.init();
  if (flags.BATTLE_GUARD_ENABLED) battleGuard.init();
  if (flags.QUEST_MANAGER_ENABLED) questManager.init();
  if (flags.RESOURCE_MONITOR_ENABLED) resourceMonitor.init();

  satietyManager.init();

  // 设置面板依赖注入
  settingsPanel.setResourceMonitor(resourceMonitor);
  settingsPanel.setSatietyManager(satietyManager);

  // 用户信息初始化后检查资源和酒馆状态
  ws.once('characterInitData', async (data) => {
    logger.debug('用户信息已初始化', data.payload?.data);
    void resourceMonitor.checkResources(false);

    const tavernEnabled = await appConfig.TAVERN_EXPERT_ENABLED.get();
    if (tavernEnabled) {
      void tavernExpertManager.showTavernStatus();
    }
  });

  logger.success('功能模块初始化完成');
}

/**
 * 应用主入口
 */
async function main(): Promise<void> {
  logger.info('脚本开始加载...');

  analytics.init();
  await logger.reload();
  dataCache.init();
  logger.success('核心模块初始化完成');

  await initFeatureModules();
  logger.success('核心功能已启动');
}

// ── 启动 ─────────────────────────────────────────────────────────

// 立即拦截 WebSocket，确保不错过任何早期消息
ws.init();

// 初始化核心模块和功能
void main();

// 等待页面就绪后初始化 UI
void waitForElement('.user-dropdown').then(() => {
  setTimeout(async () => {
    await initUI();
    analytics.track('脚本', 'script_start', `v${GM.info.script.version}`);
    logger.success('UI 初始化完成');
  }, 1000);
});
