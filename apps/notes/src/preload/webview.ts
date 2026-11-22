/**
 * 右栏网页里的预加载（隔离环境，网页碰不到）：选中一段文字时，在选区上方 6px 弹出黑色胶囊小条（task-6cxtc，四处小条一个样）：
 * 讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ 剪藏 ⌘S · ⋯。点了把选中的字、它上面的小标题、网页网址标题和小条在哪交给软件（cn:sel），
 * 软件决定进哪个 AI、记进哪篇（没定过的问一句「记到哪篇」）。
 * 指着「剪藏」说剪进哪篇（软件发来的 cn:clip-to）。「⋯」里：只看译文（双语翻译插件开着时，弹译文小卡、不问 AI）、翻译设置…、剪到哪篇…、拷贝。
 * 键照命令表：↵ 讲解一下，⌘↵ 引用，⌘S 剪藏；焦点在网页自己的输入框里时不拦。网页太窄放不下整条：先藏键帽，再把「翻译 + 讲一讲」「剪藏」只留图标，
 * 再不够这两颗收进「⋯」，不挤字、不切半颗。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { isPageKey, onPageKeys, pageKey } from './page-keys'
import { ipcRenderer } from 'electron'
import { defaultKeysOf } from '../shared/cmd-table'
import type { SelAction, WebSel } from '../shared/web-reader'
import { aiLogoHtml, onAiLogo } from './ai-logo'
import { installExtPage } from './ext-page'
import { onPluginState, pluginEnabled } from './plugins/state'
import { selectionText, translateSelection } from './plugins/translate'
import { headAbove } from './webview-head'
import './media-hold'
import './webview-page'
import './video'
import './plugins/weread'
import './webview-reader'
import './webview-readpos'
import './webview-marks'

/** 剪藏剪进哪篇（悬停提示两行、「⋯ › 剪到哪篇…」右边写的那篇）：软件按这个网页现在剪进哪篇发来 */
interface ClipTo {
  tip: string
  sub: string
  target: string | null
}
let clipTo: ClipTo = { tip: '剪成卡片，放进收件箱', sub: '剪完底栏说剪到了哪，能撤回', target: null }
ipcRenderer.on('cn:clip-to', (_e, t: ClipTo) => {
  if (!t || typeof t.tip !== 'string') return
  clipTo = { tip: t.tip, sub: String(t.sub ?? ''), target: typeof t.target === 'string' ? t.target : null }
  if (host) render()
})

let host: HTMLDivElement | null = null
let root: ShadowRoot | null = null
let pending: { text: string; rect: DOMRect; head?: string } | null = null
let menuOpen = false
let tipTimer: ReturnType<typeof setTimeout> | undefined
/** 点了讲解一下、翻译、引用、剪藏，软件还在问「记到哪篇」：小条和选区留着（弹层贴在小条下面），软件说定了才收起 */
let waiting = false

const COMMENT = codiconSvg('comment')
const QUOTE = codiconSvg('quote')
const LANG = codiconSvg('whole-word')
const MORE = codiconSvg('ellipsis')
const GEAR = codiconSvg('settings-gear')
const FILE = codiconSvg('file')
const COPY = codiconSvg('copy')

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const kbd = (k: string | null) => (k ? `<kbd>${escapeHtml(k)}</kbd>` : '')

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-clip-host'
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:max-content;display:none'
  root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    :host{all:initial}
    .bar{position:relative;display:flex;align-items:center;height:30px;padding:0 2px;border-radius:999px;background:#111113;color:#fff;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.18),0 12px 28px -8px rgba(0,0,0,.35);white-space:nowrap}
    .bar::after{content:"";position:absolute;left:16px;bottom:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#111113}
    .bar.below::after{bottom:auto;top:-5px;border-top:0;border-bottom:5px solid #111113;border-left-color:transparent;border-right-color:transparent}
    button{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover,button.on{background:#2a2a2e}
    .more{padding:0 9px}
    .sep{flex:none;width:1px;height:14px;margin:0 3px;background:rgba(255,255,255,.2)}
    kbd{margin-left:2px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.14);font:11px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(255,255,255,.86)}
    .tight kbd{display:none}
    .tighter .tr2 .lb,.tighter .clip .lb{display:none}
    .tightest .tr2,.tightest .clip,.tightest .sep{display:none}
    svg,img{width:14px;height:14px;flex:none}
    .tip{position:absolute;display:none;padding:7px 10px;border-radius:6px;background:#111113;color:#fff;font:500 12px/18px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap;pointer-events:none}
    .tip span{display:block;font-weight:400;color:rgba(255,255,255,.62)}
    .menu{position:absolute;display:none;min-width:240px;padding:6px;border-radius:10px;background:#1c1c1e;color:#fff;
      font:400 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 12px 32px rgba(0,0,0,.35)}
    .menu button{width:100%;height:32px;padding:0 10px;border-radius:6px;gap:10px;font-weight:400;justify-content:flex-start}
    .menu button .r{margin-left:auto;padding-left:16px;max-width:150px;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.5);font-size:12px}
    .menu .ms{height:1px;margin:5px 4px;background:rgba(255,255,255,.12)}
  </style><div class="bar" part="bar" role="toolbar" aria-label="选中的这段">
    <button class="ex" data-k="explain"></button>
    <button class="tr2" data-k="translate" title="翻译 + 讲一讲">${LANG}<span class="lb">翻译 + 讲一讲</span></button>
    <button class="qt" data-k="quote"></button>
    <span class="sep"></span>
    <button class="clip" data-k="clip"></button>
    <button class="more" data-k="more" aria-label="更多" aria-haspopup="menu">${MORE}</button>
  </div><div class="tip" role="tooltip"></div><div class="menu" role="menu" aria-label="这段还能做什么"></div>`
  for (const b of Array.from(root.querySelectorAll('button'))) b.addEventListener('mousedown', (e) => e.preventDefault())
  root.querySelector('.bar')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]')
    if (!b) return
    e.preventDefault()
    const k = b.dataset.k!
    if (k === 'more') return toggleMenu()
    act(k as SelAction)
  })
  const clip = root.querySelector<HTMLButtonElement>('button.clip')!
  clip.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer)
    tipTimer = setTimeout(showTip, 300)
  })
  clip.addEventListener('mouseleave', hideTip)
  root.querySelector('.menu')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]')
    if (!b) return
    e.preventDefault()
    const k = b.dataset.k!
    if (k === 'only') {
      if (!pending) return
      const { text, rect } = pending
      hide()
      return translateSelection(text.trim(), rect)
    }
    act(k as SelAction)
  })
  document.documentElement.appendChild(host)
}

function render() {
  if (!root) return
  // 「讲解一下」交给 AI 对话那一家：前面画它的标志（同 PDF 框一块的浮条），换了引擎跟着换
  root.querySelector('.ex')!.innerHTML = `${aiLogoHtml('chat') ?? COMMENT}<span class="lb">讲解一下</span>${kbd(defaultKeysOf('enter')[0] ?? null)}`
  root.querySelector('.qt')!.innerHTML = `${COMMENT}<span class="lb">引用</span>${kbd(pageKey('quote-selection'))}`
  const clip = root.querySelector<HTMLButtonElement>('.clip')!
  clip.innerHTML = `${QUOTE}<span class="lb">剪藏</span>${kbd(pageKey('clip-selection'))}`
  clip.setAttribute('aria-label', '剪藏')
  if (menuOpen) renderMenu()
}

function renderMenu() {
  const menu = root!.querySelector<HTMLElement>('.menu')!
  const copyKey = defaultKeysOf('copy')[0] ?? ''
  const item = (k: string, icon: string, label: string, right = '') =>
    `<button role="menuitem" data-k="${k}">${icon}<span>${label}</span>${right ? `<span class="r">${escapeHtml(right)}</span>` : ''}</button>`
  // 窄得放不下「翻译 + 讲一讲」「剪藏」时，它们收进这里（排在最前）
  const folded = root!.querySelector('.bar')!.classList.contains('tightest')
  menu.innerHTML = [
    ...(folded ? [item('translate', LANG, '翻译 + 讲一讲'), item('clip', QUOTE, '剪藏', pageKey('clip-selection') ?? ''), '<div class="ms"></div>'] : []),
    pluginEnabled('translate') ? item('only', aiLogoHtml('translate') ?? LANG, '只看译文', '不进对话') : '',
    item('settings', GEAR, '翻译设置…'),
    '<div class="ms"></div>',
    item('target', FILE, '剪到哪篇…', clipTo.target ?? ''),
    item('copy', COPY, '拷贝', copyKey),
  ].join('')
}

function toggleMenu() {
  if (menuOpen) return closeMenu()
  if (!root) return
  hideTip()
  menuOpen = true
  renderMenu()
  const bar = root.querySelector<HTMLElement>('.bar')!
  const more = root.querySelector<HTMLElement>('.more')!
  const menu = root.querySelector<HTMLElement>('.menu')!
  more.classList.add('on')
  menu.style.display = 'block'
  // 菜单右边和「⋯」对齐，在小条下面 6；左边出了网页就往右挪
  const hb = host!.getBoundingClientRect()
  const mb = more.getBoundingClientRect()
  const w = menu.offsetWidth
  const left = Math.max(4 - hb.left, mb.right - hb.left - w)
  menu.style.left = `${left}px`
  const below = bar.offsetHeight + 6
  menu.style.top = hb.top + below + menu.offsetHeight > innerHeight - 4 ? `${-menu.offsetHeight - 6}px` : `${below}px`
}

function closeMenu() {
  menuOpen = false
  if (!root) return
  root.querySelector<HTMLElement>('.menu')!.style.display = 'none'
  root.querySelector('.more')?.classList.remove('on')
}

function showTip() {
  if (!root || menuOpen) return
  const tip = root.querySelector<HTMLElement>('.tip')!
  const clip = root.querySelector<HTMLElement>('.clip')!
  tip.innerHTML = `${escapeHtml(clipTo.tip)}${clipTo.sub ? `<span>${escapeHtml(clipTo.sub)}</span>` : ''}`
  tip.style.display = 'block'
  const hb = host!.getBoundingClientRect()
  const cb = clip.getBoundingClientRect()
  const w = tip.offsetWidth
  tip.style.left = `${Math.max(4 - hb.left, Math.min(cb.left - hb.left - 4, innerWidth - 4 - hb.left - w))}px`
  const below = root.querySelector<HTMLElement>('.bar')!.offsetHeight + 6
  tip.style.top = hb.top + below + tip.offsetHeight > innerHeight - 4 ? `${-tip.offsetHeight - 6}px` : `${below}px`
}

function hideTip() {
  clearTimeout(tipTimer)
  const tip = root?.querySelector<HTMLElement>('.tip')
  if (tip) tip.style.display = 'none'
}

/** 小条上点了一颗（或按了它的键）：交给软件 */
function act(action: SelAction) {
  if (!pending) return
  // 选好马上点（机器忙时 120ms 的防抖还没轮到，小条记着的还是拖到一半的选区）：照现在的选区取字
  const live = window.getSelection()
  if (live && !live.isCollapsed && live.rangeCount && !(live.anchorNode && host?.contains(live.anchorNode))) {
    const text = selectionText(live)
    const head = headAbove(live.getRangeAt(0).startContainer)
    if (text) pending = { ...pending, text, ...(head ? { head } : {}) }
  }
  const bar = host!.shadowRoot!.querySelector<HTMLElement>('.bar')!.getBoundingClientRect()
  const sel: WebSel = { action, text: pending.text, url: location.href, title: document.title, ...(pending.head ? { head: pending.head } : {}), bar: { x: bar.left, y: bar.top, w: bar.width, h: bar.height } }
  closeMenu()
  hideTip()
  // 剪藏、讲解这些：等软件定了记到哪篇（cn:sel-done）再收起小条、清掉选区；「剪到哪篇」「翻译设置」「拷贝」留着选区（接着点）
  waiting = action === 'explain' || action === 'translate' || action === 'quote' || action === 'clip'
  ipcRenderer.sendToHost('cn:sel', sel)
}

/** 软件定了（keep：取消了「记到哪篇」，小条和选区照旧留着，可以换一颗点） */
ipcRenderer.on('cn:sel-done', (_e, keep: unknown) => {
  if (!waiting) return
  waiting = false
  if (keep === true) return
  hide()
  window.getSelection()?.removeAllRanges()
})

/** 焦点在网页自己的输入框里（评论框、搜索框）：键留给网页 */
function typingInPage(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test((el as HTMLInputElement).type))
}

/** 焦点在网页的链接、按钮上（键盘挪过去的）：回车是点它，不是讲解一下 */
function onControl(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && el !== document.body && !!el.closest('a[href], button, summary, [role=button], [role=link]')
}

function hide() {
  pending = null
  waiting = false
  closeMenu()
  hideTip()
  if (host) host.style.display = 'none'
}

/**
 * 选中的那一行画出来有多高：浏览器给选中的字铺底色按整行高（d2l 行高是字高的两倍），getClientRects 只给字的方框，
 * 上下各差半个行距；小条要离底色 6，按整行算
 */
function lineBox(r: DOMRect, node: Node): { top: number; bottom: number; left: number } {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const lh = el ? parseFloat(getComputedStyle(el).lineHeight) : NaN
  const pad = Number.isFinite(lh) && lh > r.height ? (lh - r.height) / 2 : 0
  return { top: r.top - pad, bottom: r.bottom + pad, left: r.left }
}

function update() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.isCollapsed || !text || sel.rangeCount === 0) return hide()
  if (host && sel.anchorNode && host.contains(sel.anchorNode)) return
  const range = sel.getRangeAt(0)
  const rects = range.getClientRects()
  const first = lineBox(rects[0] ?? range.getBoundingClientRect(), range.startContainer)
  const last = lineBox(rects[rects.length - 1] ?? range.getBoundingClientRect(), range.endContainer)
  ensure()
  // 选区里夹着的译文：「整页剪藏带上译文」关着时不算（只剪原文）
  const head = headAbove(range.startContainer)
  pending = { text: selectionText(sel), rect: range.getBoundingClientRect(), ...(head ? { head } : {}) }
  closeMenu()
  hideTip()
  render()
  host!.style.display = 'block'
  const h = 30
  // 离选区（选中的底色）6，尖角落在这道空隙里；选区在最上面、上面放不下：放到选区下面
  const below = first.top - h - 6 < 4
  const bar = host!.shadowRoot!.querySelector<HTMLElement>('.bar')!
  bar.classList.toggle('below', below)
  const top = below ? Math.min(innerHeight - h - 4, last.bottom + 6) : first.top - h - 6
  // 网页窄（右栏 300）放不下整条：先藏键帽（快捷键照样能用），再把两颗只留图标，再收进「⋯」，最后贴着右边摆
  bar.classList.remove('tight', 'tighter', 'tightest')
  for (const c of ['tight', 'tighter', 'tightest']) if (bar.offsetWidth > window.innerWidth - 8) bar.classList.add(c)
  const left = Math.max(4, Math.min(first.left, window.innerWidth - bar.offsetWidth - 4))
  host!.style.transform = `translate(${left}px, ${top}px)`
}

// 网页里按下鼠标、按 Esc：告诉软件，右栏开着的弹层收起（焦点在网页里时软件窗口自己收不到，CN-43）
window.addEventListener('pointerdown', () => ipcRenderer.sendToHost('cn:page-down'), true)
window.addEventListener('keydown', (e) => e.key === 'Escape' && ipcRenderer.sendToHost('cn:page-esc'), true)

let timer: ReturnType<typeof setTimeout> | undefined
// 书签管家的页面（新网页标签）：给它补上 chrome.* 接口，不出小条
if (location.protocol === 'cn-ext:') installExtPage()
else {
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer)
    timer = setTimeout(update, 120)
  })
  window.addEventListener('scroll', () => pending && update(), true)
  // 点了小条以外的地方：「⋯」收起
  window.addEventListener('pointerdown', (e) => menuOpen && host && !e.composedPath().includes(host) && closeMenu(), true)
  // 选中一段后：↵ 讲解一下、⌘↵ 引用、⌘S 剪藏（CN-42 起小条上的键）；捕获阶段先接，网页自己收不到这一下
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && menuOpen) {
        e.preventDefault()
        return closeMenu()
      }
      // 还在问记到哪篇：键交给那个弹层（回车是「记到这篇」），这里不再讲解一遍
      if (waiting) return
      const bare = e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing
      const action: SelAction | null = isPageKey(e, 'quote-selection') ? 'quote' : isPageKey(e, 'clip-selection') ? 'clip' : bare ? 'explain' : null
      if (!action || typingInPage() || (bare && onControl())) return
      // 选区变了小条还没跟上（120ms 防抖）：先按现在的选区算一次
      if (!pending) update()
      if (!pending) return
      e.preventDefault()
      e.stopImmediatePropagation()
      act(action)
    },
    true,
  )
  onPluginState(() => menuOpen && renderMenu())
  onPageKeys(() => render())
  onAiLogo(() => render())
}
