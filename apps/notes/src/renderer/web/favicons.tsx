/**
 * 网站小图标：网页报上来的 favicon 按网站记在本机（只是缓存，丢了下次打开网页再记）；
 * 没记过的 https 网站先试 /favicon.ico，都没有就是中性的地球图标（不用首字母图标）。
 * 深色主题里很黑的图标（GitHub）垫一块 26×26 圆角 6 的白底；几乎透明、载不出来的当没有。
 */
import { Codicon, codiconEl } from '@cn/design'
import { useEffect, useState, useSyncExternalStore } from 'react'

const KEY = 'cn.favicons'
const MAX = 600

let map: Record<string, string> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    // 缓存读不出来：当没记过
    return {}
  }
})()
const subs = new Set<() => void>()

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return ''
  }
}

/** 界面的 CSP 只放行 https 和 data: 的图片 */
const usable = (u: string) => /^(https:|data:image\/)/.test(u)

/** webview 的 page-favicon-updated 报上来的 */
export function noteFavicon(pageUrl: string, icons: string[]) {
  const host = hostOf(pageUrl)
  const icon = icons.find(usable)
  if (!host || !icon || map[host] === icon) return
  const keys = Object.keys(map)
  const next = { ...(keys.length >= MAX ? Object.fromEntries(Object.entries(map).slice(keys.length - MAX + 1)) : map), [host]: icon }
  map = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存不下只是下次再记
  }
  subs.forEach((f) => f())
}

/** 编辑器里的部件（不是 React）用：网站小图标的 <img>，载不出来换成地球 */
export function faviconEl(url: string, size: number): HTMLElement {
  const src = guess(url)
  const globe = () => {
    const s = document.createElement('span')
    s.className = 'fav fav-none'
    s.style.cssText = `width:${size}px;height:${size}px`
    s.appendChild(codiconEl('globe', Math.round(size * 0.85)))
    return s
  }
  if (!src) return globe()
  const img = document.createElement('img')
  img.className = 'fav'
  img.width = size
  img.height = size
  img.alt = ''
  img.draggable = false
  img.src = src
  const swap = () => img.isConnected && img.replaceWith(globe())
  img.addEventListener('error', swap)
  img.addEventListener('load', () => img.naturalWidth <= 1 && swap())
  return img
}

function guess(url: string): string | null {
  const host = hostOf(url)
  if (!host) return null
  if (map[host]) return map[host]!
  return url.startsWith('https:') ? `https://${host}/favicon.ico` : null
}

// ---------------------------------------------------------------- 深浅
type Tone = 'dark' | 'light' | 'mid' | 'empty'
const tones = new Map<string, Tone>()
const toneSubs = new Set<() => void>()
let toneVer = 0

function askTone(src: string) {
  if (tones.has(src) || !src.startsWith('https:')) return
  tones.set(src, 'mid')
  void window.cnWeb.faviconTone(src).then((t) => {
    tones.set(src, t)
    toneVer++
    toneSubs.forEach((f) => f())
  })
}

/** 现在是不是深色主题（看 <html data-tone>） */
// 单元测试在 node 里会经 note-doc → cite 引到这里：没有 document 时不看主题（当浅色）
const hasDom = typeof document !== 'undefined'
let dark = hasDom && document.documentElement.dataset.tone === 'dark'
const darkSubs = new Set<() => void>()
if (hasDom)
  new MutationObserver(() => {
    const d = document.documentElement.dataset.tone === 'dark'
    if (d === dark) return
    dark = d
    darkSubs.forEach((f) => f())
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tone'] })

const sub = (set: Set<() => void>) => (f: () => void) => {
  set.add(f)
  return () => set.delete(f)
}
const subMap = sub(subs)
const subTone = sub(toneSubs)
const subDark = sub(darkSubs)

function None({ size }: { size: number }) {
  return (
    <span className="fav fav-none" style={{ width: size, height: size }} aria-hidden>
      <Codicon name="globe" size={Math.round(size * 0.8)} />
    </span>
  )
}

/** 一个网站的小图标 */
export function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  useSyncExternalStore(subMap, () => map)
  useSyncExternalStore(subTone, () => toneVer)
  const isDark = useSyncExternalStore(subDark, () => dark)
  const src = guess(url)
  const [broken, setBroken] = useState<string | null>(null)
  useEffect(() => {
    if (src) askTone(src)
  }, [src])
  const tone = src ? tones.get(src) : undefined
  if (!src || broken === src || tone === 'empty') return <None size={size} />
  const img = (
    <img
      className="fav"
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setBroken(src)}
      // 载出来只有 1 像素的（有的网站拿它占位）当没有
      onLoad={(e) => e.currentTarget.naturalWidth <= 1 && setBroken(src)}
    />
  )
  // 深色主题里很黑的、浅色主题里很白的：垫一块底，免得看不见
  if ((isDark && tone === 'dark') || (!isDark && tone === 'light'))
    return (
      <span className={'fav-back' + (isDark ? ' on-dark' : ' on-light')} aria-hidden>
        {img}
      </span>
    )
  return img
}
