/**
 * 生长图（task-h7oy8）：时间怎么估、链接怎么认、Git 历史怎么读（挪名、导入、梦游的提交）、拼出来的数据、位置缓存（老的不挪、新的落在邻居旁边）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compute, type GrowthJob } from '../src/main/growth/compute'
import { emptyHist, LogReader, readHistory, unquotePath, viewOf } from '../src/main/growth/history'
import { placeNotes } from '../src/main/growth/layout'
import { buildGrowth, classify, dayOf, estimateBorn, folderLabel, linksOf, makeResolver, mdKey, parseDay, ymd } from '../src/shared/growth'

const D = (s: string) => parseDay(s)!
const ms = (s: string) => new Date(s).getTime()

describe('日子', () => {
  it('认几种写法，不像日期的是 null', () => {
    expect(ymd(D('2024-03-05'))).toBe('2024-03-05')
    expect(ymd(D('2024/3/5'))).toBe('2024-03-05')
    expect(ymd(D('2024.03.05 10:20'))).toBe('2024-03-05')
    expect(ymd(D('20240305'))).toBe('2024-03-05')
    expect(ymd(D('2024年3月5日'))).toBe('2024-03-05')
    expect(ymd(D('"2024-03-05T08:00:00"'))).toBe('2024-03-05')
    expect(parseDay('2024-13-01')).toBeNull()
    expect(parseDay('2023-02-30')).toBeNull()
    expect(parseDay('第3讲')).toBeNull()
    expect(parseDay('202403051')).toBeNull()
  })
  it('某一刻是本地的哪一天（午夜前后不错一天）', () => {
    expect(ymd(dayOf(new Date(2026, 10, 23, 0, 5).getTime()))).toBe('2026-11-23')
    expect(ymd(dayOf(new Date(2026, 10, 23, 23, 55).getTime()))).toBe('2026-11-23')
  })
})

describe('没有 Git 记录时估时间：属性 → 文件名 → 修改时间', () => {
  const cap = D('2026-11-23')
  const mt = ms('2026-08-15T12:00:00')
  it('属性里的日期（几种键名），取最早的', () => {
    expect(estimateBorn('---\ncreated: 2024-02-03\n---\n# a', 'a.md', mt, cap)).toEqual({ day: D('2024-02-03'), from: 'prop' })
    expect(estimateBorn('---\n创建: 2024/2/3 10:00\n---\n', 'a.md', mt, cap)).toEqual({ day: D('2024-02-03'), from: 'prop' })
    expect(estimateBorn('---\nDate: 2025-01-01\ncreated: 2024-05-01\n---\n', 'a.md', mt, cap)).toEqual({ day: D('2024-05-01'), from: 'prop' })
  })
  it('没属性看文件名，都有取早的', () => {
    expect(estimateBorn('# 日记', '日记/2026-09-24.md', mt, cap)).toEqual({ day: D('2026-09-24'), from: 'name' })
    expect(estimateBorn('# 会', '会议 20250102 纪要.md', mt, cap)).toEqual({ day: D('2025-01-02'), from: 'name' })
    expect(estimateBorn('---\ncreated: 2025-03-01\n---\n', '2024-12-31 回顾.md', mt, cap)).toEqual({ day: D('2024-12-31'), from: 'name' })
  })
  it('都没有用修改时间（画空心）；晚于导入那天、早于 1990 的日期不信', () => {
    expect(estimateBorn('# x', '笔记.md', mt, cap)).toEqual({ day: D('2026-08-15'), from: 'mtime' })
    expect(estimateBorn('---\ncreated: 2030-01-01\n---\n', '笔记.md', mt, cap)).toEqual({ day: D('2026-08-15'), from: 'mtime' })
    expect(estimateBorn('---\ndate: 1970-01-01\n---\n', '笔记.md', mt, cap).from).toBe('mtime')
    // 修改时间晚于导入那天（导进来以后又改过）：算导入那天
    expect(estimateBorn('# x', '笔记.md', ms('2026-12-01T10:00:00'), cap)).toEqual({ day: cap, from: 'mtime' })
  })
})

describe('链接', () => {
  it('双链、嵌入、[字](路径.md)；代码块里的不算；整理加的单独认', () => {
    const text = [
      '---',
      'related:',
      '  - "[[甲]]"',
      'tags: [x]',
      '---',
      '# 标题',
      '正文提到 [[乙|别名]] 和 [[丙#一节]]，还嵌了 ![[丁]]。',
      '看 [这篇](../资料/戊%20文.md#头) 和 [网页](https://x.com/a.md)。',
      '```',
      '[[代码里的]]',
      '```',
      '相关：[[己]]、[[庚]]',
      '## 相关',
      '- [[辛]]',
      '## 别的',
      '- [[壬]]',
    ].join('\n')
    expect(linksOf(text, '课/笔记.md')).toEqual([
      { key: '甲', tidy: true },
      { key: '乙', tidy: false },
      { key: '丙', tidy: false },
      { key: '丁', tidy: false },
      { key: 'md:资料/戊 文.md', tidy: false },
      { key: '己', tidy: true },
      { key: '庚', tidy: true },
      { key: '辛', tidy: true },
      { key: '壬', tidy: false },
    ])
  })
  it('[字](路径) 按这篇所在的文件夹算，跑出库外的不算', () => {
    expect(mdKey('a/b/c.md', '../d.md')).toBe('md:a/d.md')
    expect(mdKey('a.md', '../d.md')).toBeNull()
    expect(mdKey('a.md', 'https://x/d.md')).toBeNull()
  })
  it('按路径、名字、路径结尾认是哪篇；同名的浅的在前', () => {
    const r = makeResolver(['课/HPDC/Amdahl.md', 'Amdahl.md', '剪藏/x/甲.md', 'B/c/重名.md', 'B/重名.md'])
    expect(r('amdahl')).toBe(1)
    expect(r('课/hpdc/amdahl')).toBe(0)
    expect(r('hpdc/amdahl')).toBe(0)
    expect(r('甲')).toBe(2)
    expect(r('重名')).toBe(4)
    expect(r('md:剪藏/x/甲.md')).toBe(2)
    expect(r('没有')).toBe(-1)
    expect(r('别处/甲')).toBe(-1)
  })
})

describe('大类和群名', () => {
  it('前三大的顶层文件夹上色，别的灰；每一大类挑一层文件夹当群（18 到 600 篇的盖住的最多），按课分，不按课里的小文件夹分', () => {
    const paths: string[] = []
    for (let i = 0; i < 300; i++) paths.push(`30-Courses/Uni/2026SS/HPDC-高性能/L${i}.md`)
    for (let i = 0; i < 30; i++) paths.push(`30-Courses/Uni/2026SS/HPDC-高性能/glossary/g${i}.md`)
    for (let i = 0; i < 40; i++) paths.push(`30-Courses/Uni/2026SS/GPU/L${i}.md`)
    for (let i = 0; i < 60; i++) paths.push(`40-Clippings/Getnotes/c${i}.md`)
    for (let i = 0; i < 20; i++) paths.push(`日记/d${i}.md`)
    for (let i = 0; i < 5; i++) paths.push(`写作/w${i}.md`)
    paths.push('根.md')
    const c = classify(paths)
    expect(c.areas.map((a) => [a.name, a.color])).toEqual([
      ['Courses', 0],
      ['Clippings', 1],
      ['日记', 2],
      ['写作', -1],
      ['', -1],
    ])
    const groupOf = (p: string) => c.groups[c.group[paths.indexOf(p)]!]?.name
    expect(groupOf('30-Courses/Uni/2026SS/HPDC-高性能/L1.md')).toBe('HPDC')
    expect(groupOf('30-Courses/Uni/2026SS/HPDC-高性能/glossary/g1.md')).toBe('HPDC')
    expect(groupOf('30-Courses/Uni/2026SS/GPU/L1.md')).toBe('GPU')
    expect(groupOf('40-Clippings/Getnotes/c1.md')).toBe('Getnotes')
    expect(c.group[paths.indexOf('根.md')]).toBe(-1)
    expect(folderLabel('80-Meta')).toBe('Meta')
  })
})

// ---------- Git 历史 ----------

let base: string
let root: string
const g = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
/** 按某一天提交（作者时间和提交时间都是那天） */
function commitAt(when: string, message: string) {
  g('add', '-A')
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', message], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
}
const write = (p: string, text: string) => {
  mkdirSync(dirname(join(root, p)), { recursive: true })
  writeFileSync(join(root, p), text)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-growth-'))
  root = join(base, '库')
  mkdirSync(root)
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Test')
  g('config', 'user.email', 'test@example.com')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('读 Git 历史', () => {
  it('一篇第一次出现的那天；挪了改了名还是同一篇；链接那一行第一次出现的那天；梦游的提交单独记', async () => {
    write('收件箱/甲.md', '# 甲\n')
    write('乙.md', '# 乙\n')
    commitAt('2025-01-10T10:00:00', '新建')
    write('收件箱/甲.md', '# 甲\n\n讲到 [[乙]]\n')
    commitAt('2025-02-01T10:00:00', '写')
    mkdirSync(join(root, '课'))
    renameSync(join(root, '收件箱/甲.md'), join(root, '课/甲 新.md'))
    commitAt('2025-03-01T10:00:00', '挪')
    write('丙 有空格.md', '# 丙\n')
    commitAt('2025-04-01T10:00:00', '丙')
    write('课/甲 新.md', '# 甲\n\n讲到 [[乙]]\n\n相关：[[丙 有空格]]\n')
    commitAt('2025-05-02T03:00:00', '梦游：「甲 新」补上 [[丙 有空格]]')
    const { st, renames } = await readHistory(root, null)
    const v = viewOf(st)
    expect(ymd(dayOf(v.born.get('课/甲 新.md')!.ms))).toBe('2025-01-10')
    expect(v.born.get('课/甲 新.md')!.bulk).toBe(false)
    expect(ymd(dayOf(v.born.get('丙 有空格.md')!.ms))).toBe('2025-04-01')
    expect(ymd(dayOf(v.links.get('课/甲 新.md\t乙')!.ms))).toBe('2025-02-01')
    expect(v.links.get('课/甲 新.md\t乙')!.dream).toBe(false)
    expect(v.links.get('课/甲 新.md\t丙 有空格')).toMatchObject({ dream: true, bulk: false })
    expect(v.dream).toEqual([{ ms: ms('2025-05-02T03:00:00'), subject: '梦游：「甲 新」补上 [[丙 有空格]]', paths: ['课/甲 新.md'] }])
    expect(v.imports).toEqual([])
    expect(renames).toEqual([['收件箱/甲.md', '课/甲 新.md']])
  })

  it('一次加进来几十篇算导入；接着读只读上次以后的，读过的不变', async () => {
    for (let i = 0; i < 35; i++) write(`导入/n${i}.md`, `# n${i}\n\n[[n${(i + 1) % 35}]]\n`)
    commitAt('2026-11-01T09:00:00', '导入 35 篇')
    const first = await readHistory(root, null)
    const v1 = viewOf(first.st)
    expect(v1.imports).toEqual([{ ms: ms('2026-11-01T09:00:00'), count: 35 }])
    expect(v1.born.get('导入/n3.md')!.bulk).toBe(true)
    expect(v1.links.get('导入/n3.md\tn4')!.bulk).toBe(true)
    write('新.md', '# 新\n\n[[n3]]\n')
    commitAt('2026-11-05T09:00:00', '新的一篇')
    const second = await readHistory(root, first.st)
    const v2 = viewOf(second.st)
    expect(v2.born.get('新.md')!.bulk).toBe(false)
    expect(ymd(dayOf(v2.links.get('新.md\tn3')!.ms))).toBe('2026-11-05')
    // 第一次读到的没变
    expect(v2.born.get('导入/n3.md')).toEqual(v1.born.get('导入/n3.md'))
    expect(second.st.head).toBe(g('rev-parse', 'HEAD').trim())
    // 历史改写过（上次读到的那次不在了）：整个重读
    g('commit', '-q', '--amend', '-m', '改了说明')
    const third = await readHistory(root, second.st)
    expect(viewOf(third.st).born.get('新.md')).toBeDefined()
    expect(third.st.imports).toHaveLength(1)
  })

  it('改了名、别的笔记里的 [[旧名]] 跟着换成 [[新名]]：那条链接还是原来的日子，不算梦游新连的', async () => {
    write('收件箱/极光.md', '# 极光\n')
    write('行程.md', '# 行程\n\n看 [[极光]]\n')
    commitAt('2025-01-10T10:00:00', '新建')
    mkdirSync(join(root, '剪藏'))
    renameSync(join(root, '收件箱/极光.md'), join(root, '剪藏/极光 2.md'))
    write('行程.md', '# 行程\n\n看 [[极光 2]]\n')
    commitAt('2025-02-01T03:00:00', '梦游：「极光」挪到 剪藏，改名「极光 2」')
    const v = viewOf((await readHistory(root, null)).st)
    expect(v.links.get('行程.md\t极光 2')).toEqual({ ms: ms('2025-01-10T10:00:00'), dream: false, bulk: false })
  })

  it('还没有提交：照原样交回，不报错', async () => {
    write('a.md', '# a')
    const { st } = await readHistory(root, null)
    expect(st.any).toBe(false)
  })

  it('读法：git 给的带引号的路径、删掉再建回来是新的一篇', () => {
    expect(unquotePath('"a/\\344\\275\\240 \\"x\\".md"')).toBe('a/你 "x".md')
    const st = emptyHist()
    const r = new LogReader(st)
    const lines = [
      '\x1eaaa\x1f1700000000\x1f新建',
      'diff --git a/x.md b/x.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/x.md',
      '@@ -0,0 +1 @@',
      '+[[y]]',
      '\x1ebbb\x1f1700100000\x1f删',
      'diff --git a/x.md b/x.md',
      'deleted file mode 100644',
      '--- a/x.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-[[y]]',
      '\x1eccc\x1f1700200000\x1f又建',
      'diff --git a/x.md b/x.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/x.md',
      '@@ -0,0 +1 @@',
      '+[[y]]',
    ]
    for (const l of lines) r.line(l)
    r.finish()
    const v = viewOf(st)
    expect(v.born.get('x.md')!.ms).toBe(1700200000_000)
    expect(v.links.get('x.md\ty')!.ms).toBe(1700200000_000)
    expect(st.head).toBe('ccc')
  })
})

describe('拼数据', () => {
  const today = D('2026-11-23')
  it('导入的按估的；之后的按 Git；链接的那天不早于两头都在；梦游连的那晚、报告里的那晚、更新日志里的那晚', () => {
    const born = new Map([
      ['甲.md', { ms: ms('2026-11-01T09:00:00'), bulk: true }],
      ['乙.md', { ms: ms('2026-11-01T09:00:00'), bulk: true }],
      ['丙.md', { ms: ms('2026-11-10T09:00:00'), bulk: false }],
    ])
    const links = new Map([
      ['甲.md\t乙', { ms: ms('2026-11-01T09:00:00'), dream: false, bulk: true }],
      ['丙.md\t甲', { ms: ms('2026-11-20T02:00:00'), dream: true, bulk: false }],
    ])
    const d = buildGrowth({
      notes: [
        { path: '甲.md', text: '---\ncreated: 2024-02-01\n---\n[[乙]]\n相关：[[丁]]', mtimeMs: ms('2026-10-01T00:00:00'), createdMs: 0 },
        { path: '乙.md', text: '# 乙', mtimeMs: ms('2025-06-01T00:00:00'), createdMs: 0 },
        { path: '丙.md', text: '相关：[[甲]]', mtimeMs: ms('2026-11-20T00:00:00'), createdMs: 0 },
        { path: '丁.md', text: '# 丁 还没提交', mtimeMs: ms('2026-11-22T10:00:00'), createdMs: ms('2026-11-22T10:00:00') },
        { path: '80-Meta/更新日志/2026-11-05.md', text: '## 新增\n- [[乙]] 整理了\n- 别的事\n', mtimeMs: 0, createdMs: 0 },
      ],
      history: { born, links, dream: [{ ms: ms('2026-11-20T02:00:00'), subject: '梦游：「丙」补上 [[甲]]', paths: ['丙.md'] }], imports: [{ ms: ms('2026-11-01T09:00:00'), count: 2 }], any: true },
      reports: [{ started: ms('2026-11-21T23:30:00'), items: [{ group: 'link', title: '乙', sub: '↔ [[丙]]', files: ['乙.md'], state: 'pending' }] }],
      current: ms('2026-11-21T23:30:00'),
      today,
    })
    const n = (p: string) => d.notes.find((x) => x.path === p)!
    // 更新日志不当一篇
    expect(d.notes.map((x) => x.path)).toEqual(['甲.md', '乙.md', '丙.md', '丁.md'])
    expect(n('甲.md')).toMatchObject({ born: D('2024-02-01'), est: false })
    expect(n('乙.md')).toMatchObject({ born: D('2025-06-01'), est: true })
    expect(n('丙.md')).toMatchObject({ born: D('2026-11-10'), est: false })
    expect(n('丁.md')).toMatchObject({ born: D('2026-11-22'), est: false })
    const link = (a: string, b: string) => d.links.find((l) => [d.notes[l.a]!.path, d.notes[l.b]!.path].sort().join() === [a, b].sort().join())!
    // 导入那次带进来的链接：两头都在的那天
    expect(link('甲.md', '乙.md')).toMatchObject({ day: D('2025-06-01'), dream: false })
    expect(link('甲.md', '丙.md')).toMatchObject({ day: D('2026-11-20'), dream: true })
    // 整理加的「相关：」、没有 Git 记录：两头都在的那天
    expect(link('甲.md', '丁.md')).toMatchObject({ day: D('2026-11-22'), dream: true })
    expect(d.imports).toEqual([{ day: D('2026-11-01'), count: 2 }])
    expect(d.nights.map((x) => [ymd(x.day), x.src, x.report])).toEqual([
      ['2026-11-05', 'log', false],
      ['2026-11-20', 'dream', false],
      ['2026-11-21', 'dream', true],
    ])
    expect(d.nights[0]!.touched).toEqual([1])
    expect(d.nights[0]!.items[0]).toMatchObject({ group: 'log', title: '乙', sub: '新增' })
    expect(d.nights[1]!.items[0]).toMatchObject({ group: 'commit', title: '「丙」补上 [[甲]]' })
    // 还没收下的：列着，但不算这晚动过的
    expect(d.nights[2]!.touched).toEqual([])
    expect(d.nights[2]!.items[0]).toMatchObject({ state: 'pending', notes: [1] })
  })

  it('没有 Git 记录：全按估的，导入那天就是今天', () => {
    const d = buildGrowth({ notes: [{ path: 'a.md', text: '# a', mtimeMs: ms('2026-01-02T10:00:00'), createdMs: 0 }], history: null, reports: [], current: null, today })
    expect(d.git).toBe(false)
    expect(d.notes[0]).toMatchObject({ born: D('2026-01-02'), est: true })
    expect(d.imports).toEqual([{ day: today, count: 1 }])
  })
})

describe('位置缓存', () => {
  const ring = (n: number) => Array.from({ length: n }, (_, i) => ({ a: i, b: (i + 1) % n }))
  it('同一份输入摆出来一样；老的不挪，新的落在连着的那篇旁边', () => {
    const keys = Array.from({ length: 60 }, (_, i) => `n${i}.md`)
    const areas = keys.map((_, i) => i % 3)
    const a = placeNotes(keys, areas, ring(60), new Map())
    const b = placeNotes(keys, areas, ring(60), new Map())
    expect(a.full).toBe(true)
    expect(a.pos).toEqual(b.pos)
    const prev = new Map(keys.map((k, i) => [k, a.pos[i]!]))
    const more = [...keys, 'new.md']
    const c = placeNotes(more, [...areas, 0], [...ring(60), { a: 60, b: 7 }], prev)
    expect(c.full).toBe(false)
    expect(c.pos.slice(0, 60)).toEqual(a.pos)
    const [x, y] = c.pos[60]!
    const [x7, y7] = a.pos[7]!
    const spread = Math.max(...a.pos.map((p) => Math.hypot(p[0] - x7, p[1] - y7)))
    expect(Math.hypot(x - x7, y - y7)).toBeLessThan(spread / 3)
  })
  it('一大半是新的（刚导入几千篇）：整个重排', () => {
    const keys = Array.from({ length: 40 }, (_, i) => `n${i}.md`)
    const prev = new Map(keys.slice(0, 10).map((k) => [k, [0, 0] as [number, number]]))
    expect(placeNotes(keys, keys.map(() => 0), ring(40), prev).full).toBe(true)
  })

  it('compute：算完存缓存，再算一次位置一点不动、只读新的提交；挪了名的位置跟过去', async () => {
    for (let i = 0; i < 12; i++) write(`课/n${i}.md`, `# n${i}\n\n[[n${(i + 1) % 12}]]\n`)
    commitAt('2026-10-01T09:00:00', '样本')
    const cacheFile = join(base, 'cache', 'g.json')
    const job = (): GrowthJob => {
      const files = g('ls-files', '*.md').trim().split('\n')
      return { root, cacheFile, notes: files.map((p) => [p, readFileSync(join(root, p), 'utf8'), Date.now(), 0]), reports: [], current: null, today: dayOf(Date.now()) }
    }
    const one = await compute(job())
    expect(one.notes).toHaveLength(12)
    expect(one.imports).toEqual([{ day: D('2026-10-01'), count: 12 }])
    const posOf = (d: typeof one, p: string) => {
      const n = d.notes.find((x) => x.path === p)!
      return [n.x, n.y]
    }
    renameSync(join(root, '课/n3.md'), join(root, '课/n3 改名.md'))
    write('课/n0.md', '# n0\n\n[[n1]]\n\n[[n3 改名]]\n')
    write('课/n5.md', '# n5\n\n[[n6]]\n')
    write('课/新.md', '# 新\n\n[[n5]]\n')
    commitAt('2026-11-02T09:00:00', '改名、加一篇')
    const two = await compute(job())
    expect(two.notes).toHaveLength(13)
    expect(posOf(two, '课/n3 改名.md')).toEqual(posOf(one, '课/n3.md'))
    for (const p of ['课/n0.md', '课/n5.md', '课/n9.md']) expect(posOf(two, p)).toEqual(posOf(one, p))
    const nw = two.notes.find((x) => x.path === '课/新.md')!
    expect(nw).toMatchObject({ born: D('2026-11-02'), est: false })
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'))
    expect(cached.hist.head).toBe(g('rev-parse', 'HEAD').trim())
    // 修改时间不当回事（没有改的不重算位置）
    utimesSync(join(root, '课/n1.md'), new Date(), new Date())
    const three = await compute(job())
    expect(three.notes.map((n) => [n.x, n.y])).toEqual(two.notes.map((n) => [n.x, n.y]))
  })
})
