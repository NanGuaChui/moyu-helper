/**
 * 酒馆专家管理器
 * 快速启用/禁用酒馆中的各类专家猫猫
 */

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { toast, ws, dataCache, eventBus, BaseFeature, createLogger } from '@/core';

const logger = createLogger('TavernExpert');
import { Modal, Button } from '@/ui/components';
import { getWsErrorMessage } from '@/utils';
import type { TavernExpert } from '@/types/game-data';
import type { JSX } from 'preact';

/**
 * 酒馆专家类型定义
 */
interface TavernExpertType {
  id: string;
  name: string;
  shortName: string;
  icon: string;
}

/**
 * 专家状态类型
 */
type ExpertStatus = 'NOT_HIRED' | 'WORKING' | 'PAUSED';

/**
 * 专家状态信息
 */
interface ExpertStatusInfo {
  type: TavernExpertType;
  status: ExpertStatus;
  expert?: TavernExpert;
}

/**
 * 可用的酒馆专家类型列表
 */
export const TAVERN_EXPERT_TYPES: TavernExpertType[] = [
  { id: 'enhanceExpert', name: '强化专家猫猫', shortName: '强化', icon: '✨' },
  { id: 'teacherExpert', name: '老师猫猫', shortName: '老师', icon: '🧑' },
  { id: 'extraExpExpert', name: '卷王助教喵', shortName: '卷王', icon: '🐟' },
  { id: 'battleLogisticsExpert', name: '战场后勤猫猫', shortName: '后勤', icon: '⚔️' },
  { id: 'fitnessCoachCat', name: '健身教练猫猫', shortName: '教练', icon: '🏋️' },
  { id: 'farmingAnimalExpert', name: '畜牧专家猫猫', shortName: '畜牧', icon: '🐮' },
  { id: 'sewingExpert', name: '缝纫专家猫猫', shortName: '缝纫', icon: '🧵' },
  { id: 'fishingExpert', name: '钓鱼专家猫猫', shortName: '钓鱼', icon: '🎣' },
  { id: 'baseMercenary', name: '见习雇佣兵猫猫', shortName: '雇佣兵', icon: '🪖' },
];

class TavernExpertManager extends BaseFeature {
  private loadingExperts: Set<string> = new Set();
  private panelContainer: HTMLDivElement | null = null;

  protected onInit(): void {
    logger.info('酒馆专家管理器初始化完成');
  }

  protected onReload(): void {
    // 酒馆专家管理器没有配置项需要重载
  }

  /**
   * 获取专家类型信息
   */
  getExpertType(expertId: string): TavernExpertType | undefined {
    return TAVERN_EXPERT_TYPES.find((e) => e.id === expertId);
  }

  /**
   * 获取所有专家的状态信息（同步从缓存读取）
   */
  getExpertsStatus(): ExpertStatusInfo[] {
    const tavern: TavernExpert[] = dataCache.has('tavern') ? (dataCache as any).cache.tavern || [] : [];

    return TAVERN_EXPERT_TYPES.map((type) => {
      const expert = tavern.find((e) => e.type === type.id);
      let status: ExpertStatus = 'NOT_HIRED';

      if (expert) {
        status = expert.state === 'WORKING' ? 'WORKING' : 'PAUSED';
      }

      return { type, status, expert };
    });
  }

  /**
   * 执行专家操作
   */
  async executeAction(expertId: string, action: 'hire' | 'pause' | 'resume'): Promise<void> {
    if (this.loadingExperts.has(expertId)) {
      toast.warning('操作进行中，请稍候...');
      return;
    }

    const expertType = this.getExpertType(expertId);
    const expertName = expertType?.name || expertId;

    this.loadingExperts.add(expertId);

    try {
      switch (action) {
        case 'hire':
          await ws.request('tavern:hireExpert', { catId: expertId, hours: 1 });
          toast.success(`✅ ${expertName}已聘用`);
          break;
        case 'pause':
          await ws.request('tavern:pause', { catId: expertId });
          toast.success(`✅ ${expertName}已暂停`);
          break;
        case 'resume': {
          const res = await ws.request('tavern:resume', { catId: expertId });

          // 检查结束时间
          if (res?.payload?.data?.record?.end_date) {
            const endTime = new Date(res.payload.data.record.end_date).getTime();
            const now = Date.now();
            const remainingMs = endTime - now;
            const remainingHours = remainingMs / (1000 * 60 * 60);

            if (remainingHours < 1) {
              const remainingMinutes = Math.floor(remainingMs / 60000);
              await ws.request('tavern:renewExpert', { catId: expertId, hours: 1 });
              toast.success(`✅ ${expertName}已启用，剩余${remainingMinutes}分钟，已自动续约1小时`);
            } else {
              toast.success(`✅ ${expertName}已启用`);
            }
          } else {
            toast.success(`✅ ${expertName}已启用`);
          }
          break;
        }
      }
    } catch (error) {
      logger.error(`${expertName}操作失败`, error);
      toast.error(`${expertName}: ${getWsErrorMessage(error)}`);
    } finally {
      this.loadingExperts.delete(expertId);
    }
  }

  /**
   * 获取当前激活的酒馆专家列表
   */
  async getActiveExperts(): Promise<TavernExpert[]> {
    try {
      if (!dataCache.has('tavern')) return [];
      const tavern: TavernExpert[] = await dataCache.getAsync('tavern');
      return tavern.filter((e) => e.state === 'WORKING');
    } catch {
      return [];
    }
  }

  /**
   * 获取所有已雇佣的酒馆专家列表
   */
  async getAllExperts(): Promise<TavernExpert[]> {
    try {
      if (!dataCache.has('tavern')) return [];
      return await dataCache.getAsync('tavern');
    } catch {
      return [];
    }
  }

  /**
   * 显示当前酒馆状态通知
   */
  async showTavernStatus(): Promise<void> {
    try {
      const activeExperts = await this.getActiveExperts();

      if (activeExperts.length === 0) {
        toast.info('🏠 当前没有工作中的酒馆专家', 3000);
        return;
      }

      const activeNames = activeExperts
        .map((e) => {
          const type = this.getExpertType(e.type);
          return type ? `${type.icon}${type.shortName}` : e.type;
        })
        .join('、');

      toast.info(`🏠 工作中: ${activeNames}`, 5000);
    } catch (error) {
      logger.error('获取酒馆状态失败', error);
    }
  }

  /**
   * 打开酒馆管理面板
   */
  openPanel(): void {
    if (!this.panelContainer) {
      this.panelContainer = document.createElement('div');
      this.panelContainer.id = 'mh-tavern-panel';
      document.body.appendChild(this.panelContainer);
    }

    this.renderPanel(true);
  }

  /**
   * 关闭酒馆管理面板
   */
  closePanel(): void {
    this.renderPanel(false);
  }

  /**
   * 渲染面板
   */
  private renderPanel(isOpen: boolean): void {
    if (!this.panelContainer) return;

    render(<TavernPanel isOpen={isOpen} onClose={() => this.closePanel()} manager={this} />, this.panelContainer);
  }
}

/**
 * 酒馆管理面板组件 Props
 */
interface TavernPanelProps {
  isOpen: boolean;
  onClose: () => void;
  manager: TavernExpertManager;
}

/**
 * 专家项组件 Props
 */
interface ExpertItemProps {
  info: ExpertStatusInfo;
  onAction: (expertId: string, action: 'hire' | 'pause' | 'resume') => void;
  loading: boolean;
}

/**
 * 专家项组件样式
 */
const EXPERT_ITEM_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  background: '#f8f9fa',
  borderRadius: '8px',
  marginBottom: '6px',
};

const EXPERT_INFO_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: 1,
  minWidth: 0,
};

const EXPERT_ICON_STYLE: JSX.CSSProperties = {
  fontSize: '18px',
  flexShrink: 0,
};

const EXPERT_NAME_STYLE: JSX.CSSProperties = {
  fontSize: '13px',
  fontWeight: '500',
  color: '#1a1a1a',
  whiteSpace: 'nowrap',
};

const EXPERT_STATUS_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  color: '#666',
  display: 'flex',
  alignItems: 'center',
  marginLeft: '8px',
};

const STATUS_DOT_STYLE = (status: ExpertStatus): JSX.CSSProperties => ({
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  marginRight: '4px',
  background: status === 'WORKING' ? '#22c55e' : status === 'PAUSED' ? '#f59e0b' : '#9ca3af',
});

const BUTTON_WRAPPER_STYLE: JSX.CSSProperties = {
  flexShrink: 0,
};

/**
 * 专家项组件
 */
function ExpertItem({ info, onAction, loading }: ExpertItemProps) {
  const { type, status } = info;

  const getStatusText = () => {
    switch (status) {
      case 'WORKING':
        return '工作中';
      case 'PAUSED':
        return '已暂停';
      default:
        return '未聘用';
    }
  };

  const getButtonConfig = (): {
    text: string;
    action: 'hire' | 'pause' | 'resume';
    variant: 'primary' | 'secondary' | 'danger';
  } => {
    switch (status) {
      case 'WORKING':
        return { text: '暂停', action: 'pause', variant: 'danger' };
      case 'PAUSED':
        return { text: '启用', action: 'resume', variant: 'primary' };
      default:
        return { text: '聘用', action: 'hire', variant: 'primary' };
    }
  };

  const buttonConfig = getButtonConfig();

  return (
    <div style={EXPERT_ITEM_STYLE}>
      <div style={EXPERT_INFO_STYLE}>
        <span style={EXPERT_ICON_STYLE}>{type.icon}</span>
        <span style={EXPERT_NAME_STYLE}>{type.shortName}</span>
        <span style={EXPERT_STATUS_STYLE}>
          <span style={STATUS_DOT_STYLE(status)} />
          {getStatusText()}
        </span>
      </div>
      <div style={BUTTON_WRAPPER_STYLE}>
        <Button
          variant={buttonConfig.variant}
          onClick={() => onAction(type.id, buttonConfig.action)}
          disabled={loading}
          style={{ padding: '4px 10px', fontSize: '11px' }}
        >
          {loading ? '...' : buttonConfig.text}
        </Button>
      </div>
    </div>
  );
}

/**
 * 酒馆管理面板组件
 */
function TavernPanel({ isOpen, onClose, manager }: TavernPanelProps) {
  const [expertsStatus, setExpertsStatus] = useState<ExpertStatusInfo[]>([]);
  const [loadingExperts, setLoadingExperts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;

    // 从缓存读取初始数据
    setExpertsStatus(manager.getExpertsStatus());

    // 监听酒馆数据更新事件
    const unsubscribe = eventBus.on('tavernUpdated', () => {
      setExpertsStatus(manager.getExpertsStatus());
    });

    return unsubscribe;
  }, [isOpen, manager]);

  const handleAction = async (expertId: string, action: 'hire' | 'pause' | 'resume') => {
    setLoadingExperts((prev) => new Set(prev).add(expertId));

    try {
      await manager.executeAction(expertId, action);
    } finally {
      setLoadingExperts((prev) => {
        const next = new Set(prev);
        next.delete(expertId);
        return next;
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🏠 酒馆管理">
      <div>
        {expertsStatus.map((info) => (
          <ExpertItem
            key={info.type.id}
            info={info}
            onAction={handleAction}
            loading={loadingExperts.has(info.type.id)}
          />
        ))}
      </div>
    </Modal>
  );
}

export const tavernExpertManager = new TavernExpertManager();
