/**
 * 右栏网页里的预加载（隔离环境，网页碰不到）：选中一段文字时，在选区上方 6px 弹出黑色胶囊工具条。
 * 白板标签里是「剪成卡片 · 到：收件箱」，文档标签里是「剪进文档 · 插到：<文档> · 光标处」；点了把选中的文字交给软件。
 * 双语翻译插件开着时，工具条右边多一个「翻译」，点了在选区下面弹译文小卡片；选的是一个词或短语时还有「加进术语表」。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { ipcRenderer } from 'electron'
import { aiLogoHtml, onAiLogo } from './ai-logo'
import { installExtPage } from './ext-page'
import { onPluginState, pluginEnabled } from './plugins/state'
import { addToGlossary, selectionText, translateSelection } from './plugins/translate'
import './webview-page'
import './video'
import './plugins/weread'
import './webview-reader'

type Mode = { mode: 'inbox' | 'doc'; target?: string }
let mode: Mode = { mode: 'inbox' }
ipcRenderer.on('cn:mode', (_e, m: Mode) => {
  mode = m
  if (host) render()
})

let host: HTMLDivElement | null = null
let button: HTMLButtonElement | null = null
let trButton: HTMLButtonElement | null = null
let termButton: HTMLButtonElement | null = null
let pending: { text: string; rect: DOMRect } | null = null

const CARD = codiconSvg('note')
const QUOTE = codiconSvg('quote')
const LANGUAGES = codiconSvg('whole-word')

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-clip-host'
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:max-content;display:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    .bar{position:relative;display:flex;align-items:center;height:30px;border-radius:999px;background:#111113;color:#fff;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.18),0 12px 28px -8px rgba(0,0,0,.35);white-space:nowrap}
    .bar::after{content:"";position:absolute;left:16px;bottom:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#111113}
    button{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover{background:#2a2a2e}
    button span{opacity:.6;font-weight:400}
    .tight kbd,.tighter button.clip span{display:none}
    kbd{margin-left:2px;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.14);font:11px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:rgba(255,255,255,.86)}
    .tr{position:relative;padding:0 12px 0 11px}
    .tr::before{content:"";position:absolute;left:0;top:8px;bottom:8px;border-left:1px solid rgba(255,255,255,.2)}
    .tr[hidden]{display:none}
    svg,img{width:14px;height:14px;flex:none}
  </style><div class="bar" part="bar"><button class="clip"></button><button class="tr" hidden></button><button class="tr term" hidden>加进术语表</button></div>`
  button = root.querySelector<HTMLButtonElement>('button.clip')!
  trButton = root.querySelector<HTMLButtonElement>('button.tr:not(.term)')!
  termButton = root.querySelector<HTMLButtonElement>('button.term')!
  for (const b of [button, trButton, termButton]) b.addEventListener('mousedown', (e) => e.preventDefault())
  termButton.addEventListener('click', (e) => {
    e.preventDefault()
    if (!pending) return
    const { text, rect } = pending
    hide()
    addToGlossary(text.trim(), rect)
  })
  button.addEventListener('click', (e) => {
    e.preventDefault()
    clip()
  })
  trButton.addEventListener('click', (e) => {
    e.preventDefault()
    if (!pending) return
    const { text, rect } = pending
    hide()
    translateSelection(text.trim(), rect)
  })
  document.documentElement.appendChild(host)
}

function render() {
  if (!button || !trButton || !termButton) return
  trButton.hidden = !pluginEnabled('translate')
  // 翻译交给「译 · 某家」跑：画它的标志，不知道是哪家时画「ab」
  trButton.innerHTML = `${aiLogoHtml('translate') ?? LANGUAGES}翻译`
  // 一个词或短语（不超过 6 个词、40 个字）才给「加进术语表」
  const t = pending?.text.trim() ?? ''
  termButton.hidden = trButton.hidden || !t || t.length > 40 || t.split(/\s+/).length > 6
  button.innerHTML =
    mode.mode === 'doc'
      ? `${QUOTE}剪进文档<span>· 插到：${escapeHtml(mode.target ?? '文档')} · 光标处</span><kbd>⌘↵</kbd>`
      : `${CARD}剪成卡片<span>· 到：收件箱</span><kbd>⌘↵</kbd>`
}

/** 小条上的主动作：剪进文档 / 剪成卡片（点按钮和 ⌘↵ 都走这里） */
function clip() {
  if (!pending) return
  ipcRenderer.sendToHost('cn:clip', { text: pending.text, url: location.href, title: document.title })
  hide()
  window.getSelection()?.removeAllRanges()
}

/** 焦点在网页自己的输入框里（评论框、搜索框）：⌘↵ 留给网页 */
function typingInPage(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test((el as HTMLInputElement).type))
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function hide() {
  pending = null
  if (host) host.style.display = 'none'
}

function update() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.isCollapsed || !text || sel.rangeCount === 0) return hide()
  if (host && sel.anchorNode && host.contains(sel.anchorNode)) return
  const range = sel.getRangeAt(0)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  ensure()
  // 选区里夹着的译文：「整页剪藏带上译文」关着时不算（只剪原文）
  pending = { text: selectionText(sel), rect: range.getBoundingClientRect() }
  render()
  host!.style.display = 'block'
  const h = 30
  const top = Math.max(4, rect.top - h - 6)
  // 网页窄（右栏 340）放不下整条：先去掉 ⌘↵ 键帽（快捷键照样能用），还放不下再去掉「· 插到：…」那句，再贴着右边摆
  const bar = host!.shadowRoot!.querySelector<HTMLElement>('.bar')!
  bar.classList.remove('tight', 'tighter')
  if (bar.offsetWidth > window.innerWidth - 8) bar.classList.add('tight')
  if (bar.offsetWidth > window.innerWidth - 8) bar.classList.add('tighter')
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - bar.offsetWidth - 4))
  host!.style.transform = `translate(${left}px, ${top}px)`
}

// 网页里按下鼠标、按 Esc：告诉软件，右栏开着的弹层收起（焦点在网页里时软件窗口自己收不到，CN-43）
window.addEventListener('pointerdown', () => ipcRenderer.sendToHost('cn:page-down'), true)
window.addEventListener('keydown', (e) => e.key === 'Escape' && ipcRenderer.sendToHost('cn:page-esc'), true)

let timer: ReturnType<typeof setTimeout> | undefined
// 书签管家的页面（新网页标签）：给它补上 chrome.* 接口，不出剪藏工具条
if (location.protocol === 'cn-ext:') installExtPage()
else {
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer)
    timer = setTimeout(update, 120)
  })
  window.addEventListener('scroll', () => pending && update(), true)
  // 选中一段后 ⌘↵ = 点小条上的主动作（CN-42）；捕获阶段先接，网页自己收不到这一下
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.isComposing) return
      if (typingInPage()) return
      // 选区变了小条还没跟上（120ms 防抖）：先按现在的选区算一次
      if (!pending) update()
      if (!pending) return
      e.preventDefault()
      e.stopImmediatePropagation()
      clip()
    },
    true,
  )
  onPluginState(() => render())
  onAiLogo(() => render())
}
