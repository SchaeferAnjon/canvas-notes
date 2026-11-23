/**
 * 梦游补双链的新底层（task-h7oy8，设计页 24-梦游底层「2. 新方案」）：
 * ① 找候选：本机关键词（词向量 TF-IDF）、本机向量（搜索索引里每篇切段的向量，有就用）、标题（别的篇的名字出现在这篇正文里）三路，按名次合并（RRF）取前 5；
 *    已经链着的、两步以内连得上的、你丢掉过的、「未命名」和空白的不当候选；
 * ② 判断：一篇一问交给 AI（设置 › 梦游「AI 判断」：走订阅的命令行或本地模型），同一问里带上这篇末尾已有的「相关：」那几篇做复查；
 * ③ 证据：两边原话软件逐字核对，对不上整对作废；④ 把握：AI 给 0 到 1；
 * ⑤ 过线才提：≥ 0.75 补双链（同一内容的进可能重复），0.5 到 0.75 进「拿不准，你来定」，旧「相关：」判成不相关的列成「建议去掉」。
 * 判过的按两篇正文的指纹记在进度里（dream-ledger.ts）：没改过的不再问；一晚问到上限就停，剩下的下一晚接着。不碰 Electron。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeNote, encodeNote } from '@cn/format'
import * as git from '@cn/git'
import type { DreamGroup, DreamItem, DreamJudgeStats } from '../shared/api'
import type { DreamSettings } from '../shared/dream-settings'
import { titleOf } from '../shared/layout'
import { type Cand, DEFAULT_LINE, type JudgeLine, judgePrompt, JUDGE_SYSTEM, type Judgement, LEVEL_NAME, parseJudge, type Verdict, verdictOf } from './dream-judge'
import { countAsk, doneKey, type Ledger, leftTonight, loadLedger, noteFp, pairKey, saveLedger, undirected } from './dream-ledger'
import { isAutoSummary, type LinkCand, linkRanked } from './duplicates'

export type JudgeAsk = (system: string, prompt: string, signal?: AbortSignal) => Promise<string>

/** 向量那一路：每篇最像的几篇（两篇最像的那一对段落的余弦）和那一对段落；索引没建好时 null */
export type Related = (paths: string[], k: number) => Promise<{ model: string; map: Map<string, { path: string; score: number; mine: string; theirs: string }[]> } | null>

/** 被睡眠、退出打断：判到一半停下，判完的都记在进度里，下次闲时接着 */
export class DreamInterrupted extends Error {
  constructor() {
    super('梦游被打断了，下次闲时接着判')
    this.name = 'DreamInterrupted'
  }
}

export interface JudgeLinksOptions {
  wt: string
  texts: Map<string, string>
  /** 在这几篇末尾补双链（设置里勾上的文件夹里的笔记） */
  loose: string[]
  set: DreamSettings
  ask: JudgeAsk
  /** 谁判的（「Claude Code · Haiku」） */
  by: string
  ranked?: (texts: [string, string][], loose: string[], k: number) => Promise<LinkCand[]>
  related?: Related
  ledgerFile?: string
  now: Date
  /** 同时问几篇（命令行 4，本地模型 1） */
  parallel: number
  /** 这一路判断的线：自动连的把握线、能不能自动连（本机模型不能） */
  line?: JudgeLine
  signal?: AbortSignal
  commit(message: string): Promise<string>
  add(group: DreamGroup, it: Omit<DreamItem, 'id' | 'group' | 'state'>): DreamItem
  notes: string[]
}

/**
 * AI 的理由里用的是问它时的代号（「B5 是 A 的专门回顾」）：换成人看得懂的「这篇」和那篇的名字。
 * 理由一对一条，里面的 B几 说的就是这一篇
 */
export const humanWhy = (why: string, b: string) =>
  why
    .replace(/ ?(?<![A-Za-z0-9])B\d{1,2}(?![A-Za-z0-9]) ?/g, `「${titleOf(b)}」`)
    .replace(/ ?(?<![A-Za-z0-9])A(?![A-Za-z0-9+#]) ?/g, '这篇')
    .trim()

/** AI 的理由接着软件的话写：去掉它句末的句号，免得「。。」 */
const sentence = (why: string) => why.trim().replace(/[。.！!；;，,\s]+$/u, '')

/** 每篇最多几个新候选 */
const K = 5
/** 向量那一路最多等多久（CN_DREAM_RELATED_MS 能调） */
const RELATED_WAIT_MS = Number(process.env.CN_DREAM_RELATED_MS) || 90_000
/** 按名次合并的常数（RRF 的 k，惯用 60） */
const RRF = 60

const PLACEHOLDER = /^(未命名|untitled)(\s*\d+)?$/i
const ownBody = (t: string) => t.replace(/^﻿?---\n[\s\S]*?\n---\n?/, '').replace(/^\s*相关[：:].*$/gm, '')
/** 能当双链的两头：不是软件汇总的、不是临时名、正文至少 20 个字 */
const usable = (p: string, t: string | undefined) => t !== undefined && !isAutoSummary(t) && !PLACEHOLDER.test(titleOf(p)) && ownBody(t).replace(/\s+/g, '').length >= 20

/** 一篇末尾「相关：[[a]]、[[b]]」行里的名字（复查用） */
export function relatedLines(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^\s*相关[：:](.*)$/gm)) for (const l of m[1]!.matchAll(LINK)) out.push(l[1]!.trim())
  return out
}

const LINK = /\[\[([^\]|#\n]+)(?:[#|][^\]]*)?\]\]/g

/** 去掉「相关：」行里的 [[name]]；那一行只剩它时整行去掉（连同它前面梦游加的那个空行） */
export function dropRelated(text: string, name: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = /^(\s*相关[：:])(.*)$/.exec(line)
    const links = m ? [...m[2]!.matchAll(LINK)] : []
    const hit = links.find((l) => l[1]!.trim() === name)
    if (!m || !hit) {
      out.push(line)
      continue
    }
    const rest = links.filter((l) => l !== hit).map((l) => l[0])
    if (rest.length) out.push(m[1]! + rest.join('、'))
    else if (out.length && out[out.length - 1]!.trim() === '') out.pop()
  }
  return out.join('\n')
}

/** 比较一行时不算的：行尾的块编号（滴答同步的 ^dida-…）、多余的空白 */
const lineKey = (l: string) => l.replace(/\s\^[\w-]+\s*$/, '').replace(/\s+/g, ' ').trim()
const TASK = /^\s*[-*+] \[[ xX]\]/

/**
 * 去掉好几篇都抄着的行（task-h7oy8，真库上日记篇篇连隔壁那天，理由是每篇都抄一遍的逾期任务清单）：
 * 一行（6 个字以上）出现在 3 篇以上算抄来的；任务行（- [ ] …）2 篇以上就算。「相关：」行留着（复查要用）
 */
export function stripShared(texts: Map<string, string>): Map<string, string> {
  // 开头的属性块原样留着、不算：好几篇都写「source: weread」时去掉那一行，剩下「---\n---」认不成属性块，「---」被当正文（判断的原话取到它，核对不过）
  const split = (t: string) => {
    const head = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(t)?.[0] ?? ''
    return [head, t.slice(head.length)] as const
  }
  const count = new Map<string, number>()
  for (const t of texts.values()) {
    const seen = new Set<string>()
    for (const l of split(t)[1].split('\n')) {
      const k = lineKey(l)
      if (k.length < 6 || seen.has(k)) continue
      seen.add(k)
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  const out = new Map<string, string>()
  for (const [p, t] of texts) {
    const [head, body] = split(t)
    const keep = body.split('\n').filter((l) => {
      if (/^\s*相关[：:]/.test(l)) return true
      const c = count.get(lineKey(l)) ?? 0
      return !(c >= 3 || (c >= 2 && TASK.test(l)))
    })
    out.set(p, head + keep.join('\n'))
  }
  return out
}

/** 名字 → 路径（同名的不认）；双链图（无向）：两步以内连得上的不再提 */
function linkGraph(texts: Map<string, string>) {
  const byName = new Map<string, string | null>()
  for (const p of texts.keys()) {
    const n = titleOf(p).toLowerCase()
    byName.set(n, byName.has(n) ? null : p)
  }
  const resolve = (name: string) => byName.get(name.trim().toLowerCase()) ?? null
  const adj = new Map<string, Set<string>>()
  const edge = (a: string, b: string) => {
    if (a === b) return
    ;(adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
    ;(adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a)
  }
  for (const [p, t] of texts) for (const m of t.matchAll(/\[\[([^\]|#\n]+)/g)) {
    const q = resolve(m[1]!)
    if (q) edge(p, q)
  }
  const near = (a: string, b: string) => {
    const na = adj.get(a)
    if (!na) return false
    if (na.has(b)) return true
    const nb = adj.get(b)
    if (!nb) return false
    for (const x of na) if (nb.has(x)) return true
    return false
  }
  return { resolve, near }
}

/** 标题那一路：别的篇的名字原样出现在这篇正文里（中文至少 3 个字、英文至少 6 个字母，太常见的词当不了名字） */
function titleHits(texts: Map<string, string>, loose: string[]): Map<string, string[]> {
  const names: [string, string][] = []
  for (const [p, t] of texts) {
    const n = titleOf(p)
    if (!usable(p, t)) continue
    const han = (n.match(/\p{Script=Han}/gu) ?? []).length
    if (han >= 3 || (han === 0 && n.replace(/[^a-z]/gi, '').length >= 6)) names.push([n.toLowerCase(), p])
  }
  const out = new Map<string, string[]>()
  for (const p of loose) {
    const body = ownBody(texts.get(p)!).toLowerCase()
    const hits = names.filter(([n, q]) => q !== p && body.includes(n)).map(([, q]) => q)
    if (hits.length) out.set(p, hits.slice(0, K * 2))
  }
  return out
}

/** 跑一组并发（最多 n 个同时），每个跑完就收；signal 停了不再开新的 */
async function pool<T>(items: T[], n: number, signal: AbortSignal | undefined, run: (x: T) => Promise<void>) {
  let i = 0
  const lane = async () => {
    while (i < items.length && !signal?.aborted) await run(items[i++]!)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, lane))
}

/** 补双链、拿不准、复查、AI 认出的重复，一晚的全部；返回这晚的账 */
export async function judgeLinks(o: JudgeLinksOptions): Promise<{ stats: DreamJudgeStats; dups: DreamItem[] }> {
  const started = Date.now()
  const { set } = o
  // 找候选、问 AI、核对原话都用去掉了「好几篇都抄着的行」的正文（日记里每天抄一遍的逾期任务清单、同步块、模板标题）；
  // 指纹、双链图、末尾的「相关：」照原文
  const raw = o.texts
  const texts = stripShared(raw)
  const ledger: Ledger = await loadLedger(o.ledgerFile)
  const fps = new Map<string, string>()
  const fp = (p: string) => fps.get(p) ?? (fps.set(p, noteFp(raw.get(p) ?? '')), fps.get(p)!)
  const rejected = new Set(ledger.rejected)
  const kept = new Set(ledger.kept)
  const graph = linkGraph(raw)
  const loose = o.loose.filter((p) => usable(p, texts.get(p)))

  // ① 找候选：三路各排一遍，按名次合并
  const all = [...texts]
  const kw = o.ranked ? await o.ranked(all, loose, K + 3) : linkRanked(all, loose, K + 3)
  // 向量那一路等不了太久：搜索进程正在建索引时查询排在后面，这晚就只用关键词和标题（下一晚再用上）
  let waited: NodeJS.Timeout | undefined
  const vec = o.related
    ? await Promise.race([
        o.related(loose, K + 3).catch((e) => (o.notes.push(`向量那一路没用上：${(e as Error).message}`), null)),
        new Promise<null>((r) => (waited = setTimeout(() => (o.notes.push('搜索索引还在建，这次找候选没用上向量那一路'), r(null)), RELATED_WAIT_MS))),
      ]).finally(() => clearTimeout(waited))
    : null
  const titles = titleHits(texts, loose)
  const sources = ['关键词', ...(vec ? [`向量（${vec.model}）`] : []), '标题']
  const rank = new Map<string, Map<string, { s: number; passage?: string }>>()
  const put = (p: string, q: string, r: number, passage?: string) => {
    const m = rank.get(p) ?? rank.set(p, new Map()).get(p)!
    const old = m.get(q)
    m.set(q, { s: (old?.s ?? 0) + 1 / (RRF + r), passage: old?.passage ?? passage })
  }
  const kwBy = new Map<string, LinkCand[]>()
  for (const c of kw) (kwBy.get(c.p) ?? kwBy.set(c.p, []).get(c.p)!).push(c)
  for (const [p, list] of kwBy) list.forEach((c, r) => put(p, c.to, r))
  if (vec) for (const [p, list] of vec.map) list.forEach((c, r) => put(p, c.path, r, c.theirs))
  for (const [p, list] of titles) list.forEach((q, r) => put(p, q, r))

  const candsOf = new Map<string, Cand[]>()
  for (const p of loose) {
    const out: Cand[] = []
    const fresh = [...(rank.get(p) ?? [])].sort((a, b) => b[1].s - a[1].s || a[0].localeCompare(b[0]))
    for (const [q, r] of fresh) {
      if (out.length >= K) break
      if (q === p || !usable(q, texts.get(q)) || graph.near(p, q) || rejected.has(undirected(p, q))) continue
      out.push({ path: q, text: texts.get(q)!, ...(r.passage ? { passage: r.passage } : {}) })
    }
    // 复查：这篇末尾已有的「相关：」（你点过留着的不再查）
    for (const name of new Set(relatedLines(raw.get(p)!))) {
      const q = graph.resolve(name)
      if (!q || q === p || kept.has(`${p}\0${name}`) || out.some((c) => c.path === q)) continue
      out.push({ path: q, text: texts.get(q)!, existing: true })
    }
    if (out.length) candsOf.set(p, out)
  }

  // ② 判断：已经判过（两篇都没改）的用以前的结果；要问的按每晚上限问
  const cachedOf = (p: string, c: Cand) => ledger.pairs[pairKey(p, fp(p), c.path, fp(c.path))]
  const queue: string[] = []
  let cached = 0
  for (const [p, cands] of candsOf) {
    if (cands.some((c) => !cachedOf(p, c))) queue.push(p)
    else cached++
  }
  // 新来的（从没判过的）先判，再是改过的；同一类按路径
  queue.sort((a, b) => Number(a in ledger.done) - Number(b in ledger.done) || a.localeCompare(b))
  const room = leftTonight(ledger, o.now, set.nightCap)
  const today = queue.slice(0, room)
  let asked = 0
  let failed = 0
  let saving = Promise.resolve()
  await pool(today, o.parallel, o.signal, async (p) => {
    const need = candsOf.get(p)!.filter((c) => !cachedOf(p, c))
    const { prompt, ids } = judgePrompt({ path: p, text: texts.get(p)! }, need)
    let got: Judgement[]
    try {
      asked++
      countAsk(ledger, o.now)
      got = parseJudge(await o.ask(JUDGE_SYSTEM, prompt, o.signal), p, ids)
    } catch (e) {
      if (o.signal?.aborted) return
      failed++
      if (failed <= 3) o.notes.push(`「${titleOf(p)}」没判成：${(e as Error).message}`)
      return
    }
    const at = Date.now()
    for (const j of got) ledger.pairs[pairKey(p, fp(p), j.b, fp(j.b))] = { ...j, at }
    if (got.length === ids.length) ledger.done[p] = doneKey(fp(p))
    // 判完一篇写一次盘（排队写，不并发写同一个文件）：打断了下次从这里接着
    saving = saving.then(() => saveLedger(o.ledgerFile, ledger))
    await saving
  })
  await saving
  if (o.signal?.aborted) throw new DreamInterrupted()
  // 还要判的：这晚没轮到的，加上判了没判成的（下一晚接着）
  const left = queue.filter((p) => candsOf.get(p)!.some((c) => !cachedOf(p, c))).length

  // ③④⑤ 证据、把握、过线：判过的每一对（这晚新判的和以前判过的）
  type Row = { p: string; c: Cand; j: Judgement; v: Verdict }
  const rows: Row[] = []
  let voided = 0
  let skipped = 0
  let skipExample: DreamJudgeStats['skipExample']
  for (const [p, cands] of candsOf)
    for (const c of cands) {
      const j = cachedOf(p, c)
      if (!j) continue
      const v = verdictOf(j, texts.get(p)!, c.text, c.existing, o.line ?? DEFAULT_LINE)
      if (v === 'void') voided++
      else if (v === 'skip' && !c.existing) {
        skipped++
        if (!skipExample || (j.level === 'tangential' && skipExample.why.startsWith('无关'))) skipExample = { a: titleOf(p), b: titleOf(c.path), why: `${LEVEL_NAME[j.level]}：${humanWhy(j.why, c.path)}` }
      }
      if (v !== 'void' && v !== 'skip') rows.push({ p, c, j, v })
    }

  const judged = (r: Row): DreamItem['judged'] => ({ level: r.j.level, confidence: Math.round(r.j.confidence * 100) / 100, a: { path: r.p, quote: r.j.quoteA }, b: { path: r.c.path, quote: r.j.quoteB } })
  const append = async (p: string, line: string) => {
    const { text, meta } = decodeNote(await readFile(join(o.wt, p)))
    const next = text.endsWith('\n') ? `${text}\n${line}\n` : `${text}\n\n${line}`
    await writeFile(join(o.wt, p), encodeNote(next, meta))
    await git.git(o.wt, ['add', '--', p])
  }
  const byConf = (a: Row, b: Row) => b.j.confidence - a.j.confidence || a.p.localeCompare(b.p)
  const pairsSeen = new Set<string>()
  const once = (r: Row) => {
    const k = undirected(r.p, r.c.path)
    if (pairsSeen.has(k)) return false
    pairsSeen.add(k)
    return true
  }

  // 补双链和拿不准：两篇互相只提一次；一晚各最多 linkMax 处，剩下的判过了，下一晚不花额度直接列
  for (const [v, group] of [
    ['link', 'link'],
    ['unsure', 'unsure'],
  ] as const) {
    const list = rows.filter((r) => r.v === v).sort(byConf).filter(once)
    let n = 0
    for (const r of list) {
      if (n >= set.linkMax) break
      const target = titleOf(r.c.path)
      await append(r.p, `相关：[[${target}]]`)
      const commit = await o.commit(`梦游：「${titleOf(r.p)}」补上 [[${target}]]${v === 'unsure' ? '（拿不准）' : ''}`)
      n++
      o.add(group, {
        title: titleOf(r.p),
        sub: v === 'unsure' ? `↔ [[${target}]] · 把握 ${r.j.confidence.toFixed(2)}` : `↔ [[${target}]]`,
        why: v === 'unsure' ? humanWhy(r.j.why, r.c.path) || 'AI 拿不准' : `${sentence(humanWhy(r.j.why, r.c.path))}。只在这篇末尾加一行，「${target}」那篇不改`,
        by: o.by,
        judged: judged(r),
        commit,
        files: [r.p],
        changes: [{ path: r.p, text: `末尾加了一行 相关：[[${target}]]` }],
      })
    }
    if (list.length > n) o.notes.push(v === 'link' ? `还有 ${list.length - n} 处判过能补双链，这次先列把握最高的 ${n} 处，下次梦游接着列（不再花额度）` : `还有 ${list.length - n} 条拿不准的，下次梦游接着列`)
  }

  // 复查旧「相关：」：判成不相关的，列成「建议去掉」，你点了收下才删
  for (const r of rows.filter((x) => x.v === 'remove').sort(byConf)) {
    const name = relatedLines(raw.get(r.p)!).find((n) => graph.resolve(n) === r.c.path)!
    const { text, meta } = decodeNote(await readFile(join(o.wt, r.p)))
    const next = dropRelated(text, name)
    if (next === text) continue
    await writeFile(join(o.wt, r.p), encodeNote(next, meta))
    await git.git(o.wt, ['add', '--', r.p])
    const commit = await o.commit(`梦游：「${titleOf(r.p)}」去掉 相关：[[${name}]]`)
    o.add('recheck', {
      title: titleOf(r.p),
      sub: `相关：[[${name}]] · ${LEVEL_NAME[r.j.level]}`,
      why: `${sentence(humanWhy(r.j.why, r.c.path))}。收下就去掉这篇末尾的「[[${name}]]」，「${name}」那篇不改`,
      by: o.by,
      judged: judged(r),
      commit,
      files: [r.p],
      changes: [{ path: r.p, text: `去掉了 相关：[[${name}]]` }],
    })
  }

  // AI 认出的同一内容（换了语言、换了说法）：交给「可能重复」那一步，和本机比出来的合在一起列（字面重复的那对以本机的为准）
  const dups: DreamItem[] = []
  for (const r of rows.filter((x) => x.v === 'dup').sort(byConf).filter(once))
    dups.push({
      id: '',
      group: 'dup',
      state: 'pending',
      title: `${titleOf(r.p)} + ${titleOf(r.c.path)}`,
      sub: `${LEVEL_NAME[r.j.level]} · 把握 ${r.j.confidence.toFixed(2)}`,
      why: `${sentence(humanWhy(r.j.why, r.c.path))}。不删也不改任何一篇，你来决定留哪篇`,
      by: o.by,
      judged: judged(r),
      commit: null,
      files: [r.p, r.c.path],
    })

  const stats: DreamJudgeStats = {
    by: o.by,
    sources,
    asked,
    notes: asked - failed,
    cached,
    left,
    cap: set.nightCap,
    capped: queue.length > room,
    skipped,
    ...(skipExample ? { skipExample } : {}),
    voided,
    failed,
    ms: Date.now() - started,
  }
  return { stats, dups }
}

/**
 * 你在报告里点了：丢掉补双链、拿不准点「不要」→ 这一对以后不再提；复查那条点了「留着」（丢掉）→ 以后不再复查这一行。
 * 撤回丢掉（undo）把它从名单里拿掉
 */
export async function rememberChoice(ledgerFile: string, it: DreamItem, choice: 'drop' | 'undo'): Promise<void> {
  if (!it.judged || !(it.group === 'link' || it.group === 'unsure' || it.group === 'recheck')) return
  const l = await loadLedger(ledgerFile)
  const { a, b } = it.judged
  const list = it.group === 'recheck' ? l.kept : l.rejected
  const k = it.group === 'recheck' ? `${a.path}\0${titleOf(b.path)}` : undirected(a.path, b.path)
  const at = list.indexOf(k)
  if (choice === 'drop' && at < 0) list.push(k)
  else if (choice === 'undo' && at >= 0) list.splice(at, 1)
  else return
  await saveLedger(ledgerFile, l)
}
