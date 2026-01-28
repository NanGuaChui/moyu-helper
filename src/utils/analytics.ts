/**
 * 51.la 统计集成
 */

declare const unsafeWindow: Window & { LA?: any };

class Analytics {
  private readonly LA_ID = '3OqB1GxEyPx7V8kp';
  private readonly LA_CK = '3OqB1GxEyPx7V8kp';

  init() {
    const script = document.createElement('script');
    script.charset = 'UTF-8';
    script.id = 'LA_COLLECT';
    script.src = '//sdk.51.la/js-sdk-pro.min.js';
    script.onload = () => {
      if (unsafeWindow.LA) {
        unsafeWindow.LA.init({ id: this.LA_ID, ck: this.LA_CK, autoTrack: true });
      }
    };
    document.head.appendChild(script);
  }

  track(category: string, action: string, label?: string) {
    if (unsafeWindow.LA) {
      unsafeWindow.LA.track(action, { category, label });
    }
  }
}

export const analytics = new Analytics();
