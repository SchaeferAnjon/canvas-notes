/**
 * 设置 › 梦游（「梦游每样能开关」）：设置的读写和默认值；runDream 在各开关下真的做与不做（临时库 + 假 AI）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AskSection, newReadingNote, upsertSection } from '@cn/format'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Ask, type DreamReportInternal, autoTake, runDream, undo } from '../src/main/dream'
import { SettingsFile } from '../src/main/settings'
import { DEFAULT_DREAM, dreamDoes, type DreamPatch, idleDue, normalizeDream, patchDream } from '../src/shared/dream-settings'
import { DREAM_VAULT } from '../e2e/fixtures/dream'
import { bodyEdits } from '../src/renderer/dream/useDream'
import type { DreamItem } from '../src/shared/api'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

describe('梦游的设置', () => {
  it('旧设置文件没有 dream：全是默认，等于加这一页以前的样子', () => {
    expect(normalizeDream(undefined)).toEqual(DEFAULT_DREAM)
    expect(DEFAULT_DREAM).toEqual({
      auto: true,
      idleMinutes: 15,
      gapHours: 20,
      waitReport: true,
      steps: { file: true, rename: true, link: true, week: true, viz: true, attach: true, dup: true, video: true },
      linkMax: 30,
      vizMax: 3,
      dupMax: 20,
      folders: ['收件箱', '阅读', '剪藏', '周记'],
      autoTake: false,
    })
  })

  it('手改坏的一项一项回到默认；文件夹只认自带的分类、按分类表排', () => {
    const s = normalizeDream({ auto: 'yes', idleMinutes: 7, gapHours: 48, steps: { link: false, viz: 0 }, linkMax: 10, vizMax: 99, folders: ['周记', '课程', '我的私房', '收件箱'], autoTake: true })
    expect(s.auto).toBe(true)
    expect(s.idleMinutes).toBe(15)
    expect(s.gapHours).toBe(48)
    expect(s.steps).toEqual({ ...DEFAULT_DREAM.steps, link: false })
    expect(s.linkMax).toBe(10)
    expect(s.vizMax).toBe(3)
    expect(s.folders).toEqual(['收件箱', '课程', '周记'])
    expect(s.autoTake).toBe(true)
    expect(normalizeDream({ folders: [] }).folders).toEqual([])
  })

  it('改一处只改那一处（开关合进 steps）', () => {
    const s = patchDream(DEFAULT_DREAM, { steps: { link: false } })
    expect(s).toEqual({ ...DEFAULT_DREAM, steps: { ...DEFAULT_DREAM.steps, link: false } })
    expect(patchDream(s, { steps: { viz: false }, idleMinutes: 30 }).steps).toEqual({ ...DEFAULT_DREAM.steps, link: false, viz: false })
  })

  it('设置文件：旧文件读出默认；改了写进同一个文件，别的设置不动；重新读还在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cn-dset-'))
    try {
      const path = join(dir, 'settings.json')
      writeFileSync(path, JSON.stringify({ lastVault: '/tmp/库', autoCommitMinutes: 30, appearance: { frame: 'a' } }))
      const f = new SettingsFile(path)
      expect(f.app().dream).toEqual(DEFAULT_DREAM)
      const next = f.setApp({ dream: { steps: { link: false, viz: false }, autoTake: true } })
      expect(next.dream.steps.link).toBe(false)
      expect(next.autoCommitMinutes).toBe(30)
      const again = new SettingsFile(path)
      expect(again.app().dream).toEqual({ ...DEFAULT_DREAM, steps: { ...DEFAULT_DREAM.steps, link: false, viz: false }, autoTake: true })
      expect(again.read().lastVault).toBe('/tmp/库')
      expect(again.app().appearance.frame).toBe('a')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('闲时梦游：关了自己梦游就不梦游；没人动够久、隔够久、上一份看完了才梦游；不等报告看完时只看隔多久', () => {
    const now = Date.parse('2026-11-20T03:00:00')
    const h = 3600_000
    const s = DEFAULT_DREAM
    const base = { s, idleSec: 16 * 60, now }
    expect(idleDue({ ...base, last: null })).toBe(true)
    expect(idleDue({ ...base, idleSec: 14 * 60, last: null })).toBe(false)
    expect(idleDue({ ...base, s: { ...s, auto: false }, last: null })).toBe(false)
    expect(idleDue({ ...base, last: { closed: true, finished: now - 21 * h } })).toBe(true)
    expect(idleDue({ ...base, last: { closed: true, finished: now - 19 * h } })).toBe(false)
    expect(idleDue({ ...base, last: { closed: false, finished: now - 30 * h } })).toBe(false)
    expect(idleDue({ ...base, s: { ...s, waitReport: false }, last: { closed: false, finished: now - 30 * h } })).toBe(true)
    expect(idleDue({ ...base, s: { ...s, idleMinutes: 30 }, last: null })).toBe(false)
    expect(idleDue({ ...base, s: { ...s, gapHours: 6 }, last: { closed: true, finished: now - 7 * h } })).toBe(true)
    // 测试用环境变量缩短
    expect(idleDue({ ...base, idleSec: 0, idleNeed: 0, gapMs: 0, last: { closed: true, finished: now } })).toBe(true)
  })

  it('正在梦游那句只说开着的；全开时和以前一字不差', () => {
    expect(dreamDoes(DEFAULT_DREAM)).toBe('整理收件箱、补双链、找重复、写本周小结')
    expect(dreamDoes(patchDream(DEFAULT_DREAM, { steps: { link: false, week: false } }))).toBe('整理收件箱、找重复')
    expect(dreamDoes(patchDream(DEFAULT_DREAM, { steps: { file: false } }))).toBe('给收件箱的笔记改名、补双链、找重复、写本周小结')
    expect(dreamDoes(patchDream(DEFAULT_DREAM, { folders: ['剪藏'] }))).toBe('补双链、找重复')
  })
})

// ---------- runDream 在各开关下 ----------

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
const sec = (page: number, title: string, rounds: number, failed: number): AskSection => ({
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
})

/** 假 AI：收件箱都归到剪藏/旅行，「冰洞」顺手改名「冰洞攻略」；只改名时也给它起这个名字；可视化、小结给固定的 */
const prompts: string[] = []
const fakeAsk: Ask = async (_s, prompt) => {
  prompts.push(prompt)
  if (prompt.startsWith('命令：本周小结')) return '这周在准备冰岛。'
  if (prompt.startsWith('命令：梦游可视化')) {
    const page = /第 (\d+) 页/.exec(prompt)![1]
    return `\`\`\`html\n<!doctype html><html><head><title>第 ${page} 页 · 拖一拖</title></head><body><input type="range"></body></html>\n\`\`\``
  }
  const paths = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
  const name = (p: string) => (p.endsWith('冰洞.md') ? '冰洞攻略' : null)
  if (prompt.startsWith('命令：归类和改名')) return '```json\n' + JSON.stringify(paths.map((path) => ({ path, folder: '剪藏/旅行', name: name(path), why: '都是旅行的事' }))) + '\n```'
  if (prompt.startsWith('命令：改名')) return '```json\n' + JSON.stringify(paths.filter(name).map((path) => ({ path, name: name(path), why: '起个一看就懂的名字' }))) + '\n```'
  throw new Error('没想到的提问：' + prompt.slice(0, 20))
}

let base: string
let root: string
beforeEach(() => {
  prompts.length = 0
  base = mkdtempSync(join(tmpdir(), 'cn-dream-set-'))
  root = join(base, '库')
  mkdirSync(root)
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
  const files: Record<string, string | Buffer> = {
    ...DREAM_VAULT,
    // 老图：附件/ 根目录平铺，只有课程里那篇用它
    '附件/image-1.png': Buffer.from('89504e470d0a1a0a', 'hex'),
    '课程/ecp/Lecture05 讲义.md': '# Lecture05 讲义\n\n![](../../附件/image-1.png)\n',
    // 同一个视频记在两篇里
    '剪藏/视频摘要.md': '---\n视频: https://www.youtube.com/watch?v=subway00001\n---\n\n# 视频摘要\n',
    '课程/快餐.md': '---\n视频: https://www.youtube.com/watch?v=subway00001\n---\n\n# 快餐\n',
    // 剪藏里一篇和作品讲同一件事（勾掉剪藏时这篇不补双链）
    '剪藏/旅行/黑沙滩.md': '# 黑沙滩\n\n维克镇外的黑沙滩风很大，玄武岩柱下面有海鸟。冬天晚上云量低于三成、KP 指数到 3 以上，这里也能看到极光。附近有一家卖羊肉汤的小店，晚上九点关门。\n',
  }
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', '样本')
  // 今天读 PDF 卡住的两处（可视化挑它们）
  let md = newReadingNote(PDF, new Date(2026, 10, 16))
  for (const s of [sec(4, '列是基向量去哪', 2, 0), sec(5, '旋转矩阵每个数从哪来', 3, 1)]) md = upsertSection(md, s, NOTE)
  mkdirSync(dirname(join(root, PDF)), { recursive: true })
  writeFileSync(join(root, PDF), '%PDF-1.4 假的\n')
  writeFileSync(join(root, NOTE), md)
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来')
  g(root, 'commit', '--allow-empty', '-qm', '笔记：第3讲 线性映射 第 4 页 · 列是基向量去哪')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const dream = (p: DreamPatch = {}) => runDream({ root, scratch: join(base, 'scratch'), ask: fakeAsk, trigger: 'manual', now: new Date(), settings: patchDream(DEFAULT_DREAM, p) }) as Promise<DreamReportInternal>
const groups = (r: { items: { group: string }[] }) => [...new Set(r.items.map((i) => i.group))]
/** 梦游分支上改过、新建过的全部路径（挪动两头都算） */
const touched = (r: DreamReportInternal) => g(root, 'diff', '--name-only', '--no-renames', `${r.baseCommit}..${r.tip}`).trim().split('\n').filter(Boolean)
const dups = (r: DreamReportInternal) => r.items.filter((i) => i.group === 'dup')

describe('runDream 照设置做', { timeout: 60_000 }, () => {
  it('默认（全开）：八样都做，报告里六组', async () => {
    const r = await dream()
    expect(groups(r)).toEqual(['attach', 'file', 'viz', 'link', 'dup', 'week'])
    // 可能重复里：巴黎那对 + 同一个视频那组
    expect(dups(r).map((i) => i.sub)).toEqual([expect.stringMatching(/^相似度/), expect.stringContaining('同一个视频')])
    const ice = r.items.find((i) => i.move?.from === '收件箱/冰洞.md')!
    expect(ice.move!.to).toBe('剪藏/旅行/冰洞攻略.md')
    expect(r.items.filter((i) => i.group === 'viz')).toHaveLength(2)
    expect(r.notes).toEqual([])
  })

  for (const [step, group, what] of [
    ['link', 'link', '补双链'],
    ['week', 'week', '本周小结'],
    ['viz', 'viz', '可视化'],
    ['attach', 'attach', '挪老图'],
  ] as const) {
    it(`关掉${what}：那一步不做，分支上没有它的提交，报告里没有那一组；别的照做`, async () => {
      const r = await dream({ steps: { [step]: false } })
      expect(groups(r)).not.toContain(group)
      expect(groups(r).length).toBe(5)
      if (step === 'viz') expect(prompts.some((p) => p.startsWith('命令：梦游可视化'))).toBe(false)
      if (step === 'week') expect(touched(r).some((p) => p.startsWith('周记/'))).toBe(false)
      if (step === 'attach') expect(touched(r)).not.toContain('附件/image-1.png')
      if (step === 'link') expect(r.items.some((i) => i.sub.startsWith('↔'))).toBe(false)
    })
  }

  it('关掉「提醒可能重复」：巴黎那对不列，同一个视频那组还在；两样都关：没有「可能重复」一组', async () => {
    const r = await dream({ steps: { dup: false } })
    expect(dups(r).map((i) => i.sub)).toEqual([expect.stringContaining('同一个视频')])
    const r2 = await dream({ steps: { dup: false, video: false } })
    expect(groups(r2)).not.toContain('dup')
  })

  it('关掉「同一个视频」：只有巴黎那对', async () => {
    const r = await dream({ steps: { video: false } })
    expect(dups(r).map((i) => i.sub)).toEqual([expect.stringMatching(/^相似度/)])
  })

  it('关掉归类挪动、留着改名：收件箱的笔记不挪，只在原处改名', async () => {
    const r = await dream({ steps: { file: false } })
    const files = r.items.filter((i) => i.group === 'file')
    expect(files.map((i) => i.move)).toEqual([{ from: '收件箱/冰洞.md', to: '收件箱/冰洞攻略.md' }])
    expect(files[0]!.sub).toBe('改名 · 原名「冰洞」')
    expect(touched(r).filter((p) => p.startsWith('剪藏/旅行/') && p !== '剪藏/旅行/黑沙滩.md')).toEqual([])
    expect(prompts.some((p) => p.startsWith('命令：归类和改名'))).toBe(false)
  })

  it('关掉改名、留着归类挪动：挪过去名字不变（AI 起了新名也不用）', async () => {
    const r = await dream({ steps: { rename: false } })
    const ice = r.items.find((i) => i.move?.from === '收件箱/冰洞.md')!
    expect(ice.move!.to).toBe('剪藏/旅行/冰洞.md')
    expect(r.items.filter((i) => i.group === 'file').every((i) => i.title === i.move!.from.split('/').pop()!.replace(/\.md$/, ''))).toBe(true)
    expect(prompts.find((p) => p.startsWith('命令：归类和改名'))).toContain('名字不改')
  })

  it('归类挪动和改名都关：收件箱一条都不动，不问 AI', async () => {
    const r = await dream({ steps: { file: false, rename: false } })
    expect(groups(r)).not.toContain('file')
    expect(touched(r).some((p) => p.startsWith('收件箱/') && !r.items.some((i) => i.group === 'link' && i.files.includes(p)))).toBe(false)
    expect(prompts.some((p) => /^命令：(归类和改名|改名)/.test(p))).toBe(false)
  })

  it('一晚最多几处：双链 1 处、可视化 1 个、可能重复 1 对', async () => {
    const all = await dream()
    expect(all.items.filter((i) => i.group === 'link').length).toBeGreaterThan(1)
    const r = await dream({ linkMax: 10, vizMax: 1, dupMax: 10 })
    expect(r.items.filter((i) => i.group === 'viz')).toHaveLength(1)
    // 选项里最小是 10：链接数 ≤ 10；用 runDream 直接给 1 测上限真的起作用
    const one = (await runDream({ root, scratch: join(base, 'scratch'), ask: fakeAsk, trigger: 'manual', now: new Date(), settings: { ...DEFAULT_DREAM, linkMax: 1, dupMax: 1, steps: { ...DEFAULT_DREAM.steps, video: false } } })) as DreamReportInternal
    expect(one.items.filter((i) => i.group === 'link')).toHaveLength(1)
    expect(one.items.filter((i) => i.group === 'dup')).toHaveLength(1)
  })

  it('能动的文件夹：勾掉收件箱不归类、收件箱里不补双链；勾掉剪藏不在剪藏补双链；勾掉周记不写小结', async () => {
    const all = await dream()
    const linked = (r: DreamReportInternal) => r.items.filter((i) => i.group === 'link').map((i) => i.files[0]!)
    expect(linked(all).some((p) => p.startsWith('收件箱/'))).toBe(true)
    expect(linked(all).some((p) => p.startsWith('剪藏/'))).toBe(true)

    const noInbox = await dream({ folders: ['剪藏', '阅读', '周记'] })
    expect(groups(noInbox)).not.toContain('file')
    expect(linked(noInbox).some((p) => p.startsWith('收件箱/'))).toBe(false)
    expect(touched(noInbox).some((p) => p.startsWith('收件箱/'))).toBe(false)

    const noClips = await dream({ folders: ['收件箱', '阅读', '周记'] })
    expect(linked(noClips).some((p) => p.startsWith('剪藏/'))).toBe(false)

    const noWeek = await dream({ folders: ['收件箱', '剪藏', '阅读'] })
    expect(groups(noWeek)).not.toContain('week')
    // 例外照旧：可视化挂在课程笔记上、老图改课程里那篇的链接
    expect(groups(noWeek)).toContain('viz')
    expect(groups(noWeek)).toContain('attach')
  })

  it('勾上课程：课程里的笔记也补双链', async () => {
    writeFileSync(join(root, '课程/冰岛.md'), '# 冰岛\n\n极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。维克附近光污染少。\n')
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '课程')
    const off = await dream({ steps: { file: false, rename: false } })
    expect(off.items.some((i) => i.group === 'link' && i.files[0] === '课程/冰岛.md')).toBe(false)
    const on = await dream({ steps: { file: false, rename: false }, folders: ['收件箱', '课程', '剪藏', '阅读', '周记'] })
    expect(on.items.some((i) => i.group === 'link' && i.files[0] === '课程/冰岛.md')).toBe(true)
  })

  it('改完直接收下：有提交的都收进 main（一次提交），只提醒的留着；撤回回到原样', async () => {
    const before = g(root, 'rev-parse', 'HEAD').trim()
    const r = await dream()
    const hash = await autoTake(root, r)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
    expect(r.items.filter((i) => i.commit).every((i) => i.state === 'taken' && i.taken === hash)).toBe(true)
    expect(r.items.filter((i) => !i.commit).every((i) => i.state === 'pending')).toBe(true)
    expect(r.closed).toBe(true)
    expect(g(root, 'rev-list', '--count', `${before}..HEAD`).trim()).toBe('1')
    expect(readFileSync(join(root, '剪藏/旅行/冰洞攻略.md'), 'utf8')).toContain('冰洞只在冬天开放')
    const ids = r.items.filter((i) => i.taken === hash).map((i) => i.id)
    await undo(root, r, ids, hash)
    expect(g(root, 'diff', '--name-only', before, 'HEAD').trim()).toBe('')
  })
})


describe('梦游报告摘要：按真改动说动了哪些正文', { timeout: 60_000 }, () => {
  const item = (group: DreamItem['group'], extra: Partial<DreamItem> = {}): DreamItem => ({ id: Math.random().toString(36), group, title: 'x', sub: '', why: '', commit: 'c', files: [], state: 'pending', ...extra })

  it('只说真有的几样；都没动正文是 null（不提）', () => {
    expect(bodyEdits([])).toBeNull()
    // 只挪不改字、只提醒、新建小结：都不算动正文
    expect(bodyEdits([item('file', { move: { from: '收件箱/a.md', to: '剪藏/a.md' } }), item('dup', { commit: null }), item('week')])).toBeNull()
    expect(bodyEdits([item('link'), item('link')])).toBe('补了2处双链（在正文末尾加了一行）')
    expect(
      bodyEdits([
        item('viz'),
        item('attach', { changes: [{ path: 'a.md', text: '' }, { path: 'b.md', text: '' }] }),
        item('file', { edits: { self: true, others: 1 } }),
        item('file', { edits: { self: false, others: 2 } }),
      ]),
    ).toBe('做了1个可视化（在读PDF笔记那一段的脚上加了一行链接）；挪老图改了2篇里的图片链接；归类和改名时1篇里的标题或相对链接跟着改、3篇别的笔记里的[[旧名]]跟着换')
  })

  it('归类改名时记下正文真改了的：这篇的标题、别的笔记里的 [[旧名]]；只挪不改字的不记', async () => {
    writeFileSync(join(root, '收件箱/冰洞.md'), '# 冰洞\n\n冰洞只在冬天开放，必须跟导游进去，提前两周订。\n')
    mkdirSync(join(root, '写作'), { recursive: true })
    writeFileSync(join(root, '写作/冬天.md'), '# 冬天\n\n见 [[冰洞]]。\n')
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '冰洞')
    const r = await dream({ steps: { link: false, viz: false, attach: false } })
    const ice = r.items.find((i) => i.move?.from === '收件箱/冰洞.md')!
    expect(ice.edits).toEqual({ self: true, others: 1 })
    const ji = r.items.find((i) => i.move?.from === '收件箱/极光.md')!
    expect(ji.edits).toBeUndefined()
    expect(bodyEdits(r.items)).toBe('归类和改名时1篇里的标题或相对链接跟着改、1篇别的笔记里的[[旧名]]跟着换')
  })
})
