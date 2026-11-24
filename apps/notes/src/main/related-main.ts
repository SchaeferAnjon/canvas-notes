/**
 * 右栏「相关」的主进程这一半（task-h7oy8，设计页 44-相关栏和生长图「相关栏」，全按推荐）：
 * - 三组：提到这篇的（全库反向链接，related.ts 的 LinkIndex，带那一句）、梦游连上的（梦游收下的补双链 + 末尾「相关：」行，带理由）、
 *   像但还没连的（梦游判过、过了线还没写进去的那一对，读梦游的判断进度 dream-ledger；没判过的只用本机向量列前几篇，标「还没判」，白天不临时问 AI）；
 * - 「连上」「不相关」「撤掉」，三样都能撤销：改了文件的一次提交，撤销是文件回到改之前一个字节不差、再一次提交；
 *   「不相关」「撤掉」记进梦游的「不再提」（以后梦游不再连这一对）和本机评测集；
 * - 梦游给这篇连了新的、还没在相关栏里看过：右图标栏那格右上一个小点。
 * 记录存在软件设置目录 related/<库的指纹>.json（不进库、不进 Git）。
 */
import * as git from '@cn/git'
import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { atomicWrite } from '@cn/atomic'
import { dirname, join } from 'node:path'
import type { Backlink, DreamItem, DreamReport, RelatedItem, RelatedResult, RelatedUndo } from '../shared/api'
import { LINK_ASK } from '../shared/dream-judge'
import type { DreamSettings } from '../shared/dream-settings'
import { titleOf } from '../shared/layout'
import { commitErrorText } from '../shared/git-errors'
import { dreamFiles } from './dream-main'
import { loadLedger, saveLedger, undirected } from './dream-ledger'
import { humanWhy } from './dream-links'
import { aliasesOf, blockLabel, blockLine, HUB_LINKS, headingLine, keysOf, linked, LinkIndex, type LinkRef, linkIn, linkTarget, quoteOf, refKind, seqDir, unlinkIn, whereOf, wordsOf } from './related'
import { searchRelated, searchStatus } from './search'
import { judgeRunner } from './dream-judge-run'
import { planEntry } from './wiki-entry-main'
import type { Vault } from './vault'

/** 库里不到这么多篇时「像但还没连的」先不猜（设计页 4） */
export const LIKE_MIN_NOTES = 20
/** 没判过、只按本机向量列的最多几篇 */
const UNJUDGED_MAX = 3

interface DreamRec {
  /** 链接写在哪一篇 */
  from: string
  /** 指着哪一篇 */
  to: string
  why: string
  /** 哪一晚（报告开始的那天，YYYY-MM-DD） */
  night: string
  /** 两边原话（AI 判时核对过的） */
  qFrom?: string
  qTo?: string
  /** 报告里那一条的 id（记过的不再记） */
  item: string
  /** Wiki 链接：变成链接的那几个字（那一句里打底色） */
  words?: string
  /** 记进来的时候：比这篇上次在相关栏里看过的晚，图标上出小点 */
  at: number
}

interface Store {
  version: 1
  /** 第一次建这个文件的时候：那以前收下的不算「新的」 */
  since: number
  dream: DreamRec[]
  /** 在相关栏里自己点「连上」的那一对（末尾「相关：」行里的不当成梦游连的） */
  mine: string[]
  /** 点了「不相关」的那一对（无序），以后不再列成像的 */
  unrelated: string[]
  /** 这篇上次在相关栏里看过的时候 */
  seen: Record<string, number>
}

const vaultKey = (root: string) => createHash('sha1').update(root).digest('hex').slice(0, 16)
const storeFile = (root: string) => join(app.getPath('userData'), 'related', vaultKey(root) + '.json')

/** fresh：这次才建的（那以前报告里收下的不算新的，不出小点） */
async function loadStore(root: string): Promise<Store & { fresh?: true }> {
  try {
    const s = JSON.parse(await readFile(storeFile(root), 'utf8')) as Partial<Store>
    if (s.version === 1) return { version: 1, since: s.since ?? Date.now(), dream: s.dream ?? [], mine: s.mine ?? [], unrelated: s.unrelated ?? [], seen: s.seen ?? {} }
  } catch (e) {
    // 没有是第一次；手改坏了从头记（只丢了小点和「不相关」，梦游那边的「不再提」还在）
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
  }
  return { version: 1, since: Date.now(), dream: [], mine: [], unrelated: [], seen: {}, fresh: true }
}

async function saveStore(root: string, s: Store & { fresh?: true }) {
  const f = storeFile(root)
  await mkdir(dirname(f), { recursive: true })
  const { fresh: _f, ...keep } = s
  delete s.fresh
  await atomicWrite(f, JSON.stringify(keep))
}

async function loadReport(root: string): Promise<DreamReport | null> {
  try {
    return JSON.parse(await readFile(dreamFiles(root).report, 'utf8')) as DreamReport
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
    throw e
  }
}

const day = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 报告里收下了的补双链记进来（报告每晚换一份，记下来以后哪晚连的、为什么都还在）；要存盘时返回 true */
function syncReport(s: Store & { fresh?: true }, r: DreamReport | null, resolve: (name: string) => string | null): boolean {
  if (!r) return !!s.fresh
  const had = new Set(s.dream.map((d) => d.item))
  let changed = false
  for (const it of r.items) {
    if (it.group !== 'link' && it.group !== 'unsure') continue
    if (it.state !== 'taken' || had.has(it.id)) continue
    // Wiki 化的一条（同一行几处）可能链到几篇：每篇记一条
    const recs = it.wiki ? wikiRecs(it, r) : [recOf(it, r, resolve)].filter((x): x is DreamRec => !!x)
    for (const rec of recs) {
      // 第一次建记录时报告里已经收下的不算新的（不出小点）
      rec.at = s.fresh ? s.since : Date.now()
      s.dream.push(rec)
      changed = true
    }
  }
  return changed || !!s.fresh
}

function recOf(it: DreamItem, r: DreamReport, resolve: (name: string) => string | null): DreamRec | null {
  const from = it.judged?.a.path ?? it.files[0]
  const to = it.judged?.b.path ?? resolve(/\[\[([^\]|#]+)/.exec(it.sub)?.[1] ?? '')
  if (!from || !to) return null
  // 报告里的理由后半句是给收下前看的（「只在这篇末尾加一行…」），相关栏只要前半句
  const why = it.why.replace(/。(只在这篇末尾加一行|原句里|正文里没有|收下).*$/, '')
  return { from, to, why, night: day(r.started), qFrom: it.judged?.a.quote, qTo: it.judged?.b.quote, item: it.id, at: 0 }
}

function wikiRecs(it: DreamItem, r: DreamReport): DreamRec[] {
  const from = it.files[0]
  if (!from || !it.wiki) return []
  const out: DreamRec[] = []
  for (const l of it.wiki.links) {
    if (out.some((x) => x.to === l.path)) continue
    out.push({ from, to: l.path, why: l.why, night: day(r.started), qFrom: l.quote ?? it.judged?.a.quote, ...(l.quoteB ? { qTo: l.quoteB } : {}), words: l.words, item: it.id, at: 0 })
  }
  return out
}

/** 这篇里哪一行有这句话（AI 摘的原话、向量那一路最像的那一段）；找不到 undefined */
function lineOf(text: string, near: string | undefined): number | undefined {
  const key = near?.replace(/\s+/g, '').slice(0, 20)
  if (!key) return undefined
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.replace(/\s+/g, '').includes(key))
  return i >= 0 ? i : undefined
}

/** 一篇的开头一句（梦游连上的没有原话时用） */
function opening(text: string): string {
  const body = text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  for (const l of body.split('\n')) {
    const t = l.replace(/^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?/, '').trim()
    if (!t || /^#{1,6}\s/.test(t) || /^(```|~~~|\||!\[|<)/.test(t) || /^相关[：:]/.test(t)) continue
    return t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, a, b) => b || a).replace(/\*\*|__|==|`/g, '').slice(0, 140)
  }
  return ''
}

/** 提到这篇的先后（右栏、文末一样）：正文里写了一句的在前，同样的新改的在前 */
export const byQuoteThenNew = (a: { quote?: unknown; m: number }, b: { quote?: unknown; m: number }) => Number(!!b.quote) - Number(!!a.quote) || b.m - a.m

export interface RelatedDeps {
  vault(): Vault
  settings(): DreamSettings
  /** 写了一篇：开着它的编辑器按外部改动合并 */
  noteChanged(path: string, text: string): void
  filesChanged(): void
}

export function registerRelated(o: RelatedDeps) {
  let ix = new LinkIndex()
  let ixRoot = ''
  const vec = new Map<string, { at: number; key: string; hits: { path: string; score: number; mine: string; theirs: string }[] }>()

  let building: Promise<unknown> | null = null
  /** 反查索引跟上库里现在的字（只重读变了的篇）；同时来的几次排成一次 */
  async function index(v: Vault) {
    if (ixRoot !== v.root) {
      ix = new LinkIndex()
      ixRoot = v.root
      vec.clear()
    }
    while (building) await building
    const run = (async () => {
      const texts = await v.texts()
      await ix.syncSoon(texts)
      return texts
    })()
    building = run.finally(() => (building = null))
    return run
  }

  const resolver = (texts: ReadonlyMap<string, string>) => {
    const byName = new Map<string, string | null>()
    for (const p of texts.keys()) {
      const n = titleOf(p).toLowerCase()
      byName.set(n, byName.has(n) ? null : p)
    }
    return (name: string) => (name ? (byName.get(name.trim().toLowerCase()) ?? null) : null)
  }

  /** 本机向量：这篇最像的几篇（按这篇的字记着，没改不重算） */
  async function similar(path: string, text: string): Promise<{ path: string; score: number; mine: string; theirs: string }[] | null> {
    const key = `${text.length}:${createHash('sha1').update(text).digest('hex').slice(0, 12)}`
    const hit = vec.get(path)
    if (hit && hit.key === key && Date.now() - hit.at < 10 * 60_000) return hit.hits
    const r = await searchRelated([path], 12)
    if (!r) return null
    const hits = r.get(path) ?? []
    vec.set(path, { at: Date.now(), key, hits })
    if (vec.size > 200) vec.delete(vec.keys().next().value!)
    return hits
  }

  async function build(path: string): Promise<RelatedResult> {
    const t0 = performance.now()
    const v = o.vault()
    const texts = await index(v)
    const text = texts.get(path) ?? ''
    const aliases = aliasesOf(text)
    const store = await loadStore(v.root)
    const resolve = resolver(texts)
    const report = await loadReport(v.root)
    if (syncReport(store, report, resolve)) await saveStore(v.root, store)
    const ledger = await loadLedger(dreamFiles(v.root).ledger)
    const rejected = new Set([...ledger.rejected, ...store.unrelated])
    const mine = new Set(store.mine)
    const aliasCache = new Map<string, string[]>()
    const aliasOf = (p: string) => aliasCache.get(p) ?? aliasCache.set(p, aliasesOf(texts.get(p) ?? '')).get(p)!
    const set = o.settings()

    // 这篇的标题、块指着哪一行、写什么
    const toOf = (r: LinkRef): { to?: RelatedItem['to']; here?: number } => {
      if (!r.anchor) return {}
      if (r.anchor.startsWith('^')) {
        const at = blockLine(text, r.anchor.slice(1))
        return at < 0 ? {} : { to: { kind: 'block', label: blockLabel(text, at) }, here: at }
      }
      const at = headingLine(text, r.anchor)
      return { to: { kind: 'heading', label: r.anchor.split('#').pop()!.trim() }, ...(at >= 0 ? { here: at } : {}) }
    }

    // ---- 梦游连上的：记下的梦游补双链（链接还在的），加上末尾「相关：」行里的 ----
    const dream = new Map<string, RelatedItem>()
    const recFor = (a: string, b: string) => store.dream.find((d) => (d.from === a && d.to === b) || (d.from === b && d.to === a))
    /** 梦游那一处链接：末尾「相关：」行里的优先，不然是第一处 */
    const refBetween = (from: string, to: string) => {
      const keys = keysOf(to, aliasOf(to))
      const all = ix.refsIn(from).filter((r) => keys.includes(r.key))
      const ft = texts.get(from) ?? ''
      return all.find((r) => refKind(ft, r) === 'related-line') ?? all[0]
    }
    const dreamItem = (other: string, src: LinkRef, rec?: DreamRec): RelatedItem => {
      const outgoing = src.from === path
      const q = rec ? (rec.from === path ? rec.qTo : rec.qFrom) : undefined
      const srcText = texts.get(src.from) ?? ''
      const kind = refKind(srcText, src)
      const mk = q && rec?.words && rec.from !== path ? q.indexOf(rec.words) : -1
      const quote = q ? { text: q, ...(mk >= 0 ? { mark: [mk, mk + rec!.words!.length] as [number, number] } : {}) } : kind === 'sentence' && !outgoing ? quoteOf(srcText, src) : { text: opening(texts.get(other) ?? '') }
      const tt = outgoing ? { here: src.line } : toOf(src)
      return {
        id: 'd:' + other,
        kind: 'dream',
        path: other,
        where: whereOf(other),
        ...(rec?.why ? { why: rec.why } : {}),
        ...(kind === 'related-line' ? { relLine: outgoing ? ('out' as const) : ('in' as const) } : {}),
        ...(quote.text ? { quote } : {}),
        ...tt,
        line: outgoing ? (lineOf(texts.get(other) ?? '', q) ?? 0) : src.line,
        ...(rec ? { night: rec.night } : {}),
        src: { path: src.from, line: src.line },
      }
    }
    for (const rec of store.dream) {
      if (rec.from !== path && rec.to !== path) continue
      const other = rec.from === path ? rec.to : rec.from
      if (!texts.has(other)) continue
      const src = refBetween(rec.from, rec.to)
      if (!src) continue
      dream.set(other, dreamItem(other, src, rec))
    }
    // 这篇末尾「相关：」行里指出去的
    const pathOfKey = (key: string) => resolve(key.split('/').pop()!) ?? [...texts.keys()].find((p) => keysOf(p).includes(key)) ?? null
    for (const r of ix.refsIn(path)) {
      if (refKind(text, r) !== 'related-line') continue
      const other = pathOfKey(r.key)
      if (!other || other === path || dream.has(other) || mine.has(undirected(path, other))) continue
      dream.set(other, dreamItem(other, r, recFor(path, other)))
    }

    // ---- 提到这篇的：按篇分，正文里写了一句的在前；只列名字的、前后篇收成一行 ----
    const byFrom = new Map<string, LinkRef[]>()
    for (const r of ix.refsTo(path, aliases)) (byFrom.get(r.from) ?? byFrom.set(r.from, []).get(r.from)!).push(r)
    const mention: (RelatedItem & { m: number })[] = []
    const seq: RelatedResult['seq'] = []
    const listed: string[] = []
    for (const [from, refs] of byFrom) {
      const ft = texts.get(from) ?? ''
      const hub = ix.refsIn(from).length >= HUB_LINKS
      const kinds = refs.map((r) => refKind(ft, r, hub))
      const sentence = refs.filter((_, i) => kinds[i] === 'sentence')
      const embed = refs.find((r) => r.embed)
      // 梦游写进原句的那一处（A1）不算「正文提到」：只有它一处时这一篇留在「梦游连上的」；还有别的句子提到才算「提到这篇的」，写「梦游也连了」
      const dreamRef = dream.get(from)?.src
      const own = dreamRef ? sentence.filter((r) => r.line !== dreamRef.line) : sentence
      if (dreamRef && !own.length && !embed) continue
      if (own.length || embed) {
        const r = own.find((x) => x.anchor) ?? own[0] ?? embed!
        const alsoDream = dream.has(from)
        dream.delete(from)
        mention.push({
          id: 'm:' + from,
          kind: 'mention',
          path: from,
          where: whereOf(from),
          ...(embed ? { embed: embed.anchor ? (embed.anchor.startsWith('^') ? ('block' as const) : ('heading' as const)) : ('note' as const) } : {}),
          ...(own.length > 1 ? { places: own.length } : {}),
          // 只是嵌进去的（![[这篇]] 独占一行）没有「那一句」
          ...(own.length ? { quote: quoteOf(ft, r) } : {}),
          ...toOf(r),
          line: r.line,
          ...(alsoDream ? { alsoDream } : {}),
          m: v.mtimeOf(from),
        })
        continue
      }
      if (dream.has(from)) continue
      if (kinds.includes('related-line')) {
        if (!mine.has(undirected(path, from))) dream.set(from, dreamItem(from, refs[kinds.indexOf('related-line')]!, recFor(from, path)))
        else listed.push(from)
        continue
      }
      const s = refs.findIndex((_, i) => kinds[i] === 'seq')
      if (s >= 0) seq.push({ path: from, dir: seqDir(ft, refs[s]!) })
      else listed.push(from)
    }
    mention.sort(byQuoteThenNew)

    // ---- 像但还没连的 ----
    const like: RelatedItem[] = []
    const taken = new Set<string>([path, ...byFrom.keys(), ...dream.keys(), ...ix.refsIn(path).map((r) => pathOfKey(r.key) ?? '')])
    const notLinked = (other: string) => texts.has(other) && !taken.has(other) && !rejected.has(undirected(path, other)) && !linked(ix, path, aliases, other, aliasOf(other))
    // 梦游判过的：同一对只留最近那次，同一主题、同一内容，把握到「拿不准」那条线以上
    const judged = new Map<string, (typeof ledger.pairs)[string]>()
    const judgedAny = new Set<string>()
    for (const p of Object.values(ledger.pairs)) {
      if (p.a !== path && p.b !== path) continue
      const other = p.a === path ? p.b : p.a
      judgedAny.add(other)
      if (p.level !== 'same-topic' && p.level !== 'same-content') continue
      if (p.confidence < LINK_ASK) continue
      const had = judged.get(other)
      if (!had || had.at < p.at) judged.set(other, p)
    }
    for (const [other, p] of [...judged].sort((x, y) => y[1].confidence - x[1].confidence)) {
      if (!notLinked(other)) continue
      const qMine = p.a === path ? p.quoteA : p.quoteB
      const qOther = p.a === path ? p.quoteB : p.quoteA
      const here = lineOf(text, qMine)
      like.push({
        id: 'l:' + other,
        kind: 'like',
        path: other,
        where: whereOf(other),
        why: humanWhy(p.why, p.b).replace(/[。.\s]+$/u, ''),
        ...(qOther ? { quote: { text: qOther } } : {}),
        ...(here !== undefined ? { here } : {}),
        line: lineOf(texts.get(other) ?? '', qOther) ?? 0,
        ...(qMine ? { near: qMine } : {}),
      })
    }
    let likeState: RelatedResult['likeState'] = 'ok'
    let indexing: RelatedResult['indexing']
    if (texts.size < LIKE_MIN_NOTES) likeState = 'small'
    else {
      const st = searchStatus()
      if (st.phase === 'off') likeState = like.length ? 'ok' : 'off'
      else if (st.phase !== 'ready') {
        likeState = 'indexing'
        indexing = { done: st.done, total: st.total, unit: st.phase === 'embed' ? 'chunk' : 'note' }
      } else if (like.length < 5) {
        const hits = (await similar(path, text)) ?? []
        let n = 0
        for (const h of hits) {
          if (n >= UNJUDGED_MAX) break
          if (judgedAny.has(h.path) || !notLinked(h.path) || like.some((x) => x.path === h.path)) continue
          const here = lineOf(text, h.mine)
          like.push({
            id: 'l:' + h.path,
            kind: 'like',
            path: h.path,
            where: whereOf(h.path),
            quote: { text: h.theirs.replace(/\s+/g, ' ').trim().slice(0, 140) },
            ...(here !== undefined ? { here } : {}),
            line: lineOf(texts.get(h.path) ?? '', h.theirs) ?? 0,
            near: h.mine,
            unjudged: true,
          })
          n++
        }
      }
    }

    // ---- 最上面那张「词条」卡：梦游建议过、这篇提到了的那个东西（C1）；已经建好的换成那一页 ----
    let entry: RelatedResult['entry']
    const low = text.toLowerCase()
    for (const e of ledger.entries ?? []) {
      if (!(e.notes.includes(path) || low.includes(e.name.toLowerCase()))) continue
      const page = [...texts.keys()].find((p) => titleOf(p).toLowerCase() === e.name.toLowerCase())
      if (page === path) continue
      if (!page && ledger.entryNo?.includes(e.name.toLowerCase())) continue
      entry = { name: e.name, count: e.count, ...(page ? { page } : {}) }
      break
    }

    return {
      path,
      ...(entry ? { entry } : {}),
      mention: mention.map(({ m: _m, ...x }) => x),
      seq,
      listed,
      dream: [...dream.values()],
      like,
      likeState,
      ...(indexing ? { indexing } : {}),
      dreamState: !set.steps.link ? 'off' : report || store.dream.length ? 'ok' : 'never',
      notes: texts.size,
      ms: Math.round(performance.now() - t0),
    }
  }

  // ---- 改文件：先把用户在这篇里没提交的字单独提交，再写、再提交，撤销才只撤这一处 ----
  async function writeAndCommit(v: Vault, rel: string, before: string, after: string, message: string): Promise<string | null> {
    const pending = (await git.status(v.root)).filter((s) => s.path === rel)
    if (pending.length)
      await git.commitPaths(v.root, [rel], git.describeChanges(pending)).catch((e) => {
        if (!(e instanceof git.GitError)) throw e
      })
    const w = await v.write(rel, after, before)
    if (!w.ok) throw new Error(`《${titleOf(rel)}》刚被改过，这次没改，再点一次`)
    o.noteChanged(rel, after)
    o.filesChanged()
    try {
      return await git.commitPaths(v.root, [rel], message)
    } catch (e) {
      if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
      throw e
    } finally {
      // 提交完再叫一声：底栏「几处没提交」按提交后的算
      o.filesChanged()
    }
  }

  async function remember(root: string, a: string, b: string, choice: 'no-link' | 'unlink', on: boolean) {
    const file = dreamFiles(root).ledger
    const l = await loadLedger(file)
    const k = undirected(a, b)
    const at = l.rejected.indexOf(k)
    if (on && at < 0) l.rejected.push(k)
    else if (!on && at >= 0) l.rejected.splice(at, 1)
    else return
    await saveLedger(file, l)
    // 「你点的自动记进评测集」（梦游页定 2）：只存这台 Mac
    const labels = dreamFiles(root).labels
    await mkdir(dirname(labels), { recursive: true })
    await appendFile(labels, JSON.stringify({ at: Date.now(), group: 'related', choice: on ? choice : 'undo', a, b }) + '\n')
  }

  const str = (x: unknown, what = '路径') => {
    if (typeof x !== 'string' || !x) throw new Error(`${what}不对`)
    return x
  }

  ipcMain.handle('related:get', (_e, path: unknown) => build(str(path)))

  // 文档底下「提到这篇的」、白板卡底「X 引用了这张」：哪些篇链接、嵌了这一篇（哪一节、哪一段），带那一句；和右栏读同一份索引
  ipcMain.handle('related:backlinks', async (_e, p: unknown): Promise<Backlink[]> => {
    const path = str(p)
    const v = o.vault()
    const texts = await index(v)
    const text = texts.get(path) ?? ''
    const by = new Map<string, LinkRef[]>()
    for (const r of ix.refsTo(path, aliasesOf(text))) (by.get(r.from) ?? by.set(r.from, []).get(r.from)!).push(r)
    const out: (Backlink & { m: number })[] = []
    for (const [from, refs] of by) {
      const ft = texts.get(from) ?? ''
      const sections = new Set<string>()
      const blocks = new Set<string>()
      let embed = false
      let link = false
      for (const r of refs) {
        if (r.anchor.startsWith('^')) {
          const at = blockLine(text, r.anchor.slice(1))
          blocks.add(at >= 0 ? blockLabel(text, at) : r.anchor)
        } else if (r.anchor) sections.add(r.anchor)
        else if (r.embed) embed = true
        else link = true
      }
      const hub = ix.refsIn(from).length >= HUB_LINKS
      const said = refs.find((r) => !r.embed && refKind(ft, r, hub) === 'sentence')
      out.push({ path: from, embed, link, sections: [...sections], blocks: [...blocks], ...(said ? { quote: quoteOf(ft, said) } : {}), bare: !said && !refs.some((r) => r.embed), m: v.mtimeOf(from) })
    }
    return out.sort(byQuoteThenNew).map(({ m: _m, ...x }) => x)
  })

  ipcMain.handle('related:link', async (_e, p: unknown, q: unknown, n: unknown): Promise<RelatedUndo> => {
    const path = str(p)
    const other = str(q)
    const near = typeof n === 'string' ? n : undefined
    const v = o.vault()
    const texts = await index(v)
    const { text: before } = await v.read(path)
    const target = linkTarget(other, texts.keys())
    const edit = linkIn(before, target, wordsOf(titleOf(other), aliasesOf(texts.get(other) ?? '')), near)
    const msg = edit.words ? `相关栏：「${titleOf(path)}」里「${edit.words}」连上 [[${target}]]` : `相关栏：「${titleOf(path)}」末尾「相关：」加上 [[${target}]]`
    const commit = await writeAndCommit(v, path, before, edit.text, msg)
    const s = await loadStore(v.root)
    if (!s.mine.includes(undirected(path, other))) s.mine.push(undirected(path, other))
    await saveStore(v.root, s)
    return { kind: 'link', a: path, b: other, file: { path, before, after: edit.text }, words: edit.words, commit }
  })

  ipcMain.handle('related:unrelated', async (_e, p: unknown, q: unknown): Promise<RelatedUndo> => {
    const path = str(p)
    const other = str(q)
    const v = o.vault()
    const s = await loadStore(v.root)
    if (!s.unrelated.includes(undirected(path, other))) s.unrelated.push(undirected(path, other))
    await saveStore(v.root, s)
    await remember(v.root, path, other, 'no-link', true)
    return { kind: 'unrelated', a: path, b: other }
  })

  ipcMain.handle('related:unlink', async (_e, p: unknown, q: unknown, srcArg: unknown): Promise<RelatedUndo> => {
    const path = str(p)
    const other = str(q)
    const src = srcArg as { path?: unknown; line?: unknown } | null
    if (!src || typeof src.path !== 'string' || typeof src.line !== 'number') throw new Error('撤哪一处不对')
    const v = o.vault()
    const texts = await index(v)
    const target = src.path === path ? other : path
    const { text: before } = await v.read(src.path)
    const after = unlinkIn(before, src.path, src.line, keysOf(target, aliasesOf(texts.get(target) ?? '')))
    if (after === null) throw new Error(`《${titleOf(src.path)}》里那处链接已经不在了`)
    const commit = await writeAndCommit(v, src.path, before, after, `相关栏：撤掉梦游连的「${titleOf(src.path)}」→ [[${titleOf(target)}]]`)
    await remember(v.root, path, other, 'unlink', true)
    return { kind: 'unlink', a: path, b: other, file: { path: src.path, before, after }, commit }
  })

  // 建词条页（梦游 Wiki 那节 C1）：AI 起草、要嵌的段在原文行尾加块编号、词条页放进收件箱，一次提交；撤销是这几个文件回到改之前（新建的删掉）
  ipcMain.handle('related:entry', async (_e, n: unknown, f: unknown): Promise<RelatedUndo> => {
    const name = str(n, '词条名')
    const from = typeof f === 'string' ? f : ''
    const v = o.vault()
    const texts = await index(v)
    const ledger = await loadLedger(dreamFiles(v.root).ledger)
    const prefer = ledger.entries?.find((e) => e.name.toLowerCase() === name.toLowerCase())?.notes ?? []
    const judge = judgeRunner(o.settings().judge)
    // 提到它的地方链过去：过线的线照梦游判断那一路（Sonnet 0.8、Haiku 0.85）
    const plan = await planEntry({ texts, name, prefer, ask: (system, prompt) => judge.ask(system, prompt), by: judge.by, pass: judge.line.pass })
    const files: NonNullable<RelatedUndo['files']> = []
    const pending = (await git.status(v.root)).filter((x) => plan.edits.some((e) => e.path === x.path))
    if (pending.length)
      await git.commitPaths(v.root, pending.map((x) => x.path), git.describeChanges(pending)).catch((e) => {
        if (!(e instanceof git.GitError)) throw e
      })
    for (const ed of plan.edits) {
      const w = await v.write(ed.path, ed.after, ed.before)
      if (!w.ok) throw new Error(`《${titleOf(ed.path)}》刚被改过，这次没建，再点一次`)
      o.noteChanged(ed.path, ed.after)
      files.push({ path: ed.path, before: ed.before, after: ed.after })
    }
    await v.write(plan.path, plan.text, '')
    files.push({ path: plan.path, before: null, after: plan.text })
    o.filesChanged()
    let commit: string | null = null
    try {
      commit = await git.commitPaths(v.root, files.map((x) => x.path), `相关栏：建词条页「${name}」${plan.linked.length ? `，${new Set(plan.linked.map((l) => l.path)).size} 篇里提到它的字链过来` : ''}`)
    } catch (e) {
      if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
      throw e
    } finally {
      o.filesChanged()
    }
    // 拿不准的那几处记进梦游判断进度（同一主题、把握 0.6）：那几篇的右栏「像但还没连的」里列着，你点「连上」才写
    if (plan.unsure.length) {
      const lf = dreamFiles(v.root).ledger
      const l = await loadLedger(lf)
      for (const u of plan.unsure)
        l.pairs[`entry:${u.path}\0${plan.path}`] = { a: u.path, b: plan.path, level: 'same-topic', confidence: 0.6, why: `提到「${u.words}」，AI 拿不准说的是不是词条页讲的这个`, quoteA: u.quote, quoteB: '', at: Date.now() }
      await saveLedger(lf, l)
    }
    return { kind: 'entry', a: from || plan.path, b: plan.path, files, commit, linked: plan.linked, unsure: plan.unsure }
  })

  ipcMain.handle('related:entry-no', async (_e, n: unknown) => {
    const name = str(n, '词条名').toLowerCase()
    const v = o.vault()
    const file = dreamFiles(v.root).ledger
    const l = await loadLedger(file)
    if (!l.entryNo.includes(name)) l.entryNo.push(name)
    await saveLedger(file, l)
  })

  ipcMain.handle('related:undo', async (_e, uArg: unknown) => {
    const u = uArg as RelatedUndo
    if (!u || typeof u.a !== 'string' || typeof u.b !== 'string' || !['link', 'unrelated', 'unlink', 'entry'].includes(u.kind)) throw new Error('撤销的参数不对')
    const v = o.vault()
    if (u.kind === 'entry') {
      const files = Array.isArray(u.files) ? u.files : []
      for (const f of files) {
        if (typeof f?.path !== 'string' || typeof f.after !== 'string' || (f.before !== null && typeof f.before !== 'string')) throw new Error('撤销的参数不对')
        let now: string | null
        try {
          now = (await v.read(f.path)).text
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
          now = null
        }
        if (now !== f.after) throw new Error(`《${titleOf(f.path)}》后来又改过，撤不回了；要以前的那份在历史里找`)
      }
      for (const f of files) {
        if (f.before === null) {
          await rm(v.abs(f.path))
          o.filesChanged()
        } else {
          await v.write(f.path, f.before, f.after)
          o.noteChanged(f.path, f.before)
        }
      }
      try {
        await git.commitPaths(v.root, files.map((f) => f.path), `撤销：建词条页「${titleOf(u.b)}」`)
        // 拿不准、记进判断进度的那几处一起拿掉（词条页没了）
        const lf = dreamFiles(v.root).ledger
        const l = await loadLedger(lf)
        const ks = Object.keys(l.pairs).filter((k) => k.startsWith('entry:') && k.endsWith(`\0${u.b}`))
        if (ks.length) {
          for (const k of ks) delete l.pairs[k]
          await saveLedger(lf, l)
        }
      } catch (e) {
        if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
        throw e
      } finally {
        o.filesChanged()
      }
      return
    }
    const k = undirected(u.a, u.b)
    if (u.file) {
      const { path, before, after } = u.file
      if (typeof path !== 'string' || typeof before !== 'string' || typeof after !== 'string') throw new Error('撤销的参数不对')
      const { text: now } = await v.read(path)
      if (now !== after) throw new Error(`《${titleOf(path)}》后来又改过，撤不回了；要以前的那份在历史里找`)
      await writeAndCommit(v, path, after, before, `撤销：相关栏${u.kind === 'link' ? '连上' : '撤掉'}「${titleOf(u.a)}」和「${titleOf(u.b)}」`)
    }
    const s = await loadStore(v.root)
    if (u.kind === 'link') s.mine = s.mine.filter((x) => x !== k)
    if (u.kind === 'unrelated') s.unrelated = s.unrelated.filter((x) => x !== k)
    await saveStore(v.root, s)
    if (u.kind !== 'link') await remember(v.root, u.a, u.b, 'no-link', false)
  })

  ipcMain.handle('related:dot', async (_e, p: unknown) => {
    const path = str(p)
    const v = o.vault()
    // 打开一篇笔记就在后台把反查索引建好：点开相关栏时只查表（这里出的错，点开相关栏时照样会报出来）
    void index(v).catch(() => undefined)
    const s = await loadStore(v.root)
    const texts = await v.texts()
    if (syncReport(s, await loadReport(v.root), resolver(texts))) await saveStore(v.root, s)
    const seen = s.seen[path] ?? s.since
    return s.dream.some((d) => (d.from === path || d.to === path) && d.at > seen)
  })

  ipcMain.handle('related:seen', async (_e, p: unknown) => {
    const path = str(p)
    const v = o.vault()
    const s = await loadStore(v.root)
    s.seen[path] = Date.now()
    await saveStore(v.root, s)
  })
}
