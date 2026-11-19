// 对比标签要的两版全文（CN-47 / 48 / 55 / 63）：git show 读两版，挪走、删了也能看；改了什么写成一句人话
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffOf, parseNameStatus } from '../src/main/diff'
import { parseHunks, summarize } from '../src/shared/diff'
import { solidPng } from '../e2e/fixtures/png'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

let root: string
const put = (p: string, t: string | Uint8Array) => {
  mkdirSync(dirname(join(root, p)), { recursive: true })
  writeFileSync(join(root, p), t)
}
const commit = (m: string) => {
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', m)
  return g(root, 'rev-parse', 'HEAD').trim()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-diff-'))
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const NOTE = ['# Lecture05 笔记', '', ...Array.from({ length: 30 }, (_, i) => `## 第 ${i + 1} 页\n\n第 ${i + 1} 页讲的东西。\n`)].join('\n')

describe('一次提交的两版', () => {
  it('第一次提交（没有父提交）：每个文件都是新建，md 有全文，名字写成「新建《…》」', async () => {
    put('a.md', '# a\n\n一句。\n')
    const h = commit('样本')
    const r = await diffOf(root, { kind: 'commit', hash: h }, null)
    expect(r.left).toBe('改之前 · 没有')
    expect(r.right).toBe(`这次提交后 · ${h.slice(0, 7)}`)
    expect(r.note).toMatch(/^今天 \d\d:\d\d · 样本$/)
    expect(r.files).toEqual([expect.objectContaining({ path: 'a.md', status: 'new', kind: 'md', before: null, after: '# a\n\n一句。\n', summary: '新建「a」', exists: true, added: 3, removed: 0 })])
  })

  it('一次改了几个文件：md 两版全文（不截成片段、没有行数上限），新建的 HTML 写大小，图片是 data: 地址', async () => {
    put('课程/ecp/Lecture05 笔记.md', NOTE)
    commit('样本')
    const big = NOTE.replace('第 10 页讲的东西。', '第 10 页讲的东西。\n[可视化 · 高维准正交](高维准正交.html)')
    put('课程/ecp/Lecture05 笔记.md', big)
    put('课程/ecp/高维准正交.html', '<!doctype html><title>高维准正交</title>' + '<p>x</p>\n'.repeat(500))
    put('附件/图.png', solidPng(4, 4, [1, 2, 3]))
    const h = commit('可视化：高维准正交')
    const r = await diffOf(root, { kind: 'commit', hash: h }, null)
    const md = r.files.find((f) => f.kind === 'md')!
    expect(md).toMatchObject({ status: 'changed', before: NOTE, after: big, added: 1, removed: 0, summary: '「第 10 页」那段加了链接「可视化 · 高维准正交」' })
    const html = r.files.find((f) => f.kind === 'html')!
    expect(html.status).toBe('new')
    expect(html.summary).toMatch(/^新建「高维准正交.html」· \d+ KB$/)
    expect(html.after!.split('\n').length).toBeGreaterThan(400)
    expect(r.files.find((f) => f.kind === 'image')!.after).toMatch(/^data:image\/png;base64,/)
  })

  it('文件后来挪走、删了：那次提交照样读得到两版，exists 是 false；「看这一版」给那次提交时的全文', async () => {
    put('收件箱/雷克雅未克.md', '# 剪藏整页：雷克雅未克\n\n第一行。\n')
    const h = commit('剪藏整页：雷克雅未克')
    mkdirSync(join(root, '剪藏/旅行'), { recursive: true })
    renameSync(join(root, '收件箱/雷克雅未克.md'), join(root, '剪藏/旅行/雷克雅未克.md'))
    commit('挪走')
    const r = await diffOf(root, { kind: 'commit', hash: h }, null)
    expect(r.files).toEqual([expect.objectContaining({ path: '收件箱/雷克雅未克.md', after: '# 剪藏整页：雷克雅未克\n\n第一行。\n', exists: false })])
    const v = await diffOf(root, { kind: 'version', hash: h, path: '收件箱/雷克雅未克.md' }, null)
    expect(v.files[0]).toMatchObject({ after: '# 剪藏整页：雷克雅未克\n\n第一行。\n', exists: false })
    expect(v.files[0]!.summary).toMatch(new RegExp(`^${h.slice(0, 7)} 那次提交时的样子 · \\d+ B$`))
    await expect(diffOf(root, { kind: 'version', hash: h, path: '没有.md' }, null)).rejects.toThrow('那次提交里没有 没有.md')
  })

  it('挪动：写「从 A 挪到 B」，旧路径记在 from', async () => {
    put('收件箱/冰洞.md', '# 冰洞\n\n冬天开放。\n')
    commit('样本')
    mkdirSync(join(root, '剪藏/旅行'), { recursive: true })
    renameSync(join(root, '收件箱/冰洞.md'), join(root, '剪藏/旅行/冰洞.md'))
    const h = commit('挪')
    const r = await diffOf(root, { kind: 'commit', hash: h }, null)
    expect(r.files).toEqual([expect.objectContaining({ path: '剪藏/旅行/冰洞.md', from: '收件箱/冰洞.md', status: 'moved', summary: '从 收件箱 挪到 剪藏/旅行', exists: true })])
  })

  it('两篇并排（可能重复）：左右是两个文件', async () => {
    put('a.md', '# a\n\n一样的。\n')
    put('b.md', '# b\n\n一样的。\n多一行。\n')
    commit('样本')
    const r = await diffOf(root, { kind: 'pair', a: 'a.md', b: 'b.md' }, null)
    expect(r).toMatchObject({ left: 'a.md', right: 'b.md' })
    expect(r.files[0]).toMatchObject({ path: 'b.md', from: 'a.md', before: '# a\n\n一样的。\n', after: '# b\n\n一样的。\n多一行。\n' })
  })

  it('还没提交的改动：上次提交的和现在磁盘上的，改了的、新建还没进 Git 的都在', async () => {
    put('a.md', '# a\n\n一句。\n')
    const h = commit('样本')
    put('a.md', '# a\n\n一句。\n刚打的字。\n')
    put('新的.md', '# 新的\n')
    const r = await diffOf(root, { kind: 'working' }, null)
    expect(r).toMatchObject({ note: '还没提交的改动 · 2处', left: `上次提交 · ${h.slice(0, 7)}`, right: '现在 · 还没提交' })
    expect(r.files).toEqual([
      expect.objectContaining({ path: 'a.md', status: 'changed', before: '# a\n\n一句。\n', after: '# a\n\n一句。\n刚打的字。\n', added: 1, removed: 0 }),
      expect.objectContaining({ path: '新的.md', status: 'new', before: null, after: '# 新的\n', added: 1 }),
    ])
    // 都提交了：标签头上写「都提交了」，不再写「0处」
    commit('都提交')
    expect(await diffOf(root, { kind: 'working' }, null)).toMatchObject({ note: '都提交了', files: [] })
  })
})

describe('改了什么的一句人话', () => {
  const e = (status: 'changed' | 'new' | 'deleted' | 'moved', path = 'x/笔记.md', from?: string) => ({ path, status, kind: path.endsWith('.md') ? ('md' as const) : ('html' as const), size: 18 * 1024, ...(from ? { from } : {}) })
  const one = (before: string, after: string) => {
    put('t/a.md', before)
    put('t/b.md', after)
    return [...parseHunks(execFileSync('git', ['diff', '--no-index', '-U0', 't/a.md', 't/b.md'], { cwd: root, encoding: 'utf8' }).toString()).values()][0] ?? []
  }
  const run = (before: string, after: string) => {
    try {
      return one(before, after)
    } catch (err) {
      // 不一样时 git 退出码是 1
      return [...parseHunks(String((err as { stdout: string }).stdout)).values()][0]!
    }
  }
  it('新建、删、HTML 带大小', () => {
    expect(summarize(e('new'), [], 'x')).toBe('新建「笔记」')
    expect(summarize(e('deleted'), [], null)).toBe('删了「笔记」')
    expect(summarize(e('new', '课程/加速器.html'), [], null)).toBe('新建「加速器.html」· 18 KB')
  })
  it('末尾加一行；某段加一行；加链接；加几行；改某段；删某段', () => {
    const base = '# 标题\n\n## 第 5 页\n\n一句。\n\n## 第 6 页\n\n两句。\n'
    expect(summarize(e('changed'), run(base, base + '\n相关：[[极光预报]]\n'), base + '\n相关：[[极光预报]]\n')).toBe('末尾加了链接「极光预报」')
    const mid = base.replace('一句。', '一句。\n再一句。')
    expect(summarize(e('changed'), run(base, mid), mid)).toBe('「第 5 页」那段加了一行「再一句。」')
    expect(summarize(e('changed'), run(base, base + '\n最后一句。\n'), base + '\n最后一句。\n')).toBe('末尾加了一行「最后一句。」')
    const links = base.replace('一句。', '一句。\n看 [[高维准正交]]\n和这个。')
    expect(summarize(e('changed'), run(base, links), links)).toBe('「第 5 页」那段加了链接「高维准正交」')
    const many = base.replace('一句。', '一句。\n二。\n三。')
    expect(summarize(e('changed'), run(base, many), many)).toBe('「第 5 页」那段加了2行')
    const edit = base.replace('两句。', '改过的两句。')
    expect(summarize(e('changed'), run(base, edit), edit)).toBe('改了「第 6 页」那段')
    const del = base.replace('## 第 6 页\n\n两句。\n', '')
    expect(summarize(e('changed'), run(base, del), del)).toBe('删了「第 6 页」那段')
  })
  it('git diff --name-status -z：新建、改、删、挪', () => {
    expect(parseNameStatus('A\0a.md\0M\0b.md\0D\0c.md\0R100\0收件箱/x.md\0剪藏/x.md\0')).toEqual([
      { status: 'new', path: 'a.md' },
      { status: 'changed', path: 'b.md' },
      { status: 'deleted', path: 'c.md' },
      { status: 'moved', path: '剪藏/x.md', from: '收件箱/x.md' },
    ])
  })
})
