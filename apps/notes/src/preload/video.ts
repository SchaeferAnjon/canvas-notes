/**
 * 视频页里的那半（隔离环境，网页脚本碰不到）：
 * - 双语字幕层：主进程推来字幕和译文，按播放时间画在画面上（或画面下面一条）；网站自己的字幕在我们开着时藏起来。
 * - 每 250 毫秒告诉界面播到哪、视频在网页里的位置（刻度条、问话框要用）；每 2 秒告诉主进程（记「看到哪」）。
 * - 界面发来的命令：跳到某一秒、播放 / 暂停、进退 5 秒、框一块（⌥D）、记下时闪一下。
 * 字幕和框都画在 shadow DOM 里，网站的样式碰不到，也不改网站的页面结构。
 */
import { ipcRenderer } from 'electron'

type Row = [number, number, string, string]
interface Subs {
  key: string
  cues: Row[]
  mode: 'bi' | 'tr' | 'orig' | 'off'
  place: 'over' | 'below'
  style: string
  site: 'youtube' | 'bilibili'
}

let subs: Subs | null = null
let hideOurs = false
let host: HTMLDivElement | null = null
let root: ShadowRoot | null = null
let siteCss: HTMLStyleElement | null = null

const CSS = `
:host{all:initial}
.layer{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}
.subs{position:absolute;left:6%;right:6%;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.subs span{display:inline-block;max-width:100%;padding:2px 8px;border-radius:4px;background:rgba(8,8,10,.72);color:#fff;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.subs .t{font-size:15px;line-height:1.45;font-weight:500}
.subs .o{font-size:12px;line-height:1.45;color:rgba(255,255,255,.86)}
.below{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 16px;background:#000;text-align:center;box-sizing:border-box}
.below .t{font-size:14px;line-height:1.5;font-weight:500;color:#fff}
.below .o{font-size:12px;line-height:1.5;color:rgba(255,255,255,.75)}
.s-underline .t{text-decoration:underline;text-decoration-color:rgba(255,255,255,.5);text-underline-offset:3px}
.s-dashed .t{outline:1px dashed rgba(255,255,255,.55);outline-offset:-1px}
.s-marker .t{background:rgba(201,139,219,.42)}
.s-bar .t{border-left:2px solid #C98BDB}
.s-fade .o{opacity:.55}
.flash{position:absolute;background:#fff;opacity:0;transition:opacity .25s}
.flash.on{opacity:.55;transition:none}
.box{position:absolute;pointer-events:auto;cursor:crosshair}
.box .tip{position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:5px 12px;border-radius:999px;background:rgba(8,8,10,.78);color:#fff;font-size:12px;white-space:nowrap}
.box .sel{position:absolute;border:2px solid #9A48AD;box-shadow:0 0 0 9999px rgba(0,0,0,.35);border-radius:2px}
.box.dim{background:rgba(0,0,0,.35)}
`

function ensure() {
  if (host) return
  host = document.createElement('div')
  host.id = 'cn-video-host'
  root = host.attachShadow({ mode: 'open' })
  // 不用 innerHTML：YouTube 开了 Trusted Types，拼 HTML 字符串会被拦
  const style = document.createElement('style')
  style.textContent = CSS
  const layer = div('layer')
  layer.append(div('flash'), div('subs'), div('below'))
  ;(layer.lastChild as HTMLElement).hidden = true
  root.append(style, layer)
  document.documentElement.appendChild(host)
}

/** 页面上最大的那个 <video>（YouTube、B 站的播放器） */
function mainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null
  let area = 0
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect()
    if (r.width * r.height > area) {
      area = r.width * r.height
      best = v
    }
  }
  return best
}

/** 视频在窗口里的位置：播放器外框（YouTube、B 站的视频元素有时比画面大，用播放器的框） */
function playerRect(v: HTMLVideoElement): DOMRect {
  const box = v.closest('#movie_player, .bpx-player-video-area, .bpx-player-container, .html5-video-player') as HTMLElement | null
  const r = (box ?? v).getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  return box && r.height > 0 ? r : vr
}

function at(t: number): Row | null {
  const c = subs?.cues
  if (!c?.length) return null
  let lo = 0
  let hi = c.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (c[mid]![0] <= t) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (hit === -1) return null
  const row = c[hit]!
  return t <= Math.max(row[1], row[0]) + 1.2 ? row : null
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  if (text !== undefined) d.textContent = text
  return d
}

function line(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span')
  s.className = cls
  s.textContent = text
  return s
}

let lastHtml = ''
function draw() {
  const v = mainVideo()
  if (!subs || !v) {
    if (host) host.style.display = 'none'
    return
  }
  ensure()
  host!.style.display = ''
  const r = playerRect(v)
  const layer = root!.querySelector<HTMLElement>('.layer')!
  layer.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`
  const box = root!.querySelector<HTMLElement>('.subs')!
  const below = root!.querySelector<HTMLElement>('.below')!
  const row = !hideOurs && subs.mode !== 'off' ? at(v.currentTime) : null
  const tr = row?.[3] ?? ''
  const showT = !!row && (subs.mode === 'bi' || subs.mode === 'tr') && !!tr
  const showO = !!row && (subs.mode === 'bi' || subs.mode === 'orig' || (subs.mode === 'tr' && !tr))
  const key = row ? `${showT ? tr : ''}\u0001${showO ? row[2] : ''}` : ''
  const target = subs.place === 'below' ? below : box
  const other = subs.place === 'below' ? box : below
  if (other.firstChild) other.replaceChildren()
  below.hidden = subs.place !== 'below' || !key
  if (key !== lastHtml || !!key !== !!target.firstChild) {
    target.replaceChildren(...(row ? [...(showT ? [line('t', tr)] : []), ...(showO ? [line('o', row[2])] : [])] : []))
    lastHtml = key
  }
  target.className = `${subs.place === 'below' ? 'below' : 'subs'} s-${subs.style}`
  if (subs.place === 'below') {
    below.style.cssText = `left:0;top:${r.height}px;width:${r.width}px`
  } else {
    // 控制条出来时往上让
    const controls = !document.querySelector('#movie_player.ytp-autohide, .bpx-player-container[data-ctrl-hidden="true"]')
    box.style.bottom = `${controls ? 62 : 34}px`
  }
}

/**
 * B 站在右栏（窄于 1100）里：网页最小宽度 1100，播放器右边被切掉。让页面跟右栏同宽，播放器满宽、16:9，
 * 右边那一栏（选集、推荐）挪到下面。2026-11 的 B 站页面结构；网站改版要跟着改（real-video.spec.ts 盯着）。
 */
const BILI_NARROW = `@media (max-width:1099px){
html,body,#app,.app-v1,#biliMainHeader{min-width:0!important}
.bili-header,.bili-header__bar{min-width:0!important;overflow:hidden!important}
.video-container-v1{display:flex!important;flex-direction:column!important;min-width:0!important;width:100%!important;padding:0!important;margin:0!important;box-sizing:border-box}
.left-container{width:100%!important;min-width:0!important;padding:0!important;margin:0!important;position:static!important}
.right-container{width:auto!important;min-width:0!important;margin:0 12px!important;padding:0!important;position:static!important}
.left-container .video-info-container,.left-container .video-toolbar-container,.left-container .left-container-under-player{padding-left:12px!important;padding-right:12px!important}
#playerWrap,.player-wrap{width:100%!important;height:auto!important;padding:0!important}
#bilibili-player,.bpx-player-container:not([data-screen=full]):not([data-screen=web]){width:100%!important;max-width:100%!important;height:calc(100vw * 9 / 16 + 46px)!important;box-shadow:none!important}
}`

/** 我们的字幕开着时把网站自己的字幕藏起来；B 站的播放器跟右栏同宽 */
function applySiteCss() {
  const on = !!subs && subs.mode !== 'off' && subs.cues.length > 0
  const css = [
    on ? '.ytp-caption-window-container,.caption-window,.bpx-player-subtitle-wrap,.bili-subtitle-x-subtitle-panel-major-group{display:none!important}' : '',
    subs?.site === 'bilibili' ? BILI_NARROW : '',
  ].join('')
  if (!css) {
    siteCss?.remove()
    siteCss = null
    return
  }
  if (!siteCss) {
    siteCss = document.createElement('style')
    siteCss.id = 'cn-video-site'
    ;(document.head ?? document.documentElement).appendChild(siteCss)
  }
  if (siteCss.textContent !== css) siteCss.textContent = css
}

let raf = 0
function loop() {
  cancelAnimationFrame(raf)
  const tick = () => {
    draw()
    raf = requestAnimationFrame(tick)
  }
  if (subs) raf = requestAnimationFrame(tick)
  else draw()
}

ipcRenderer.on('video:subs', (_e, s: Subs | null) => {
  subs = s
  lastHtml = ''
  applySiteCss()
  loop()
})
ipcRenderer.on('video:tr', (_e, u: { key: string; list: [number, string][] }) => {
  if (!subs || subs.key !== u.key) return
  for (const [i, tr] of u.list) if (subs.cues[i]) subs.cues[i]![3] = tr
  lastHtml = ''
  applySiteCss()
})
ipcRenderer.on('video:hide-subs', (_e, on: boolean) => {
  hideOurs = on
  draw()
})

// ---------------------------------------------------------------- 报给界面和主进程

let lastMain = 0
setInterval(() => {
  if (!subs) return
  const v = mainVideo()
  if (!v) return
  const r = playerRect(v)
  ipcRenderer.sendToHost('cn:video', { type: 'tick', key: subs.key, t: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, paused: v.paused, rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
  if (Date.now() - lastMain > 2000 && !v.paused) {
    lastMain = Date.now()
    ipcRenderer.send('video:tick', subs.key, v.currentTime)
  }
}, 250)

// ---------------------------------------------------------------- 界面发来的命令

function flash() {
  ensure()
  const f = root!.querySelector<HTMLElement>('.flash')!
  const v = mainVideo()
  if (!v) return
  const r = playerRect(v)
  f.style.cssText = `left:0;top:0;width:${r.width}px;height:${r.height}px`
  f.classList.add('on')
  setTimeout(() => f.classList.remove('on'), 60)
}

let boxing: HTMLDivElement | null = null
function stopBox(report = true) {
  if (!boxing) return
  boxing.remove()
  boxing = null
  window.removeEventListener('keydown', onBoxKey, true)
  if (report) ipcRenderer.sendToHost('cn:video', { type: 'boxCancel' })
}
function onBoxKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  stopBox()
}

/** ⌥D：视频暂停，画面变十字光标，拖一个框；松手把框的位置（0 到 1）交给界面 */
function startBox() {
  const v = mainVideo()
  if (!v) return
  ensure()
  stopBox(false)
  v.pause()
  draw()
  const layer = root!.querySelector<HTMLElement>('.layer')!
  const b = document.createElement('div')
  b.className = 'box dim'
  b.style.cssText = 'left:0;top:0;right:0;bottom:0'
  b.append(div('tip', '拖一个框，框住想问的那块 · esc 取消'))
  layer.appendChild(b)
  boxing = b
  window.addEventListener('keydown', onBoxKey, true)
  let start: { x: number; y: number } | null = null
  let sel: HTMLDivElement | null = null
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    b.setPointerCapture(e.pointerId)
    const r = b.getBoundingClientRect()
    start = { x: e.clientX - r.left, y: e.clientY - r.top }
    b.classList.remove('dim')
    sel?.remove()
    sel = document.createElement('div')
    sel.className = 'sel'
    b.appendChild(sel)
  })
  b.addEventListener('pointermove', (e) => {
    if (!start || !sel) return
    const r = b.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left))
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top))
    sel.style.cssText = `left:${Math.min(x, start.x)}px;top:${Math.min(y, start.y)}px;width:${Math.abs(x - start.x)}px;height:${Math.abs(y - start.y)}px`
  })
  b.addEventListener('pointerup', (e) => {
    if (!start) return
    const r = b.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left))
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top))
    let box = { x: Math.min(x, start.x) / r.width, y: Math.min(y, start.y) / r.height, w: Math.abs(x - start.x) / r.width, h: Math.abs(y - start.y) / r.height }
    start = null
    // 点一下没拖：框整个画面
    if (box.w < 0.02 || box.h < 0.02) box = { x: 0, y: 0, w: 1, h: 1 }
    const tip = b.querySelector('.tip')
    tip?.remove()
    ipcRenderer.sendToHost('cn:video', { type: 'box', box, rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
  })
}

ipcRenderer.on('video:cmd', (_e, cmd: string, arg: unknown) => {
  const v = mainVideo()
  if (cmd === 'boxDone') return stopBox(false)
  if (!v) return
  if (cmd === 'seek' && typeof arg === 'number') {
    v.currentTime = Math.max(0, arg)
    if (v.paused) void v.play().catch(() => undefined)
  } else if (cmd === 'still' && typeof arg === 'number') {
    // 「接着问」：跳回那一秒停住
    v.pause()
    v.currentTime = Math.max(0, arg)
  } else if (cmd === 'toggle') {
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  } else if (cmd === 'skip' && typeof arg === 'number') v.currentTime = Math.max(0, v.currentTime + arg)
  else if (cmd === 'pause') v.pause()
  else if (cmd === 'play') void v.play().catch(() => undefined)
  else if (cmd === 'box') startBox()
  else if (cmd === 'flash') flash()
})

addEventListener('DOMContentLoaded', () => ipcRenderer.send('video:ready'))
addEventListener('resize', () => draw())
