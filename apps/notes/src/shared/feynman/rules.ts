/**
 * 判定、缺口、下次再讲的日子、你的改动：都由软件按 teaching.md 的规则算，AI 只给每条核心一个状态和原话（judge.ts 认 AI 的回答）。
 */
import { addDays } from '@cn/tasks'
import { type CoreJudged, type CoreState, CORE_MAX, type SourceRef, type FeynmanMeta, type Gap, isGood, type Point, type PointEdit, RIGHT_MAX, STATE_LABEL, type Verdict } from './types'

/**
 * 三档（teaching.md 1.3）：有一条讲错就没过；没有讲错时，含糊和没讲到合起来 0 条过、1 条差一点、2 条以上没过。
 * 没给状态的核心当没讲到
 */
export function verdictOf(cores: readonly Point[], states: readonly CoreJudged[]): Verdict {
  const of = (id: string): CoreState => states.find((s) => s.id === id)?.state ?? 'missing'
  const list = cores.filter((p) => p.kind === 'core').map((p) => of(p.id))
  if (list.includes('wrong')) return 'fail'
  const short = list.filter((s) => !isGood(s)).length
  return short === 0 ? 'pass' : short === 1 ? 'almost' : 'fail'
}

/**
 * 隔几天再讲（teaching.md 3.4、1.6，已定 2、5）：没过隔一天、差一点三天、过两周（第二次起六周）；当场补讲的过三天。
 * 讲的时候看过材料（含暂停露出后接着讲）：判定照常，过的日子减半（两周改一周、六周改三周）；没过、差一点本来就短，不变
 */
export function gapDays(v: Verdict, o: { passes?: number; peeks?: number; redone?: boolean } = {}): number {
  if (o.redone) return 3
  if (v === 'fail') return 1
  if (v === 'almost') return 3
  const base = (o.passes ?? 1) >= 2 ? 42 : 14
  return o.peeks ? base / 2 : base
}

export const nextDay = (day: string, v: Verdict, o: { passes?: number; peeks?: number; redone?: boolean } = {}) => addDays(day, gapDays(v, o))

/** 「明天」「三天后」「两周后」 */
export function inDays(n: number): string {
  const named: Record<number, string> = { 1: '明天', 2: '后天', 3: '三天后', 7: '一周后', 14: '两周后', 21: '三周后', 42: '六周后' }
  return named[n] ?? `${n}天后`
}

/** 正确说法截到 40 字以内（AI 偶尔写长） */
export const clipRight = (s: string, max = RIGHT_MAX) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return [...t].length > max ? [...t].slice(0, max - 1).join('') + '…' : t
}

/** AI 给的每条要点的正确说法和出处（判的时候一起给） */
export interface RightOf {
  id: string
  right: string
  src: string
  /** 了解即可：讲到没有、有没有说错 */
  said?: boolean
  wrong?: boolean
}

const GAP_ORDER: Record<string, number> = { wrong: 0, vague: 1, missing: 2, fixed: 3, extra: 4, recap: 5 }

/**
 * 缺口（teaching.md 4.1、4.3，已定 1）：核心里讲错、含糊、没讲到的按这个顺序，默认出卡；说错后改对的也出一条（默认勾）；
 * 追问后补上的不进缺口；了解即可没讲到或说错的灰着排最后、不勾；最多 5 条（核心的全留，了解即可截掉）。
 * 过了的再加一张「用两三句讲清 X」，默认勾，答案是完整版
 */
export function gapsOf(meta: Pick<FeynmanMeta, 'points' | 'topic'>, states: readonly CoreJudged[], rights: readonly RightOf[], o: { verdict: Verdict; full?: string } = { verdict: 'fail' }): Gap[] {
  const right = (id: string) => rights.find((r) => r.id === id)
  const point = (id: string) => meta.points.find((p) => p.id === id)
  const out: Gap[] = []
  for (const p of meta.points.filter((x) => x.kind === 'core')) {
    const s = states.find((x) => x.id === p.id) ?? { id: p.id, state: 'missing' as const, quote: '' }
    if (s.state === 'clear' || s.state === 'asked') continue
    const r = right(p.id)
    out.push({ point: p.id, kind: s.state, quote: s.quote, right: clipRight(r?.right || p.answer || p.text), src: r?.src || p.basis, card: true, ...(p.src ? { ref: p.src } : {}) })
  }
  out.sort((a, b) => GAP_ORDER[a.kind]! - GAP_ORDER[b.kind]!)
  const extras: Gap[] = []
  for (const p of meta.points.filter((x) => x.kind === 'extra')) {
    const r = right(p.id)
    if (r && r.said && !r.wrong) continue
    extras.push({ point: p.id, kind: 'extra', quote: '', right: clipRight(r?.right || p.answer || p.text), src: r?.src || p.basis, card: false, ...(p.src ? { ref: p.src } : {}) })
  }
  out.push(...extras.slice(0, Math.max(0, 5 - out.length)))
  if (o.verdict === 'pass') out.push({ point: '*', kind: 'recap', quote: '', right: (o.full ?? '').trim() || (point(meta.points[0]?.id ?? '')?.answer ?? meta.topic), src: '完整版', card: true })
  return out
}

/** 一条缺口的问题（出卡的正面）：「用两三句讲清范数」「放大 α 倍会怎样？」 */
export function gapQuestion(g: Gap, meta: Pick<FeynmanMeta, 'points' | 'topic'>): string {
  if (g.kind === 'recap') return `用两三句讲清${meta.topic}`
  const t = meta.points.find((p) => p.id === g.point)?.text ?? meta.topic
  return /[？?]$/.test(t) ? t : `${meta.topic}：${t}？`
}

/**
 * 判定一行（teaching.md 4.1：现在怎样、差在哪、下一步）。
 * 例：「差一点：核心 4 条讲清 3 条，「学习率太大会怎样」还含糊。下一步：再讲这 1 处，或出卡；三天后再讲。」
 */
export function verdictLine(meta: Pick<FeynmanMeta, 'points' | 'states' | 'verdict' | 'peeks' | 'redone' | 'passes'>): string {
  const v = meta.verdict ?? 'fail'
  const cores = meta.points.filter((p) => p.kind === 'core')
  const st = (id: string): CoreState => meta.states?.find((s) => s.id === id)?.state ?? 'missing'
  const name = (p: Point) => `「${p.text}」`
  const days = inDays(gapDays(v, { passes: meta.passes ?? 1, peeks: meta.peeks, redone: !!meta.redone }))
  const peek = meta.peeks ? `讲的时候看过材料${meta.peeks}次：判定照常，下次再讲的日子提前。` : ''
  if (meta.redone) return `过 · 当场补讲：缺的几处当场讲清了。下一步：${days}再讲一次。`
  if (v === 'pass') {
    const fixed = cores.filter((p) => st(p.id) === 'fixed')
    const tail = fixed.length ? `${fixed.map(name).join('、')}是说错后自己改对的，出一张卡。` : ''
    return `过：核心${cores.length}条都讲清了。${tail}下一步：${days}再讲。${peek}`
  }
  const short = cores.filter((p) => !isGood(st(p.id)))
  const why = short.map((p) => `${name(p)}${st(p.id) === 'wrong' ? '说穿了才知道' : st(p.id) === 'vague' ? '还含糊' : '没讲到'}`).join('，')
  if (v === 'almost') return `差一点：核心${cores.length}条讲清${cores.length - short.length}条，${why}。下一步：再讲这1处，或出卡；${days}再讲。${peek}`
  const src = short.map((p) => p.basis).find((b) => b && b !== 'AI 判断')
  return `没过：${why}。下一步：${src ? `看一眼${src}` : '看一遍材料'}，${days}再讲；先把缺口出卡。${peek}`
}

/** 判定块的正文：判定一行，下面每条核心一行「名字：状态 · 「原话」」 */
export function verdictBody(meta: FeynmanMeta): string {
  const rows = meta.points
    .filter((p) => p.kind === 'core')
    .map((p) => {
      const s = meta.states?.find((x) => x.id === p.id)
      return `- ${p.text}：${STATE_LABEL[s?.state ?? 'missing']}${s?.quote ? ` · 「${s.quote}」` : ''}`
    })
  return [verdictLine(meta).replace(/。?下一步：/, '。\n下一步：'), '', ...rows].join('\n')
}

/** 缺口块的正文：一条一行，不用 `- [ ]` */
export function gapsBody(meta: FeynmanMeta): string {
  const kindName = (g: Gap) => (g.kind === 'extra' ? '了解即可' : g.kind === 'recap' ? '讲清了' : STATE_LABEL[g.kind])
  return (meta.gaps ?? [])
    .map((g) => {
      const p = meta.points.find((x) => x.id === g.point)
      const head = g.kind === 'recap' ? `用两三句讲清${meta.topic}` : (p?.text ?? '')
      const said = g.quote ? `你说「${g.quote}」 → ` : ''
      const mark = [g.redone ? '✓ 当场补讲清了' : '', g.sent ? '✓ 已送进Anki' : ''].filter(Boolean).join(' · ')
      const where = refName(g.ref)
      const src = [where, g.src].filter(Boolean).join(' · ')
      return `- ${kindName(g)} · ${head}：${said}${g.right}${src ? `（${src}）` : ''}${mark ? ` ${mark}` : ''}`
    })
    .join('\n')
}

/** 出处那份材料的名字：「《第3讲 线性映射》第 2 页」「《2.3. 线性代数》」 */
export function refName(r: SourceRef | undefined): string {
  if (!r) return ''
  const base = (p: string) => p.split('/').pop()!.replace(/\.(md|pdf)$/i, '')
  if (r.kind === 'pdf') return `《${base(r.path)}》第 ${r.page} 页`
  if (r.kind === 'web') return r.title ? `《${r.title}》` : ''
  if (r.kind === 'note') return `《${base(r.path)}》`
  return ''
}

/** 「记进笔记」：材料来自的那篇末尾一块「费曼缺口 · 范数」，只有判定一行和缺口 */
export function gapNoteSection(meta: FeynmanMeta, head = '费曼缺口', level = 2): string {
  return `${'#'.repeat(level)} ${head} · ${meta.topic}\n\n${verdictLine(meta)}\n\n${gapsBody(meta)}\n`
}

/** 你在「这次要讲到」上的改动，照先后用到 AI 抽的要点上（同一个点下次照你的来） */
export function applyEdits(points: readonly Point[], edits: readonly PointEdit[] = []): Point[] {
  let out = points.map((p) => ({ ...p }))
  for (const e of edits) {
    if (e.op === 'drop') out = out.filter((p) => p.id !== e.id)
    else if (e.op === 'move') out = out.map((p) => (p.id === e.id ? { ...p, kind: e.to } : p))
    else if (e.op === 'rename') out = out.map((p) => (p.id === e.id ? { ...p, text: e.text } : p))
    else if (!out.some((p) => p.id === e.id)) out.push({ id: e.id, kind: 'core', text: e.text, answer: '', basis: '你加的' })
  }
  return out
}

/** 你加的一条要点的新编号（u1、u2…） */
export function newPointId(points: readonly Point[]): string {
  let n = 1
  while (points.some((p) => p.id === `u${n}`)) n++
  return `u${n}`
}

/** 核心超过 5 条：提示「核心超过5条，拆成两个点讲？」 */
export const tooManyCores = (points: readonly Point[]) => points.filter((p) => p.kind === 'core').length > CORE_MAX

/**
 * 判完以后的注释：状态、判定、日子、缺口（当场补讲另走 redoneMeta）。passes 是这个点以前过了几次（同一个点前几轮数出来）
 */
export function judgedMeta(meta: FeynmanMeta, j: { states: CoreJudged[]; rights: RightOf[]; full: string; today: string; prevPasses: number }): FeynmanMeta {
  const verdict = verdictOf(meta.points, j.states)
  const passes = verdict === 'pass' ? j.prevPasses + 1 : j.prevPasses
  const extraSaid = Object.fromEntries(meta.points.filter((p) => p.kind === 'extra').map((p) => [p.id, !!j.rights.find((r) => r.id === p.id)?.said]))
  const gaps = gapsOf(meta, j.states, j.rights, { verdict, full: j.full })
  return { ...meta, status: 'judged', states: j.states, extraSaid, verdict, judged: j.today, passes, next: nextDay(j.today, verdict, { passes, peeks: meta.peeks }), gaps }
}

/**
 * 当场「再讲这几处」以后（teaching.md 1.6）：补讲判成好的那几条，缺口勾上「✓ 当场补讲清了」（原来的状态留着，是这一轮的实情）；
 * 原来缺的核心全补上了，判定改成「过 · 当场补讲」，三天后再讲（刚看过答案，不当成干净的过，过的次数不加）
 */
export function redoneMeta(meta: FeynmanMeta, again: readonly CoreJudged[], today: string): FeynmanMeta {
  const fixed = new Set(again.filter((s) => isGood(s.state)).map((s) => s.id))
  const gaps = (meta.gaps ?? []).map((g) => (fixed.has(g.point) ? { ...g, redone: true } : g))
  const short = meta.points.filter((p) => p.kind === 'core' && !isGood(meta.states?.find((s) => s.id === p.id)?.state ?? 'missing'))
  const all = short.every((p) => gaps.some((g) => g.point === p.id && g.redone))
  if (!all) return { ...meta, gaps }
  return { ...meta, verdict: 'pass', redone: true, gaps, judged: today, next: nextDay(today, 'pass', { redone: true }) }
}
