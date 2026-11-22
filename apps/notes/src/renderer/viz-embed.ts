/**
 * 笔记里嵌着的可视化（task-m552v，demo /private/tmp/canvas-notes-dream/v2/proto.html 第 4 节）：
 * 单独一段 `![可视化 · 标题](x.html)` 画成一块能拖的图，不是一行链接。头上「图标 · 可视化 · 标题 · 能拖 · x.html · 梦游做的 …… 放大」，
 * 下面是那份 HTML 在没有来源的沙箱 iframe 里跑（同 HtmlTab：只许它自己的脚本和样式，不联网），就地能拖能点；右上「在中间整页打开」。
 * 只加装饰，不动这篇的字（打开再保存不变）。梦游对照里画的是梦游分支上那份（vizHost 换地址、写「还没收下」）。
 */
import { codiconEl } from '@cn/design'
import { Facet } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import { app } from './ctx/actions'
import './viz-embed.css'

/** 这份 HTML 在哪看、点放大开哪里（文档里是库里那份；梦游对照里是梦游分支上那份） */
export interface VizHost {
  src(path: string): string
  /** 还没收下（梦游分支上的）：头上灰字后面写「还没收下」 */
  pending?: boolean
  open(path: string): void
}

const vaultSrc = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')

export const vizHost = Facet.define<VizHost, VizHost>({
  combine: (v) => v[0] ?? { src: vaultSrc, open: (p) => app().openFile(p) },
})

/** 地址带上 ?fit：主进程在那一页末尾加报高度的脚本（main/attachments.ts） */
export const fitSrc = (src: string) => src + (src.includes('?') ? '&' : '?') + 'fit'

interface Fitting {
  frame: HTMLIFrameElement
  set(h: number): void
}
const fitting = new Set<Fitting>()
function onFit(e: MessageEvent) {
  const h = (e.data as { cnFit?: unknown } | null)?.cnFit
  if (typeof h !== 'number' || !Number.isFinite(h) || !e.source) return
  for (const f of fitting) if (f.frame.contentWindow === e.source) f.set(h)
}
/**
 * iframe 跟着里面那一页的高（task-m552v）：min 到 max 之间，再高的在里面滚；changed 是高变了以后（编辑器要重新量块的高）。
 * 返回取消的函数
 */
export function fitFrame(frame: HTMLIFrameElement, min: number, max: number, changed?: () => void): () => void {
  if (!fitting.size) window.addEventListener('message', onFit)
  const f: Fitting = {
    frame,
    set(h) {
      const px = `${Math.round(Math.min(max, Math.max(min, h)))}px`
      if (frame.style.height === px) return
      frame.style.height = px
      changed?.()
    },
  }
  fitting.add(f)
  return () => {
    fitting.delete(f)
    if (!fitting.size) window.removeEventListener('message', onFit)
  }
}

/** 一张图的样子量过一次就记住：同一篇里换来换去不再问主进程（「梦游做的」那几个字） */
const madeBy = new Map<string, Promise<string>>()
function byOf(path: string, pending: boolean): Promise<string> {
  if (pending) return Promise.resolve('梦游做的')
  let p = madeBy.get(path)
  if (!p) {
    p = window.cnReading.htmlMeta(path).then(
      (m) => (m.props['做的'] === '梦游' ? '梦游做的' : ''),
      () => '',
    )
    madeBy.set(path, p)
    // 文件会变（收下、重做）：几秒后再量
    setTimeout(() => madeBy.delete(path), 5000)
  }
  return p
}

export class VizWidget extends WidgetType {
  constructor(
    /** 库里的路径 */
    readonly path: string,
    /** ![…] 里写的：「可视化 · 标题」 */
    readonly alt: string,
    /** 这一行行首（点头上选中这一块） */
    readonly from: number,
    readonly src: string,
    readonly pending: boolean,
  ) {
    super()
  }
  eq(o: VizWidget) {
    return o.path === this.path && o.alt === this.alt && o.from === this.from && o.src === this.src && o.pending === this.pending
  }
  /** 头上的字跟着换，iframe 不动（挪动 iframe 会重载，拖到一半的就丢了） */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (dom.dataset.src !== this.src) return false
    dom.dataset.path = this.path
    dom.querySelector('.vz-h')?.replaceWith(this.head(view))
    return true
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-viz'
    wrap.dataset.path = this.path
    wrap.dataset.src = this.src
    const card = document.createElement('div')
    card.className = 'vz'
    const body = document.createElement('div')
    body.className = 'vz-b'
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.title = this.alt || this.name
    frame.src = fitSrc(this.src)
    // 先 240 高，那一页报了自己多高再跟着变（160 到 560，再高的在里面滚）
    frame.style.height = '240px'
    unfit.set(wrap, fitFrame(frame, 160, 560, () => view.requestMeasure()))
    body.appendChild(frame)
    card.append(this.head(view), body)
    wrap.appendChild(card)
    return wrap
  }
  get name() {
    return this.path.split('/').pop() ?? this.path
  }
  private head(view: EditorView): HTMLElement {
    const head = document.createElement('div')
    head.className = 'vz-h'
    const title = document.createElement('b')
    title.className = 'vz-t'
    title.textContent = this.alt.trim() || this.name
    const badge = document.createElement('span')
    badge.className = 'vz-badge'
    badge.textContent = '能拖'
    const src = document.createElement('span')
    src.className = 'vz-src'
    src.textContent = this.name + (this.pending ? ' · 梦游做的 · 还没收下' : '')
    if (!this.pending) void byOf(this.path, false).then((by) => by && src.isConnected && (src.textContent = `${this.name} · ${by}`))
    const sp = document.createElement('span')
    sp.className = 'sp'
    const full = document.createElement('button')
    full.type = 'button'
    full.className = 'vz-full'
    full.tabIndex = -1
    full.setAttribute('aria-label', '在中间整页打开')
    full.dataset.tip = '在中间整页打开'
    full.dataset.side = 'below'
    full.appendChild(codiconEl('screen-full', 14))
    const host = view.state.facet(vizHost)
    full.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    full.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      host.open(this.path)
    })
    head.append(codiconEl('graph', 15), title, badge, src, sp, full)
    // 点头上（不是放大）：选中这一块，再按退格删掉；光标不进原文（同图片）
    head.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.vz-full')) return
      e.preventDefault()
      if (view.state.readOnly) return
      const end = view.state.doc.lineAt(this.from).to
      view.focus()
      view.dispatch({ selection: { anchor: this.from, head: end } })
    })
    return head
  }
  ignoreEvent() {
    return true
  }
  destroy(dom: HTMLElement) {
    unfit.get(dom)?.()
    unfit.delete(dom)
  }
  get estimatedHeight() {
    return 300
  }
}

/** 每块的 iframe 不再跟着高时取消（块拿掉了） */
const unfit = new WeakMap<HTMLElement, () => void>()

/** 一行是不是嵌着的可视化：![…](x.html)，库里的（网址不算） */
export const isVizUrl = (url: string) => /\.html?(?:#.*)?$/i.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)
