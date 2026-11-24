/**
 * 点了「建词条页」以后（task-h7oy8，设计页 24-梦游底层 W.4，C1）：在全库找提到它的段，交给 AI 起草（shared/wiki-entry.ts），
 * 要嵌进来的段在原文行尾加块编号（B1，只加块编号，别的字不动），词条页放进收件箱（库里认得出的那个收件箱文件夹）。
 * 返回每个文件改前改后的字，相关栏写盘、一次提交、撤销（一字节不差）都用它。纯计算，不碰 Electron、不写文件。
 */
import { addBlockId, blockIdOf, frontLines, newBlockId, onlyBlockIdsAdded, outline } from '@cn/format'
import { LINK_ASK, LINK_PASS } from '../shared/dream-judge'
import { roleByName } from '../shared/vault-roles'
import { INBOX, titleOf } from '../shared/layout'
import { entryLinkPrompt, entryMarkdown, type EntryPiece, entryPrompt, ENTRY_SYSTEM, type EntrySource, parseEntry, parseEntryLinks } from '../shared/wiki-entry'
import { busyRanges, linkTarget } from './related'
import { clausePlain, DATED, headingOfPassage, passagePlain } from './wiki-find'

/** 一页最多收几段（问 AI 的话不太长） */
const MAX_SOURCES = 14

export interface EntryPlan {
  /** 新建的词条页 */
  path: string
  text: string
  /** 加了块编号、提到它的字链过来的那几篇：改前、改后 */
  edits: { path: string; before: string; after: string }[]
  /** 链过来的那几处（哪篇、哪几个字、那一句） */
  linked: EntryMention[]
  /** AI 拿不准的那几处：不改，列给你定 */
  unsure: EntryMention[]
}

export interface EntryMention {
  path: string
  words: string
  quote: string
}

/** 一次最多问几句 */
const MAX_MENTIONS = 40

/** 词条页放哪：库里认得出是收件箱的最外层文件夹（00-Inbox），没有就是收件箱 */
export function entryFolder(paths: Iterable<string>): string {
  const tops = new Set<string>()
  for (const p of paths) if (p.includes('/')) tops.add(p.slice(0, p.indexOf('/')))
  return [...tops].sort().find((f) => roleByName(f) === 'inbox') ?? INBOX
}

/** 提到 name 的段：prefer 里的那几篇先（梦游记下的），每篇最多两段，讲得多的（名字出现次数多、段长）先 */
export function entrySources(texts: ReadonlyMap<string, string>, name: string, prefer: string[] = []): { path: string; passage: number; src: EntrySource }[] {
  const low = name.toLowerCase()
  const found: { path: string; passage: number; text: string; heading: string; score: number }[] = []
  for (const [p, t] of texts) {
    if (!p.toLowerCase().endsWith('.md') || !t.toLowerCase().includes(low)) continue
    const o = outline(t)
    let n = 0
    o.passages.forEach((ps, i) => {
      if (n >= 2 || ps.kind === 'table') return
      const plain = passagePlain(ps.text).replace(/\s+/g, ' ').trim()
      const hits = plain.toLowerCase().split(low).length - 1
      if (!hits) return
      n++
      found.push({ path: p, passage: i, text: plain, heading: headingOfPassage(o, ps), score: hits * 2 + Math.min(plain.length, 400) / 100 + (prefer.includes(p) ? 5 : 0) + (DATED.test(titleOf(p)) ? 0 : 1) })
    })
  }
  return found
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_SOURCES)
    .map((f, k) => ({ path: f.path, passage: f.passage, src: { n: k + 1, title: titleOf(f.path), heading: f.heading, text: f.text.length > 320 ? f.text.slice(0, 320) + '…' : f.text } }))
}

/** 起草、拼页、给要嵌的段加块编号；起草不成（AI 没给出能读的）报错 */
export async function planEntry(o: {
  texts: ReadonlyMap<string, string>
  name: string
  prefer?: string[]
  ask(system: string, prompt: string): Promise<string>
  by: string
  rand?: () => number
  /** 自动链过去的把握线（梦游判断那一路的：Sonnet 0.8、Haiku 0.85） */
  pass?: number
}): Promise<EntryPlan> {
  const name = o.name.trim()
  if (!name) throw new Error('词条名不对')
  const all = [...o.texts.keys()]
  if (all.some((p) => titleOf(p).toLowerCase() === name.toLowerCase())) throw new Error(`库里已经有一篇叫「${name}」了`)
  const srcs = entrySources(o.texts, name, o.prefer)
  if (srcs.length < 2) throw new Error(`库里提到「${name}」的段不到两段，先不建`)
  const reply = await o.ask(ENTRY_SYSTEM, entryPrompt(name, srcs.map((s) => s.src)))
  const draft = parseEntry(reply, srcs.length)
  if (!draft) throw new Error('AI 没给出能读的草稿，再点一次试试')
  // 用到的段：没有块编号的加上（同一篇几段一起加，行号不变：只加在行尾）
  const used = new Set(draft.groups.flatMap((g) => g.items.map((i) => i.n)))
  for (const l of draft.lead) for (const n of l.src) used.add(n)
  const now = new Map<string, string>()
  const pieces = new Map<number, EntryPiece>()
  for (const s of srcs) {
    if (!used.has(s.src.n)) continue
    const before = now.get(s.path) ?? o.texts.get(s.path)!
    const p = outline(before).passages[s.passage]!
    let id = p.id ?? blockIdOf(before.split('\n')[p.end] ?? '')
    let after = before
    if (!id) {
      id = newBlockId(before, o.rand)
      after = addBlockId(before, p.end, id)
    }
    now.set(s.path, after)
    const first = s.src.text.split(/(?<=[。！？!?])/).find((x) => x.toLowerCase().includes(name.toLowerCase())) ?? s.src.text
    pieces.set(s.src.n, { target: linkTarget(s.path, all), id, title: titleOf(s.path), line: first.trim().slice(0, 80) })
  }
  const folder = entryFolder(all)
  let path = `${folder}/${name.replace(/[\\/:*?"<>|]/g, ' ').trim()}.md`
  for (let n = 2; o.texts.has(path); n++) path = `${folder}/${name} ${n}.md`
  const text = entryMarkdown(name, draft, pieces, o.by)

  // 提到它的地方链过来（照 A1：原句里那几个字变成 [[词条|字]]，每篇第一处）：先找、再交给 AI 消歧，过线的才写，拿不准的列给你定
  const target = titleOf(path)
  const found = mentionsOf(o.texts, name, path).slice(0, MAX_MENTIONS)
  const linked: EntryMention[] = []
  const unsure: EntryMention[] = []
  if (found.length) {
    const about = [...draft.lead.map((l) => l.text), ...srcs.filter((s) => used.has(s.src.n)).map((s) => `《${s.src.title}》${s.src.text.slice(0, 160)}`)].join('\n')
    const ans = parseEntryLinks(await o.ask(ENTRY_SYSTEM, entryLinkPrompt(name, [], about, found.map((m) => ({ title: titleOf(m.path), text: m.quote })))), found.length)
    const pass = o.pass ?? LINK_PASS
    for (const a of ans) {
      const m = found[a.index]!
      // 那几个字要真是这个名字（AI 摘错了作废）
      if (a.kind === '不是' || a.confidence < LINK_ASK || a.words.toLowerCase() !== name.toLowerCase()) continue
      if (a.kind === '是' && a.confidence >= pass) {
        const cur = now.get(m.path) ?? o.texts.get(m.path)!
        const lines = cur.split('\n')
        const l = lines[m.line]!
        if (l.slice(m.start, m.end).toLowerCase() !== name.toLowerCase()) continue
        const w = l.slice(m.start, m.end)
        lines[m.line] = l.slice(0, m.start) + (w === target ? `[[${target}]]` : `[[${target}|${w}]]`) + l.slice(m.end)
        now.set(m.path, lines.join('\n'))
        linked.push({ path: m.path, words: w, quote: m.quote })
      } else unsure.push({ path: m.path, words: m.words, quote: m.quote })
    }
  }

  const edits: EntryPlan['edits'] = []
  const unlink = (t: string) => t.split(`[[${target}]]`).join(target).replace(new RegExp(`\\[\\[${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|([^\\]\\n]*)\\]\\]`, 'g'), '$1')
  for (const [p, after] of now) {
    const before = o.texts.get(p)!
    if (after === before) continue
    // 核对：去掉链过来的那几处、去掉块编号，和原来一字不差
    if (!onlyBlockIdsAdded(before, unlink(after))) throw new Error(`「${titleOf(p)}」改的时候别的字也变了，没建`)
    edits.push({ path: p, before, after })
  }
  return { path, text, edits, linked, unsure }
}

/** 一篇里第一处提到 name 的地方（不在属性、代码、标题、已有的链接、#标签里），每篇一处；那一句（到句号）当 AI 看的那句 */
export function mentionsOf(texts: ReadonlyMap<string, string>, name: string, self: string): (EntryMention & { line: number; start: number; end: number })[] {
  const low = name.toLowerCase()
  const han = /\p{Script=Han}/u.test(name)
  const out: (EntryMention & { line: number; start: number; end: number })[] = []
  for (const [p, t] of texts) {
    if (p === self || !p.toLowerCase().endsWith('.md') || !t.toLowerCase().includes(low)) continue
    const lines = t.split('\n')
    let fence = false
    for (let i = frontLines(t); i < lines.length; i++) {
      const l = lines[i]!
      if (/^\s*(```|~~~)/.test(l)) fence = !fence
      if (fence || /^#{1,6}\s/.test(l) || /^\s*\|/.test(l) || !l.toLowerCase().includes(low)) continue
      const busy = busyRanges(l)
      for (const m of l.matchAll(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu)) busy.push([m.index!, m.index! + m[0].length])
      let at = l.toLowerCase().indexOf(low)
      while (at >= 0) {
        const e = at + name.length
        const word = han || (!/[a-z0-9]/i.test(l[at - 1] ?? '') && !/[a-z0-9]/i.test(l[e] ?? ''))
        if (word && !busy.some(([x, y]) => at < y && e > x)) break
        at = l.toLowerCase().indexOf(low, at + 1)
      }
      if (at < 0) continue
      const a = Math.max(0, ...['。', '！', '？', '. '].map((c) => l.lastIndexOf(c, at) + 1))
      const ends = ['。', '！', '？'].map((c) => l.indexOf(c, at)).filter((x) => x >= 0)
      const b = ends.length ? Math.min(...ends) + 1 : l.length
      const quote = clausePlain(l.slice(a, b).replace(/^\s*(?:>\s*)*(?:[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)?/, '')).slice(0, 200)
      out.push({ path: p, words: l.slice(at, at + name.length), quote, line: i, start: at, end: at + name.length })
      break
    }
  }
  // 自己写的、讲东西的笔记先，日记后；同类按路径
  return out.sort((x, y) => Number(DATED.test(titleOf(x.path))) - Number(DATED.test(titleOf(y.path))) || x.path.localeCompare(y.path))
}
