/**
 * 费曼「讲完以后」（③ feynman-after，task-yvabi）的纯函数：补进导图、拍成导图的树、记进笔记、导图上的进度小点。
 * 规矩照 design/feynman/teaching.md 4.2、4.4 和 notes.md 第 3、4 节；不依赖 Electron、Node。
 *
 * - 补进导图：先算出要改哪几处（planMapMerge；真 AI 走主进程 feynman:map-plan，这里的是假 AI 和兜底用的），列给用户核对；
 *   「放进去」才 applyMapMerge：你讲了导图上没有的，用你的原话加一个节点；讲错的节点标红（行尾注释 wrong），下面挂一个 fix 子节点写正确说法；
 *   含糊、没讲到的后面挂虚线空框（blank）；讲清的不动。只往孩子末尾加，原来的节点路径一个不变（撤回就是把原来的树写回去，一字不差）。
 * - 拍成导图：这一轮整理成一棵树（roundTree），交给拍导图那套的 ② 核对、③ 放上白板（子白板）。
 * - 记进笔记：材料来自的那篇末尾一块 `## 费曼缺口 · 范数`，只有判定一行和缺口（gapNote）；缺口写成提示块里的要点，不用 `- [ ]`。
 * - 进度小点：导图第一层每个点讲过没有、过没过（mapProgress），中心下面「费曼 讲过 n/m」。
 */
import { aiCallout, eachNode, insertAt, keyPath, type MapNode, type MapPath, nodeAt, parseMindmap, pathKey, setAttrs } from '@cn/format'
import { findRounds, ZH_WORDS, type FeynmanWords } from './doc'
import { gapsBody, verdictLine } from './rules'
import { type CoreState, type FeynmanMeta, type RoundSection, STATE_LABEL, type Verdict } from './types'

// ---------------------------------------------------------------- 补进导图

/**
 * 一处改动（路径都是整张导图里的 pathKey，「0.2」）：
 * - add：在 under 下面加一个节点；mark 给了是这条核心导图上本来没有，加上再标（讲错的另挂 fix）
 * - wrong：这个节点讲错了，字变红，下面挂一句正确说法
 * - blank：这个节点含糊、没讲到，后面挂虚线空框
 */
export type MergeOp =
  | { kind: 'add'; under: string; text: string; mark?: 'wrong' | 'blank'; fix?: string }
  | { kind: 'wrong'; at: string; fix: string }
  | { kind: 'blank'; at: string }

export interface MergePlan {
  /** 材料是哪一支（pathKey） */
  branch: string
  ops: MergeOp[]
  /** 这一支里不动的节点有几个（「讲清的节点不动」） */
  kept: number
}

/** 核对框里的一行：界面照 kind 翻成句子（「加一个节点，用你的原话：「…」」） */
export type MergeLine =
  | { kind: 'add'; text: string }
  | { kind: 'add-wrong'; text: string; fix: string }
  | { kind: 'add-blank'; text: string }
  | { kind: 'wrong'; node: string; fix: string }
  | { kind: 'blank'; node: string }
  | { kind: 'kept'; n: number }

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?“”"'‘’「」『』（）()【】[\]<>《》·…—-]+/gu, '')
    .replace(/\$/g, '')

function grams(s: string): Set<string> {
  const t = [...norm(s)]
  const out = new Set<string>()
  if (t.length === 1) out.add(t[0]!)
  for (let i = 0; i + 1 < t.length; i++) out.add(t[i]! + t[i + 1]!)
  return out
}

/** 两段字像不像（字的两两连写重合多少，0 到 1）：假 AI 和兜底用 */
export function likeness(a: string, b: string): number {
  const x = grams(a)
  const y = grams(b)
  if (!x.size || !y.size) return 0
  let n = 0
  for (const g of x) if (y.has(g)) n++
  return n / Math.min(x.size, y.size)
}

/** 这一支下面的节点（不含它自己），先根后子 */
function branchNodes(roots: MapNode[], branch: MapPath): { key: string; node: MapNode }[] {
  const top = nodeAt(roots, branch)
  if (!top) return []
  const out: { key: string; node: MapNode }[] = []
  eachNode(top.children, (node, path) => out.push({ key: pathKey([...branch, ...path]), node }), [])
  return out
}

/** 你讲的原话太长：只留第一句（不改字），节点不截字（偏好「导图节点不截字」），所以别塞一整段 */
export function firstSentence(s: string): string {
  const one = s.replace(/\s*\n+\s*/g, ' ').trim()
  const m = /^(.{6,60}?[。！？!?；;])/u.exec(one)
  return (m ? m[1]! : one.slice(0, 60)).replace(/[。；;]$/u, '').trim()
}

/** 这一轮里每条核心的状态、正确说法、你的原话（判过才有） */
export function coreOutcomes(meta: FeynmanMeta): { id: string; text: string; answer: string; state: CoreState; quote: string; right: string; src: string }[] {
  const states = new Map((meta.states ?? []).map((s) => [s.id, s]))
  return meta.points
    .filter((p) => p.kind === 'core')
    .flatMap((p) => {
      const s = states.get(p.id)
      if (!s) return []
      const gap = meta.gaps?.find((g) => g.point === p.id)
      return [{ id: p.id, text: p.text, answer: p.answer, state: s.state, quote: s.quote, right: gap?.right || p.answer, src: gap?.src ?? p.basis }]
    })
}

/**
 * 假 AI（和真 AI 没回成时的兜底）：按字的重合把每条核心对到这一支的节点上。
 * 讲错 → 对上的节点标红挂正确说法；含糊、没讲到 → 对上的节点留空框；对不上的加一个节点再标。
 * 自己讲清的（讲清、说错后改对；追问后补上的是被问出来的，不算）原话，导图上没有像的就用你的原话加一个节点（最多 2 个）。
 */
export function planMapMerge(roots: MapNode[], branch: string, meta: FeynmanMeta): MergePlan {
  const nodes = branchNodes(roots, keyPath(branch))
  const used = new Set<string>()
  const ops: MergeOp[] = []
  const best = (q: string) => {
    let hit: { key: string; score: number } | null = null
    for (const n of nodes) {
      if (used.has(n.key)) continue
      const score = likeness(q, n.node.text)
      if (!hit || score > hit.score) hit = { key: n.key, score }
    }
    return hit && hit.score >= 0.34 ? hit.key : null
  }
  let adds = 0
  for (const c of coreOutcomes(meta)) {
    if (c.state === 'wrong' || c.state === 'vague' || c.state === 'missing') {
      const at = best(`${c.text} ${c.answer} ${c.right}`)
      const mark = c.state === 'wrong' ? 'wrong' : 'blank'
      if (at) {
        used.add(at)
        ops.push(mark === 'wrong' ? { kind: 'wrong', at, fix: c.right } : { kind: 'blank', at })
      } else ops.push({ kind: 'add', under: branch, text: c.text, mark, ...(mark === 'wrong' ? { fix: c.right } : {}) })
    } else if ((c.state === 'clear' || c.state === 'fixed') && c.quote.trim() && adds < 2) {
      const said = firstSentence(c.quote)
      if (nodes.some((n) => likeness(said, n.node.text) >= 0.5)) continue
      adds++
      ops.push({ kind: 'add', under: branch, text: said })
    }
  }
  const touched = new Set(ops.flatMap((o) => (o.kind === 'add' ? [] : [o.at])))
  return { branch, ops, kept: nodes.filter((n) => !touched.has(n.key)).length }
}

/** 真 AI 回的计划：只认这一支里的路径、字不空的；别的丢掉 */
export function checkPlan(roots: MapNode[], branch: string, raw: unknown): MergePlan | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { ops?: unknown }
  if (!Array.isArray(o.ops)) return null
  const inBranch = (k: unknown): k is string => typeof k === 'string' && (k === branch || k.startsWith(branch + '.')) && !!nodeAt(roots, keyPath(k))
  const str = (s: unknown) => (typeof s === 'string' ? s.replace(/\s*\n+\s*/g, ' ').trim() : '')
  const ops: MergeOp[] = []
  const seen = new Set<string>()
  for (const x of o.ops as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') continue
    if (x.kind === 'add' && inBranch(x.under) && str(x.text)) {
      const mark = x.mark === 'wrong' || x.mark === 'blank' ? x.mark : undefined
      if (mark === 'wrong' && !str(x.fix)) continue
      ops.push({ kind: 'add', under: x.under, text: str(x.text), ...(mark ? { mark } : {}), ...(mark === 'wrong' ? { fix: str(x.fix) } : {}) })
    } else if (x.kind === 'wrong' && inBranch(x.at) && x.at !== branch && str(x.fix) && !seen.has(x.at)) {
      seen.add(x.at)
      ops.push({ kind: 'wrong', at: x.at, fix: str(x.fix) })
    } else if (x.kind === 'blank' && inBranch(x.at) && x.at !== branch && !seen.has(x.at)) {
      seen.add(x.at)
      ops.push({ kind: 'blank', at: x.at })
    }
  }
  const nodes = branchNodes(roots, keyPath(branch))
  return { branch, ops, kept: nodes.filter((n) => !seen.has(n.key)).length }
}

// 不翻：给 AI 的提示词
export const MAP_PLAN_SYSTEM = `你在帮一个学生把他刚才「讲给别人听」的话补回他自己的思维导图。只回一段 JSON，不要别的话。`

/** 这一支画成带编号的大纲给 AI 看（编号就是 pathKey） */
function outlineOf(roots: MapNode[], branch: string): string {
  const out: string[] = []
  const walk = (n: MapNode, key: string, depth: number) => {
    out.push(`${'  '.repeat(depth)}- [${key}] ${n.text}`)
    n.children.forEach((c, i) => walk(c, `${key}.${i}`, depth + 1))
  }
  const n = nodeAt(roots, keyPath(branch))
  if (n) walk(n, branch, 0)
  return out.join('\n')
}

/** 补进导图问 AI 的话：这一支（带编号）、你讲的原话、每条核心判下来的状态和正确说法 */
// 不翻：给 AI 的提示词
export function mapPlanAsk(roots: MapNode[], branch: string, round: RoundSection): string {
  const cores = coreOutcomes(round.meta)
    .map((c) => `- ${c.text}：${STATE_LABEL[c.state]}${c.quote ? `；他的原话「${c.quote}」` : ''}${c.state === 'wrong' || c.state === 'vague' || c.state === 'missing' ? `；正确说法「${c.right}」` : ''}`)
    .join('\n')
  const said = round.entries.filter((e) => e.kind === 'me').map((e) => `> ${e.text.replace(/\n+/g, ' ')}`)
  return `知识点「${round.meta.topic}」。这是他导图上的这一支，方括号里是每个节点的编号：

${outlineOf(roots, branch)}

他讲的原话（多半是语音听写的，可能没标点、有同音字）：

${said.join('\n')}

每条核心判下来的状态：

${cores}

照下面的规矩列出要改的几处：
- 讲清的（含追问后补上、说错后改对）对上的节点不动。他讲了、导图上没有的要紧内容（比如他自己举的例子），用他的原话加一个节点（只改听写错的字，留他的说法），最多 2 个：{"kind":"add","under":"<挂在哪个节点下>","text":"…"}
- 讲错的核心：找到导图上说这件事的那个节点，{"kind":"wrong","at":"<编号>","fix":"<一句正确说法，不超过 20 字>"}；导图上没有这件事的，{"kind":"add","under":"${branch}","text":"<这条核心>","mark":"wrong","fix":"…"}
- 含糊、没讲到的核心：{"kind":"blank","at":"<编号>"}；导图上没有的，{"kind":"add","under":"${branch}","text":"<这条核心>","mark":"blank"}
- 只用上面出现过的编号；这一支本身（${branch}）不标红、不留空框。

只回：{"ops":[…]}`
}

/** 读 AI 的回答：找出那段 JSON，照 checkPlan 只认这一支里的；读不懂返回 null */
export function readPlan(roots: MapNode[], branch: string, answer: string): MergePlan | null {
  const s = answer.indexOf('{')
  const e = answer.lastIndexOf('}')
  if (s === -1 || e <= s) return null
  try {
    return checkPlan(roots, branch, JSON.parse(answer.slice(s, e + 1)))
  } catch {
    return null
  }
}

/** 核对框里列的几行（顺序照计划，最后一行「讲清的节点不动」） */
export function mergeLines(roots: MapNode[], plan: MergePlan): MergeLine[] {
  const textAt = (k: string) => nodeAt(roots, keyPath(k))?.text ?? ''
  const out: MergeLine[] = plan.ops.map((o): MergeLine => {
    if (o.kind === 'wrong') return { kind: 'wrong', node: textAt(o.at), fix: o.fix }
    if (o.kind === 'blank') return { kind: 'blank', node: textAt(o.at) }
    if (o.mark === 'wrong') return { kind: 'add-wrong', text: o.text, fix: o.fix ?? '' }
    if (o.mark === 'blank') return { kind: 'add-blank', text: o.text }
    return { kind: 'add', text: o.text }
  })
  if (plan.kept) out.push({ kind: 'kept', n: plan.kept })
  return out
}

/**
 * 「放进去」：照计划改树。返回新的树和要一个个长出来的几处（新节点、标红的、挂空框的「<key>#blank」，按先后）。
 * 只往孩子末尾加，原来节点的路径都不变。
 */
export function applyMapMerge(roots: MapNode[], plan: MergePlan): { roots: MapNode[]; grow: string[] } {
  let out = roots
  const grow: string[] = []
  const append = (under: string, node: MapNode) => {
    const parent = nodeAt(out, keyPath(under))
    if (!parent) return null
    const path = [...keyPath(under), parent.children.length]
    // 收着的那一支先展开，长出来看得见
    if (parent.fold) out = setAttrs(out, keyPath(under), { fold: false })
    out = insertAt(out, keyPath(under), parent.children.length, node)
    return pathKey(path)
  }
  for (const o of plan.ops) {
    if (o.kind === 'add') {
      const k = append(o.under, { text: o.text, children: [], ...(o.mark === 'wrong' ? { wrong: true } : o.mark === 'blank' ? { blank: true } : {}) })
      if (!k) continue
      grow.push(k)
      if (o.mark === 'blank') grow.push(`${k}#blank`)
      if (o.mark === 'wrong' && o.fix) {
        const f = append(k, { text: o.fix, fix: true, children: [] })
        if (f) grow.push(f)
      }
    } else if (o.kind === 'wrong') {
      if (!nodeAt(out, keyPath(o.at))) continue
      // 原有的节点不重新长：字色过渡成红的；只有新挂上的正确说法长出来
      out = setAttrs(out, keyPath(o.at), { wrong: true })
      const f = append(o.at, { text: o.fix, fix: true, children: [] })
      if (f) grow.push(f)
    } else {
      if (!nodeAt(out, keyPath(o.at))) continue
      out = setAttrs(out, keyPath(o.at), { blank: true })
      grow.push(`${o.at}#blank`)
    }
  }
  return { roots: out, grow }
}

/** 虚线空框点开填了：这个节点下面加一个你写的子节点，blank 去掉 */
export function fillBlank(roots: MapNode[], key: string, text: string): MapNode[] {
  const path = keyPath(key)
  const n = nodeAt(roots, path)
  const t = text.replace(/\s*\n+\s*/g, ' ').trim()
  if (!n || !t) return roots
  const out = setAttrs(roots, path, { blank: undefined, ...(n.fold ? { fold: false } : {}) })
  return insertAt(out, path, n.children.length, { text: t, children: [] })
}

/** 这一轮的材料是这张导图的哪一支（找不到返回 null）：路径对得上、字也对得上；路径变了按字找回来 */
export function branchOf(text: string, notePath: string, meta: FeynmanMeta): string | null {
  const ref = meta.from.find((f) => f.kind === 'map' && f.path === notePath)
  if (!ref || ref.kind !== 'map') return null
  const roots = parseMindmap(text).roots
  const at = nodeAt(roots, keyPath(ref.node))
  if (at && (at.text === ref.text || !ref.text)) return ref.node
  let hit: string | null = null
  eachNode(roots, (n, path) => {
    if (!hit && n.text === ref.text) hit = pathKey(path)
  })
  return hit ?? (at ? ref.node : null)
}

// ---------------------------------------------------------------- 拍成导图

/**
 * 这一轮整理成一棵树（材料是卡片时「拍成导图」）：中心是知识点，每条核心一个节点；
 * 讲清的下面挂你的原话（第一句）；讲错的标红挂正确说法；含糊、没讲到的挂空框；了解即可讲到了的也挂上。
 */
export function roundTree(meta: FeynmanMeta): MapNode[] {
  const kids: MapNode[] = []
  const said = meta.extraSaid ?? {}
  for (const c of coreOutcomes(meta)) {
    if (c.state === 'wrong') kids.push({ text: c.text, wrong: true, children: [{ text: c.right, fix: true, children: [] }] })
    else if (c.state === 'vague' || c.state === 'missing') kids.push({ text: c.text, blank: true, children: [] })
    else kids.push({ text: c.text, children: c.quote.trim() ? [{ text: firstSentence(c.quote), children: [] }] : [] })
  }
  // 还没判过（没有状态）：只列核心
  if (!kids.length) for (const p of meta.points.filter((x) => x.kind === 'core')) kids.push({ text: p.text, children: [] })
  for (const p of meta.points.filter((x) => x.kind === 'extra' && said[x.id])) kids.push({ text: p.text, children: [] })
  return [{ text: meta.topic, children: kids }]
}

// ---------------------------------------------------------------- 记进笔记

/** 「记进笔记」那一块的标题：费曼缺口 · 范数 */
export const gapNoteTitle = (topic: string, w: FeynmanWords = ZH_WORDS) => `${w.gapNote} · ${topic.replace(/\s*\n\s*/g, ' ').trim()}`

/**
 * 「记进笔记」写进那篇末尾的一块：标题「费曼缺口 · 范数」+ 一个 AI 提示块（偏好「AI 写的一律带框带标志」）：
 * 判定一行（① 的 verdictLine，和这一轮里的一样）；空一行后缺口一条一行（① 的 gapsBody，写成要点，不是 `- [ ]`，不进待办和画布今日）。
 */
export function gapNote(meta: FeynmanMeta, o: { by?: string; words?: FeynmanWords } = {}): string {
  const w = o.words ?? ZH_WORDS
  const points = gapsBody(meta)
    .split('\n')
    .map((l) => l.replace(/^-\s+/, '').trim())
    .filter(Boolean)
  const block = aiCallout({ label: w.labels.gaps, ...(o.by ? { by: o.by } : {}), text: verdictLine(meta), points })
  return `## ${gapNoteTitle(meta.topic, w)}\n\n${block}\n`
}

/** 那篇里已经有的「费曼缺口 · 范数」那一块（标题到下一个同级或更高的标题前）；没有返回 null */
export function findGapNote(text: string, topic: string, words: FeynmanWords[] = [ZH_WORDS]): { from: number; to: number } | null {
  const titles = new Set(words.map((w) => gapNoteTitle(topic, w)))
  const lines = text.split('\n')
  let pos = 0
  let start: number | null = null
  let level = 0
  for (const l of lines) {
    const h = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(l)
    if (h) {
      if (start !== null && h[1]!.length <= level) return { from: start, to: pos }
      if (start === null && titles.has(h[2]!)) {
        start = pos
        level = h[1]!.length
      }
    }
    pos += l.length + 1
  }
  return start === null ? null : { from: start, to: text.length }
}

/** 记进那篇：已经有同一个点的那一块就原地换掉（再讲一次以后更新），没有就接在末尾，前面隔一个空行；别处一字不动 */
export function withGapNote(text: string, topic: string, block: string, words?: FeynmanWords[]): string {
  const at = findGapNote(text, topic, words)
  if (at) {
    const after = text.slice(at.to)
    return text.slice(0, at.from) + block + (after && !after.startsWith('\n') && !block.endsWith('\n\n') ? '\n' : '') + after
  }
  const lead = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return text + lead + block
}

/** 材料来自哪一篇（「记进笔记」写到这里）：导图、卡片、笔记是那一篇；PDF 是它旁边的「<名字> 笔记.md」；只写了一个词的没有 */
export function materialNote(meta: FeynmanMeta): string | null {
  for (const f of meta.from) {
    if (f.kind === 'map' || f.kind === 'card' || f.kind === 'note') return f.path
    if (f.kind === 'pdf') return f.path.replace(/\.pdf$/i, ' 笔记.md')
  }
  return null
}

/** 一条缺口在出卡、送过的记号（.canvas-notes/anki.json）里的身份 */
export const gapCardId = (round: string, point: string) => `feynman:${round}#${point}`

// ---------------------------------------------------------------- 导图上的进度

/** 导图第一层一个点讲得怎样：没讲过、正在讲、过、差一点、没过；day 是最近一次讲的那天 */
export type DotState = 'none' | 'talking' | Verdict
export interface MapDot {
  key: string
  state: DotState
  day?: string
  /** 一共讲过几次 */
  times: number
}

/**
 * 导图第一层每个点（中心的孩子）讲过没有、过没过：读这篇里每一轮的注释，材料是这一支（或这一支下面的）的算这个点的；
 * 同一个点讲过几次的看最近一次。done：讲过（判过）的几个；total：第一层几个点。
 */
export function mapProgress(text: string, notePath: string): { dots: Record<string, MapDot>; done: number; total: number } {
  const roots = parseMindmap(text).roots
  const center = roots[0]
  const dots: Record<string, MapDot> = {}
  if (!center) return { dots, done: 0, total: 0 }
  center.children.forEach((_, i) => (dots[pathKey([0, i])] = { key: pathKey([0, i]), state: 'none', times: 0 }))
  const rounds = findRounds(text)
    .map((r) => r.meta)
    .sort((a, b) => (a.judged ?? a.day).localeCompare(b.judged ?? b.day))
  for (const m of rounds) {
    const k = branchOf(text, notePath, m)
    if (k === null) continue
    // 第一层的那个点：这一支本身，或它在哪个第一层点下面
    const top = keyPath(k).slice(0, 2)
    if (top.length < 2 || top[0] !== 0) continue
    const d = dots[pathKey(top)]
    if (!d) continue
    const state: DotState = m.status === 'judged' && m.verdict ? m.verdict : m.status === 'draft' ? d.state : 'talking'
    if (state === d.state && m.status === 'draft') continue
    dots[pathKey(top)] = { key: d.key, state, day: m.judged ?? m.day, times: d.times + (m.status === 'judged' ? 1 : 0) }
  }
  const all = Object.values(dots)
  return { dots, done: all.filter((d) => d.state === 'pass' || d.state === 'almost' || d.state === 'fail').length, total: all.length }
}
