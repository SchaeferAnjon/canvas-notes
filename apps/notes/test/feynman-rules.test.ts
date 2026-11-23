/**
 * 判定、缺口、下次再讲的日子、你的改动、追问轮次（shared/feynman/rules.ts、round.ts），规矩照 design/feynman/teaching.md。
 */
import { describe, expect, it } from 'vitest'
import { headerInfo, lastAsk, newMeta, roundsUsed, resumed, withPeek } from '../src/shared/feynman/round'
import { applyEdits, gapDays, gapsBody, gapsOf, inDays, judgedMeta, nextDay, redoneMeta, tooManyCores, verdictBody, verdictLine, verdictOf } from '../src/shared/feynman/rules'
import type { CoreJudged, CoreState, FeynmanMeta, Point } from '../src/shared/feynman/types'

const cores: Point[] = ['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, kind: 'core', text: `核心${i + 1}`, answer: `答案${i + 1}`, basis: `p${20 + i}` }))
const extras: Point[] = [{ id: 'e1', kind: 'extra', text: '类比', answer: '像下山', basis: 'AI 判断' }]
const st = (...s: CoreState[]): CoreJudged[] => s.map((state, i) => ({ id: `c${i + 1}`, state, quote: state === 'missing' ? '' : `原话${i + 1}` }))

const base = (): FeynmanMeta =>
  newMeta(
    { topic: '梯度下降', scope: 'point', points: [...cores, ...extras], myths: [], from: [{ kind: 'word', word: '梯度下降' }], cover: [], basisLine: '', by: 'Claude Code · Opus 5.5' },
    { today: '2026-11-23', id: 'f-1' },
  )

describe('三档由软件算（teaching.md 1.3）', () => {
  it('讲清、追问后补上、说错后改对都算好', () => {
    expect(verdictOf(cores, st('clear', 'asked', 'fixed', 'clear'))).toBe('pass')
  })
  it('一条含糊或没讲到、没有讲错：差一点', () => {
    expect(verdictOf(cores, st('clear', 'clear', 'clear', 'vague'))).toBe('almost')
    expect(verdictOf(cores, st('clear', 'missing', 'clear', 'asked'))).toBe('almost')
  })
  it('两条以上缺：没过；有一条讲错：没过（别的全好也一样）', () => {
    expect(verdictOf(cores, st('clear', 'vague', 'missing', 'clear'))).toBe('fail')
    expect(verdictOf(cores, st('clear', 'wrong', 'clear', 'clear'))).toBe('fail')
  })
  it('AI 漏给的核心当没讲到；了解即可不算', () => {
    expect(verdictOf([...cores, ...extras], st('clear', 'clear', 'clear'))).toBe('almost')
    expect(verdictOf([...cores, ...extras], st('clear', 'clear', 'clear', 'clear'))).toBe('pass')
  })
})

describe('下次再讲的日子（teaching.md 3.4、1.6，已定 2、5）', () => {
  it('没过隔一天、差一点三天、过两周、第二次过起六周', () => {
    expect(nextDay('2026-11-23', 'fail')).toBe('2026-11-24')
    expect(nextDay('2026-11-23', 'almost')).toBe('2026-11-26')
    expect(nextDay('2026-11-23', 'pass', { passes: 1 })).toBe('2026-12-07')
    expect(nextDay('2026-11-23', 'pass', { passes: 2 })).toBe('2027-01-04')
  })
  it('看过材料：判定照常，过的两周改一周、六周改三周；没过、差一点不变', () => {
    expect(gapDays('pass', { passes: 1, peeks: 1 })).toBe(7)
    expect(gapDays('pass', { passes: 3, peeks: 2 })).toBe(21)
    expect(gapDays('fail', { peeks: 1 })).toBe(1)
    expect(gapDays('almost', { peeks: 1 })).toBe(3)
  })
  it('当场补讲的过：三天后', () => {
    expect(gapDays('pass', { redone: true, passes: 1 })).toBe(3)
    expect(inDays(3)).toBe('三天后')
  })
})

describe('缺口（teaching.md 4.1、4.3，已定 1）', () => {
  it('按讲错、含糊、没讲到排；说错后改对也出卡；追问后补上不进；了解即可灰着在最后、不勾', () => {
    const g = gapsOf({ points: [...cores, ...extras], topic: '梯度下降' }, st('missing', 'vague', 'wrong', 'fixed'), [{ id: 'c3', right: '新 θ = 旧 θ − α × 坡度，坡度为负时 θ 变大，这一句很长很长很长很长很长很长', src: 'p20 公式' }], { verdict: 'fail' })
    expect(g.map((x) => [x.point, x.kind, x.card])).toEqual([
      ['c3', 'wrong', true],
      ['c2', 'vague', true],
      ['c1', 'missing', true],
      ['c4', 'fixed', true],
      ['e1', 'extra', false],
    ])
    expect([...g[0]!.right].length).toBeLessThanOrEqual(40)
    expect(g[0]!.src).toBe('p20 公式')
  })
  it('过了：另加一张「用两三句讲清 X」，默认勾，答案是完整版', () => {
    const g = gapsOf({ points: [...cores, ...extras], topic: '梯度下降' }, st('clear', 'asked', 'clear', 'clear'), [{ id: 'e1', right: '像下山', src: 'AI 判断', said: true }], { verdict: 'pass', full: '完整版一段' })
    expect(g).toEqual([{ point: '*', kind: 'recap', quote: '', right: '完整版一段', src: '完整版', card: true }])
  })
  it('最多 5 条：核心的全留，了解即可截掉', () => {
    const many: Point[] = [...cores, ...['e1', 'e2', 'e3'].map((id) => ({ id, kind: 'extra' as const, text: id, answer: id, basis: 'x' }))]
    const g = gapsOf({ points: many, topic: 't' }, st('missing', 'missing', 'vague', 'vague'), [], { verdict: 'fail' })
    expect(g.length).toBe(5)
    expect(g.filter((x) => x.kind === 'extra').length).toBe(1)
  })
})

describe('判定一行和判完的注释', () => {
  it('没过：差在哪、下一步看哪里、明天再讲', () => {
    const m = judgedMeta(base(), { states: st('clear', 'wrong', 'vague', 'clear'), rights: [], full: '', today: '2026-11-23', prevPasses: 0 })
    expect(m).toMatchObject({ status: 'judged', verdict: 'fail', next: '2026-11-24', passes: 0 })
    expect(verdictLine(m)).toBe('没过：「核心2」说穿了才知道，「核心3」还含糊。下一步：看一眼p21，明天再讲；先把缺口出卡。')
  })
  it('差一点、过；看过材料多一句；第二次过六周', () => {
    const a = judgedMeta(base(), { states: st('clear', 'clear', 'vague', 'clear'), rights: [], full: '', today: '2026-11-23', prevPasses: 0 })
    expect(verdictLine(a)).toBe('差一点：核心4条讲清3条，「核心3」还含糊。下一步：再讲这1处，或出卡；三天后再讲。')
    const p = judgedMeta(withPeek(base()), { states: st('clear', 'fixed', 'clear', 'asked'), rights: [], full: '', today: '2026-11-23', prevPasses: 1 })
    expect(p).toMatchObject({ verdict: 'pass', passes: 2, next: '2026-12-14' })
    expect(verdictLine(p)).toBe('过：核心4条都讲清了。「核心2」是说错后自己改对的，出一张卡。下一步：三周后再讲。讲的时候看过材料1次：判定照常，下次再讲的日子提前。')
  })
  it('当场补讲：缺的全补上了改成「过 · 当场补讲」三天后；只补上一部分不改判定', () => {
    const m = judgedMeta(base(), { states: st('clear', 'vague', 'missing', 'clear'), rights: [], full: '', today: '2026-11-23', prevPasses: 0 })
    const half = redoneMeta(m, [{ id: 'c2', state: 'clear', quote: '补' }, { id: 'c3', state: 'vague', quote: '还是不会' }], '2026-11-23')
    expect(half.verdict).toBe('fail')
    expect(half.gaps!.find((g) => g.point === 'c2')!.redone).toBe(true)
    const all = redoneMeta(half, [{ id: 'c3', state: 'clear', quote: '会了' }], '2026-11-23')
    expect(all).toMatchObject({ verdict: 'pass', redone: true, next: '2026-11-26' })
    expect(verdictLine(all)).toBe('过 · 当场补讲：缺的几处当场讲清了。下一步：三天后再讲一次。')
    // 原来的状态留着（这一轮的实情）
    expect(all.states!.find((s) => s.id === 'c3')!.state).toBe('missing')
  })
})

describe('你的改动（teaching.md 2.2）', () => {
  it('移到了解即可、改名、删掉、加一条；核心超过 5 条提示拆', () => {
    const p = applyEdits(cores, [
      { op: 'move', id: 'c4', to: 'extra' },
      { op: 'rename', id: 'c1', text: '从哪开始' },
      { op: 'drop', id: 'c2' },
      { op: 'add', id: 'u1', text: '为什么要减' },
    ])
    expect(p.map((x) => [x.id, x.kind, x.text])).toEqual([
      ['c1', 'core', '从哪开始'],
      ['c3', 'core', '核心3'],
      ['c4', 'extra', '核心4'],
      ['u1', 'core', '为什么要减'],
    ])
    expect(tooManyCores([...cores, ...cores.map((c) => ({ ...c, id: c.id + 'b' }))])).toBe(true)
    expect(tooManyCores(cores)).toBe(false)
  })
})

describe('追问轮次', () => {
  it('同一条连着问算一轮；确认、答「要不要会」不算；说穿以后不再算连着没答对', () => {
    expect(roundsUsed([{ act: 'confirm' }, { act: 'ask', point: 'c2' }, { act: 'ask', point: 'c2', miss: 1 }, { act: 'reveal', point: 'c2' }, { act: 'ask', point: 'c4' }, { act: 'answer' }])).toBe(2)
    expect(lastAsk([{ act: 'ask', point: 'c2', miss: 1 }])).toEqual({ act: 'ask', point: 'c2', miss: 1 })
    expect(lastAsk([{ act: 'ask', point: 'c2' }, { act: 'reveal', point: 'c2' }])).toBeUndefined()
  })
  it('暂停以后接着讲：记一次看过材料', () => {
    expect(resumed({ ...base(), status: 'paused' })).toMatchObject({ status: 'talking', peeks: 1 })
  })
})

describe('写进文档的几块（设计复审改的）', () => {
  it('判定块「下一步」另起一行；缺口的出处带材料名和页；列头的数', () => {
    const src = { kind: 'pdf' as const, path: '课程/线代/第3讲 线性映射.pdf', page: 2 }
    const m0 = { ...base(), points: base().points.map((p) => ({ ...p, src })), siblings: ['向量', '梯度下降', '矩阵'], asked: [{ act: 'ask' as const, point: 'c1' }, { act: 'ask' as const, point: 'c2' }] }
    const m = judgedMeta(m0, { states: st('clear', 'wrong', 'clear', 'clear'), rights: [{ id: 'c2', right: '减', src: '公式 (2.3.10)' }], full: '', today: '2026-11-23', prevPasses: 0 })
    expect(verdictBody(m).split('\n').slice(0, 2)).toEqual(['没过：「核心2」说穿了才知道。', '下一步：看一眼p21，明天再讲；先把缺口出卡。'])
    expect(gapsBody(m).split('\n')[0]).toBe('- 讲错 · 核心2：你说「原话2」 → 减（《第3讲 线性映射》第 2 页 · 公式 (2.3.10)）')
    expect(m.gaps![0]!.ref).toEqual(src)
    expect(headerInfo(m)).toEqual({ nth: 1, rounds: 2, index: 2, total: 3 })
  })
})
