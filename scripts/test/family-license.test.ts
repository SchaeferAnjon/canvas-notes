import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 同一个仓库里的几个软件（画布笔记、画布今日、ParaRead）和共用包许可证一样，都是 GPL-3.0-or-later（2026-11-23 用户定 ParaRead 从 GPL-3.0-only 改过来）：
// 共用包里的代码两边都引，哪边是 only，另一边整体就只能按 GPL 第 3 版发
const ROOT = join(__dirname, '../..')
const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'))

it('画布笔记、画布今日、ParaRead 的 brand.json 和 package.json 许可证一样', () => {
  const license = json('release/brand.json').license
  expect(license).toBe('GPL-3.0-or-later')
  for (const f of ['apps/today/brand.json', 'apps/pararead/brand.json', 'package.json', 'apps/today/package.json', 'apps/pararead/package.json']) expect(json(f).license, f).toBe(license)
})

it('共用包写了许可证的都是同一个', () => {
  for (const p of ['format', 'design', 'family', 'tasks', 'calendar', 'git', 'ai-engines', 'ai-chat', 'editor']) {
    const l = json(`packages/${p}/package.json`).license
    if (l !== undefined) expect(l, p).toBe('GPL-3.0-or-later')
  }
})

it('ParaRead 的 LICENSE 和根上的是同一份 GPL 第 3 版原文', () => {
  expect(readFileSync(join(ROOT, 'apps/pararead/LICENSE'), 'utf8')).toBe(readFileSync(join(ROOT, 'LICENSE'), 'utf8'))
})
