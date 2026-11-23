// 梦游补双链不再靠一个常见词乱连（task-eler2）：用户报的「中国用户怎么用上 Claude ↔ Geography of Iceland，两篇都讲到『the second』」，
// 还有「第三方」「特朗普…」两条；样例是合成的（eval/dream-links/cases.ts，pnpm eval:dream 报准确率）
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUPS, LINKS, LOOSE, P, VAULT } from '../eval/dream-links/cases'
import { type Ask, runDream } from '../src/main/dream'
import { duplicatesOf, type LinkCand, linkCandidates, linkWhy } from '../src/main/duplicates'

const texts = Object.entries(VAULT)
const cands = linkCandidates(texts, LOOSE)
const linked = (a: string, b: string): LinkCand | undefined => cands.find((c) => (c.p === a && c.to === b) || (c.p === b && c.to === a))

describe('梦游补双链：要讲同一件事才连', () => {
  it.each(LINKS.filter((l) => !l.yes).map((l) => [l.why, l] as const))('不连：%s', (_why, l) => {
    expect(linked(l.a, l.b)).toBeUndefined()
  })

  it('真相关的照样连，理由是两篇共同的关键词（同一件事、同一个人、同一个概念）', () => {
    const want: [string, string, string][] = [
      [P.claudeVideo, P.claudeBan, '海外手机号'],
      [P.trump, P.tariff, '稀土出口管制'],
      [P.spaced, P.makeItStick, '遗忘曲线'],
      [P.auroraInbox, P.auroraMine, '云量低于三成'],
      [P.feynmanTech, P.feynmanBook, 'Feynman'],
    ]
    for (const [a, b, term] of want) {
      const c = linked(a, b)
      expect(c, `${a} ↔ ${b}`).toBeDefined()
      expect(c!.terms).toContain(term)
      expect(c!.terms.length).toBeGreaterThanOrEqual(3)
    }
    // 样本库里只连这几对（两头各补一次也算一对），别的一条不多
    const pair = (x: string, y: string) => [x, y].sort().join(' ↔ ')
    expect([...new Set(cands.map((c) => pair(c.p, c.to)))].sort()).toEqual(LINKS.filter((l) => l.yes).map((l) => pair(l.a, l.b)).sort())
    // 关键词里没有常见词、序数词
    for (const c of cands) for (const t of c.terms) expect(t).not.toMatch(/^(the|second|first|half|year|第三方|我们|相关|一个)$/i)
    expect(linkWhy(['遗忘曲线', '间隔重复', 'Anki'])).toBe('两篇共同的关键词：遗忘曲线、间隔重复、Anki')
  })

  it('只有一个不常见的词相同也不连（Hekla 火山和叫 Hekla 的猫）', () => {
    const t: [string, string][] = [
      ['收件箱/火山.md', '冰岛的 Hekla 火山一百年里喷发了好几次，山顶常年积雪，徒步要跟向导。'],
      ['收件箱/猫.md', '我家的猫叫 Hekla，今天去打了疫苗，医生说体重偏重，猫粮要减一点。'],
    ]
    expect(linkCandidates(t, ['收件箱/火山.md', '收件箱/猫.md'])).toEqual([])
  })
})

describe('可能重复：去掉停用词再比', () => {
  it.each(DUPS.map((l) => [l.why, l] as const))('%s', (_why, l) => {
    const pairs = duplicatesOf(texts.map(([id, text]) => ({ id, text })))
    const got = pairs.some((d) => (d.a === l.a && d.b === l.b) || (d.a === l.b && d.b === l.a))
    expect(got).toBe(l.yes)
  })
})

describe('梦游一整次（合成样本库）', { timeout: 60_000 }, () => {
  it('报告里补上的双链只有真相关的几条，理由写共同的关键词，不写「都讲到」', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cn-dream-links-'))
    try {
      const root = join(base, '库')
      mkdirSync(root)
      const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
      g('init', '-q', '-b', 'main')
      g('config', 'user.name', 'Test')
      g('config', 'user.email', 'test@example.com')
      for (const [p, t] of texts) {
        mkdirSync(dirname(join(root, p)), { recursive: true })
        writeFileSync(join(root, p), t)
      }
      g('add', '-A')
      g('commit', '-qm', '样本')
      const ask: Ask = async () => ''
      const r = await runDream({ root, scratch: join(base, 'scratch'), ask, trigger: 'manual', now: new Date(2026, 10, 15, 3, 0) })
      const links = r.items.filter((i) => i.group === 'link')
      // 一对只补一头（另一头不再补回来）
      const name = (path: string) => path.replace(/\.md$/, '').split('/').pop()!
      const pair = (x: string, y: string) => [x, y].sort().join(' ↔ ')
      expect(links.map((i) => pair(i.title, i.sub.replace(/^↔ \[\[(.+)\]\]$/, '$1'))).sort()).toEqual(LINKS.filter((l) => l.yes).map((l) => pair(name(l.a), name(l.b))).sort())
      for (const i of links) {
        expect(i.why).toMatch(/^两篇共同的关键词：[^。]+、[^。]+、[^。]+。只在这篇末尾加一行/)
        expect(i.why).not.toContain('都讲到')
      }
      expect(links.some((i) => /Iceland|第三方|未命名/.test(i.title + i.sub))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
