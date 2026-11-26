// 转圈的小图标一圈走几步，不是每一帧都转（2026-11-25 收件箱「打开软件 CPU 直接占满」）：
// 主题渐变在动、面板透着背景（浮岛书桌、面板透明度拉满）时，一帧一转的小圈让整窗的磨砂一秒重算 120 次。
// 实测（M3 Max，测试窗口 1440×900，底栏一个转圈，整个软件）：一帧一转约 1.05 个核，一步步转约 0.45 个核，不转 0.38 个核。
// 这里守着：界面里所有转圈（关键帧只转 rotate 的）都用 steps()
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIR = join(__dirname, '../src/renderer')
const css = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? css(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : []))

it('转圈的动画都一步步转（steps），不一帧一转', () => {
  const files = css(DIR).map((f) => ({ f, s: readFileSync(f, 'utf8') }))
  // 只转一圈的关键帧：@keyframes x { to { transform: rotate(360deg) } }
  const spins = new Set<string>()
  for (const { s } of files) for (const m of s.matchAll(/@keyframes\s+([\w-]+)\s*\{\s*(?:from\s*\{[^}]*\}\s*)?to\s*\{\s*transform:\s*rotate\(360deg\);?\s*\}\s*\}/g)) spins.add(m[1]!)
  expect([...spins].sort()).toEqual(['aiset-spin', 'spin'])
  const bad: string[] = []
  for (const { f, s } of files)
    for (const m of s.matchAll(/animation:\s*([\w-]+)\s+[^;]*;/g)) if (spins.has(m[1]!) && !/steps\(/.test(m[0])) bad.push(`${f.slice(DIR.length + 1)}：${m[0]}`)
  expect(bad).toEqual([])
  // .spin 只定义一处（以前 app.css、shell/shell.css 各一份，快慢不一，谁后载入谁算）
  expect(files.filter(({ s }) => /^\.spin\s*\{/m.test(s)).map(({ f }) => f.slice(DIR.length + 1))).toEqual(['app.css'])
})
