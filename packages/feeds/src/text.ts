/** HTML 变纯文字（摘要两行、搜索的正文、字数） */
import { Parser } from 'htmlparser2'

const BLOCK = new Set(['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'section', 'article', 'figure', 'figcaption', 'hr', 'ul', 'ol', 'table'])
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'head'])

export function htmlToText(html: string): string {
  let out = ''
  let skip = 0
  const p = new Parser(
    {
      onopentag(name) {
        if (SKIP.has(name)) skip++
        else if (BLOCK.has(name)) out += '\n'
      },
      onclosetag(name) {
        if (SKIP.has(name)) skip = Math.max(0, skip - 1)
        else if (BLOCK.has(name)) out += '\n'
      },
      ontext(t) {
        if (!skip) out += t
      },
    },
    { decodeEntities: true },
  )
  p.parseComplete(html)
  return out
    .replace(/[ \t\f\v ​]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim()
}

/** 两行摘要：纯文字压成一行，最多 max 字 */
export function summaryOf(html: string, max = 300): string {
  const t = htmlToText(html).replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}
