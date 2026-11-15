/**
 * 右栏网页里的预加载（隔离环境，网页碰不到）：选中一段文字时，在选区上方 6px 弹出黑色胶囊工具条。
 * 白板标签里是「剪成卡片 · 到：收件箱」，文档标签里是「剪进文档 · 插到：<文档> · 光标处」；点了把选中的文字交给软件。
 * 双语翻译插件开着时，工具条右边多一个「翻译」，点了在选区下面弹译文小卡片。
 */
import { ipcRenderer } from 'electron'
import { onPluginState, pluginEnabled } from './plugins/state'
import { translateSelection } from './plugins/translate'
import './webview-page'

type Mode = { mode: 'inbox' | 'doc'; target?: string }
let mode: Mode = { mode: 'inbox' }
ipcRenderer.on('cn:mode', (_e, m: Mode) => {
  mode = m
  if (host) render()
})

let host: HTMLDivElement | null = null
let button: HTMLButtonElement | null = null
let trButton: HTMLButtonElement | null = null
let pending: { text: string; rect: DOMRect } | null = null

const SCISSORS = '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>'
const QUOTE = '<svg viewBox="0 0 24 24"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></svg>'
/** Lucide languages */
const LANGUAGES = '<svg viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>'

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-clip-host'
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;display:none'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    .bar{position:relative;display:flex;align-items:center;height:30px;border-radius:999px;background:#111113;color:#fff;
      font:500 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.18),0 12px 28px -8px rgba(0,0,0,.35);white-space:nowrap}
    .bar::after{content:"";position:absolute;left:16px;bottom:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#111113}
    button{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:999px;background:none;color:inherit;font:inherit;cursor:pointer}
    button:hover{background:#2a2a2e}
    button span{opacity:.6;font-weight:400}
    .tr{position:relative;padding:0 12px 0 11px}
    .tr::before{content:"";position:absolute;left:0;top:8px;bottom:8px;border-left:1px solid rgba(255,255,255,.2)}
    .tr[hidden]{display:none}
    svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  </style><div class="bar" part="bar"><button class="clip"></button><button class="tr" hidden>${LANGUAGES}翻译</button></div>`
  button = root.querySelector<HTMLButtonElement>('button.clip')!
  trButton = root.querySelector<HTMLButtonElement>('button.tr')!
  for (const b of [button, trButton]) b.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    if (!pending) return
    ipcRenderer.sendToHost('cn:clip', { text: pending.text, url: location.href, title: document.title })
    hide()
    window.getSelection()?.removeAllRanges()
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
  if (!button || !trButton) return
  trButton.hidden = !pluginEnabled('translate')
  button.innerHTML =
    mode.mode === 'doc'
      ? `${QUOTE}剪进文档<span>· 插到：${escapeHtml(mode.target ?? '文档')} · 光标处</span>`
      : `${SCISSORS}剪成卡片<span>· 到：收件箱</span>`
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
  render()
  pending = { text: sel.toString(), rect: range.getBoundingClientRect() }
  host!.style.display = 'block'
  const h = 30
  const top = Math.max(4, rect.top - h - 6)
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 400))
  host!.style.transform = `translate(${left}px, ${top}px)`
}

let timer: ReturnType<typeof setTimeout> | undefined
document.addEventListener('selectionchange', () => {
  clearTimeout(timer)
  timer = setTimeout(update, 120)
})
window.addEventListener('scroll', () => pending && update(), true)
onPluginState(() => render())
