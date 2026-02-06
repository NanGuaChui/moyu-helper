/**
 * 摸鱼放置游戏辅助脚本 - 主入口文件
 *
 * 架构说明：
 * - 初始化核心模块（WebSocket、数据缓存、日志系统）
 * - 注册功能模块（任务、物品、工具栏、资源监控、制作管理）
 * - 创建用户界面（悬浮面板和设置面板）
 */

import type { PanelButton } from './types';
import { FloatingPanel, settingsPanel } from './ui';
import { CraftPanel } from './features/craft';
import { SkillAllocationPanel } from './features/skill-allocation';
import { AlchemyPanel } from './features/quick-alchemy';
import { logger, ws, dataCache, toast } from './core';
import { getWsErrorMessage } from './utils';
import {
  questManager,
  qualityToolbarManager,
  satietyManager,
  resourceMonitor,
  craftManager,
  battleGuard,
  tavernExpertManager,
  quickActions,
} from './features';
import { mountResourceUtils } from './utils';
import { appConfig } from './config/gm-settings';
import { analytics } from './utils';

/**
 * 应用模块注册表
 */
interface AppModules {
  quest: typeof questManager;
  toolbar: typeof qualityToolbarManager;
  satiety: typeof satietyManager;
  resources: typeof resourceMonitor;
  craft: typeof craftManager;
  settings: typeof settingsPanel;
  craftPanel: CraftPanel;
  skillAllocationPanel: SkillAllocationPanel;
  alchemyPanel: AlchemyPanel;
}

const app: AppModules = {
  quest: questManager,
  toolbar: qualityToolbarManager,
  satiety: satietyManager,
  resources: resourceMonitor,
  craft: craftManager,
  settings: settingsPanel,
  craftPanel: new CraftPanel(),
  skillAllocationPanel: new SkillAllocationPanel(),
  alchemyPanel: new AlchemyPanel(),
};

/**
 * 初始化日志系统
 */
async function initLogger(): Promise<void> {
  await logger.reload();
}

/**
 * 初始化核心模块
 */
function initCoreModules(): void {
  ws.init();
  dataCache.init();
  logger.success('核心模块初始化完成');
}

/**
 * 动态生成菜单按钮列表
 * 根据功能启用状态动态生成按钮配置
 */
const getMenuButtons = async (): Promise<PanelButton[]> => {
  const buttons: PanelButton[] = [
    {
      text: '⚙️ 脚本设置',
      onClick: () => app.settings.show(),
      order: 999,
    },
  ];

  // 读取功能开关
  const questManagerEnabled = await appConfig.QUEST_MANAGER_ENABLED.get();
  const craftPanelEnabled = await appConfig.CRAFT_PANEL_ENABLED.get();
  const skillAllocationEnabled = await appConfig.SKILL_ALLOCATION_ENABLED.get();
  const tavernExpertEnabled = await appConfig.TAVERN_EXPERT_ENABLED.get();
  const quickAlchemyEnabled = await appConfig.QUICK_ALCHEMY_ENABLED.get();
  const quickActionsEnabled = await appConfig.QUICK_ACTIONS_ENABLED.get();
  const toolbarToggleEnabled = await appConfig.TOOLBAR_TOGGLE_ENABLED.get();

  // 技能加点
  if (skillAllocationEnabled) {
    buttons.push({
      text: '🌳 技能加点',
      onClick: () => app.skillAllocationPanel.show(),
      order: 4,
    });
  }

  // 任务管理
  if (questManagerEnabled) {
    buttons.push({
      text: '📜 刷新任务',
      onClick: () => app.quest.refreshCards(),
      order: 2,
    });
  }

  // 物品制造
  if (craftPanelEnabled) {
    buttons.push({
      text: '🔨 物品制造',
      onClick: () => app.craftPanel.show(),
      order: 1,
    });
  }

  // 快速炼金
  if (quickAlchemyEnabled) {
    buttons.push({
      text: '⚗️ 快速炼金',
      onClick: () => app.alchemyPanel.show(),
      order: 5,
    });
  }

  // 快捷功能
  if (quickActionsEnabled) {
    buttons.push({
      text: '⚡ 快捷功能',
      onClick: () => quickActions.openModal(),
      order: 7,
    });
  }

  // 酒馆管理按钮
  if (tavernExpertEnabled) {
    buttons.push({
      text: '🏠 酒馆管理',
      onClick: () => tavernExpertManager.openPanel(),
      order: 6,
    });
  }

  // 工具栏显示/隐藏按钮
  if (toolbarToggleEnabled) {
    buttons.push({
      text: app.toolbar.getIsHidden() ? '👁️ 显示工具栏' : '🙈 隐藏工具栏',
      onClick: () => app.toolbar.toggle(),
      order: 8,
    });
  }

  // 动态添加资源监控按钮（仅在启用时显示）
  const resourceButton = app.resources.getButton();
  if (resourceButton) {
    buttons.push({ ...resourceButton, order: 3 });
  }

  return buttons.sort((a, b) => (b.order ?? -1) - (a.order ?? -1));
};

/**
 * 初始化用户界面
 */
async function initUI(): Promise<void> {
  try {
    new FloatingPanel({ subButtons: getMenuButtons });
    logger.success('悬浮面板初始化完成');
    await checkAndNotifyNoFeatures();
  } catch (error) {
    logger.error('悬浮面板初始化失败', error);
    toast.error(getWsErrorMessage(error, '界面初始化失败，请刷新页面'));
  }
}

/**
 * 检查是否启用了任何功能，如果没有则提示用户
 */
async function checkAndNotifyNoFeatures(): Promise<void> {
  const featureFlags = await Promise.all([
    appConfig.CRAFT_PANEL_ENABLED.get(),
    appConfig.SKILL_ALLOCATION_ENABLED.get(),
    appConfig.TAVERN_EXPERT_ENABLED.get(),
    appConfig.BATTLE_GUARD_ENABLED.get(),
    appConfig.QUEST_MANAGER_ENABLED.get(),
    appConfig.RESOURCE_MONITOR_ENABLED.get(),
    appConfig.AUTO_USE_BERRY_ENABLED.get(),
    appConfig.QUICK_ACTIONS_ENABLED.get(),
    appConfig.QUICK_ALCHEMY_ENABLED.get(),
    appConfig.TOOLBAR_TOGGLE_ENABLED.get(),
  ]);

  if (!featureFlags.some(Boolean)) {
    toast.info('💡 当前未启用任何功能，请点击右下角浮动按钮进行配置', 3000);
  }
}

/**
 * 初始化功能模块
 */
async function initFeatureModules(): Promise<void> {
  // 挂载资源工具函数到控制台
  mountResourceUtils();

  // 读取功能开关配置
  const battleGuardEnabled = await appConfig.BATTLE_GUARD_ENABLED.get();
  const toolbarToggleEnabled = await appConfig.TOOLBAR_TOGGLE_ENABLED.get();
  const questManagerEnabled = await appConfig.QUEST_MANAGER_ENABLED.get();

  // 初始化工具栏管理器
  if (toolbarToggleEnabled) {
    app.toolbar.init();
  }

  // 初始化战斗防护
  if (battleGuardEnabled) {
    battleGuard.init();
  }

  // 初始化任务管理器
  if (questManagerEnabled) {
    app.quest.init();
  }

  // 初始化饱食度管理器
  app.satiety.init();

  // 设置面板依赖注入
  app.settings.setResourceMonitor(app.resources);
  app.settings.setSatietyManager(app.satiety);

  // 监听用户信息初始化事件，自动检查资源和显示酒馆状态
  ws.once('characterInitData', async (data) => {
    logger.debug('用户信息已初始化', data.payload?.data);
    void app.resources.checkResources(false);

    // 检查并显示酒馆状态
    const tavernExpertEnabled = await appConfig.TAVERN_EXPERT_ENABLED.get();
    if (tavernExpertEnabled) {
      // 延迟显示酒馆状态，确保数据已加载
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
  await initLogger();
  initCoreModules();
  await initFeatureModules();

  logger.success('核心功能已启动');
}

/**
 * 等待指定元素出现（轮询方式）
 */
function waitForElement(selector: string): Promise<Element> {
  return new Promise((resolve) => {
    const check = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// 立即初始化核心模块，避免错过早期 WebSocket 事件
void main();

// 等待 .user-dropdown 元素出现后初始化 UI
void waitForElement('.user-dropdown').then(() => {
  setTimeout(async () => {
    await initUI();
    analytics.track('脚本', 'script_start', `v${GM.info.script.version}`);
    logger.success('UI 初始化完成');


  }, 1000);
});
