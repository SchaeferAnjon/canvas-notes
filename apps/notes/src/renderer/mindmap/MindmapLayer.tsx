/**
 * 导图白板上的导图：XMind 逻辑图那样从中心往右展开，原照片卡在左边。
 * 白板本身就是导图：正文里的嵌套列表（packages/format/src/mindmap.ts），排版自动（shared/mindmap-layout.ts）。
 * 刚做好的导图节点一个个长出来（中心 → 第一层 → 第二层，偏好「导图长出来的动画」）。
 * 选中节点时照片卡上框出它那一块；拿不准的节点点「?」对照照片改。
 * 键盘同 XMind：Tab 加子节点，回车加同级，⌫ 删，双击改字，空格收起；拖一个节点到另一个上 = 换父节点。
 */
import { Codicon } from '@cn/design'
import { breadthFirst, countNodes, insertAt, keyPath, moveTo, newNode, nodeAt, parseMindmap, pathKey, removeAt, setText, withMindmap, type MapNode } from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layoutMindmap, wirePath, type Level } from '../../shared/mindmap-layout'
import { imageSrc } from '../md-widgets'
import { takeGrow } from './capture-store'

const FONT: Record<Level, string> = { c: '600 15px', l1: '500 13px', l2: '400 13px' }
let ctx: CanvasRenderingContext2D | null = null
function measure(text: string, level: Level): number {
  ctx ??= document.createElement('canvas').getContext('2d')
  const fam = getComputedStyle(document.body).getPropertyValue('--sans').trim() || '-apple-system, "PingFang SC", sans-serif'
  ctx!.font = `${FONT[level]} ${fam}`
  return ctx!.measureText(text || ' ').width
}

/** 正文开头（列表前面）第一张图是原照片 */
function photoOf(before: string, notePath: string): { src: string; caption: string } | null {
  const m = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(before)
  return m ? { src: imageSrc(notePath, m[2]!), caption: m[1]! } : null
}

export interface MindmapLayerProps {
  text: string
  notePath: string
  scale: number
  readOnly: boolean
  /** 白板的外框（提示条、改字的小弹层挂在它上面，不跟着画布缩放） */
  overlay: HTMLElement | null
  onChange(text: string): void
  onUndo(): void
  onRedo(): void
  onSize(w: number, h: number): void
  onNotice(t: string): void
}

type Drag = { key: string; start: { x: number; y: number }; d: { x: number; y: number }; moved: boolean; over: string | null }

export function MindmapLayer(p: MindmapLayerProps) {
  const mdoc = useMemo(() => parseMindmap(p.text), [p.text])
  const roots = mdoc.roots
  const photo = useMemo(() => photoOf(mdoc.before, p.notePath), [mdoc.before, p.notePath])
  const [aspect, setAspect] = useState<number | null>(null)
  useEffect(() => {
    if (!photo) return
    const img = new Image()
    img.onload = () => img.naturalWidth && setAspect(img.naturalHeight / img.naturalWidth)
    img.src = photo.src
  }, [photo?.src])
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const L = useMemo(() => layoutMindmap(roots, measure, photo ? (aspect ?? 0.69) : null, folded), [roots, photo, aspect, folded])
  useEffect(() => p.onSize(L.w, L.h), [L.w, L.h])

  // ---------- 长出来 ----------
  const order = useMemo(() => breadthFirst(roots).map(pathKey), [roots])
  const [shown, setShown] = useState(() => (takeGrow(p.notePath) ? 0 : Infinity))
  const growing = shown !== Infinity && shown < order.length
  const [pill, setPill] = useState<'growing' | 'done' | null>(() => (shown === 0 ? 'growing' : null))
  useEffect(() => {
    if (!growing) return
    // 一个 0.23 秒；节点多时整张最多 6 秒
    const t = setTimeout(() => setShown((s) => s + 1), Math.min(230, 6000 / Math.max(1, order.length)))
    return () => clearTimeout(t)
  }, [growing, shown, order.length])
  // 最后一个长完以后就当普通导图画（再改节点时不重放动画）
  useEffect(() => {
    if (shown === Infinity || shown < order.length) return
    const t = setTimeout(() => setShown(Infinity), 300)
    return () => clearTimeout(t)
  }, [shown, order.length])
  useEffect(() => {
    if (pill === 'growing' && !growing) setPill('done')
    if (pill !== 'done') return
    const t = setTimeout(() => setPill(null), 6000)
    return () => clearTimeout(t)
  }, [pill, growing])
  const visible = (key: string) => shown === Infinity || order.indexOf(key) < shown

  // ---------- 选中、改 ----------
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fix, setFix] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])
  // 文件被别处改了，选中的节点没了就不选
  useEffect(() => {
    if (sel && !L.byKey[sel]) setSel(null)
  }, [L, sel])

  const commit = (next: MapNode[]) => {
    if (p.readOnly) return
    const out = withMindmap(p.text, next)
    if (out !== p.text) p.onChange(out)
  }
  const focusLayer = () => layer.current?.focus({ preventScroll: true })

  function add(kind: 'child' | 'sibling') {
    if (!sel) return
    const path = keyPath(sel)
    const node = nodeAt(roots, path)
    if (!node) return
    let parent: number[]
    let index: number
    if (kind === 'child' || path.length === 1) {
      parent = path
      index = node.children.length
      if (folded.has(sel)) setFolded((f) => new Set([...f].filter((k) => k !== sel)))
    } else {
      parent = path.slice(0, -1)
      index = path[path.length - 1]! + 1
    }
    commit(insertAt(roots, parent, index, newNode('新节点')))
    const key = pathKey([...parent, index])
    setSel(key)
    setEditing(key)
  }

  function remove() {
    if (!sel) return
    const path = keyPath(sel)
    if (path.length === 1 && roots.length === 1) return p.onNotice('中心不能删；整张不要了，把这块白板移到废纸篓')
    commit(removeAt(roots, path))
    setSel(path.length > 1 ? pathKey(path.slice(0, -1)) : null)
  }

  function onKey(e: React.KeyboardEvent) {
    if (editing) return
    e.stopPropagation()
    if (e.metaKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? p.onRedo() : p.onUndo()
    }
    if (!sel) return
    const path = keyPath(sel)
    const node = nodeAt(roots, path)
    if (!node) return
    const go = (k: number[]) => L.byKey[pathKey(k)] && setSel(pathKey(k))
    switch (e.key) {
      case 'Tab':
        e.preventDefault()
        if (!p.readOnly) add('child')
        break
      case 'Enter':
        e.preventDefault()
        if (!p.readOnly) add('sibling')
        break
      case 'Backspace':
      case 'Delete':
        e.preventDefault()
        if (!p.readOnly) remove()
        break
      case ' ':
        e.preventDefault()
        if (node.children.length) setFolded((f) => (f.has(sel) ? new Set([...f].filter((k) => k !== sel)) : new Set([...f, sel])))
        break
      case 'F2':
        e.preventDefault()
        if (!p.readOnly) setEditing(sel)
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (path.length > 1) go(path.slice(0, -1))
        break
      case 'ArrowRight':
        e.preventDefault()
        go([...path, 0])
        break
      case 'ArrowUp':
        e.preventDefault()
        go([...path.slice(0, -1), path[path.length - 1]! - 1])
        break
      case 'ArrowDown':
        e.preventDefault()
        go([...path.slice(0, -1), path[path.length - 1]! + 1])
        break
      case 'Escape':
        e.preventDefault()
        setSel(null)
        setFix(null)
        ;(p.overlay as HTMLElement | null)?.focus({ preventScroll: true })
        break
    }
  }

  // ---------- 拖一个节点到另一个上：换父节点 ----------
  const toPlane = (cx: number, cy: number) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: (cx - r.left) / p.scale, y: (cy - r.top) / p.scale }
  }
  const nodeAtPoint = (pt: { x: number; y: number }, except: string) =>
    L.nodes.find((n) => n.key !== except && !n.key.startsWith(except + '.') && pt.x >= n.x - 4 && pt.x <= n.x + n.w + 4 && pt.y >= n.y - 4 && pt.y <= n.y + n.h + 4)?.key ?? null

  function onNodeDown(e: React.PointerEvent, key: string) {
    if (e.button !== 0 || editing === key) return
    e.stopPropagation()
    setSel(key)
    if (fix && fix !== key) setFix(null)
    focusLayer()
    if (p.readOnly || keyPath(key).length === 1) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ key, start: toPlane(e.clientX, e.clientY), d: { x: 0, y: 0 }, moved: false, over: null })
  }
  function onNodeMove(e: React.PointerEvent) {
    if (!drag) return
    const pt = toPlane(e.clientX, e.clientY)
    const d = { x: pt.x - drag.start.x, y: pt.y - drag.start.y }
    const moved = drag.moved || Math.abs(d.x) + Math.abs(d.y) > 4
    setDrag({ ...drag, d, moved, over: moved ? nodeAtPoint(pt, drag.key) : null })
  }
  function onNodeUp() {
    if (!drag) return
    setDrag(null)
    if (!drag.moved || !drag.over) return
    const m = moveTo(roots, keyPath(drag.key), keyPath(drag.over))
    if (!m) return
    commit(m.roots)
    setSel(pathKey(m.path))
  }

  // ---------- 画 ----------
  const selBox = sel ? nodeAt(roots, keyPath(sel))?.box : undefined
  const ph = L.photo
  const photoImgH = ph ? ph.h - 34 : 0
  const counts = countNodes(roots)

  return (
    <div className="mm-layer" ref={layer} tabIndex={-1} onKeyDown={onKey} style={{ width: L.w, height: L.h }} data-testid="mindmap">
      <svg className="mm-wires" width={L.w} height={L.h}>
        {L.wires.map((w) => {
          const a = L.byKey[w.from]
          const b = L.byKey[w.to]
          if (!a || !b) return null
          return <path key={w.to} pathLength={1} className={visible(w.to) ? (shown === Infinity ? '' : 'grow') : 'hid'} d={wirePath(a, b)} />
        })}
      </svg>
      {photo && ph && (
        <figure className="mm-photocard" style={{ left: ph.x, top: ph.y, width: ph.w }} data-testid="map-photo" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ph" style={{ height: photoImgH }}>
            <img src={photo.src} alt={photo.caption} draggable={false} />
            {selBox && (
              <div
                className="hl"
                data-testid="photo-highlight"
                style={{ left: selBox[0] * ph.w - 3, top: selBox[1] * photoImgH - 3, width: selBox[2] * ph.w + 6, height: selBox[3] * photoImgH + 6 }}
              />
            )}
          </div>
          <figcaption>
            <Codicon name="device-camera" size={12} />
            {photo.caption}
          </figcaption>
        </figure>
      )}
      {L.nodes.map((b) => {
        const n = nodeAt(roots, keyPath(b.key))!
        const isDrag = drag?.moved && (drag.key === b.key || b.key.startsWith(drag.key + '.'))
        const kids = folded.has(b.key) ? countNodes(n.children).all : 0
        return (
          <div
            key={b.key}
            className={`mm-node ${b.level}${visible(b.key) ? (shown === Infinity ? '' : ' grow') : ' hid'}${sel === b.key ? ' sel' : ''}${n.unsure ? ' unsure' : ''}${flash === b.key ? ' flash' : ''}${drag?.over === b.key ? ' drop' : ''}${isDrag ? ' dragging' : ''}`}
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(isDrag ? { transform: `translate(${drag!.d.x}px, ${drag!.d.y}px)` } : {}) }}
            data-key={b.key}
            onPointerDown={(e) => onNodeDown(e, b.key)}
            onPointerMove={onNodeMove}
            onPointerUp={onNodeUp}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!p.readOnly) setEditing(b.key)
            }}
          >
            {editing === b.key ? (
              <NodeEditor
                initial={n.text}
                level={b.level}
                onDone={(v) => {
                  setEditing(null)
                  focusLayer()
                  if (v !== null && v.trim() && v.trim() !== n.text) commit(setText(roots, keyPath(b.key), v))
                }}
              />
            ) : (
              <span className="t">{n.text}</span>
            )}
            {n.unsure && editing !== b.key && (
              <button
                className="q"
                title="AI 拿不准，点一下对照照片改"
                aria-label="对照照片改"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setSel(b.key)
                  setFix(b.key)
                }}
              >
                ?
              </button>
            )}
            {kids > 0 && <span className="fold num">{kids}</span>}
          </div>
        )
      })}
      {p.overlay && pill && createPortal(<Pill kind={pill} total={counts.all} unsure={counts.unsure} shown={Math.min(shown, order.length)} inbox={/^收件箱\//.test(p.notePath)} onClose={() => setPill(null)} />, p.overlay)}
      {p.overlay && fix && L.byKey[fix] && layer.current && (
        <FixPop
          key={fix}
          overlay={p.overlay}
          anchor={layer.current.querySelector<HTMLElement>(`[data-key="${fix}"]`)}
          node={nodeAt(roots, keyPath(fix))!}
          onCancel={() => setFix(null)}
          onOk={(v) => {
            commit(setText(roots, keyPath(fix), v))
            setFix(null)
            setFlash(fix)
            focusLayer()
            p.onNotice('改好了 · 已保存')
          }}
        />
      )}
    </div>
  )
}

function Pill(props: { kind: 'growing' | 'done'; total: number; unsure: number; shown: number; inbox: boolean; onClose(): void }) {
  const where = props.inbox ? '放在收件箱' : '放好了'
  return (
    <div className="mm-pill" role="status" data-testid="map-pill">
      {props.kind === 'growing' ? (
        <>
          <span className="pd" />
          {`正在放上白板 · ${props.shown} / ${props.total}个`}
        </>
      ) : (
        <>
          <Codicon name="check" size={14} />
          {props.unsure ? (
            <span>
              {`放好了${props.total}个节点，`}<b className="yel">{`${props.unsure}个拿不准`}</b>，点「?」对照照片改 · {where}
            </span>
          ) : (
            <span>做好了，{where}{props.inbox ? ' · 今晚梦游时归类、起名' : ''}</span>
          )}
          <button className="btn btn-ghost" aria-label="关掉提示" onClick={props.onClose}>
            <Codicon name="close" size={12} />
          </button>
        </>
      )}
    </div>
  )
}

function NodeEditor(props: { initial: string; level: Level; onDone(v: string | null): void }) {
  const [v, setV] = useState(props.initial)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  const finish = (x: string | null) => {
    if (done.current) return
    done.current = true
    props.onDone(x)
  }
  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="mm-edit"
      aria-label="节点的字"
      value={v}
      style={{ width: Math.max(48, measure(v, props.level) + 14) }}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') (e.preventDefault(), finish(v))
        if (e.key === 'Escape') (e.preventDefault(), finish(null))
      }}
    />
  )
}

/** 拿不准的节点：照片上框出这一块，对着改；AI 猜的几种写法点一下就填上 */
function FixPop(props: { overlay: HTMLElement; anchor: HTMLElement | null; node: MapNode; onCancel(): void; onOk(v: string): void }) {
  const [v, setV] = useState(props.node.text)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const o = props.overlay.getBoundingClientRect()
    const a = props.anchor?.getBoundingClientRect()
    if (!a) return
    const left = Math.max(12, Math.min(a.left - o.left - 20, o.width - 312))
    let top = a.bottom - o.top + 12
    if (top > o.height - 200) top = Math.max(12, a.top - o.top - 200)
    setPos({ left, top })
    input.current?.focus()
    input.current?.select()
  }, [])
  const guesses = [...new Set([...(props.node.guesses ?? []), props.node.text])].slice(0, 3)
  return createPortal(
    <div className="mm-fix" role="dialog" aria-label="照片上这块写的是？" style={pos ?? { visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()}>
      <h4>照片上这块写的是？</h4>
      <p className="help">左边照片上框出来的就是这一块。字写得潦草，AI读成了「{props.node.text}」。</p>
      <input
        ref={input}
        aria-label="改成"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && v.trim()) (e.preventDefault(), props.onOk(v))
          if (e.key === 'Escape') (e.preventDefault(), props.onCancel())
        }}
      />
      <div className="guess">
        <span className="help">AI猜：</span>
        {guesses.map((g) => (
          <button key={g} className="chip" onClick={() => setV(g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="act">
        <button className="btn btn-ghost btn-sm" onClick={props.onCancel}>
          取消
        </button>
        <button className="btn btn-primary btn-sm" disabled={!v.trim()} onClick={() => props.onOk(v)}>
          改好了<span className="kbd-in">↵</span>
        </button>
      </div>
    </div>,
    props.overlay,
  )
}
