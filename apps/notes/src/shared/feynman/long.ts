/**
 * 费曼「聊到底」（design/feynman-long/notes.md 方向 A）：不限轮。软件排缺口清单、定这一问盯哪条走哪一步，AI 学生只写那一句话。
 *
 * - 清单（queueOf）：说反的 → 含糊的 → 没碰的 → 核心都聊过了按大小问（带数的例子、常见误解 / 串讲问怎么接）→ 跳过的回来再问一次 → 问你收尾还是接着往深里聊；
 *   选了往深里聊才问了解即可和变式（每条一次，不判）。
 * - 同一条没答上：第 1 次换个角度、第 2 次给一个不带答案的提示、第 3 次说穿；你点「说穿吧」或说「不知道」直接说穿。
 *   只挑了选项、只说「对」：下一问问为什么，不往说穿那边数。说穿了的隔至少两问换个情形再问一次。
 * - 说反的躲不掉：第二次跳过软件直接说穿、收尾前软件先说穿，都记讲错。
 *
 * 三轮模式不走这里：flow.ts 的 turn 只在 meta.mode 是 long 时转过来，ROUNDS_MAX、roundsUsed 不动。
 * 不依赖 Electron、Node。
 */
import type { TurnReq, TurnResult } from './api'
import type { FlowDeps, ImageIn } from './flow'
import { fakeLongTurn } from './fake'
import { CHAIN_ASK, parseJson, pointLine, str, transcript } from './prompts'
import { clipRight, gapsOf, judgedMeta, nextDay, type RightOf } from './rules'
import { type Asked, type CoreJudged, type Entry, type FeynmanMeta, type Gap, isGood, type LongStep, type Point } from './types'

type Lite = Pick<Entry, 'kind' | 'text'>

const COUNTS = new Set(['ask', 'redirect'])
const isAsk = (a: Asked) => COUNTS.has(a.act)
const coresOf = (m: FeynmanMeta) => m.points.filter((p) => p.kind === 'core')
/** 这几步答没答上不走「换角度 → 提示 → 说穿」：说穿后再问、核心都聊过了的例子 / 误解 / 串讲、往深里聊 */
const NO_LADDER = new Set<LongStep>(['again', 'example', 'myth', 'chain', 'deep'])
/** 加分题：核心都聊过了以后问的例子、误解、串讲和往深里聊；答不上、说穿、跳过都不碰那条核心 */
const BONUS = new Set<LongStep>(['example', 'myth', 'chain', 'deep'])

/** 「接着聊下去」：三轮用完转成聊到底，前面三轮照算（三轮记的问没记答上没有：后面跟着说穿的算说穿过，别的算答上，最后一问等你这一段来判） */
export function toLong(meta: FeynmanMeta): FeynmanMeta {
  if (meta.mode === 'long') return meta
  const asked = meta.asked.map((a) => ({ ...a }))
  const last = asked.map((a, i) => (isAsk(a) ? i : -1)).filter((i) => i >= 0)
  for (const i of last.slice(0, -1)) {
    const a = asked[i]!
    const after = asked.slice(i + 1).find((x) => isAsk(x) || x.act === 'reveal')
    if (after?.act === 'reveal' || (after && after.point === a.point)) continue
    a.res = 'right'
  }
  return { ...meta, mode: 'long', asked, status: meta.status === 'judged' ? 'talking' : meta.status }
}

/** 还在等你答的那一问（最后一问没记答上没有、没跳过、后面没说穿） */
export function pendingAsk(asked: readonly Asked[]): number {
  for (let i = asked.length - 1; i >= 0; i--) {
    const a = asked[i]!
    if (a.act === 'reveal' || a.act === 'offer' || a.act === 'done') return -1
    if (isAsk(a)) return a.res || a.skip ? -1 : i
  }
  return -1
}

interface Fact {
  /** 被问时答上过 */
  right: boolean
  /** 提示后答上的（没说穿） */
  hintRight: boolean
  revealed: boolean
  /** 说穿时这一条是说反着的 */
  flipReveal: boolean
  /** 最后一次说穿在 asked 里的位置 */
  revealAt: number
  /** 给过提示（之后答上算提示后答上） */
  hinted: boolean
  /** 说穿后换个情形再问过 */
  again: boolean
  againRight: boolean
  skips: number
  asks: number
}

function factsOf(m: FeynmanMeta): Map<string, Fact> {
  const out = new Map<string, Fact>()
  for (const p of m.points) out.set(p.id, { right: false, hintRight: false, revealed: false, flipReveal: false, revealAt: -1, hinted: false, again: false, againRight: false, skips: 0, asks: 0 })
  m.asked.forEach((a, i) => {
    const f = a.point ? out.get(a.point) : undefined
    if (!f) return
    if (a.act === 'reveal') {
      // 加分题（例子、误解、串讲、深聊）上说穿的不算这条核心说穿过
      if (a.free) return
      f.revealed = true
      f.revealAt = i
      if (a.flip) f.flipReveal = true
      return
    }
    if (!isAsk(a)) return
    f.asks++
    if (a.step === 'again') {
      f.again = true
      if (a.res === 'right') f.againRight = true
      return
    }
    if (a.step && BONUS.has(a.step)) return
    if (a.skip) f.skips++
    if (a.step === 'hint') f.hinted = true
    if (a.res === 'right') {
      f.right = true
      if (f.hinted && !f.revealed) f.hintRight = true
    }
  })
  return out
}

/** 清单里的一项：盯哪条（串讲问「怎么接」、问收尾不盯哪条）、哪一步；wrong、myth 带那条常见误解 */
export type QItem = { step: LongStep | 'offer'; point?: string; myth?: string }

/** 这一条挂着的常见误解（说反的拿它问） */
const mythOf = (m: FeynmanMeta, id: string) => m.myths.find((x) => x.core === id)

/**
 * 缺口清单（软件排，每次回来重排）：说反的 → 含糊的 → 没碰的 → 说穿过、隔够两问的换个情形再问 → 核心都聊过了按大小问 →
 * 跳过一次的 → 问你收尾；你选了往深里聊：了解即可、变式各一次，问空了再问一次收尾
 */
export function queueOf(m: FeynmanMeta): QItem[] {
  const f = factsOf(m)
  const flip = new Set(m.flip ?? [])
  const weak = new Set(m.weak ?? [])
  const touched = new Set(m.touched ?? [])
  const cores = coresOf(m)
  const wrong: QItem[] = []
  const vague: QItem[] = []
  const fresh: QItem[] = []
  const later: QItem[] = []
  for (const p of cores) {
    const x = f.get(p.id)!
    const myth = mythOf(m, p.id)?.id
    if (flip.has(p.id) && !x.revealed) {
      ;(x.skips ? later : wrong).push({ step: x.skips ? 'later' : 'wrong', point: p.id, ...(myth ? { myth } : {}) })
      continue
    }
    if (x.right || x.revealed || x.skips >= 2) continue
    if (weak.has(p.id)) (x.skips ? later : vague).push({ step: x.skips ? 'later' : 'weak', point: p.id })
    else if (!touched.has(p.id)) (x.skips ? later : fresh).push({ step: x.skips ? 'later' : 'new', point: p.id })
    // 自己讲到了、关键那层也说了：算讲过，不问
  }
  const asksAfter = (i: number, id: string) => m.asked.slice(i + 1).filter((a) => isAsk(a) && a.point !== id).length
  const again = cores.filter((p) => f.get(p.id)!.revealed && !f.get(p.id)!.again && !flip.has(p.id)).map((p) => ({ step: 'again' as const, point: p.id, gap: asksAfter(f.get(p.id)!.revealAt, p.id) }))
  const main = [...wrong, ...vague, ...fresh]
  const more: QItem[] = []
  if (!main.length) {
    const used = new Set(m.asked.filter((a) => isAsk(a) && a.step).map((a) => a.step))
    if (m.scope === 'point') {
      if (!used.has('example') && cores.some((p) => !flip.has(p.id) && !f.get(p.id)!.revealed)) {
        // 最容易算错的那条：挂着常见误解最多的；一样多先挑答案里有公式、数的
        const score = (p: Point) => m.myths.filter((x) => x.core === p.id).length * 2 + (/[=×÷+−\d]/.test(p.answer) ? 1 : 0)
        const pick = [...cores].filter((p) => !flip.has(p.id) && !f.get(p.id)!.revealed).sort((a, b) => score(b) - score(a))[0]!
        more.push({ step: 'example', point: pick.id })
      }
      const exPoint = (more[0]?.point ?? m.asked.find((a) => isAsk(a) && a.step === 'example')?.point) || ''
      const usedMyth = new Set(m.asked.filter((a) => isAsk(a) && (a.step === 'wrong' || a.step === 'myth')).map((a) => a.point))
      // 只拿已经聊过的核心挂着的（跳过还没回来问的、说穿过的不拿）
      const ok = (x: { core: string }) => !usedMyth.has(x.core) && !flip.has(x.core) && cores.some((p) => p.id === x.core) && !later.some((l) => l.point === x.core) && !f.get(x.core)!.revealed
      const myth = m.myths.find((x) => ok(x) && x.core !== exPoint) ?? m.myths.find(ok)
      if (!used.has('myth') && myth) more.push({ step: 'myth', point: myth.core, myth: myth.id })
    } else if (!used.has('chain')) more.push({ step: 'chain' })
  }
  // 说穿后隔够两问再换个情形问（刚说穿就问等于照着念）；别的都问空了隔一问就行，一问没隔先问收尾
  const rest = [...main, ...more, ...later]
  const ready = again.filter((a) => a.gap >= (rest.length ? 2 : 1)).map(({ gap, ...a }) => a)
  const q: QItem[] = [...main, ...ready, ...more, ...later]
  if (q.length) return q
  const deep = m.deep ?? 0
  const offers = m.asked.filter((a) => a.act === 'offer').length
  if (!deep) return [{ step: 'offer' }]
  const deepAsked = new Map<string, number>()
  for (const a of m.asked) if (isAsk(a) && a.step === 'deep' && a.point) deepAsked.set(a.point, (deepAsked.get(a.point) ?? 0) + 1)
  const extras = m.points.filter((p) => p.kind === 'extra' && !deepAsked.has(p.id))
  const variants = cores.filter((p) => !deepAsked.has(p.id))
  const d = [...extras, ...variants].map((p) => ({ step: 'deep' as const, point: p.id }))
  if (d.length) return d
  if (offers <= deep) return [{ step: 'offer' }]
  // 又选了接着聊：挑问得最少的那条核心再出个变式
  const least = [...cores].sort((a, b) => (deepAsked.get(a.id) ?? 0) - (deepAsked.get(b.id) ?? 0))[0]
  return least ? [{ step: 'deep', point: least.id }] : [{ step: 'offer' }]
}

/** 这一句之后：上一问记成什么、先说穿哪条、下一问 */
export interface Decision {
  /** 你最后那一段算：right 答上、miss 没答上、pick 只挑了选项；none 不是在答上一问（刚讲完、点了按钮、问「要不要会」） */
  last: 'right' | 'miss' | 'pick' | 'none'
  /** 改好的 asked（上一问记上 res / skip，加上说穿那一项），还没加下一问 */
  asked: Asked[]
  flip: string[]
  deep?: number
  /** free：加分题上说穿的（只给他看，不算这条核心说穿过） */
  reveal?: { point: string; flip: boolean; free?: boolean }
  next: QItem
  /** 下一问之前，你对这一条连着没答上几次 */
  miss: number
}

/** AI（或假 AI）看完你这一段给的：答上没有、讲到了哪些、哪些含糊、哪些说反了 */
export interface Reading {
  last: 'right' | 'miss' | 'pick' | 'none'
  touched: string[]
  weak: string[]
  wrong: string[]
}

const GIVE_UP = /^\s*(?:嗯|呃|额|啊|那个)?[，,\s]*(?:我)?(?:真的)?(?:不知道|我不会|不太会|说不上来|想不起来|忘了|不记得了|不清楚|不太清楚|说穿吧|直接说吧|告诉我吧|你说吧)[了啊呀吧。！!，,\s]*$|^\s*(?:um+|uh+)?[,\s]*(?:i (?:don'?t|do not) know|no idea|just tell me)[.!,\s]*$/i

/** 软件定的这一问：在 AI 看完你这一段之后（Reading），照清单和三步说穿定下一问盯哪条、哪一步 */
export function decide(m: FeynmanMeta, req: { cmd?: TurnReq['cmd']; entries: readonly Lite[] }, r: Reading): Decision {
  const asked = m.asked.map((a) => ({ ...a }))
  let flip = new Set(m.flip ?? [])
  let deep = m.deep
  const pi = pendingAsk(asked)
  const prev = pi >= 0 ? asked[pi]! : undefined
  const lastMe = req.entries.at(-1)?.kind === 'me' ? req.entries.at(-1)!.text : null
  const cmd = req.cmd ?? (prev && lastMe !== null && GIVE_UP.test(lastMe) ? 'reveal' : undefined)
  const f0 = factsOf(m)
  // 新说反的：已经说穿过的、这一问刚答上的不算
  const answeredRight = prev && lastMe !== null && !cmd && r.last === 'right' ? prev.point : undefined
  for (const id of r.wrong) if (!f0.get(id)?.revealed && id !== answeredRight) flip.add(id)
  const weak = [...new Set([...(m.weak ?? []), ...r.weak])].filter((id) => id !== answeredRight)
  const view = (o: Partial<FeynmanMeta>) => ({ ...m, asked, flip: [...flip], touched: [...new Set([...(m.touched ?? []), ...r.touched])], weak, ...(deep ? { deep } : {}), ...o })
  const revealOf = (id: string) => {
    const was = flip.has(id)
    asked.push({ act: 'reveal', point: id, ...(was ? { flip: 1 as const } : {}) })
    flip.delete(id)
    return { point: id, flip: was }
  }
  const nextOf = () => queueOf(view({}))[0]!
  const done = (last: Decision['last'], reveal?: Decision['reveal']): Decision => {
    const next = nextOf()
    const miss = 0
    return { last, asked, flip: [...flip], ...(deep ? { deep } : {}), ...(reveal ? { reveal } : {}), next, miss }
  }

  if (req.cmd === 'deep' || (!req.cmd && !prev && lastMe !== null && asked.findLast((a) => a.act !== 'confirm' && a.act !== 'answer')?.act === 'offer')) {
    // 选了「接着往深里聊」（点按钮，或问收尾后你接着说了一段）
    deep = (deep ?? 0) + 1
    return done('none')
  }
  if (!prev) return done('none')
  const bonus = !!prev.step && BONUS.has(prev.step)
  if (cmd === 'reveal') {
    prev.res = 'miss'
    if (bonus && prev.point) {
      asked.push({ act: 'reveal', point: prev.point, free: 1 })
      return done('none', { point: prev.point, flip: false, free: true })
    }
    return done('none', prev.point ? revealOf(prev.point) : undefined)
  }
  if (cmd === 'skip') {
    prev.skip = 1
    if (bonus) return done('none')
    const id = prev.point
    // 说反的那条第二次跳过：软件直接说穿，记讲错
    if (id && flip.has(id) && factsOf({ ...m, asked }).get(id)!.skips >= 2) return done('none', revealOf(id))
    return done('none')
  }
  if (lastMe === null) return done('none')
  const step = prev.step ?? 'new'
  const id = prev.point
  // 他没在答（反问、确认题意）：照这一步再问一次，不算没答上；同一条连着第二次才算
  let last = r.last
  if (last === 'none') {
    const before = asked.slice(0, pi).findLast(isAsk)
    if (id && !(before?.res === 'none' && before.point === id)) {
      prev.res = 'none'
      return { last, asked, flip: [...flip], ...(deep ? { deep } : {}), next: { step: step === 'why' ? 'why' : step, point: id }, miss: prev.miss ?? 0 }
    }
    last = 'miss'
  }
  if (last === 'right' || !id) {
    prev.res = 'right'
    if (id) flip.delete(id)
    return done('right')
  }
  // 拿常见误解问过去，他说「对」「是」：还信着那个错说法，算没答上
  if (last === 'pick' && (step === 'wrong' || step === 'myth') && lastMe !== null && /^\s*(?:嗯\s*)?(?:对|是|是的|对的|对吧|没错)[。！!，,\s]*$/.test(lastMe)) last = 'miss'
  if (last === 'pick' && step !== 'why') {
    prev.res = 'pick'
    return { last, asked, flip: [...flip], ...(deep ? { deep } : {}), next: { step: 'why', point: id }, miss: prev.miss ?? 0 }
  }
  prev.res = 'miss'
  if (NO_LADDER.has(step)) return done(last)
  const miss = (prev.miss ?? 0) + 1
  if (miss >= 3) return done(last, revealOf(id))
  return { last, asked, flip: [...flip], ...(deep ? { deep } : {}), next: { step: miss === 1 ? 'angle' : 'hint', point: id }, miss }
}

// ---------------------------------------------------------------- 提示词

/** 聊到底的 AI 学生（教学审核给的，照「少给限制」写短）；轮数和顺序不写这里，由 longPrompt 的状态行每次告诉它 */
export function longSystem(topic: string): string {
  return `你是没学过「${topic}」的同学，正在听对面的人讲，想真弄懂。要点单子他只看得到名字；答案和常见误解只有你知道，答案只在说穿时用。

他多半用语音听写：没标点、同音字、口头禅、改口、中英混说都正常，按最通的意思听，不提。只有意思可能正好相反（加还是减）时，先问一句确认（act 用 confirm）。

每次只问一个问题，先引他的原话；给提示、换情形时可以先说一句情形。只问软件这次给的那一条，照它说的这一步来：换个角度问，给一个不带答案的提示，或者说穿。他问「这个要不要会」就直接答（act 用 answer）。他答得对不对不说，不夸，不总结，不讲课。和他用同一种语言。只回一段 JSON。`
}

const named = (m: FeynmanMeta, id?: string) => {
  const p = id ? m.points.find((x) => x.id === id) : undefined
  return p ? `${p.id}「${p.text}」` : ''
}
const hide = (p?: Point, what = '问题') => (p?.words?.length ? `；${what}里不出现：${p.words.join('、')}` : '')

/** 这一步怎么问（状态行里的那半句） */
export function stepLine(m: FeynmanMeta, q: QItem, reveal?: { point: string }): string {
  const p = q.point ? m.points.find((x) => x.id === q.point) : undefined
  const myth = q.myth ? m.myths.find((x) => x.id === q.myth) : undefined
  const first = reveal
    ? (() => {
        const r = m.points.find((x) => x.id === reveal.point)!
        return `先说穿 ${named(m, r.id)}：reveal 写一句正确说法加出处（答案：${r.answer || r.text}；出处：${r.basis}）。然后`
      })()
    : ''
  const myths = q.point ? m.myths.filter((x) => x.core === q.point) : []
  const flipped = q.point && (m.flip ?? []).includes(q.point)
  const what: Record<QItem['step'], string> = {
    wrong: `这一问盯 ${named(m, q.point)}：他说的像挂在这条上的常见误解（${myths.map((x) => `「${x.text}」`).join('、') || '他说反了'}${myths.length > 1 ? '，照他原话挑最像的一条' : ''}）。用外行的口气把它当成你自己的理解说出来，问他是不是这样（「那……对吧？」），这一句里不带正确答案。`,
    weak: `这一问盯 ${named(m, q.point)}：他碰到了、关键那层关系没说出来，问那层关系。`,
    new: `这一问盯 ${named(m, q.point)}：他还没碰到，用外行的问法问，问题里不带答案。`,
    later: `这一问盯 ${named(m, q.point)}：他先跳过了这一条，现在回来再问一次${flipped && myths.length ? `（他之前说的像「${myths[0]!.text}」）` : ''}。`,
    angle: `这一问还盯 ${named(m, q.point)}：第 1 次没答上，换个角度再问：只换问法，不加他没说过的信息，不给提示。`,
    hint: `这一问还盯 ${named(m, q.point)}：第 2 次没答上，给一个提示：给一个具体情形（一个场景，或一组好算的数）让他顺着想下去${p?.hint ? `，可以用这一条，换成你的话说：${p.hint}` : ''}；不说结论，不问二选一${hide(p, '这一句')}。`,
    why: `这一问还盯 ${named(m, q.point)}：他只从问题里挑了一个选项（或只说了「对」），问他为什么。`,
    again: `这一问盯 ${named(m, q.point)}：前面说穿过，换一个具体情形再问一次（带数的例子或变式）${hide(p, '这一句')}。`,
    example: `核心都聊过了：请他拿一个带数的例子讲 ${named(m, q.point)}。`,
    myth: `核心都聊过了：用外行的口气把常见误解${myth ? `「${myth.text}」` : ''}当成你自己的理解说出来（「那……对吧？」），看他能不能纠正。`,
    chain: `核心都聊过了。${CHAIN_ASK[m.scope]}`,
    deep: p?.kind === 'extra' ? `往深里聊：问一次了解即可 ${named(m, q.point)}，不判。` : `往深里聊：拿 ${named(m, q.point)} 换个问法、出个变式（「要是反过来呢」这种），问一次。`,
    offer: `你想问的都问完了：这一次不问问题，act 写 offer，say 写空串。`,
  }
  return first + what[q.step]
}

const FROM_QUEUE = new Set<QItem['step']>(['wrong', 'weak', 'new', 'later', 'again', 'example', 'myth', 'chain', 'deep', 'offer'])

/**
 * 清单最上面那条怎么问：说反、含糊、没碰这三种要看你这一段（AI 这次判的 wrong / weak / touched）重排，
 * 所以只告诉 AI 排法和现在排的样子，让它照排法挑；软件拿它判的再排一次，对不上就按那条重问（longTurn）
 */
export function queueLine(m: FeynmanMeta): string {
  const q = queueOf(m)
  const top = q[0]!
  if (top.step === 'wrong' || top.step === 'weak' || top.step === 'new') {
    // 第一问：他刚讲完，touched 还空着，现排的样子不准，只给排法
    if (!m.asked.some(isAsk)) return '照清单的排法挑一条问。'
    const kind = (x: QItem) => (x.step === 'wrong' ? '说反了' : x.step === 'weak' ? '含糊' : '还没碰')
    const head = q.filter((x) => x.step === 'wrong' || x.step === 'weak' || x.step === 'new')
    return `问清单最上面那一条，现在排的是：${head.map((x) => `${named(m, x.point)}（${kind(x)}）`).join('、')}。`
  }
  return `${stepLine(m, top)}（要是你这次判出哪条核心说反了或还没讲清，先照排法问那条。）`
}

export const QUEUE_RULE = '清单的排法（先按你这次判的 wrong / weak / touched 重排）：他说反了的（拿挂在那条上的常见误解，用外行的口气当成你自己的理解问「那……对吧？」）→ 碰到了、关键那层没说出来的（问那层关系）→ 还没碰的（外行的问法，问题里不带答案）；他自己讲清了的不问。'

/**
 * 每一问的状态行：上一问盯哪条、他答上没有各走哪条路（软件排好的），清单还剩什么
 */
export function longPrompt(m: FeynmanMeta, entries: readonly Lite[], req: Pick<TurnReq, 'cmd'>): string {
  const pi = pendingAsk(m.asked)
  const prev = pi >= 0 ? m.asked[pi] : undefined
  const answered = entries.at(-1)?.kind === 'me'
  const base: Reading = { last: 'none', touched: [], weak: m.weak ?? [], wrong: [] }
  const way = (d: Decision) => {
    const pre = d.reveal ? stepLine(m, { step: 'new' }, d.reveal).replace(/然后.*$/, '然后') : ''
    if (!FROM_QUEUE.has(d.next.step)) return pre + stepLine(m, d.next)
    return pre + queueLine({ ...m, asked: d.asked, flip: d.flip, ...(d.deep ? { deep: d.deep } : {}) })
  }
  const lines: string[] = [QUEUE_RULE]
  if (req.cmd === 'reveal' || req.cmd === 'skip' || req.cmd === 'deep' || !prev || !answered) {
    const d = decide(m, { entries, ...(req.cmd ? { cmd: req.cmd } : {}) }, base)
    const why = req.cmd === 'reveal' ? '他点了「说穿吧」。' : req.cmd === 'skip' ? '他点了「先跳过」这一条。' : req.cmd === 'deep' ? '他选了「接着往深里聊」。' : ''
    lines.push(`${why}last 写 none。${way(d)}`)
  } else {
    const r = (last: Reading['last']) => decide(m, { entries }, { ...base, last })
    lines.push(`上一问盯 ${named(m, prev.point)}${prev.miss ? `（这一问之前他对这一条已经连着没答上 ${prev.miss} 次）` : ''}。先判断他最后这一段答上没有，last 写：right 说出了那层关系 / miss 说不上来、说反了、答非所问（口语乱、用词不准不算没答上）/ pick 只从问题里挑了一个选项，或只说「对」「不对」「是」「不是」、没说为什么 / none 他没在答（反问你、确认题意、接着讲别的）。${prev.step === 'wrong' || prev.step === 'myth' || (prev.step === 'later' && (m.flip ?? []).includes(prev.point ?? '')) ? '上一问是拿常见误解问的：他说「对」「是」，last 写 miss，wrong 写上这一条。' : ''}`)
    lines.push(`- right：${way(r('right'))}`)
    lines.push(`- miss：${way(r('miss'))}`)
    if (prev.step !== 'why') lines.push(`- pick：${way(r('pick'))}`)
    lines.push(`- none：照上一问这一步再问一次。`)
  }
  if (m.asked.some((a) => a.act === 'redirect')) lines.push('「这个了解即可，先讲核心」已经说过了，别再说。')
  else if (!m.asked.some(isAsk)) lines.push('要是他这一段一半以上的话花在了解即可上、又有核心一条都没碰：先说一句「这个了解即可，先讲核心」再问（act 用 redirect，整场只说一次）；不是这样就不说。')
  const myths = m.myths.map((x) => `- ${x.id}（挂在 ${x.core}）${x.text}｜正确：${x.right}`).join('\n')
  return `要点单子：
${m.points.map(pointLine).join('\n')}
常见误解（只有你知道）：
${myths || '（没有）'}

到现在的记录：
${transcript(entries)}

${lines.join('\n')}

touched 写到现在为止他讲到了的核心编号（只算他自己说的）；weak 写到现在为止讲到了、关键那层关系还没说出来的核心（前面写过、他后来没补上的照写）；wrong 写他说反了、还没改过来的核心。
只回 JSON：{"last":"right|miss|pick|none","act":"ask|confirm|answer|redirect|offer","point":"这一问盯的核心编号","quote":"引的他的原话","say":"你这一句","reveal":"说穿的那一句（不说穿就不写）","touched":["c1"],"weak":[],"wrong":[]}`
}

/** 软件说定了、AI 第一次没照着问：只给这一条再问一次 */
function retryPrompt(m: FeynmanMeta, entries: readonly Lite[], d: Decision, leak?: string[]): string {
  return `要点单子：
${m.points.map(pointLine).join('\n')}

到现在的记录：
${transcript(entries)}

${stepLine(m, d.next, d.reveal)}${leak?.length ? `\n上一次的问题里带出了答案（${leak.join('、')}），这次别出现。` : ''}
只回 JSON：{"point":"${d.next.point ?? ''}","quote":"引的他的原话","say":"你这一句"${d.reveal ? ',"reveal":"说穿的那一句"' : ''}}`
}

export interface ParsedLong extends Reading {
  act: 'ask' | 'confirm' | 'answer' | 'redirect' | 'offer' | 'reveal' | 'done'
  point?: string
  quote?: string
  say: string
  reveal?: string
}

export function parseLong(answer: string, m: FeynmanMeta): ParsedLong {
  const o = parseJson(answer)
  const ids = new Set(m.points.map((p) => p.id))
  const core = new Set(coresOf(m).map((p) => p.id))
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 8)).filter((x) => core.has(x)))] : [])
  const acts = ['ask', 'confirm', 'answer', 'redirect', 'offer', 'reveal', 'done'] as const
  const act = acts.find((a) => a === o.act) ?? 'ask'
  const point = str(o.point, 8)
  const say = typeof o.say === 'string' ? o.say.trim().slice(0, 600) : ''
  const reveal = typeof o.reveal === 'string' ? o.reveal.trim().slice(0, 300) : ''
  const last = o.last === 'right' || o.last === 'miss' || o.last === 'pick' ? o.last : 'none'
  return { last, act, ...(ids.has(point) ? { point } : {}), ...(str(o.quote, 120) ? { quote: str(o.quote, 120) } : {}), say, ...(reveal ? { reveal } : {}), touched: list(o.touched), weak: list(o.weak), wrong: list(o.wrong) }
}

// ---------------------------------------------------------------- 软件兜底：一次一问、不评价、提示不带答案

const PRAISE = /(^|[。！？!?，,；;\s])(?:嗯[，,]?\s*)?(?:对的?|没错|是的|好的|很好|不错|懂了|我懂了|明白了|我明白了|有道理|说得对|你说得对|原来如此)[！!。，,]\s*/g

/** 只留第一个问句；「对」「没错」「懂了」这类评价删掉；问句前面只留引他原话的那一小段（提示、换情形的那句事实留着） */
export function oneAsk(say: string, keepLead = false): string {
  let s = say.trim()
  const q = s.search(/[？?]/)
  if (q >= 0) s = s.slice(0, q + 1)
  for (let i = 0; i < 3; i++) s = s.replace(PRAISE, '$1')
  s = s.replace(/^[，,。\s]+/, '')
  if (!keepLead) {
    const parts = s.split(/(?<=[。！!；;.])\s*/).filter(Boolean)
    if (parts.length > 1) {
      const last = parts.pop()!
      // 引号里的句号也切开了：带引号的几截（连右引号那截）都留着，不然只剩「你说「…」半边
      s = parts.filter((p) => /[「“"『」”』]/.test(p)).join('') + last
    }
  }
  s = s.trim()
  // 剪得太狠（「对吧？」）：退回只切问句、删评价的那句
  if (!keepLead && [...s].length < 6) return oneAsk(say, true)
  return s
}

/** 提示、换情形里带出了答案的关键词 */
export const leaks = (say: string, p: Point | undefined): string[] => (p?.words ?? []).filter((w) => w && say.toLowerCase().includes(w.toLowerCase()))

const zh = (entries: readonly Lite[]) => /[㐀-鿿]/.test(entries.filter((e) => e.kind === 'me').map((e) => e.text).join(''))

/** 问你收尾还是接着往深里聊（只说问的人自己的事，不说「都听明白了」） */
export const offerLine = (isZh: boolean) => (isZh ? '我想问的都问完了。收个尾看判定，还是接着往深里聊？' : "That's all I wanted to ask. Wrap up and see the verdict, or keep going deeper?")

/** 说穿那一句：AI 没写就照答案和出处补 */
const revealText = (p: Point, isZh: boolean) => (isZh ? `${p.answer || p.text}。出处：${p.basis}。` : `${p.answer || p.text}. Source: ${p.basis}.`)

/** AI 没照着问（盯错了条、什么也没说）时软件自己写的一问 */
function fallbackAsk(m: FeynmanMeta, q: QItem, isZh: boolean): string {
  const p = q.point ? m.points.find((x) => x.id === q.point) : undefined
  const t = p?.text ?? m.topic
  if (!isZh) return q.step === 'why' ? 'Why is that?' : q.step === 'example' ? `Could you walk through "${t}" with actual numbers?` : `What about "${t}"?`
  if (q.step === 'why') return '为什么是这样？'
  if (q.step === 'angle') return `换个说法问：${t}，具体是怎样？`
  if (q.step === 'example' || q.step === 'again') return `能拿一个带数的例子说说「${t}」吗？`
  if (q.step === 'chain') return CHAIN_ASK[m.scope].includes('一章') ? '这几个点合起来，在解决一个什么问题？' : '有了前面那个，为什么还要这个？'
  return `那${t.replace(/[？?]$/, '')}？`
}

/** 聊到底的一句：AI 看你这一段、写那一句；盯哪条、哪一步、说不说穿由软件定（decide），AI 没照着来就重问一次，再不行软件自己写 */
export async function longTurn(req: TurnReq, deps: FlowDeps): Promise<TurnResult> {
  const { entries } = req
  const meta = req.cmd === 'more' ? toLong(req.meta) : req.meta
  const images: ImageIn[] = req.image ? [{ mime: req.image.mime, base64: req.image.base64 }] : []
  const cmd = req.cmd === 'more' ? undefined : req.cmd
  const isZh = zh(entries) || /[㐀-鿿]/.test(meta.topic)
  const ans = await deps.ask({ kind: 'turn', system: longSystem(meta.topic), prompt: longPrompt(meta, entries, { ...(cmd ? { cmd } : {}) }), images, fake: () => fakeLongTurn(meta, entries, cmd, (r) => decide(meta, { entries, ...(cmd ? { cmd } : {}) }, r)), stream: 'say' })
  const p = parseLong(ans, meta)
  const by = deps.by(images.length > 0)
  const touched = [...new Set([...(meta.touched ?? []), ...p.touched])].filter((id) => meta.points.some((x) => x.id === id && x.kind === 'core'))

  // 确认加还是减、答「要不要会」：上一问还等着你答
  if ((p.act === 'confirm' || p.act === 'answer') && p.say && !cmd) {
    const asked: Asked[] = [...meta.asked, { act: p.act }]
    return { act: p.act, say: p.say.trim(), ...(p.quote ? { quote: p.quote } : {}), meta: { ...meta, asked, touched }, by }
  }

  const d = decide(meta, { entries, ...(cmd ? { cmd } : {}) }, p)
  const q = d.next
  const point = q.point ? meta.points.find((x) => x.id === q.point) : undefined
  let say = p.say
  let reveal = d.reveal ? p.reveal || '' : ''
  let step: LongStep = q.step === 'offer' ? 'new' : q.step
  const keep = q.step === 'hint' || q.step === 'again' || q.step === 'myth' || q.step === 'example' || q.step === 'wrong' || q.step === 'later'
  if (q.step === 'offer') say = offerLine(isZh)
  else {
    // AI 盯错了那条（或没说话）：按软件定的那条重问一次
    const off = !say || (q.point && p.point !== q.point)
    const leak = () => (q.step === 'hint' || q.step === 'again' ? leaks(say, point) : [])
    if (off || leak().length) {
      const again = await deps.ask({ kind: 'turn', system: longSystem(meta.topic), prompt: retryPrompt(meta, entries, d, off ? undefined : leak()), images, fake: () => fakeLongTurn(meta, entries, cmd, () => d), stream: 'say' })
      try {
        const r = parseJson(again)
        // 还盯错了：不要这一句，软件自己写
        say = typeof r.say === 'string' && !(q.point && str(r.point, 8) && str(r.point, 8) !== q.point) ? r.say.trim().slice(0, 600) : ''
        if (d.reveal && typeof r.reveal === 'string' && r.reveal.trim()) reveal = r.reveal.trim().slice(0, 300)
      } catch {
        say = ''
      }
      if (!say) say = fallbackAsk(meta, q, isZh)
      // 提示还带着答案：退回成只换角度
      if (leak().length) {
        if (q.step === 'hint') step = 'angle'
        say = fallbackAsk(meta, { ...q, step: 'angle' }, isZh)
      }
    }
    say = oneAsk(say, keep) || fallbackAsk(meta, q, isZh)
  }
  if (d.reveal && !reveal) reveal = revealText(meta.points.find((x) => x.id === d.reveal!.point)!, isZh)
  const redirect = p.act === 'redirect' && !meta.asked.some((a) => a.act === 'redirect') && d.last === 'none' && !cmd && q.step !== 'offer'
  const act: TurnResult['act'] = q.step === 'offer' ? 'offer' : redirect ? 'redirect' : 'ask'
  const ask: Asked = q.step === 'offer' ? { act: 'offer' } : { act, ...(q.point ? { point: q.point } : {}), step, ...(d.miss ? { miss: d.miss } : {}) }
  const rightId = d.last === 'right' ? meta.asked[pendingAsk(meta.asked)]?.point : undefined
  const weak = [...new Set([...(meta.weak ?? []), ...p.weak])].filter((id) => id !== rightId)
  const next: FeynmanMeta = { ...meta, asked: [...d.asked, ask], touched, weak, flip: d.flip, ...(d.deep ? { deep: d.deep } : {}) }
  if (!next.flip?.length) delete next.flip
  if (!next.weak?.length) delete next.weak
  return {
    act,
    say,
    ...(reveal ? { reveal } : {}),
    ...(d.reveal?.flip ? { revealFlip: true } : {}),
    ...(q.point ? { point: q.point } : {}),
    ...(p.quote ? { quote: p.quote } : {}),
    step: q.step === 'offer' ? undefined : step,
    meta: next,
    by,
  } as TurnResult
}

// ---------------------------------------------------------------- 收尾、判定、进度

/** 收尾前：说反了、还没问清的那几条软件先说穿（记讲错）；界面把 reveals 一条条写成「说穿」块再判 */
export function finishLong(meta: FeynmanMeta, isZh = true): { meta: FeynmanMeta; reveals: { point: string; text: string }[] } {
  if (meta.mode !== 'long') return { meta, reveals: [] }
  const f = factsOf(meta)
  const ids = (meta.flip ?? []).filter((id) => !f.get(id)?.revealed && meta.points.some((p) => p.id === id))
  if (!ids.length) return { meta, reveals: [] }
  const asked: Asked[] = [...meta.asked, ...ids.map((id) => ({ act: 'reveal' as const, point: id, flip: 1 as const, end: 1 as const }))]
  const next: FeynmanMeta = { ...meta, asked }
  delete next.flip
  return { meta: next, reveals: ids.map((id) => ({ point: id, text: revealText(meta.points.find((p) => p.id === id)!, isZh) })) }
}

/**
 * 聊到底的状态（软件按记录改 AI 给的）：说反过、靠说穿的记讲错；说穿过的最多含糊；跳过两次、没答上的记没讲到；
 * 提示后答上的记追问后补上（via hint）；说穿后换个情形答上的原状态不变，via again
 */
export function longStates(meta: FeynmanMeta, states: readonly CoreJudged[]): CoreJudged[] {
  const f = factsOf(meta)
  return states.map((s0) => {
    const x = f.get(s0.id)
    if (!x) return s0
    let s: CoreJudged = { ...s0 }
    if (x.flipReveal) s.state = 'wrong'
    else if (x.revealed && isGood(s.state)) s.state = 'vague'
    else if (!x.revealed && x.skips >= 2 && !x.right && s.state !== 'wrong') s = { ...s, state: 'missing', quote: '' }
    if (x.revealed && x.againRight) s.via = 'again'
    else if (!x.revealed && x.hintRight && isGood(s.state)) {
      if (s.state === 'clear') s.state = 'asked'
      s.via = 'hint'
    }
    return s
  })
}

const GAP_RANK: Record<string, number> = { wrong: 0, vague: 1, missing: 2, fixed: 3, asked: 4, extra: 5, recap: 6 }

/**
 * 聊到底判完的注释（judgedMeta 之上）：提示后答上的出一条缺口（默认出卡），下次再讲照「看一眼」提前；
 * 说穿后补讲清的缺口记上，没讲清的核心全是说穿后补讲清的：判定「过 · 当场补讲」，三天后再讲
 */
export function longJudged(meta: FeynmanMeta, j: { states: CoreJudged[]; rights: RightOf[]; full: string; today: string; prevPasses: number }): FeynmanMeta {
  const states = longStates(meta, j.states)
  const base = judgedMeta(meta, { ...j, states })
  const hints = states.filter((s) => s.via === 'hint')
  const again = new Set(states.filter((s) => s.via === 'again').map((s) => s.id))
  const right = (id: string) => j.rights.find((r) => r.id === id)
  const hintGaps: Gap[] = hints.map((s) => {
    const p = meta.points.find((x) => x.id === s.id)!
    return { point: s.id, kind: s.state === 'fixed' ? 'fixed' : 'asked', quote: s.quote, right: clipRight(right(s.id)?.right || p.answer || p.text), src: right(s.id)?.src || p.basis, card: true, via: 'hint', ...(p.src ? { ref: p.src } : {}) }
  })
  const gaps = [...(base.gaps ?? []).filter((g) => !hints.some((h) => h.id === g.point && g.kind === 'fixed')), ...hintGaps]
    .map((g) => (again.has(g.point) ? { ...g, redone: true, via: 'again' as const } : g))
    .sort((a, b) => GAP_RANK[a.kind]! - GAP_RANK[b.kind]!)
  const short = coresOf(meta).filter((p) => !isGood(states.find((s) => s.id === p.id)?.state ?? 'missing'))
  if (short.length && short.every((p) => again.has(p.id))) {
    const noRecap = gaps.filter((g) => g.kind !== 'recap')
    return { ...base, states, gaps: noRecap, verdict: 'pass', redone: true, passes: j.prevPasses, next: nextDay(j.today, 'pass', { redone: true }) }
  }
  return { ...base, states, gaps, next: nextDay(j.today, base.verdict!, { passes: base.passes ?? 1, peeks: meta.peeks + hints.length }) }
}

/**
 * 交给判定的记录：加分题上说穿的那几块（free）拿掉，免得判的人当成那条核心说穿过。
 * 说穿块和 asked 里的说穿一一对上（先后一样）
 */
export function judgeEntries<T extends Pick<Entry, 'kind'>>(meta: FeynmanMeta, entries: readonly T[]): T[] {
  if (meta.mode !== 'long') return [...entries]
  const free = meta.asked.filter((a) => a.act === 'reveal').map((a) => !!a.free)
  let k = 0
  return entries.filter((e) => (e.kind === 'reveal' ? !free[k++] : true))
}

/** 长谈记录的数：问了几次、提示几次、聊了几秒 */
export function longStats(meta: FeynmanMeta): { asks: number; hints: number; secs: number } {
  return { asks: meta.asked.filter(isAsk).length, hints: meta.asked.filter((a) => isAsk(a) && a.step === 'hint').length, secs: meta.secs ?? 0 }
}

/** 「聊了14分钟 · 问了9次 · 提示1次」：0 的项不写，分钟取整，不到 1 分钟写「不到1分钟」 */
export function longLine(meta: FeynmanMeta): string {
  const s = longStats(meta)
  return [s.secs > 0 ? (s.secs < 60 ? '聊了不到1分钟' : `聊了${Math.round(s.secs / 60)}分钟`) : '', s.asks ? `问了${s.asks}次` : '', s.hints ? `提示${s.hints}次` : ''].filter(Boolean).join(' · ')
}

/** 收尾时还有几条核心没聊到（从头到尾没提过、也没问到） */
export const notReached = (meta: FeynmanMeta) => (meta.states ?? []).filter((s) => s.state === 'missing' && coresOf(meta).some((p) => p.id === s.id)).length

/** 中途进度：每条核心聊到哪了（不给对错）：done 聊过、now 正在聊、todo 还没聊、revealed 说穿过、skipped 跳过了 */
export type TalkState = 'done' | 'now' | 'todo' | 'revealed' | 'skipped'

export function talkStates(meta: FeynmanMeta): { id: string; text: string; state: TalkState }[] {
  const f = factsOf(meta)
  const pi = pendingAsk(meta.asked)
  const now = pi >= 0 ? meta.asked[pi]!.point : undefined
  const touched = new Set(meta.touched ?? [])
  return coresOf(meta).map((p) => {
    const x = f.get(p.id)!
    const state: TalkState = p.id === now ? 'now' : x.revealed ? 'revealed' : x.skips && !x.right ? 'skipped' : touched.has(p.id) || x.asks ? 'done' : 'todo'
    return { id: p.id, text: p.text, state }
  })
}

/**
 * 列里每一块学生的话、说穿是哪一步（学生块右边的小字）：照 asked 的先后和文档里的块一一对上
 * （每个不是说穿的 asked 一块学生 / 确认，每个说穿一块说穿）
 */
export function longLabels(meta: FeynmanMeta): { students: (LongStep | 'offer' | 'confirm' | 'answer' | 'redirect' | 'ask')[]; reveals: ('reveal' | 'end')[] } {
  const students: (LongStep | 'offer' | 'confirm' | 'answer' | 'redirect' | 'ask')[] = []
  const reveals: ('reveal' | 'end')[] = []
  for (const a of meta.asked) {
    if (a.act === 'reveal') reveals.push(a.end ? 'end' : 'reveal')
    else if (a.act === 'done') continue
    else if (a.act === 'offer' || a.act === 'confirm' || a.act === 'answer') students.push(a.act)
    else students.push(a.step ?? (a.act === 'redirect' ? 'redirect' : 'ask'))
  }
  return { students, reveals }
}
