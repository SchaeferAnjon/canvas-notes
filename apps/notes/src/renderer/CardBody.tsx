import { Codicon } from '@cn/design'
import type { ReactNode } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { when } from './ListView'
import { imageSrc } from './md-widgets'
import { parseMoment, parseVideoCard, videoOf } from '../shared/video'
import { MomentCard, VideoCard } from './video/BoardCards'

/**
 * 卡片里的 md 显示成什么样。只认卡片里常见的写法，全部走 React 元素（不拼 HTML）。
 */

export type CardKind = 'note' | 'clip' | 'todo' | 'color' | 'image' | 'board' | 'doc' | 'link' | 'video' | 'moment'

export interface CardInfo {
  kind: CardKind
  source?: { title: string; url: string }
  boardPath?: string
  /** 只放了一个 [[双链]] 的卡片：指向的那篇（整页剪藏拖上白板就是这样） */
  docPath?: string
}

const SOURCE = /^(?:>\s*)?——\s*\[([^\]]+)\]\((\S+?)\)\s*$/
export const TODO = /^[-*] \[( |x|X)\](?: (.*))?$/
const COLOR = /^(#[0-9a-fA-F]{6})(?:\s+(.+))?$/
const IMAGE = /^!\[([^\]]*)\]\((\S+?)\)$/
const WIKI_ONLY = /^\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]$/
const URL_ONLY = /^(?:\[([^\]]+)\]\()?(https?:\/\/[^\s)]+)\)?$/

export function classify(text: string, notes: NoteFile[]): CardInfo {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  const one = lines.length === 1 ? lines[0]!.trim() : null
  // 视频：时刻卡（<!-- moment --> 开头）、视频卡（封面 + 标题链接 + 频道行，或者光秃秃一个 YouTube / B 站链接）
  if (parseMoment(text.trim())) return { kind: 'moment' }
  if (parseVideoCard(text) || (one && URL_ONLY.test(one) && videoOf(URL_ONLY.exec(one)![2]))) return { kind: 'video' }
  // 图片卡：一行图片，可以再跟一行来源（从网页拖来的）
  if (lines.length === 2 && IMAGE.test(lines[0]!.trim())) {
    const src = SOURCE.exec(lines[1]!.trim())
    if (src) return { kind: 'image', source: { title: src[1]!, url: src[2]! } }
  }
  if (one) {
    if (COLOR.test(one)) return { kind: 'color' }
    if (IMAGE.test(one)) return { kind: 'image' }
    const w = WIKI_ONLY.exec(one)
    if (w) {
      const target = w[1]!.trim().toLowerCase()
      const hit = notes.find((n) => n.board && titleOf(n.path).toLowerCase() === target)
      if (hit) return { kind: 'board', boardPath: hit.path }
      const doc = notes.find((n) => !n.board && titleOf(n.path).toLowerCase() === target)
      if (doc) return { kind: 'doc', docPath: doc.path }
    }
    if (URL_ONLY.test(one)) return { kind: 'link' }
  }
  const src = lines.map((l) => SOURCE.exec(l.trim())).find(Boolean)
  if (src && lines.some((l) => l.startsWith('>'))) return { kind: 'clip', source: { title: src[1]!, url: src[2]! } }
  if (lines.some((l) => TODO.test(l)) && lines.every((l, i) => TODO.test(l) || (i === 0 && !l.startsWith('-')))) return { kind: 'todo' }
  return { kind: 'note' }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function CardBody(props: {
  text: string
  info: CardInfo
  notes: NoteFile[]
  /** 卡片所在的笔记：图片的相对路径从它算起 */
  notePath?: string
  /** 视频卡底下那行：白板上这个视频有几个时刻、问过几次 */
  videoStats?: { moments: number; asked: number }
  /** 时刻卡：列里第二张起是小的 */
  small?: boolean
  onToggle(line: number): void
}) {
  const { text, info } = props
  const lines = text.split('\n')
  if (info.kind === 'video') return <VideoCard text={text} notePath={props.notePath ?? ''} stats={props.videoStats} />
  if (info.kind === 'moment') return <MomentCard text={text} notePath={props.notePath ?? ''} small={!!props.small} />

  if (info.kind === 'color') {
    const m = COLOR.exec(text.trim())!
    return (
      <div className="cb-color">
        <div className="sw" style={{ background: m[1] }} />
        <div className="nm">
          <b>{m[2] ?? '颜色'}</b>
          <span className="mono">{m[1]!.toUpperCase()}</span>
        </div>
      </div>
    )
  }
  if (info.kind === 'image') {
    const m = IMAGE.exec(lines.find((l) => l.trim())!.trim())!
    return (
      <figure className="cb-img">
        <img src={imageSrc(props.notePath ?? '', m[2]!)} alt={m[1]} draggable={false} />
        {m[1] && <figcaption>{m[1]}</figcaption>}
        {info.source && (
          <div className="src">
            <span className="fav"><Codicon name="globe" size={12} /></span>
            <span className="truncate">{info.source.title}</span>
          </div>
        )}
      </figure>
    )
  }
  if (info.kind === 'board') {
    const n = props.notes.find((x) => x.path === info.boardPath)!
    return (
      <div className="cb-board">
        <span className="sq" style={{ background: n.board!.color }} />
        <span>
          <b>{titleOf(n.path)}</b>
          <span className="meta num">{n.board!.cards} 张卡片</span>
        </span>
      </div>
    )
  }
  if (info.kind === 'doc') {
    const n = props.notes.find((x) => x.path === info.docPath)!
    const title = titleOf(n.path)
    // 摘要从正文开始：去掉开头重复的标题
    const summary = n.preview?.startsWith(title) ? n.preview.slice(title.length).trim() : n.preview
    return (
      <div className="cb-doc" title={n.source ? '双击看全文' : '双击打开'}>
        <b>{title}</b>
        {summary && <p>{summary}</p>}
        <div className="src">
          {n.source && (
            <span className="fav">
              <Codicon name="globe" size={12} />
            </span>
          )}
          <span className="truncate">{n.source ? domainOf(n.source) : n.path}</span>
          <span className="at mono">{when(n.createdMs)}</span>
        </div>
      </div>
    )
  }
  if (info.kind === 'link') {
    const m = URL_ONLY.exec(text.trim())!
    return (
      <div className="cb-link">
        <b>{m[1] ?? domainOf(m[2]!)}</b>
        <span className="meta">{domainOf(m[2]!)}</span>
      </div>
    )
  }
  if (info.kind === 'todo') {
    return (
      <div className="cb-todo">
        {lines.map((l, i) => {
          const m = TODO.exec(l)
          if (!m) return l.trim() ? <h4 key={i} data-row={i}>{inline(l.replace(/^#+\s*|\*\*/g, ''))}</h4> : null
          const done = m[1] !== ' '
          return (
            <label key={i} className={'td' + (done ? ' done' : '')} data-row={i}>
              <input
                type="checkbox"
                checked={done}
                onChange={() => props.onToggle(i)}
                onPointerDown={(e) => e.stopPropagation()}
              />
              <span>{inline(m[2] ?? '')}</span>
            </label>
          )
        })}
      </div>
    )
  }
  if (info.kind === 'clip') {
    const quote = lines.filter((l) => !SOURCE.test(l.trim()) && l.trim() !== '').map((l) => l.replace(/^>\s?/, ''))
    return (
      <>
        <div className="q">{paragraphs(quote)}</div>
        <div className="src">
          <span className="fav"><Codicon name="globe" size={12} /></span>
          <span className="truncate">{domainOf(info.source!.url)}</span>
        </div>
      </>
    )
  }
  return <div className="cb-note">{paragraphs(lines)}</div>
}

/** 按空行分段，# 开头的是小标题，> 开头的是引文 */
function paragraphs(lines: string[]): ReactNode[] {
  const out: ReactNode[] = []
  let buf: string[] = []
  const flush = () => {
    if (!buf.length) return
    const first = buf[0]!
    const k = out.length
    if (/^#{1,6}\s/.test(first)) out.push(<h4 key={k}>{inline(first.replace(/^#+\s*/, ''))}</h4>)
    else if (first.startsWith('>')) out.push(<blockquote key={k}>{join(buf.map((l) => l.replace(/^>\s?/, '')))}</blockquote>)
    else out.push(<p key={k}>{join(buf)}</p>)
    if (/^#{1,6}\s/.test(first) && buf.length > 1) out.push(<p key={k + 'b'}>{join(buf.slice(1))}</p>)
    buf = []
  }
  for (const l of lines) {
    if (l.trim() === '') flush()
    else buf.push(l)
  }
  flush()
  return out
}

function join(lines: string[]): ReactNode[] {
  return lines.flatMap((l, i) => (i ? [<br key={'br' + i} />, ...inline(l, i)] : inline(l, i)))
}

const INLINE = /(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\))/g

export function inline(s: string, keyBase: string | number = ''): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) out.push(s.slice(last, m.index))
    const t = m[0]
    const key = `${keyBase}-${m.index}`
    // 正文中间的图片只留说明文字：卡片里放大图会把卡片撑得很长
    if (t.startsWith('![')) out.push(<span key={key} className="img-alt">{t.slice(2, t.indexOf(']')) || '图片'}</span>)
    else if (t.startsWith('**')) out.push(<b key={key}>{t.slice(2, -2)}</b>)
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[[')) out.push(<span key={key} className="wl">{t.slice(2, -2).split('|').pop()}</span>)
    // 读 PDF 时 AI 回答里的「[第 4 页](#page=4)」：点了 PDF 翻过去（右栏 AI 接住点击）
    else if (/\]\(#page=\d+\)$/.test(t)) out.push(<a key={key} className="pg" data-page={/#page=(\d+)/.exec(t)![1]}>{t.slice(1, t.indexOf(']'))}</a>)
    else if (t.startsWith('[')) out.push(<u key={key}>{t.slice(1, t.indexOf(']'))}</u>)
    else out.push(<i key={key}>{t.slice(1, -1)}</i>)
    last = m.index! + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
