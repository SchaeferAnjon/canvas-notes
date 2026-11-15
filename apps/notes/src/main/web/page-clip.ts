/**
 * 整页剪藏：右栏开着的网页，在网页的预加载里用 Readability 抽正文、Turndown 转成 md，
 * 这里拼成一篇收件箱笔记（frontmatter 带 created 和 source）。
 */
import { ipcMain, type WebContents } from 'electron'
import { mdUrl } from '../../shared/layout'

export interface ExtractedPage {
  url: string
  title: string
  byline?: string
  markdown: string
}

let seq = 0
const waiting = new Map<number, { wc: WebContents; resolve(p: ExtractedPage): void; reject(e: Error): void; timer: NodeJS.Timeout }>()

/** 网页预加载抽完正文发回来；要在 app ready 后调一次 */
export function listenForExtracts() {
  ipcMain.on('cn:extracted', (e, id: unknown, page: unknown, error: unknown) => {
    const w = typeof id === 'number' ? waiting.get(id) : undefined
    // 只认发请求的那个网页回的话
    if (!w || w.wc.id !== e.sender.id) return
    waiting.delete(id as number)
    clearTimeout(w.timer)
    if (typeof error === 'string') return w.reject(new Error(error))
    const p = page as Partial<ExtractedPage> | null
    if (!p || typeof p.markdown !== 'string' || typeof p.url !== 'string' || typeof p.title !== 'string') return w.reject(new Error('网页正文抽不出来'))
    w.resolve({ url: p.url, title: p.title, markdown: p.markdown, ...(typeof p.byline === 'string' && p.byline ? { byline: p.byline } : {}) })
  })
}

export function extractPage(wc: WebContents): Promise<ExtractedPage> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('网页太久没回应，没剪成'))
    }, 20_000)
    waiting.set(id, { wc, resolve, reject, timer })
    wc.send('cn:extract', id)
  })
}

/** 文件名：标题去掉网站名尾巴（「 - 知乎」「 | Medium」） */
export function clipFileName(title: string, url: string): string {
  const t = title.replace(/\s+[-|–—_·]\s+[^-|–—_·]{1,30}$/, '').trim()
  if (t) return t.slice(0, 60)
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '网页'
  }
}

/** 收件箱里那篇：frontmatter（created、source）+ 一级标题 + 来源行 + 正文 */
export function pageClipText(page: ExtractedPage, stamp: string): string {
  const title = page.title.trim() || page.url
  const safeTitle = title.replace(/[\[\]]/g, '')
  const src = mdUrl(page.url)
  let body = page.markdown.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  // 正文开头常是文章自己的标题（和上面的一级标题重复）：去掉
  const first = /^#{1,6}\s+(.+)\n*/.exec(body)
  if (first && title.includes(first[1]!.trim())) body = body.slice(first[0].length)
  const by = page.byline ? ` · ${page.byline.trim()}` : ''
  return `---\ncreated: ${stamp}\nsource: ${page.url}\n---\n# ${title}\n\n—— [${safeTitle}](${src})${by}\n\n${body}\n`
}
