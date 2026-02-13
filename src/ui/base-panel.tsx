/**
 * Panel 基类
 * 提供统一的 Modal 面板管理
 */

import { render, ComponentChildren } from 'preact';
import { Modal } from './components';

export abstract class BasePanel<P = Record<string, never>> {
  protected container: HTMLDivElement | null = null;
  protected isOpen = false;
  protected props: P = {} as P;

  abstract get title(): string;
  abstract renderContent(): ComponentChildren;

  show(props?: P): void {
    if (this.isOpen) return;
    this.isOpen = true;
    if (props) this.props = props;

    if (!this.container) {
      this.container = document.createElement('div');
      document.body.appendChild(this.container);
    }

    this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.container) {
      render(null, this.container);
      this.container.remove();
      this.container = null;
    }
  }

  protected render(): void {
    if (!this.container) return;
    render(
      <Modal isOpen={true} onClose={() => this.hide()} title={this.title}>
        {this.renderContent()}
      </Modal>,
      this.container,
    );
  }
}
