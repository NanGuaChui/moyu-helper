import { defineConfig, Plugin } from 'vite';
import monkey from 'vite-plugin-monkey';
import preact from '@preact/preset-vite';
import path from 'path';
import pkg from './package.json';

// WebSocket 拦截器代码（会被内联到脚本头部）
const WS_INTERCEPTOR_CODE = `
(function(){
  var sockets=[];
  var O=window.WebSocket;
  window.WebSocket=function(u,p){var ws=new O(u,p);sockets.push(ws);window.__capturedSockets=sockets;window.__latestSocket=ws;return ws};
  window.WebSocket.prototype=O.prototype;
  window.WebSocket.CONNECTING=O.CONNECTING;
  window.WebSocket.OPEN=O.OPEN;
  window.WebSocket.CLOSING=O.CLOSING;
  window.WebSocket.CLOSED=O.CLOSED;
  window.__OriginalWebSocket=O;
})();
`;

// 自定义插件：在打包后注入 WebSocket 拦截器到脚本头部
function injectWsInterceptor(): Plugin {
  return {
    name: 'inject-ws-interceptor',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const fileName in bundle) {
        if (fileName.endsWith('.user.js')) {
          const chunk = bundle[fileName];
          if (chunk.type === 'chunk') {
            // 找到 ==UserScript== 块的结束位置
            const headerEnd = chunk.code.indexOf('==/UserScript==');
            if (headerEnd !== -1) {
              const insertPos = chunk.code.indexOf('\n', headerEnd) + 1;
              chunk.code =
                chunk.code.slice(0, insertPos) +
                WS_INTERCEPTOR_CODE +
                chunk.code.slice(insertPos);
            }
          }
        }
      }
    },
  };
}

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
      server: {
        mountGmApi: true,
      },
    }),
    injectWsInterceptor(),
  ],
  build: {
    minify: 'esbuild',
    target: 'es2015',
  },
});
