/**
 * 方向 A 的两个弹层（原型 proto.html#scene=a）：「和网页配成一对」（问整本书还是只这一页，默认整本书）、「对着看」的菜单
 * （在右栏打开、从头读、改成只配这一页 / 整本书、解除配对）。从标题下的提示、「对着看」、网页「⋯」、⌘K、右键都开这一处。
 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { bookPrefix, inBook, isWholeBook, pageHead, shortUrl, stripHash } from '../../shared/read-along'
import { titleOf } from '../../shared/layout'
import { MenuItem, Popover } from '../shell/Shell'
import { bookName, followNote, headOf, pairNote, readFromStart, rescopeNote, unpairNote } from './pairing'
import { pairOf, positionOf, type RightPage } from './store'
import './read-along.css'

type Open =
  | { kind: 'pair'; note: string; page: RightPage; anchor: HTMLElement | DOMRect; align: 'left' | 'right' }
  | { kind: 'chip'; note: string; anchor: HTMLElement }
  | null

let open: Open = null
const subs = new Set<() => void>()
const set = (o: Open) => {
  open = o
  for (const s of subs) s()
}

/** 「和网页配成一对」：贴着点它的那颗按钮（⌘K、右键里开时贴着窗口顶上居中的搜索框） */
export function openPairPop(note: string, page: RightPage, anchor: HTMLElement | DOMRect, align: 'left' | 'right' = 'right') {
  set({ kind: 'pair', note, page, anchor, align })
}

/** 「对着看」的菜单 */
export function openChipMenu(note: string, anchor: HTMLElement) {
  set({ kind: 'chip', note, anchor })
}

export function ReadAlongLayer() {
  const o = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => open,
  )
  if (!o) return null
  if (o.kind === 'pair') return <PairPop key={o.note + o.page.url} ask={o} onClose={() => set(null)} />
  return <ChipMenu key={o.note} note={o.note} anchor={o.anchor} onClose={() => set(null)} />
}

const short = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)

function PairPop(props: { ask: Extract<Open, { kind: 'pair' }>; onClose(): void }) {
  const { ask } = props
  const [whole, setWhole] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const site = new URL(ask.page.url).host
  const page = pageHead(ask.page.title, ask.page.url)
  // 贴着按钮下面 6，按 align 对齐；下面放不下就放上面
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = ask.anchor instanceof HTMLElement ? ask.anchor.getBoundingClientRect() : ask.anchor
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = ask.align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(innerWidth - w - 8, left))
    let top = r.bottom + 6
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6)
    setAt({ left, top })
  }, [ask])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (ask.anchor instanceof HTMLElement && ask.anchor.contains(e.target as Node)) return
      props.onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), props.onClose())
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [ask])
  const go = () => {
    props.onClose()
    void pairNote(ask.note, whole ? bookPrefix(ask.page.url) : stripHash(ask.page.url))
  }
  return createPortal(
    <div ref={ref} className="ra-pop" role="dialog" aria-label="和网页配成一对" style={at ?? { visibility: 'hidden' }} onKeyDown={(e) => e.key === 'Enter' && !(e.target as HTMLElement).closest('button') && go()}>
      <h4>和网页配成一对</h4>
      <div role="radiogroup" aria-label="配哪些网页">
        <button type="button" className={'ra-opt' + (whole ? ' on' : '')} role="radio" aria-checked={whole} onClick={() => setWhole(true)}>
          <span className="ra-rd" />
          <span>
            <span className="a">{`这本书：${site} 下的每一页`}</span>
            <span className="b">换章也算。记着读到哪一章、哪一段。</span>
          </span>
        </button>
        <button type="button" className={'ra-opt' + (whole ? '' : ' on')} role="radio" aria-checked={!whole} onClick={() => setWhole(false)}>
          <span className="ra-rd" />
          <span>
            <span className="a">{`只这一页：${page}`}</span>
            <span className="b">别的网址不算，只记这一页读到哪。</span>
          </span>
        </button>
      </div>
      <p className="ra-foot">写进这篇的属性「对着看」，跟着 Git 走；读到哪也记在库里，换一台 Mac 打开接着读。</p>
      <div className="ra-btns">
        <button type="button" className="btn btn-sm ra-26" onClick={props.onClose}>
          取消
        </button>
        <button type="button" className="btn btn-sm btn-primary ra-26" autoFocus onClick={go}>
          <Codicon name="link" size={13} />
          配成一对
        </button>
      </div>
    </div>,
    document.body,
  )
}

function ChipMenu(props: { note: string; anchor: HTMLElement; onClose(): void }) {
  const book = pairOf(props.note)
  useEffect(() => {
    props.anchor.classList.add('open')
    return () => props.anchor.classList.remove('open')
  }, [props.anchor])
  if (!book) return null
  const pos = positionOf(book)
  const whole = isWholeBook(book)
  const run = (f: () => unknown) => () => (props.onClose(), void f())
  return (
    <Popover anchor={props.anchor} label="对着看" className="pop12 ra-menu" gap={6} onClose={props.onClose}>
      <div role="menu" aria-label="对着看">
        <MenuItem icon="globe" label="在右栏打开" right={pos && inBook(book, pos.url) ? `读到 ${headOf(pos)}` : undefined} onClick={run(() => followNote(props.note, '打开了配对的网页'))} />
        <MenuItem icon="book" label="从头读" right={short(bookName(book), 12)} onClick={run(() => readFromStart(props.note))} />
        <div className="ms" />
        {whole ? (
          <MenuItem icon="file" label="改成只配这一页" right={pos ? short(pageHead(pos.title, pos.url), 12) : shortUrl(book)} onClick={run(() => rescopeNote(props.note, false))} />
        ) : (
          <MenuItem icon="book" label="改成整本书" right={new URL(book).host} onClick={run(() => rescopeNote(props.note, true))} />
        )}
        <MenuItem icon="close" label="解除配对" onClick={run(() => unpairNote(props.note))} />
      </div>
    </Popover>
  )
}

/** 网页「⋯」、⌘K、右键里那一项叫什么：这篇没配 →「和…配成一对…」，配了 →「解除…的配对」 */
export const unpairLabel = (note: string) => `解除和「${short(titleOf(note), 4)}」的配对`
