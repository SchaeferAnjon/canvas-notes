/**
 * 文档切到白板的每一种卡（照 doc-to-board 方向 A 小样 proto-a.html 的卡片：inner() / cardHtml()）。
 * 一张卡 = 卡头一行（小图标 + 种类或名字 + 右边的数）+ 按种类画的正文；长的只露一角，双击看全文（full）。
 * 不露 md 写法（偏好「只文档白板不露源码」「剪藏卡片别露原文」）：书摘卡头是「《书》· 章」，PDF 页画缩略图，
 * 公式用 KaTeX 排好，问过 AI 的截图画出来，数据库画成一张小表，[[白板]] 是一张白板卡，![[笔记]] 是嵌入的笔记卡。
 * 只读：卡上能做的（勾待办、点开折叠块、复制代码）交给 DocBoardView 写回。
 */
import { Codicon, type CodiconName } from '@cn/design'
import type { EngineId } from '../../shared/agent'
import { EngineLogo } from '../engine-logo'
import { type AskPart, type AskSection, askSectionsOf, type DocUnit, findMath, isSummaryHead, parseHlLine, parseSection, parseTable, plainQ, prop } from '@cn/format'
import { type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ScrollX } from '../scroll-x'
import type { NoteFile } from '../../shared/api'
import { type FileEntry, fileName } from '../../shared/files'
import { previewOf, titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { ASKED } from '../../shared/web-notes'
import { parseCallout } from '../callout'
import { CardBody, classify, domainOf, TODO } from '../CardBody'
import { Attached, inline, Markdown, reviewTag } from '../md-render'
import { embedImageSrc, imageSrc } from '../md-widgets'
import { MathBlock } from '../reading/math'
import { SideText, type Spot } from '../side/file-side'
import { videoUrlOfCard } from '../video/BoardCards'
import { BaseCard } from './base-card'
import { MapCard } from '../mindmap/MapThumb'
import { BoardScale, usePdfPage } from './pdf-page'
import { pdfThumbWidth } from '../board-zoom'
import { hlDot } from '../reading/hl-kinds'
import { useT } from '../i18n'
import { t as tNow, uiLang } from '../../shared/i18n'
import { ipcOn } from '../crash/ipc'

/** 卡上能点的：勾第几行待办、开一个文件或网页、看全文 */
export interface CardActs {
  /** 勾待办：unit.text 里第几行 */
  onToggle(line: number): void
  /** 双击打开的那样东西（PDF 页、笔记、白板、HTML、网页） */
  onOpen(o: OpenTarget): void
  /** 「整页打开」「双击看全部」：看全文 */
  onFull(): void
  /** 数据库卡「展开」：卡在原地长成整张表（白板上才有） */
  onExpand?(): void
  /** 数据库卡双击卡头的名字改名：改的是数据源那个文件夹（库里 file.inFolder 跟着换，白板上能改时才有） */
  onRenameBase?(folder: string, name: string): void
  /** AI 讲解卡上选一句开旁支（白板上的卡才有，task-p90ra；拖着的影子、看全文的浮层没有） */
  side?: Spot
}

export type OpenTarget = { kind: 'file'; path: string; page?: number } | { kind: 'url'; url: string }

export interface CardCtx {
  notePath: string
  notes: NoteFile[]
  files: FileEntry[]
  /** 双击看全文：全部行、全部字 */
  full: boolean
}

// ---------------------------------------------------------------- 认出是哪种卡

interface Source {
  title: string
  url: string | null
  /** 《书》· 章 */
  book?: { name: string; chapter: string }
}

export type Face =
  | { k: 'text' | 'list' | 'html'; md: string }
  | { k: 'todo'; rows: { line: number; done: boolean; text: string }[] }
  /** chat：AI 块头上「回到 AI 对话」那条链接（卡头画成一个能点的「回到 AI 对话」） */
  | { k: 'callout'; kind: string; icon: CodiconName; engine: EngineId | null; bare?: boolean; tone: string; title: string; meta: string; body: string; chat?: string }
  | { k: 'code'; lang: string; lines: string[] }
  | { k: 'math'; tex: string[] }
  | { k: 'table'; head: string[]; rows: string[][]; right: boolean[] }
  | { k: 'base'; src: string }
  | { k: 'pdf'; name: string; page: number; file: FileEntry | null }
  | { k: 'ask'; s: AskSection; pdf: FileEntry | null; back?: string }
  /** 问过 AI 一处一列里的一张（doc-board.ts 的 askUnits）：s 是这一张拼上标题行、链接行认出来的；more 是回答的后半截（md），marks 是那一页划的线 */
  | { k: 'askpart'; part: AskPart; s: AskSection | null; pdf: FileEntry | null; back?: string; md: string; marks: { text: string; name: string; key: string }[] }
  | { k: 'details'; title: string; body: string }
  | { k: 'note'; note: NoteFile }
  | { k: 'clipnote'; note: NoteFile }
  | { k: 'board'; note: NoteFile }
  | { k: 'link'; title: string; sub: string; icon: CodiconName; open: OpenTarget | null }
  | { k: 'embedimg'; src: string; alt: string; from?: { title: string; url: string } }
  | { k: 'quote'; quote: string[]; source: Source | null; items: { wr: boolean; text: string }[]; callout: boolean }
  | { k: 'cardbody'; kind: 'video' | 'moment' }
  | { k: 'images'; imgs: { alt: string; src: string }[] }

/** 卡头一行的种类名（看全文的浮层头上也用），照小样的叫法 */
// 不翻：键，画的地方翻（faceName 里 tNow(…, { ctx: '卡片种类' })）
export const KIND_NAME: Record<string, string> = {
  text: '正文', // 不翻
  list: '列表', // 不翻
  html: '正文', // 不翻
  todo: '待办', // 不翻
  callout: '提示块', // 不翻
  ai: 'AI 讲解', // 不翻
  code: '代码', // 不翻
  math: '公式', // 不翻
  table: '表格', // 不翻
  base: '数据库', // 不翻
  pdf: 'PDF 页', // 不翻
  ask: '问过 AI', // 不翻
  askpart: '问过 AI', // 不翻
  details: '折叠块', // 不翻
  note: '嵌入的笔记', // 不翻
  clipnote: '网页剪藏', // 不翻
  board: '白板', // 不翻
  link: '双链', // 不翻
  embedimg: '图片', // 不翻
  image: '图片', // 不翻
  images: '图集', // 不翻
  video: '视频', // 不翻
  moment: '视频时刻', // 不翻
  book: '书摘', // 不翻
  web: '网页引文', // 不翻
  quote: '引文', // 不翻
}

/** 卡的整体样子：素材卡（浅底）、提示块（灰底）、媒体卡（图满宽，没有内边距） */
export function faceClass(f: Face): string {
  // 名字带 fc- 前缀：别处有全局的 .callout（设置页的提醒框）这类，撞名会把卡片变成别的样子
  if (f.k === 'quote' || f.k === 'clipnote') return 'fc-clip'
  if (f.k === 'callout') return 'fc-callout'
  if (f.k === 'ask' || f.k === 'askpart') return 'fc-ask'
  if (f.k === 'embedimg' || f.k === 'images' || f.k === 'cardbody') return 'fc-media'
  return ''
}

export function faceName(f: Face): string {
  // 「AI 总结的」卡写成 [!ai] 提示块以后（task-5yp97）头一个词是「AI 总结」（界面上的种类名跟界面语言；@cn/format 的 SUMMARY_LABEL 是写进文件、认块用的那个说法）
  if (f.k === 'callout') return f.kind === 'ai' ? (isSummaryHead(f.title) ? tNow('AI 总结', { ctx: '卡片种类' }) : tNow(KIND_NAME.ai!, { ctx: '卡片种类' })) : tNow(KIND_NAME.callout!, { ctx: '卡片种类' })
  if (f.k === 'quote') return tNow(f.source?.book ? KIND_NAME.book! : f.source ? KIND_NAME.web! : KIND_NAME.quote!, { ctx: '卡片种类' })
  if (f.k === 'cardbody') return tNow(KIND_NAME[f.kind]!, { ctx: '卡片种类' })
  return KIND_NAME[f.k] ? tNow(KIND_NAME[f.k]!, { ctx: '卡片种类' }) : tNow('正文', { ctx: '卡片种类' })
}

const WIKI = /^!?\[\[([^\]|#^]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]\s*$/
const BOOK = /^《([^》]+)》\s*(?:[·・]\s*(.*))?$/
const SOURCE_LINE = /^(?:>\s*)?——\s*(?:\[([^\]]+)\]\((\S+?)\)|(.+?))\s*$/

/** 按名字找库里的文件（照 Obsidian：同一个文件夹里的先，再是路径短的） */
function nearest<T extends { path: string }>(list: T[], here: string): T | null {
  if (!list.length) return null
  const dir = here.includes('/') ? here.slice(0, here.lastIndexOf('/') + 1) : ''
  return [...list].sort((a, b) => Number(!a.path.startsWith(dir)) - Number(!b.path.startsWith(dir)) || a.path.length - b.path.length)[0]!
}

function sourceOf(title: string, url: string | null): Source {
  const t = title.trim()
  const b = BOOK.exec(t)
  return { title: t, url, ...(b ? { book: { name: b[1]!.trim(), chapter: (b[2] ?? '').trim() } } : {}) }
}

/** 问过 AI 那一列里的一张：拼上这一节的标题行、链接行，照笔记的认法（parseSection）认 */
function askFace(part: AskPart, head: string, text: string, ctx: Pick<CardCtx, 'notePath' | 'files'>): Face {
  // AI 对话写进笔记的新写法（ai-note.ts）：head 是「## 那一节」+ 这一问（### 到 AI 块末尾）；旁支那张自己就是一问（#### 旁支：…）
  if (/\n#{3,4} /.test(head)) {
    const h2 = head.split('\n', 1)[0]!
    const s = part === 'more' ? null : (askSectionsOf(part === 'side' ? `${h2}\n\n${text}` : head, ctx.notePath)[0] ?? null)
    const back = /^>?\s*—— \[[^\]]*\]\(([^)\s]+)\)\s*$/m.exec(head)?.[1]
    const pdf = s?.file ? (ctx.files.find((f) => f.path === s.file) ?? null) : null
    return { k: 'askpart', part, s, pdf, ...(back && s?.file ? { back } : {}), md: part === 'more' || part === 'q' ? text : '', marks: [] }
  }
  const back = /^\[第\s*\d+\s*页\]\(([^)\s]+)\)/m.exec(part === 'old' ? text : head)?.[1]
  const marks = part === 'marks' ? text.split('\n').flatMap((l) => {
    const h = parseHlLine(l, ctx.notePath)
    return h ? [{ text: h.text, name: h.name, key: h.key }] : l.trim() ? [{ text: l.replace(/^[-*]\s+/, ''), name: '', key: '' }] : []
  }) : []
  const s = part === 'more' || part === 'marks' ? null : parseSection(part === 'old' ? `${head}\n${text}` : part === 'top' ? `${head.split('\n')[0]}\n${text}` : `${head}\n\n${text}`, ctx.notePath)
  // 以前的格式整节一张：照原来的问答卡画（有问答的是 AskDoc，没有的是 AskCard）；askpart 没有 old 的画法，以前有问答的这一节画成空卡
  if (part === 'old') {
    if (!s) return { k: 'text', md: text }
    const pdf = s.file ? (ctx.files.find((f) => f.path === s.file) ?? null) : null
    return { k: 'ask', s, pdf, ...(back ? { back } : {}) }
  }
  const pdf = s?.file ? (ctx.files.find((f) => f.path === s.file) ?? null) : null
  return { k: 'askpart', part, s, pdf, ...(back ? { back } : {}), md: part === 'more' ? text : '', marks }
}

/** 引文、书摘：正文几行、出处、挂在下面的「微信读书的想法」「我的评价」 */
function quoteFace(text: string): Face {
  const lines = text.split('\n')
  let source: Source | null = null
  let callout = false
  const body: string[] = []
  const items: { wr: boolean; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const head = i === 0 ? parseCallout(raw) : null
    if (head) {
      // > [!quote] [《在冰岛开车》 · 第二章 天气](weread://…)：头上的链接就是出处
      callout = true
      const m = /^\[([^\]]+)\]\((\S+?)\)\s*$/.exec(head.title)
      if (m) source = sourceOf(m[1]!, m[2]!)
      else if (head.title) source = sourceOf(head.title, null)
      continue
    }
    const s = SOURCE_LINE.exec(raw.trim())
    if (s) {
      source = sourceOf(s[1] ?? s[3] ?? '', s[2] ?? null)
      continue
    }
    const l = raw.replace(/^\s*>\s?/, '')
    // 微信读书的想法、我的评价（引文下面挂着的几段，或者书摘提示块里的一段）：和文档里一样画成标签，从引文竖线拐一道弯钩
    const tag = reviewTag(l)
    if (tag) {
      items.push({ wr: tag.wr, text: l.slice(tag.len) })
      continue
    }
    if (items.length) {
      if (l.trim()) items[items.length - 1]!.text += '\n' + l
      continue
    }
    body.push(l)
  }
  while (body.length && !body[body.length - 1]!.trim()) body.pop()
  return { k: 'quote', quote: body, source, items: items.map((it) => ({ ...it, text: it.text.trim() })), callout }
}

export function faceOf(u: DocUnit, ctx: Pick<CardCtx, 'notePath' | 'notes' | 'files'>): Face {
  // AI 对话写进笔记的新写法：回答那一张就是那块 [!ai]（和文档里一样带框带标志，问句只在列头），用户补的字是普通的字
  if (u.ask && /\n#{3,4} /.test(u.ask.head) && (u.ask.part === 'qa' || u.ask.part === 'more')) {
    const { ask: _ask, ...plain } = u
    void _ask
    // 卡头只写「AI 回答 · 哪家 · 模型」：「回到 AI 对话」那个链接在卡上不画（点卡就回文档那一处）
    // 混排一节里问答组的回答（kind 已是 callout，7b）：照原型留着「回到 AI 对话」；配对笔记一问一列的照旧不画
    return u.ask.part === 'qa' ? faceOf({ ...plain, kind: 'callout', text: u.kind === 'callout' ? u.text : u.text.replace(/ · \[[^\]]*\]\(canvas-notes:\/\/chat\?[^)]*\)/, '') }, ctx) : { k: 'text', md: u.text }
  }
  if (u.ask) return askFace(u.ask.part, u.ask.head, u.text, ctx)
  const text = u.lead ? u.text.slice(u.lead).replace(/^\s+/, '') : u.text
  const t = text.trim()
  switch (u.kind) {
    case 'todo': {
      const lines = u.text.split('\n')
      const rows: { line: number; done: boolean; text: string }[] = []
      lines.forEach((l, i) => {
        const m = TODO.exec(l)
        if (m && (!u.lead || i >= u.text.slice(0, u.lead).split('\n').length)) rows.push({ line: i, done: m[1] !== ' ', text: m[2] ?? '' })
      })
      return { k: 'todo', rows }
    }
    case 'callout': {
      const first = text.split('\n')[0]!
      const c = parseCallout(first)
      if (!c) return { k: 'text', md: text }
      const title = c.title || c.label
      const cut = c.kind === 'ai' ? title.indexOf(' · ') : -1
      // 提示块到第一个空行为止：AI 讲解下面挂着的旁支（`> [!side]`，和讲解同一张卡）卡上不画
      const own = text.split('\n').slice(1)
      const end = own.findIndex((l) => !l.trim())
      const body = (end < 0 ? own : own.slice(0, end)).map((l) => l.replace(/^\s*>\s?/, '')).join('\n')
      // AI 块头上的链接卡上不露写法：「回到 AI 对话」单独画成能点的一截（和文档里的回答框一样），回网页的「[6.2.1 … ↩](…)」只留字
      const chat = c.kind === 'ai' ? /\[[^\]]*\]\((canvas-notes:\/\/chat\?[^)\s]*)\)/.exec(title)?.[1] : undefined
      const meta = cut > 0 ? title.slice(cut + 3).replace(/(?:\s*·\s*)?\[[^\]]*\]\(canvas-notes:\/\/chat\?[^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1') : ''
      return { k: 'callout', kind: c.kind, icon: c.icon, engine: c.engine, ...(c.bare ? { bare: true } : {}), tone: c.tone, title: cut > 0 ? title.slice(0, cut) : title, meta, body, ...(chat ? { chat } : {}) }
    }
    case 'quote':
      // 网页剪下来的一段（> 原文 + —— [标题](网址)）、书摘（—— [《书》 · 章](阅读页)、> [!quote] [《书》 · 章](…)）
      return quoteFace(text)
    case 'code': {
      const lines = text.split('\n')
      const lang = /^(?:```|~~~)\s*(\S*)/.exec(lines[0] ?? '')?.[1] ?? ''
      const end = /^(```|~~~)\s*$/.test(lines[lines.length - 1] ?? '') ? -1 : undefined
      return { k: 'code', lang, lines: lines.slice(1, end) }
    }
    case 'math':
      // 认法同文档编辑器（findMath）：$$…$$、\[…\]
      return { k: 'math', tex: findMath(text).map((m) => m.tex) }
    case 'table': {
      const p = parseTable(text, { kind: 'table', from: 0, to: text.length })
      return { k: 'table', head: p.head.map((c) => c.text), rows: p.rows.map((r) => p.head.map((_, j) => r[j]?.text ?? '')), right: p.align.map((a) => a === 'right') }
    }
    case 'base':
      return { k: 'base', src: text.replace(/^(```|~~~)base[^\n]*\n/, '').replace(/\n(```|~~~)\s*$/, '') }
    case 'ask': {
      const s = parseSection(u.text, ctx.notePath)
      if (!s) return { k: 'text', md: u.text }
      const pdf = s.file ? (ctx.files.find((f) => f.path === s.file) ?? null) : null
      // 回到 PDF 那一页那一块的链接（这一段第二行写的）：点「我框的」图时用（task-yp8l7）
      const back = /^\[第\s*\d+\s*页\]\(([^)\s]+)\)/m.exec(u.text)?.[1]
      return { k: 'ask', s, pdf, ...(back ? { back } : {}) }
    }
    case 'details': {
      const lines = text.split('\n')
      const m = /<summary>([\s\S]*?)<\/summary>/i.exec(text)
      const after = m ? text.slice(text.indexOf(m[0]) + m[0].length) : lines.slice(1).join('\n')
      return { k: 'details', title: (m?.[1] ?? '').replace(/\s+/g, ' ').trim(), body: after.replace(/<\/details>\s*$/i, '').trim() }
    }
    case 'embed':
    case 'link': {
      const m = WIKI.exec(t)
      if (!m) return { k: 'text', md: text }
      const target = m[1]!.trim()
      const anchor = m[2] ?? ''
      const alias = m[3]?.trim()
      const low = target.toLowerCase()
      const ext = /\.([a-z0-9]+)$/i.exec(target)?.[1]?.toLowerCase()
      const fileHits = ctx.files.filter((f) => fileName(f.path).toLowerCase() === low || f.path.toLowerCase() === low)
      if (ext === 'pdf') {
        const page = Number(/page=(\d+)/.exec(anchor)?.[1] ?? 1)
        const file = nearest(fileHits.filter((f) => f.kind === 'pdf'), ctx.notePath)
        if (u.kind === 'embed') return { k: 'pdf', name: target.replace(/\.pdf$/i, ''), page, file }
        return { k: 'link', title: alias || target, sub: anchor ? tNow('PDF · 第{page}页', { page }) : 'PDF', icon: 'file-pdf', open: file ? { kind: 'file', path: file.path, page } : null }
      }
      if (ext && /^(png|jpe?g|gif|webp|svg|avif)$/.test(ext)) return { k: 'embedimg', src: embedImageSrc(ctx.notePath, target), alt: alias && !/^\d{1,5}(x\d{1,5})?$/.test(alias) ? alias : '' }
      const notes = ctx.notes.filter((n) => titleOf(n.path).toLowerCase() === low || n.path.toLowerCase() === low + '.md')
      const note = nearest(notes, ctx.notePath)
      if (note?.board) return { k: 'board', note }
      if (note && u.kind === 'embed') return note.source ? { k: 'clipnote', note } : { k: 'note', note }
      if (note) return { k: 'link', title: alias || titleOf(note.path), sub: tNow('笔记', { ctx: '卡片种类' }), icon: 'file-text', open: { kind: 'file', path: note.path } }
      // 没写后缀的 HTML、别的文件：按不带后缀的名字找
      const other = nearest(ctx.files.filter((f) => f.kind !== 'dir' && f.kind !== 'md' && fileName(f.path).replace(/\.[^.]+$/, '').toLowerCase() === low), ctx.notePath) ?? nearest(fileHits, ctx.notePath)
      if (other) {
        const kind = other.kind === 'html' ? 'HTML' : other.kind === 'pdf' ? 'PDF' : (/\.([^.]+)$/.exec(other.path)?.[1] ?? '').toUpperCase()
        return { k: 'link', title: alias || titleOf(other.path).replace(/\.[^.]+$/, ''), sub: `${fileName(other.path).replace(/\.[^.]+$/, '')} · ${kind}`, icon: other.kind === 'html' ? 'file-code' : other.kind === 'pdf' ? 'file-pdf' : 'file', open: { kind: 'file', path: other.path } }
      }
      return { k: 'link', title: alias || target, sub: tNow('库里还没有这一篇'), icon: 'file', open: null }
    }
    case 'image': {
      const m = /!\[([^\]]*)\]\(([^)\s]+)/.exec(text)
      return m ? { k: 'embedimg', src: imageSrc(ctx.notePath, m[2]!), alt: m[1]! } : { k: 'text', md: text }
    }
    case 'images':
      return { k: 'images', imgs: [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)].map((m) => ({ alt: m[1]!, src: imageSrc(ctx.notePath, m[2]!) })) }
    case 'video':
      return { k: 'cardbody', kind: 'video' }
    case 'moment':
      return { k: 'cardbody', kind: 'moment' }
    case 'list':
      return { k: 'list', md: text }
    case 'html':
      return { k: 'html', md: text }
    default: {
      // 光秃秃一行视频网址：画成视频卡（标题、频道，看过一次就记在本机），和以前的自由白板一样
      if (videoUrlOfCard(text)) return { k: 'cardbody', kind: 'video' }
      // 网页拖来的图：一行图、下一行「—— [网页标题](网址)」：图卡，下面说明，再下面出处（不露 md 写法）
      const im = /^!\[([^\]]*)\]\(([^)\s]+)\)\n—— \[([^\]]+)\]\(([^)\s]+)\)$/.exec(text.trim())
      if (im) return { k: 'embedimg', src: imageSrc(ctx.notePath, im[2]!), alt: im[1]!, from: { title: im[3]!, url: im[4]! } }
      return { k: 'text', md: text }
    }
  }
}

// ---------------------------------------------------------------- 画

/** 卡头一行：小图标 + 种类（或名字）+ 右边灰字 */
function Kh(props: { icon: CodiconName; children: ReactNode; right?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="kh">
      <Codicon name={props.icon} size={14} />
      {props.children}
      {props.right !== undefined && <span className="r num">{props.right}</span>}
      {props.extra}
    </div>
  )
}

/** 材料的编号（和 ai-note.ts 写进文件的同一套） */
const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const vaultSrc = (path: string) => 'cn-file://vault/' + path.split('/').map(encodeURIComponent).join('/')

/** 一张卡的正文（u 是这张卡，f 是 faceOf 认出的样子） */
export function UnitBody(props: { u: DocUnit; f: Face; ctx: CardCtx; acts: CardActs }) {
  const { u, f, ctx, acts } = props
  const lead = u.lead ? u.text.slice(0, u.lead).trim() : ''
  // 待办上面紧跟着的一行短标题（「**装备**」「出发前要做的：」）：画成卡头的名字
  const named = f.k === 'todo' && lead && !lead.includes('\n') ? lead.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim() : ''
  return (
    <>
      {lead && !named && (
        <div className="db-lead">
          <Markdown text={lead} />
        </div>
      )}
      <Main u={u} f={f} ctx={ctx} acts={acts} name={named || undefined} />
    </>
  )
}

/**
 * 回答限高（用户：「收起来看不到我问的内容」，问的那句、引文另外整段露出）：超出的地方给「展开全文」，点了在卡里展开、再点「收起」；
 * 展开只是看法，不写文件。放大看那张（full）整段，没超出不出按钮；开着旁支时（里面挂着 .side-host）CSS 整段露出
 */
function Folded({ lines, full, className, children }: { lines: 5 | 7; full: boolean; className?: string; children: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || full || open) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1)
    check()
    // 公式、图后到，卡宽变了（缩放、拖宽列）：里面那块长高了再量一次
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    return () => ro.disconnect()
  }, [full, open])
  if (full) return <div className={className}>{children}</div>
  return (
    <>
      <div ref={ref} className={[className, 'db-fold', open ? 'open' : `clamp${lines}`].filter(Boolean).join(' ')}>
        {children}
      </div>
      {(over || open) && (
        <button
          type="button"
          className="db-unfold"
          aria-expanded={open}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? t('收起', { ctx: '回答' }) : t('展开全文')}
        </button>
      )}
    </>
  )
}

/** AI 块正文开头引着的原文（`> …`）、框的图：网页「你问」块里就是问的那段，整段露出；下面的回答限高 */
function splitLead(body: string): [string, string] {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && /^\s*(?:>|!\[)/.test(lines[i]!)) i++
  return i === 0 ? ['', body] : [lines.slice(0, i).join('\n'), lines.slice(i).join('\n').replace(/^\s*\n/, '')]
}

/** AI 块的正文：引着的原文整段，回答限高 + 展开全文；开着旁支时回答整段露出（卡跟着长高） */
function AiBody({ body, spot, full }: { body: string; spot?: Spot | null; full: boolean }) {
  const [lead, answer] = splitLead(body)
  return (
    <>
      {lead.trim() && (
        <div className="db-md db-ai-lead">
          <Markdown text={lead} />
        </div>
      )}
      {answer.trim() && (
        <Folded lines={5} full={full}>
          {spot ? (
            <SideText spot={spot} md={answer} className="db-md" />
          ) : (
            <div className="db-md">
              <Markdown text={answer} />
            </div>
          )}
        </Folded>
      )}
    </>
  )
}

function Main({ u, f, ctx, acts, name }: { u: DocUnit; f: Face; ctx: CardCtx; acts: CardActs; name?: string }) {
  const t = useT()
  const full = ctx.full
  switch (f.k) {
    case 'text':
    case 'list':
    case 'html':
      return (
        <div className={'db-md' + (full ? '' : ' clamp7')}>
          <Markdown text={f.md} />
        </div>
      )
    case 'todo': {
      const done = f.rows.filter((r) => r.done).length
      const shown = full ? f.rows : f.rows.slice(0, 6)
      return (
        <>
          <Kh icon="checklist" right={`${done}/${f.rows.length}`}>
            {name ? <span className="truncate">{name}</span> : t('待办', { ctx: '卡片种类' })}
          </Kh>
          <div className="cb-todo db-todo">
            {shown.map((r) => (
              <label key={r.line} className={'td' + (r.done ? ' done' : '')}>
                <input type="checkbox" checked={r.done} onChange={() => acts.onToggle(r.line)} onMouseDown={(e) => e.stopPropagation()} />
                <span>{inline(r.text, r.line)}</span>
              </label>
            ))}
          </div>
          {f.rows.length > shown.length && <div className="from">{t('还有{n}条', { n: f.rows.length - shown.length })}</div>}
        </>
      )
    }
    case 'callout':
      return (
        <div className={`cl tone-${f.tone}`} data-kind={f.kind} data-asked={f.kind === 'ai' && f.title.startsWith(`${ASKED}：`) ? '' : undefined}>
          <div className="ct">
            {/* 没写哪家的「AI 总结」块不画图标（task-5yp97） */}
            {f.engine ? <EngineLogo id={f.engine} size={14} /> : f.bare ? null : <Codicon name={f.icon} size={14} />}
            <span className="nm">{f.title}</span>
            {(f.meta || f.chat) && (
              <span className="eng">
                {f.meta}
                {f.chat && (
                  <>
                    {f.meta ? ' · ' : ''}
                    <a className="db-chat" data-chat={f.chat}>
                      {t('回到 AI 对话')}
                    </a>
                  </>
                )}
              </span>
            )}
          </div>
          {f.kind === 'ai' ? (
            <AiBody body={f.body} spot={acts.side} full={full} />
          ) : (
            f.body.trim() && (
              <div className={'db-md' + (full ? '' : ' clamp5')}>
                <Markdown text={f.body} />
              </div>
            )
          )}
        </div>
      )
    case 'code': {
      const lines = full ? f.lines : f.lines.slice(0, 8)
      return (
        <>
          <Kh
            icon="code"
            right={t('{n}行', { n: f.lines.length })}
            extra={
              <button
                type="button"
                className="cp"
                aria-label={t('复制代码')}
                data-tip={t('复制代码')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void navigator.clipboard.writeText(f.lines.join('\n'))}
              >
                <Codicon name="copy" size={13} />
              </button>
            }
          >
            {f.lang || t('代码', { ctx: '卡片种类' })}
          </Kh>
          <pre className={'db-code' + (!full && f.lines.length > 8 ? ' fade' : '')}>{highlight(lines.join('\n'), f.lang)}</pre>
        </>
      )
    }
    case 'math':
      return (
        <>
          <Kh icon="symbol-operator">{t('公式', { ctx: '卡片种类' })}</Kh>
          <div className="db-math">
            {f.tex.map((t, i) => (
              <MathBlock key={i} latex={t} />
            ))}
          </div>
        </>
      )
    case 'table': {
      // 卡里默认整张表都画出来（2026-11-24 用户「表格也展示全部 不默认收起来」）；上百行的才只画前 TABLE_ROWS 行
      const rows = full ? f.rows : f.rows.slice(0, TABLE_ROWS)
      return (
        <>
          <Kh icon="table" right={t('{rows}行 × {cols}列', { rows: f.rows.length, cols: f.head.length })}>
            {t('表格', { ctx: '卡片种类' })}
          </Kh>
          <MiniTable head={f.head} rows={rows} right={f.right} wrap />
          {f.rows.length > rows.length && (
            <div className="from">
              {t('还有{n}行', { n: f.rows.length - rows.length, ctx: '表格' })}
              {' · '}
              <button type="button" className="db-all" onClick={(e) => (e.stopPropagation(), acts.onFull())}>
                {t('看全部')}
              </button>
            </div>
          )}
        </>
      )
    }
    case 'base':
      return <BaseCard src={f.src} full={full} onExpand={acts.onExpand ?? acts.onFull} onRename={acts.onRenameBase} />
    case 'pdf':
      return (
        <>
          <Kh icon="file-pdf">
            <b>{f.name}</b>
            <span className="pg">{` · ${t('第{page}页', { page: f.page })}`}</span>
          </Kh>
          <PdfPage file={f.file} page={f.page} />
        </>
      )
    case 'ask':
      return f.s.qas ? <AskDoc s={f.s} pdf={f.pdf} back={f.back} /> : <AskCard s={f.s} pdf={f.pdf} full={full} />
    case 'askpart':
      return <AskPartBody f={f} full={full} />
    case 'details':
      return <Details title={f.title} body={f.body} full={full} />
    case 'note':
      return <EmbedNote note={f.note} full={full} />
    case 'clipnote':
      return <ClipNote note={f.note} full={full} />
    case 'board':
      // 导图（白板样式: 导图）：上面缩略、下面「导图 · N个主题」，不当普通白板写「0张卡片」（task-wuv05）
      if (f.note.board!.nodes !== undefined) return <MapCard note={f.note} />
      return (
        <div className="db-lnk">
          <span className="sq" style={{ background: f.note.board!.color }} />
          <span>
            <b>{titleOf(f.note.path)}</b>
            <span>{t('白板 · {n}张卡片 · 双击打开', { n: f.note.board!.cards })}</span>
          </span>
        </div>
      )
    case 'link':
      return (
        <div className="db-lnk">
          <span className="ic">
            <Codicon name={f.icon} size={16} />
          </span>
          <span>
            <b>{f.title}</b>
            <span>{f.open ? t('{sub} · 双击打开', { sub: f.sub }) : f.sub}</span>
          </span>
        </div>
      )
    case 'embedimg':
      return (
        <figure className="db-img">
          <img src={f.src} alt={f.alt} draggable={false} />
          {f.alt && <figcaption>{f.alt}</figcaption>}
          {f.from && (
            <div className="src from-web" title={f.from.url}>
              <Codicon name="globe" size={12} />
              <span className="truncate">{f.from.title}</span>
              <span className="at">{domainOf(f.from.url)}</span>
            </div>
          )}
        </figure>
      )
    case 'images': {
      const shown = full ? f.imgs : f.imgs.slice(0, 4)
      const names = f.imgs.map((x) => x.alt).filter(Boolean)
      return (
        <>
          <div className={'db-gal' + (full ? ' full' : '')}>
            {shown.map((m, i) => (
              <div key={i} className="cell">
                <img src={m.src} alt={m.alt} draggable={false} />
                {!full && i === 3 && f.imgs.length > 4 && <span className="plus">{`+${f.imgs.length - 4}`}</span>}
              </div>
            ))}
          </div>
          <div className="cap">
            <Codicon name="file-media" size={13} />
            {` ${names.length ? t('{n}张图 · {names}', { n: f.imgs.length, names: names.slice(0, 3).join(uiLang() === 'en' ? ', ' : '、') + (names.length > 3 ? '…' : '') }) : t('{n}张图', { n: f.imgs.length })}`}
          </div>
        </>
      )
    }
    case 'quote':
      return <Quote f={f} acts={acts} full={full} />
    case 'cardbody': {
      const main = u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from).trimEnd() : u.text
      return <CardBody text={main} info={classify(main, ctx.notes)} notes={ctx.notes} notePath={ctx.notePath} videoStats={u.moments ? { moments: u.moments.length, asked: 0 } : undefined} onToggle={acts.onToggle} />
    }
  }
}

/** 常见语言的关键字（小样里 import、as 是强调色，字符串黄、注释灰）：只认这几样，别的照原样 */
const KEYWORDS = new Set(
  'import from as def return for in if elif else while class function const let var new await async export default try except catch finally with lambda yield not and or is None True False null true false this self pass break continue raise throw typeof of fn pub use struct enum impl match'.split(' '),
)
function highlight(code: string, lang: string): ReactNode[] {
  const hash = /^(py|python|sh|bash|zsh|r|ruby|yaml|yml|toml)$/i.test(lang)
  const re = hash ? /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|#[^\n]*|\b[A-Za-z_]\w*\b)/g : /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\b[A-Za-z_]\w*\b)/g
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(re)) {
    const t = m[0]
    const cls = /^["'`]/.test(t) ? 's' : t.startsWith('#') || t.startsWith('//') ? 'c' : KEYWORDS.has(t) ? 'k' : null
    if (!cls) continue
    if (m.index! > last) out.push(code.slice(last, m.index))
    out.push(
      <span key={m.index} className={cls}>
        {t}
      </span>,
    )
    last = m.index! + t.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

/** 表格卡里最多先画几行：再多的写「还有 N 行 · 看全部」（一张卡几百行时白板太长、画得慢；一般的表都整张画出来） */
const TABLE_ROWS = 100
/** 一列每一格（连表头）都不超过这么宽（中文一个字算 2，别的算 1）就是短列：#、年份这种，按内容最窄、一行不折 */
const SHORT_COL = 10
const textWidth = (md: string) => {
  let n = 0
  for (const ch of md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '')) n += /[⺀-￿]/.test(ch) ? 2 : 1
  return n
}

/**
 * 卡里的小表：宽了只在卡里横着滚，右边还有列时渐隐（scroll-x.tsx，task-83vl3）。
 * wrap（表格卡，128 页）：长的格子换行、不截不限行数，短列（SHORT_COL）一行；数据库卡照旧一格一行、截省略号
 */
function MiniTable(props: { head: string[]; rows: ReactNode[][]; right?: boolean[]; cls?: (col: number) => string | undefined; wrap?: boolean }) {
  const short = props.wrap ? props.head.map((h, j) => [h, ...props.rows.map((r) => r[j])].every((c) => typeof c === 'string' && textWidth(c) <= SHORT_COL)) : []
  const cellCls = (j: number, extra?: string) => [props.right?.[j] ? 'nr' : '', short[j] ? 'short' : '', extra ?? ''].join(' ').trim() || undefined
  return (
    <ScrollX className="mt-box">
    <table className={props.wrap ? 'mt wrap' : 'mt'}>
      <thead>
        <tr>
          {props.head.map((h, j) => (
            <th key={j} className={cellCls(j)}>
              {typeof h === 'string' ? inline(h, 'h' + j) : h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={i}>
            {props.head.map((_, j) => (
              <td key={j} className={cellCls(j, props.cls?.(j))}>
                {typeof r[j] === 'string' ? inline(r[j] as string, `${i}-${j}`) : r[j]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </ScrollX>
  )
}

/**
 * 引文、书摘：左边一道竖线；挂着的「微信读书的想法」「我的评价」紧跟在引文下面，和文档里一个样子（标签小块、竖线拐下来的弯钩，md-render 的 Attached）；
 * 卡底出处（书摘是「《书》· 章 … 回原文」，网页是域名）
 */
function Quote({ f, acts, full }: { f: Extract<Face, { k: 'quote' }>; acts: CardActs; full: boolean }) {
  const t = useT()
  const s = f.source
  const web = s?.url && /^https?:/i.test(s.url) ? s.url : null
  return (
    <>
      <div className={'q' + (full ? '' : ' clamp6')}>
        <Markdown text={f.quote.join('\n')} />
      </div>
      {f.items.length > 0 && (
        <div className="rvs">
          {f.items.map((it, j) => (
            <Attached key={j} wr={it.wr} hooked clamp={full ? undefined : 'clamp4'}>
              {inline(it.text, j)}
            </Attached>
          ))}
        </div>
      )}
      {s?.book ? (
        <div className="src">
          <Codicon name="book" size={13} />
          <span className="truncate">{`《${s.book.name}》${s.book.chapter ? `· ${s.book.chapter}` : ''}`}</span>
          {web && (
            <button type="button" className="at back" onMouseDown={(e) => e.stopPropagation()} onClick={() => acts.onOpen({ kind: 'url', url: web })}>
              {t('回原文')}
            </button>
          )}
        </div>
      ) : s ? (
        <div className="src">
          <Codicon name="globe" size={13} />
          <span className="truncate">{web ? domainOf(web) : s.title}</span>
        </div>
      ) : null}
    </>
  )
}

/** PDF 一页的缩略图（画一次存在软件设置目录，按路径 + 修改时间 + 页码） */
function PdfPage({ file, page }: { file: FileEntry | null; page: number }) {
  const t = useT()
  // 一页画一份：100% 以内 560 宽（卡上 2 倍屏够清楚），放大了换 1120 / 1680 宽的那份（放大到 300% 字也不糊），卡上和全文共用
  const url = usePdfPage(file?.path ?? null, file?.mtimeMs ?? 0, page, pdfThumbWidth(useContext(BoardScale)))
  if (!file) return <div className="db-slide none">{t('库里没找到这份 PDF')}</div>
  if (url === 'failed') return <div className="db-slide none">{t('这一页画不出来')}</div>
  return <div className={'db-slide' + (url ? '' : ' wait')}>{url && <img src={url} alt={t('第{page}页', { page })} draggable={false} />}</div>
}

/**
 * 问过 AI（新格式，一段 = 一处问的地方，task-yp8l7）：整段都画出来，和文档看法里一样全：页码和时间、标题、我框的图（点了直接回 PDF 那一块，
 * DocBoardView 的 onClick 认 a.db-ask-crop，不走页码小牌先出预览卡那一套）、选字问的原文、每一问的原话和回答原文、旁支、小结。
 * 以前只画第一问的头一段（withDerived 算出来的旧字段），白板看法看着像缺了一大截
 */
function AskDoc({ s, pdf, back }: { s: AskSection; pdf: FileEntry | null; back?: string }) {
  const t = useT()
  const label = s.page > 0 ? t('第{page}页', { page: s.page }) : s.web?.label || t('问过')
  return (
    <>
      <Kh icon="comment-discussion" right={s.time}>
        {label}
      </Kh>
      {s.crop ? (
        <>
          <div className="db-ask-tt">{s.title}</div>
          {back ? (
            <a className="db-ask-crop" data-href={back} data-label={label} title={t('点一下回到 PDF {label}', { label })}>
              <img src={vaultSrc(s.crop)} alt={t('我框的')} draggable={false} style={s.cropW ? { width: s.cropW } : undefined} />
            </a>
          ) : (
            <span className="db-ask-crop">
              <img src={vaultSrc(s.crop)} alt={t('我框的')} draggable={false} style={s.cropW ? { width: s.cropW } : undefined} />
            </span>
          )}
        </>
      ) : (
        <div className="db-ask-top">
          {s.page > 0 && (
            <div className="thumb">
              <PdfPage file={pdf} page={s.page} />
            </div>
          )}
          <div className="tt">{s.title}</div>
        </div>
      )}
      {s.quote && <blockquote className="db-ask-quote">{s.quote}</blockquote>}
      {(s.qas ?? []).map((qa, i) => (
        <div key={i} className="db-ask-qa">
          {qa.q && (
            <div className="row aq">
              <Codicon name="question" size={13} />
              <span>{qa.q}</span>
            </div>
          )}
          {qa.a && <Markdown text={qa.a} />}
          {qa.sides.map((d, j) => (
            <div key={j} className="db-ask-side">
              {d.quote && <div className="sq">{d.quote}</div>}
              {d.turns.map((x, k) => (
                <div key={k}>
                  <div className="row aq">
                    <Codicon name="comment-discussion" size={13} />
                    <span>{x.q}</span>
                  </div>
                  {x.a && <Markdown text={x.a} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {s.recap && (
        <div className="row g db-ask-recap">
          <Codicon name="pass" size={13} />
          <span>{inline(s.recap, 'recap')}</span>
        </div>
      )}
    </>
  )
}

/** 我框的图（点了回 PDF 那一块），没有链接时只画图 */
function Crop({ s, back, label }: { s: AskSection; back?: string; label: string }) {
  const t = useT()
  const img = <img src={vaultSrc(s.crop!)} alt={t('我框的')} draggable={false} style={s.cropW ? { width: s.cropW } : undefined} />
  return back ? (
    <a className="db-ask-crop" data-href={back} data-label={label} title={t('点一下回到 PDF {label}', { label })}>
      {img}
    </a>
  ) : (
    <span className="db-ask-crop">{img}</span>
  )
}

/**
 * 问过 AI 一处一列（2026-11-23 用户：「每个问话作为一列吧，旁支的话可以作为主对话放在对话那一列」）里的一张：
 * top 页码和时间、我框的图（没框画那一页）、选字问的原文；qa 问题条和回答；more 回答后半截；side 旁支（被问那句、几轮问答）；
 * recap 小结；marks 那一页划的线。样子照整节画全的问答卡（AskDoc）
 */
function AskPartBody({ f, full }: { f: Extract<Face, { k: 'askpart' }>; full: boolean }) {
  const t = useT()
  const s = f.s
  switch (f.part) {
    case 'top': {
      if (!s) return null
      const label = s.page > 0 ? t('第{page}页', { page: s.page }) : s.web?.label || t('问过')
      // 列头已经有图标和「第N页 · 标题」：卡头只说下面是什么，右边时间
      return (
        <>
          <div className="kh">
            <span>{s.crop ? (s.doc ? t('我框的') : t('框的图')) : s.quote ? t('选的字') : t('这一页')}</span>
            {s.time && <span className="r num">{s.time}</span>}
          </div>
          {s.crop ? (
            <Crop s={s} back={f.back} label={label} />
          ) : (
            s.page > 0 &&
            // 没框（问整页、选字问）：那一页的上半截，点了回 PDF 那一页
            (f.back ? (
              <a className="db-ask-page" data-href={f.back} data-label={label} title={t('点一下回到 PDF {label}', { label })}>
                <PdfPage file={f.pdf} page={s.page} />
              </a>
            ) : (
              <div className="db-ask-page">
                <PdfPage file={f.pdf} page={s.page} />
              </div>
            ))
          )}
          {s.quote && <blockquote className="db-ask-quote">{s.quote}</blockquote>}
        </>
      )
    }
    case 'qa': {
      const qa = s?.qas?.[0]
      if (!qa) return <Markdown text={f.md} />
      return (
        <div className="db-ask-qa">
          {qa.q && (
            <div className="row aq">
              <Codicon name="question" size={13} />
              <span>{plainQ(qa.q)}</span>
            </div>
          )}
          {qa.a && (
            <Folded lines={7} full={full}>
              <Markdown text={qa.a} />
            </Folded>
          )}
        </div>
      )
    }
    case 'more':
      return (
        <div className="db-ask-more">
          <Folded lines={7} full={full}>
            <Markdown text={f.md} />
          </Folded>
        </div>
      )
    case 'q': {
      // 混排一节里一问一答那一组的头一张（doc-board.ts 7b）：问的那句、① 引文（公式照排）和回到网页那一段的来源、框的图、贴的图，照文件里的先后
      const qa = s?.qas?.[0]
      if (!s || !qa) return <Markdown text={f.md} />
      const src = (label: string, href: string | undefined) =>
        href ? (
          <a className="db-ask-src" data-href={href} title={t('点一下回到网页那一段')}>
            {'—— ' + (label || '↩') + ' ↩'}
          </a>
        ) : label ? (
          <span className="db-ask-src">{'—— ' + label}</span>
        ) : null
      const img = (p: string) => (
        <span key={p} className="db-ask-crop">
          <img src={vaultSrc(p)} alt={t('我框的')} draggable={false} />
        </span>
      )
      return (
        <div className="db-ask-q">
          <div className="row aq">
            <Codicon name="comment-discussion" size={14} />
            <span>
              {plainQ(qa.q)}
              {/* 标了前置知识的那一问（小标题末尾 #前置知识）：同右栏笔记的小标签 */}
              {qa.pre && (
                <span className="db-pre-tag" data-testid="board-pre-tag">
                  {t('前置知识')}
                </span>
              )}
            </span>
          </div>
          {s.quote && (
            <blockquote className="db-ask-quote">
              <span>{inline(s.quote, 'q')}</span>
              {src(s.web?.label ?? '', s.web?.url)}
            </blockquote>
          )}
          {(qa.mats ?? []).map((m, i) =>
            m.kind === 'image' ? (
              img(m.path)
            ) : (
              <blockquote key={i} className="db-ask-quote">
                <span>{inline(`${MARKS[i] ?? ''} ${m.text}`.trim(), 'm' + i)}</span>
                {src(m.src, m.href)}
              </blockquote>
            ),
          )}
          {s.crop && img(s.crop)}
        </div>
      )
    }
    case 'sideq': {
      // 混排一节里问答组的旁支问的那张（7b）：「旁支」、被问的那一句（公式照排）、问题；回答是下面那张浅底卡
      const d = s?.qas?.[0]?.sides?.[0]
      return (
        <>
          <Kh icon="git-branch">{t('旁支')}</Kh>
          <div className="db-ask-side">
            {d?.quote && <div className="sq">{inline(d.quote, 'sq')}</div>}
            {d?.turns[0] && (
              <div className="row aq sq-q">
                <Codicon name="comment-discussion" size={13} />
                <span>{plainQ(d.turns[0].q)}</span>
              </div>
            )}
          </div>
        </>
      )
    }
    case 'side': {
      const sides = s?.qas?.[0]?.sides ?? []
      return (
        <>
          <Kh icon="git-branch">{t('旁支')}</Kh>
          {sides.map((d, j) => (
            <div key={j} className="db-ask-side">
              {/* 被问的那一句照文档排公式（以前露出 $k\times k$ 原文） */}
              {d.quote && <div className="sq">{inline(d.quote, 'sq')}</div>}
              {d.turns.map((x, k) => (
                <div key={k}>
                  <div className="row aq sq-q">
                    <Codicon name="comment-discussion" size={13} />
                    <span>{plainQ(x.q)}</span>
                  </div>
                  {x.a && (
                    <Folded lines={7} full={full}>
                      <Markdown text={x.a} />
                    </Folded>
                  )}
                </div>
              ))}
            </div>
          ))}
        </>
      )
    }
    case 'recap':
      return s?.recap ? (
        <>
          <Kh icon="pass">{t('小结')}</Kh>
          <div className="db-ask-sum">{inline(s.recap, 'recap')}</div>
        </>
      ) : null
    case 'marks':
      return (
        <>
          <Kh icon="edit">{t('划的线')}</Kh>
          {/* 照文档、读 PDF 右栏笔记里的划线：含义色的荧光笔只涂字的下半截，下面一行色点 + 含义名 */}
          <ul className="db-ask-marks">
            {f.marks.map((m, i) => (
              <li key={i} style={{ ['--hl' as string]: hlDot(m.key) }}>
                <span className="mk">{m.text}</span>
                {m.name && (
                  <span className="nm">
                    <i />
                    {m.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )
    default:
      return null
  }
}

/** 问过 AI（以前的格式）：页码和时间、框下来的截图（没有就画那一页）和标题、疑惑一行、讲通三行、完整对话几轮 */
function AskCard({ s, pdf, full }: { s: AskSection; pdf: FileEntry | null; full: boolean }) {
  const t = useT()
  const failed = s.failed.length
  return (
    <>
      <Kh icon="comment-discussion" right={s.time}>
        {s.page > 0 ? t('第{page}页', { page: s.page }) : s.web?.label || t('问过')}
      </Kh>
      <div className="db-ask-top">
        <div className={'thumb' + (full ? ' big' : '')}>{s.crop ? <img src={vaultSrc(s.crop)} alt={t('我框的')} draggable={false} /> : s.page > 0 ? <PdfPage file={pdf} page={s.page} /> : null}</div>
        <div className="tt">{s.title}</div>
      </div>
      {s.doubts.length > 0 && (
        <div className="row q">
          <Codicon name="question" size={13} />
          <span className={full ? '' : 'clamp1'}>{s.doubts.join('；')}</span>
        </div>
      )}
      {s.good && (
        <div className="row g">
          <Codicon name="pass" size={13} />
          {/* 回答原文的开头一段：照 md 排（AI 写的「[第 5 页](#page=5)」是能点的页码，不露写法），和文字卡一个样 */}
          <span className={full ? '' : 'clamp3'}>{inline(s.good, 'good')}</span>
        </div>
      )}
      {full && s.points.length > 0 && (
        <ul className="pts">
          {s.points.map((p, i) => (
            <li key={i}>{inline(p, i)}</li>
          ))}
        </ul>
      )}
      {full &&
        s.failed.map((x) => (
          <details key={x.version} className="md-fold">
            <summary>
              <Codicon name="chevron-right" size={14} />
              <span>{t('没讲通 · 第{v}版：{line}', { v: x.version, line: x.line })}</span>
            </summary>
            <Markdown text={x.text} />
          </details>
        ))}
      <div className="foot">
        <Codicon name="comment-discussion" size={13} />
        {failed ? t('完整对话 · {rounds}轮 · 没讲通{failed}版', { rounds: s.rounds, failed }) : t('完整对话 · {rounds}轮', { rounds: s.rounds })}
      </div>
    </>
  )
}

/** 折叠块：一行「›  标题 … 折着」，点开就地展开（只在白板上，不改文件） */
function Details({ title, body, full }: { title: string; body: string; full: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(full)
  return (
    <>
      <button type="button" className="det" aria-expanded={open} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)}>
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span className="nm">{inline(title)}</span>
        {!open && <span className="r">{t('折着')}</span>}
      </button>
      {open && (
        <div className="det-b">
          <Markdown text={body} />
        </div>
      )}
    </>
  )
}

/** 读一篇笔记的字（嵌入的笔记、整页剪藏卡用）；这一篇改了跟着变 */
function useNoteText(path: string): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.readNote(path).then(
      (n) => live && setText(n.text),
      () => live && setText(''),
    )
    const off = ipcOn(window.cn.onNoteChanged, 'cn.onNoteChanged')((p, t) => p === path && setText(t))
    return () => ((live = false), off())
  }, [path])
  return text
}

/** 摘要只取正文第一段（去掉属性、开头的「# 名字」、出处那行和图），碰到空行、标题就停；看全文时整篇 */
function firstPara(text: string, full: boolean): string {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .filter((l) => !/^#\s/.test(l) && !/^——\s/.test(l) && !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(l.trim()))
    .join('\n')
    .trim()
  if (full) return previewOf(body, 2000)
  const para = body.split(/\n\s*\n|\n(?=#)/)[0] ?? ''
  return previewOf(para, 240)
}

/** 嵌入的笔记：卡头「嵌入的笔记 … 所在的文件夹」，名字加粗，下面三行开头 */
function EmbedNote({ note, full }: { note: NoteFile; full: boolean }) {
  const t = useT()
  const text = useNoteText(note.path)
  const name = titleOf(note.path)
  const where = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')).split('/').join(' / ') : t('库')
  const body = text === null ? '' : firstPara(text, full)
  return (
    <>
      <Kh icon="file-text" right={where}>
        {t('嵌入的笔记', { ctx: '卡片种类' })}
      </Kh>
      <div className="emb">
        <b>{name}</b>
        <p className={full ? '' : 'clamp3'}>{body}</p>
      </div>
    </>
  )
}

/** 整页剪藏：封面（正文里的第一张图）、标题、三行摘要、来源和剪的日子；不露 md 和长链接 */
function ClipNote({ note, full }: { note: NoteFile; full: boolean }) {
  const t = useT()
  const text = useNoteText(note.path)
  const name = titleOf(note.path)
  const body = text ?? ''
  const img = /!\[[^\]]*\]\(([^)\s]+)/.exec(body.replace(/^---\n[\s\S]*?\n---\n?/, ''))?.[1]
  const created = prop(body, 'created')
  const at = created ? Date.parse(created.replace(' ', 'T')) : note.createdMs
  const src = note.source ?? prop(body, 'source') ?? ''
  const summary = firstPara(body, full)
  return (
    <>
      <div className="emb">
        {img && <div className="cv" style={{ backgroundImage: `url("${imageSrc(note.path, img)}")` }} />}
        <b>{name}</b>
        <p className={full ? '' : 'clamp3'}>{summary}</p>
      </div>
      <div className="src">
        <Codicon name="globe" size={13} />
        <span className="truncate">{src ? domainOf(src) : t('剪藏')}</span>
        <span className="at">{when(Number.isFinite(at) ? at : note.createdMs)}</span>
      </div>
    </>
  )
}
