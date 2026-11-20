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
import { type AskSection, baseRows, colType, type DocUnit, parseBase, parseSection, parseTable, prop } from '@cn/format'
import { type ReactNode, useEffect, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { type FileEntry, fileName } from '../../shared/files'
import { previewOf, titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { parseCallout } from '../callout'
import { CardBody, classify, domainOf, TODO } from '../CardBody'
import { Attached, inline, Markdown, reviewTag } from '../md-render'
import { embedImageSrc, imageSrc } from '../md-widgets'
import { MathBlock } from '../reading/math'
import { usePdfPage } from './pdf-page'

/** 卡上能点的：勾第几行待办、开一个文件或网页、看全文 */
export interface CardActs {
  /** 勾待办：unit.text 里第几行 */
  onToggle(line: number): void
  /** 双击打开的那样东西（PDF 页、笔记、白板、HTML、网页） */
  onOpen(o: OpenTarget): void
  /** 「整页打开」「双击看全部」：看全文 */
  onFull(): void
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
  | { k: 'callout'; kind: string; icon: CodiconName; engine: EngineId | null; tone: string; title: string; meta: string; body: string }
  | { k: 'code'; lang: string; lines: string[] }
  | { k: 'math'; tex: string[] }
  | { k: 'table'; head: string[]; rows: string[][]; right: boolean[] }
  | { k: 'base'; src: string }
  | { k: 'pdf'; name: string; page: number; file: FileEntry | null }
  | { k: 'ask'; s: AskSection; pdf: FileEntry | null }
  | { k: 'details'; title: string; body: string }
  | { k: 'note'; note: NoteFile }
  | { k: 'clipnote'; note: NoteFile }
  | { k: 'board'; note: NoteFile }
  | { k: 'link'; title: string; sub: string; icon: CodiconName; open: OpenTarget | null }
  | { k: 'embedimg'; src: string; alt: string }
  | { k: 'quote'; quote: string[]; source: Source | null; items: { wr: boolean; text: string }[]; callout: boolean }
  | { k: 'cardbody'; kind: 'video' | 'moment' }
  | { k: 'images'; imgs: { alt: string; src: string }[] }

/** 卡头一行的种类名（看全文的浮层头上也用），照小样的叫法 */
export const KIND_NAME: Record<string, string> = {
  text: '正文',
  list: '列表',
  html: '正文',
  todo: '待办',
  callout: '提示块',
  ai: 'AI 讲解',
  code: '代码',
  math: '公式',
  table: '表格',
  base: '数据库',
  pdf: 'PDF 页',
  ask: '问过 AI',
  details: '折叠块',
  note: '嵌入的笔记',
  clipnote: '网页剪藏',
  board: '白板',
  link: '双链',
  embedimg: '图片',
  image: '图片',
  images: '图集',
  video: '视频',
  moment: '视频时刻',
  book: '书摘',
  web: '网页引文',
  quote: '引文',
}

/** 卡的整体样子：素材卡（浅底）、提示块（灰底）、媒体卡（图满宽，没有内边距） */
export function faceClass(f: Face): string {
  // 名字带 fc- 前缀：别处有全局的 .callout（设置页的提醒框）这类，撞名会把卡片变成别的样子
  if (f.k === 'quote' || f.k === 'clipnote') return 'fc-clip'
  if (f.k === 'callout') return 'fc-callout'
  if (f.k === 'ask') return 'fc-ask'
  if (f.k === 'embedimg' || f.k === 'images' || f.k === 'cardbody') return 'fc-media'
  return ''
}

export function faceName(f: Face): string {
  if (f.k === 'callout') return f.kind === 'ai' ? KIND_NAME.ai! : KIND_NAME.callout!
  if (f.k === 'quote') return f.source?.book ? KIND_NAME.book! : f.source ? KIND_NAME.web! : KIND_NAME.quote!
  if (f.k === 'cardbody') return KIND_NAME[f.kind]!
  return KIND_NAME[f.k] ?? '正文'
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
      const body = text
        .split('\n')
        .slice(1)
        .map((l) => l.replace(/^\s*>\s?/, ''))
        .join('\n')
      return { k: 'callout', kind: c.kind, icon: c.icon, engine: c.engine, tone: c.tone, title: cut > 0 ? title.slice(0, cut) : title, meta: cut > 0 ? title.slice(cut + 3) : '', body }
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
      return { k: 'math', tex: [...text.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]!.trim()).filter(Boolean) }
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
      return { k: 'ask', s, pdf }
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
        return { k: 'link', title: alias || target, sub: `PDF${anchor ? ` · 第${page}页` : ''}`, icon: 'file-pdf', open: file ? { kind: 'file', path: file.path, page } : null }
      }
      if (ext && /^(png|jpe?g|gif|webp|svg|avif)$/.test(ext)) return { k: 'embedimg', src: embedImageSrc(ctx.notePath, target), alt: alias && !/^\d{1,5}(x\d{1,5})?$/.test(alias) ? alias : '' }
      const notes = ctx.notes.filter((n) => titleOf(n.path).toLowerCase() === low || n.path.toLowerCase() === low + '.md')
      const note = nearest(notes, ctx.notePath)
      if (note?.board) return { k: 'board', note }
      if (note && u.kind === 'embed') return note.source ? { k: 'clipnote', note } : { k: 'note', note }
      if (note) return { k: 'link', title: alias || titleOf(note.path), sub: '笔记', icon: 'file-text', open: { kind: 'file', path: note.path } }
      // 没写后缀的 HTML、别的文件：按不带后缀的名字找
      const other = nearest(ctx.files.filter((f) => f.kind !== 'dir' && f.kind !== 'md' && fileName(f.path).replace(/\.[^.]+$/, '').toLowerCase() === low), ctx.notePath) ?? nearest(fileHits, ctx.notePath)
      if (other) {
        const kind = other.kind === 'html' ? 'HTML' : other.kind === 'pdf' ? 'PDF' : (/\.([^.]+)$/.exec(other.path)?.[1] ?? '').toUpperCase()
        return { k: 'link', title: alias || titleOf(other.path).replace(/\.[^.]+$/, ''), sub: `${fileName(other.path).replace(/\.[^.]+$/, '')} · ${kind}`, icon: other.kind === 'html' ? 'file-code' : other.kind === 'pdf' ? 'file-pdf' : 'file', open: { kind: 'file', path: other.path } }
      }
      return { k: 'link', title: alias || target, sub: '库里还没有这一篇', icon: 'file', open: null }
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
    default:
      return { k: 'text', md: text }
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

const vaultSrc = (path: string) => 'cn-file://vault/' + path.split('/').map(encodeURIComponent).join('/')

/** 一张卡的正文（u 是这张卡，f 是 faceOf 认出的样子） */
export function UnitBody(props: { u: DocUnit; f: Face; ctx: CardCtx; acts: CardActs }) {
  const { u, f, ctx, acts } = props
  const lead = u.lead ? u.text.slice(0, u.lead).trim() : ''
  return (
    <>
      {lead && (
        <div className="db-lead">
          <Markdown text={lead} />
        </div>
      )}
      <Main u={u} f={f} ctx={ctx} acts={acts} />
    </>
  )
}

function Main({ u, f, ctx, acts }: { u: DocUnit; f: Face; ctx: CardCtx; acts: CardActs }) {
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
            待办
          </Kh>
          <div className="cb-todo db-todo">
            {shown.map((r) => (
              <label key={r.line} className={'td' + (r.done ? ' done' : '')}>
                <input type="checkbox" checked={r.done} onChange={() => acts.onToggle(r.line)} onMouseDown={(e) => e.stopPropagation()} />
                <span>{inline(r.text, r.line)}</span>
              </label>
            ))}
          </div>
          {f.rows.length > shown.length && <div className="from">{`还有${f.rows.length - shown.length}条`}</div>}
        </>
      )
    }
    case 'callout':
      return (
        <div className={`cl tone-${f.tone}`} data-kind={f.kind}>
          <div className="ct">
            {f.engine ? <EngineLogo id={f.engine} size={14} /> : <Codicon name={f.icon} size={14} />}
            <span className="nm">{f.title}</span>
            {f.meta && <span className="eng">{f.meta}</span>}
          </div>
          {f.body.trim() && (
            <div className={'db-md' + (full ? '' : ' clamp5')}>
              <Markdown text={f.body} />
            </div>
          )}
        </div>
      )
    case 'code': {
      const lines = full ? f.lines : f.lines.slice(0, 8)
      return (
        <>
          <Kh
            icon="code"
            right={`${f.lines.length}行`}
            extra={
              <button
                type="button"
                className="cp"
                aria-label="复制代码"
                data-tip="复制代码"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void navigator.clipboard.writeText(f.lines.join('\n'))}
              >
                <Codicon name="copy" size={13} />
              </button>
            }
          >
            {f.lang || '代码'}
          </Kh>
          <pre className={'db-code' + (!full && f.lines.length > 8 ? ' fade' : '')}>{highlight(lines.join('\n'), f.lang)}</pre>
        </>
      )
    }
    case 'math':
      return (
        <>
          <Kh icon="symbol-operator">公式</Kh>
          <div className="db-math">
            {f.tex.map((t, i) => (
              <MathBlock key={i} latex={t} />
            ))}
          </div>
        </>
      )
    case 'table': {
      const rows = full ? f.rows : f.rows.slice(0, 4)
      return (
        <>
          <Kh icon="table" right={`${f.rows.length}行 × ${f.head.length}列`}>
            表格
          </Kh>
          <MiniTable head={f.head} rows={rows} right={f.right} />
          {f.rows.length > rows.length && <div className="from">{`还有${f.rows.length - rows.length}行 · 双击看全部`}</div>}
        </>
      )
    }
    case 'base':
      return <BaseCard src={f.src} full={full} acts={acts} />
    case 'pdf':
      return (
        <>
          <Kh icon="file-pdf">
            <b>{f.name}</b>
            <span className="pg">{` · 第${f.page}页`}</span>
          </Kh>
          <PdfPage file={f.file} page={f.page} />
        </>
      )
    case 'ask':
      return <AskCard s={f.s} pdf={f.pdf} full={full} />
    case 'details':
      return <Details title={f.title} body={f.body} full={full} />
    case 'note':
      return <EmbedNote note={f.note} full={full} />
    case 'clipnote':
      return <ClipNote note={f.note} full={full} />
    case 'board':
      return (
        <div className="db-lnk">
          <span className="sq" style={{ background: f.note.board!.color }} />
          <span>
            <b>{titleOf(f.note.path)}</b>
            <span>{`白板 · ${f.note.board!.cards}张卡片 · 双击打开`}</span>
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
            <span>{f.open ? `${f.sub} · 双击打开` : f.sub}</span>
          </span>
        </div>
      )
    case 'embedimg':
      return (
        <figure className="db-img">
          <img src={f.src} alt={f.alt} draggable={false} />
          {f.alt && <figcaption>{f.alt}</figcaption>}
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
            {` ${f.imgs.length}张图${names.length ? ' · ' + names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') : ''}`}
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

function MiniTable(props: { head: string[]; rows: ReactNode[][]; right?: boolean[]; cls?: (col: number) => string | undefined }) {
  return (
    <table className="mt">
      <thead>
        <tr>
          {props.head.map((h, j) => (
            <th key={j} className={props.right?.[j] ? 'nr' : undefined}>
              {typeof h === 'string' ? inline(h, 'h' + j) : h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={i}>
            {props.head.map((_, j) => (
              <td key={j} className={[props.right?.[j] ? 'nr' : '', props.cls?.(j) ?? ''].join(' ').trim() || undefined}>
                {typeof r[j] === 'string' ? inline(r[j] as string, `${i}-${j}`) : r[j]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 引文、书摘：左边一道竖线；挂着的「微信读书的想法」「我的评价」紧跟在引文下面，和文档里一个样子（标签小块、竖线拐下来的弯钩，md-render 的 Attached）；
 * 卡底出处（书摘是「《书》· 章 … 回原文」，网页是域名）
 */
function Quote({ f, acts, full }: { f: Extract<Face, { k: 'quote' }>; acts: CardActs; full: boolean }) {
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
              回原文
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
  // 一页画一份（560 宽，卡上 2 倍屏、全文里都够清楚），卡上和全文共用
  const url = usePdfPage(file?.path ?? null, file?.mtimeMs ?? 0, page, 560)
  if (!file) return <div className="db-slide none">库里没找到这份 PDF</div>
  if (url === 'failed') return <div className="db-slide none">这一页画不出来</div>
  return <div className={'db-slide' + (url ? '' : ' wait')}>{url && <img src={url} alt={`第${page}页`} draggable={false} />}</div>
}

/** 问过 AI：页码和时间、框下来的截图（没有就画那一页）和标题、疑惑一行、讲通三行、完整对话几轮 */
function AskCard({ s, pdf, full }: { s: AskSection; pdf: FileEntry | null; full: boolean }) {
  const failed = s.failed.length
  return (
    <>
      <Kh icon="comment-discussion" right={s.time}>
        {s.page > 0 ? `第${s.page}页` : s.web?.label || '问过'}
      </Kh>
      <div className="db-ask-top">
        <div className={'thumb' + (full ? ' big' : '')}>{s.crop ? <img src={vaultSrc(s.crop)} alt="我框的" draggable={false} /> : s.page > 0 ? <PdfPage file={pdf} page={s.page} /> : null}</div>
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
          <span className={full ? '' : 'clamp3'}>{s.good}</span>
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
              <span>{`没讲通 · 第${x.version}版：${x.line}`}</span>
            </summary>
            <Markdown text={x.text} />
          </details>
        ))}
      <div className="foot">
        <Codicon name="comment-discussion" size={13} />
        {`完整对话 · ${s.rounds}轮${failed ? ` · 没讲通${failed}版` : ''}`}
      </div>
    </>
  )
}

/** 折叠块：一行「›  标题 … 折着」，点开就地展开（只在白板上，不改文件） */
function Details({ title, body, full }: { title: string; body: string; full: boolean }) {
  const [open, setOpen] = useState(full)
  return (
    <>
      <button type="button" className="det" aria-expanded={open} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)}>
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span className="nm">{inline(title)}</span>
        {!open && <span className="r">折着</span>}
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
    const off = window.cn.onNoteChanged((p, t) => p === path && setText(t))
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
  const text = useNoteText(note.path)
  const name = titleOf(note.path)
  const where = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')).split('/').join(' / ') : '库'
  const body = text === null ? '' : firstPara(text, full)
  return (
    <>
      <Kh icon="file-text" right={where}>
        嵌入的笔记
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
        <span className="truncate">{src ? domainOf(src) : '剪藏'}</span>
        <span className="at">{when(Number.isFinite(at) ? at : note.createdMs)}</span>
      </div>
    </>
  )
}

/** 同一个值总是同一个颜色（和文档里的数据库表同一个算法），颜色收着 */
function toneOf(v: string): 'green' | 'yellow' | 'plain' {
  const tones = ['green', 'yellow', 'plain'] as const
  let h = 0
  for (const ch of v) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return tones[h % tones.length]!
}

const colName = (c: string) => (c === 'file.name' ? '名字' : c.replace(/^note\./, ''))

interface BaseData {
  rows: { name: string; props: Record<string, string> }[]
  total: number
}

/** 数据库：卡头「名字 · 表格 … N 条」，下面前 4 条的小表，底下「还有 N 条 … 整页打开」 */
function BaseCard({ src, full, acts }: { src: string; full: boolean; acts: CardActs }) {
  const spec = parseBase(src)
  const [data, setData] = useState<BaseData | null>(null)
  const key = JSON.stringify(spec)
  useEffect(() => {
    let live = true
    const load = async () => {
      if (!spec.folder) return setData({ rows: [], total: 0 })
      const files = (await window.cn.listNotes()).filter((f) => f.path.startsWith(spec.folder + '/') && /\.md$/i.test(f.path))
      const notes = await Promise.all(files.map(async (f) => ({ path: f.path, text: (await window.cn.readNote(f.path)).text })))
      const rows = baseRows(spec, notes)
      if (live) setData({ rows: rows.map((r) => ({ name: r.name, props: r.props })), total: rows.length })
    }
    void load()
    const again = () => void load()
    const off1 = window.cn.onFilesChanged(again)
    const off2 = window.cn.onNoteChanged((p) => spec.folder && p.startsWith(spec.folder + '/') && again())
    return () => ((live = false), off1(), off2())
  }, [key])
  const name = spec.folder ? spec.folder.split('/').pop()! : '数据库'
  const rows = data ? (full ? data.rows : data.rows.slice(0, 4)) : []
  const cols = spec.columns.length ? spec.columns : ['file.name']
  const types = cols.map((c) => (c === 'file.name' ? 'text' : colType((data?.rows ?? []).map((r) => r.props[c] ?? ''))))
  const cell = (r: BaseData['rows'][number], c: string, j: number): ReactNode => {
    const v = c === 'file.name' ? r.name : (r.props[c] ?? '')
    return v && types[j] === 'select' ? <span className={'db-tag ' + toneOf(v)}>{v}</span> : v
  }
  return (
    <>
      <Kh icon="database" right={data ? `${data.total}条` : ''}>
        <b>{name}</b>
        <span className="chip">
          <Codicon name="table" size={12} />
          {spec.view || '表格'}
        </span>
      </Kh>
      <MiniTable head={cols.map(colName)} rows={rows.map((r) => cols.map((c, j) => cell(r, c, j)))} cls={(j) => (types[j] === 'date' || types[j] === 'number' ? 'num' : undefined)} />
      <div className="foot">
        <span>{data && data.total > rows.length ? `还有${data.total - rows.length}条` : '每条是一篇 md'}</span>
        {!full && (
          <button type="button" className="r open" onMouseDown={(e) => e.stopPropagation()} onClick={acts.onFull}>
            <Codicon name="link-external" size={13} />
            整页打开
          </button>
        )}
      </div>
    </>
  )
}
