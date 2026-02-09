/**
 * Feature 基类
 * 提供统一的生命周期管理和运行状态控制
 */

import { signal, type Signal } from '@preact/signals';

export abstract class BaseFeature {
  protected _initialized = false;
  protected _running: Signal<boolean> = signal(false);

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /** 是否正在运行 (signal) */
  get running(): Signal<boolean> {
    return this._running;
  }

  /** 是否正在运行 (普通值，用于非响应式场景) */
  get isRunning(): boolean {
    return this._running.value;
  }

  // ==================== 必须实现 ====================

  /** 初始化逻辑 */
  protected abstract onInit(): Promise<void> | void;

  /** 配置重载逻辑 */
  protected abstract onReload(): Promise<void> | void;

  // ==================== 可选实现 ====================

  /** 销毁逻辑（大多数 feature 不需要） */
  protected onDestroy?(): void;

  /** 开始执行任务（有后台任务的 feature 实现） */
  protected onStart?(): Promise<void> | void;

  /** 停止/取消任务（支持中途取消的 feature 实现） */
  protected onStop?(): void;

  // ==================== 公开方法 ====================

  /** 初始化 */
  async init(): Promise<void> {
    if (this._initialized) return;
    await this.onInit();
    this._initialized = true;
  }

  /** 销毁 */
  destroy(): void {
    if (!this._initialized) return;
    if (this._running.value) this.stop();
    this.onDestroy?.();
    this._initialized = false;
  }

  /** 重载配置 */
  async reload(): Promise<void> {
    await this.onReload();
  }

  /** 开始执行任务，返回是否成功启动 */
  async start(): Promise<boolean> {
    if (this._running.value) return false;
    this._running.value = true;
    try {
      await this.onStart?.();
      return true;
    } finally {
      this._running.value = false;
    }
  }

  /** 停止/取消任务 */
  stop(): void {
    if (!this._running.value) return;
    this.onStop?.();
    this._running.value = false;
  }
}
