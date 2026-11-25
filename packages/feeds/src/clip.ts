/**
 * 存进画布笔记：写成和画布笔记「剪藏这一页」一字不差的一篇（frontmatter created + source、一级标题、来源行、正文）。
 *
 * 画布笔记的剪藏写法现在只在 apps/notes 里（`main/web/page-clip.ts` 的 pageClipText、clipFileName，`shared/layout.ts` 的 mdUrl，
 * `main/vault.ts` 的 localStamp），还没进 @cn/format；这一批不动画布笔记的文件，所以这里是逐字的一份，
 * test/clip-parity.test.ts 拿同一页同时跑两边、比字节。以后抽成共用包（packages/clip 或 @cn/format 的 web-clip.ts）时，
 * 这个文件整个换成从那里导入，测试不用改。
 */
import { relativeLink } from '@cn/format'

export interface ClipPage {
  url: string
  title: string
  byline?: string
  markdown: string
}

/** md 链接 (…) 里会断开的字符转掉（同 apps/notes shared/layout.ts mdUrl） */
export const mdUrl = (url: string) => url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))

/** 2026-11-15 14:03（同 apps/notes main/vault.ts localStamp，本地时间） */
export function localStamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 文件名：标题去掉网站名尾巴（「 - 知乎」「 | Medium」）（同 page-clip.ts clipFileName） */
export function clipFileName(title: string, url: string): string {
  const t = title.replace(/\s+[-|–—_·]\s+[^-|–—_·]{1,30}$/, '').trim()
  if (t) return t.slice(0, 60)
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '网页'
  }
}

/** frontmatter（created、source）+ 一级标题 + 来源行 + 正文（同 page-clip.ts pageClipText） */
export function pageClipText(page: ClipPage, stamp: string): string {
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

/** 文件名里不能有的字换成空格，空的叫「未命名」（同 apps/notes shared/file-name.ts safeName） */
export function safeName(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return s || '未命名'
}

const LINKED_IMAGE = /\[(!\[[^\]\n]*\]\([^)\s]+\))\]\([^)\s]+\)/g
const WEB_IMAGE = /(!\[[^\]\n]*\]\()(https?:\/\/[^)\s]+)\)/g

/** 正文里网上的图（套着链接的只留图），给存图用（同 page-clip.ts localizeImages 的前半） */
export function webImages(text: string, max = 60): string[] {
  const unwrapped = text.replace(LINKED_IMAGE, '$1')
  return [...new Set([...unwrapped.matchAll(WEB_IMAGE)].map((m) => m[2]!))].slice(0, max)
}

/** 存好的图换成相对这篇的路径；saved: 网址 → 库内路径（同 page-clip.ts localizeImages 的后半） */
export function replaceImages(text: string, notePath: string, saved: Map<string, string>): string {
  if (!saved.size) return text
  return text.replace(LINKED_IMAGE, '$1').replace(WEB_IMAGE, (all, head: string, url: string) => {
    const p = saved.get(url)
    return p ? `${head}${mdUrl(relativeLink(notePath, p))})` : all
  })
}

// ---------------------------------------------------------------- 划线一节（存的时候写、存过以后再划的补进去）

/** 划线那一节的标题 */
export const HL_HEADING = '## 划线'

/** 一条划线写成的一项：「- ==划的字==」，有想法时下一行缩进写想法 */
export function highlightItem(h: { anchor: { quote: string }; note?: string }): string {
  const q = h.anchor.quote.replace(/\s+/g, ' ').replace(/==/g, '＝＝').trim()
  return `- ==${q}==${h.note ? `\n  ${h.note.replace(/\n+/g, ' ').trim()}` : ''}`
}

/**
 * 存过的那一篇里补上还没写进去的划线（认法：文里已经有「==同样的字==」就算写过了，用户自己挪过、改过想法的不管）。
 * 有「## 划线」一节时接在那一节的列表末尾（后面的 AI 问答、用户自己补的字不动）；没有时在文末新起这一节
 */
export function addHighlights(md: string, hls: readonly { anchor: { quote: string }; note?: string }[]): { text: string; added: number } {
  const fresh = hls.filter((h) => !md.includes(highlightItem({ anchor: h.anchor }).slice(2)))
  if (!fresh.length) return { text: md, added: 0 }
  const items = fresh.map(highlightItem).join('\n')
  const lines = md.split('\n')
  const head = lines.findIndex((l) => l.trim() === HL_HEADING)
  if (head < 0) return { text: md.replace(/\s*$/, '') + `\n\n${HL_HEADING}\n\n${items}\n`, added: fresh.length }
  let i = head + 1
  while (i < lines.length && !lines[i]!.trim()) i++
  let last = -1
  while (i < lines.length && (/^- /.test(lines[i]!) || (last >= 0 && /^ {2,}\S/.test(lines[i]!)))) last = i++
  const at = last >= 0 ? last + 1 : head + 1
  const ins = last >= 0 ? [items] : ['', items]
  lines.splice(at, 0, ...ins)
  return { text: lines.join('\n'), added: fresh.length }
}
