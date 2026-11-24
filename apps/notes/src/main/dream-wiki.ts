/**
 * 梦游 Wiki 化（task-h7oy8，设计页 24-梦游底层 W 节，用户定 A1 B1 C1 D1）：
 * - A1：A 里提到一个东西的那几个字原地变成链接，链到 B 的整篇、那一节（[[B#标题|字]]）或那一段（[[B#^块编号|字]]），字不变；
 * - B1：链到一段、那段没有块编号时在那段最后一行行尾加 ` ^xxxxxx`（只在这一条的提交里，收下才进 main；提交前核对 B 只多了块编号）；
 * - 找候选：A 的每句话直接在全库每一段里找（名字、标题、关键词三路在 wiki-find.ts，向量那一路读搜索索引的段向量），按名次合起来，
 *   软件先猜级别，再交给 AI 判（链不链、哪一级、哪几个字、凭哪一句，这一节时 AI 自己写标题），软件逐字核对，对不上作废；
 * - D1：同一篇被两篇以上用同一个别的写法整篇链过去，建议给它加别名（收下改的是那篇的属性，提交前核对只动了别名）；
 * - C1：库里 3 篇以上提到、没有讲它的一篇的东西，列成「建词条页」建议（不建，点了才建，见 wiki-entry.ts）。
 * 判过的按 A 的正文指纹记在梦游进度里（dream-ledger.ts 的 wiki），A 没改不再问；一晚和补双链共用问 AI 的上限。不碰 Electron。
 */
import { readFile } from 'node:fs/promises'
import { atomicWrite } from '@cn/atomic'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { addBlockId, blockIdOf, decodeNote, encodeNote, findHeading, newBlockId, onlyBlockIdsAdded, outline, readPropList, setPropList } from '@cn/format'
import * as git from '@cn/git'
import type { DreamGroup, DreamItem } from '../shared/api'
import type { DreamSettings } from '../shared/dream-settings'
import { LINK_ASK } from '../shared/dream-judge'
import { titleOf } from '../shared/layout'
import { CLIP_P, LEVEL_WORD, parseWiki, WIKI_SYSTEM, WIKI_VERSION, type WikiCandInfo, type WikiClauseInfo, type WikiLevel, type WikiNoteInfo, wikiPrompt } from '../shared/wiki-judge'
import { DEFAULT_LINE, type JudgeLine } from './dream-judge'
import { countAsk, type Ledger, leftTonight, loadLedger, saveLedger, undirected, type WikiDone } from './dream-ledger'
import { busyRanges, linkTarget } from './related'
import { aliasesIn, bigramsOf, findHits, thingNote, usableB, type Clause, type ClauseHits, clausePlain, clausesOf, DATED, headingOfPassage, type Hit, sectionsOf, namesOf, PassageIndex, passagePlain } from './wiki-find'
import { DreamInterrupted, type JudgeAsk } from './dream-links'
import { isAutoSummary } from './duplicates'

/** 每句最多带几段候选、一篇一次最多问几句 */
const K = 5
const MAX_CLAUSES = 8
/** 一句话的候选里同一篇最多几段 */
const PER_NOTE = 2
const RRF = 60
/**
 * 向量那一路一段算「够像」的线（这句话值得问 AI）：bge-m3 上「海德堡老城区」对「海德堡注脚」0.57、对斯特拉斯堡攻略「老城区」0.53（设计页 W.1 ④），
 * 线取 0.56；本机小模型 e5 什么都给 0.8 上下，线取 0.9
 */
export const VEC_GATE = { bge: 0.56, e5: 0.9 }

export type WikiFind = (texts: [string, string][], asks: [string, string[]][]) => Promise<ClauseHits[][]>
/** 向量那一路：每句在全库最像的几段（段的原文，和建索引同一个切法）；索引没建好 null */
export type WikiVec = (qs: string[], k: number) => Promise<{ model: string; hits: { path: string; score: number; text: string }[][] } | null>

export const findInProcess: WikiFind = async (texts, asks) => findHits(texts, asks)

const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
const fpOf = (text: string) => createHash('sha1').update(WIKI_VERSION + '\0' + text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')).digest('hex').slice(0, 16)

export interface WikiOptions {
  wt: string
  texts: Map<string, string>
  /** 去掉了好几篇都抄着的行（日记里每天抄的任务清单）的正文：这些行里的句子不当 A */
  stripped: Map<string, string>
  loose: string[]
  set: DreamSettings
  ask: JudgeAsk
  by: string
  line?: JudgeLine
  ledgerFile?: string
  now: Date
  parallel: number
  signal?: AbortSignal
  find?: WikiFind
  vec?: WikiVec
  commit(message: string, ok?: ReadonlySet<string>): Promise<string>
  add(group: DreamGroup, it: Omit<DreamItem, 'id' | 'group' | 'state'>): DreamItem
  notes: string[]
}

export interface WikiStats {
  asked: number
  cached: number
  left: number
  link: number
  unsure: number
  voided: number
  skipped: number
  entries: number
  aliases: number
  vec: string | null
  failed: number
}

/** 一处核对过、要写进去的链接 */
interface Ready {
  a: string
  line: number
  start: number
  end: number
  words: string
  b: string
  level: WikiLevel
  /** 这一节：B 里真的那个标题；这一段：B 里那一段 */
  heading?: string
  passage?: { line: number; end: number; id?: string; text: string }
  confidence: number
  why: string
  quoteA: string
  quoteB: string
  sure: boolean
}

/** 一段的纯文字（给 AI 看） */
const plainOf = (text: string) => passagePlain(text).replace(/\s+/g, ' ').trim()

/** 一句话在 A 那一行里哪几个字能改成链接：在这句的范围里、不在已有的链接、代码、网址里 */
function wordsAt(line: string, c: { start: number; end: number }, words: string): [number, number] | null {
  const busy = busyRanges(line)
  let from = c.start
  for (;;) {
    const at = line.indexOf(words, from)
    if (at < 0 || at + words.length > c.end) return null
    const e = at + words.length
    if (!busy.some(([x, y]) => at < y && e > x)) return [at, e]
    from = at + 1
  }
}

/** 这一句现在在 A 的第几行、从哪到哪（A 没改时就是记下的那一处） */
function locate(lines: string[], c: { line: number; start: number; end: number; text: string }): { line: number; start: number; end: number } | null {
  if (lines[c.line]?.slice(c.start, c.end) === c.text) return c
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!.indexOf(c.text)
    if (at >= 0) return { line: i, start: at, end: at + c.text.length }
  }
  return null
}

/** 判完一句里的一处：照 B 现在的样子核对；对不上 null */
function verify(a: string, aLines: string[], c: WikiDone['clauses'][number], l: WikiDone['clauses'][number]['links'][number], texts: Map<string, string>, line: JudgeLine): Ready | 'void' | null {
  const bText = texts.get(l.path)
  if (bText === undefined || l.path === a) return 'void'
  // 模板、目录页不当 B（判的时候没挡住的、以前判过的）
  if (!thingNote(l.path, bText)) return null
  const at = locate(aLines, c)
  if (!at) return null
  const w = wordsAt(aLines[at.line]!, at, l.words)
  if (!w) return 'void'
  const sure = l.confidence >= line.pass
  if (l.confidence < LINK_ASK) return null
  // AI 的理由里偶尔用问它时的代号（N4、P2、C1）：换成人话
  const why = l.reason.replace(/\bN\d+\s*/g, `「${titleOf(l.path)}」`).replace(/\bP\d+\s*/g, '那一段').replace(/\bC\d+\s*/g, '这句').trim()
  const base = { a, line: at.line, start: w[0], end: w[1], words: l.words, b: l.path, confidence: l.confidence, why, quoteA: clausePlain(c.text), quoteB: l.quote, sure }
  const o = outline(bText)
  if (l.level === 'heading') {
    // 原型错的 3 条：链接落在候选给的那一节、不是 AI 说的那一节。这里只认 AI 写的标题，核对它真在 B 里
    const want = l.heading || (l.passage >= 0 ? headingOfPassage(o, o.passages[l.passage]) : '')
    const hl = want ? findHeading(bText, want) : -1
    if (hl < 0) return 'void'
    const h = o.headings.find((x) => x.line === hl)!
    return { ...base, level: 'heading', heading: h.text, quoteB: l.quote || h.text }
  }
  if (l.level === 'block') {
    const q = squash(l.quote)
    const key = squash(l.passageText).slice(0, 40)
    // 先认记下的那一段（字还在），再在 B 里找有那一句原话的那一段
    let p = o.passages.find((x) => key && squash(x.text).includes(key))
    if (q.length >= 6 && !(p && squash(plainP(p)).includes(q))) p = o.passages.find((y) => squash(plainP(y)).includes(q))
    if (!p || q.length < 6 || !squash(plainP(p)).includes(q)) return 'void'
    // 表格的块编号要另起一行写（Obsidian 的写法），不往表格里加：退回那一节
    if (p.kind === 'table') {
      if (!headingOfPassage(o, p)) return 'void'
      return { ...base, level: 'heading', heading: headingOfPassage(o, p) }
    }
    return { ...base, level: 'block', passage: { line: p.line, end: p.end, ...(p.id ? { id: p.id } : {}), text: p.text } }
  }
  // 整篇：核对那一句在 B 里，或者写的是 B 的名字、别名、标题（整篇级的证据是标题，不要求摘一句）
  const names = [titleOf(l.path), ...namesOf(l.path, aliasesIn(bText))].map(squash)
  const q = squash(l.quote)
  const ok = (q.length >= 4 && (squash(bText).includes(q) || names.some((n) => n.includes(q) || q.includes(n)))) || names.some((n) => n && (n.includes(squash(l.words)) || squash(l.words).includes(n)))
  if (!ok) return 'void'
  return { ...base, level: 'note' }
}
const plainP = (p: { text: string }) => plainOf(p.text)

/** 合并各路的名次（RRF），每句前 K 段，同一篇最多 PER_NOTE 段 */
function merge(lists: { hits: Hit[]; w?: number }[]): { path: string; i: number; via: Set<string>; heading?: number; s: number }[] {
  const m = new Map<string, { path: string; i: number; via: Set<string>; heading?: number; s: number }>()
  const names = ['名字', '标题', '关键词', '向量']
  lists.forEach((l, k) =>
    l.hits.forEach((h, r) => {
      const key = `${h.path}\0${h.i}`
      const e = m.get(key) ?? m.set(key, { path: h.path, i: h.i, via: new Set(), s: 0 }).get(key)!
      e.s += (l.w ?? 1) / (RRF + r)
      e.via.add(names[k]!)
      if (h.heading !== undefined) e.heading = h.heading
    }),
  )
  const out: ReturnType<typeof merge> = []
  const per = new Map<string, number>()
  for (const e of [...m.values()].sort((a, b) => b.s - a.s || a.path.localeCompare(b.path) || a.i - b.i)) {
    if (out.length >= K) break
    if ((per.get(e.path) ?? 0) >= PER_NOTE) continue
    per.set(e.path, (per.get(e.path) ?? 0) + 1)
    out.push(e)
  }
  return out
}

/** 跑一组并发 */
async function pool<T>(items: T[], n: number, signal: AbortSignal | undefined, run: (x: T) => Promise<void>) {
  let i = 0
  const lane = async () => {
    while (i < items.length && !signal?.aborted) await run(items[i++]!)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, lane))
}

/** 写进文件的那个链接：[[B|字]]、[[B#标题|字]]、[[B#^id|字]]（字和名字一样时只写 [[B]]） */
export function wikiLink(target: string, anchor: string, words: string): string {
  const inner = anchor ? `${target}#${anchor}` : target
  return !anchor && words === target ? `[[${inner}]]` : `[[${inner}|${words}]]`
}

/** 梦游的 Wiki 化这一步：返回这一晚的账和链上的那几对（补双链那一步不再重复提） */
export async function wikiLinks(o: WikiOptions): Promise<{ stats: WikiStats; pairs: Set<string> }> {
  const line = o.line ?? DEFAULT_LINE
  const ledger: Ledger = await loadLedger(o.ledgerFile)
  const rejected = new Set(ledger.rejected)
  const stats: WikiStats = { asked: 0, cached: 0, left: 0, link: 0, unsure: 0, voided: 0, skipped: 0, entries: 0, aliases: 0, vec: null, failed: 0 }
  const raw = o.texts
  const md = [...raw].filter(([p]) => p.toLowerCase().endsWith('.md'))

  // ① A 的句子：好几篇都抄着的行（日记的任务清单）不算
  const clausesFor = (a: string): Clause[] => {
    const kept = new Set((o.stripped.get(a) ?? '').split('\n'))
    return clausesOf(raw.get(a)!).filter((c) => kept.has(raw.get(a)!.split('\n')[c.line]!))
  }
  // 当 A 的门槛比当 B 低：一句「今天晚上去海德堡老城区玩了。」也值得链（当 B 要正文至少 20 个字）
  const loose = o.loose.filter((p) => raw.has(p) && !isAutoSummary(raw.get(p)!) && raw.get(p)!.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^#.*$/gm, '').replace(/\s+/g, '').length >= 6)
  const queue = loose.filter((p) => ledger.wiki[p]?.fp !== fpOf(raw.get(p)!))
  queue.sort((a, b) => Number(a in ledger.wiki) - Number(b in ledger.wiki) || a.localeCompare(b))
  stats.cached = loose.length - queue.length

  // ② 找候选（只给这晚要判的那几篇找）
  const cl = new Map(queue.map((p) => [p, clausesFor(p)] as const))
  const asks = queue.filter((p) => cl.get(p)!.length).map((p) => [p, cl.get(p)!.map((c) => clausePlain(c.text))] as [string, string[]])
  const find = o.find ?? findInProcess
  const found = asks.length ? await find(md, asks) : []
  const hitsOf = new Map(asks.map(([p], k) => [p, found[k]!] as const))
  const outlines = new Map<string, ReturnType<typeof outline>>()
  const ol = (p: string) => outlines.get(p) ?? outlines.set(p, outline(raw.get(p) ?? '')).get(p)!

  // 一句值不值得问：名字、标题那一路命中，或者关键词最前那段和这句共有两个以上少见的词，或者向量那一路够像
  const room = leftTonight(ledger, o.now, o.set.nightCap, 'wiki')
  type Plan = { a: string; clauses: { c: Clause; cands: ReturnType<typeof merge>; vec: number; kw: number }[] }
  const plans: Plan[] = []
  for (const [a] of asks) {
    const hs = hitsOf.get(a)!
    const cs = cl.get(a)!
    const strong = cs
      .map((c, k) => ({ c, h: hs[k]!, k }))
      .filter(({ h, c }) => h.name.length || h.head.length || (h.kw[0] && kwStrong(c, h.kw[0], ol)))
    plans.push({ a, clauses: strong.map(({ c, h }) => ({ c, cands: merge([{ hits: h.name, w: 1.5 }, { hits: h.head, w: 1.3 }, { hits: h.kw }]), vec: 0, kw: h.kw[0]?.score ?? 0 })) })
  }

  // 向量那一路：这晚要问的那几篇的每一句（不只是关键词够的那几句：讲法不一样、字面不像的靠它）
  const todayPlans = plans.slice(0, Math.max(0, room))
  if (o.vec && todayPlans.length) {
    const all: { a: string; c: Clause; plan: Plan }[] = []
    for (const p of todayPlans) for (const c of cl.get(p.a)!) all.push({ a: p.a, c, plan: p })
    let vec: Awaited<ReturnType<WikiVec>> = null
    try {
      vec = await o.vec(
        all.map((x) => clausePlain(x.c.text)),
        8,
      )
    } catch (e) {
      o.notes.push(`Wiki 链接的向量那一路没用上：${(e as Error).message}`)
    }
    if (vec) {
      stats.vec = vec.model
      const gate = /bge/i.test(vec.model) && !/fake/i.test(vec.model) ? VEC_GATE.bge : VEC_GATE.e5
      all.forEach((x, k) => {
        const hits: Hit[] = []
        for (const h of vec!.hits[k] ?? []) {
          if (h.path === x.a || !raw.has(h.path) || !thingNote(h.path, raw.get(h.path)!) || !usableB(h.path, raw.get(h.path)!)) continue
          const i = passageIn(ol(h.path), h.text, x.c.text)
          if (i >= 0) hits.push({ path: h.path, i, score: h.score })
        }
        if (!hits.length) return
        let entry = x.plan.clauses.find((y) => y.c === x.c)
        if (!entry && hits[0]!.score >= gate) {
          entry = { c: x.c, cands: [], vec: 0, kw: 0 }
          x.plan.clauses.push(entry)
        }
        if (!entry) return
        entry.vec = hits[0]!.score
        const k2 = cl.get(x.a)!.indexOf(x.c)
        const h0 = hitsOf.get(x.a)![k2]!
        entry.cands = merge([{ hits: h0.name, w: 1.5 }, { hits: h0.head, w: 1.3 }, { hits: h0.kw }, { hits }])
      })
    }
  }

  // ③ 问 AI：一篇一问，最多 MAX_CLAUSES 句（名字、标题命中的先，再按向量分）
  let saving = Promise.resolve()
  await pool(todayPlans, o.parallel, o.signal, async (plan) => {
    const a = plan.a
    const text = raw.get(a)!
    const chosen = plan.clauses
      .filter((x) => x.cands.length)
      .sort((x, y) => Number(y.cands.some((c) => c.via.has('名字') || c.via.has('标题'))) - Number(x.cands.some((c) => c.via.has('名字') || c.via.has('标题'))) || y.vec - x.vec || y.kw - x.kw || x.c.line - y.c.line)
      .slice(0, MAX_CLAUSES)
      .sort((x, y) => x.c.line - y.c.line || x.c.start - y.c.start)
    const done: WikiDone = { fp: fpOf(text), at: Date.now(), clauses: [] }
    if (!chosen.length) {
      // 没有一句值得问：记成判完；向量那一路这晚没用上（索引还在建）时不记，下一晚有了向量再看一遍
      if (stats.vec || !o.vec) ledger.wiki[a] = done
      return
    }
    const notes: WikiNoteInfo[] = []
    const noteIx = new Map<string, number>()
    const sectionOfA = (line: number) => {
      const hs = ol(a).headings.filter((h) => h.line < line)
      return hs.length ? hs[hs.length - 1]!.text : ''
    }
    const info: WikiClauseInfo[] = chosen.map((x) => ({
      text: clausePlain(x.c.text),
      section: sectionOfA(x.c.line),
      cands: x.cands.map((c): WikiCandInfo => {
        if (!noteIx.has(c.path)) {
          noteIx.set(c.path, notes.length)
          notes.push({ title: titleOf(c.path), headings: sectionsOf(ol(c.path)).slice(0, 16).map((h) => (h.text.length > 40 ? h.text.slice(0, 40) + '…' : h.text)) })
        }
        const o2 = ol(c.path)
        const p = c.i >= 0 ? o2.passages[c.i] : undefined
        const heading = c.heading !== undefined ? o2.headings[c.heading]!.text : headingOfPassage(o2, p)
        return { note: noteIx.get(c.path)!, heading, text: p ? focusText(plainOf(p.text), clausePlain(x.c.text)) : titleOf(c.path), guess: guessLevel(c, x.cands, o2) }
      }),
    }))
    let reply: string
    try {
      stats.asked++
      countAsk(ledger, o.now, 'wiki')
      reply = await o.ask(WIKI_SYSTEM, wikiPrompt({ title: titleOf(a), clauses: info, notes }), o.signal)
    } catch (e) {
      if (o.signal?.aborted) return
      stats.failed++
      if (stats.failed <= 3) o.notes.push(`「${titleOf(a)}」的 Wiki 链接没判成：${(e as Error).message}`)
      return
    }
    const got = parseWiki(reply, chosen.length, (c) => chosen[c]!.cands.length)
    if (!got) {
      stats.failed++
      if (stats.failed <= 3) o.notes.push(`「${titleOf(a)}」的 Wiki 链接没判成：AI 没给出能读的判断`)
      return
    }
    for (const g of got) {
      const x = chosen[g.clause]!
      done.clauses.push({
        line: x.c.line,
        start: x.c.start,
        end: x.c.end,
        text: x.c.text,
        thing: g.thing,
        links: g.links.map((l) => {
          const c = x.cands[l.cand]!
          const p = c.i >= 0 ? ol(c.path).passages[c.i] : undefined
          return { path: c.path, level: l.level, heading: l.heading, passage: c.i, passageText: p?.text.slice(0, 200) ?? '', words: l.words, quote: l.quote, confidence: l.confidence, reason: l.reason }
        }),
      })
    }
    ledger.wiki[a] = done
    saving = saving.then(() => saveLedger(o.ledgerFile, ledger))
    await saving
  })
  await saving
  if (o.signal?.aborted) throw new DreamInterrupted()
  // 一句都没有的（只有标题、清单）：记成判完，A 改了再看；这晚没轮到的下一晚接着
  for (const p of queue) if (!cl.get(p)!.length) ledger.wiki[p] = { fp: fpOf(raw.get(p)!), at: Date.now(), clauses: [] }
  stats.left = plans.length - todayPlans.length
  await saveLedger(o.ledgerFile, ledger)

  // ④ 核对、过线（这晚新判的和以前判过、A 没改的）
  const ready: Ready[] = []
  for (const a of loose) {
    const d = ledger.wiki[a]
    if (!d || d.fp !== fpOf(raw.get(a)!)) continue
    const aLines = raw.get(a)!.split('\n')
    const existing = new Set([...raw.get(a)!.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]!.trim().toLowerCase()))
    for (const c of d.clauses) {
      const best = new Map<string, Ready>()
      for (const l of c.links) {
        const r = verify(a, aLines, c, l, raw, line)
        if (r === 'void') stats.voided++
        if (!r || r === 'void') {
          if (!r) stats.skipped++
          continue
        }
        if (rejected.has(undirected(a, r.b))) continue
        const anchor = r.level === 'heading' ? `#${r.heading}`.toLowerCase() : ''
        if (r.level !== 'block' && [...existing].some((e) => e.split('/').pop() === titleOf(r.b).toLowerCase() + anchor || e === titleOf(r.b).toLowerCase() + anchor)) continue
        const had = best.get(r.words)
        // 同一处几个去处：把握高的先；同样高时一节优先于整篇，整篇优先于一段（设计页 W.2）
        const rank = (x: Ready) => x.confidence * 10 + (x.level === 'heading' ? 0.3 : x.level === 'note' ? 0.2 : 0.1)
        if (!had || rank(r) > rank(had)) best.set(r.words, r)
      }
      // 一句里几处的字不能重叠
      const taken: Ready[] = []
      for (const r of [...best.values()].sort((p, q) => q.confidence - p.confidence)) if (!taken.some((t) => t.line === r.line && r.start < t.end && r.end > t.start)) taken.push(r)
      ready.push(...taken)
    }
  }

  // ⑤ 写进梦游分支：同一行的几处合成一条（分开收时同一行合不上）；一晚各最多 linkMax 条
  // 同一行里过线的和拿不准的分成两条（真库上一行四处、一处拿不准就整行进「拿不准」）；先写过线的那条，拿不准的那条叠在它后面
  const byLine = new Map<string, Ready[]>()
  for (const r of ready) {
    const k = `${r.a}\0${r.line}\0${r.sure}`
    ;(byLine.get(k) ?? byLine.set(k, []).get(k)!).push(r)
  }
  const groups = [...byLine.values()].map((rs) => ({ rs, sure: rs.every((r) => r.sure), conf: Math.min(...rs.map((r) => r.confidence)) }))
  groups.sort((p, q) => Number(q.sure) - Number(p.sure) || q.conf - p.conf || p.rs[0]!.a.localeCompare(q.rs[0]!.a) || p.rs[0]!.line - q.rs[0]!.line)
  const pairs = new Set<string>()
  const ids = new Map<string, string>()
  const all = [...raw.keys()]
  const counts = { link: 0, unsure: 0 }
  for (const g of groups) {
    const group = g.sure ? 'link' : 'unsure'
    if (counts[group] >= o.set.linkMax) continue
    try {
      const it = await writeLine(o, g.rs, ids, all)
      if (!it) continue
      o.add(group, it)
      counts[group]++
      for (const r of g.rs) pairs.add(undirected(r.a, r.b))
    } catch (e) {
      o.notes.push(`「${titleOf(g.rs[0]!.a)}」的 Wiki 链接没写成：${(e as Error).message}`)
    }
  }
  stats.link = counts.link
  stats.unsure = counts.unsure
  const leftLinks = groups.filter((g) => (g.sure ? 'link' : 'unsure') === 'link').length - counts.link
  if (leftLinks > 0) o.notes.push(`还有 ${leftLinks} 处 Wiki 链接判过能连，这次先列把握最高的，下次梦游接着列（不再花额度）`)

  // ⑥ 别名（D1）、词条页（C1）建议
  stats.aliases = await suggestAliases(o, ready.filter((r) => r.level === 'note' && r.sure))
  stats.entries = suggestEntries(o, ledger)
  await saveLedger(o.ledgerFile, ledger)
  return { stats, pairs }
}

/** 关键词那一路最前那段和这句共有三个以上两字片（中文）或两个以上英文词：值得问（不够的一句一个字面像的词，问了也是白问） */
function kwStrong(c: Clause, h: Hit, ol: (p: string) => ReturnType<typeof outline>): boolean {
  const p = ol(h.path).passages[h.i]
  if (!p) return false
  const a = bigramsOf(clausePlain(c.text))
  const b = bigramsOf(passagePlain(p.text))
  let n = 0
  for (const x of a) if (b.has(x)) n++
  if (n >= 3) return true
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []))
  const wb = words(passagePlain(p.text))
  return [...words(clausePlain(c.text))].filter((w) => wb.has(w)).length >= 2
}

/** 向量那一路给的是建索引时的一截（几段拼起来的）：挑出这截里和这句最像的那一段 */
function passageIn(o: ReturnType<typeof outline>, chunk: string, clause: string): number {
  const key = squash(chunk)
  const want = bigramsOf(clausePlain(clause))
  let best = -1
  let bestN = -1
  o.passages.forEach((p, i) => {
    const s = squash(passagePlain(p.text))
    if (s.length < 4 || !(key.includes(s.slice(0, Math.min(40, s.length))) || s.includes(key.slice(0, 40)))) return
    let n = 0
    for (const x of bigramsOf(passagePlain(p.text))) if (want.has(x)) n++
    if (n > bestN) {
      best = i
      bestN = n
    }
  })
  return best
}

/** 软件先猜的级别（W.1 ③）：名字命中 → 整篇；标题命中 → 这一节；前几段大多在同一节 → 这一节；没有小标题、段又少 → 整篇；其余 → 这一段 */
function guessLevel(c: ReturnType<typeof merge>[number], all: ReturnType<typeof merge>, o: ReturnType<typeof outline>): WikiLevel {
  if (c.i < 0 || c.via.has('名字')) return 'note'
  if (c.heading !== undefined || c.via.has('标题')) return 'heading'
  const p = o.passages[c.i]
  if (!sectionsOf(o).length) return o.passages.length <= 3 ? 'note' : 'block'
  if (p && headingOfPassage(o, p) && all.filter((x) => x.path === c.path && x.i >= 0 && o.passages[x.i]?.heading === p.heading).length >= 2) return 'heading'
  return 'block'
}

/** 把同一行的几处写进 A，链到一段的给 B 那段加块编号；一次提交。返回报告里那一条 */
async function writeLine(o: WikiOptions, rs: Ready[], ids: Map<string, string>, all: string[]): Promise<Omit<DreamItem, 'id' | 'group' | 'state'> | null> {
  const a = rs[0]!.a
  const aFile = join(o.wt, a)
  const { text: aText, meta } = decodeNote(await readFile(aFile))
  const lines = aText.split('\n')
  const ln = rs[0]!.line
  let l = lines[ln]
  if (l === undefined) return null
  const okB = new Set<string>()
  const changesB: { path: string; text: string }[] = []
  const blocks: { path: string; id: string; snippet: string }[] = []
  const links: NonNullable<DreamItem['wiki']>['links'] = []
  // 从右往左换，前面的位置不变
  for (const r of [...rs].sort((p, q) => q.start - p.start)) {
    if (l.slice(r.start, r.end) !== r.words) continue
    let anchor = ''
    if (r.level === 'heading') anchor = r.heading!
    else if (r.level === 'block') {
      const p = r.passage!
      const key = `${r.b}\0${p.line}`
      let id = p.id ?? ids.get(key)
      const bFile = join(o.wt, r.b)
      const { text: bText, meta: bMeta } = decodeNote(await readFile(bFile))
      const bLines = bText.split('\n')
      // 这一段现在在哪一行（同一篇前面的段加过块编号，行号不变：只加在行尾）
      if (!id) id = blockIdOf(bLines[p.end] ?? '') ?? undefined
      if (!id) {
        id = newBlockId(bText)
        const next = addBlockId(bText, p.end, id)
        if (!onlyBlockIdsAdded(bText, next)) throw new Error(`「${titleOf(r.b)}」加块编号时别的字也变了，没加`)
        await atomicWrite(bFile, encodeNote(next, bMeta))
        await git.git(o.wt, ['add', '--', r.b])
        okB.add(r.b)
        changesB.push({ path: r.b, text: `「${snippetOf(p.text)}」那一段行尾加了一个看不见的编号，链接靠它指着这段` })
      }
      ids.set(key, id)
      anchor = '^' + id
      blocks.push({ path: r.b, id, snippet: plainOf(p.text).slice(0, 40) })
    }
    const target = linkTarget(r.b, all)
    l = l.slice(0, r.start) + wikiLink(target, anchor, r.words) + l.slice(r.end)
    links.unshift({ words: r.words, path: r.b, level: r.level, anchor, confidence: Math.round(r.confidence * 100) / 100, why: r.why, quote: r.quoteA, quoteB: r.quoteB })
  }
  if (!links.length) return null
  lines[ln] = l
  await atomicWrite(aFile, encodeNote(lines.join('\n'), meta))
  await git.git(o.wt, ['add', '--', a])
  const commit = await o.commit(`梦游：「${titleOf(a)}」里${links.map((x) => `「${x.words}」`).join('')}链到${[...new Set(links.map((x) => `[[${titleOf(x.path)}]]`))].join('、')}`, okB)
  const first = rs.find((r) => r.words === links[0]!.words) ?? rs[0]!
  const conf = Math.min(...links.map((x) => x.confidence))
  const where = (x: (typeof links)[number]) => (x.level === 'note' ? '整篇' : x.level === 'heading' ? '一节' : '一段')
  const kinds = (['note', 'heading', 'block'] as const).map((lv) => [lv, links.filter((x) => x.level === lv).length] as const).filter(([, n]) => n)
  const one = links.length === 1 ? links[0]! : null
  return {
    title: titleOf(a),
    // 第二行只放得下一句：一处写去哪，几处只列那几个字
    sub: (one ? `「${one.words}」→ ${titleOf(one.path)}${one.level === 'heading' ? ` › ${one.anchor}` : ''} · ${where(one)}` : `链上 ${links.length} 处：${links.map((x) => x.words).join('、')}`) + (first.sure ? '' : ` · 把握 ${conf.toFixed(2)}`),
    why: one
      ? `${one.why.replace(/[。.！!；;，,\s]+$/u, '')}。原句里「${one.words}」变成链接，字不变`
      : `原句里 ${links.length} 处字变成链接，字不变：${kinds.map(([lv, n]) => `${n} 处指着${lv === 'note' ? '整篇' : lv === 'heading' ? '一节' : '一段'}`).join('，')}`,
    by: o.by,
    judged: { level: 'same-topic', confidence: conf, a: { path: a, quote: clausePlain(aText.split('\n')[ln]!.replace(/^\s*(?:>\s*)*(?:[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)?/, '')) }, b: { path: first.b, quote: first.quoteB } },
    commit,
    files: [a, ...okB],
    changes: [{ path: a, text: `${links.map((x) => `「${x.words}」`).join('')}变成链接（${[...new Set(links.map((x) => `链到${x.level === 'note' ? '整篇' : x.level === 'heading' ? '那一节' : '那一段'}`))].join('、')}）` }, ...changesB],
    wiki: { links, blocks },
  }
}

const snippetOf = (t: string) => {
  const s = plainOf(t)
  return s.length > 16 ? s.slice(0, 16) + '…' : s
}

/** D1：同一篇被两篇以上用同一个别的写法整篇链过去（这晚的加上库里已有的 [[B|写法]]），建议加成别名 */
async function suggestAliases(o: WikiOptions, notes: Ready[]): Promise<number> {
  const by = new Map<string, Map<string, Set<string>>>()
  const put = (b: string, w: string, a: string) => {
    const m = by.get(b) ?? by.set(b, new Map()).get(b)!
    ;(m.get(w) ?? m.set(w, new Set()).get(w)!).add(a)
  }
  for (const r of notes) put(r.b, r.words, r.a)
  if (!by.size) return 0
  for (const [p, t] of o.texts)
    for (const m of t.matchAll(/\[\[([^\]|#\n]+)\|([^\]\n]+)\]\]/g)) {
      const b = [...by.keys()].find((x) => titleOf(x).toLowerCase() === m[1]!.trim().toLowerCase() || x.replace(/\.md$/i, '').toLowerCase() === m[1]!.trim().toLowerCase())
      if (b) put(b, m[2]!.trim(), p)
    }
  let n = 0
  for (const [b, m] of by) {
    const bText = o.texts.get(b)!
    const have = [titleOf(b), ...aliasesIn(bText)].map(squash)
    const names = [...m].filter(([w, as]) => as.size >= 2 && !have.includes(squash(w)) && squash(w).length >= 2).map(([w]) => w)
    if (!names.length) continue
    const file = join(o.wt, b)
    const { text, meta } = decodeNote(await readFile(file))
    const key = ['aliases', 'alias', '别名'].find((k) => readPropList(text, k) !== null) ?? 'aliases'
    const next = setPropList(text, key, [...(readPropList(text, key) ?? []), ...names])
    if (!onlyAliasesChanged(text, next, key)) continue
    await atomicWrite(file, encodeNote(next, meta))
    await git.git(o.wt, ['add', '--', b])
    try {
      const commit = await o.commit(`梦游：「${titleOf(b)}」加别名 ${names.join('、')}`, new Set([b]))
      o.add('alias', {
        title: titleOf(b),
        sub: `加别名：${names.join('、')}`,
        why: `${names.map((w) => `「${w}」在 ${m.get(w)!.size} 篇里都指这一篇`).join('；')}。收下就在这篇的属性 ${key} 里加上，以后写这几个字也认成它；正文不动`,
        by: o.by,
        commit,
        files: [b],
        changes: [{ path: b, text: `属性 ${key} 加上 ${names.join('、')}` }],
        alias: { path: b, names },
      })
      n++
    } catch (e) {
      o.notes.push(`「${titleOf(b)}」的别名没加成：${(e as Error).message}`)
    }
  }
  return n
}

/** 只动了属性里的别名那一项（正文、别的属性一个字没变） */
export function onlyAliasesChanged(before: string, after: string, key: string): boolean {
  const FM = /^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
  const body = (t: string) => t.replace(FM, '')
  if (body(before) !== body(after)) return false
  const strip = (t: string) => setPropList(t, key, [])
  return strip(before) === strip(after)
}

/**
 * C1：库里 3 篇以上不同的笔记提到、又没有讲它的一篇的东西（AI 判句子时说的「这句提到的东西」、标签的最后一截、[[没建的]]），一晚最多 3 个。
 * 只是建议：报告里一条、相关栏顶上一张卡，点了才建。你说过不要的不再提
 */
function suggestEntries(o: WikiOptions, ledger: Ledger): number {
  const names = new Map<string, string>()
  /** 你自己标出来的（分了层的标签、好几篇都链着的 [[没建的]]）：提得再多也是一个东西，不按常用词卡 */
  const mine = new Set<string>()
  const add = (s: string, own = false) => {
    const w = s.trim().replace(/^#/, '')
    const han = (w.match(/\p{Script=Han}/gu) ?? []).length
    if (!(han >= 2 || (han === 0 && /^[A-Za-z][A-Za-z .'-]{3,}$/.test(w))) || w.length > 20 || /\d{2}/.test(w) || DATED.test(w)) return
    if (!names.has(w.toLowerCase())) names.set(w.toLowerCase(), w)
    if (own) mine.add(w.toLowerCase())
  }
  for (const d of Object.values(ledger.wiki)) for (const c of d.clauses) if (c.thing) add(c.thing)
  const titles = new Set<string>()
  for (const [p, t] of o.texts) {
    titles.add(titleOf(p).toLowerCase())
    for (const a of aliasesIn(t)) titles.add(a.toLowerCase())
  }
  // 标签只认分了层的最后一截（#地方/海德堡 → 海德堡；#休息、#instance 这种一层的多是常用词）；没建的 [[双链]] 要 3 篇以上都链着它
  const red = new Map<string, Set<string>>()
  for (const [p, t] of o.texts) {
    const body = t.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    for (const m of body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)+)/gu)) add(m[1]!.split('/').pop()!, true)
    for (const m of body.matchAll(/\[\[([^\]|#\n]+)/g)) {
      const n = m[1]!.trim().split('/').pop()!
      if (!titles.has(n.toLowerCase())) (red.get(n) ?? red.set(n, new Set()).get(n)!).add(p)
    }
  }
  // 链着它的篇太多（模板里的 [[链接]]）也是常用写法，按 AI 说的那种卡
  for (const [n, ps] of red) if (ps.size >= 3) add(n, ps.size <= Math.max(30, o.texts.size * 0.02))
  const no = new Set(ledger.entryNo)
  const out: { name: string; count: number; notes: string[] }[] = []
  for (const [low, name] of names) {
    if (titles.has(low) || no.has(low)) continue
    const notes: string[] = []
    for (const [p, t] of o.texts) if (p.toLowerCase().endsWith('.md') && t.toLowerCase().includes(low)) notes.push(p)
    // AI 说的「这句提到的东西」太多篇都有的是常用词（「静默」「休息」），不是一个东西：超过全库 2%（至少 30 篇）不算；你自己标的放宽到 5%
    if (notes.length >= 3 && notes.length <= Math.max(30, o.texts.size * (mine.has(low) ? 0.05 : 0.02))) out.push({ name, count: notes.length, notes })
  }
  // 一个名字是另一个的一截（「海德堡」「海德堡老城区」）：留提到的多的那个
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const picked: typeof out = []
  for (const e of out) {
    if (picked.length >= 3) break
    if (picked.some((p) => p.name.toLowerCase().includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(p.name.toLowerCase()))) continue
    picked.push(e)
  }
  const night = o.now.toISOString().slice(0, 10)
  ledger.entries = picked.map((e) => ({ ...e, notes: e.notes.slice(0, 40), night }))
  for (const e of picked)
    o.add('entry', {
      title: `「${e.name}」`,
      sub: `库里 ${e.count} 篇提到，还没有讲它的一篇`,
      why: `点「建词条页」才建：开头两三句导语（每句挂出处），下面嵌进讲它的那几段，原文改了这里跟着变。不建也没关系，提到它的那几篇不改`,
      by: o.by,
      commit: null,
      files: e.notes.slice(0, 8),
      entry: { name: e.name, count: e.count, notes: e.notes.slice(0, 40) },
    })
  return picked.length
}

/**
 * 收下一条以后：它链到的那几段在 B 里要有块编号。同一段被两条用到时只有先写的那条的提交里加了块编号，只收后一条时 B 里没有：
 * 照记下的那段开头几个字找到那一段补上（改的是刚收下的那次提交）。返回补了几处
 */
export async function ensureBlocks(root: string, it: DreamItem): Promise<number> {
  let n = 0
  const touched: string[] = []
  for (const b of it.wiki?.blocks ?? []) {
    const file = join(root, b.path)
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const { text, meta } = decodeNote(bytes)
    const o = outline(text)
    if (o.passages.some((p) => p.id === b.id)) continue
    const want = squash(b.snippet)
    const p = o.passages.find((x) => !x.id && want && squash(plainOf(x.text)).startsWith(want.slice(0, 30)))
    if (!p) continue
    await atomicWrite(file, encodeNote(addBlockId(text, p.end, b.id), meta))
    touched.push(b.path)
    n++
  }
  if (n) {
    await git.git(root, ['add', '--', ...touched])
    await git.git(root, ['commit', '-q', '--amend', '--no-edit'])
  }
  return n
}

/**
 * 一段太长、给 AI 看要截短时，截和这句最像的那一截（「海德堡注脚」那段引文前半是英文、后半是中文，只截开头 AI 就看不到中文那半）：
 * 找这句和这段共有的两字片最先出现的地方，前面留一点
 */
export function focusText(plain: string, clause: string, max = CLIP_P): string {
  if (plain.length <= max) return plain
  const want = bigramsOf(clause)
  let at = -1
  for (let i = 0; i + 2 <= plain.length; i++) if (want.has(plain.slice(i, i + 2))) {
    at = i
    break
  }
  if (at < max * 0.6) return plain
  const from = Math.max(0, at - 40)
  return '…' + plain.slice(from)
}
