// 老库整理一次（2026-11-20「一个 PDF 一篇笔记」，task-9okg5）：「我的疑惑」「视频里的疑惑」不再是文件，同一份 PDF 两篇笔记合成一篇；
// 一次提交，撤回能回去，整理过的库不再整理
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AskSection, doubtsNote, newReadingNote, parseReadingNote, upsertSection, withDerived } from '@cn/format'
import { collectDoubts } from '../src/main/reading/doubts'
import { TIDY_FILE, tidyNotes, undoTidy } from '../src/main/tidy-notes'
import { Vault } from '../src/main/vault'

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const put = (root: string, p: string, t: string) => {
  mkdirSync(dirname(join(root, p)), { recursive: true })
  writeFileSync(join(root, p), t)
}
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const commit = (root: string, msg: string) => {
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', msg)
}
function newVault() {
  const base = mkdtempSync(join(tmpdir(), 'cn-tidy-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  return root
}

const sec = (pdf: string, page: number, qs: string[], name = 'L4'): AskSection =>
  withDerived({
    id: `.canvas-notes/对话/${name}-p${page}-1.md`,
    file: pdf,
    page,
    title: `第 ${page} 页的小标题`,
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: qs.map((q) => ({ q, a: `${q}的回答。`, sides: [] })),
    recap: `第 ${page} 页的小结`,
  })

describe('老库整理一次', () => {
  it('没动过的生成版「我的疑惑」「视频里的疑惑」删掉，改过的改名留下，自己起名叫「我的疑惑」的不碰；同一份 PDF 两篇笔记按段合成一篇、自己写的放最后；一次提交，再开不再整理；撤回全回来', async () => {
    const root = newVault()
    const pdf = '课程/机器学习/第4讲 卷积网络.pdf'
    const note = '课程/机器学习/第4讲 卷积网络 笔记.md'
    const note2 = '课程/机器学习/第4讲 卷积网络 笔记 2.md'
    put(root, pdf, '%PDF')
    put(root, note, upsertSection(newReadingNote(pdf), sec(pdf, 3, ['问三']), note))
    put(root, note2, upsertSection(upsertSection(newReadingNote(pdf), sec(pdf, 3, ['问三', '还是不懂']), note2), sec(pdf, 7, ['问七']), note2) + '\n## 我自己的总结\n\n卷积就是滑动的加权和。\n')
    put(root, '课程/机器学习/第5讲 注意力.pdf', '%PDF')
    put(root, '课程/机器学习/第5讲 注意力 笔记.md', upsertSection(newReadingNote('课程/机器学习/第5讲 注意力.pdf'), sec('课程/机器学习/第5讲 注意力.pdf', 2, ['问二'], 'L5'), '课程/机器学习/第5讲 注意力 笔记.md'))
    // 软件写的「我的疑惑」：和按笔记重新算的一样
    const v = new Vault(root)
    const fresh = doubtsNote('课程/机器学习', '机器学习', await collectDoubts(v, '课程/机器学习'), new Set())
    put(root, '课程/机器学习/我的疑惑.md', fresh)
    // 软件写的「视频里的疑惑」，最后一次是软件提交的
    put(root, '课程/机器学习/视频里的疑惑.md', '---\n类型: 视频里的疑惑\n生成: 软件\n---\n\n# 视频里的疑惑\n\n## 00:06 · 卷积\n> 为什么要池化？\n')
    // 另一门课：软件写的、用户后来自己改过（改过的那次是自动提交）
    put(root, '课程/线代/第1讲.pdf', '%PDF')
    put(root, '课程/线代/我的疑惑.md', '---\n类型: 我的疑惑\n生成: 软件\n---\n# 我的疑惑\n\n- **旧的一条** [第 1 页](第1讲.pdf#page=1)\n')
    // 自己起名叫「我的疑惑」的（没有「生成: 软件」）：不碰
    put(root, '写作/我的疑惑.md', '# 我的疑惑\n\n自己写的。\n')
    commit(root, '笔记：第4讲 卷积网络 第 3 页 · 第 3 页的小标题')
    put(root, '课程/线代/我的疑惑.md', read(root, '课程/线代/我的疑惑.md') + '\n我自己加的一句：考前看第 1 页。\n')
    commit(root, '改了《我的疑惑》')
    const before = g(root, 'rev-parse', 'HEAD').trim()
    const orig = Object.fromEntries([note, note2, '课程/机器学习/我的疑惑.md', '课程/机器学习/视频里的疑惑.md', '课程/线代/我的疑惑.md'].map((p) => [p, read(root, p)]))

    const t = (await tidyNotes(v))!
    expect(t).not.toBeNull()
    // 一次提交，说明就是底栏那一句
    expect(g(root, 'rev-list', '--count', `${before}..HEAD`).trim()).toBe('1')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe(`整理：${t.said}`)
    expect(t.said).toBe('「我的疑惑」「视频里的疑惑」改在课程首页看，改过的「我的疑惑」改名留着，两篇《第4讲 卷积网络 笔记》并成一篇')
    expect(g(root, 'status', '--porcelain').trim()).toBe('')
    // 没动过的删掉；改过的改名留下；自己起名的不碰
    expect(existsSync(join(root, '课程/机器学习/我的疑惑.md'))).toBe(false)
    expect(existsSync(join(root, '课程/机器学习/视频里的疑惑.md'))).toBe(false)
    expect(existsSync(join(root, '课程/线代/我的疑惑.md'))).toBe(false)
    expect(read(root, '课程/线代/我的疑惑（我改过的）.md')).toBe(orig['课程/线代/我的疑惑.md'])
    expect(read(root, '写作/我的疑惑.md')).toBe('# 我的疑惑\n\n自己写的。\n')
    // 两篇合成一篇：第 3 页留问得多的、旧的收进「以前的版本」，第 7 页并进来，自己写的放最后；第二篇收掉
    expect(existsSync(join(root, note2))).toBe(false)
    const md = read(root, note)
    expect(parseReadingNote(md, note).map((s) => [s.page, s.rounds])).toEqual([
      [3, 2],
      [7, 1],
    ])
    expect(md).toContain('## 以前的版本 · 第 3 页 · 第 3 页的小标题')
    expect(md.slice(md.indexOf('## 从《第4讲 卷积网络 笔记 2》并进来的'))).toContain('### 我自己的总结\n\n卷积就是滑动的加权和。')
    // 别的笔记不动
    expect(parseReadingNote(read(root, '课程/机器学习/第5讲 注意力 笔记.md'), '').length).toBe(1)
    // 库里记着整理过了；再开不再整理
    expect(JSON.parse(read(root, TIDY_FILE))).toHaveProperty('一个PDF一篇笔记')
    expect(await tidyNotes(v)).toBeNull()

    // 撤回：五篇回到整理之前的样子；记号留着，再开也不再整理
    const said = await undoTidy(v, t)
    expect(said).toBe('撤回了这次整理：「我的疑惑.md」「视频里的疑惑.md」和《第4讲 卷积网络 笔记 2》回来了')
    for (const [p, text] of Object.entries(orig)) expect(read(root, p)).toBe(text)
    expect(existsSync(join(root, '课程/线代/我的疑惑（我改过的）.md'))).toBe(false)
    expect(g(root, 'status', '--porcelain').trim()).toBe('')
    expect(existsSync(join(root, TIDY_FILE))).toBe(true)
    expect(await tidyNotes(v)).toBeNull()
  })

  it('没有要整理的（新库、整理过的）：什么都不做、不提交、不写记号', async () => {
    const root = newVault()
    put(root, '课程/x/a.pdf', '%PDF')
    put(root, '课程/x/a 笔记.md', '# a 笔记\n')
    commit(root, '样本')
    const head = g(root, 'rev-parse', 'HEAD').trim()
    expect(await tidyNotes(new Vault(root))).toBeNull()
    expect(g(root, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(existsSync(join(root, TIDY_FILE))).toBe(false)
  })

  it('只有「X 笔记 2」没有「X 笔记」：改名成「X 笔记.md」；段落链着这份 PDF 的别的笔记也算同一份；不在一个文件夹的不算', async () => {
    const root = newVault()
    const pdf = '课程/x/讲义.pdf'
    put(root, pdf, '%PDF')
    put(root, '课程/x/讲义 笔记 2.md', upsertSection(newReadingNote(pdf), sec(pdf, 2, ['问二'], '讲义'), '课程/x/讲义 笔记 2.md'))
    put(root, '课程/x/读讲义时记的.md', upsertSection('# 读讲义时记的\n', sec(pdf, 4, ['问四'], '讲义'), '课程/x/读讲义时记的.md'))
    put(root, '课程/y/讲义 笔记.md', '# 别的文件夹里的\n')
    commit(root, '样本')
    const t = (await tidyNotes(new Vault(root)))!
    expect(t.said).toBe('两篇《讲义 笔记》并成一篇')
    expect(existsSync(join(root, '课程/x/讲义 笔记 2.md'))).toBe(false)
    expect(existsSync(join(root, '课程/x/读讲义时记的.md'))).toBe(false)
    expect(parseReadingNote(read(root, '课程/x/讲义 笔记.md'), '课程/x/讲义 笔记.md').map((s) => s.page)).toEqual([2, 4])
    expect(read(root, '课程/y/讲义 笔记.md')).toBe('# 别的文件夹里的\n')
  })
})
