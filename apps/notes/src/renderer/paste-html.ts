/**
 * 粘贴带格式的字（task-ys1rr，对照 Notion）：剪贴板里有 HTML（网页、Word、飞书、邮件里复制的一段）就转成 md 再插——
 * 标题、列表、待办、引用、代码、加粗、斜体、删除线、链接、图片、表格都留着。以前只取纯文字：标题和列表的记号全丢，
 * 几段字在纯文字里只隔一个换行，插进来并成同一段。
 * 不转、照旧粘纯文字的：剪贴板里有文件（图片由 doc-image-drop 接）、光标在代码块里、从代码编辑器复制的（整段等宽、没有标题列表这些）、
 * 只是一行没有格式的字。从文档里自己复制的只有纯文字（CodeMirror 只写 text/plain），照旧。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import TurndownService from 'turndown'
import { mdUrl } from '../shared/layout'

/** 带格式、值得转的 HTML：有标题、列表、引用、表格、图、链接、加粗这些，或者好几段 */
const RICH = 'h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,table,img,a[href],strong,b,em,i,del,s,strike,code,pre,p + p,hr'

/** 网址里的 %E7%8F%8D 还原成能读的字 */
function readable(href: string): string {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

function service(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', hr: '***' })
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'meta', 'link', 'title', 'head'])
  // 只转义行首会被认成块记号的（# > - + 1.）：Turndown 默认把字里的 _ * [ ] 都加反斜杠，文档里反斜杠是露着的（file_name 成了 file\_name）
  td.escape = (s: string) => s.replace(/^(\s*)(#{1,6}(?=\s)|>|[-+*](?=\s)|\d+[.)](?=\s))/gm, '$1\\$2')
  td.addRule('strike', { filter: ['del', 's', 'strike'] as (keyof HTMLElementTagNameMap)[], replacement: (c) => (c.trim() ? `~~${c}~~` : '') })
  td.addRule('link', {
    filter: (n) => n.nodeName === 'A' && !!(n as HTMLAnchorElement).getAttribute('href'),
    replacement: (content, node) => {
      const text = content.trim()
      const href = (node as HTMLAnchorElement).href
      if (!text) return ''
      if (/^!\[[^\]\n]*\]\([^)\s]*\)$/.test(text) || !/^https?:/.test(href)) return text
      return `[${text}](${mdUrl(readable(href))})`
    },
  })
  td.addRule('img', {
    filter: 'img',
    replacement: (_c, node) => {
      const img = node as HTMLImageElement
      const src = img.getAttribute('src') ? img.src : ''
      if (!/^https?:/.test(src)) return ''
      const alt = (img.getAttribute('alt') ?? '').replace(/[[\]\n]/g, ' ').trim().slice(0, 60)
      return `![${alt}](${mdUrl(src)})`
    },
  })
  // 列表项：记号后面一个空格（Turndown 默认补到 4 格「-   」），套着的一层缩 2 格（编号的缩到字对齐）
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement | null
      let prefix = '- '
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n' + ' '.repeat(prefix.length))
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '')
    },
  })
  // 待办：列表项里的勾选框
  td.addRule('task', {
    filter: (n) => n.nodeName === 'INPUT' && (n as HTMLInputElement).type === 'checkbox',
    replacement: (_c, node) => ((node as HTMLInputElement).checked ? '[x] ' : '[ ] '),
  })
  // 表格：一格一格写成 md 表格（第一行当表头）；套着表格的排版表只留字
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, node) => {
      const t = node as HTMLTableElement
      const cell = (c: HTMLTableCellElement) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
      if (t.querySelector('table')) return '\n\n' + (t.textContent ?? '').replace(/\s+/g, ' ').trim() + '\n\n'
      const rows = Array.from(t.rows).map((r) => Array.from(r.cells).map(cell))
      const n = Math.max(0, ...rows.map((r) => r.length))
      if (!rows.length || !n) return ''
      const line = (r: string[]) => '| ' + Array.from({ length: n }, (_, i) => r[i] ?? '').join(' | ') + ' |'
      return '\n\n' + [line(rows[0]!), line(Array.from({ length: n }, () => '---')), ...rows.slice(1).map(line)].join('\n') + '\n\n'
    },
  })
  return td
}

/** HTML → md；不值得转（没有格式、代码编辑器复制的）给 null */
export function htmlToMd(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body || !body.textContent?.trim() && !body.querySelector('img')) return null
  // Google 文档整段套在一个 <b style="font-weight:normal" id="docs-internal-guid…"> 里：拆掉这一层（不然整篇变粗体）
  for (const b of Array.from(body.querySelectorAll('b[id^="docs-internal-guid"]'))) b.replaceWith(...Array.from(b.childNodes))
  if (!body.querySelector(RICH)) return null
  // 代码编辑器（VS Code 这些）复制的：整段等宽、只有 <pre> 或空白照留的 <div>，没有标题列表：照旧粘纯文字
  const pre = body.querySelector('pre')
  if ((pre && body.textContent?.trim() === pre.textContent?.trim()) || /white-space:\s*pre/.test(html)) return null
  const md = service()
    .turndown(body)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return md || null
}

/** 光标在代码块里 */
function inCode(view: EditorView, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true
  return false
}

/** 开头、结尾是一块有记号的块（标题、列表、引用、代码、表格、分隔线）：不能和光标那一行的字并成一行 */
const BLOCK_START = /^(#{1,6} |[-*+] |\d+[.)] |> |```|~~~|\||\*\*\*$|!\[)/
const lastBlock = (md: string) => md.slice(md.lastIndexOf('\n\n') + 2)

export const pasteHtml = EditorView.domEventHandlers({
  paste(e, view) {
    const dt = e.clipboardData
    if (!dt || view.state.readOnly || dt.files.length) return false
    const html = dt.getData('text/html')
    if (!html) return false
    const sel = view.state.selection.main
    if (view.state.selection.ranges.length > 1 || inCode(view, sel.from)) return false
    const md = htmlToMd(html)
    if (md === null) return false
    const line = view.state.doc.lineAt(sel.from)
    const end = view.state.doc.lineAt(sel.to)
    const before = view.state.sliceDoc(line.from, sel.from).trim()
    const after = view.state.sliceDoc(sel.to, end.to).trim()
    const pre = before && BLOCK_START.test(md) ? '\n\n' : ''
    const post = after && BLOCK_START.test(lastBlock(md)) ? '\n\n' : ''
    e.preventDefault()
    const insert = pre + md + post
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + pre.length + md.length }, userEvent: 'input.paste', scrollIntoView: true })
    return true
  },
})
