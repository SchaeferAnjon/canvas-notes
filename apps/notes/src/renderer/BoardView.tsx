import {
  appendBlock,
  attr,
  type BoardDoc,
  content,
  type Link,
  looseParagraphs,
  newBlock,
  newId,
  num,
  parseBoard,
  parseLinks,
  placeLoose,
  serializeBoard,
  withAttrs,
  withContent,
  withLinks,
  isMindmap,
} from '@cn/format'
import { onFlyToCard } from './shell/OutlineView'
import { Codicon, type CodiconName } from '@cn/design'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { CLIPS, previewOf, titleOf } from '../shared/layout'
import {
  addCard,
  addColumn,
  CARD_W,
  columnAt as columnIn,
  COL_W,
  dropOrigin,
  GRAB,
  movedEnough,
  PAL_SIZE,
  type PalKind,
  type Place,
  type Pt,
  putInColumn,
  type Rect,
  slotInColumn,
  TODO_BODY,
} from './board-drop'
import { CardBody, classify, TODO } from './CardBody'
import { openVideo } from './video/actions'
import { boardMomentStats } from './video/board'
import { momentsTitle, videoKeyOfCard, videoUrlOfCard } from './video/BoardCards'
import { useBoardImageDrop } from './web/useImageDrop'
import { openCapture } from './mindmap/capture-store'
import { MindmapLayer } from './mindmap/MindmapLayer'

type Drag =
  | { type: 'block'; id: string; start: Pt; origin: Pt; moved: boolean; delta: Pt }
  | { type: 'link'; from: string; to: Pt }
  | { type: 'loose'; key: string; text: string; inboxPath?: string; at: Pt; client: Pt }
  /** 从工具板按住拖出来的新东西；over：现在松手会落在画布上（不在工具板、浮层上，也不在画布外） */
  | { type: 'pal'; kind: PalKind; start: Pt; client: Pt; moved: boolean; over: boolean; map?: boolean }

const PAL: { kind: PalKind; label: string; title: string; icon: CodiconName }[] = [
  { kind: 'card', label: '卡片', title: '新卡片', icon: 'note' },
  { kind: 'todo', label: '待办', title: '待办', icon: 'checklist' },
  { kind: 'column', label: '列', title: '新的列', icon: 'split-horizontal' },
  { kind: 'board', label: '子白板', title: '子白板', icon: 'layout' },
]

export interface BoardViewProps {
  text: string
  /** 这块白板的文件：拖进来的图片按它算相对路径 */
  notePath: string
  notes: NoteFile[]
  scale: number
  readOnly: boolean
  onChange(text: string): void
  onUndo(): void
  onRedo(): void
  onOpen(path: string): void
  onCreateSubBoard(): Promise<string | null>
  onNotice(t: string): void
}

export function BoardView(props: BoardViewProps) {
  const { text, notes, scale } = props
  const doc = useMemo(() => parseBoard(text), [text])
  const links = useMemo(() => parseLinks(doc), [doc])
  /** 导图白板：正文里的列表画成导图（mindmap/MindmapLayer），列表和原照片不算「未整理」 */
  const mindmap = isMindmap(text)
  const loose = useMemo(() => looseParagraphs(doc).filter((l) => !mindmap || !(/^[-*+][ \t]/.test(l.text) || /^!\[[^\]]*\]\([^)]*\)$/.test(l.text.trim()))), [doc, mindmap])
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 })
  // 收件箱里的白板（刚拍的导图）不把自己算进自己的「未整理」
  const inbox = notes.filter((n) => n.kind === 'inbox' && n.path !== props.notePath).sort((a, b) => b.createdMs - a.createdMs)

  const wrap = useRef<HTMLDivElement>(null)
  const outer = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selLink, setSelLink] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  /** 双击的是待办里第几行（文件里的行号） */
  const editRow = useRef<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropCol, setDropCol] = useState<string | null>(null)
  const [unsortedOpen, setUnsortedOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  /** 展开了的「时刻」列 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const commit = useCallback(
    (next: BoardDoc) => {
      if (props.readOnly) return
      const out = serializeBoard(next)
      if (out !== text) props.onChange(out)
    },
    [props, text],
  )

  // 量每张卡和列在画布上的位置，连线和落点都靠它
  useLayoutEffect(() => {
    const p = plane.current
    if (!p) return
    const base = p.getBoundingClientRect()
    const next: Record<string, Rect> = {}
    for (const [id, el] of els.current) {
      if (!el.isConnected) continue
      const r = el.getBoundingClientRect()
      next[id] = { x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale }
    }
    if (JSON.stringify(next) !== JSON.stringify(rects)) setRects(next)
  })

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])

  const toPlane = (clientX: number, clientY: number): Pt => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale }
  }

  const idx = (id: string) => doc.blocks.findIndex((b) => attr(b, 'id') === id)
  const block = (id: string) => doc.blocks[idx(id)]

  /** 画布上看得到的左上角附近，给新东西找个位置 */
  const freeSpot = (): Pt => {
    const w = wrap.current!
    const n = doc.blocks.length
    return { x: Math.round(w.scrollLeft / scale + 60 + (n % 5) * 24), y: Math.round(w.scrollTop / scale + 60 + (n % 5) * 24) }
  }

  function addBlock(kind: 'card' | 'column', at: Pt, body: string) {
    const id = newId(doc)
    commit(kind === 'card' ? addCard(doc, id, body, { at }) : addColumn(doc, id, at))
    return id
  }

  // 拖进来 / 粘贴的图片：存好要等一会儿，那时候白板可能又改过，用最新的
  const latest = useRef(doc)
  latest.current = doc
  const imageDrop = useBoardImageDrop({
    notePath: props.notePath,
    readOnly: props.readOnly,
    toPlane,
    freeSpot,
    onNotice: props.onNotice,
    addCards(texts, at) {
      let next = latest.current
      let last = ''
      texts.forEach((t, i) => {
        last = newId(next)
        next = appendBlock(next, newBlock('card', { id: last, x: Math.round(at.x + i * 24), y: Math.round(at.y + i * 24), w: CARD_W }, t))
      })
      commit(next)
      setFlash(last)
    },
  })

  function removeBlocks(ids: Set<string>) {
    let next: BoardDoc = { ...doc, blocks: doc.blocks.filter((b) => !ids.has(attr(b, 'id') ?? '')) }
    // 列删了，列里的卡放回画布原处
    next = {
      ...next,
      blocks: next.blocks.map((b) => {
        const col = attr(b, 'in')
        if (!col || !ids.has(col)) return b
        const r = rects[attr(b, 'id') ?? '']
        return withAttrs(b, { in: undefined, x: Math.round(r?.x ?? 0), y: Math.round(r?.y ?? 0), w: CARD_W })
      }),
    }
    next = withLinks(next, parseLinks(next).filter((l) => !ids.has(l.from) && !ids.has(l.to)))
    commit(next)
  }

  function setContent(id: string, body: string) {
    const i = idx(id)
    if (i === -1) return
    if (body.trim() === '' && doc.blocks[i]!.kind === 'card') return removeBlocks(new Set([id]))
    commit({ ...doc, blocks: doc.blocks.map((b, j) => (j === i ? withContent(b, body) : b)) })
  }

  function setBlockAttrs(id: string, changes: Record<string, string | number | undefined>) {
    commit({ ...doc, blocks: doc.blocks.map((b) => (attr(b, 'id') === id ? withAttrs(b, changes) : b)) })
  }

  /** 工具板上的一样新东西：点一下放在 freeSpot，拖出来放在落点或某一列里（dropped：刚落下的加约 2 秒外圈） */
  async function createFromPal(kind: PalKind, where: Place, dropped: boolean) {
    if (kind === 'column') {
      addBlock('column', 'at' in where ? where.at : freeSpot(), '')
      return
    }
    if (kind === 'board') {
      const name = await props.onCreateSubBoard()
      if (!name) return
      // 起名的新标签已经开了，这中间白板可能又改过，用最新的
      const now = latest.current
      const id = newId(now)
      commit(addCard(now, id, `[[${name}]]`, where))
      if (dropped) setFlash(id)
      return
    }
    const id = newId(doc)
    commit(addCard(doc, id, kind === 'todo' ? TODO_BODY : '', where))
    if (kind === 'card' || kind === 'todo') {
      editRow.current = null
      setEditing(id)
    } else if (dropped) setFlash(id)
  }

  // ---------- 拖动 ----------

  function onBlockDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || editing === id || props.readOnly) return
    e.stopPropagation()
    outer.current?.focus({ preventScroll: true })
    setSelLink(null)
    if (e.shiftKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      })
      return
    }
    if (!selected.has(id)) setSelected(new Set([id]))
    const r = rects[id]
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ type: 'block', id, start: toPlane(e.clientX, e.clientY), origin: { x: r?.x ?? 0, y: r?.y ?? 0 }, moved: false, delta: { x: 0, y: 0 } })
  }

  const columnAt = (p: Pt, except?: string) => columnIn(doc, rects, p, except)

  /** 这一点是不是画布本身（不是工具板、未整理、AI 浮窗，也不在画布外） */
  function onCanvas(c: Pt): boolean {
    const el = document.elementFromPoint(c.x, c.y)
    return !!el && wrap.current!.contains(el)
  }

  /** 工具板按钮按下：移过 DRAG_SLOP 才算拖；没移就是点一下，照旧交给 onClick */
  const palDragged = useRef(false)
  function startPal(e: React.PointerEvent, kind: PalKind, map = false) {
    palDragged.current = false
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const c = { x: e.clientX, y: e.clientY }
    setDrag({ type: 'pal', kind, start: c, client: c, moved: false, over: false, map })
  }

  /** 拖完松手，浏览器还会在按钮上补一个 click，那一下不算点 */
  function swallowClick() {
    palDragged.current = true
    setTimeout(() => (palDragged.current = false), 0)
  }

  function cardAt(p: Pt): string | null {
    for (const b of [...doc.blocks].reverse()) {
      if (b.kind !== 'card') continue
      const id = attr(b, 'id')!
      const r = rects[id]
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return id
    }
    return null
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return
    if (drag.type === 'block') {
      const p = toPlane(e.clientX, e.clientY)
      const delta = { x: p.x - drag.start.x, y: p.y - drag.start.y }
      const moved = drag.moved || Math.abs(delta.x) + Math.abs(delta.y) > 3
      setDrag({ ...drag, delta, moved })
      const b = block(drag.id)
      setDropCol(moved && b?.kind === 'card' ? columnAt(p, drag.id) : null)
    } else if (drag.type === 'link') {
      setDrag({ ...drag, to: toPlane(e.clientX, e.clientY) })
    } else if (drag.type === 'pal') {
      const client = { x: e.clientX, y: e.clientY }
      const moved = drag.moved || movedEnough(drag.start, client)
      const over = moved && onCanvas(client)
      setDrag({ ...drag, client, moved, over })
      setDropCol(over && drag.kind !== 'column' ? columnAt(toPlane(client.x, client.y)) : null)
    } else {
      setDrag({ ...drag, at: toPlane(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY } })
    }
  }

  function onUp(e: React.PointerEvent) {
    if (!drag) return
    const p = toPlane(e.clientX, e.clientY)
    setDrag(null)
    setDropCol(null)
    if (drag.type === 'link') {
      const to = cardAt(p)
      if (to && to !== drag.from && !links.some((l) => l.from === drag.from && l.to === to)) commit(withLinks(doc, [...links, { from: drag.from, to }]))
      return
    }
    if (drag.type === 'pal') {
      if (!drag.moved) return
      swallowClick()
      if (!onCanvas({ x: e.clientX, y: e.clientY })) return
      // 列只放在画布上；卡片、待办、子白板落在列上就进那一列
      const col = drag.kind === 'column' ? null : columnAt(p)
      if (drag.map) {
        // 拍导图拖到白板上：拍好、做成导图白板后，落点放一张指向它的卡片
        const where: Place = col ? { column: col, slot: slotInColumn(doc, rects, col, p.y) } : { at: dropOrigin(p) }
        openCapture({
          onPlaced: (path) => {
            const now = latest.current
            const id = newId(now)
            commit(addCard(now, id, `[[${titleOf(path)}]]`, where))
            setFlash(id)
          },
        })
        return
      }
      void createFromPal(drag.kind, col ? { column: col, slot: slotInColumn(doc, rects, col, p.y) } : { at: dropOrigin(p) }, true)
      return
    }
    if (drag.type === 'loose') {
      const r = wrap.current!.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      void placeUnsorted(drag, p)
      return
    }
    if (!drag.moved) return
    const i = idx(drag.id)
    const b = doc.blocks[i]
    if (!b) return
    const x = Math.round(drag.origin.x + drag.delta.x)
    const y = Math.round(drag.origin.y + drag.delta.y)
    if (b.kind === 'column') return setBlockAttrs(drag.id, { x, y })
    const col = columnAt(p, drag.id)
    // 放进列：按落点的高低排在列里，文件里也挪到那个位置
    if (col) return commit(putInColumn(doc, i, col, slotInColumn(doc, rects, col, p.y, drag.id)))
    setBlockAttrs(drag.id, { in: undefined, x, y, w: attr(b, 'in') ? CARD_W : attr(b, 'w') })
  }

  async function placeUnsorted(d: Extract<Drag, { type: 'loose' }>, at: Pt) {
    const pos = { x: Math.round(at.x - 40), y: Math.round(at.y - 20) }
    if (!d.inboxPath) {
      const l = loose.find((x) => `loose:${x.from}` === d.key)
      if (l) commit(placeLoose(doc, l, { id: newId(doc), x: pos.x, y: pos.y, w: CARD_W }))
      return
    }
    const note = await window.cn.readNote(d.inboxPath)
    const body = note.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    if (isWholeDoc(note.text, body)) {
      // 整页剪藏这类长的：那篇挪到「素材/<这块白板>/」，白板上放一张指向它的卡片（标题、来源、几行摘要），双击看全文
      const moved = await window.cn.createNote(`${CLIPS}/${titleOf(props.notePath)}`, titleOf(d.inboxPath), note.text)
      await window.cn.trashNote(d.inboxPath)
      const id = addBlock('card', pos, `[[${titleOf(moved)}]]`)
      setFlash(id)
      return
    }
    // 收件箱里短的一条：内容放成卡片，收件箱那篇移到废纸篓
    const id = addBlock('card', pos, body)
    setFlash(id)
    await window.cn.trashNote(d.inboxPath)
  }

  // ---------- 键盘 ----------

  function onKey(e: React.KeyboardEvent) {
    if (drag?.type === 'pal' && e.key === 'Escape') {
      // 拖到一半按 esc：不放了，松手后的 click 也不算点
      palDragged.current = true
      setDrag(null)
      setDropCol(null)
      e.preventDefault()
      return
    }
    if (editing) return
    if ((e.key === 'Backspace' || e.key === 'Delete') && !props.readOnly) {
      if (selLink) {
        commit(withLinks(doc, links.filter((l) => `${l.from}>${l.to}` !== selLink)))
        setSelLink(null)
      } else if (selected.size) {
        removeBlocks(selected)
        setSelected(new Set())
      }
      e.preventDefault()
    } else if (e.metaKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) props.onRedo()
      else props.onUndo()
    } else if (e.key === 'Escape') {
      setSelected(new Set())
      setSelLink(null)
    }
  }

  // ---------- 画 ----------

  const free = doc.blocks.filter((b) => !attr(b, 'in') && attr(b, 'id'))
  const extent = free.reduce(
    (m, b) => ({ w: Math.max(m.w, num(b, 'x', 0) + num(b, 'w', CARD_W) + 600), h: Math.max(m.h, num(b, 'y', 0) + 900) }),
    { w: Math.max(2400, mapSize.w + 600), h: Math.max(1600, mapSize.h + 600) },
  )

  const dragOffset = (id: string) =>
    drag?.type === 'block' && drag.moved && drag.id === id
      ? { transform: `translate(${drag.delta.x}px, ${drag.delta.y}px)`, zIndex: 50 }
      : undefined

  const renderCard = (b: (typeof doc.blocks)[number], inColumn: boolean, small = false) => {
    const id = attr(b, 'id')!
    const body = content(b)
    const info = classify(body, notes)
    const isSel = selected.has(id)
    const style: React.CSSProperties = inColumn
      ? { ...dragOffset(id) }
      : { left: num(b, 'x', 0), top: num(b, 'y', 0), width: num(b, 'w', CARD_W), ...dragOffset(id) }
    return (
      <div
        key={id}
        ref={(el) => {
          if (el) els.current.set(id, el)
          else els.current.delete(id)
        }}
        className={`bcard k-${info.kind}${inColumn ? ' incol' : ''}${small ? ' small' : ''}${isSel ? ' sel' : ''}${flash === id ? ' flash' : ''}`}
        style={style}
        data-id={id}
        onPointerDown={(e) => onBlockDown(e, id)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (info.kind === 'board' && info.boardPath) props.onOpen(info.boardPath)
          else if (info.kind === 'doc' && info.docPath) props.onOpen(info.docPath)
          else if ((info.kind === 'video' || info.kind === 'moment') && videoUrlOfCard(body)) {
            // 视频卡：右栏打开，从上次看到的地方接着播；时刻卡：跳回那一秒
            const v = videoUrlOfCard(body)!
            void openVideo(v.url, v.resume)
          }
          else if (!props.readOnly) {
            // 双击待办的某一行：编辑器打开后光标落在那一行
            const row = (e.target as HTMLElement).closest('[data-row]')
            editRow.current = row ? Number(row.getAttribute('data-row')) : null
            setEditing(id)
          }
        }}
      >
        {editing === id && info.kind === 'todo' ? (
          <TodoEditor
            initial={body}
            focusLine={editRow.current}
            onDone={(v) => {
              setEditing(null)
              if (v !== null) setContent(id, v)
            }}
          />
        ) : editing === id ? (
          <CardEditor
            initial={body}
            onDone={(v) => {
              setEditing(null)
              if (v !== null) setContent(id, v)
              else if (body.trim() === '') removeBlocks(new Set([id]))
            }}
          />
        ) : (
          <CardBody
            text={body}
            info={info}
            notes={notes}
            notePath={props.notePath}
            small={small}
            videoStats={info.kind === 'video' ? boardMomentStats(text, videoKeyOfCard(body) ?? '') : undefined}
            onToggle={(line) => {
              const ls = body.split('\n')
              ls[line] = ls[line]!.replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'))
              setContent(id, ls.join('\n'))
            }}
          />
        )}
        {attr(b, 'ai') && editing !== id && <div className="aifoot">AI 总结的 · {attr(b, 'ai')}</div>}
        {!props.readOnly && editing !== id && (
          <span
            className="handle"
            title="拖到另一张卡上连线"
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              setDrag({ type: 'link', from: id, to: toPlane(e.clientX, e.clientY) })
            }}
          />
        )}
      </div>
    )
  }

  const unsortedCount = loose.length + inbox.length

  // 右栏大纲点了一张卡片或一列：滚到正中、选中，闪一下
  useEffect(
    () =>
      onFlyToCard(props.notePath, (id) => {
        const w = wrap.current
        const el = w?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
        if (!w || !el) return
        const wr = w.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        w.scrollTo({ left: w.scrollLeft + r.left - wr.left - (wr.width - r.width) / 2, top: w.scrollTop + r.top - wr.top - (wr.height - r.height) / 2, behavior: 'smooth' })
        setSelected(new Set([id]))
        el.classList.remove('flown')
        void el.offsetWidth
        el.classList.add('flown')
      }),
    [props.notePath],
  )

  return (
    <div
      className={'board' + (imageDrop.dropping ? ' dropping' : '')}
      ref={outer}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={onMove}
      onPointerUp={onUp}
      {...imageDrop.handlers}
      data-testid="board"
    >
    <div
      className="board-wrap"
      ref={wrap}
      onPointerDown={() => {
        setSelected(new Set())
        setSelLink(null)
        outer.current?.focus({ preventScroll: true })
      }}
      onDoubleClick={(e) => {
        if (props.readOnly || e.target !== plane.current) return
        const id = addBlock('card', toPlane(e.clientX, e.clientY), '')
        setEditing(id)
      }}
    >
      <div className="plane" ref={plane} style={{ width: extent.w, height: extent.h, transform: `scale(${scale})` }}>
        <svg className="wires" width={extent.w} height={extent.h}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--wire)" strokeWidth="1.4" />
            </marker>
            <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
            </marker>
          </defs>
          {links.map((l) => {
            const seg = wire(rects[l.from], rects[l.to])
            if (!seg) return null
            const key = `${l.from}>${l.to}`
            const on = selLink === key
            return (
              <g key={key} className={'wire' + (on ? ' on' : '')} data-link={key}>
                <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="hit" onPointerDown={(e) => (e.stopPropagation(), setSelLink(key), setSelected(new Set()), outer.current?.focus())} />
                <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} className="vis" markerEnd={on ? 'url(#arrow-sel)' : 'url(#arrow)'} />
              </g>
            )
          })}
          {drag?.type === 'link' && rects[drag.from] && (
            <line
              x1={rects[drag.from]!.x + rects[drag.from]!.w}
              y1={rects[drag.from]!.y + rects[drag.from]!.h / 2}
              x2={drag.to.x}
              y2={drag.to.y}
              className="vis pending"
            />
          )}
        </svg>

        {mindmap && (
          <MindmapLayer
            text={text}
            notePath={props.notePath}
            scale={scale}
            readOnly={props.readOnly}
            overlay={outer.current}
            onChange={props.onChange}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
            onSize={(w, h) => setMapSize((m) => (m.w === w && m.h === h ? m : { w, h }))}
            onNotice={props.onNotice}
          />
        )}

        {doc.blocks.map((b) => {
          const id = attr(b, 'id')
          if (!id || attr(b, 'in')) return null
          if (b.kind === 'card') return renderCard(b, false)
          const members = doc.blocks.filter((x) => attr(x, 'in') === id && x.kind === 'card')
          // 视频的「时刻」列：最新的在上面放大，最多摆 3 张，多的收成一行（偏好「别把上万条全铺开」）
          const moments = attr(b, 'moments')
          const open = expanded.has(id)
          const shown = moments && !open ? members.slice(0, 3) : members
          const videoTitle = moments ? momentsTitle(doc, moments) : ''
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) els.current.set(id, el)
                else els.current.delete(id)
              }}
              className={'bcol' + (selected.has(id) ? ' sel' : '') + (dropCol === id ? ' drop' : '')}
              style={{ left: num(b, 'x', 0), top: num(b, 'y', 0), width: num(b, 'w', COL_W), ...dragOffset(id) }}
              data-id={id}
            >
              <ColumnTitle
                title={attr(b, 'title') ?? '新的列'}
                count={members.length}
                sub={videoTitle}
                unit={moments ? '个' : '张卡片'}
                onDown={(e) => onBlockDown(e, id)}
                onRename={(t) => setBlockAttrs(id, { title: t })}
              />
              {shown.map((m, i) => renderCard(m, true, !!moments && i > 0))}
              {moments && members.length > 3 && (
                <button
                  type="button"
                  className="col-more"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setExpanded((x) => {
                      const n = new Set(x)
                      if (n.has(id)) n.delete(id)
                      else n.add(id)
                      return n
                    })
                  }
                >
                  {open ? '收起，只摆最近 3 个' : `还有 ${members.length - 3} 个，按时间排`}
                </button>
              )}
              {members.length === 0 && <div className="col-empty">把卡片拖进来</div>}
            </div>
          )
        })}
      </div>
    </div>

      {!props.readOnly && (
        <div className="bpal" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {PAL.map((it) => (
            <button
              key={it.kind}
              data-tip={`${it.title}：点一下，或按住拖到白板上`}
              data-side="right"
              onPointerDown={(e) => startPal(e, it.kind)}
              onClick={() => {
                if (palDragged.current) return
                void createFromPal(it.kind, { at: freeSpot() }, false)
              }}
            >
              <Codicon name={it.icon} size={16} />
              <span>{it.label}</span>
            </button>
          ))}
          <hr />
          <button
            data-tip="拍一张导图：点一下，或按住拖到白板上（做好后落点放一张指向它的卡片）"
            data-key="⇧⌘C"
            data-side="right"
            onPointerDown={(e) => startPal(e, 'board', true)}
            onClick={() => {
              if (palDragged.current) return
              openCapture()
            }}
          >
            <Codicon name="device-camera" size={16} />
            <span>拍导图</span>
          </button>
        </div>
      )}
      {drag?.type === 'pal' && drag.moved && outer.current && (
        <PalGhost kind={drag.kind} client={drag.client} over={drag.over} scale={scale} board={outer.current} />
      )}

      <div className={'unsorted' + (unsortedOpen ? ' open' : '')} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button className="h" onClick={() => setUnsortedOpen((v) => !v)} data-testid="unsorted">
          <b className="num">{unsortedCount}</b> 未整理
          <Codicon name="chevron-down" size={14} />
        </button>
        {unsortedOpen && (
          <div className="stack">
            {unsortedCount === 0 && <p className="hint">没有未整理的。</p>}
            {loose.map((l) => (
              <Mini key={`loose:${l.from}`} text={previewOf(l.text, 80)} sub="这篇里没放进卡片的段落" onDown={(e) => startLoose(e, { key: `loose:${l.from}`, text: l.text })} />
            ))}
            {inbox.map((n) => (
              <Mini key={n.path} text={n.preview || titleOf(n.path)} sub="收件箱" onDown={(e) => startLoose(e, { key: n.path, text: n.preview ?? '', inboxPath: n.path })} />
            ))}
          </div>
        )}
      </div>
      {drag?.type === 'loose' && (
        <div className="ghost" style={{ left: drag.client.x, top: drag.client.y }}>
          {previewOf(drag.text, 60)}
        </div>
      )}
    </div>
  )

  function startLoose(e: React.PointerEvent, d: { key: string; text: string; inboxPath?: string }) {
    if (props.readOnly) return
    e.stopPropagation()
    outer.current!.setPointerCapture(e.pointerId)
    setDrag({ type: 'loose', ...d, at: toPlane(e.clientX, e.clientY), client: { x: e.clientX, y: e.clientY } })
  }
}

/** 从工具板拖出来时跟着鼠标的半透明预览：样子和大小跟落下后差不多，跟着白板缩放；不在画布上（松手会取消）时更淡 */
function PalGhost(props: { kind: PalKind; client: Pt; over: boolean; scale: number; board: HTMLElement }) {
  const { kind, scale } = props
  const base = props.board.getBoundingClientRect()
  const size = PAL_SIZE[kind]
  const style: React.CSSProperties = {
    left: props.client.x - base.left - GRAB.x * scale,
    top: props.client.y - base.top - GRAB.y * scale,
    width: size.w,
    minHeight: size.h,
    transform: `scale(${scale})`,
  }
  const cls = 'pal-ghost' + (props.over ? '' : ' off')
  if (kind === 'column')
    return (
      <div className={cls + ' bcol'} style={style} data-testid="pal-ghost" data-kind={kind}>
        <h3>
          新的列
          <span className="meta num">0 张卡片</span>
        </h3>
        <div className="col-empty">把卡片拖进来</div>
      </div>
    )
  return (
    <div className={`${cls} bcard k-${kind === 'card' ? 'note' : kind}`} style={style} data-testid="pal-ghost" data-kind={kind}>
      {kind === 'card' && (
        <div className="cb-note">
          <p className="ph">新卡片</p>
        </div>
      )}
      {kind === 'todo' && <CardBody text={TODO_BODY} info={{ kind: 'todo' }} notes={[]} onToggle={() => {}} />}
      {kind === 'board' && (
        <div className="cb-board">
          <span className="sq" />
          <span>
            <b>子白板</b>
            <span className="meta num">0 张卡片</span>
          </span>
        </div>
      )}
    </div>
  )
}

function Mini(props: { text: string; sub: string; onDown(e: React.PointerEvent): void }) {
  return (
    <div className="mini" onPointerDown={props.onDown} title="拖到白板上">
      {props.text}
      <span>{props.sub}</span>
    </div>
  )
}

function ColumnTitle(props: { title: string; count: number; sub?: string; unit?: string; onDown(e: React.PointerEvent): void; onRename(t: string): void }) {
  const [edit, setEdit] = useState(false)
  if (edit)
    return (
      <input
        className="col-title-input"
        aria-label="列名"
        defaultValue={props.title}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setEdit(false)
          const t = e.currentTarget.value.trim()
          if (t && t !== props.title) props.onRename(t)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
          if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = props.title), e.currentTarget.blur())
        }}
      />
    )
  return (
    <h3 onPointerDown={props.onDown} onDoubleClick={(e) => (e.stopPropagation(), setEdit(true))}>
      {props.title}
      {props.sub && <span className="col-sub">{props.sub}</span>}
      <span className="meta num">
        {props.count} {props.unit ?? '张卡片'}
      </span>
    </h3>
  )
}

/** 整页剪藏（frontmatter 里有 source、正文有标题）或很长的一篇：不拆成卡片，放一张指向它的卡片 */
function isWholeDoc(text: string, body: string): boolean {
  return (/^---\n[\s\S]*?\nsource:/.test(text) && /^# /m.test(body)) || body.length > 800
}

/** 待办卡片的编辑：标题一行，下面每条一行勾选框加输入框；回车加一条，空着按退格删这条，esc 不改，点别处存 */
function TodoEditor(props: { initial: string; focusLine: number | null; onDone(v: string | null): void }) {
  const lines = props.initial.split('\n')
  const head = lines[0] && !TODO.test(lines[0]) ? lines[0].replace(/^#+\s*|\*\*/g, '').trim() : ''
  const [title, setTitle] = useState(head)
  const [rows, setRows] = useState(() => {
    const r = lines
      .map((l, i) => ({ m: TODO.exec(l), i }))
      .filter((x) => x.m)
      .map((x) => ({ key: x.i, done: x.m![1] !== ' ', text: x.m![2] ?? '' }))
    return r.length ? r : [{ key: 0, done: false, text: '' }]
  })
  const box = useRef<HTMLDivElement>(null)
  const focusAt = useRef<number | null>(null)
  const done = useRef(false)
  const nextKey = useRef(1000)
  const state = useRef({ title, rows })
  state.current = { title, rows }

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (!save) return props.onDone(null)
    const { title: t, rows: rs } = state.current
    const kept = rs.filter((r) => r.text.trim())
    const out = [t.trim() ? `**${t.trim()}**` : null, ...(kept.length ? kept : [{ done: false, text: '' }]).map((r) => `- [${r.done ? 'x' : ' '}] ${r.text.trim()}`)]
    props.onDone(out.filter((l) => l !== null).join('\n'))
  }

  useLayoutEffect(() => {
    const inputs = box.current!.querySelectorAll<HTMLInputElement>('input[type=text]')
    const at = props.focusLine === null ? -1 : rows.findIndex((r) => r.key === props.focusLine)
    const el = props.focusLine === 0 && head ? inputs[0] : inputs[at >= 0 ? at + 1 : inputs.length - 1]
    el?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (focusAt.current === null) return
    box.current!.querySelectorAll<HTMLInputElement>('input[type=text]')[focusAt.current + 1]?.focus()
    focusAt.current = null
  })

  const update = (i: number, p: Partial<{ done: boolean; text: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div
      ref={box}
      className="cb-todo todo-edit"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!box.current!.contains(e.relatedTarget as Node | null)) finish(true)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') (e.preventDefault(), finish(false))
        if (e.key === 'Enter' && e.metaKey) (e.preventDefault(), finish(true))
      }}
    >
      <input
        type="text"
        className="todo-title"
        aria-label="待办标题"
        placeholder="标题（可不写）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.nativeEvent.isComposing) (e.preventDefault(), (focusAt.current = 0), setRows((r) => [...r]))
        }}
      />
      {rows.map((r, i) => (
        <div key={r.key} className={'td' + (r.done ? ' done' : '')}>
          <input type="checkbox" aria-label="做完了" checked={r.done} onChange={() => update(i, { done: !r.done })} />
          <input
            type="text"
            aria-label="待办事项"
            placeholder="写一条，回车加下一条"
            value={r.text}
            onChange={(e) => update(i, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.metaKey) return
              if (e.key === 'Enter') {
                e.preventDefault()
                focusAt.current = i + 1
                setRows((rs) => [...rs.slice(0, i + 1), { key: nextKey.current++, done: false, text: '' }, ...rs.slice(i + 1)])
              } else if (e.key === 'Backspace' && r.text === '' && rows.length > 1) {
                e.preventDefault()
                focusAt.current = Math.max(0, i - 1)
                setRows((rs) => rs.filter((_, j) => j !== i))
              } else if (e.key === 'ArrowDown' && i < rows.length - 1) (e.preventDefault(), (focusAt.current = i + 1), setRows((rs) => [...rs]))
              else if (e.key === 'ArrowUp') (e.preventDefault(), (focusAt.current = i - 1), setRows((rs) => [...rs]))
            }}
          />
        </div>
      ))}
      <div className="todo-hint">回车加一条 · 空着按退格删掉 · ⌘回车或点别处存</div>
    </div>
  )
}

function CardEditor(props: { initial: string; onDone(v: string | null): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    props.onDone(v)
  }
  useLayoutEffect(() => {
    const t = ref.current!
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
    t.style.height = t.scrollHeight + 'px'
  }, [])
  return (
    <textarea
      ref={ref}
      className="card-edit"
      aria-label="卡片内容"
      defaultValue={props.initial}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => {
        const t = e.currentTarget
        t.style.height = 'auto'
        t.style.height = t.scrollHeight + 'px'
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') (e.preventDefault(), finish(null))
        if (e.key === 'Enter' && e.metaKey) (e.preventDefault(), finish(e.currentTarget.value))
      }}
    />
  )
}

/** 两张卡之间的线：从中心连中心，切掉卡片里面那段 */
function wire(a?: Rect, b?: Rect): [Pt, Pt] | null {
  if (!a || !b) return null
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  return [edge(a, ca, cb, 2), edge(b, cb, ca, 4)]
}

function edge(r: Rect, c: Pt, toward: Pt, gap: number): Pt {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const tx = dx === 0 ? Infinity : (r.w / 2 + gap) / Math.abs(dx)
  const ty = dy === 0 ? Infinity : (r.h / 2 + gap) / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

export type { Link }
