import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

const TOAST_STYLES = `
.mh-toast-container{position:fixed;top:20px;left:50%;transform:translateX(-50%);width:90%;max-width:600px;z-index:10100;pointer-events:none}
.mh-toast{min-width:300px;margin:0 auto 10px;padding:16px 20px 19px;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);display:flex;align-items:center;gap:12px;pointer-events:auto;animation:mhSlideIn .3s ease;position:relative;overflow:hidden;cursor:pointer}
.mh-toast.removing{animation:mhSlideOut .3s ease forwards}
.mh-toast-msg{flex:1;font-size:14px;color:#333;line-height:1.5;word-break:break-word}
.mh-toast-close{width:20px;height:20px;border:none;background:0 0;cursor:pointer;font-size:18px;color:#999;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:color .15s,background .15s,transform .15s}
.mh-toast-close:hover{color:#333;background:rgba(0,0,0,.05);border-radius:50%;transform:scale(1.1)}
.mh-toast-close:active{transform:scale(.95)}
.mh-toast-progress{position:absolute;bottom:0;left:4px;right:0;height:3px;background:currentColor;opacity:.3;width:100%;transition:width linear;border-radius:0 0 8px 0}
.mh-toast.info{border-left:4px solid #3498db}.mh-toast.info .mh-toast-progress{color:#3498db}
.mh-toast.success{border-left:4px solid #4caf50}.mh-toast.success .mh-toast-progress{color:#4caf50}
.mh-toast.warning{border-left:4px solid #ff9800}.mh-toast.warning .mh-toast-progress{color:#ff9800}
.mh-toast.error{border-left:4px solid #f44336}.mh-toast.error .mh-toast-progress{color:#f44336}
.mh-toast-confirm{border-left:4px solid #3498db}
.mh-toast-buttons{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}
.mh-toast-btn{padding:6px 16px;border:none;border-radius:4px;cursor:pointer;font-size:14px;transition:all .2s;font-weight:500}
.mh-toast-btn:hover{opacity:.85;transform:translateY(-1px)}
.mh-toast-btn:active{transform:translateY(0)}
.mh-toast-btn.primary{background:#3498db;color:#fff}
.mh-toast-btn.secondary{background:#e0e0e0;color:#333}
@keyframes mhSlideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes mhSlideOut{to{transform:translateY(-100%);opacity:0}}
@media(max-width:768px){.mh-toast{padding:8px 12px 10px;min-width:auto}}
`;

GM.addStyle(TOAST_STYLES);

interface ToastProps {
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm';
  message: string;
  timeout?: number | false;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
}

function ToastComponent({ type, message, timeout, onClose, onConfirm, confirmLabel }: ToastProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timeout !== false && progressRef.current) {
      requestAnimationFrame(() => {
        if (progressRef.current) {
          progressRef.current.style.width = '0%';
          progressRef.current.style.transitionDuration = `${timeout}ms`;
        }
      });

      const timer = setTimeout(onClose, timeout);
      return () => clearTimeout(timer);
    }
  }, [timeout, onClose]);

  const handleConfirm = () => {
    onConfirm?.();
  };

  return (
    <div className={`mh-toast ${type}`} onClick={type !== 'confirm' ? onClose : undefined}>
      <div style={{ flex: 1 }}>
        <div className="mh-toast-msg" dangerouslySetInnerHTML={{ __html: message }} />
        {type === 'confirm' && (
          <div className="mh-toast-buttons">
            {onConfirm && (
              <button className="mh-toast-btn primary" onClick={handleConfirm}>
                {confirmLabel || '确定'}
              </button>
            )}
            <button className="mh-toast-btn secondary" onClick={onClose}>
              {onConfirm ? '取消' : '关闭'}
            </button>
          </div>
        )}
      </div>
      {type !== 'confirm' && (
        <button className="mh-toast-close" onClick={onClose}>
          ×
        </button>
      )}
      {timeout !== false && <div ref={progressRef} className="mh-toast-progress" style={{ width: '100%' }} />}
    </div>
  );
}

function ProgressToastComponent({
  message,
  showClose,
  onClose,
}: {
  message: string;
  showClose: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="mh-toast info">
      <div className="mh-toast-msg">{message}</div>
      <button
        className="mh-toast-close"
        onClick={onClose}
        style={{ opacity: showClose ? 1 : 0, pointerEvents: showClose ? 'auto' : 'none' }}
      >
        ×
      </button>
    </div>
  );
}

type ToastType = 'info' | 'success' | 'warning' | 'error';

const DEFAULT_PROGRESS_ID = '__default__';

class Toast {
  private container: HTMLDivElement | null = null;
  private toastCount = 0;
  private readonly MAX_TOASTS = 5;
  private progressToasts: Map<string, HTMLElement> = new Map();

  private getContainer(): HTMLDivElement {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'mh-toast-container';
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  private async show(type: ToastType, msg: string, timeout: number | false = 2000): Promise<void> {
    return new Promise((resolve) => {
      const container = this.getContainer();

      if (this.toastCount >= this.MAX_TOASTS) {
        const oldToast = container.firstElementChild;
        if (oldToast) this.remove(oldToast as HTMLElement);
      }

      const toast = document.createElement('div');
      render(
        <ToastComponent type={type} message={msg} timeout={timeout} onClose={() => this.remove(toast, resolve)} />,
        toast,
      );

      container.appendChild(toast);
      this.toastCount++;
    });
  }

  private remove(toast: HTMLElement, callback?: () => void): void {
    const firstChild = toast.firstElementChild;
    if (firstChild) {
      firstChild.classList.add('removing');
    }
    this.toastCount = Math.max(0, this.toastCount - 1);
    setTimeout(() => {
      toast.remove();
      callback?.();
    }, 300);
  }

  info = (msg: string, timeout = 2000) => this.show('info', msg, timeout);
  success = (msg: string, timeout = 2500) => this.show('success', msg, timeout);
  warning = (msg: string, timeout = 3000) => this.show('warning', msg, timeout);
  error = (msg: string, timeout = 3500) => this.show('error', msg, timeout);

  progress(msg: string, id: string = DEFAULT_PROGRESS_ID): void {
    const container = this.getContainer();
    const existingToast = this.progressToasts.get(id);

    // 如果已存在该 ID 的 progress，直接更新
    if (existingToast) {
      render(<ProgressToastComponent message={msg} showClose={false} />, existingToast);
      return;
    }

    const toast = document.createElement('div');
    render(<ProgressToastComponent message={msg} showClose={false} />, toast);
    container.appendChild(toast);
    this.toastCount++;
    this.progressToasts.set(id, toast);
  }

  confirm(msg: string, timeout?: number, confirmLabel?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const container = this.getContainer();
      const toast = document.createElement('div');

      const close = () => this.remove(toast);

      render(
        <ToastComponent
          type="confirm"
          message={msg}
          timeout={timeout || false}
          onClose={() => {
            close();
            resolve(false);
          }}
          onConfirm={() => {
            close();
            resolve(true);
          }}
          confirmLabel={confirmLabel}
        />,
        toast,
      );

      container.appendChild(toast);
      this.toastCount++;
    });
  }

  hideProgress(id: string = DEFAULT_PROGRESS_ID): void {
    const toast = this.progressToasts.get(id);
    if (toast) {
      this.remove(toast);
      this.progressToasts.delete(id);
    }
  }
}

export const toast = new Toast();
