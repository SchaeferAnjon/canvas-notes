import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// pdf.js 画中文 PDF 要的字形表、标准字体：从包里拷进界面的 public/pdfjs/（不进 git，构建时拷）
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const dest = resolve(__dirname, 'src/renderer/public/pdfjs', dir)
  if (!existsSync(dest)) cpSync(resolve(__dirname, 'node_modules/pdfjs-dist', dir), dest, { recursive: true })
}

// 依赖大都写在 devDependencies，全部打进包里；workspace 里的 @cn/* 是 TS 源码，也要打包。
// 写在 dependencies 里的（electron-chrome-extensions）不打进 main 的 bundle，原样放进包里的 node_modules
export default defineConfig({
  // 搜索进程、找像的笔记的进程（utilityProcess）各单独一个入口；onnxruntime-node、pdfjs-dist 写在 dependencies，不打进 bundle，原样放进包里
  main: { build: { externalizeDeps: true, rollupOptions: { input: { index: 'src/main/index.ts', 'search-worker': 'src/main/search/worker.ts', 'similar-worker': 'src/main/similar/worker.ts' } } } },
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
