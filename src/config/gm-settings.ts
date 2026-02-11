/**
 * GM 配置管理
 * 统一管理所有 GM.getValue/GM.setValue 操作
 */

export interface Setting<T> {
  get(): Promise<T>;
  set(value: T): Promise<void>;
  reset(): Promise<void>;
  key: string;
  defaultValue: T;
}

function createGMConfigSetting<T>(key: string, defaultValue: T): Setting<T> {
  return {
    key,
    defaultValue,
    async get(): Promise<T> {
      return await GM.getValue(key, defaultValue);
    },
    async set(value: T): Promise<void> {
      await GM.setValue(key, value);
    },
    async reset(): Promise<void> {
      await GM.setValue(key, defaultValue);
    },
  };
}

export const appConfig = {
  // 任务队列配置
  TASK_INTERVAL: createGMConfigSetting('task_interval', 300),

  // 资源监控配置
  RESOURCE_MONITOR_ENABLED: createGMConfigSetting('resource_monitor_enabled', false),
  AUTO_BUY_BASE_RESOURCES: createGMConfigSetting('auto_buy_base_resources', false),
  MONITORED_RESOURCES: createGMConfigSetting('monitored_resources', '{}'),

  // 日志级别配置
  LOG_ENABLED_TYPES: createGMConfigSetting<Record<string, boolean>>('log_enabled_types', {
    debug: false,
    info: false,
    success: false,
    warn: false,
    error: false,
  }),

  // 自动使用浆果配置
  AUTO_USE_BERRY_ENABLED: createGMConfigSetting('auto_use_berry_enabled', false),
  AUTO_USE_BERRY_THRESHOLD: createGMConfigSetting('auto_use_berry_threshold', 500000),
  AUTO_USE_BERRY_TARGET: createGMConfigSetting('auto_use_berry_target', 600000),
  AUTO_USE_BERRY_FOOD_TYPE: createGMConfigSetting<'berry' | 'fish' | 'luxuryCatFood'>(
    'auto_use_berry_food_type',
    'berry',
  ),

  // 任务管理器配置
  QUEST_MANAGER_ENABLED: createGMConfigSetting('quest_manager_enabled', false),
  QUEST_GOLD_LIMIT: createGMConfigSetting('quest_gold_limit', 10000),
  QUEST_SELECTED_TASKS: createGMConfigSetting<Record<string, Record<string, boolean>>>('quest_selected_tasks', {
    采集: {
      采蘑菇: true,
      采浆果: true,
      采草药: true,
      采集花草: true,
      采蜂蜜: true,
      砍树: true,
      砍竹子: true,
      捡贝壳: true,
      挖沙: true,
    },
  }),
  QUEST_FIRST_RUN: createGMConfigSetting('quest_first_run', false),
  QUEST_AUTO_EXECUTE: createGMConfigSetting('quest_auto_execute', false),
  QUEST_AUTO_SUBMIT: createGMConfigSetting('quest_auto_submit', false),

  // 功能开关
  BATTLE_GUARD_ENABLED: createGMConfigSetting('battle_guard_enabled', false),
  TOOLBAR_TOGGLE_ENABLED: createGMConfigSetting('toolbar_toggle_enabled', false),
  TAVERN_EXPERT_ENABLED: createGMConfigSetting('tavern_expert_enabled', false),

  CRAFT_PANEL_ENABLED: createGMConfigSetting('craft_panel_enabled', false),
  SKILL_ALLOCATION_ENABLED: createGMConfigSetting('skill_allocation_enabled', false),
  QUICK_ALCHEMY_ENABLED: createGMConfigSetting('quick_alchemy_enabled', false),
  QUICK_ACTIONS_ENABLED: createGMConfigSetting('quick_actions_enabled', false),
  BATTLE_STATS_ENABLED: createGMConfigSetting('battle_stats_enabled', false),

  // 技能分配配置
  SKILL_ALLOCATION_SPECIALTY: createGMConfigSetting('skill_allocation_specialty', 'knowledge'),
  SKILL_ALLOCATION_STRATEGY: createGMConfigSetting('skill_allocation_strategy', '产出优先'),
  SKILL_ALLOCATION_LUCKY_FIRST: createGMConfigSetting('skill_allocation_lucky_first', true),

  // 默认任务配置
  PLAYER_DEFAULT_TASKS: createGMConfigSetting<string[]>('player_default_tasks', ['reading', 'cutBamboo']),
  KITTY_DEFAULT_TASKS: createGMConfigSetting<Record<number, string>>('kitty_default_tasks', {
    0: 'exploreNewArea',
    1: 'pearlCultivation',
  }),
} as const;
