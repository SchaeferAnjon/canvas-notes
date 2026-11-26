/**
 * 抽要点、学生说一轮、判定的整套流程：问 AI 的那一下由调用的人给（主进程给真的引擎或 CN_AI_FAKE 的假回答，单元测试给假的），
 * 别的规矩都在这里由软件守：拆点、三轮上限、两次没答对才说穿、判定和日子。
 */
import type { Draft, ExtractReq, ExtractResult, JudgeReq, JudgeResult, TurnReq, TurnResult } from './api'
import type { Candidate } from './api'
import { fakeExtract, fakeJudge, fakePdfList, fakeSameThing, fakeTurn } from './fake'
import { type GatherDeps, gather, headOf, materialText, unitIdOf } from './material'
import { EXTRACT_SYSTEM, extractPrompt, JUDGE_SYSTEM, judgePrompt, parseExtract, parseJudge, parsePdfList, parseSame, parseTurn, PDF_LIST_SYSTEM, pdfListPrompt, SAME_SYSTEM, samePrompt, studentSystem, turnPrompt, type ExtractedPoint } from './prompts'
import { judgeEntries, longJudged, longTurn } from './long'
import { lastAsk, roundsDone } from './round'
import { applyEdits, gapsBody, judgedMeta, redoneMeta, verdictBody } from './rules'
import type { Asked, CoverRef, Scope } from './types'

/** 交给 AI 的图：库里的文件（框选截图、卡上的图），或者拍下来的（手画的图） */
export type ImageIn = { path: string } | { mime: string; base64: string }

export interface AskQ {
  kind: 'extract' | 'list' | 'same' | 'turn' | 'judge'
  system: string
  prompt: string
  /** 有图就交给「看图问」那家，没有用「AI 对话」那家 */
  images: ImageIn[]
  /** CN_AI_FAKE=1 时用的回答 */
  fake(): string
  /** 边写边给的那个字段（turn 是 say，judge 是 full）：主进程从半截 JSON 里取出来推给界面 */
  stream?: string
}

export interface FlowDeps {
  gather: GatherDeps
  ask(q: AskQ): Promise<string>
  /** 这一问用的哪家「Claude Code · Opus 5.5」（有图是看图问那家） */
  by(images: boolean): string
}

/** 抽出来的一个点变成「这次要讲到」 */
function draftOf(p: ExtractedPoint, o: Omit<Draft, 'topic' | 'points' | 'myths'> & { edits?: ExtractReq['edits']; word?: string }): Draft {
  const { edits, word, ...rest } = o
  return { ...rest, topic: word || p.topic, points: applyEdits(p.points, edits), myths: p.myths }
}

/**
 * 抽要点（teaching.md 2.1、3.3）：一整份 PDF 先给单子；导图一支超过 5 个子枝，子枝各当一个点；抽出来核心超过 5 条（AI 分成了几个点），列出来让你挑。
 * listOnly（拆点接口）：能拆的都只给单子，不抽要点（只有一个点时也给一项的单子，带着抽好的）
 */
export async function extract(req: ExtractReq, deps: FlowDeps, o: { listOnly?: boolean } = {}): Promise<ExtractResult> {
  const scope: Scope = req.pick?.scope ?? req.scope ?? 'point'
  if (req.pick?.draft) return { kind: 'draft', draft: req.pick.draft }
  const refs = req.pick?.refs ?? req.refs
  if (!refs.length) throw new Error('先选要讲的东西：导图的一支、几张卡、一个词或一份 PDF')
  const g = await gather(refs, deps.gather, { ...(req.board ? { board: req.board } : {}) })
  const siblings = req.pick?.siblings

  // 一整份 PDF：先给这一讲的知识点单子（串讲这一讲、这一章时整份一起抽）
  if (g.pdfToList && scope === 'point') {
    const { path, pages } = g.pdfToList
    const name = path.split('/').pop()!.replace(/\.pdf$/i, '')
    const ans = await deps.ask({ kind: 'list', system: PDF_LIST_SYSTEM, prompt: pdfListPrompt(name, pages.map((p) => ({ page: p.page, text: p.text.slice(0, 2500) }))), images: [], fake: () => fakePdfList(pages) })
    const list = parsePdfList(ans, pages.length)
    const names = list.items.map((x) => x.name)
    const items: Candidate[] = list.items.map((x) => ({ name: x.name, cores: x.cores, level: x.level, refs: [{ kind: 'pdf', path, pages: [x.from, x.to] }], scope: 'point', siblings: names }))
    const chain: Candidate = { name: list.title || name, refs: [{ kind: 'pdf', path, pages: [1, pages.length] }], scope: 'section', siblings: names }
    return { kind: 'pick', why: 'pdf', title: list.title || name, items, chain, by: deps.by(false) }
  }
  if (g.pdfToList) {
    // 串讲：整份 PDF 的字都给
    for (const p of g.pdfToList.pages) g.pieces.push({ ref: { kind: 'pdf', path: g.pdfToList.path, pages: [p.page, p.page] }, title: `第 ${p.page} 页`, text: p.text.slice(0, 2000), images: [], src: { kind: 'pdf', path: g.pdfToList.path, page: p.page } })
  }
  // 导图这一支超过 5 个子枝：子枝各当一个点，这一支变串讲
  if (g.branch && scope === 'point' && !req.noSplit) {
    const names = g.branch.items.map((x) => x.name)
    return { kind: 'pick', why: 'branch', title: g.branch.title, items: g.branch.items.map((x) => ({ ...x, siblings: names })), chain: { ...g.branch.chain, siblings: names }, by: deps.by(false) }
  }

  const mat = materialText(g.pieces)
  const images: ImageIn[] = mat.images.map((path) => ({ path }))
  // 白板上的手写：拍成的一张图跟在材料后面（交「看图问」那家）；只有手写也算有材料
  if (req.ink) {
    images.push({ mime: req.ink.mime, base64: req.ink.base64 })
    mat.text += `${mat.text ? '\n\n' : ''}## 白板上的手写\n[图 ${images.length}]`
  }
  const noMaterial = g.noMaterial && !req.ink
  const topic = req.pick?.name ?? g.topic
  const ans = await deps.ask({
    kind: 'extract',
    system: EXTRACT_SYSTEM,
    prompt: extractPrompt(mat.text, { scope, ...(topic ? { topic } : {}), noMaterial }),
    images,
    fake: () => fakeExtract(mat.text, { ...(topic ? { topic } : {}), scope }),
  })
  const pts = parseExtract(ans)
  const by = deps.by(images.length > 0)
  const word = refs.length === 1 && refs[0]!.kind === 'word' ? refs[0]!.word : undefined
  const basisLine = req.ink ? (g.noMaterial ? '照白板上的手写核对' : g.basisLine.replace(/核对$/, '和白板上的手写核对')) : g.basisLine
  const base = { scope, from: g.refs, cover: g.cover, ...(noMaterial ? { noMaterial: true } : {}), ...(g.lecture ? { lecture: g.lecture } : {}), basisLine, by, ...(req.edits ? { edits: req.edits } : {}), ...(siblings ? { siblings } : {}) }

  // 核心超过 5 条：AI 分成了几个点，列出来挑（「就讲这一整个」= noSplit 时并成一个）
  if (pts.length > 1 && !req.noSplit && scope === 'point') {
    const names = pts.map((p) => p.topic)
    const items: Candidate[] = pts.map((p) => ({ name: p.topic, cores: p.points.filter((x) => x.kind === 'core').length, refs, scope: 'point', siblings: names, draft: draftOf(p, { ...base, siblings: names }) }))
    return { kind: 'pick', why: 'many-cores', title: topic ?? pts[0]!.topic, items, chain: { name: topic ?? pts[0]!.topic, refs, scope: 'section', siblings: names }, by }
  }
  const merged: ExtractedPoint = pts.length === 1 ? pts[0]! : mergePoints(pts, topic)
  // 材料只有一个出处（一张卡、PDF 一页、一个网页）：每条要点的出处就是它，缺口点了回到那里
  const srcs = [...new Map(g.pieces.filter((x) => x.src).map((x) => [JSON.stringify(x.src), x.src!])).values()]
  const one: ExtractedPoint = srcs.length === 1 ? { ...merged, points: merged.points.map((x) => ({ ...x, src: srcs[0]! })) } : merged
  const cover = [...g.cover, ...(await sameThing(one, g, deps))]
  const draft = draftOf(one, { ...base, cover, ...(word ? { word } : {}) })
  if (o.listOnly) return { kind: 'pick', why: 'many-cores', title: draft.topic, items: [{ name: draft.topic, cores: draft.points.filter((p) => p.kind === 'core').length, refs, scope, draft }], by }
  return { kind: 'draft', draft }
}

/** 「就讲这一整个」：几个点并成一个，编号重排 */
function mergePoints(pts: ExtractedPoint[], topic?: string): ExtractedPoint {
  let c = 0
  let e = 0
  const points = pts.flatMap((p, gi) =>
    p.points.map((x) => ({ ...x, id: x.kind === 'core' ? `c${++c}` : `e${++e}`, _old: `${gi}:${x.id}` })),
  )
  const myths = pts.flatMap((p, gi) => p.myths.map((m, i) => ({ ...m, id: `m${gi + 1}${i + 1}`, core: points.find((x) => x._old === `${gi}:${m.core}`)?.id ?? 'c1' })))
  return { topic: topic ?? pts[0]!.topic, points: points.map(({ _old, ...x }) => x), myths }
}

/** 同一块白板上讲同一件事的卡（问 AI 挑；卡太多只给前 40 张） */
async function sameThing(p: ExtractedPoint, g: Awaited<ReturnType<typeof gather>>, deps: FlowDeps): Promise<CoverRef[]> {
  const cards = g.others.filter((x) => x.text.trim()).slice(0, 40)
  if (!cards.length) return []
  const list = cards.map((c, i) => ({ n: i + 1, text: c.text }))
  const ans = await deps.ask({ kind: 'same', system: SAME_SYSTEM, prompt: samePrompt(p.topic, p.points, list), images: [], fake: () => fakeSameThing(p.topic, list) })
  return parseSame(ans)
    .map((n) => cards[n - 1])
    .filter((c): c is (typeof cards)[number] => !!c)
    .map((c) => ({ kind: 'card', path: c.path, head: headOf(c.unit.text), from: c.unit.from, to: c.unit.to, why: 'same-thing', ...(unitIdOf(c.unit) ? { id: unitIdOf(c.unit) } : {}) }))
}

/**
 * 学生说一轮（teaching.md 5.2）。软件守的：一轮盯一条、最多三轮；同一条连着两次没答对才说穿（AI 早说穿了不要那一句，
 * 该说穿没说就照答案和出处补一句）；确认加还是减、答「要不要会」不算一轮
 */
export async function turn(req: TurnReq, deps: FlowDeps): Promise<TurnResult> {
  // 聊到底（再讲这几处照旧走下面）；三轮用完点「接着聊下去」也从这里转过去
  if ((req.meta.mode === 'long' && !req.only) || req.cmd === 'more') return longTurn(req, deps)
  const { meta, entries, only } = req
  const images: ImageIn[] = req.image ? [{ mime: req.image.mime, base64: req.image.base64 }] : []
  const ans = await deps.ask({ kind: 'turn', system: studentSystem(meta.topic, meta.scope), prompt: turnPrompt(meta, entries, only), images, fake: () => fakeTurn(meta, entries, only), stream: 'say' })
  const p = parseTurn(ans, meta)
  const prev = lastAsk(meta.asked)
  const miss = p.last === 'miss' && prev?.point ? (prev.miss ?? 0) + 1 : 0
  let act = p.act
  let reveal = p.reveal
  let say = p.say
  let point = p.point
  const prevPoint = prev?.point ? meta.points.find((x) => x.id === prev.point) : undefined
  if (reveal && miss < 2) reveal = undefined
  if (!reveal && miss >= 2 && prevPoint) reveal = `${prevPoint.answer || prevPoint.text}。出处：${prevPoint.basis}。`
  if (act === 'reveal') {
    // 只说穿、没接着问：说的就是说穿那句
    reveal ??= say || undefined
    say = ''
    act = roundsDone(meta.asked) ? 'done' : 'ask'
    if (act === 'ask' && !say) act = 'done'
  }
  // 三轮用完：不开新的一条
  const newPoint = (act === 'ask' || act === 'redirect') && point !== prev?.point
  if (newPoint && roundsDone(meta.asked)) {
    act = 'done'
    say = ''
    point = undefined
  }
  // 说穿了以后接着问同一条：不算，换成问完
  if (reveal && (act === 'ask' || act === 'redirect') && point === prev?.point) {
    act = roundsDone(meta.asked) ? 'done' : act
  }
  if (only && point && !only.includes(point) && (act === 'ask' || act === 'redirect')) {
    act = 'done'
    say = ''
  }
  const asked: Asked[] = [...meta.asked]
  if (reveal) asked.push({ act: 'reveal', ...(prev?.point ? { point: prev.point } : {}) })
  if (act !== 'done' || say) asked.push({ act, ...(point ? { point } : {}), ...((act === 'ask' || act === 'redirect') && point === prev?.point && !reveal ? { miss } : {}) })
  const touched = [...new Set([...(meta.touched ?? []), ...p.touched])].filter((id) => meta.points.some((x) => x.id === id && x.kind === 'core'))
  return { act, say, ...(reveal ? { reveal } : {}), ...(point ? { point } : {}), ...(p.quote ? { quote: p.quote } : {}), meta: { ...meta, asked, touched }, by: deps.by(images.length > 0) }
}

/** 讲完了：AI 给每条核心的状态和证据，软件算判定、日子、缺口；当场补讲（only）走「过 · 当场补讲」 */
export async function judge(req: JudgeReq, deps: FlowDeps): Promise<JudgeResult> {
  const { meta, only } = req
  const entries = judgeEntries(meta, req.entries)
  const ans = await deps.ask({ kind: 'judge', system: JUDGE_SYSTEM, prompt: judgePrompt(meta, entries, only), images: [], fake: () => fakeJudge(meta, entries, only), stream: 'full' })
  const j = parseJudge(ans, meta, only)
  if (only) {
    const next = redoneMeta(meta, j.states, req.today)
    return { meta: next, states: j.states, blocks: { verdict: verdictBody(next), gaps: gapsBody(next) }, wording: [], full: '', by: deps.by(false) }
  }
  const next = (meta.mode === 'long' ? longJudged : judgedMeta)(meta, { states: j.states, rights: j.rights, full: j.full, today: req.today, prevPasses: req.prevPasses })
  return {
    meta: next,
    states: next.states ?? j.states,
    blocks: { verdict: verdictBody(next), gaps: gapsBody(next), wording: j.wording.map((w) => `- ${w}`).join('\n'), full: j.full },
    wording: j.wording,
    full: j.full,
    by: deps.by(false),
  }
}


