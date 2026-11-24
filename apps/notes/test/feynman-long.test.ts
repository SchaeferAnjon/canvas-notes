/**
 * 费曼「聊到底」（shared/feynman/long.ts，design/feynman-long/notes.md）：软件排缺口清单、定这一问盯哪条哪一步；
 * 换角度 → 提示 → 说穿；问为什么；说穿吧、先跳过；说反的躲不掉；问空了问收尾、往深里聊；判定的状态、出卡、日子；
 * 旧的三轮那几节、几十问的长谈一节打开再保存逐字节不变。AI 用 CN_AI_FAKE 那一套假回答（fake.ts 的 fakeLongTurn）。
 */
import { splitDoc } from '@cn/format'
import { describe, expect, it } from 'vitest'
import type { TurnResult } from '../src/shared/feynman/api'
import { addRound, appendEntry, findRounds, metaLine, putBlock, setMeta } from '../src/shared/feynman/doc'
import { fakeExtract } from '../src/shared/feynman/fake'
import { type AskQ, type FlowDeps, judge, turn } from '../src/shared/feynman/flow'
import { decide, finishLong, longLabels, longLine, oneAsk, pendingAsk, queueOf, talkStates, toLong } from '../src/shared/feynman/long'
import { parseExtract } from '../src/shared/feynman/prompts'
import { newMeta } from '../src/shared/feynman/round'
import type { Entry, FeynmanMeta } from '../src/shared/feynman/types'

const BY = 'Claude Code · Opus 5.5'

function gdMeta(o: Partial<FeynmanMeta> = {}): FeynmanMeta {
  const p = parseExtract(fakeExtract('梯度下降', { scope: 'point', topic: '梯度下降' }))[0]!
  const m = newMeta({ topic: p.topic, scope: 'point', points: p.points, myths: p.myths, from: [{ kind: 'word', word: '梯度下降' }], cover: [], basisLine: '', by: BY }, { today: '2026-11-24', id: 'f-long' })
  return { ...m, mode: 'long', ...o }
}

function deps(log: AskQ[] = []): FlowDeps {
  return {
    gather: {} as FlowDeps['gather'],
    ask: async (q) => {
      log.push(q)
      return q.fake()
    },
    by: () => BY,
  }
}

/** 一场聊到底：文档、注释跟着走（和界面 store.ts 写文档的顺序一样） */
class Talk {
  text: string
  meta: FeynmanMeta
  log: AskQ[] = []
  results: TurnResult[] = []
  constructor(meta: FeynmanMeta, before = '') {
    this.meta = meta
    this.text = addRound(before, meta)
  }
  entries() {
    return findRounds(this.text)
      .find((r) => r.meta.id === this.meta.id)!
      .entries.map((e: Entry) => ({ kind: e.kind, text: e.text }))
  }
  async say(words: string | null, cmd?: 'reveal' | 'skip' | 'deep' | 'more', d: FlowDeps = deps(this.log)) {
    if (words) this.text = appendEntry(this.text, this.meta.id, 'me', words)
    const t = await turn({ reqId: 1, meta: this.meta, entries: this.entries(), ...(cmd ? { cmd } : {}) }, d)
    this.meta = t.meta
    this.text = setMeta(this.text, t.meta)
    if (t.reveal) this.text = appendEntry(this.text, this.meta.id, 'reveal', t.reveal, t.by)
    if (t.say) this.text = appendEntry(this.text, this.meta.id, t.act === 'confirm' ? 'confirm' : 'student', t.say, t.by)
    this.results.push(t)
    return t
  }
  async finish() {
    const f = finishLong(this.meta)
    this.meta = f.meta
    this.text = setMeta(this.text, f.meta)
    for (const r of f.reveals) this.text = appendEntry(this.text, this.meta.id, 'reveal', r.text, BY)
    const j = await judge({ reqId: 2, meta: this.meta, entries: this.entries(), today: '2026-11-24', prevPasses: 0 }, deps())
    this.meta = j.meta
    this.text = setMeta(this.text, j.meta)
    for (const k of ['verdict', 'gaps', 'wording', 'full'] as const) this.text = putBlock(this.text, this.meta.id, k, j.blocks[k] ?? '', j.by)
    return j
  }
}

const OWN = '梯度下降就是先随便猜一个初始值 然后每一步 新的西塔等于原来的西塔减去学习力乘坡度 一直重复'

describe('聊到底：软件排的缺口清单', () => {
  it('说反的 → 含糊的 → 没碰的；自己讲清了的不问', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3'], weak: ['c3'], flip: ['c2'] })
    expect(queueOf(m).map((q) => `${q.step}:${q.point}`)).toEqual(['wrong:c2', 'weak:c3', 'new:c4'])
    expect(queueOf(m)[0]!.myth).toBe('m1')
  })

  it('核心都聊过了：一个知识点要一个带数的例子（挂误解最多的那条），再拿一条没用过的误解试；串讲问怎么接', () => {
    const all = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'] })
    expect(queueOf(all).map((q) => q.step)).toEqual(['example', 'myth'])
    expect(queueOf({ ...all, scope: 'section' }).map((q) => q.step)).toEqual(['chain'])
    const used = { ...all, asked: [{ act: 'ask' as const, step: 'example' as const, point: 'c2', res: 'right' as const }, { act: 'ask' as const, step: 'myth' as const, point: 'c2', res: 'right' as const }] }
    expect(queueOf(used)).toEqual([{ step: 'offer' }])
  })

  it('选了往深里聊：了解即可、变式各一次，问空了再问一次收尾', () => {
    const base = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'], asked: [{ act: 'ask', step: 'example', point: 'c2', res: 'right' }, { act: 'ask', step: 'myth', point: 'c2', res: 'right' }, { act: 'offer' }], deep: 1 })
    expect(queueOf(base).map((q) => `${q.step}:${q.point}`)).toEqual(['deep:e1', 'deep:e2', 'deep:c1', 'deep:c2', 'deep:c3', 'deep:c4'])
    const asked = [...base.asked, ...['e1', 'e2', 'c1', 'c2', 'c3', 'c4'].map((p) => ({ act: 'ask' as const, step: 'deep' as const, point: p, res: 'right' as const }))]
    expect(queueOf({ ...base, asked })).toEqual([{ step: 'offer' }])
  })

  it('深聊里把一条核心说反了：退回第 1 步按说错问', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'], asked: [{ act: 'offer' }], deep: 1, flip: ['c3'] })
    expect(queueOf(m)[0]).toEqual({ step: 'wrong', point: 'c3', myth: 'm2' })
  })
})

describe('聊到底：一整场（假 AI）', () => {
  it('换角度 → 提示 → 第三次说穿；说穿后隔两问换个情形再问，答上了：过 · 当场补讲，三天后', async () => {
    const t = new Talk(gdMeta())
    let r = await t.say(OWN)
    expect([r.act, r.point, r.step]).toEqual(['ask', 'c3', 'new'])
    r = await t.say('太大会在两边来回跳 甚至发散')
    expect([r.point, r.step]).toEqual(['c4', 'new'])
    r = await t.say('嗯 各算各的吧')
    expect([r.point, r.step]).toEqual(['c4', 'angle'])
    expect(r.reveal).toBeUndefined()
    r = await t.say('我想想 还是一个一个改')
    expect([r.point, r.step]).toEqual(['c4', 'hint'])
    expect(r.say).toMatch(/^提示一下/)
    expect(r.say).not.toMatch(/同时|旧值|一起改/)
    r = await t.say('还是不太会')
    expect(r.reveal).toContain('出处：p20')
    expect([r.point, r.step]).toEqual(['c2', 'example'])
    r = await t.say('比如坡度是负八 减去零点一乘负八 西塔就变大了')
    expect(r.step).toBe('myth')
    r = await t.say('不对 梯度负的时候减去一个负数 西塔变大')
    expect([r.point, r.step]).toEqual(['c4', 'again'])
    r = await t.say('都先用旧的算完 再一起改')
    expect(r.act).toBe('offer')
    expect(r.say).toBe('我想问的都问完了。收个尾看判定，还是接着往深里聊？')
    expect(longLabels(t.meta).students).toEqual(['new', 'new', 'angle', 'hint', 'example', 'myth', 'again', 'offer'])
    expect(longLabels(t.meta).reveals).toEqual(['reveal'])
    const j = await t.finish()
    expect(j.meta.states!.map((s) => [s.id, s.state, s.via ?? ''])).toEqual([
      ['c1', 'clear', ''],
      ['c2', 'clear', ''],
      ['c3', 'asked', ''],
      ['c4', 'vague', 'again'],
    ])
    expect(j.meta.verdict).toBe('pass')
    expect(j.meta.redone).toBe(true)
    expect(j.meta.next).toBe('2026-11-27')
    expect(t.text).toContain('说穿过的几处后来换个情形讲清了')
    expect(t.text).toContain('✓ 说穿后补讲清')
    expect(t.text).toContain('问了7次 · 提示1次')
  })

  it('只挑了选项：下一问问为什么，不往说穿那边数；再只挑选项才算没答上', async () => {
    const t = new Talk(gdMeta())
    await t.say(OWN)
    await t.say('太大会来回跳')
    let r = await t.say('改之前的')
    expect([r.point, r.step]).toEqual(['c4', 'why'])
    expect(t.meta.asked.at(-1)!.miss).toBeUndefined()
    r = await t.say('对')
    expect([r.point, r.step]).toEqual(['c4', 'angle'])
  })

  it('提示后答上：追问后补上（提示后），出卡，过的下次再讲提前到一周', async () => {
    const t = new Talk(gdMeta())
    await t.say(OWN + ' 太大了会来回跳')
    let r = await t.say('各算各的')
    expect(r.step).toBe('angle')
    r = await t.say('一个个改')
    expect(r.step).toBe('hint')
    await t.say('哦 要同时更新 先用旧的算完再一起改')
    const j = await t.finish()
    const c4 = j.meta.states!.find((s) => s.id === 'c4')!
    expect([c4.state, c4.via]).toEqual(['asked', 'hint'])
    expect(j.meta.verdict).toBe('pass')
    expect(j.meta.next).toBe('2026-12-01')
    expect(j.meta.gaps!.find((g) => g.point === 'c4')).toMatchObject({ kind: 'asked', via: 'hint', card: true })
    expect(t.text).toContain('追问后补上（提示后）')
    expect(t.text).toContain('「好几个参数时怎么改」是提示后答上的，出一张卡')
  })

  it('点「说穿吧」或说「不知道」：直接说穿，不走完三步', async () => {
    const t = new Talk(gdMeta())
    await t.say(OWN)
    let r = await t.say(null, 'reveal')
    expect(r.reveal).toContain('α 太小走得慢')
    expect(r.point).toBe('c4')
    r = await t.say('不知道')
    expect(r.reveal).toContain('同时更新')
    expect(t.meta.asked.filter((a) => a.act === 'reveal').map((a) => a.point)).toEqual(['c3', 'c4'])
  })

  it('先跳过：排到最后，其他都问完再回来问一次；再跳过记没讲到', async () => {
    const t = new Talk(gdMeta())
    await t.say(OWN)
    let r = await t.say(null, 'skip')
    expect(r.point).toBe('c4')
    r = await t.say('同时更新 先用旧的算完再一起改')
    expect(r.step).toBe('example')
    r = await t.say('比如坡度负八 减去零点一乘负八 变大')
    r = await t.say('不对 减去一个负数 变大')
    expect([r.point, r.step]).toEqual(['c3', 'later'])
    r = await t.say(null, 'skip')
    expect(r.act).toBe('offer')
    const j = await t.finish()
    expect(j.meta.states!.find((s) => s.id === 'c3')!.state).toBe('missing')
    expect(t.text).toContain('「学习率太大、太小会怎样」跳过了两次，记没讲到')
    expect(t.text).not.toContain('收尾时还有')
  })

  it('说反了的躲不掉：第二次跳过软件直接说穿，记讲错', async () => {
    const t = new Talk(gdMeta())
    let r = await t.say('从一个随机的西塔开始 新的西塔等于旧的西塔加上学习力乘梯度 太大会震荡 好几个参数要同时更新 先用旧的算完再一起改')
    expect(r.act).toBe('confirm')
    r = await t.say('对 是加上')
    expect([r.point, r.step]).toEqual(['c2', 'wrong'])
    expect(r.say).toContain('梯度是负的，θ 就往小里走')
    expect(t.meta.flip).toEqual(['c2'])
    r = await t.say(null, 'skip')
    // 跳过的排到最后：别的先问（带数的例子、另一条误解），再回来
    expect([r.point, r.step]).toEqual(['c3', 'example'])
    r = await t.say('比如阿尔法取一 每步就跳过头 来回跳')
    expect([r.point, r.step]).toEqual(['c4', 'myth'])
    r = await t.say('不对 每步走的是阿尔法乘坡度 太大会来回跳')
    expect([r.point, r.step]).toEqual(['c2', 'later'])
    r = await t.say(null, 'skip')
    expect(r.revealFlip).toBe(true)
    expect(r.reveal).toContain('坡度为负时 θ 变大')
    expect(r.act).toBe('offer')
    const j = await t.finish()
    expect(j.meta.states!.find((s) => s.id === 'c2')!.state).toBe('wrong')
    expect(j.meta.verdict).toBe('fail')
  })

  it('说反了还没问清就收尾：收尾前软件先说穿，记讲错', async () => {
    const t = new Talk(gdMeta())
    await t.say('从一个随机的西塔开始 新的西塔等于旧的西塔加上学习力乘梯度 太大会震荡 好几个参数要同时更新 先用旧的算完再一起改')
    await t.say('对 是加上')
    const body = (x: string) => x.replace(/<!-- feynman .* -->/, '')
    const before = body(t.text).trimEnd()
    const j = await t.finish()
    expect(body(t.text).startsWith(before + '\n\n> [!ai] 说穿')).toBe(true)
    expect(longLabels(j.meta).reveals).toEqual(['end'])
    expect(j.meta.states!.find((s) => s.id === 'c2')!.state).toBe('wrong')
    expect(j.meta.verdict).toBe('fail')
  })

  it('说反的那条第二次跳过：软件说穿，记讲错', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'], flip: ['c2'], asked: [{ act: 'ask', point: 'c2', step: 'wrong', skip: 1 }, { act: 'ask', point: 'c2', step: 'later' }] })
    const d = decide(m, { entries: [{ kind: 'student', text: '…' }], cmd: 'skip' }, { last: 'none', touched: [], weak: [], wrong: [] })
    expect(d.reveal).toEqual({ point: 'c2', flip: true })
    expect(d.flip).toEqual([])
  })

  it('问收尾后选「接着往深里聊」：问了解即可和变式，每条一次；问空了再问一次收尾', async () => {
    const t = new Talk(gdMeta())
    await t.say('从初始值开始一步步走 新的西塔等于旧的减去学习力乘坡度 太大会来回跳 发散 好几个参数同时更新 先用旧的算完再一起改')
    await t.say('比如坡度负八 减去零点一乘负八 变大')
    let r = await t.say('不对 减去一个负数 变大')
    expect(r.act).toBe('offer')
    r = await t.say(null, 'deep')
    expect([r.point, r.step]).toEqual(['e1', 'deep'])
    for (const _ of ['e2', 'c1', 'c2', 'c3', 'c4']) r = await t.say('嗯 会反过来走')
    r = await t.say('嗯 会反过来走')
    expect(r.act).toBe('offer')
    expect(t.meta.deep).toBe(1)
    const j = await t.finish()
    expect(j.meta.verdict).toBe('pass')
  })

  it('AI 盯错了那条：按软件定的那条重问一次；还不对就软件自己写', async () => {
    const m = gdMeta({ touched: ['c1', 'c2'] })
    const t = new Talk(m)
    t.text = appendEntry(t.text, m.id, 'me', OWN)
    const wrongPoint: FlowDeps = { ...deps(), ask: async () => JSON.stringify({ last: 'none', act: 'ask', point: 'c1', say: '对，我懂了。那 c1 呢？再问一句？', touched: [], weak: [], wrong: [] }) }
    const r = await turn({ reqId: 1, meta: m, entries: t.entries() }, wrongPoint)
    expect(r.point).toBe('c3')
    expect(r.say).toBe('那学习率太大、太小会怎样？')
    const calls: AskQ[] = []
    let n = 0
    const fixedOnRetry: FlowDeps = {
      ...deps(),
      ask: async (q) => {
        calls.push(q)
        return n++ === 0 ? JSON.stringify({ last: 'none', act: 'ask', point: 'c1', say: 'x？', touched: [], weak: [], wrong: [] }) : JSON.stringify({ point: 'c3', say: '没错。你说「一直重复」。那步子迈多大合适？还有呢？' })
      },
    }
    const r2 = await turn({ reqId: 1, meta: m, entries: t.entries() }, fixedOnRetry)
    expect(calls.length).toBe(2)
    expect(calls[1]!.prompt).toContain('这一问盯 c3「学习率太大、太小会怎样」')
    expect(r2.say).toBe('你说「一直重复」。那步子迈多大合适？')
  })

  it('提示里带出了答案的关键词：重问一次，还带着就退回成只换角度', async () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3'], asked: [{ act: 'ask', point: 'c4', step: 'angle', miss: 1 }] })
    const t = new Talk(m)
    t.text = appendEntry(t.text, m.id, 'me', '一个一个改')
    const leaky: FlowDeps = { ...deps(), ask: async () => JSON.stringify({ last: 'miss', act: 'ask', point: 'c4', say: '提示一下：是不是要同时改？', touched: [], weak: [], wrong: [] }) }
    const r = await turn({ reqId: 1, meta: m, entries: t.entries() }, leaky)
    expect(r.step).toBe('angle')
    expect(r.say).not.toContain('同时')
    expect(r.meta.asked.at(-1)).toMatchObject({ point: 'c4', step: 'angle', miss: 2 })
  })

  it('三轮用完点「接着聊下去」：转成聊到底，前面三轮照算', async () => {
    const three = gdMeta({ mode: undefined, touched: ['c1', 'c2'], asked: [{ act: 'ask', point: 'c3' }, { act: 'ask', point: 'c4' }, { act: 'ask', point: 'c4', miss: 1 }, { act: 'reveal', point: 'c4' }] })
    delete three.mode
    const l = toLong(three)
    expect(l.mode).toBe('long')
    expect(l.asked[0]!.res).toBe('right')
    expect(pendingAsk(l.asked)).toBe(-1)
    const t = new Talk(three)
    t.text = appendEntry(t.text, three.id, 'me', OWN)
    const r = await turn({ reqId: 1, meta: three, entries: t.entries(), cmd: 'more' }, deps())
    expect(r.meta.mode).toBe('long')
    expect(r.step).toBe('example')
  })
})

describe('聊到底：教学复审补的几条', () => {
  const R = (o: Partial<{ last: 'right' | 'miss' | 'pick' | 'none'; touched: string[]; weak: string[]; wrong: string[] }> = {}) => ({ last: 'none' as const, touched: [], weak: [], wrong: [], ...o })
  const me = (text: string) => [{ kind: 'student' as const, text: '…' }, { kind: 'me' as const, text }]

  it('加分题（带数的例子）上说「不知道」：给他看说穿，但不算这条核心说穿过', async () => {
    const t = new Talk(gdMeta())
    await t.say('从初始值开始一步步走 新的西塔等于原来的减去学习力乘坡度 太大会来回跳 发散 好几个参数同时更新 先用旧的算完再一起改')
    expect(t.results.at(-1)!.step).toBe('example')
    const r = await t.say('嗯 不知道')
    expect(r.reveal).toBeTruthy()
    expect(t.meta.asked.find((a) => a.act === 'reveal')).toMatchObject({ free: 1 })
    const j = await t.finish()
    expect(j.meta.states!.find((s) => s.id === 'c2')!.state).toBe('clear')
    expect(j.meta.verdict).toBe('pass')
  })

  it('含糊的账是累加的：AI 这次漏写了，那条照样排着', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'], weak: ['c1', 'c3'], asked: [{ act: 'ask', point: 'c1', step: 'weak' }] })
    const d = decide(m, { entries: me('从一个初始值出发 一步步挪 损失变小') }, R({ last: 'right' }))
    expect(d.next).toEqual({ step: 'weak', point: 'c3' })
  })

  it('他没在答（反问）：照这一步再问一次，不算没答上；连着第二次才算', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3'], asked: [{ act: 'ask', point: 'c4', step: 'new' }] })
    const d = decide(m, { entries: me('你是说两个参数的时候吗') }, R({ last: 'none' }))
    expect([d.next, d.miss]).toEqual([{ step: 'new', point: 'c4' }, 0])
    const m2 = { ...m, asked: [...d.asked, { act: 'ask' as const, point: 'c4', step: 'new' as const }] }
    const d2 = decide(m2, { entries: me('啊？哪个参数') }, R({ last: 'none' }))
    expect([d2.next, d2.miss]).toEqual([{ step: 'angle', point: 'c4' }, 1])
  })

  it('「不知道」认口头禅开头的，单独一个「不会」（可能是答对的）不当放弃', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3'], asked: [{ act: 'ask', point: 'c4', step: 'new' }] })
    expect(decide(m, { entries: me('嗯 不太清楚') }, R({ last: 'miss' })).reveal).toEqual({ point: 'c4', flip: false })
    expect(decide(m, { entries: me('不会') }, R({ last: 'right' })).reveal).toBeUndefined()
    expect(decide(m, { entries: me("i dont know why but it moves left") }, R({ last: 'miss' })).reveal).toBeUndefined()
  })

  it('拿常见误解问过去他说「对」：算没答上，往换角度走，不问为什么', () => {
    const m = gdMeta({ touched: ['c1', 'c2', 'c3', 'c4'], flip: ['c2'], asked: [{ act: 'ask', point: 'c2', step: 'wrong', myth: undefined } as never] })
    const d = decide(m, { entries: me('对') }, R({ last: 'pick', wrong: ['c2'] }))
    expect(d.next).toEqual({ step: 'angle', point: 'c2' })
  })

  it('说穿以后别的都问空了：隔一问就换个情形再问，一问没隔先问收尾', () => {
    const base = gdMeta({ touched: ['c1', 'c2', 'c3'], asked: [{ act: 'ask', point: 'c2', step: 'example', res: 'right' }, { act: 'ask', point: 'c3', step: 'myth', res: 'right' }, { act: 'ask', point: 'c4', step: 'new', res: 'miss' }, { act: 'reveal', point: 'c4' }] })
    expect(queueOf(base)).toEqual([{ step: 'offer' }])
    const one = { ...base, deep: 1, asked: [...base.asked, { act: 'offer' as const }, { act: 'ask' as const, point: 'e1', step: 'deep' as const, res: 'right' as const }] }
    expect(queueOf(one)[0]).toEqual({ step: 'again', point: 'c4' })
  })

  it('提示后答上、过了：判定那行写一周后，和真的日子一样', async () => {
    const t = new Talk(gdMeta())
    await t.say(OWN + ' 太大了会来回跳')
    await t.say('各算各的')
    const r = await t.say('一个个改')
    expect(r.say).toContain('坡度是在你脚下那个点量的')
    await t.say('哦 要同时更新 先用旧的算完再一起改')
    const j = await t.finish()
    expect(j.meta.next).toBe('2026-12-01')
    expect(t.text).toContain('下次再讲提前到一周。\n> 下一步：一周后再讲')
  })
})

describe('聊到底：软件兜底和进度', () => {
  it('一次一问：第二个问句切掉，「对」「懂了」这类评价删掉，问句前只留引原话那一小段', () => {
    expect(oneAsk('对，我懂了。梯度下降是一种优化方法。你说「往下走」，那走多远？还有学习率呢？')).toBe('你说「往下走」，那走多远？')
    expect(oneAsk('对不对呢？')).toBe('对不对呢？')
    // 引的原话里带句号：右引号那一截不能切掉
    expect(oneAsk('你说「我还是说不明白。」。那好几个参数时怎么改？')).toBe('你说「我还是说不明白。」。那好几个参数时怎么改？')
    expect(oneAsk('明白了！提示一下：坡度是在脚下那个点量的。先改了 θ₀，你还站在原来那个点吗？', true)).toBe('提示一下：坡度是在脚下那个点量的。先改了 θ₀，你还站在原来那个点吗？')
  })

  it('中途进度只看聊到哪了：聊过、正在聊、还没聊、说穿过、跳过了（不给对错）', () => {
    const m = gdMeta({ touched: ['c1'], asked: [{ act: 'ask', point: 'c2', step: 'new', res: 'miss' }, { act: 'reveal', point: 'c2' }, { act: 'ask', point: 'c3', step: 'new', skip: 1 }, { act: 'ask', point: 'c4', step: 'new' }] })
    expect(talkStates(m).map((s) => s.state)).toEqual(['done', 'revealed', 'skipped', 'now'])
  })

  it('长谈记录一行：0 的项不写，分钟取整，不到 1 分钟写「不到1分钟」', () => {
    const asked = [{ act: 'ask' as const, point: 'c1', step: 'hint' as const }, { act: 'ask' as const, point: 'c1' }]
    expect(longLine(gdMeta({ asked, secs: 14 * 60 + 20 }))).toBe('聊了14分钟 · 问了2次 · 提示1次')
    expect(longLine(gdMeta({ asked: [{ act: 'ask', point: 'c1' }], secs: 30 }))).toBe('聊了不到1分钟 · 问了1次')
    expect(longLine(gdMeta())).toBe('')
  })

  it('三轮模式不受影响：没有 mode 的一轮走原来的规矩（三轮用完 done，注释里不记 step、res）', async () => {
    const m = gdMeta({ touched: ['c1', 'c2'], asked: [{ act: 'ask', point: 'c3' }, { act: 'ask', point: 'c4' }, { act: 'ask', point: 'c1' }] })
    delete m.mode
    const r = await turn({ reqId: 1, meta: m, entries: [{ kind: 'me', text: OWN }] }, deps())
    expect(r.act).toBe('done')
    expect(r.meta.mode).toBeUndefined()
    expect(JSON.stringify(r.meta.asked)).not.toMatch(/"step"|"res"/)
  })
})

describe('打开再保存逐字节不变', () => {
  const OLD = `# 线代

## 费曼 · 范数
${metaLine({ ...gdMeta(), mode: undefined, id: 'f-old', topic: '范数', asked: [{ act: 'ask', point: 'c2' }, { act: 'ask', point: 'c2', miss: 1 }, { act: 'reveal', point: 'c2' }, { act: 'ask', point: 'c3' }] } as FeynmanMeta).replace(',"mode":undefined', '')}

范数量的是向量有多大

> [!ai] 学生 · Claude Code · Opus 5.5
> 你说「向量有多大」。那放大 α 倍会怎样？

不知道

> [!ai] 说穿 · Claude Code · Opus 5.5
> 是 |α| 倍。出处：公式 (2.3.10)。

## 别的
`

  it('旧的三轮那几节：读进来再写回逐字节不变，注释里没有 mode', () => {
    const rounds = findRounds(OLD)
    expect(rounds.length).toBe(1)
    expect(rounds[0]!.meta.mode).toBeUndefined()
    expect(OLD).not.toContain('"mode"')
    let t = OLD
    for (const r of rounds) t = setMeta(t, r.meta)
    expect(t).toBe(OLD)
    expect(metaLine(rounds[0]!.meta)).toBe(OLD.split('\n')[3])
    const b = splitDoc(OLD)
    for (const c of b.columns) for (const u of c.cards) expect(OLD.slice(u.from, u.to)).toBe(u.text)
  })

  it('几十问的长谈一节：读进来再写回逐字节不变，注释照旧一行', async () => {
    const t = new Talk(gdMeta(), '# 白板\n\n## 第一列\n\n一张卡。\n')
    await t.say('嗯 梯度下降嘛 就是往下走')
    for (let i = 0; i < 30; i++) {
      const r = await t.say(i % 5 === 4 ? null : i % 3 ? '嗯 各算各的吧 我想想' : '比如坡度负八 减去零点一乘负八 变大 太大会来回跳 同时更新先用旧的算完再一起改', i % 5 === 4 ? (t.results.at(-1)!.act === 'offer' ? 'deep' : 'skip') : undefined)
      if (r.act === 'offer' && i % 5 !== 3) await t.say(null, 'deep')
    }
    t.meta = { ...t.meta, secs: 1520 }
    t.text = setMeta(t.text, t.meta)
    await t.finish()
    const asks = t.meta.asked.length
    expect(asks).toBeGreaterThanOrEqual(30)
    const text = t.text
    const [r] = findRounds(text)
    expect(r!.meta).toEqual(t.meta)
    expect(setMeta(text, r!.meta)).toBe(text)
    const line = text.split('\n').find((l) => l.startsWith('<!-- feynman'))!
    expect(line).toBe(metaLine(r!.meta))
    expect(line.length).toBeLessThan(12000)
    expect(text.split('\n').filter((l) => l.startsWith('<!-- feynman')).length).toBe(1)
    const b = splitDoc(text)
    for (const c of b.columns) for (const u of c.cards) expect(text.slice(u.from, u.to)).toBe(u.text)
  })
})
