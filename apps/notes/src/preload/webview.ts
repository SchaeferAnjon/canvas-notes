/**
 * 右栏网页里的预加载（隔离环境，网页碰不到）：选中一段文字时，在选区上方 6px 弹出黑色胶囊小条（task-6cxtc，四处小条一个样）：
 * 讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ · 自己加的 ｜ 剪藏 ⌘S ｜ ⋯ ×。点了把选中的字、它上面的小标题、网页网址标题和小条在哪交给软件（cn:sel），
 * 软件决定进哪个 AI、记进哪篇（没定过的问一句「记到哪篇」）。
 * 条上、⋯ 里有哪几颗、什么顺序照设置 › 选中小条（task-26nz7，软件发来的 cn:bar；没发来之前照默认的）：自己加的 AI 命令排在竖线前面，
 * 只在网页才有的「剪藏」永远在竖线后面。× 点一下只是这次收起，右键或按住半秒出小菜单「这个网站不弹」「哪里都不弹」；
 * 名单上的网站、总开关关着时不弹，选了字按 ↵、⌘↵ 这些键照样能用。
 * 指着「剪藏」说剪进哪篇（软件发来的 cn:clip-to）。「⋯」里：收进 ⋯ 的那几颗（只看译文在双语翻译插件开着时才有）、翻译设置…、剪到哪篇…、加一颗…、小条设置…。
 * 键照命令表：↵ 讲解一下，⌘↵ 引用，⌘S 剪藏，自己那颗设的键；焦点在网页自己的输入框里时不拦。网页太窄放不下整条：先藏键帽，
 * 再把自己加的、「翻译 + 讲一讲」「剪藏」只留图标，再不够这几颗收进「⋯」，不挤字、不切半颗。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import type { CodiconName } from '@cn/design'
import { isPageKey, onPageKeys, pageKey } from './page-keys'
import { ipcRenderer } from 'electron'
import { comboOf } from '../shared/cmd-keys'
import { defaultKeysOf } from '../shared/cmd-table'
import { siteMuted } from '../shared/sel-bar'
import type { SelAction, WebBarBtn, WebBarSpec, WebSel } from '../shared/web-reader'
import { aiLogoHtml, onAiLogo } from './ai-logo'
import { installExtPage } from './ext-page'
import { onPluginState, pluginEnabled } from './plugins/state'
import { clipKeepsTranslation, selectionText, translateSelection } from './plugins/translate'
import { blockAt, markSelBlocks, rangeToMd, sectionRange, selectBlock } from './webview-md'
import { tagMathJax } from './webview-mathjax'
import { setBeforeExtract } from './webview-page'
import { headAbove } from './webview-head'
import './media-hold'
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

/** 软件还没发来设置时照默认的（设置 › 选中小条没改过的样子），字是中文 */
const btn = (id: string, label: string, icon: string, key: string | null, right?: string): WebBarBtn => ({ id, label, icon, key, mine: false, ...(right ? { right } : {}) })
let spec: WebBarSpec = {
  main: [btn('explain', '讲解一下', 'ai', defaultKeysOf('enter')[0] ?? null), btn('translate', '翻译 + 讲一讲', 'whole-word', null), btn('quote', '引用', 'comment', null)],
  tail: [btn('clip', '剪藏', 'quote', null)],
  more: [btn('only', '只看译文', 'tr', null, '不进对话'), btn('copy', '拷贝', 'copy', defaultKeysOf('copy')[0] ?? null)],
  enabled: true,
  offSites: [],
  fresh: null,
  acc: '#0a7ea4',
  text: {
    more: '更多',
    close: '收起（右键或按住：这个网站不弹…）',
    trSettings: '翻译设置…',
    target: '剪到哪篇…',
    add: '加一颗…',
    addR: '拿这段试',
    settings: '小条设置…',
    section: '剪整节',
    mute: '{site} 不弹',
    muteR: '记进名单',
    all: '哪里都不弹',
    allR: '总开关关掉',
    note: '点 × 只是这次收起。这两项在 {link} 改回来',
    noteLink: '设置 › 选中小条',
    bar: '选中的这段',
    menu: '这段还能做什么',
    xmenu: '不弹小条',
  },
}
ipcRenderer.on('cn:bar', (_e, s: WebBarSpec) => {
  if (!s || !Array.isArray(s.main) || !Array.isArray(s.tail) || !Array.isArray(s.more) || !s.text) return
  spec = s
  if (host) render()
  // 名单、总开关变了：开着的小条照新的收起或留着
  if (pending && muted() && host) host.style.display = 'none'
})

let host: HTMLDivElement | null = null
let root: ShadowRoot | null = null
let pending: { text: string; md: string; rect: DOMRect; head?: string } | null = null
let menuOpen = false
let xOpen = false
let tipTimer: ReturnType<typeof setTimeout> | undefined
/** 点了讲解一下、翻译、引用、剪藏，软件还在问「记到哪篇」：小条和选区留着（弹层贴在小条下面），软件说定了才收起 */
let waiting = false
/** × 按住半秒出了小菜单：松手时那一下 click 不算收起 */
let longPressed = false
/** 这一次出来描着圈的那颗（软件那边已经清掉了也留到这次收起） */
let shownFresh: string | null = null
let pressTimer: ReturnType<typeof setTimeout> | undefined

const COMMENT = codiconSvg('comment')
const QUOTE = codiconSvg('quote')
const LANG = codiconSvg('whole-word')
const MORE = codiconSvg('ellipsis')
const CLOSE = codiconSvg('close')
const GEAR = codiconSvg('settings-gear')
const FILE = codiconSvg('file')

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const kbd = (k: string | null) => (k ? `<kbd>${escapeHtml(k)}</kbd>` : '')
const fill = (s: string, k: string, v: string) => s.split(`{${k}}`).join(v)

/** 一颗的图标：ai 是 AI 对话那一家的标志，tr 是翻译那一家的，别的是 codicon */
function iconOf(icon: string): string {
  if (icon === 'ai') return aiLogoHtml('chat') ?? COMMENT
  if (icon === 'tr') return aiLogoHtml('translate') ?? LANG
  try {
    return codiconSvg(icon as CodiconName)
  } catch {
    return COMMENT
  }
}

/** 这个网站现在不弹（名单上、总开关关着）：选了字不出小条，键照样能按 */
const muted = () => !spec.enabled || siteMuted(spec, location.href)

/** 这一颗在条上、⋯ 里（有没有） */
const allBtns = () => [...spec.main, ...spec.tail, ...spec.more]

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-clip-host'
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:max-content;display:none'
  root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    :host{all:initial}
    .bar{position:relative;display:flex;align-items:center;height:30px;padding:0 2px;border-radius:999px;background:#111113;color:#fff;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;white-space:nowrap;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.18),0 12px 28px -8px rgba(0,0,0,.35)}
    .bar::after{content:"";position:absolute;left:16px;bottom:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#111113}
    .bar.below::after{bottom:auto;top:-5px;border-top:0;border-bottom:5px solid #111113;border-left-color:transparent;border-right-color:transparent}
    button{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover,button.on{background:#2a2a2e}
    .bar .ico{padding:0 8px}
    .bar .new{box-shadow:0 0 0 1.5px var(--acc,#0a7ea4) inset}
    .sep{flex:none;width:1px;height:14px;margin:0 3px;background:rgba(255,255,255,.2)}
    kbd{margin-left:2px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.14);font:11px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(255,255,255,.86)}
    .tight kbd{display:none}
    .tighter .fold .lb{display:none}
    .tighter .fold{padding:0 8px}
    .tightest .fold,.tightest .sep.t{display:none}
    svg,img{width:14px;height:14px;flex:none}
    .tip{position:absolute;display:none;padding:7px 10px;border-radius:6px;background:#111113;color:#fff;font:500 12px/18px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:nowrap;pointer-events:none}
    .tip span{display:block;font-weight:400;color:rgba(255,255,255,.62)}
    .menu{position:absolute;display:none;min-width:250px;padding:6px;border-radius:10px;background:#1c1c1e;color:#fff;
      font:400 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 12px 32px rgba(0,0,0,.35)}
    .menu button{width:100%;height:32px;padding:0 10px;border-radius:6px;gap:10px;font-weight:400;justify-content:flex-start}
    .menu button .r{margin-left:auto;padding-left:16px;max-width:170px;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.5);font-size:12px}
    .menu .ms{height:1px;margin:5px 4px;background:rgba(255,255,255,.12)}
    .menu .note{padding:6px 10px 4px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.55);white-space:normal;max-width:280px}
    .menu .note a{color:#7fd0ff;cursor:pointer}
  </style><div class="bar" part="bar" role="toolbar"></div><div class="tip" role="tooltip"></div><div class="menu more-menu" role="menu"></div><div class="menu x-menu" role="menu"></div>`
  root.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('button, a')) e.preventDefault()
  })
  const bar = root.querySelector<HTMLElement>('.bar')!
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]')
    if (!b) return
    e.preventDefault()
    const k = b.dataset.k!
    if (k === '__more') return toggleMenu()
    if (k === '__x') {
      if (longPressed) return void (longPressed = false)
      return hide()
    }
    press(k)
  })
  // ×：右键或按住半秒出小菜单（这个网站不弹、哪里都不弹）
  bar.addEventListener('contextmenu', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k="__x"]')
    if (!b) return
    e.preventDefault()
    e.stopPropagation()
    openX()
  })
  bar.addEventListener('pointerdown', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k="__x"]')
    if (!b || e.button !== 0) return
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => {
      longPressed = true
      openX()
    }, 500)
  })
  bar.addEventListener('pointerup', () => clearTimeout(pressTimer))
  bar.addEventListener('pointerleave', () => clearTimeout(pressTimer))
  bar.addEventListener('mouseover', (e) => {
    const clip = (e.target as Element).closest('button[data-k="clip"]')
    if (!clip) return
    clearTimeout(tipTimer)
    tipTimer = setTimeout(showTip, 300)
  })
  bar.addEventListener('mouseout', (e) => {
    if ((e.target as Element).closest('button[data-k="clip"]')) hideTip()
  })
  for (const m of Array.from(root.querySelectorAll<HTMLElement>('.menu')))
    m.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-k]')
      if (!b) return
      e.preventDefault()
      const k = b.dataset.k!
      if (k === 'section') {
        const r = sectionRange(window.getSelection()!)
        if (r && pending) {
          const sel = window.getSelection()!
          sel.removeAllRanges()
          sel.addRange(r)
          update()
          return act('clip')
        }
        return
      }
      press(k)
    })
  document.documentElement.appendChild(host)
}

/** 小条上、⋯ 里点了一颗（或 × 小菜单里的一项） */
function press(k: string) {
  if (k === 'only') {
    if (!pending) return
    const { text, rect } = pending
    hide()
    return translateSelection(text.trim(), rect)
  }
  if (k === '__trset') return act('settings')
  if (k === '__target') return act('target')
  if (k === '__add') return act('add')
  if (k === '__set') return act('barset')
  if (k === '__site') return act('mute-site')
  if (k === '__all') return act('mute-all')
  if (k === 'explain' || k === 'translate' || k === 'quote' || k === 'clip' || k === 'copy') return act(k)
  if (allBtns().some((b) => b.id === k && b.mine)) act('cmd', k)
}

const LEGACY: Record<string, string> = { explain: 'ex', translate: 'tr2', quote: 'qt', clip: 'clip' }

function btnHtml(b: WebBarBtn, fold: boolean): string {
  const key = b.id === 'quote' ? pageKey('quote-selection') : b.id === 'clip' ? pageKey('clip-selection') : b.key
  // 自带的几颗照旧带原来的类名（ex、tr2、qt、clip：别处的测试、截图脚本按它找）
  const cls = [LEGACY[b.id] ?? '', fold ? 'fold' : '', spec.fresh === b.id || shownFresh === b.id ? 'new' : ''].filter(Boolean).join(' ')
  return `<button data-k="${escapeHtml(b.id)}"${cls ? ` class="${cls}"` : ''} aria-label="${escapeHtml(b.label)}">${iconOf(b.icon)}<span class="lb">${escapeHtml(b.label)}</span>${kbd(key)}</button>`
}

function render() {
  if (!root) return
  const bar = root.querySelector<HTMLElement>('.bar')!
  bar.setAttribute('aria-label', spec.text.bar)
  bar.style.setProperty('--acc', spec.acc)
  // 窄了先收的：自己加的、翻译 + 讲一讲、剪藏（只留图标，再不够收进 ⋯）
  const fold = (b: WebBarBtn) => b.mine || b.id === 'translate' || b.id === 'clip'
  bar.innerHTML =
    spec.main.map((b) => btnHtml(b, fold(b))).join('') +
    (spec.tail.length ? '<span class="sep t"></span>' + spec.tail.map((b) => btnHtml(b, fold(b))).join('') : '') +
    `<span class="sep"></span><button class="ico more" data-k="__more" aria-label="${escapeHtml(spec.text.more)}" aria-haspopup="menu">${MORE}</button>` +
    `<button class="ico x" data-k="__x" aria-label="${escapeHtml(spec.text.close)}" title="${escapeHtml(spec.text.close)}" aria-haspopup="menu">${CLOSE}</button>`
  root.querySelector('.more-menu')!.setAttribute('aria-label', spec.text.menu)
  root.querySelector('.x-menu')!.setAttribute('aria-label', spec.text.xmenu)
  if (menuOpen) renderMenu()
}

function item(k: string, icon: string, label: string, right = '') {
  return `<button role="menuitem" data-k="${escapeHtml(k)}">${icon}<span>${escapeHtml(label)}</span>${right ? `<span class="r">${escapeHtml(right)}</span>` : ''}</button>`
}

function renderMenu() {
  const menu = root!.querySelector<HTMLElement>('.more-menu')!
  const T = spec.text
  // 窄得放不下自己加的、「翻译 + 讲一讲」「剪藏」时，它们收进这里（排在最前）
  const folded = root!.querySelector('.bar')!.classList.contains('tightest')
  const foldedBtns = folded ? [...spec.main, ...spec.tail].filter((b) => b.mine || b.id === 'translate' || b.id === 'clip') : []
  // 选着（或光标在）一个标题：「剪整节」排第一，这个标题到下一个同级标题之间的全部剪进来（含公式、代码、图）
  const section = sectionRange(window.getSelection()!) ? [item('section', QUOTE, T.section), '<div class="ms"></div>'] : []
  const right = (b: WebBarBtn) => b.right ?? (b.id === 'clip' ? (pageKey('clip-selection') ?? '') : (b.key ?? ''))
  const rows = spec.more.filter((b) => b.id !== 'only' || pluginEnabled('translate')).map((b) => item(b.id, iconOf(b.icon), b.label, right(b)))
  menu.innerHTML = [
    ...section,
    ...(foldedBtns.length ? [...foldedBtns.map((b) => item(b.id, iconOf(b.icon), b.label, right(b))), '<div class="ms"></div>'] : []),
    ...rows,
    rows.length ? '<div class="ms"></div>' : '',
    item('__trset', GEAR, T.trSettings),
    item('__target', FILE, T.target, clipTo.target ?? ''),
    '<div class="ms"></div>',
    item('__add', codiconSvg('add'), T.add, T.addR),
    item('__set', codiconSvg('list-selection'), T.settings),
  ].join('')
}

/** 菜单贴在小条下面 6、右边和那一颗对齐；左边出了网页往右挪，下面放不下放到小条上面 */
function placeUnder(menu: HTMLElement, under: HTMLElement) {
  const bar = root!.querySelector<HTMLElement>('.bar')!
  menu.style.display = 'block'
  const hb = host!.getBoundingClientRect()
  const mb = under.getBoundingClientRect()
  const w = menu.offsetWidth
  menu.style.left = `${Math.max(4 - hb.left, mb.right - hb.left - w)}px`
  const below = bar.offsetHeight + 6
  menu.style.top = hb.top + below + menu.offsetHeight > innerHeight - 4 ? `${-menu.offsetHeight - 6}px` : `${below}px`
}

function toggleMenu() {
  if (menuOpen) return closeMenu()
  if (!root) return
  closeMenu()
  hideTip()
  menuOpen = true
  renderMenu()
  const more = root.querySelector<HTMLElement>('.more')!
  more.classList.add('on')
  placeUnder(root.querySelector<HTMLElement>('.more-menu')!, more)
}

function openX() {
  if (!root) return
  closeMenu()
  hideTip()
  xOpen = true
  const T = spec.text
  const site = location.hostname.replace(/^www\./, '')
  const menu = root.querySelector<HTMLElement>('.x-menu')!
  menu.innerHTML = [
    item('__site', codiconSvg('globe'), fill(T.mute, 'site', site), T.muteR),
    item('__all', codiconSvg('eye-closed'), T.all, T.allR),
    '<div class="ms"></div>',
    `<div class="note">${escapeHtml(T.note).split('{link}').join(`<a data-k="__set">${escapeHtml(T.noteLink)}</a>`)}</div>`,
  ].join('')
  const x = root.querySelector<HTMLElement>('.x')!
  x.classList.add('on')
  placeUnder(menu, x)
}

function closeMenu() {
  menuOpen = false
  xOpen = false
  if (!root) return
  for (const m of Array.from(root.querySelectorAll<HTMLElement>('.menu'))) m.style.display = 'none'
  for (const b of Array.from(root.querySelectorAll('.bar button.on'))) b.classList.remove('on')
}

function showTip() {
  if (!root || menuOpen || xOpen) return
  const tip = root.querySelector<HTMLElement>('.tip')!
  const clip = root.querySelector<HTMLElement>('button[data-k="clip"]')
  if (!clip) return
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

/** 小条上点了一颗（或按了它的键）：交给软件。cmd：自己那颗的命令 */
function act(action: SelAction, cmd?: string) {
  if (!pending) return
  // 选好马上点（机器忙时 120ms 的防抖还没轮到，小条记着的还是拖到一半的选区）：照现在的选区取字
  const live = window.getSelection()
  if (live && !live.isCollapsed && live.rangeCount && !(live.anchorNode && host?.contains(live.anchorNode))) {
    const text = selectionText(live)
    const head = headAbove(live.getRangeAt(0).startContainer)
    if (text) pending = { ...pending, text, md: rangeToMd(live.getRangeAt(0), !clipKeepsTranslation()) || text, ...(head ? { head } : {}) }
  }
  // 小条没出来（名单上的网站、总开关关着时按的键）：「记到哪篇」贴着选区问
  const shown = host?.style.display === 'block'
  const b = shown ? host!.shadowRoot!.querySelector<HTMLElement>('.bar')!.getBoundingClientRect() : pending.rect
  const sel: WebSel = {
    action,
    ...(cmd ? { cmd } : {}),
    text: pending.text,
    ...(pending.md !== pending.text ? { md: pending.md } : {}),
    url: location.href,
    title: document.title,
    ...(pending.head ? { head: pending.head } : {}),
    bar: { x: b.left, y: b.top, w: b.width, h: b.height },
  }
  closeMenu()
  hideTip()
  // 剪藏、讲解这些：等软件定了记到哪篇（cn:sel-done）再收起小条、清掉选区；「剪到哪篇」「翻译设置」「拷贝」留着选区（接着点）；
  // 加一颗、小条设置、不弹：小条收起，选区留着
  waiting = action === 'explain' || action === 'translate' || action === 'quote' || action === 'clip' || action === 'cmd'
  if (action === 'add' || action === 'barset' || action === 'mute-site' || action === 'mute-all') {
    pending = null
    if (host) host.style.display = 'none'
  }
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
  shownFresh = null
  markSelBlocks(null)
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
  let range = sel.getRangeAt(0)
  // 拖到公式、代码块上松手（原生选区停在它前面的字上，公式本身选不上）：选区接到这一块为止
  const over = upAt && Date.now() - upAt.t < 800 ? blockAt(document.elementFromPoint(upAt.x, upAt.y)) : null
  if (over && !range.intersectsNode(over)) {
    const r = range.cloneRange()
    if (over.compareDocumentPosition(range.endContainer) & Node.DOCUMENT_POSITION_PRECEDING) r.setEndAfter(over)
    else r.setStartBefore(over)
    upAt = null
    sel.removeAllRanges()
    sel.addRange(r)
    range = r
  }
  const rects = range.getClientRects()
  const first = lineBox(rects[0] ?? range.getBoundingClientRect(), range.startContainer)
  const last = lineBox(rects[rects.length - 1] ?? range.getBoundingClientRect(), range.endContainer)
  ensure()
  // 选区里夹着的译文：「整页剪藏带上译文」关着时不算（只剪原文）
  const head = headAbove(range.startContainer)
  const plain = selectionText(sel)
  pending = { text: plain, md: rangeToMd(range, !clipKeepsTranslation()) || plain, rect: range.getBoundingClientRect(), ...(head ? { head } : {}) }
  // MathJax 3 的公式原文先记到容器上（点小条时取字用得到）
  void tagMathJax()
  markSelBlocks(range)
  // 选着字时角上那颗「引用」「剪藏」收起（小条接手）；拖选时停在公式上排着的那一下也取消
  clearTimeout(pickTimer)
  if (pickHost) pickHost.style.display = 'none'
  closeMenu()
  hideTip()
  // 名单上的网站、总开关关着：不弹（选区记着，↵、⌘↵ 这些键照样能用）
  if (muted()) {
    host!.style.display = 'none'
    return
  }
  render()
  host!.style.display = 'block'
  // 刚存好的那一颗：这次描一圈强调色，以后不再描
  if (spec.fresh && allBtns().some((b) => b.id === spec.fresh)) {
    shownFresh = spec.fresh
    ipcRenderer.sendToHost('cn:bar-seen', spec.fresh)
    spec = { ...spec, fresh: null }
  }
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
// 整页剪藏前先把 MathJax 3 的公式原文记到容器上
setBeforeExtract(tagMathJax)
/** 刚在哪儿松开鼠标（拖选到公式、代码块上松手时把它接进选区） */
let upAt: { x: number; y: number; t: number } | null = null
window.addEventListener('mouseup', (e) => (upAt = { x: e.clientX, y: e.clientY, t: Date.now() }), true)
// 书签管家的页面（新网页标签）：给它补上 chrome.* 接口，不出小条
if (location.protocol === 'cn-ext:') installExtPage()
else {
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer)
    timer = setTimeout(update, 120)
  })
  window.addEventListener('scroll', () => pending && update(), true)
  // 点了小条以外的地方：「⋯」收起
  window.addEventListener('pointerdown', (e) => (menuOpen || xOpen) && host && !e.composedPath().includes(host) && closeMenu(), true)
  // 选中一段后：↵ 讲解一下、⌘↵ 引用、⌘S 剪藏（CN-42 起小条上的键）；捕获阶段先接，网页自己收不到这一下
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && (menuOpen || xOpen)) {
        e.preventDefault()
        return closeMenu()
      }
      // 还在问记到哪篇：键交给那个弹层（回车是「记到这篇」），这里不再讲解一遍
      if (waiting) return
      const bare = e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing
      // 自己加的那几颗（条上、⋯ 里的）设的键
      const combo = e.isComposing ? null : comboOf(e)
      const own = combo ? allBtns().find((b) => b.mine && b.key === combo) : undefined
      const action: SelAction | null = isPageKey(e, 'quote-selection') ? 'quote' : isPageKey(e, 'clip-selection') ? 'clip' : own ? 'cmd' : bare ? 'explain' : null
      if (!action || typingInPage() || (bare && onControl())) return
      // 选区变了小条还没跟上（120ms 防抖）：先按现在的选区算一次
      if (!pending) update()
      if (!pending) return
      e.preventDefault()
      e.stopImmediatePropagation()
      act(action, own?.id)
    },
    true,
  )
  onPluginState(() => menuOpen && renderMenu())
  onPageKeys(() => render())
  onAiLogo(() => render())
}

// ---------------------------------------------------------------- 单独一个公式、代码块
// 鼠标停在公式、代码块上：角上出小「引用」「剪藏」（照小条的样子）；点一下公式、代码块整块选中，小条出来，⌘S、⌘↵ 照常
let pickHost: HTMLDivElement | null = null
let picked: Element | null = null
let pickTimer: ReturnType<typeof setTimeout> | undefined
function pickBar(): HTMLDivElement {
  if (pickHost) return pickHost
  pickHost = document.createElement('div')
  pickHost.id = 'cn-block-host'
  pickHost.style.cssText = 'position:fixed;z-index:2147483646;left:0;top:0;display:none'
  const root = pickHost.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    :host{all:initial}
    .bar{display:flex;align-items:center;height:26px;padding:0 2px;border-radius:999px;background:#111113;color:#fff;font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.18);white-space:nowrap}
    button{display:flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover{background:#2a2a2e}
    svg{width:13px;height:13px}
  </style><div class="bar" role="toolbar" aria-label="这一块"><button data-k="quote">${COMMENT}引用</button><button data-k="clip">${QUOTE}剪藏</button></div>`
  for (const b of Array.from(root.querySelectorAll('button'))) b.addEventListener('mousedown', (e) => e.preventDefault())
  root.querySelector('.bar')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]')
    if (!b || !picked) return
    selectBlock(picked)
    update()
    pickHost!.style.display = 'none'
    act(b.dataset.k as SelAction)
  })
  document.documentElement.appendChild(pickHost)
  return pickHost
}
/**
 * 角上那颗放在块里右上角、离上边右边各 4（不盖上一行字）；块矮（不到 34，行内公式）放不进去：放到块下面 4、右边对齐
 */
function showPick(el: Element) {
  // 小条出来了（拖选经过公式时排下的这一下晚到）：不出
  if (pending) return
  const h = pickBar()
  picked = el
  h.style.display = 'block'
  const r = el.getBoundingClientRect()
  const w = h.offsetWidth
  const inside = r.height >= 34
  const left = inside ? r.right - 4 - w : r.right - w
  const top = inside ? r.top + 4 : r.bottom + 4
  h.style.transform = `translate(${Math.max(4, Math.min(left, innerWidth - w - 4))}px, ${Math.max(4, Math.min(top, innerHeight - h.offsetHeight - 4))}px)`
}
if (location.protocol !== 'cn-ext:') {
  document.addEventListener('mouseover', (e) => {
    if (pending) return
    const el = blockAt(e.target)
    if (el === picked && pickHost?.style.display === 'block') return
    clearTimeout(pickTimer)
    if (el) pickTimer = setTimeout(() => showPick(el), 250)
    else if (!(e.target instanceof Element && e.target.closest('#cn-block-host'))) {
      picked = null
      if (pickHost) pickHost.style.display = 'none'
    }
  })
  document.addEventListener('click', (e) => {
    const el = blockAt(e.target)
    const sel = window.getSelection()
    if (!el || !sel || !sel.isCollapsed) return
    selectBlock(el)
  })
}
