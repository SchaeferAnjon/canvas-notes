/**
 * 梦游前后小图（设计页 154 版本 A）：报告里的条目排成几处（补双链、可能重复合成一个、挪文件夹、新词条），位置算好写死、每次一样，
 * 收下了的挪动之后旧路径换成新路径；时间线先长梦游前、再一处一处、最后停在梦游后。样本是编的。
 */
import { describe, expect, it } from 'vitest'
import type { DreamItem, DreamReport } from '../src/shared/api'
import type { GrowthData } from '../src/shared/growth'
import { dreamTimeline, phaseAt, T } from '../src/renderer/growth/dream-anim'
import { dreamScene, MAX_NODES } from '../src/renderer/growth/dream-scene'
import { makeModel } from '../src/renderer/growth/model'

const PATHS = ['项目/计划.md', '项目/调研.md', '项目/清单.md', '阅读/教材.md', '阅读/教材笔记.md', '收件箱/待办.md', '生活/周记.md', '生活/购物.md', '项目/组会.md']
function data(paths = PATHS, links: [number, number][] = [[0, 1], [1, 2], [3, 4], [0, 8], [6, 7]]): GrowthData {
  const tops = [...new Set(paths.map((p) => p.split('/')[0]!))]
  return {
    notes: paths.map((path, i) => ({ path, born: 20000 + i, est: false, from: 'git', area: tops.indexOf(path.split('/')[0]!), group: -1, x: i * 10, y: (i % 3) * 10 })),
    links: links.map(([a, b]) => ({ a, b, day: 20010, dream: false })),
    nights: [],
    areas: tops.map((dir, i) => ({ dir, name: dir, color: i < 3 ? i : -1, count: paths.filter((p) => p.startsWith(dir + '/')).length })),
    groups: [],
    imports: [],
    git: true,
    today: 20020,
    ms: { history: 0, layout: 0, total: 0 },
  }
}
const item = (p: Partial<DreamItem> & Pick<DreamItem, 'group'>): DreamItem => ({ id: Math.random().toString(36).slice(2), title: '', sub: '', why: '', commit: 'abc', files: [], state: 'pending', ...p })
const report = (items: DreamItem[]): DreamReport => ({ branch: 'dream/11-25', base: 'main', baseCommit: 'x', started: 0, finished: 0, trigger: 'manual', items, notes: [], closed: false })
const judged = (a: string, b: string): DreamItem['judged'] => ({ level: 'same-topic', confidence: 0.9, a: { path: a, quote: '' }, b: { path: b, quote: '' } })

const ITEMS = [
  item({ group: 'link', files: ['项目/清单.md'], judged: judged('项目/清单.md', '项目/调研.md') }),
  item({ group: 'dup', commit: null, files: ['阅读/教材.md', '阅读/教材笔记.md'] }),
  item({ group: 'file', files: ['收件箱/待办.md', '生活/待办.md'], move: { from: '收件箱/待办.md', to: '生活/待办.md' } }),
  item({ group: 'entry', commit: null, files: [], entry: { name: '情绪识别', count: 3, notes: ['项目/调研.md', '项目/清单.md', '项目/计划.md'] } }),
  item({ group: 'viz', files: ['项目/图.html'] }),
  item({ group: 'link', state: 'dropped', files: ['生活/周记.md'], judged: judged('生活/周记.md', '项目/计划.md') }),
]

describe('梦游前后小图的戏', () => {
  it('四种能画的排成四处（可视化、丢掉的不画）；新线、合并、挪去的位置都在小图里', () => {
    const sc = dreamScene(report(ITEMS), makeModel(data()), 2)
    expect(sc.steps.map((s) => s.kind)).toEqual(['link', 'merge', 'move', 'new'])
    expect(sc.H).toBe(240)
    // 补的线是新线；梦游前那几条是旧线；新词条连 3 条
    expect(sc.edges.filter((e) => e.kind === 'new')).toHaveLength(1 + 3)
    expect(sc.edges.some((e) => e.kind === 'old' && e.a === '项目/计划.md' && e.b === '项目/调研.md')).toBe(true)
    const todo = sc.nodes.find((n) => n.id === '收件箱/待办.md')!
    expect(todo.group).toBe('收件箱')
    expect(todo.to).toBeDefined()
    // 可能重复：被并的那篇沿直线走到并进去那篇的位置
    const into = sc.nodes.find((n) => n.id === '阅读/教材笔记.md')!
    const tl = dreamTimeline(sc)
    const go = tl.tw.find((w) => w.target === tl.ns.get('阅读/教材.md') && 'x' in w.values)!
    expect(go.values.x![1]).toBe(into.x)
    expect(go.values.y![1]).toBe(into.y)
    const fresh = sc.nodes.find((n) => n.isNew)!
    expect(fresh.title).toBe('情绪识别')
    for (const n of sc.nodes) for (const p of n.to ? [n, n.to] : [n]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(sc.W)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(sc.H)
    }
    // 群名写在那一团上方
    expect(sc.clusters.map((c) => c.name).sort()).toEqual(['收件箱', '生活', '阅读', '项目'].sort())
  })

  it('同一份报告摆出来每次一样（重播、拖进度不跳）', () => {
    const a = dreamScene(report(ITEMS), makeModel(data()), 2)
    const b = dreamScene(report(ITEMS), makeModel(data()), 2)
    expect(b.nodes).toEqual(a.nodes)
  })

  it('收下了挪动以后：库里只有新路径，别的条目写的旧路径跟着换，挪的那篇梦游前还在原来那一团', () => {
    const paths = PATHS.map((p) => (p === '收件箱/待办.md' ? '生活/待办.md' : p))
    const items = [
      item({ group: 'file', state: 'taken', files: ['收件箱/待办.md', '生活/待办.md'], move: { from: '收件箱/待办.md', to: '生活/待办.md' } }),
      item({ group: 'link', state: 'taken', files: ['收件箱/待办.md'], judged: judged('收件箱/待办.md', '生活/周记.md') }),
    ]
    const sc = dreamScene(report(items), makeModel(data(paths)), 2)
    expect(sc.steps).toMatchObject([{ kind: 'move', node: '生活/待办.md' }, { kind: 'link', a: '生活/待办.md', b: '生活/周记.md', taken: true }])
    const n = sc.nodes.find((x) => x.id === '生活/待办.md')!
    expect(n.group).toBe('收件箱')
    expect(n.title).toBe('待办')
  })

  it('最多画 40 篇：这晚动过的都在，邻居按连得多的挑', () => {
    const paths = Array.from({ length: 120 }, (_, i) => `项目/n${i}.md`)
    const links: [number, number][] = paths.slice(1).map((_, i) => [0, i + 1])
    const sc = dreamScene(report([item({ group: 'link', files: [paths[0]!], judged: judged(paths[0]!, paths[5]!) })]), makeModel(data(paths, links)), 2)
    expect(sc.nodes.length).toBe(MAX_NODES)
    expect(sc.nodes.map((n) => n.id)).toContain(paths[5])
  })

  it('一晚挪了 60 篇（超过 40 篇）：画不下的那几处不进戏，不出错；每一处的那几篇都在图里，时间线排得出来', () => {
    const paths = [...Array.from({ length: 60 }, (_, i) => `收件箱/n${i}.md`), '归档/a.md', '课程/b.md']
    const items = paths.slice(0, 60).map((p, i) => item({ group: 'file', files: [p], move: { from: p, to: `${i % 2 ? '归档' : '课程'}/n${i}.md` } }))
    items.push(item({ group: 'entry', commit: null, files: [], entry: { name: '新词', count: 2, notes: [paths[0]!, paths[59]!] } }))
    const sc = dreamScene(report(items), makeModel(data(paths, [[0, 1]])), 2)
    expect(sc.nodes.filter((n) => !n.isNew).length).toBeLessThanOrEqual(MAX_NODES + 3)
    const ids = new Set(sc.nodes.map((n) => n.id))
    expect(sc.steps.length).toBeGreaterThan(0)
    expect(sc.steps.map((s) => s.i)).toEqual(sc.steps.map((_, i) => i))
    for (const s of sc.steps) {
      if (s.kind === 'move') expect(ids.has(s.node) && !!sc.nodes.find((n) => n.id === s.node)!.to).toBe(true)
      if (s.kind === 'new') expect(s.links.every((l) => ids.has(l))).toBe(true)
    }
    expect(() => dreamTimeline(sc)).not.toThrow()
  })

  it('没有能画的（只有可视化）：空的', () => {
    const sc = dreamScene(report([item({ group: 'viz', files: ['项目/图.html'] })]), makeModel(data()), 2)
    expect(sc.nodes).toHaveLength(0)
    expect(sc.steps).toHaveLength(0)
  })
})

describe('时间线', () => {
  it('先长梦游前、停一下，再一处一处；超过 4 处的其余一起；最后是梦游后', () => {
    const sc = dreamScene(report(ITEMS), makeModel(data()), 2)
    const tl = dreamTimeline(sc)
    expect(tl.end).toBeGreaterThanOrEqual(T.hold + 4 * T.step + 0.4)
    expect(tl.end).toBeLessThan(T.hold + 4 * T.step + 0.7)
    expect(phaseAt(sc, tl, 0.5)).toEqual({ kind: 'before' })
    expect(phaseAt(sc, tl, T.hold + 0.1)).toEqual({ kind: 'step', i: 0 })
    expect(phaseAt(sc, tl, T.hold + 2 * T.step + 0.1)).toEqual({ kind: 'step', i: 2 })
    expect(phaseAt(sc, tl, tl.end)).toEqual({ kind: 'after' })
    // 每个梦游前的点都有一段从 0 长到 1；新词条那点梦游前是 0
    const grows = tl.tw.filter((w) => 's' in w.values && w.values.s![0] === 0)
    expect(grows.length).toBe(sc.nodes.length)
    // 原处空心圈：落定以后 0.6 秒内淡掉
    const move = sc.steps.findIndex((s) => s.kind === 'move')
    const fade = tl.tw.find((w) => w.target === tl.ns.get('收件箱/待办.md') && 'ghost' in w.values && w.values.ghost![0] === 1)!
    expect(fade.at + fade.duration - (tl.stepAt(move) + T.act)).toBeLessThanOrEqual(0.6 + 1e-9)
    // 都排在 end 以内
    for (const w of tl.tw) expect(w.at + w.duration).toBeLessThanOrEqual(tl.end + 1e-9)
  })
  it('先挪走、后来又合并的同一篇：从挪到的地方合过去，空心圈画在那时的原处；最后一个动作做完才算播完、空心圈都淡掉', () => {
    const items = [
      item({ group: 'file', files: ['收件箱/待办.md', '生活/待办.md'], move: { from: '收件箱/待办.md', to: '生活/待办.md' } }),
      item({ group: 'link', files: ['项目/清单.md'], judged: judged('项目/清单.md', '项目/调研.md') }),
      item({ group: 'link', files: ['项目/组会.md'], judged: judged('项目/组会.md', '项目/清单.md') }),
      item({ group: 'link', files: ['生活/购物.md'], judged: judged('生活/购物.md', '项目/计划.md') }),
      item({ group: 'dup', commit: null, files: ['收件箱/待办.md', '生活/周记.md'] }),
    ]
    const sc = dreamScene(report(items), makeModel(data()), 2)
    const tl = dreamTimeline(sc)
    const st = tl.ns.get('收件箱/待办.md')!
    const moved = sc.nodes.find((n) => n.id === '收件箱/待办.md')!.to!
    const xs = tl.tw.filter((w) => w.target === st && 'x' in w.values)
    expect(xs).toHaveLength(2)
    expect(xs[1]!.values.x![0]).toBe(moved.x)
    const gs = tl.tw.filter((w) => w.target === st && 'gx' in w.values)
    expect(gs[1]!.values.gx![1]).toBe(moved.x)
    for (const w of tl.tw) expect(w.at + w.duration).toBeLessThanOrEqual(tl.end + 1e-9)
    const lastFade = Math.max(...tl.tw.filter((w) => 'ghost' in w.values && w.values.ghost![1] === 0).map((w) => w.at + w.duration))
    expect(lastFade).toBeLessThan(tl.end)
  })
  it('六处：前四处一处一处，后两处一起', () => {
    const more = [...ITEMS, item({ group: 'link', files: ['项目/组会.md'], judged: judged('项目/组会.md', '项目/清单.md') }), item({ group: 'link', files: ['生活/购物.md'], judged: judged('生活/购物.md', '项目/计划.md') })]
    const sc = dreamScene(report(more), makeModel(data()), 2)
    const tl = dreamTimeline(sc)
    expect(sc.steps).toHaveLength(6)
    expect(tl.end).toBeGreaterThanOrEqual(T.hold + 4 * T.step + T.batch + 0.4)
    expect(tl.end).toBeLessThan(T.hold + 4 * T.step + T.batch + 0.7)
    expect(phaseAt(sc, tl, T.hold + 4 * T.step + 0.2)).toEqual({ kind: 'rest' })
  })
})
