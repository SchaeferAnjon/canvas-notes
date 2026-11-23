/**
 * 主题里画的东西（第二批）：挂的图在字上面、字里的链接只露名字（强调色加下划线，点了打开，⌘ 点右栏）、
 * 在导图里找到的字铺强调色淡底、有备注的字后面一个备注小图标（点了打开备注，⇧⌘N 同）。
 * 链接卡：指着链接停 0.3 秒出一张，和文档里的链接卡一个样子（.lk-card），一次只出这一个：打开 / 右栏打开 ⌘点 · 拷贝 · 改链接 · 去掉链接。
 */
import { Codicon } from '@cn/design'
import { type MapNode, type MapSeg, mapSegments } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { app } from '../ctx/actions'
import { openLinkHit } from '../ctx/editor-menu'
import { copy } from '../ctx/menu'
import { Popover } from '../editor-host'
import { useT } from '../i18n'
import { keyFor, useKeys } from '../keys'
import { prettyUrl } from '../md-link'
import { imageSrc } from '../md-widgets'
import { Favicon } from '../web/favicons'
import { useVaultFiles } from '../files/store'
import { when } from '../../shared/when'

/** 字里找到的那几处铺淡底 */
function Marked(props: { text: string; q: string }) {
  const q = props.q.trim().toLowerCase()
  if (!q) return <>{props.text}</>
  const out: React.ReactNode[] = []
  const lo = props.text.toLowerCase()
  let i = 0
  for (let j = lo.indexOf(q); j !== -1; j = lo.indexOf(q, i)) {
    if (j > i) out.push(props.text.slice(i, j))
    out.push(<mark key={j}>{props.text.slice(j, j + q.length)}</mark>)
    i = j + q.length
  }
  out.push(props.text.slice(i))
  return <>{out}</>
}

export function NodeBody(props: {
  node: MapNode
  notePath: string
  img?: { w: number; h: number }
  query: string
  /** 当前那一处是在这个主题的备注里找到的：备注小图标亮着 */
  noteOn: boolean
  onNote(): void
  onLink(seg: MapSeg, e: React.MouseEvent): void
  onLinkHover(seg: MapSeg | null, el: HTMLElement | null): void
  /** 选中时图右下角的小方块：按下开始拖着改宽 */
  onImgResize?: (e: React.PointerEvent) => void
}) {
  const t = useT()
  const K = useKeys()
  const segs = mapSegments(props.node.text)
  const text = (
    <span className="t">
      {segs.map((s, i) =>
        s.wiki !== undefined || s.url !== undefined ? (
          <span
            key={i}
            className="lk"
            data-testid="map-link"
            onClick={(e) => props.onLink(s, e)}
            onMouseEnter={(e) => props.onLinkHover(s, e.currentTarget)}
            onMouseLeave={() => props.onLinkHover(null, null)}
          >
            <Marked text={s.text} q={props.query} />
          </span>
        ) : (
          <Marked key={i} text={s.text} q={props.query} />
        ),
      )}
    </span>
  )
  const note = props.node.note ? (
    <button
      type="button"
      tabIndex={-1}
      className={'ni' + (props.noteOn ? ' on' : '')}
      aria-label={t('备注')}
      data-tip={t('备注')}
      data-key={K('mm-note') ?? undefined}
      data-side="below"
      data-testid="map-note-icon"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        props.onNote()
      }}
    >
      <Codicon name="note" size={12} />
    </button>
  ) : null
  if (!props.node.img || !props.img) {
    return (
      <>
        {text}
        {note}
      </>
    )
  }
  return (
    <>
      <span className="mm-imgw" style={{ width: props.img.w, height: props.img.h }}>
        <img className="mi" src={imageSrc(props.notePath, props.node.img.src)} alt={props.node.img.alt} draggable={false} data-testid="map-topic-img" />
        {props.onImgResize && <span className="mm-imgh" data-testid="map-img-resize" data-tip={t('拖着改大小')} data-side="below" onPointerDown={props.onImgResize} />}
      </span>
      <span className="tx">
        {text}
        {note}
      </span>
    </>
  )
}

/** 链接点了：双链开那一篇（中间新标签）；网址 ⌘ 点在右栏网页开，不按 ⌘ 照文档里链接的规矩开 */
export function openMapLink(notePath: string, seg: MapSeg, cmd: boolean) {
  if (seg.wiki !== undefined) return app().openWikilink(seg.wiki)
  if (seg.url === undefined) return
  if (cmd && /^https?:/i.test(seg.url)) return app().openInWeb(seg.url, seg.url)
  openLinkHit(notePath, seg.url, seg.text, false)
}

let pop: Popover | null = null
function popover(): Popover {
  pop ??= new Popover('lk-card-host mm-lk-host')
  return pop
}

/**
 * 链接卡（挂在 body 上，和文档里那张同一个样子）：show 时给链接的位置；鼠标进卡里不收，离开 0.22 秒收。
 * onEdit(新的目标)：改链接；onUnlink：去掉链接只留字。只读时这两样不出。
 */
export function useMapLinkCard(notePath: string, readOnly: boolean, onEdit: (seg: MapSeg, to: string) => void, onUnlink: (seg: MapSeg) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editing = useRef(false)
  const cb = useRef({ onEdit, onUnlink })
  cb.current = { onEdit, onUnlink }
  const hide = () => {
    clearTimeout(timer.current)
    clearTimeout(leave.current)
    editing.current = false
    pop?.hide()
  }
  useEffect(() => {
    const p = popover()
    const enter = () => clearTimeout(leave.current)
    const out = () => (leave.current = setTimeout(() => !editing.current && hide(), 220))
    const down = (e: PointerEvent) => p.open && !p.el.contains(e.target as Node) && hide()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && p.open && !editing.current && hide()
    p.el.addEventListener('mouseenter', enter)
    p.el.addEventListener('mouseleave', out)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      p.el.removeEventListener('mouseenter', enter)
      p.el.removeEventListener('mouseleave', out)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      hide()
    }
  }, [])
  return {
    hover(seg: MapSeg | null, el: HTMLElement | null) {
      clearTimeout(timer.current)
      if (!seg || !el) {
        if (pop?.open && !editing.current) leave.current = setTimeout(() => !editing.current && hide(), 220)
        return
      }
      clearTimeout(leave.current)
      timer.current = setTimeout(() => {
        if (!el.isConnected) return
        const r = el.getBoundingClientRect()
        popover().show(
          <MapLinkCard
            key={`${seg.from}:${seg.wiki ?? seg.url}`}
            seg={seg}
            notePath={notePath}
            readOnly={readOnly}
            onEditing={(v) => (editing.current = v)}
            onEdit={(to) => (hide(), cb.current.onEdit(seg, to))}
            onUnlink={() => (hide(), cb.current.onUnlink(seg))}
            onOpen={(cmd) => (hide(), openMapLink(notePath, seg, cmd))}
          />,
          { left: r.left, top: r.top, bottom: r.bottom },
        )
      }, 300)
    },
    hide,
  }
}

function MapLinkCard(props: { seg: MapSeg; notePath: string; readOnly: boolean; onEditing(v: boolean): void; onEdit(to: string): void; onUnlink(): void; onOpen(cmd: boolean): void }) {
  const t = useT()
  const { seg } = props
  const web = seg.url !== undefined && /^https?:/i.test(seg.url)
  const target = seg.wiki ?? seg.url ?? ''
  const [edit, setEdit] = useState(false)
  const [copied, setCopied] = useState(false)
  // 双链：第二行写这一篇在哪个文件夹、什么时候改的（和标题不重复；designer 复审提的）
  const { files } = useVaultFiles()
  const hit = seg.wiki !== undefined ? files.find((f) => f.kind === 'md' && (f.path === seg.wiki + '.md' || f.path.split('/').pop() === seg.wiki + '.md')) : undefined
  const where = hit
    ? [hit.path.split('/').slice(0, -1).join(' / ') || t('库的根目录'), t('改于{when}', { when: when(hit.mtimeMs) })].join(' · ')
    : seg.wiki !== undefined
      ? t('库里还没有这一篇')
      : ''
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    props.onEditing(edit)
    if (edit) {
      input.current?.focus()
      input.current?.select()
    }
  }, [edit])
  return (
    <div className="lk-card mm-lk" role="dialog" aria-label={t('链接')} data-testid="map-link-card">
      <div className="top">
        {web ? <Favicon url={seg.url!} size={14} /> : <Codicon name={seg.wiki !== undefined ? 'file' : 'link'} size={14} />}
        <b>{seg.text || target}</b>
      </div>
      <div className="u" title={target}>
        {edit ? (
          <input
            ref={input}
            aria-label={seg.wiki !== undefined ? t('链到哪一篇') : t('链接的网址')}
            defaultValue={target}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') (e.preventDefault(), props.onEdit(e.currentTarget.value.trim()))
              if (e.key === 'Escape') (e.preventDefault(), setEdit(false))
            }}
          />
        ) : web ? (
          prettyUrl(seg.url!)
        ) : (
          where || target
        )}
      </div>
      <div className="acts">
        {web ? (
          <button onClick={() => props.onOpen(true)}>
            <Codicon name="layout-sidebar-right" size={13} />
            {t('右栏打开')} <span className="k">{keyFor('cmd-click')}</span>
          </button>
        ) : (
          <button onClick={() => props.onOpen(false)}>
            <Codicon name="go-to-file" size={13} />
            {t('打开')}
          </button>
        )}
        {web && (
          <button onClick={() => void copy(seg.url!).then(() => setCopied(true))}>
            <Codicon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? t('已拷贝') : t('拷贝')}
          </button>
        )}
        {!props.readOnly && (
          <button onClick={() => setEdit(true)}>
            <Codicon name="edit" size={13} />
            {t('改链接')}
          </button>
        )}
        {!props.readOnly && (
          <button onClick={props.onUnlink}>
            <Codicon name="close" size={13} />
            {t('去掉链接')}
          </button>
        )}
      </div>
    </div>
  )
}

/** 改链接：双链换目标（有别名的留着别名），网址换网址 */
export function relinkText(text: string, seg: MapSeg, to: string): string {
  if (!to) return text
  const raw = text.slice(seg.from, seg.to)
  let next = raw
  if (seg.wiki !== undefined) {
    const inner = raw.slice(2, -2)
    const bar = inner.indexOf('|')
    next = `[[${to.replace(/[[\]|\n]/g, ' ')}${bar === -1 ? '' : inner.slice(bar)}]]`
  } else next = `[${seg.text}](${to.replace(/[()\s]/g, encodeURIComponent)})`
  return text.slice(0, seg.from) + next + text.slice(seg.to)
}

/** 去掉链接：只留露出来的字 */
export const unlinkText = (text: string, seg: MapSeg): string => text.slice(0, seg.from) + seg.text + text.slice(seg.to)
