import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import preact from '@preact/preset-vite';
import path from 'path';
import pkg from './package.json';

/**
 * 开发模式同步注入脚本：在异步模块加载前拦截 WebSocket 原型，缓存早期消息。
 * WebSocketManager.init() 会通过 window.__earlyWsHook 接管并回放。
 */
const earlyWsHookScript = `
;(function () {
  var hook = {
    originalSend: WebSocket.prototype.send,
    originalAddEventListener: WebSocket.prototype.addEventListener,
    onmessageDescriptor: Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage'),
    outgoing: [],
    incoming: [],
    socket: null,
    taken: false
  };
  var proto = WebSocket.prototype;
  proto.send = function (data) {
    if (!hook.taken && this instanceof WebSocket && this.constructor === WebSocket) {
      hook.socket = this;
      hook.outgoing.push({ ws: this, data: data });
    }
    return hook.originalSend.call(this, data);
  };
  if (hook.onmessageDescriptor && hook.onmessageDescriptor.set) {
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: true,
      get: hook.onmessageDescriptor.get,
      set: function (callback) {
        var ws = this;
        var wrapped = callback
          ? function (event) {
              if (!hook.taken && ws instanceof WebSocket && ws.constructor === WebSocket) {
                hook.incoming.push({ data: event.data });
              }
              callback.call(ws, event);
            }
          : null;
        hook.onmessageDescriptor.set.call(this, wrapped);
      }
    });
  }
  proto.addEventListener = function (type, listener, options) {
    if (type !== 'message' || hook.taken || !(this instanceof WebSocket) || this.constructor !== WebSocket) {
      return hook.originalAddEventListener.call(this, type, listener, options);
    }
    var ws = this;
    var wrapped = function (event) {
      if (!hook.taken) {
        hook.incoming.push({ data: event.data });
      }
      if (typeof listener === 'function') {
        listener.call(ws, event);
      } else if (listener && listener.handleEvent) {
        listener.handleEvent(event);
      }
    };
    return hook.originalAddEventListener.call(this, type, wrapped, options);
  };
  window.__earlyWsHook = hook;
})();
`;

export default defineConfig({
  server: {
    open: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    preact(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: '摸鱼助手 (Moyu Helper)',
        namespace: 'https://github.com/NanGuaChui/moyu-helper',
        version: pkg.version,
        description: '摸鱼放置游戏自动化辅助脚本 - 任务管理、智能制造、资源监控、技能树优化',
        author: 'NanGuaChui',
        match: ['https://www.moyu-idle.com/*', 'https://moyu-idle.com/*'],
        'run-at': 'document-start',
        updateURL: 'https://github.com/NanGuaChui/moyu-helper/releases/latest/download/moyu-helper.user.js',
        downloadURL: 'https://github.com/NanGuaChui/moyu-helper/releases/latest/download/moyu-helper.user.js',
        grant: ['unsafeWindow', 'GM.getValue', 'GM.setValue', 'GM_addStyle'],
      },
      generate: ({ userscript, mode }) => {
        // 仅在开发模式下注入同步 WebSocket 拦截脚本
        if (mode === 'serve') {
          return userscript + '\n' + earlyWsHookScript;
        }
        return userscript;
      },
      server: {
        mountGmApi: true,
      },
    }),
  ],
  build: {
    minify: 'esbuild',
    target: 'es2015',
  },
});
