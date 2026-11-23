/**
 * 打包出来的主窗口只挂两份 CSS：共用的 skin（主窗口和速记小窗都用）和 index（task-xfngz）。
 * 渲染进程里一处动态 import('…') 会让打包多拆出共用块，它们的 CSS 排在 index.css 前面，
 * app.css 里同样具体的规则先后就翻了（800164af 起旁支按钮行间距 8 变 14）。要懒载入的东西改用 note-doc-ref.ts 那种登记的办法。
 * 先 electron-vite build，读 out/renderer/index.html。
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('主窗口只挂 skin、index 两份 CSS，先 skin 后 index', () => {
  const html = readFileSync(join(__dirname, '../out/renderer/index.html'), 'utf8')
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/assets\/([a-z-]+)-[\w-]+\.css"/g)].map((m) => m[1])
  expect(css).toEqual(['skin', 'index'])
})
