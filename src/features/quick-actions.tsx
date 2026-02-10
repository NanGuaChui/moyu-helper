/**
 * 快捷功能模块
 */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { ws, toast, dataCache, BaseFeature, createLogger } from '@/core';
import { getWsErrorMessage, sleep, getResourceDetail } from '@/utils';
import { Modal, Select, Button } from '@/ui/components';
import { qualityToolbarManager } from './quality-toolbar';

const logger = createLogger('QuickActions');

interface MessageStep {
  type: 'auto' | 'select';
  event: string;
  getData?: (prevResult?: any, userSelection?: any) => any | Promise<any>;
  getSelectionOptions?: (prevResult: any) => Array<{ value: string; label: string }>;
}

interface MessageConfig {
  label: string;
  description: string;
  steps: MessageStep[];
  validate?: () => Promise<void>;
}

/** 批量获取物品数量 */
async function getItemCounts(itemIds: string[]): Promise<Record<string, number>> {
  const inventory = await dataCache.getAsync('inventory');
  const result: Record<string, number> = {};
  itemIds.forEach((id) => {
    result[id] = inventory[id]?.count || 0;
  });
  return result;
}

/** 创建物品数量验证器工厂函数 */
function createItemCountValidator(itemIds: string[], errorMessage: string) {
  return async () => {
    const counts = await getItemCounts(itemIds);
    if (itemIds.every((id) => counts[id] <= 0)) {
      throw new Error(errorMessage);
    }
  };
}

/** 使用物品步骤 */
function useItemStep(itemId: string): MessageStep {
  return {
    type: 'auto',
    event: 'effectAction:useItem',
    getData: async () => {
      const inventory = await dataCache.getAsync('inventory');
      const count = inventory[itemId]?.count || 0;
      if (count > 0) {
        // 使用后将本地库存置0，避免缓存过期导致重复使用
        inventory[itemId].count = 0;
        return { itemId, multiple: count };
      }
      return { skip: true };
    },
  };
}

const SKILL_BOOK_SUFFIX = 'SkillBook';
const SKILL_BOOK_SUFFIX_LEN = SKILL_BOOK_SUFFIX.length;

/** 从仓库中筛选出未学习的技能书 */
function getUnlearnedSkillBooks(
  inventory: Awaited<ReturnType<typeof dataCache.getAsync<'inventory'>>>,
): Array<{ itemId: string; skillId: string }> {
  const learnedSkills = dataCache.getLearnedSkillIds();
  if (!learnedSkills) return [];

  const result: Array<{ itemId: string; skillId: string }> = [];
  for (const itemId in inventory) {
    if (!itemId.endsWith(SKILL_BOOK_SUFFIX)) continue;
    const skillId = itemId.slice(0, -SKILL_BOOK_SUFFIX_LEN);
    if (!learnedSkills.has(skillId) && inventory[itemId].count > 0) {
      result.push({ itemId, skillId });
    }
  }
  return result;
}

/** 缓存动态生成的技能书步骤，供 steps 引用 */
let pendingSkillBookSteps: MessageStep[] = [];

const MESSAGE_CONFIGS: MessageConfig[] = [
  {
    label: '清空战利品记录',
    description: '清空当前战斗房间的战利品记录，重新开始统计掉落物品',
    steps: [
      {
        type: 'auto',
        event: 'battleRoom:getCurrentRoom',
      },
      {
        type: 'auto',
        event: 'battleRoom:resetSelfBattleRewardInfo',
        getData: (prevResult) => ({ roomId: prevResult?.payload?.data?.uuid || '' }),
      },
    ],
  },
  {
    label: '一键打开宝箱',
    description: '自动使用仓库中所有的幸运猫盒、神秘罐头、梦羽袋、噩梦宝箱',
    validate: createItemCountValidator(
      ['luckyCatBox', 'mysteryCan', 'dreamFeatherBag', 'nightmarePrisonChestNew'],
      '没有任何宝箱',
    ),
    steps: [
      useItemStep('luckyCatBox'),
      useItemStep('mysteryCan'),
      useItemStep('dreamFeatherBag'),
      useItemStep('nightmarePrisonChestNew'),
    ],
  },
  {
    label: '使用生活/战斗专精书',
    description: '一键使用仓库中所有的生活专精书和战斗专精书',
    validate: createItemCountValidator(['bookOfWorkSkillTreePoint', 'bookOfBattleSkillTreePoint'], '没有任何专精书'),
    steps: [useItemStep('bookOfWorkSkillTreePoint'), useItemStep('bookOfBattleSkillTreePoint')],
  },
  {
    label: '使用未学习技能书',
    description: '检查仓库中已有但未学习的技能书，确认后一键使用',
    validate: async () => {
      const inventory = await dataCache.getAsync('inventory');
      const books = getUnlearnedSkillBooks(inventory);
      if (books.length === 0) {
        throw new Error('没有未学习的技能书');
      }
      const bookList = books.map((b) => getResourceDetail(b.itemId)?.name || b.itemId).join('<br>');
      if (!await toast.confirm(`发现 ${books.length} 本未学习的技能书：<br><br>${bookList}<br><br>确认使用？`)) {
        throw new Error('已取消');
      }
      // 动态生成 steps 并缓存，技能书每种只需使用一本
      pendingSkillBookSteps = books.map((b): MessageStep => ({
        type: 'auto',
        event: 'effectAction:useItem',
        getData: async () => {
          const inventory = await dataCache.getAsync('inventory');
          if (inventory[b.itemId]) {
            inventory[b.itemId].count = 0;
          }
          return { itemId: b.itemId, multiple: 1 };
        },
      }));
    },
    get steps() {
      return pendingSkillBookSteps;
    },
  },
];

interface ToolbarAction {
  label: string;
  description: string;
  getLabel: () => string;
  action: () => void;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: '切换工具栏',
    description: '显示或隐藏生活质量工具栏',
    getLabel: () => (qualityToolbarManager.getIsHidden() ? '👁️ 显示工具栏' : '🙈 隐藏工具栏'),
    action: () => qualityToolbarManager.toggle(),
  },
];

interface QuickActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function QuickActionsModal({ isOpen, onClose }: QuickActionsModalProps) {
  const [userSelectionOptions, setUserSelectionOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [userSelection, setUserSelection] = useState('');
  const [waitingForSelection, setWaitingForSelection] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [prevResult, setPrevResult] = useState<any>(null);
  const [currentConfig, setCurrentConfig] = useState<MessageConfig | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);

  const executeSteps = async (config: MessageConfig, startIndex: number = 0) => {
    if (!config) return;

    setCurrentLabel(config.label);
    toast.progress(`正在执行：${config.label}...`, 'quick-actions');
    try {
      // 执行前置校验
      if (startIndex === 0 && config.validate) {
        await config.validate();
      }

      let result = prevResult;
      for (let i = startIndex; i < config.steps.length; i++) {
        const step = config.steps[i];
        toast.progress(`${config.label} - 步骤 ${i + 1}/${config.steps.length}`, 'quick-actions');
        const data = step.getData ? await step.getData(result, userSelection) : null;

        // 检查是否跳过此步骤
        if (data?.skip) {
          logger.info(`[快捷功能] 跳过步骤: ${step.event}`);
          toast.progress(`${config.label} - 跳过步骤 ${i + 1}/${config.steps.length}`, 'quick-actions');
          await sleep(300);
          continue;
        }

        result = await ws.request(step.event, data, 10000);
        logger.info(`[快捷功能] ${step.event} 结果:`, result);
        logger.info(`[快捷功能] 步骤 ${i + 1}/${config.steps.length} 完成: ${step.event}`);

        if (step.type === 'select' && step.getSelectionOptions) {
          const options = step.getSelectionOptions(result);
          setUserSelectionOptions(options);
          setCurrentStepIndex(i);
          setPrevResult(result);
          setWaitingForSelection(true);
          setCurrentLabel(null);
          toast.hideProgress('quick-actions');
          return;
        } else {
          await sleep(1000);
        }
      }
      logger.success(`[快捷功能] ${config.label} 执行成功`);
      toast.success(`${config.label} 执行成功`);
    } catch (error) {
      logger.error(`[快捷功能] ${config.label} 执行失败`);
      logger.error(JSON.stringify(error, null, 4));
      toast.error(`${config.label}: ${getWsErrorMessage(error, '执行失败')}`);
    } finally {
      setCurrentLabel(null);
      toast.hideProgress('quick-actions');
    }
  };

  const handleExecute = async (config: MessageConfig) => {
    if (quickActions.running.value) {
      toast.warning('快捷功能执行中');
      return;
    }
    setCurrentLabel(config.label);
    setCurrentConfig(config);
    setCurrentStepIndex(0);
    setPrevResult(null);
    setUserSelection('');
    quickActions.setRunning(true);
    try {
      await executeSteps(config, 0);
    } catch {
      // executeSteps 内部已处理错误提示，这里只需确保状态重置
    } finally {
      quickActions.setRunning(false);
      setCurrentLabel(null);
    }
  };

  const handleContinue = async () => {
    if (!userSelection || !currentConfig) return;
    setWaitingForSelection(false);
    setUserSelectionOptions([]);
    quickActions.setRunning(true);
    try {
      await executeSteps(currentConfig, currentStepIndex + 1);
    } catch {
      // executeSteps 内部已处理错误提示，这里只需确保状态重置
    } finally {
      quickActions.setRunning(false);
      setCurrentLabel(null);
    }
  };

  const [, forceUpdate] = useState(0);

  const handleToolbarAction = (action: ToolbarAction) => {
    action.action();
    forceUpdate((n) => n + 1);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="快捷功能">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!waitingForSelection ? (
          <>
            {/* 工具栏操作 */}
            {TOOLBAR_ACTIONS.map((action) => (
              <div key={action.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button onClick={() => handleToolbarAction(action)} style={{ width: '100%' }}>
                  {action.getLabel()}
                </Button>
                <div
                  style={{
                    padding: '8px',
                    background: '#f5f5f5',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#666',
                  }}
                >
                  {action.description}
                </div>
              </div>
            ))}
            {/* 消息操作 */}
            {MESSAGE_CONFIGS.map((config) => (
              <div key={config.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button
                  onClick={() => handleExecute(config)}
                  disabled={quickActions.running.value}
                  style={{ width: '100%' }}
                >
                  {quickActions.running.value && currentLabel === config.label ? '执行中...' : config.label}
                </Button>
                <div
                  style={{
                    padding: '8px',
                    background: '#f5f5f5',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#666',
                  }}
                >
                  {config.description}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <Select
              value={userSelection}
              onChange={setUserSelection}
              options={userSelectionOptions}
              placeholder="请选择用户"
            />
            <Button
              onClick={handleContinue}
              disabled={!userSelection || quickActions.running.value}
              style={{ width: '100%' }}
            >
              {quickActions.running.value ? '执行中...' : '继续执行'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

class QuickActions extends BaseFeature {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  protected onInit(): void {
    logger.info('快捷功能初始化完成');
  }

  protected onReload(): void {
    // 快捷功能没有配置项需要重载
  }

  setRunning(value: boolean): void {
    this._running.value = value;
  }

  openModal(): void {
    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    this.isOpen = true;
    this.render();
  }

  private closeModal = (): void => {
    this.isOpen = false;
    this.render();
  };

  private render(): void {
    if (!this.container) return;
    render(<QuickActionsModal isOpen={this.isOpen} onClose={this.closeModal} />, this.container);
  }
}

export const quickActions = new QuickActions();
