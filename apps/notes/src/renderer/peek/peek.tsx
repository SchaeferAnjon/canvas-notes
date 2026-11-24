/**
 * 按住 ⌘ 悬停弹出那一篇（task-hqula，照 Obsidian 的页面预览）。用户：「文章里面的链接 能不能也做成 Obsidian 那样
 * 按住 Command 把鼠标滑上去的时候 另一篇文章就会弹出来?」
 *
 * - 按住 ⌘ 停在链接上（或先停着再按 ⌘）：弹出一个浮窗，里面是整篇，用文档同一套实时预览画（标题、提示块、图片、公式、AI 块），只读、能滚；
 *   链到某几行、某个标题、某个块的滚到那里，那几行左边一道强调色竖线 + 淡底（同 ⌘点打开时闪的那道）。
 *   白板卡弹那块白板（列和卡）转到那张卡；PDF 页码弹那一页（框画出来）；网页弹网址和那几个字；库里没有的照实说。
 * - 浮窗里的链接再 ⌘ 悬停套一层（最多 MAX_DEPTH 层）；鼠标移开链接和浮窗、或松开 ⌘ 后 CLOSE_MS 收起，鼠标在浮窗里不收；Esc 收最上面一层。
 * - 认链接、开法全用 cite.tsx 的（findCite / pageCite / openCite）：点一下出预览卡、⌘点打开、⇧⌘点开在后面照旧，⌘ 悬停弹出后再 ⌘点 = 打开。
 * - 哪里的链接都认：AI 回答、旁支、讲解卡、白板卡里的 a.cite；读 PDF 的「第 N 页」；文档编辑器和只读文档（梦游对照、浮窗自己）里的
 *   .cm-wikilink / .cm-link；别处标了 data-peek-href / data-peek-wiki 的（数据库格子、读 PDF 笔记里的双链）。
 * 笔记读一次记着（按修改时间，开着的那篇用编辑器里的字）；几千行的也不卡：浮窗里是 CodeMirror，只画看得见的那一截。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { anchorLines, type CiteAnchor, pageLinkOf, splitDoc, unitId } from '@cn/format'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension, Facet, Prec, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { CommitInfo } from '../../shared/api'
import { t } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { parseFragment } from '../../shared/web-link'
import { blockGaps } from '../block-gaps'
import { type BranchFiles, citeClicks, findCite, type Found, hideCiteCard, openCite, pageCite, pageOfOpenPdf } from '../cite'
import { app } from '../ctx/actions'
import { linkAt } from '../ctx/editor-menu'
import { usePdfPage } from '../doc-board/pdf-page'
import { blocksField, editorHost } from '../editor-host'
import { keyFor } from '../keys'
import { hideLinkCard } from '../link-card'
import { livePreview } from '../live-preview'
import { Markdown } from '../md-render'
import { prettyUrl } from '../md-link'
import { mdWidgets } from '../md-widgets'
import { propsBlock, showPropsTable } from '../mindmap/props-block'
import { NoteDoc } from '../note-doc'
import { Favicon } from '../web/favicons'
import './peek.css'

/** 停在链接上多久弹（按着 ⌘ 扫过一串链接时不一路弹） */
const OPEN_MS = 120
/** 移开、松开 ⌘ 后多久收（这段时间里移进浮窗就不收） */
const CLOSE_MS = 300
/** 最多套几层 */
const MAX_DEPTH = 6
const W = 520
const H = 460
const EDGE = 8
const GAP = 6

/** 只读文档里链接指着梦游分支上才有的文件时开那一份（梦游对照登记，和 citeClicks 的 branch 一样） */
export const peekBranch = Facet.define<() => BranchFiles, (() => BranchFiles) | null>({ combine: (v) => v[0] ?? null })

/** 指着的一个链接：el 是浮窗贴着的那个元素；key 认「还是不是同一个」；from：文档里的照文档的开法（右栏 AI 跟着换），别处照引用的 */
type Link = { el: HTMLElement; key: string; label: string; from: 'cite' | 'doc'; resolve(): Promise<Found> }
type Layer = { el: HTMLDivElement; root: Root; src: HTMLElement; key: string }

// ---------- 读一次记着 ----------

const texts = new Map<string, { mtime: number; text: Promise<string> }>()

/** 一篇笔记的字：开着的用编辑器里的（还没存的也算），别的按修改时间记着，改了再读 */
async function noteText(path: string): Promise<string> {
  const live = [...NoteDoc.open].find((d) => d.path === path)
  if (live) return live.text
  const mtime = (await window.cnFiles.all()).find((f) => f.path === path)?.mtimeMs ?? 0
  const have = texts.get(path)
  if (have && have.mtime === mtime) return have.text
  const text = window.cn.readNote(path).then((n) => n.text)
  text.catch(() => texts.delete(path))
  texts.set(path, { mtime, text })
  return text
}

/** 梦游分支上那一份（那次提交里的） */
const branchText = (path: string, rev: string) => window.cn.diffFiles({ kind: 'version', hash: rev, path }).then((r) => r.files[0]?.after ?? '')

// ---------- 认指着的是哪个链接 ----------

const ids = new WeakMap<object, number>()
let nextId = 0
const idOf = (o: object) => {
  let n = ids.get(o)
  if (n === undefined) ids.set(o, (n = ++nextId))
  return n
}
const baseOf = (el: Element) => el.closest<HTMLElement>('[data-cite-base]')?.dataset.citeBase ?? ''
const textOf = (el: Element) => el.textContent ?? ''

function linkUnder(at: Element | null): Link | null {
  if (!at?.closest) return null
  const cite = at.closest<HTMLElement>('a.cite')
  if (cite) {
    const link = { href: cite.dataset.href, wiki: cite.dataset.wiki, label: textOf(cite) }
    const base = baseOf(cite)
    return { el: cite, key: 'e' + idOf(cite), label: link.label, from: 'cite', resolve: () => findCite(link, base) }
  }
  // 光写页码的「第 4 页」：读 PDF 的 AI 回答、读 PDF 的笔记里是开着的那份；白板卡里按这块白板的来源、前后的页码链接找
  const pg = at.closest<HTMLElement>('a.pg[data-page]')
  if (pg) {
    const page = Number(pg.dataset.page)
    const label = textOf(pg)
    const pdf = pg.closest<HTMLElement>('[data-cite-pdf]')?.dataset.citePdf ?? pg.closest<HTMLElement>('[data-peek-pdf]')?.dataset.peekPdf
    if (pdf) return { el: pg, key: 'e' + idOf(pg), label, from: 'cite', resolve: () => pageOfOpenPdf(pdf, page, pg.dataset.text) }
    const card = pg.closest<HTMLElement>('[data-from]')
    const note = baseOf(pg)
    if (!card || !note) return null
    const href = pg.dataset.href ?? `#page=${page}`
    return { el: pg, key: 'e' + idOf(pg), label, from: 'cite', resolve: async () => pageCite(note, href, await noteText(note), Number(card.dataset.from), label) }
  }
  const mark = at.closest<HTMLElement>('[data-peek-href], [data-peek-wiki]')
  if (mark) {
    const link = { href: mark.dataset.peekHref, wiki: mark.dataset.peekWiki, label: textOf(mark) }
    const base = baseOf(mark)
    return { el: mark, key: 'e' + idOf(mark), label: link.label, from: 'cite', resolve: () => findCite(link, base) }
  }
  const ed = at.closest<HTMLElement>('.cm-editor')
  return ed ? editorLink(ed, at) : null
}

/** 编辑器（文档、梦游对照、浮窗里）的双链和 [字](链接)：相对这一篇认，和 ⌘点一样 */
function editorLink(ed: HTMLElement, at: Element): Link | null {
  const view = EditorView.findFromDOM(ed)
  if (!view) return null
  const base = view.state.facet(editorHost).path()
  const branch = view.state.facet(peekBranch)
  const vid = idOf(view)
  const wiki = at.closest<HTMLElement>('.cm-wikilink')
  if (wiki) {
    const w = wiki.dataset.wiki ?? ''
    const line = view.state.doc.lineAt(view.posAtDOM(wiki, 0))
    return { el: wiki, key: `cm${vid}:${line.from}:${w}`, label: wiki.dataset.target ?? textOf(wiki), from: 'doc', resolve: () => findCite({ wiki: w }, base, branch?.()) }
  }
  const el = at.closest<HTMLElement>('.cm-link')
  if (!el) return null
  const pos = view.posAtDOM(el, 0)
  const line = view.state.doc.lineAt(pos)
  const hit = linkAt(line.text, pos - line.from)
  if (!hit || hit.kind === 'image') return null
  if (hit.kind === 'wiki') return { el, key: `cm${vid}:${line.from}:${hit.target}`, label: hit.target, from: 'doc', resolve: () => findCite({ wiki: hit.target }, base, branch?.()) }
  const { url, text } = hit
  return {
    el,
    key: `cm${vid}:${line.from}:${url}`,
    label: text,
    from: 'doc',
    resolve: () => (pageLinkOf(base, url) ? pageCite(base, url, view.state.doc.toString(), pos, text) : findCite({ href: url, label: text }, base, branch?.())),
  }
}

// ---------- 几层浮窗 ----------

const layers: Layer[] = []
let meta = false
let px = -1
let py = -1
let openT: ReturnType<typeof setTimeout> | undefined
let openKey = ''
let closeT: ReturnType<typeof setTimeout> | undefined
let token = 0

const under = () => (px < 0 ? null : document.elementFromPoint(px, py))
/** n 在第几层浮窗里（最里面那层），不在浮窗里是 -1 */
const depthOf = (n: Node | null) => layers.findLastIndex((l) => !!n && l.el.contains(n))
/** n 是第几层的那个链接 */
const srcOf = (n: Node | null) => layers.findLastIndex((l) => !!n && l.src.contains(n))
/** 预览卡、链接卡（浮窗里点出来的）：在它上面时浮窗都留着 */
const onCard = (n: Element | null) => !!n?.closest?.('.lk-card-host')

/** 鼠标在 at 时留几层：它在的那层和下面的；按着 ⌘ 还停在某层的链接上，那层也留 */
function keepCount(at: Element | null): number {
  if (onCard(at)) return layers.length
  return Math.max(depthOf(at), meta ? srcOf(at) : -1) + 1
}

/** 从第 i 层起都收掉 */
function closeFrom(i: number) {
  for (const l of layers.splice(Math.max(0, i))) {
    l.root.unmount()
    l.el.remove()
  }
  if (!layers.length) clearTimeout(closeT)
}

/** 浮窗里 ⌘点打开了：先藏起来，等开好（预览卡那边还要读那个链接）再拆 */
function closeSoon() {
  clearTimeout(closeT)
  cancelOpen()
  const gone = layers.splice(0)
  for (const l of gone) l.el.style.display = 'none'
  setTimeout(() => gone.forEach((l) => (l.root.unmount(), l.el.remove())), 1500)
}

/** 该收的那几层：CLOSE_MS 后再看一次鼠标在哪，还不在就收 */
function settle() {
  if (!layers.length) return
  if (keepCount(under()) >= layers.length) {
    clearTimeout(closeT)
    closeT = undefined
    return
  }
  if (closeT) return
  closeT = setTimeout(() => {
    closeT = undefined
    closeFrom(keepCount(under()))
  }, CLOSE_MS)
}

function cancelOpen() {
  clearTimeout(openT)
  openT = undefined
  openKey = ''
}

/** 按着 ⌘ 指着 at：是链接就（等一下）弹出来 */
function want(at: Element | null, delay: number) {
  const link = meta ? linkUnder(at) : null
  if (!link) return cancelOpen()
  const parent = depthOf(link.el)
  const next = layers[parent + 1]
  if (next && (next.src === link.el || next.key === link.key)) return cancelOpen()
  if (parent + 1 >= MAX_DEPTH) return cancelOpen()
  if (openT && openKey === link.key) return
  cancelOpen()
  openKey = link.key
  openT = setTimeout(() => void open(link, parent), delay)
}

async function open(link: Link, parent: number) {
  openT = undefined
  openKey = ''
  const my = ++token
  const found = await link.resolve()
  if (my !== token || !meta || !link.el.isConnected) return
  const at = under()
  if (!at || !link.el.contains(at)) return
  closeFrom(parent + 1)
  hideCiteCard()
  hideLinkCard()
  const el = document.createElement('div')
  el.className = 'pk'
  el.dataset.depth = String(layers.length)
  el.style.zIndex = String(990 + layers.length)
  document.body.appendChild(el)
  const root = createRoot(el)
  layers.push({ el, root, src: link.el, key: link.key })
  flushSync(() => root.render(<Peek c={found} label={link.label} from={link.from} />))
  // 右栏「相关」那种整栏都是条目的：浮窗放在那一栏左边，顶和这一条对齐（设计页 44 1.4），不盖住别的条目
  const beside = link.el.closest<HTMLElement>('[data-peek-side="left"]')
  if (beside) placeLeft(el, link.el.getBoundingClientRect(), beside.getBoundingClientRect())
  else place(el, link.el.getBoundingClientRect())
}

/** 放在 box 左边（右边离 box 左边线 GAP），顶对着 r 的顶，上下不出窗口 */
function placeLeft(el: HTMLElement, r: DOMRect, box: DOMRect) {
  const vh = window.innerHeight
  const w = Math.min(W, box.left - GAP - EDGE)
  const h = Math.min(H, vh - 2 * EDGE)
  el.style.width = `${w}px`
  el.style.maxHeight = `${h}px`
  el.style.left = `${box.left - GAP - w}px`
  el.style.top = `${Math.max(EDGE, Math.min(r.top, vh - EDGE - h))}px`
  el.style.bottom = ''
  el.dataset.side = 'left'
}

/** 贴着链接：下面放得下（或比上面宽敞）放下面，不然翻到上面；左右不出窗口 */
function place(el: HTMLElement, r: DOMRect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(W, vw - 2 * EDGE)
  const below = vh - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  const down = below >= H || below >= above
  const h = Math.max(120, Math.min(H, down ? below : above))
  el.style.width = `${w}px`
  el.style.maxHeight = `${h}px`
  el.style.left = `${Math.max(EDGE, Math.min(r.left, vw - EDGE - w))}px`
  el.style.top = down ? `${r.bottom + GAP}px` : ''
  el.style.bottom = down ? '' : `${vh - r.top + GAP}px`
  el.dataset.side = down ? 'below' : 'above'
}

/** 按着 ⌘ 时浮窗里的链接也和文档里一样变色（.cn-meta，NoteDoc 只管自己那份） */
function metaClass() {
  for (const l of layers) for (const e of l.el.querySelectorAll('.cm-editor')) e.classList.toggle('cn-meta', meta)
}

function setMeta(on: boolean) {
  if (on === meta) return
  meta = on
  if (!on) cancelOpen()
  metaClass()
}

/** main.tsx 里装一次 */
export function installPeek() {
  window.addEventListener(
    'pointermove',
    (e) => {
      px = e.clientX
      py = e.clientY
      setMeta(e.metaKey || e.ctrlKey)
      settle()
      want(e.target as Element, OPEN_MS)
    },
    true,
  )
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Meta' || e.key === 'Control') {
        if (e.repeat) return
        setMeta(true)
        settle()
        return want(under(), OPEN_MS)
      }
      // ⌘S、⌘K 这些快捷键：按的是键，不是要看那一篇
      cancelOpen()
      // esc 收最上面一层；浮窗里点出来的预览卡、链接卡开着时先收卡（它们自己接）
      if (e.key !== 'Escape' || !layers.length || document.querySelector('.lk-card-host:not([hidden])')) return
      e.preventDefault()
      e.stopPropagation()
      closeFrom(layers.length - 1)
    },
    true,
  )
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key !== 'Meta' && e.key !== 'Control') return
      setMeta(false)
      settle()
    },
    true,
  )
  window.addEventListener('blur', () => (setMeta(false), settle()))
  // 点浮窗外面：都收（点在浮窗里点出来的预览卡上不算）；按下了就不再弹（⌘点是要打开，不是看）
  window.addEventListener(
    'pointerdown',
    (e) => {
      cancelOpen()
      token++
      const at = e.target as Element
      if (layers.length && depthOf(at) < 0 && !onCard(at)) closeFrom(0)
    },
    true,
  )
  // 浮窗里 ⌘点链接：照旧打开（cite.tsx 接），浮窗跟着收
  window.addEventListener(
    'click',
    (e) => {
      const at = e.target as Element
      if ((e.metaKey || e.ctrlKey) && e.button === 0 && depthOf(at) >= 0 && linkUnder(at)) closeSoon()
    },
    true,
  )
  // 链接所在的那一栏滚了：浮窗对不上链接了。浮窗里自己滚不收
  window.addEventListener(
    'scroll',
    (e) => {
      const at = e.target as Node
      if (!layers.length || depthOf(at) >= 0 || (at instanceof Element && onCard(at))) return
      // 只管链接所在的那一栏：右栏 AI 正往下写、别处在滚，不收
      if (at === document || at.contains(layers[0]!.src)) closeFrom(0)
    },
    true,
  )
}

// ---------- 浮窗里画什么 ----------

type PdfFound = Extract<Found, { kind: 'pdf' }>

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const folderName = (p: string) => folderOf(p) || t('库根目录')
const lineText = (from: number, to: number) => (to > from ? t('第{from}–{to}行', { from, to }) : t('第{line}行', { line: from }))
const anchorText = (a: CiteAnchor) => ('line' in a ? lineText(a.line, a.end) : 'block' in a ? t('^{block} 那一段', { block: a.block }) : t('「{heading}」那一段', { heading: a.heading }))
const vaultSrc = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

/** 读一样东西：还在读是 null */
function useLoad<T>(key: string, load: () => Promise<T>): T | null {
  const [got, setGot] = useState<{ key: string; v: T } | null>(null)
  useEffect(() => {
    let live = true
    void load().then((v) => live && setGot({ key, v }))
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return got?.key === key ? got.v : null
}

/** 引到的那几行：一块淡底、左边 2px 强调色竖线（同 insert-flash 的那道，挂在 .cm-editor 上，垫在字下面，一直亮着）；行上记 pk-hit（测试认） */
function hitLines(from: number, to: number): Extension {
  const span = (view: EditorView) => {
    const d = view.state.doc
    const a = Math.max(1, Math.min(from, d.lines))
    return { a, z: Math.max(a, Math.min(to, d.lines)) }
  }
  const bar = ViewPlugin.fromClass(
    class {
      el = document.createElement('div')
      constructor(readonly view: EditorView) {
        this.el.className = 'pk-hitbar'
        this.el.setAttribute('aria-hidden', 'true')
        view.dom.appendChild(this.el)
        this.place()
      }
      update(u: ViewUpdate) {
        if (u.geometryChanged || u.heightChanged || u.viewportChanged) this.place()
      }
      place() {
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const { a, z } = span(view)
            const top = view.lineBlockAt(view.state.doc.line(a).from).top
            const bottom = view.lineBlockAt(view.state.doc.line(z).from).bottom
            return { top: view.documentTop - view.dom.getBoundingClientRect().top + top, height: bottom - top }
          },
          write: (m) => {
            this.el.style.top = `${Math.round(m.top)}px`
            this.el.style.height = `${Math.max(4, Math.round(m.height))}px`
          },
        })
      }
      destroy() {
        this.el.remove()
      }
    },
  )
  const tint = EditorView.decorations.of((view) => {
    const { a, z } = span(view)
    const d = view.state.doc
    const b = new RangeSetBuilder<Decoration>()
    for (let n = a; n <= z; n++) b.add(d.line(n).from, d.line(n).from, Decoration.line({ class: 'pk-hit' }))
    return b.finish()
  })
  return [tint, bar]
}

/** 正文开头的「# 标题」不画（头上那一行已经写了），连着下面的空行；属性表照画 */
function hideTitle(text: string): Extension {
  const lines = text.split('\n')
  let i = 0
  let pos = 0
  const skip = () => (pos += lines[i++]!.length + 1)
  if (/^---\s*$/.test(lines[0] ?? '')) {
    skip()
    while (i < lines.length && !/^---\s*$/.test(lines[i]!)) skip()
    if (i < lines.length) skip()
  }
  while (i < lines.length && !lines[i]!.trim()) skip()
  if (!/^#\s/.test(lines[i] ?? '')) return []
  const from = pos
  skip()
  while (i < lines.length - 1 && !lines[i]!.trim()) skip()
  const to = Math.min(text.length, pos - 1)
  return Prec.highest(EditorView.decorations.of(Decoration.set([Decoration.replace({ block: true }).range(from, to)])))
}

/** 整篇：文档同一套实时预览，只读；带了几行 / 标题 / 块的滚到那里、那几行亮着 */
function DocView(props: { path: string; text: string; anchor?: CiteAnchor; range?: { from: number; to: number } | null; branch?: () => BranchFiles }) {
  const { path, text, anchor } = props
  const host = useRef<HTMLDivElement>(null)
  const range = useMemo(() => props.range ?? (anchor ? anchorLines(text, anchor) : null), [text, anchor, props.range])
  useEffect(() => {
    const ext: Extension[] = [
      citeClicks(path, props.branch),
      ...(props.branch ? [peekBranch.of(props.branch)] : []),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      livePreview,
      propsBlock,
      showPropsTable.of(true),
      editorHost.of({ path: () => path, notice: (s) => app().notice(s) }),
      blocksField,
      mdWidgets,
      blockGaps,
      hideTitle(text),
      ...(range ? [hitLines(range.from, range.to)] : []),
    ]
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: text, extensions: ext }) })
    view.dom.classList.toggle('cn-meta', meta)
    if (range) {
      const line = view.state.doc.line(Math.max(1, Math.min(range.from, view.state.doc.lines)))
      const head = !!anchor && 'heading' in anchor
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: head ? 'start' : 'center', yMargin: 16 }) })
    }
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text, range])
  return (
    <>
      {anchor && !range && <p className="pk-msg">{t('没找到{where}，打开后在上次看到的地方', { where: anchorText(anchor) })}</p>}
      <div className="doc pk-doc" ref={host} data-testid="peek-doc" />
    </>
  )
}

function NoteBody(props: { path: string; anchor?: CiteAnchor; rev?: string; branch?: () => BranchFiles }) {
  const { path, rev } = props
  const text = useLoad(`${rev ?? ''}:${path}`, () => (rev ? branchText(path, rev) : noteText(path)))
  if (text === null) return null
  return <DocView path={path} text={text} anchor={props.anchor} branch={props.branch} />
}

/** 白板里的一张卡：画那块白板（一列一列，卡上是卡的字），转到那张卡、外圈亮着；白板上认不出那张卡就当文档看，滚到它那几行 */
function BoardBody({ path, id }: { path: string; id: string }) {
  const text = useLoad(path, () => noteText(path))
  const board = useMemo(() => (text === null ? null : splitDoc(text)), [text])
  const cols = useMemo(() => (board ? [...board.columns.filter((c) => c.cards.length || c.title).map((c) => ({ title: c.title, cards: c.cards })), ...(board.placed.length ? [{ title: null, cards: board.placed }] : [])] : []), [board])
  const has = cols.some((c) => c.cards.some((u) => unitId(u) === id))
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const hit = host.current?.querySelector<HTMLElement>('.pk-card.hit')
    const body = host.current?.closest<HTMLElement>('.pk-body')
    if (!hit || !body) return
    const a = hit.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    body.scrollLeft += a.left + a.width / 2 - (b.left + b.width / 2)
    body.scrollTop += a.top + a.height / 2 - (b.top + b.height / 2)
  }, [cols])
  if (text === null) return null
  if (!has) {
    const i = text.split('\n').findIndex((l) => new RegExp(`<!--\\s*card\\b.*\\bid="?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?(\\s|-->)`).test(l))
    return <DocView path={path} text={text} range={i < 0 ? null : { from: i + 2, to: i + 2 }} />
  }
  return (
    <div className="pk-board" ref={host} data-testid="peek-board">
      {cols.map((c, ci) => (
        <div className={'pk-col' + (c.title === null ? ' bare' : '')} key={ci}>
          {c.title !== null && <h4>{c.title}</h4>}
          {c.cards.map((u, ui) => (
            <div key={ui} className={'pk-card' + (unitId(u) === id ? ' hit' : '')} data-id={unitId(u) ?? undefined}>
              <Markdown text={u.text.replace(/^\s*<!--.*-->\s*$/gm, '').trim()} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** PDF 那一页：整页，框画出来、滚到框在的那一截 */
function PageBody({ c }: { c: PdfFound }) {
  const page = c.page ?? 1
  const url = usePdfPage(c.path, c.mtimeMs, page, 960)
  const box = useRef<HTMLSpanElement>(null)
  const r = c.rect
  const center = () => {
    const b = box.current
    const body = b?.closest<HTMLElement>('.pk-body')
    if (!b || !body) return
    const a = b.getBoundingClientRect()
    const o = body.getBoundingClientRect()
    body.scrollTop += a.top + a.height / 2 - (o.top + o.height / 2)
  }
  if (url === 'failed') return <p className="pk-msg">{t('这一页画不出来')}</p>
  return (
    <div className="pk-pdf" data-testid="peek-pdf">
      <div className="pk-page">
        {url && <img src={url} alt="" onLoad={center} />}
        {url && r && <span ref={box} className="box" style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }} />}
      </div>
    </div>
  )
}

function CommitBody({ hash }: { hash: string }) {
  const info = useLoad<CommitInfo | null>(hash, () => window.cn.commitInfo(hash))
  if (!info) return null
  return (
    <div className="pk-files">
      {info.files.slice(0, 12).map((f) => (
        <div key={f.path}>
          <Codicon name={/\.pdf$/i.test(f.path) ? 'file-pdf' : 'file'} size={12} />
          <span className="nm">{/\.md$/i.test(f.path) ? titleOf(f.path) : baseName(f.path)}</span>
          {f.added > 0 && <span className="pl">{`+${f.added}`}</span>}
          {f.removed > 0 && <span className="mi">{`−${f.removed}`}</span>}
        </div>
      ))}
    </div>
  )
}

/** 正文能滚的那一格：下面还有时下沿渐隐（.more），滚到底去掉 */
function Body({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    const check = () => el.classList.toggle('more', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    el.addEventListener('scroll', check, { passive: true })
    check()
    return () => (ro.disconnect(), mo.disconnect(), el.removeEventListener('scroll', check))
  }, [])
  return (
    <div className="pk-body" ref={ref}>
      {children}
    </div>
  )
}

function Peek({ c, label, from }: { c: Found; label: string; from: 'cite' | 'doc' }) {
  let icon: CodiconName = 'file'
  let title = label
  let sub = ''
  let at: string | null = null
  let open = t('打开')
  let body: ReactNode = null
  switch (c.kind) {
    case 'note':
      title = titleOf(c.path)
      sub = folderName(c.path)
      at = c.anchor ? anchorText(c.anchor) : null
      body = <NoteBody path={c.path} anchor={c.anchor} />
      break
    case 'row':
      icon = 'database'
      title = titleOf(c.path)
      sub = (baseName(c.folder) || t('库根目录')) + ' · ' + t('一行', { ctx: '数据库' })
      body = <NoteBody path={c.path} />
      break
    case 'todo':
      icon = 'checklist'
      title = titleOf(c.path)
      sub = folderName(c.path)
      at = lineText(c.line, c.line)
      body = <NoteBody path={c.path} anchor={{ line: c.line, end: c.line }} />
      break
    case 'branch':
      icon = 'git-branch'
      title = /\.md$/i.test(c.path) ? titleOf(c.path) : baseName(c.path)
      sub = t('梦游分支上的 · 收下后才在库里')
      open = t('打开分支上那份')
      if (/\.md$/i.test(c.path)) body = <NoteBody path={c.path} rev={c.rev} />
      break
    case 'board':
      icon = 'layout'
      title = titleOf(c.path)
      sub = folderName(c.path) + ' · ' + t('白板里的一张卡')
      open = t('打开白板')
      body = <BoardBody path={c.path} id={c.id} />
      break
    case 'pdf':
      icon = 'file-pdf'
      title = baseName(c.path)
      sub = folderName(c.path)
      at = c.page ? t('第{page}页', { page: c.page }) : null
      if (c.page) open = c.text ? t('翻到这段') : t('翻到这页')
      body = <PageBody c={c} />
      break
    case 'file':
      title = baseName(c.path)
      sub = folderName(c.path)
      body = IMAGE.test(c.path) ? (
        <div className="pk-img">
          <img src={vaultSrc(c.path)} alt="" />
        </div>
      ) : (
        <p className="pk-msg">{t('这种文件在浮窗里看不了，打开再看')}</p>
      )
      break
    case 'web': {
      sub = prettyUrl(c.url.replace(/#.*$/, ''))
      open = t('右栏打开')
      const quote = parseFragment(c.url)?.text
      body = (
        <div className="pk-web" data-testid="peek-web">
          {quote && <p className="q">{quote}</p>}
          <p className="url">{c.url}</p>
        </div>
      )
      break
    }
    case 'commit':
      icon = 'git-commit'
      sub = c.hash.slice(0, 7)
      open = t('看这次改动')
      body = <CommitBody hash={c.hash} />
      break
    case 'chat':
      icon = 'comment-discussion'
      sub = t('AI 对话里的一条回答')
      open = t('回到 AI 对话')
      break
    case 'outside':
      icon = 'warning'
      sub = t('不在库里：{path}', { path: c.path })
      break
    default:
      icon = 'warning'
      body = <p className="pk-msg">{t('库里没找到这一篇')}</p>
  }
  const canOpen = c.kind !== 'missing' && c.kind !== 'outside'
  return (
    <div className={`pk-in k-${c.kind}`} role="dialog" aria-label={t('预览「{title}」', { title: title || label })} data-testid="peek">
      <div className="pk-head">
        {c.kind === 'web' ? <Favicon url={c.url} size={14} /> : <Codicon name={icon} size={14} />}
        <b className="pk-t">{title || label}</b>
        <span className="pk-sub">
          {sub}
          {at && ' · '}
          {at && <span className="at">{at}</span>}
        </span>
        {canOpen && (
          <button type="button" className="pk-open" onClick={() => (closeSoon(), openCite(c, 'open', label, from))}>
            {open} <span className="k">{keyFor('cmd-click')}</span>
          </button>
        )}
      </div>
      {body && <Body>{body}</Body>}
    </div>
  )
}
