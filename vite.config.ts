import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import preact from '@preact/preset-vite';
import path from 'path';
import pkg from './package.json';

// WebSocket 拦截器代码（会被内联到脚本头部，在 document-start 时执行）
const WS_INTERCEPTOR_CODE = `
(function() {
  'use strict';

  const sockets = [];
  const Original = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    const ws = new Original(url, protocols);
    sockets.push(ws);
    window.__capturedSockets = sockets;
    window.__latestSocket = ws;
    console.log('[WS拦截器] 捕获:', url);
    return ws;
  };

  window.WebSocket.prototype = Original.prototype;
  window.WebSocket.CONNECTING = Original.CONNECTING;
  window.WebSocket.OPEN = Original.OPEN;
  window.WebSocket.CLOSING = Original.CLOSING;
  window.WebSocket.CLOSED = Original.CLOSED;
  window.__OriginalWebSocket = Original;

  console.log('[WS拦截器] 已就绪');
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
      // 在开发模式下，将 WS 拦截器代码注入到 userscript 注释之后
      generate: ({ userscript, mode }) => {
        if (mode === 'serve') {
          // 开发模式：在 userscript 注释后注入拦截器代码
          return `${userscript}\n${WS_INTERCEPTOR_CODE}\n`;
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
