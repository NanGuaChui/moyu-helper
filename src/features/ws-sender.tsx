/**
 * WS 消息发送模块
 */

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { ws, toast } from '@/core';
import { logger } from '@/core/logger';
import { Modal, Select, Button } from '@/ui/components';
import { analytics } from '@/utils';

interface MessageStep {
  type: 'auto' | 'select';
  event: string;
  getData: (prevResult?: any, userSelection?: any) => any;
  getSelectionOptions?: (prevResult: any) => Array<{ value: string; label: string }>;
}

interface MessageConfig {
  label: string;
  steps: MessageStep[];
}

const MESSAGE_CONFIGS: MessageConfig[] = [
  {
    label: '清空战利品记录',
    steps: [
      {
        type: 'auto',
        event: 'battleRoom:getCurrentRoom',
        getData: () => ({}),
      },
      {
        type: 'auto',
        event: 'battleRoom:resetSelfBattleRewardInfo',
        getData: (prevResult) => ({ roomId: prevResult?.payload?.data?.uuid || '' }),
      },
    ],
  },
  {
    label: '切换用户',
    steps: [
      {
        type: 'select',
        event: 'account:getList',
        getData: () => ({}),
        getSelectionOptions: (result) => {
          const accounts = result?.payload?.data?.list || [];
          return accounts.map((acc: any) => ({
            value: acc.uuid,
            label: `${acc.type} - ${acc.playType} (${acc.uuid})`,
          }));
        },
      },
      {
        type: 'auto',
        event: 'account:switch',
        getData: (prevResult, userSelection) => ({ accountId: userSelection }),
      },
    ],
  },
];

interface WsSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function WsSenderModal({ isOpen, onClose }: WsSenderModalProps) {
  const [selectedConfig, setSelectedConfig] = useState(MESSAGE_CONFIGS[0]?.label || '');
  const [loading, setLoading] = useState(false);
  const [userSelectionOptions, setUserSelectionOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [userSelection, setUserSelection] = useState('');
  const [waitingForSelection, setWaitingForSelection] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [prevResult, setPrevResult] = useState<any>(null);

  const executeSteps = async (startIndex: number = 0) => {
    const config = MESSAGE_CONFIGS.find((c) => c.label === selectedConfig);
    if (!config) return;

    setLoading(true);
    toast.progress(`正在执行：${config.label}...`);
    try {
      let result = prevResult;
      for (let i = startIndex; i < config.steps.length; i++) {
        const step = config.steps[i];
        toast.progress(`${config.label} - 步骤 ${i + 1}/${config.steps.length}`);
        const data = step.getData(result, userSelection);
        result = await ws.sendAndListen(step.event, data, 10000);
        logger.info(`[WS消息] ${step.event} 结果:`, result);
        logger.info(`[WS消息] 步骤 ${i + 1}/${config.steps.length} 完成: ${step.event}`);

        if (step.type === 'select' && step.getSelectionOptions) {
          const options = step.getSelectionOptions(result);
          setUserSelectionOptions(options);
          setCurrentStepIndex(i);
          setPrevResult(result);
          setWaitingForSelection(true);
          setLoading(false);
          toast.hideProgress();
          return;
        }
      }
      logger.success(`[WS消息] ${config.label} 执行成功`);
      toast.success(`${config.label} 执行成功`);
      analytics.track('WS消息发送', config.label, '成功');
      onClose();
    } catch (error) {
      logger.error(`[WS消息] ${config.label} 执行失败`);
      console.error(JSON.stringify(error, null, 4));
      toast.error(`${config.label} 执行失败`);
      analytics.track('WS消息发送', config.label, '失败');
    } finally {
      setLoading(false);
      toast.hideProgress();
    }
  };

  const handleExecute = async () => {
    if (!selectedConfig) return;
    setCurrentStepIndex(0);
    setPrevResult(null);
    setUserSelection('');
    await executeSteps(0);
  };

  const handleContinue = async () => {
    if (!userSelection) return;
    setWaitingForSelection(false);
    setUserSelectionOptions([]);
    await executeSteps(currentStepIndex + 1);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="发送 WS 消息">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!waitingForSelection ? (
          <>
            <Select
              value={selectedConfig}
              onChange={setSelectedConfig}
              options={MESSAGE_CONFIGS.map((c) => ({ value: c.label, label: c.label }))}
              placeholder="请选择消息类型"
            />
            <Button onClick={handleExecute} disabled={!selectedConfig || loading} style={{ width: '100%' }}>
              {loading ? '执行中...' : '执行'}
            </Button>
          </>
        ) : (
          <>
            <Select
              value={userSelection}
              onChange={setUserSelection}
              options={userSelectionOptions}
              placeholder="请选择用户"
            />
            <Button onClick={handleContinue} disabled={!userSelection || loading} style={{ width: '100%' }}>
              {loading ? '执行中...' : '继续执行'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

class WsSender {
  private container: HTMLDivElement | null = null;
  private isOpen = false;

  openModal(): void {
    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    this.isOpen = true;
    this.render();
    analytics.track('WS消息发送', 'open_modal');
  }

  private closeModal = (): void => {
    this.isOpen = false;
    this.render();
  };

  private render(): void {
    if (!this.container) return;
    render(<WsSenderModal isOpen={this.isOpen} onClose={this.closeModal} />, this.container);
  }
}

export const wsSender = new WsSender();
