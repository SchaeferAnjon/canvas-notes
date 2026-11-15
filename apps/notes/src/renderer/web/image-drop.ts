/**
 * 图片拖进白板 / 文档、粘贴进来：从 DataTransfer 里认出图，存进库里的「附件/」，再写成 md。
 * 网页里拖出来的有 text/uri-list、text/html；访达拖进来的、剪贴板里的是文件。
 * 网页预加载在开始拖时会把图的地址、说明、网页标题报上来（noteWebDrag），落下时用来写来源。
 */
import { relativeLink } from '@cn/format'
import { mdUrl } from '../../shared/layout'
import type { ImageSource } from '../../shared/web-api'

export interface WebDragInfo {
  src: string
  alt: string
  url: string
  title: string
}

let lastDrag: (WebDragInfo & { at: number }) | null = null
/** 刚放下的网页图：同一次拖动真 drop 和补发的 drop 都来时只放一张 */
let lastPlaced: { src: string; at: number } | null = null
let currentPage: { url: string; title: string } | null = null

/** 网页里开始拖一张图 */
export function noteWebDrag(info: WebDragInfo) {
  lastDrag = { ...info, at: Date.now() }
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * 网页里拖出来的图在界面上松手了（x、y 是界面里的坐标）。从 webview 拖出来时界面有时收不到真的 drop，
 * 这里在落点那个元素上补发一次和真拖放一样的 dragover / drop，白板和文档按原来的路子接住。
 * 真的 drop 已经接住了（lastDrag 被用掉）就什么都不做；两边都来了，imagesFrom 只认第一次。
 */
export function dropWebDragAt(x: number, y: number) {
  const d = lastDrag
  if (!d || Date.now() - d.at > 60_000) return
  const el = document.elementFromPoint(x, y)
  if (!el || el.closest('webview')) return
  const dt = new DataTransfer()
  dt.setData('text/uri-list', d.src)
  dt.setData('text/html', `<img src="${attr(d.src)}" alt="${attr(d.alt)}">`)
  for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
}

/** 右栏当前的网页（拖的时候没报上来，就当图来自这个网页） */
export function setCurrentPage(p: { url: string; title: string } | null) {
  currentPage = p
}

export interface ImageCandidate {
  src: ImageSource
  alt: string
  /** 来自网页：写一行来源 */
  source?: { title: string; url: string }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i

/** 只关心类型（dragover 时拿不到内容）：像是有图可以落下 */
export function mayHaveImage(types: readonly string[]): boolean {
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html')
}

/** 落下时（能读内容了）：里面真有图 */
export function looksLikeImage(dt: DataTransfer): boolean {
  if (Array.from(dt.files ?? []).some((f) => f.type.startsWith('image/'))) return true
  if (/<img\s/i.test(dt.getData('text/html'))) return true
  const uri = firstUri(dt.getData('text/uri-list'))
  return !!uri && (IMG_EXT.test(uri) || uri.startsWith('data:image/') || (!!lastDrag && uri === lastDrag.src))
}

/** html 里第一张图的地址和说明 */
export function imgFromHtml(html: string, base?: string): { src: string; alt: string } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const img = doc.querySelector('img[src]')
  if (!img) return null
  const raw = img.getAttribute('src')!
  let src = raw
  try {
    src = new URL(raw, base).href
  } catch {
    // 相对地址又没有 base：原样
  }
  return { src, alt: (img.getAttribute('alt') ?? img.getAttribute('title') ?? '').trim() }
}

function firstUri(list: string): string | null {
  return (
    list
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) ?? null
  )
}

/**
 * 从拖放 / 粘贴的数据里认图。文件优先（访达、截图），再看 html 里的 <img>，再看网址本身像不像图。
 * now 只给测试用。
 */
export async function imagesFrom(dt: DataTransfer, now = Date.now()): Promise<ImageCandidate[]> {
  const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'))
  if (files.length) {
    return Promise.all(
      files.map(async (f) => ({
        src: { kind: 'bytes', bytes: new Uint8Array(await f.arrayBuffer()), type: f.type, name: f.name } as ImageSource,
        alt: f.name.replace(/\.[a-z0-9]+$/i, ''),
      })),
    )
  }
  const drag = lastDrag && now - lastDrag.at < 60_000 ? lastDrag : null
  const html = dt.getData('text/html')
  const uri = firstUri(dt.getData('text/uri-list'))
  const fromHtml = html ? imgFromHtml(html, drag?.url ?? currentPage?.url) : null
  let src: string | null = null
  let alt = ''
  if (fromHtml) ({ src, alt } = fromHtml)
  else if (uri && (IMG_EXT.test(uri) || uri === drag?.src || uri.startsWith('data:image/'))) src = uri
  if (!src || !/^(https?:|data:image\/)/i.test(src)) return []
  // 同一次拖动的第二个 drop（补发的和真的都到了）：这次拖动已经被用掉，图又是同一张
  if (!drag && lastPlaced && lastPlaced.src === src && now - lastPlaced.at < 3000) return []
  lastPlaced = { src, at: now }
  const page = drag && (drag.src === src || drag.src === uri) ? { url: drag.url, title: drag.title } : (currentPage ?? null)
  if (drag && drag.src === src && !alt) alt = drag.alt
  lastDrag = null
  return [{ src: { kind: 'url', url: src }, alt, ...(page && /^https?:/.test(page.url) ? { source: { title: page.title || page.url, url: page.url } } : {}) }]
}

/**
 * 存好的图写成 md：![说明](相对路径)，来自网页的再加一行来源。
 * 白板卡片里来源紧跟在下一行；文档里图片要单独成段才画得出来，来源另起一段（sep 传空行）。
 */
export function imageMarkdown(notePath: string, saved: string, c: { alt: string; source?: { title: string; url: string } }, sep = '\n'): string {
  const alt = c.alt.replace(/[\[\]\n]/g, ' ').trim()
  const link = mdUrl(relativeLink(notePath, saved))
  const src = c.source ? `${sep}—— [${(c.source.title || c.source.url).replace(/[\[\]\n]/g, ' ').trim()}](${mdUrl(c.source.url)})` : ''
  return `![${alt}](${link})${src}`
}

/** 认出来的图逐张存进附件，返回写好的 md 片段；存失败的那张报错原因 */
export async function saveImages(notePath: string, cands: ImageCandidate[], sep = '\n'): Promise<{ md: string[]; errors: string[] }> {
  const md: string[] = []
  const errors: string[] = []
  for (const c of cands) {
    try {
      const { path } = await window.cnWeb.saveImage(c.src, c.alt || undefined)
      md.push(imageMarkdown(notePath, path, c, sep))
    } catch (e) {
      errors.push(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return { md, errors }
}
