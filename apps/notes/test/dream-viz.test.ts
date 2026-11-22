import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AskSection, newReadingNote, parseReadingNote, upsertSection, withDerived } from '@cn/format'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Ask, runDream, takeItem } from '../src/main/dream'
import { stuckSpots, todaysSections } from '../src/main/dream-viz'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'

const sec = (page: number, title: string, rounds: number, failed: number, extra: Partial<AskSection> = {}): AskSection => ({
  id: `.canvas-notes/对话/第3讲 线性映射-p${page}-1.md`,
  file: PDF,
  page,
  title,
  time: '10:20',
  figures: [],
  doubts: ['整块没看懂'],
  good: '先看图再看公式。',
  points: ['列就是基向量去哪'],
  failed: Array.from({ length: failed }, (_, i) => ({ version: i + 1, line: `第 ${i + 1} 版套公式`, text: '……' })),
  rounds,
  links: [],
  ...extra,
})

let base: string
let root: string
const prompts: string[] = []
const ask: Ask = async (_s, prompt) => {
  prompts.push(prompt)
  if (prompt.startsWith('命令：梦游可视化')) {
    const page = /第 (\d+) 页/.exec(prompt)![1]
    return `好的\n\`\`\`html\n<!doctype html><html><head><title>第 ${page} 页 · 拖一拖</title></head><body><input type="range"></body></html>\n\`\`\``
  }
  if (prompt.startsWith('命令：本周小结')) return ''
  throw new Error('没想到的提问：' + prompt.slice(0, 20))
}

function commitNote(sections: AskSection[], subject: string, date?: string) {
  let md = existsSync(join(root, NOTE)) ? readFileSync(join(root, NOTE), 'utf8') : newReadingNote(PDF, new Date(2026, 10, 16))
  for (const s of sections) md = upsertSection(md, s, NOTE)
  mkdirSync(dirname(join(root, NOTE)), { recursive: true })
  writeFileSync(join(root, NOTE), md)
  g(root, 'add', '-A')
  execFileSync('git', ['-C', root, 'commit', '-qm', subject], { env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) } })
}

beforeEach(() => {
  prompts.length = 0
  base = mkdtempSync(join(tmpdir(), 'cn-dreamviz-'))
  root = join(base, '库')
  mkdirSync(root)
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
  mkdirSync(join(root, '课程/线性代数'), { recursive: true })
  writeFileSync(join(root, PDF), '%PDF-1.4 假的\n')
  // 上周问的那处：卡得最久，但不是今天
  commitNote([sec(2, '定义两条缺一不可', 6, 2)], '笔记：第3讲 线性映射 第 2 页 · 定义两条缺一不可', '2026-11-01T10:00:00')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('梦游做可视化', { timeout: 30_000 }, () => {
  it('挑今天卡得最久的：今天记过、追问过或换过讲法、还没有可视化的，按轮数和没讲通的次数排', () => {
    const t = new Map<string, string>()
    let md = newReadingNote(PDF)
    for (const s of [sec(4, '列是基向量去哪', 2, 0), sec(5, '旋转矩阵每个数从哪来', 3, 2), sec(6, '一问就懂', 1, 0), sec(7, '已经有了', 4, 1, { viz: { path: 'x.html', title: 'x' } })]) md = upsertSection(md, s, NOTE)
    t.set(NOTE, md)
    const today = todaysSections(['笔记：第3讲 线性映射 第 4 页 · 列是基向量去哪', '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来', '笔记：第3讲 线性映射 第 6 页 · 一问就懂', '笔记：第3讲 线性映射 第 7 页 · 已经有了', '送进 Anki：线性代数 3 张'])
    expect(today).toHaveLength(4)
    const spots = stuckSpots(t, today)
    expect(spots.map((s) => s.section.page)).toEqual([5, 4])
    expect(spots[0]!.pdf).toBe(PDF)
    expect(stuckSpots(t, today, 1)).toHaveLength(1)
  })

  it('在 dream 分支上一处一个提交：HTML 进课程文件夹、挂到笔记那一段；工作目录不动；收下才进来', async () => {
    commitNote([sec(4, '列是基向量去哪', 2, 0), sec(5, '旋转矩阵每个数从哪来', 3, 1), sec(6, '一问就懂', 1, 0)], '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来')
    g(root, 'commit', '--allow-empty', '-qm', '笔记：第3讲 线性映射 第 4 页 · 列是基向量去哪')
    g(root, 'commit', '--allow-empty', '-qm', '笔记：第3讲 线性映射 第 6 页 · 一问就懂')
    const before = readFileSync(join(root, NOTE), 'utf8')
    const r = await runDream({ root, scratch: join(base, 'scratch'), ask, trigger: 'manual', now: new Date(), by: 'Claude Code · Haiku' })
    const viz = r.items.filter((i) => i.group === 'viz')
    // CN-54：报告这一条和 HTML 里都写着是哪家哪个模型做的
    expect(viz[0]!.by).toBe('Claude Code · Haiku')
    expect(viz.map((i) => i.title)).toEqual(['第 5 页 · 拖一拖', '第 4 页 · 拖一拖'])
    expect(viz[0]!.files).toEqual(['课程/线性代数/第 5 页.html', NOTE])
    expect(viz[0]!.sub).toBe('新文件 课程/线性代数/第 5 页.html · 挂到「第3讲 线性映射 笔记」第5页')
    expect(viz[0]!.why).toContain('问了3轮、1次还是不懂')
    expect(r.notes).toEqual([])
    // 给 AI 的话里有疑惑、没讲通的版本、讲通的讲法
    const p5 = prompts.find((p) => p.includes('第 5 页'))!
    expect(p5).toContain('- 整块没看懂')
    expect(p5).toContain('- 第 1 版：第 1 版套公式')
    expect(p5).toContain('最后讲通的讲法：先看图再看公式。')
    // 工作目录没动
    expect(readFileSync(join(root, NOTE), 'utf8')).toBe(before)
    expect(existsSync(join(root, '课程/线性代数/第 5 页.html'))).toBe(false)
    // 分支上：HTML 带属性，笔记那段末尾嵌进可视化（task-m552v：单独一段嵌入），别的段不动
    const html = g(root, 'show', `${r.branch}:课程/线性代数/第 5 页.html`)
    expect(html).toContain('<meta name="类型" content="可视化">')
    expect(html).toContain('<meta name="第几讲" content="3">')
    expect(html).toContain('<meta name="做的" content="梦游">')
    expect(html).toContain('<meta name="模型" content="Claude Code · Haiku">')
    const onBranch = parseReadingNote(g(root, 'show', `${r.branch}:${NOTE}`), NOTE)
    expect(onBranch.find((s) => s.page === 5)!.viz).toEqual({ path: '课程/线性代数/第 5 页.html', title: '第 5 页 · 拖一拖', embed: true })
    expect(g(root, 'show', `${r.branch}:${NOTE}`)).toContain('\n\n![可视化 · 第 5 页 · 拖一拖](第%205%20页.html)\n')
    expect(onBranch.find((s) => s.page === 6)!.viz).toBeUndefined()
    expect(onBranch.find((s) => s.page === 2)!.viz).toBeUndefined()
    // 收下第一处：进到 main
    await takeItem(root, r, viz[0]!.id)
    expect(existsSync(join(root, '课程/线性代数/第 5 页.html'))).toBe(true)
    expect(parseReadingNote(readFileSync(join(root, NOTE), 'utf8'), NOTE).find((s) => s.page === 5)!.viz?.title).toBe('第 5 页 · 拖一拖')
  })

  it('新格式的笔记（一篇长文档）：问了几问、几次「还是不懂」按原话数；给 AI 的话里是问的原话（主问题 + 旁支问题）、这一轮的小结和最后讲的那一版', async () => {
    const doc = withDerived({
      ...sec(8, '泰勒展开', 0, 0, { doubts: [], good: '', points: [] }),
      qas: [
        { q: '给我讲解一下', a: '展开到一阶。', sides: [{ quote: '展开到一阶', turns: [{ q: '为什么只到一阶？', a: '够用。' }] }] },
        { q: '还是不懂', a: '换个方式：看图。', sides: [] },
      ],
      recap: '泰勒展开就是用多项式逼近；旁支问了为什么只到一阶。',
    })
    commitNote([doc], '笔记：第3讲 线性映射 第 8 页 · 泰勒展开')
    const r = await runDream({ root, scratch: join(base, 'scratch'), ask, trigger: 'manual', now: new Date() })
    const viz = r.items.filter((i) => i.group === 'viz')
    expect(viz.map((i) => i.title)).toEqual(['第 8 页 · 拖一拖'])
    expect(viz[0]!.why).toContain('问了3轮、1次还是不懂')
    const p8 = prompts.find((p) => p.startsWith('命令：梦游可视化') && p.includes('第 8 页'))!
    expect(p8).toContain('- 给我讲解一下\n- 为什么只到一阶？\n- 还是不懂')
    expect(p8).toContain('这一轮的小结：泰勒展开就是用多项式逼近；旁支问了为什么只到一阶。')
    expect(p8).toContain('最后讲的那一版：换个方式：看图。')
    expect(p8).not.toContain('没讲通的讲法')
  })

  it('AI 没做出网页：写进报告的备注，别的照常', async () => {
    commitNote([sec(5, '旋转矩阵每个数从哪来', 3, 1)], '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来')
    const r = await runDream({ root, scratch: join(base, 'scratch'), ask: async (s, p) => (p.startsWith('命令：梦游可视化') ? '做不了' : ask(s, p)), trigger: 'manual', now: new Date() })
    expect(r.items.filter((i) => i.group === 'viz')).toEqual([])
    expect(r.notes).toEqual(['第5页「旋转矩阵每个数从哪来」的可视化没做成：AI 没做出能打开的网页'])
  })
})
