/**
 * 库里的分区，就是几个文件夹：
 * - 收件箱/        新东西默认进这里（速记、剪藏）
 * - 素材/<主题>/   剪来的东西，按主题分文件夹
 * - 其他 md 文件   我写的
 */
export const INBOX = '收件箱'
export const CLIPS = '素材'

export type NoteKind = 'inbox' | 'clip' | 'work'

export function kindOf(path: string): { kind: NoteKind; topic?: string } {
  const parts = path.split('/')
  if (parts[0] === INBOX && parts.length > 1) return { kind: 'inbox' }
  if (parts[0] === CLIPS && parts.length > 1) return { kind: 'clip', topic: parts.length > 2 ? parts[1] : '未分主题' }
  return { kind: 'work' }
}

export const titleOf = (path: string) => path.replace(/\.md$/i, '').split('/').pop()!

/** 卡片上显示的前几行：去掉 frontmatter、排版注释和 md 记号 */
export function previewOf(text: string, max = 140): string {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^—— .*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    // 勾选清单、列表、表格、代码块的记号（导进来的备忘录里很多）
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, '')
    .replace(/^```.*$/gm, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return body.length > max ? body.slice(0, max) + '…' : body
}

/** md 链接里的网址：空格和括号转成 %xx，不然链接在那里断开（encodeURIComponent 不转括号） */
export const mdUrl = (url: string) => url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))

/** 剪下来的一段：`> 原文` 下一行 `—— [标题](网址)` */
export function clipMarkdown(text: string, title: string, url: string): string {
  const quote = text
    .trim()
    .split(/\n+/)
    .map((l) => '> ' + l.trim())
    .join('\n')
  const t = (title.trim() || url).replace(/[\[\]]/g, '')
  return `${quote}\n—— [${t}](${mdUrl(url)})`
}
