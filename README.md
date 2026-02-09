# 摸鱼放置游戏辅助脚本

一个功能强大的油猴脚本，为摸鱼放置游戏提供自动化任务管理、物品制造、资源监控等增强功能。

## ✨ 功能特性

- 🔨 **智能制造** - 自动计算依赖关系，批量制造物品，支持猫咪分配任务
- 📜 **任务管理** - 自动提交/刷新任务，按类型筛选，支持自动执行
- 🌳 **技能分配** - 自动分配生活专精技能点，支持多种策略和幸运优先模式
- ⚗️ **快速炼金** - 按配方分类展示，自动选择最优材料，支持批量炼金
- ⚡ **快捷操作** - 一键执行常用操作，如清空战利品记录
- 📊 **资源监控** - 实时监控游戏资源，不足/过量自动提醒，可自定义阈值
- 🍖 **饱食度管理** - 自动监控并使用食物保持饱食度，支持多种食物类型
- 🛡️ **战斗防护** - 自动禁用战斗功能，防止掉线，定期检查并自动重试
- 🏠 **酒馆专家** - 快速启用/禁用强化专家猫猫，一键切换工作状态
- 🛠️ **工具栏优化** - 将生活质量工具栏转换为图标模式，节省屏幕空间
- ⚙️ **灵活配置** - 可自定义各项功能开关和参数，基于 GM 存储持久化

## 🚀 快速开始

### 环境要求

- Node.js 20+
- Yarn 1.22+

### 安装依赖

```bash
yarn install
```

### 开发模式

```bash
yarn dev
```

### 构建生产版本

```bash
yarn build
```

## 📦 项目结构

```
moyu-helper/
├── src/
│   ├── config/                              # 配置文件
│   │   ├── alchemy-recipes.ts               # 炼金配方数据
│   │   ├── craft-items.json                 # 物品制造数据
│   │   ├── defaults.ts                      # 默认配置（资源监控、任务类型等）
│   │   ├── env.ts                           # 环境配置
│   │   ├── gm-settings.ts                   # GM 设置管理（功能开关与参数持久化）
│   │   └── monster-essence-classification.json  # 怪物精华分类
│   ├── core/                                # 核心模块
│   │   ├── base-feature.ts                  # Feature 基类（统一生命周期管理）
│   │   ├── data-cache.ts                    # 数据缓存
│   │   ├── event-bus.ts                     # 事件总线
│   │   ├── logger.ts                        # 日志系统
│   │   ├── toast.tsx                        # Toast 通知
│   │   ├── websocket.ts                     # WebSocket 通信
│   │   └── index.ts                         # 核心模块导出
│   ├── features/                            # 功能模块
│   │   ├── battle-guard.tsx                 # 战斗防护
│   │   ├── craft.tsx                        # 物品制造
│   │   ├── quest.tsx                        # 任务管理
│   │   ├── quick-actions.tsx                # 快捷操作
│   │   ├── quick-alchemy.tsx                # 快速炼金
│   │   ├── quality-toolbar.tsx              # 工具栏优化
│   │   ├── resource-monitor.tsx             # 资源监控
│   │   ├── satiety-manager.tsx              # 饱食度管理
│   │   ├── skill-allocation.tsx             # 技能分配
│   │   ├── tavern-expert.tsx                # 酒馆专家
│   │   └── index.ts                         # 功能模块导出
│   ├── types/                               # TypeScript 类型定义
│   │   ├── game-data.ts                     # 游戏数据类型
│   │   ├── globals.d.ts                     # 全局类型声明
│   │   ├── panel.ts                         # 面板类型
│   │   ├── websocket.ts                     # WebSocket 类型
│   │   └── index.ts                         # 类型导出（含制造相关类型）
│   ├── ui/                                  # 用户界面
│   │   ├── components/                      # UI 组件库
│   │   │   ├── Button.tsx                   # 按钮组件
│   │   │   ├── Card.tsx                     # 卡片组件
│   │   │   ├── Checkbox.tsx                 # 复选框组件
│   │   │   ├── FormGroup.tsx                # 表单组组件
│   │   │   ├── Input.tsx                    # 输入框组件
│   │   │   ├── Modal.tsx                    # 模态框组件
│   │   │   ├── Row.tsx                      # 行组件
│   │   │   ├── Section.tsx                  # 区块组件
│   │   │   ├── Select.tsx                   # 选择框组件
│   │   │   ├── Slider.tsx                   # 滑块组件
│   │   │   └── index.ts                     # 组件导出
│   │   ├── base-panel.tsx                   # 面板基类
│   │   ├── floating-panel.tsx               # 悬浮面板（主入口 UI）
│   │   ├── settings-panel.tsx               # 设置面板
│   │   └── index.ts                         # UI 模块导出
│   ├── utils/                               # 工具函数
│   │   ├── analytics.ts                     # 数据分析与埋点
│   │   ├── resource.ts                      # 资源工具
│   │   ├── task-queue.ts                    # 异步任务队列（支持并发控制）
│   │   └── index.ts                         # 工具导出（含 sleep/debounce/throttle）
│   └── main.ts                              # 应用入口
├── scripts/                                 # 辅助脚本
│   ├── extract-monster-essence.js           # 怪物精华提取脚本
│   ├── items.json                           # 物品原始数据
│   ├── source.js                            # 数据源
│   └── transform-data.js                    # 数据转换脚本
└── package.json                             # 项目配置
```

## 🎮 使用说明

1. 安装 Tampermonkey 或 Violentmonkey 浏览器扩展
2. 构建脚本后安装到油猴管理器
3. 打开游戏页面，右下角会出现悬浮按钮
4. 点击按钮展开功能菜单

### 主要功能

#### 🔨 物品制造
- 支持自动计算制造依赖
- 智能优化制造顺序
- 考虑库存自动跳过已有物品
- 支持为猫咪分配制造任务

#### 📜 任务管理
- 自动提交已完成的任务
- 按类型筛选并刷新不符合条件的任务
- 支持自动执行和自动提交
- 实时显示刷新和执行进度

#### 🌳 技能分配
- 自动分配生活专精技能点
- 支持多种策略：效率优先、产出优先、材料优先、经验优先、产出+材料优先
- 支持13种专精：采矿、炼金、采集、自我提升、锻造、探索、制造、烹饪、养殖、种植、缝纫、特殊制造、钓鱼
- 可选幸运优先模式
- 实时显示加点进度和效率统计

#### ⚗️ 快速炼金
- 按配方分类展示炼金选项
- 自动选择最优材料组合
- 支持批量炼金

#### ⚡ 快捷操作
- 一键清空战利品记录
- 快速访问常用功能

#### 📊 资源监控
- 实时监控指定资源数量
- 支持不足监控和过量监控两种模式
- 资源异常时自动提醒
- 可自定义监控阈值

#### 🍖 饱食度管理
- 自动监控饱食度
- 饱食度低于阈值时自动使用食物
- 支持多种食物类型：浆果、鱼、豪华猫粮
- 可自定义阈值和目标值

#### 🛡️ 战斗防护
- 自动禁用战斗功能
- 防止因战斗导致的连接问题
- 自动重试机制
- 定期检查战斗状态

#### 🏠 酒馆专家
- 快速启用/禁用强化专家猫猫
- 一键切换工作状态
- 自动同步状态显示

#### 🛠️ 工具栏优化
- 将生活质量工具栏转换为图标模式
- 节省屏幕空间
- 支持点击展开/收起

## 🛠️ 技术栈

- **TypeScript** - 类型安全的 JavaScript 超集
- **Preact + Signals** - 轻量级 UI 框架，响应式状态管理
- **Vite** - 快速的前端构建工具
- **vite-plugin-monkey** - 油猴脚本开发插件
- **WebSocket** - 实时双向通信
- **Pako** - 数据压缩/解压库
- **Tampermonkey API** - 油猴脚本 API（GM_getValue/GM_setValue/GM_addStyle）

## 📝 开发说明

### 核心架构

#### 核心模块 (core/)
- **BaseFeature** (`base-feature.ts`) - Feature 基类，提供统一的生命周期管理（init/start/stop/destroy/reload）和运行状态控制（基于 Preact Signals）
- **WebSocket 通信** (`websocket.ts`) - 与游戏服务器实时通信，支持消息压缩和解压
- **数据缓存** (`data-cache.ts`) - 缓存游戏数据，减少重复请求
- **事件总线** (`event-bus.ts`) - 模块间解耦通信，支持事件订阅和发布
- **日志系统** (`logger.ts`) - 统一的日志管理，支持多级别日志输出（debug/info/success/warn/error）
- **Toast 通知** (`toast.tsx`) - 友好的用户提示系统

#### 工具模块 (utils/)
- **任务队列** (`task-queue.ts`) - 异步任务管理，支持并发控制
- **数据分析** (`analytics.ts`) - 用户行为统计和埋点追踪
- **资源工具** (`resource.ts`) - 资源相关的工具函数
- 通用工具：`sleep`、`debounce`、`throttle`、`getWsErrorMessage`

#### 配置管理 (config/)
- **GM 设置** (`gm-settings.ts`) - 基于 GM_getValue/GM_setValue 的配置管理，统一管理所有功能开关和参数
- **默认配置** (`defaults.ts`) - 资源监控默认阈值、任务类型分类等
- **环境配置** (`env.ts`) - 开发/生产环境判断
- **数据配置** - 炼金配方、物品制造、怪物精华分类等游戏数据

### 添加新功能

1. 在 `src/features/` 创建功能模块文件，继承 `BaseFeature` 基类
2. 在 `src/features/index.ts` 导出新模块
3. 在 `src/config/gm-settings.ts` 添加功能开关配置
4. 在 `src/config/defaults.ts` 添加默认配置（如需要）
5. 在 `src/main.ts` 中注册和初始化模块
6. 在 `src/ui/` 添加界面组件（如需要）
7. 更新 `src/types/` 中的类型定义（如需要）

### 模块开发规范

- 使用 TypeScript 编写，确保类型安全
- 功能模块继承 `BaseFeature`，遵循统一生命周期
- 通过事件总线进行模块间通信
- 使用数据缓存避免重复请求
- 使用日志系统记录关键操作
- 使用 Toast 通知提供用户反馈
- 配置项通过 GM_setValue/GM_getValue 持久化
- UI 组件使用 Preact + Signals 编写

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📌 常用命令

### 开发命令
```bash
# 安装依赖
yarn install

# 开发模式（热重载）
yarn dev

# 构建生产版本
yarn build

# 代码格式化
yarn format

# 代码检查
yarn lint

# 代码检查并自动修复
yarn lint:fix

# 格式化和修复
yarn fix
```

### 数据处理
```bash
# 转换游戏数据
yarn tf

# 提取怪物精华数据
yarn ex
```

### Git 操作
```bash
# 合并开发分支
git merge --squash dev

# 删除本地分支
git branch -d dev

# 删除远程分支
git push origin --delete dev
```

### 发布新版本
```bash
# 1. 更新 package.json 中的版本号
# 2. 执行发布命令（自动创建 tag 并推送）
yarn release
```
