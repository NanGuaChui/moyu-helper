/**
 * 悬浮面板组件 - Preact 重构版
 */

import { render } from 'preact';
import type { PanelButton } from '@/types';
import { logger } from '@/core';
import { throttle } from '@/utils';

const STYLES = `
.mh-fab{position:fixed;bottom:calc(var(--spacing) * 25);z-index:9999;width:60px;height:60px;border-radius:50%;border:none;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.08);color:#6366f1;font-size:20px;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1)}
.mh-fab-menu{position:fixed;bottom:calc(var(--spacing) * 25 + 68px);z-index:10000;width:150px;max-height:calc(100vh - var(--spacing) * 25 - 88px);background:#fff;border-radius:12px;border:1px solid rgba(0,0,0,.08);box-shadow:0 8px 28px rgba(0,0,0,.12);padding:8px;opacity:0;transform:translateY(12px) scale(.95);pointer-events:none;transition:all .25s cubic-bezier(.4,0,.2,1);overflow-y:auto}
.mh-fab-menu.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
.mh-fab-menu.modal-mode{position:fixed;top:50%;left:50%;bottom:auto;right:auto;transform:translate(-50%,-50%) scale(.95);width:90%;max-width:280px;max-height:80vh;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15);padding:12px;overflow-y:auto}
.mh-fab-menu.modal-mode.open{transform:translate(-50%,-50%) scale(1)}
.mh-fab-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;opacity:0;pointer-events:none;transition:opacity .3s ease}
.mh-fab-overlay.show{opacity:1;pointer-events:auto}
.mh-fab-item{width:100%;padding:12px 16px;border:none;border-radius:8px;background:transparent;color:#333;font-size:14px;text-align:left;cursor:pointer;transition:all .15s ease;margin-bottom:4px}
.mh-fab-item:hover{background:#f8f9fa;transform:translateX(-2px)}
@media (max-width: 768px){
  .mh-fab{width:50px;height:50px;bottom:calc(var(--spacing) * 22);}
  .mh-fab-menu{bottom:calc(var(--spacing) * 22 + 68px);max-height:calc(100vh - var(--spacing) * 22 - 88px);}
}
`;

GM.addStyle(STYLES);

interface FloatingMenuProps {
  buttons: PanelButton[];
  isOpen: boolean;
  onClose: () => void;
  isModalMode: boolean;
}

function FloatingMenu({ buttons, isOpen, onClose, isModalMode }: FloatingMenuProps) {
  const handleItemClick = (onClick: () => void) => {
    onClick();
    onClose();
  };

  return (
    <>
      {isModalMode && isOpen && <div className={`mh-fab-overlay ${isOpen ? 'show' : ''}`} onClick={onClose} />}
      <div className={`mh-fab-menu right-6 md:right-8 ${isOpen ? 'open' : ''} ${isModalMode ? 'modal-mode' : ''}`}>
        {buttons.map((btn, index) => (
          <button
            key={index}
            className="mh-fab-item"
            onClick={() => handleItemClick(btn.onClick)}
            dangerouslySetInnerHTML={{ __html: btn.text }}
          />
        ))}
      </div>
    </>
  );
}

interface PanelOptions {
  subButtons?: PanelButton[] | (() => PanelButton[] | Promise<PanelButton[]>);
}

class FloatingPanel {
  private buttonSource: PanelButton[] | (() => PanelButton[] | Promise<PanelButton[]>);
  private fab: HTMLButtonElement;
  private menuContainer: HTMLDivElement;
  private isOpen = false;
  private isModalMode = false;
  private cachedButtons: PanelButton[] = [];

  constructor(options: PanelOptions = {}) {
    this.buttonSource = options.subButtons || [];
    this.fab = this.createFab();
    this.menuContainer = this.createMenuContainer();
    this.bindEvents();
    this.checkModalMode();
    this.loadAndRenderMenu().catch((error) => logger.error('Failed to load menu', error));
  }

  private async getButtons(): Promise<PanelButton[]> {
    const result = typeof this.buttonSource === 'function' ? this.buttonSource() : this.buttonSource;
    return result instanceof Promise ? await result : result;
  }

  private async loadAndRenderMenu(): Promise<void> {
    this.cachedButtons = await this.getButtons();
    this.renderMenu();
  }

  private createFab(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'mh-fab right-6 md:right-8';
    btn.textContent = '☰';
    btn.onclick = (e) => {
      e.stopPropagation();
      this.toggle();
    };
    btn.onmouseenter = () => {
      btn.style.transform = 'scale(1.08)';
      btn.style.boxShadow = '0 6px 20px rgba(0,0,0,.15),0 3px 10px rgba(0,0,0,.1)';
    };
    btn.onmouseleave = () => {
      if (!this.isOpen) {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 4px 16px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.08)';
      }
    };
    document.body.appendChild(btn);
    return btn;
  }

  private createMenuContainer(): HTMLDivElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
  }

  private checkModalMode(): void {
    this.isModalMode = window.innerWidth < 768;
  }

  private renderMenu(): void {
    render(
      <FloatingMenu
        buttons={this.cachedButtons}
        isOpen={this.isOpen}
        onClose={() => this.close()}
        isModalMode={this.isModalMode}
      />,
      this.menuContainer,
    );
  }

  private bindEvents(): void {
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.fab.contains(e.target as Node)) {
        // 延迟检查，以便让菜单项的点击事件先触发
        setTimeout(() => {
          if (this.isOpen) {
            this.close();
          }
        }, 0);
      }
    });

    window.addEventListener('settings-updated', () => {
      this.loadAndRenderMenu().catch((error) => logger.error('Failed to reload menu', error));
    });

    window.addEventListener(
      'resize',
      throttle(() => {
        this.checkModalMode();
        this.renderMenu();
      }, 500),
    );
  }

  private toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private async open(): Promise<void> {
    this.isOpen = true;
    this.checkModalMode();
    await this.loadAndRenderMenu();

    this.fab.textContent = '✕';
    Object.assign(this.fab.style, {
      transform: 'scale(1.08) rotate(90deg)',
      background: '#6366f1',
      color: 'white',
    });
  }

  private close(): void {
    this.isOpen = false;
    this.renderMenu();

    this.fab.textContent = '☰';
    Object.assign(this.fab.style, {
      transform: 'scale(1) rotate(0deg)',
      background: '#fff',
      color: '#6366f1',
    });
  }
}

export { FloatingPanel };
