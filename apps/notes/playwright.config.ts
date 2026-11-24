import { defineConfig } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 用系统剪贴板的测试：真按 ⌘C ⌘X ⌘V、读写 clipboard、点「拷贝…」。一台 Mac 只有一个剪贴板，
 * --workers=2 时两条同时拷贝、粘贴会互相盖掉（贴进去的是另一条测试拷的东西）。照文件内容认出来，单放一组、一条一条跑；
 * 这一组的测试开软件时先存下本机剪贴板里原来的，关软件前还回去（e2e/app.ts launch）。
 * 只发一个 paste 事件（new ClipboardEvent）的不碰剪贴板，不算
 */
const USES_CLIPBOARD = /Meta\+(Key)?[CVXcvx]['"]|(?<![A-Za-z])clipboard(?!Data)|setClipboard|clipboardText|['"/^]拷贝/
const E2E = join(__dirname, 'e2e')
const clipboard = readdirSync(E2E)
  .filter((f) => f.endsWith('.spec.ts') && USES_CLIPBOARD.test(readFileSync(join(E2E, f), 'utf8')))
  .map((f) => `**/${f}`)

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  projects: [
    { name: 'clipboard', testMatch: clipboard, workers: 1 },
    { name: 'main', testIgnore: clipboard },
  ],
})
