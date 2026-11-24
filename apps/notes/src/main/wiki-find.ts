/**
 * 梦游 Wiki 化找候选（task-h7oy8，设计页 24-梦游底层 W.1「梦游怎么判断」①②③）：
 * - A 那头切成一句句（clausesOf）：一行按句号切开，一串「、」隔开的清单拆成一项项；标题、任务、表格、「相关：」行、链接列表那几节不算；
 * - B 那头是全库每一段（@cn/format 的 outline），直接在全库每一段里找，不先挑篇（先挑篇时「杠铃卧推」找不到「解剖02 · 练胸」第八节）；
 * - 三路：名字（别的篇的名字、别名原样出现在这句里 → 整篇）、标题（别的篇某个标题里能单独认的那一截出现在这句里 → 那一节）、
 *   关键词（这句的词在全库每一段里按 BM25 排）；向量那一路在主进程里加（搜索进程的段向量，wikiMerge 的 vec）。
 * 纯函数，不碰 Electron：找像的笔记那个进程（similar/worker.ts）和单元测试直接用。
 */
import { headingParts, hanBigrams, outline, type Passage, termCounts } from '@cn/format'
import { titleOf } from '../shared/layout'
import { isAutoSummary } from './duplicates'

/** A 里的一句：第 line 行 [start, end) 那一截 */
export interface Clause {
  line: number
  start: number
  end: number
  text: string
}

/** 候选：path 的第 i 段（i = -1 是整篇，名字那一路），via 是哪一路找到的 */
export interface Hit {
  path: string
  i: number
  /** 名字那一路：命中的那个名字；标题那一路：命中的那个标题行 */
  heading?: number
  name?: string
  score: number
}

export interface ClauseHits {
  name: Hit[]
  head: Hit[]
  kw: Hit[]
}

const FM = /^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const FENCE = /^\s*(```|~~~)/
/** 这些节是链接列表，不是正文（同 dream-judge 的 LINK_SECTION） */
const LINK_SECTION = /^#{1,6}\s*(?:\d+[.、]\s*)?(?:[^\p{L}\p{N}]\s*)?(related|相关|see also|siblings|同层|parent|父笔记|children|子笔记|cross-?ref|关联|与.{0,20}的关系|延伸阅读|backlinks?|反向链接|链接|导航|上一篇|下一篇|prev|next|库变动)/iu
const HAN = /\p{Script=Han}/gu
const hanCount = (s: string) => (s.match(HAN) ?? []).length
const LEAD = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?/
/** 日记、周记这类按日子起名的：不当 B（一句日记链到另一天的日记，真库上 46 条全是这种） */
export const DATED = /^\d{4}[-年.]\d{1,2}([-月.]\d{1,2}日?)?(\s|$)|^\d{4}-W\d{2}/

/** 一句够不够长：中文至少 4 个字，英文至少 3 个词 */
const enough = (s: string) => hanCount(s) >= 4 || (hanCount(s) === 0 && (s.match(/[A-Za-z]{2,}/g) ?? []).length >= 3)

/** A 的正文切成一句句（行号、在那一行的起止） */
export function clausesOf(text: string): Clause[] {
  const out: Clause[] = []
  const lines = text.split('\n')
  const fm = FM.exec(text)
  let fence = false
  let skip = 0
  for (let i = fm ? fm[0].split('\n').length - 1 : 0; i < lines.length; i++) {
    const l = lines[i]!
    if (FENCE.test(l)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const h = /^(#{1,6})\s/.exec(l)
    if (h) {
      const level = h[1]!.length
      if (skip && level > skip) continue
      skip = LINK_SECTION.test(l) ? level : 0
      continue
    }
    if (skip) continue
    if (/^\s*[-*+] \[.\]/.test(l) || /^\s*\|/.test(l) || /^\s*相关[：:]/.test(l) || /\^dida-/.test(l) || /^\s*<!--/.test(l) || /^\s*!\[/.test(l)) continue
    // 几乎只有链接的行（目录、相关列表）
    if (l.replace(/!?\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, '').replace(/[\s\p{P}\p{S}]/gu, '').length < 4) continue
    const from = LEAD.exec(l)![0].length
    // 句号、问号、分号切开（句末的标点留在前一句里）
    const sentences: [number, number][] = []
    let s = from
    for (let k = from; k < l.length; k++) {
      if ('。！？!?；;'.includes(l[k]!)) {
        sentences.push([s, k + 1])
        s = k + 1
      }
    }
    if (s < l.length) sentences.push([s, l.length])
    for (const [a, b] of sentences) {
      const sent = l.slice(a, b)
      // 一串「、」隔开的清单（训练记录「杠铃卧推 60kg×6×3、双杠臂屈伸 自重」）：拆成一项项
      const parts: [number, number][] = []
      if ((sent.match(/、/g) ?? []).length >= 2) {
        let p = a
        for (let k = a; k < b; k++)
          if ('、，,——'.includes(l[k]!) && l[k] !== '—') {
            parts.push([p, k])
            p = k + 1
          }
        parts.push([p, b])
      } else parts.push([a, b])
      for (let [x, y] of parts) {
        while (x < y && /[\s—：:]/.test(l[x]!)) x++
        while (y > x && /\s/.test(l[y - 1]!)) y--
        const t = l.slice(x, y)
        if (!enough(t.replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, '$1'))) {
          // 清单里一项太短（「双杠」两个字）：至少两个汉字也收，名字、标题那一路认得出来
          if (!(parts.length > 1 && hanCount(t) >= 2)) continue
        }
        out.push({ line: i, start: x, end: y, text: t.slice(0, 240) })
      }
    }
  }
  return out
}

/** 给 AI 看、拿来找的那句字：链接只留看得见的字，去掉加粗这类记号 */
export const clausePlain = (s: string) =>
  s
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|==|~~|`/g, '')
    .trim()

/** 一段变成纯文字（找词、给 AI 看） */
export const passagePlain = (s: string) =>
  clausePlain(
    s
      .split('\n')
      .map((l) => l.replace(LEAD, '').replace(/\s*\^[A-Za-z0-9-]+\s*$/, ''))
      .join('\n'),
  )

/** 名字那一路认的名字：整个名字、去掉开头编号的、「：」「（」前面那一截（至少 3 个汉字），加上别名（至少 2 个汉字） */
export function namesOf(path: string, aliases: string[]): string[] {
  const t = titleOf(path)
  const out = new Set<string>()
  const ok = (s: string, minHan: number) => {
    const w = s.trim()
    const han = hanCount(w)
    if (han >= minHan || (han === 0 && w.replace(/[^a-z]/gi, '').length >= 4)) out.add(w)
  }
  const noNum = t.replace(/^\s*\d+[-_.、\s]+/, '')
  ok(t, 3)
  ok(noNum, 3)
  ok(noNum.split(/[：:（(|｜]/)[0]!, 3)
  for (const a of aliases) ok(a, 2)
  return [...out]
}

/** 别名（属性 aliases / alias / 别名） */
export function aliasesIn(text: string): string[] {
  const fm = FM.exec(text)
  if (!fm) return []
  const lines = fm[0].split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(aliases|alias|别名)\s*:\s*(.*)$/i.exec(lines[i]!)
    if (!m) continue
    const v = m[2]!.trim()
    if (v.startsWith('[')) out.push(...v.replace(/^\[|\]$/g, '').split(','))
    else if (v) out.push(v)
    else for (let j = i + 1; j < lines.length && /^\s+-\s*/.test(lines[j]!); j++) out.push(lines[j]!.replace(/^\s+-\s*/, ''))
  }
  return out.map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}

const termsOf = (s: string) => termCounts(s)

/** 全库每一段的索引（BM25 只看有没有，不看几次：段都短） */
export class PassageIndex {
  readonly docs: { path: string; i: number; len: number }[] = []
  private post = new Map<string, number[]>()
  private avg = 1
  /** 每篇的段、标题（主进程和这里切法一样：同一个 outline） */
  readonly outlines = new Map<string, ReturnType<typeof outline>>()
  /** 名字 → 那几篇；标题里的一截 → 那几处 */
  private names = new Map<string, Set<string>>()
  private heads = new Map<string, { path: string; heading: number }[]>()

  constructor(texts: Iterable<[string, string]>, usableB: (path: string, text: string) => boolean) {
    let total = 0
    for (const [path, text] of texts) {
      if (!path.toLowerCase().endsWith('.md') || !usableB(path, text) || !thingNote(path, text)) continue
      const o = outline(text)
      this.outlines.set(path, o)
      o.passages.forEach((p, i) => {
        if (p.kind === 'table') return
        const plain = passagePlain(p.text)
        const terms = [...termsOf(plain).keys()]
        if (terms.length < 2) return
        const id = this.docs.length
        this.docs.push({ path, i, len: terms.length })
        total += terms.length
        for (const t of terms) (this.post.get(t) ?? this.post.set(t, []).get(t)!).push(id)
      })
      for (const n of namesOf(path, aliasesIn(text))) (this.names.get(n.toLowerCase()) ?? this.names.set(n.toLowerCase(), new Set()).get(n.toLowerCase())!).add(path)
      o.headings.forEach((h, k) => {
        if (isTitleHeading(o, k)) return
        for (const part of headingParts(h.text)) (this.heads.get(part.toLowerCase()) ?? this.heads.set(part.toLowerCase(), []).get(part.toLowerCase())!).push({ path, heading: k })
      })
    }
    this.avg = total / Math.max(1, this.docs.length)
    // 太多篇的标题里都有的那一截（「动作要点」「总结」）当不了线索
    const notes = new Map<string, number>()
    for (const [part, list] of this.heads) {
      const n = new Set(list.map((x) => x.path)).size
      notes.set(part, n)
      if (n > 12 || list.length > 30) this.heads.delete(part)
    }
  }

  /** 这句里出现的别的篇的名字（长的先；同名两篇都给，交给判断分） */
  nameHits(c: string, self: string): Hit[] {
    const low = c.toLowerCase()
    const out: Hit[] = []
    for (const [n, paths] of this.names) {
      if (!low.includes(n)) continue
      // 英文按整词认
      if (!/\p{Script=Han}/u.test(n)) {
        const at = low.indexOf(n)
        if (/[a-z0-9]/i.test(low[at - 1] ?? '') || /[a-z0-9]/i.test(low[at + n.length] ?? '')) continue
      }
      for (const p of paths) if (p !== self) out.push({ path: p, i: -1, name: n, score: n.length })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6)
  }

  /** 这句里出现了某个标题能单独认的一截（「双杠臂屈伸」→「九、动作评述④：双杠臂屈伸（多关节）」那一节） */
  headHits(c: string, self: string): Hit[] {
    const low = c.toLowerCase()
    const out: Hit[] = []
    for (const [part, list] of this.heads) {
      if (!low.includes(part)) continue
      for (const x of list) {
        if (x.path === self) continue
        const o = this.outlines.get(x.path)!
        const first = o.passages.findIndex((p) => p.heading === x.heading)
        out.push({ path: x.path, i: first, heading: x.heading, name: part, score: part.length })
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8)
  }

  /** 关键词那一路：BM25（k1 1.2、b 0.75），很常见的词（四分之一以上的段都有）不算 */
  kwHits(c: string, self: string, k = 8): Hit[] {
    const terms = [...termsOf(c).keys()]
    const N = this.docs.length
    const score = new Map<number, number>()
    for (const t of terms) {
      const list = this.post.get(t)
      if (!list || list.length > Math.max(20, N / 4)) continue
      const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5))
      for (const id of list) {
        const d = this.docs[id]!
        const s = (idf * 2.2) / (1 + 1.2 * (0.25 + (0.75 * d.len) / this.avg))
        score.set(id, (score.get(id) ?? 0) + s)
      }
    }
    return [...score]
      .filter(([id]) => this.docs[id]!.path !== self)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, s]) => ({ path: this.docs[id]!.path, i: this.docs[id]!.i, score: Math.round(s * 100) / 100 }))
  }

  /** 这句和这段共有的「少见的词」有几个（判断这句值不值得问 AI） */
  rareShared(c: string, path: string, i: number): number {
    const o = this.outlines.get(path)
    const p = i >= 0 ? o?.passages[i] : undefined
    if (!p) return 0
    const mine = termsOf(passagePlain(p.text))
    const N = this.docs.length
    let n = 0
    for (const t of termsOf(c).keys()) if (mine.has(t) && (this.post.get(t)?.length ?? N) <= Math.max(3, N / 100)) n++
    return n
  }

  hits(c: string, self: string): ClauseHits {
    return { name: this.nameHits(c, self), head: this.headHits(c, self), kw: this.kwHits(c, self) }
  }
}

/** 一段的标题链（「九、动作评述④：双杠臂屈伸（多关节） 52:56」，没有标题是空串） */
export function headingOfPassage(o: ReturnType<typeof outline>, p: Passage | undefined): string {
  return p && p.heading >= 0 && !isTitleHeading(o, p.heading) ? o.headings[p.heading]!.text : ''
}

/** 开头那个一级标题是整篇的题目，不算「一节」（[[B#题目]] 等于链整篇） */
export const isTitleHeading = (o: ReturnType<typeof outline>, k: number) => k === 0 && o.headings[0]!.level === 1

/** 真的那几节（去掉开头当题目的一级标题） */
export const sectionsOf = (o: ReturnType<typeof outline>) => o.headings.filter((_, k) => !isTitleHeading(o, k))

/** 两个字一片（给向量那一路挑段用） */
export const bigramsOf = (s: string) => new Set(hanBigrams(s.replace(/[^\p{Script=Han}]/gu, '')))

const PLACEHOLDER = /^(未命名|untitled)(\s*\d+)?$/i
/** 能当 B 的：不是软件汇总的、不是临时名、正文至少 20 个字 */
export const usableB = (p: string, t: string) => !isAutoSummary(t) && !PLACEHOLDER.test(titleOf(p)) && t.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/\s+/g, '').length >= 20

/** 全库建一次索引，每篇 A 的每句找三路（找像的笔记那个进程、单元测试都用它） */
export function findHits(texts: [string, string][], asks: [string, string[]][]): ClauseHits[][] {
  const ix = new PassageIndex(texts, usableB)
  return asks.map(([self, cs]) => cs.map((c) => ix.hits(c, self)))
}

/**
 * 能当 B（讲一样东西）的：不是按日子起名的（日记、周记），不是模板，不是目录页（MOC、README、链出去 25 处以上的 Hub）。
 * 真库上错的两条就是链到「日记模板」那一节和「Getnotes-MOC」
 */
export function thingNote(path: string, text: string): boolean {
  const t = titleOf(path)
  if (DATED.test(t) || /模板|template|(^|[-_ ])moc$|^readme$|^index$|^hub([-_ ]|$)/i.test(t)) return false
  return (text.match(/\[\[/g) ?? []).length < 25
}
