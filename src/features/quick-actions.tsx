/**
 * 快捷功能模块
 */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { ws, toast, dataCache } from '@/core';
import { logger } from '@/core/logger';
import { Modal, Select, Button } from '@/ui/components';
import { analytics, sleep } from '@/utils';

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
}

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
    steps: [
      {
        type: 'auto',
        event: 'effectAction:useItem',
        getData: async () => {
          const inventory = await dataCache.getAsync('inventory');
          const count = inventory['luckyCatBox']?.count || 0;
          if (count > 0) {
            return { itemId: 'luckyCatBox', multiple: count };
          }
          // 数量为0，返回跳过标记
          return { skip: true };
        },
      },
      {
        type: 'auto',
        event: 'effectAction:useItem',
        getData: async () => {
          const inventory = await dataCache.getAsync('inventory');
          const count = inventory['mysteryCan']?.count || 0;
          if (count > 0) {
            return { itemId: 'mysteryCan', multiple: count };
          }
          return { skip: true };
        },
      },
      {
        type: 'auto',
        event: 'effectAction:useItem',
        getData: async () => {
          const inventory = await dataCache.getAsync('inventory');
          const count = inventory['dreamFeatherBag']?.count || 0;
          if (count > 0) {
            return { itemId: 'dreamFeatherBag', multiple: count };
          }
          return { skip: true };
        },
      },
      {
        type: 'auto',
        event: 'effectAction:useItem',
        getData: async () => {
          const inventory = await dataCache.getAsync('inventory');
          const count = inventory['nightmarePrisonChestNew']?.count || 0;
          if (count > 0) {
            return { itemId: 'nightmarePrisonChestNew', multiple: count };
          }
          return { skip: true };
        },
      },
    ],
  },
];

interface QuickActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function QuickActionsModal({ isOpen, onClose }: QuickActionsModalProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [userSelectionOptions, setUserSelectionOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [userSelection, setUserSelection] = useState('');
  const [waitingForSelection, setWaitingForSelection] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [prevResult, setPrevResult] = useState<any>(null);
  const [currentConfig, setCurrentConfig] = useState<MessageConfig | null>(null);

  const executeSteps = async (config: MessageConfig, startIndex: number = 0) => {
    if (!config) return;

    setLoading(config.label);
    toast.progress(`正在执行：${config.label}...`);
    try {
      let result = prevResult;
      for (let i = startIndex; i < config.steps.length; i++) {
        const step = config.steps[i];
        toast.progress(`${config.label} - 步骤 ${i + 1}/${config.steps.length}`);
        const data = step.getData ? await step.getData(result, userSelection) : null;

        // 检查是否跳过此步骤
        if (data?.skip) {
          logger.info(`[快捷功能] 跳过步骤: ${step.event}`);
          toast.info(`[快捷功能] 跳过步骤 ${i + 1}/${config.steps.length}`);
          continue;
        }

        result = await ws.sendAndListen(step.event, data, 10000);
        logger.info(`[快捷功能] ${step.event} 结果:`, result);
        logger.info(`[快捷功能] 步骤 ${i + 1}/${config.steps.length} 完成: ${step.event}`);

        if (step.type === 'select' && step.getSelectionOptions) {
          const options = step.getSelectionOptions(result);
          setUserSelectionOptions(options);
          setCurrentStepIndex(i);
          setPrevResult(result);
          setWaitingForSelection(true);
          setLoading(null);
          toast.hideProgress();
          return;
        } else {
          await sleep(1000);
        }
      }
      logger.success(`[快捷功能] ${config.label} 执行成功`);
      toast.success(`${config.label} 执行成功`);
      analytics.track('快捷功能', config.label, '成功');
      onClose();
    } catch (error) {
      logger.error(`[快捷功能] ${config.label} 执行失败`);
      console.error(JSON.stringify(error, null, 4));
      toast.error(`${config.label} 执行失败`);
      analytics.track('快捷功能', config.label, '失败');
    } finally {
      setLoading(null);
      toast.hideProgress();
    }
  };

  const handleExecute = async (config: MessageConfig) => {
    setLoading(config.label);
    setCurrentConfig(config);
    setCurrentStepIndex(0);
    setPrevResult(null);
    setUserSelection('');
    await executeSteps(config, 0);
    setLoading(null);
  };

  const handleContinue = async () => {
    if (!userSelection || !currentConfig) return;
    setWaitingForSelection(false);
    setUserSelectionOptions([]);
    await executeSteps(currentConfig, currentStepIndex + 1);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="快捷功能">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!waitingForSelection ? (
          MESSAGE_CONFIGS.map((config) => (
            <div key={config.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Button
                onClick={() => handleExecute(config)}
                disabled={loading === config.label}
                style={{ width: '100%' }}
              >
                {loading === config.label ? '执行中...' : config.label}
              </Button>
              <div
                style={{ padding: '8px', background: '#f5f5f5', borderRadius: '4px', fontSize: '12px', color: '#666' }}
              >
                {config.description}
              </div>
            </div>
          ))
        ) : (
          <>
            <Select
              value={userSelection}
              onChange={setUserSelection}
              options={userSelectionOptions}
              placeholder="请选择用户"
            />
            <Button onClick={handleContinue} disabled={!userSelection || !!loading} style={{ width: '100%' }}>
              {loading ? '执行中...' : '继续执行'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

class QuickActions {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  openModal(): void {
    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    this.isOpen = true;
    this.render();
    analytics.track('快捷功能', 'open_modal');
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
