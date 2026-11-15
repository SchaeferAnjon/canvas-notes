import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

// 依赖大都写在 devDependencies，全部打进包里；workspace 里的 @cn/* 是 TS 源码，也要打包。
// 写在 dependencies 里的（electron-chrome-extensions）不打进 main 的 bundle，原样放进包里的 node_modules
export default defineConfig({
  main: { build: { externalizeDeps: true } },
  preload: {
    // 网页预加载里有 DOM，用 turndown 的浏览器版（不带 Node 的 HTML 解析器）
    resolve: { alias: [{ find: /^turndown$/, replacement: 'turndown/lib/turndown.browser.es.js' }] },
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: 'src/preload/index.ts', webview: 'src/preload/webview.ts', quick: 'src/preload/quick.ts' } },
    },
  },
  renderer: {
    plugins: [react()],
    // 主窗口和全局速记小窗
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), quick: resolve(__dirname, 'src/renderer/quick.html') } } },
  },
})
