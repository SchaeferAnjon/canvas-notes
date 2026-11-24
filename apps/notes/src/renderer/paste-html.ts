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
import { clipText } from '@cn/ai-chat/paste'
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
  // 只有空白的行（网页里空的 <div><br></div> 转出来是一行两个空格，task-axoxy 第 20 条）清成空行，再压连着的空行；
  // 围栏代码块里的空白照留
  let fence = false
  const md = service()
    .turndown(body)
    .split('\n')
    .map((l) => {
      if (/^ {0,3}(`{3,}|~{3,})/.test(l)) fence = !fence
      return !fence && l.trim() === '' ? '' : l
    })
    .join('\n')
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

/** 这一行所在的顶层段落、标题（几行）；别的（列表项、引用、表格……）就这一行 */
function blockLines(view: EditorView, pos: number): { from: number; to: number } {
  const state = view.state
  const line = state.doc.lineAt(pos)
  for (let x: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); x; x = x.parent) {
    if ((x.name === 'Paragraph' || /^ATXHeading/.test(x.name)) && x.parent?.name === 'Document') return { from: state.doc.lineAt(x.from).from, to: state.doc.lineAt(x.to).to }
    if (x.name === 'Document') break
  }
  return { from: line.from, to: line.to }
}

const blankAt = (view: EditorView, n: number) => n >= 1 && n <= view.state.doc.lines && view.state.doc.line(n).text.trim() === ''

/** 没选字时复制、剪切的那一块（编辑器自己记着：再粘贴时认出是整块） */
let lastBlockCopy: string | null = null

/** 列表项、待办、引用、表格一行：连着的几行在纯文字里本来就是一块，不拆 */
const LIST_LINE = /^\s*([-*+]|\d{1,9}[.)])\s/
const kindOf = (l: string): string => (LIST_LINE.test(l) ? 'list' : /^\s*>/.test(l) ? 'quote' : /^\s*\|/.test(l) ? 'table' : /^\s{2,}\S/.test(l) ? 'indent' : 'text')

/**
 * 纯文本（微信、终端、记事本里复制的几行）写成 md：一行一块（单个换行换成空行，像 Notion），连着的列表、引用、表格行和围栏里的不拆；
 * 多个空行压成一个，头尾的空行去掉（「一行带尾换行」贴进来就是这一行，task-axoxy 第 5 条）
 */
export function plainToMd(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence = false
  let prev: string | null = null
  for (const l of lines) {
    if (fence) {
      out.push('\n' + l)
      if (/^\s{0,3}(`{3,}|~{3,})\s*$/.test(l)) fence = false
      continue
    }
    if (l.trim() === '') {
      if (prev !== null) prev = ''
      continue
    }
    if (prev === null) out.push(l)
    else {
      const k = kindOf(l)
      const same = prev !== '' && (k === 'indent' ? ['list', 'indent'].includes(kindOf(prev)) : k !== 'text' && k === kindOf(prev))
      out.push((same ? '\n' : '\n\n') + l)
    }
    if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) fence = true
    prev = l
  }
  return out.join('')
}

export const pasteHtml = EditorView.domEventHandlers({
  /** 没选字 ⌘C：复制这一整块（task-axoxy 第 2 条；以前是 CodeMirror 的整行，贴回来和当前段粘成一段） */
  copy(e, view) {
    return copyBlock(e, view, false)
  },
  /** 没选字 ⌘X：剪走这一整块，连同一道块缝，光标到下一块开头（最后一块就到上一块末尾） */
  cut(e, view) {
    return copyBlock(e, view, true)
  },
  paste(e, view) {
    const dt = e.clipboardData
    // 带文件的（截图、访达里拷的图）归 doc-image-drop 存附件；字和图都有的照字贴（粘贴优先文字）
    if (!dt || view.state.readOnly || (dt.files.length && !clipText(dt))) return false
    const html = dt.getData('text/html')
    const sel = view.state.selection.main
    if (view.state.selection.ranges.length > 1 || inCode(view, sel.from)) return false
    const plain = dt.getData('text/plain')
    if (plain && plain === lastBlockCopy && sel.empty) {
      e.preventDefault()
      pasteBlock(view, plain)
      return true
    }
    const md = html ? htmlToMd(html) : null
    if (md === null) return plain ? pastePlain(e, view, plain) : false
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

function copyBlock(e: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const dt = e.clipboardData
  const state = view.state
  if (!dt || state.selection.ranges.length > 1 || !state.selection.main.empty) return false
  if (inCode(view, state.selection.main.head)) return false
  const b = blockLines(view, state.selection.main.head)
  const text = state.sliceDoc(b.from, b.to) + '\n'
  if (!text.trim()) return false
  e.preventDefault()
  dt.clearData()
  dt.setData('text/plain', text)
  lastBlockCopy = text
  if (!cut || state.readOnly) return true
  const doc = state.doc
  const a = doc.lineAt(b.from).number
  const z = doc.lineAt(b.to).number
  let from = b.from
  let to = Math.min(doc.length, b.to + 1)
  let at = from
  // 下面隔着空行还有块：连同下面一个空行删掉，光标到下一块开头；是最后一块：从上一块末尾删起，光标停在那里
  let below = z + 1
  while (blankAt(view, below)) below++
  if (blankAt(view, z + 1) && below <= doc.lines) to = doc.line(z + 1).to + 1
  else if (blankAt(view, a - 1) && below > doc.lines) {
    let up = a - 1
    while (blankAt(view, up)) up--
    if (up >= 1) {
      from = doc.line(up).to
      to = b.to
      at = from
    }
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: at }, userEvent: 'delete.cut', scrollIntoView: true })
  return true
}

/** 粘贴没选字时复制的一整块：放在光标这一块上面（同 VS Code、CodeMirror 的整行粘贴），和它隔一个空行；光标留在原处 */
function pasteBlock(view: EditorView, text: string) {
  const state = view.state
  const b = blockLines(view, state.selection.main.head)
  const n = state.doc.lineAt(b.from).number
  const listy = LIST_LINE.test(text) && LIST_LINE.test(state.doc.line(n).text)
  const pre = !listy && n > 1 && !blankAt(view, n - 1) ? '\n' : ''
  const insert = pre + text + (listy ? '' : '\n')
  view.dispatch({ changes: { from: b.from, insert }, selection: { anchor: state.selection.main.head + insert.length }, userEvent: 'input.paste', scrollIntoView: true })
}

/** 粘贴带换行的纯文本：一行一块；只有一行（去掉尾巴上的换行以后）的照常交给编辑器 */
function pastePlain(e: ClipboardEvent, view: EditorView, plain: string): boolean {
  if (!/[\r\n]/.test(plain)) return false
  const md = plainToMd(plain)
  if (!md) return false
  const state = view.state
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.from)
  const end = state.doc.lineAt(sel.to)
  const before = state.sliceDoc(line.from, sel.from).trim()
  const after = state.sliceDoc(sel.to, end.to).trim()
  const multi = md.includes('\n')
  const pre = before && multi && BLOCK_START.test(md) ? '\n\n' : ''
  const post = after && multi && BLOCK_START.test(lastBlock(md)) ? '\n\n' : ''
  e.preventDefault()
  const insert = pre + md + post
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + pre.length + md.length }, userEvent: 'input.paste', scrollIntoView: true })
  return true
}
