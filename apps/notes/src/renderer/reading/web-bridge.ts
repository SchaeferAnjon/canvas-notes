/**
 * 右栏网页和「读」之间的桥：
 * - 阅读视图：向网页预加载要正文块（preload/webview-reader.ts 回 cn:read:page）；
 * - 框着问：网页里按住 ⌘ 框好一块，预加载发 cn:read:box，这里截那一块的图、交给订阅的人（App 决定进哪个 AI、笔记记到哪）。
 */
import type { ReaderPage, WebBox } from '../../shared/web-reader'
import type { WebviewEl } from '../web/WebView'

let seq = 0
const waiting = new Map<number, { resolve(p: ReaderPage): void; reject(e: Error): void }>()

export type BoxAction = 'stage' | 'explain' | 'translate' | 'quote' | 'copy' | 'settings' | 'cancel'
export interface WebBoxEvent {
  action: BoxAction
  box?: WebBox
  wcId: number
  /** 发来的那个网页（问完记到哪篇以后收起它的框：clearWebBox） */
  view: WebviewEl
}
const subs = new Set<(e: WebBoxEvent) => void>()

export function onWebBox(cb: (e: WebBoxEvent) => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function webReadIpc(el: WebviewEl, channel: string, args: unknown[]) {
  if (channel === 'cn:read:page') {
    const [id, page, error] = args as [number, ReaderPage | null, string | null]
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    if (page && Array.isArray(page.blocks)) w.resolve(page)
    else w.reject(new Error(error ?? '网页正文抽不出来'))
  } else if (channel === 'cn:read:box') {
    const b = args[0] as (Partial<WebBox> & { action?: BoxAction }) | undefined
    if (!b?.action) return
    let wcId: number
    try {
      wcId = el.getWebContentsId()
    } catch {
      return
    }
    const ok = b.rect && typeof b.url === 'string' && typeof b.text === 'string'
    // 工具条在哪：四个数都对才用
    const bar = b.bar
    if (bar && ![bar.x, bar.y, bar.w, bar.h].every((n) => typeof n === 'number' && Number.isFinite(n))) delete b.bar
    for (const s of subs) s({ action: b.action, wcId, view: el, ...(ok ? { box: b as WebBox } : {}) })
  }
}

/** 这个网页的正文块（阅读视图） */
export function readerOf(el: WebviewEl): Promise<ReaderPage> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('网页太久没回应，阅读视图没打开'))
    }, 20_000)
    waiting.set(id, {
      resolve: (p) => (clearTimeout(t), resolve(p)),
      reject: (e) => (clearTimeout(t), reject(e)),
    })
    el.send('cn:reader', id)
  })
}

/** 网页那边的框和工具条收起来（发出去了、取消了） */
export function clearWebBox(el: WebviewEl | null) {
  el?.send('cn:read:clear')
}

// ---------------------------------------------------------------- 阅读视图开在中间栏

/** 开着的阅读视图的正文（按网址）；重开软件后没有，要回网页再开一次 */
const pages = new Map<string, ReaderPage>()
const openSubs = new Set<(p: ReaderPage) => void>()
export const readerPage = (url: string) => pages.get(url) ?? null

export function onOpenWebRead(cb: (p: ReaderPage) => void): () => void {
  openSubs.add(cb)
  return () => openSubs.delete(cb)
}

/** 右栏网页 → 中间栏「<标题> · 阅读视图」 */
export async function openWebRead(el: WebviewEl) {
  const p = await readerOf(el)
  if (!p.blocks.some((b) => b.kind === 'text' || b.kind === 'heading')) throw new Error('这一页没抽出正文，阅读视图打不开')
  pages.set(p.url, p)
  for (const s of openSubs) s(p)
}
