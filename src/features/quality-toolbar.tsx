/**
 * 工具栏管理器
 *
 * 功能说明：
 * - 控制生活质量工具栏的显示/隐藏
 * - 通过菜单按钮切换状态
 */

import { logger } from '@/core';

/**
 * 工具栏管理器类
 */
class QualityToolbarManager {
  private isHidden = false;
  private toolbarContainer: HTMLElement | null = null;
  private originalDisplay: string = '';

  /**
   * 初始化工具栏管理器，等待DOM元素渲染后自动隐藏
   */
  init(): void {
    logger.debug('工具栏管理器已就绪');
    this.toggle();
  }


  /**
   * 查找工具栏容器（轮询查找，最多等待10秒）
   */
  private findToolbarContainer(): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      if (this.toolbarContainer) {
        resolve(this.toolbarContainer);
        return;
      }

      const timeout = 10000;
      const interval = 200;
      const startTime = Date.now();

      const tryFind = (): HTMLElement | null => {
        // 优先查找 fixed 定位的 div，减少遍历范围
        const fixedElements = document.querySelectorAll<HTMLElement>('div[style*="position: fixed"]');
        for (const el of fixedElements) {
          const span = el.querySelector('span');
          if (span?.textContent?.includes('生活质量工具栏')) {
            return el;
          }
        }
        return null;
      };

      const poll = () => {
        const container = tryFind();
        if (container) {
          this.toolbarContainer = container;
          this.originalDisplay = container.style.display || 'flex';
          resolve(container);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error('查找工具栏容器超时（10秒）'));
          return;
        }

        setTimeout(poll, interval);
      };

      poll();
    });
  }

  /**
   * 切换工具栏显示/隐藏
   */
  async toggle(): Promise<void> {
    try {
      const container = await this.findToolbarContainer();

      this.isHidden = !this.isHidden;

      if (this.isHidden) {
        container.style.display = 'none';
        logger.debug('工具栏已隐藏');
      } else {
        container.style.display = this.originalDisplay;
        logger.debug('工具栏已显示');
      }
    } catch (error) {
      logger.error('切换工具栏失败', error);
      throw error;
    }
  }

  /**
   * 获取当前状态
   */
  getIsHidden(): boolean {
    return this.isHidden;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.toolbarContainer = null;
    this.isHidden = false;
  }
}

export const qualityToolbarManager = new QualityToolbarManager();
