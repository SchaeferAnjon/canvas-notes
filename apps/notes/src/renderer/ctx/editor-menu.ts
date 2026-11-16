/**
 * 文档（文档和源文件两种看法）的右键菜单（DESIGN.v3 9.2）：
 * 点在链接、双链、图上先给它们的几项；下面是编辑、格式、转成、问 AI / 翻译、复制为 Markdown。
 */
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import { blockIndexAt, type BlockTarget, convertible, convertMdBlock, findBlocks, plainOf, resolveLink } from '@cn/format'
import type { EditorView } from '@codemirror/view'
import { applyBlockEdit } from '../block-handles'
import { app } from './actions'
import { copy, type MenuEntry, menuAt } from './menu'
import { translateAt } from './translate'

export type LinkHit =
  | { kind: 'wiki'; target: string }
  | { kind: 'url'; url: string; text: string }
  | { kind: 'image'; url: string }

const WIKI = /\[\[([^\]|#^\n]+)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
const MD_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g
const BARE = /https?:\/\/[^\s<>()[\]"']+[^\s<>()[\]"'.,;:!?。，；：！？]/g

/** 一行字里第 at 个字符上是哪个链接（双链、[文字](网址)、![图](地址)、<网址>、光秃秃的网址） */
export function linkAt(line: string, at: number): LinkHit | null {
  const inside = (re: RegExp, f: (m: RegExpExecArray) => LinkHit | null): LinkHit | null => {
    re.lastIndex = 0
    for (let m = re.exec(line); m; m = re.exec(line)) if (at >= m.index && at <= m.index + m[0].length) return f(m)
    return null
  }
  return (
    inside(WIKI, (m) => ({ kind: 'wiki', target: m[1]!.trim() })) ??
    inside(MD_LINK, (m) => (m[1] ? { kind: 'image', url: m[3]! } : { kind: 'url', url: m[3]!, text: m[2]! })) ??
    inside(AUTOLINK, (m) => ({ kind: 'url', url: m[1]!, text: m[1]! })) ??
    inside(BARE, (m) => ({ kind: 'url', url: m[0], text: m[0] }))
  )
}

/** 选中的字两边包上记号（加粗 **、斜体 *）；已经包着就拿掉 */
export function toggleWrap(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main
  if (from === to) return
  const doc = view.state.doc
  const n = mark.length
  if (doc.sliceString(from - n, from) === mark && doc.sliceString(to, to + n) === mark) {
    view.dispatch({ changes: [{ from: from - n, to: from }, { from: to, to: to + n }], selection: { anchor: from - n, head: to - n }, userEvent: 'input.format' })
  } else {
    view.dispatch({ changes: [{ from, insert: mark }, { from: to, insert: mark }], selection: { anchor: from + n, head: to + n }, userEvent: 'input.format' })
  }
  view.focus()
}

/** 选中的字变成 [字](网址)：剪贴板里是网址就用它，不然光标停在括号里等人填 */
export async function addLink(view: EditorView) {
  const { from, to } = view.state.selection.main
  if (from === to) return
  const clip = (await window.cnMenu.readClipboardText()).trim()
  const url = /^https?:\/\/\S+$/.test(clip) ? clip : ''
  const text = view.state.doc.sliceString(from, to)
  const insert = `[${text}](${url})`
  const cursor = url ? from + insert.length : from + text.length + 3
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor }, userEvent: 'input.format' })
  view.focus()
}

const TARGETS: [BlockTarget, string][] = [
  ['paragraph', '正文'],
  ['h1', '一级标题'],
  ['h2', '二级标题'],
  ['h3', '三级标题'],
  ['todo', '待办'],
  ['quote', '引用'],
  ['code', '代码'],
]

/** 文件地址 cn-file://vault/<路径> → 库里的相对路径 */
const vaultPathOf = (src: string) => (src.startsWith('cn-file://vault/') ? src.slice('cn-file://vault/'.length).split('/').map(decodeURIComponent).join('/') : null)

export function editorMenu(view: EditorView, e: MouseEvent, notePath: string) {
  const state = view.state
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? state.selection.main.head
  const line = state.doc.lineAt(pos)
  const hit = linkAt(line.text, pos - line.from)
  const img = (e.target as HTMLElement).closest?.('.cm-image')?.querySelector('img') ?? null
  const sel = state.selection.main
  const selText = state.sliceDoc(sel.from, sel.to)
  const editable = !state.readOnly
  const text = state.doc.toString()
  const blocks = findBlocks(text)
  const bi = blockIndexAt(blocks, sel.empty ? pos : sel.from)
  const block = bi === -1 ? null : blocks[bi]!
  /** 问 AI、翻译、复制为 Markdown 用的那段：选了字就是选的，没选就是点着的这一块 */
  const piece = selText.trim() ? selText : block ? text.slice(block.from, block.to) : ''
  const plain = selText.trim() ? selText : block ? plainOf(text, block) : ''
  const a = app()

  const linkItems: MenuEntry[] = []
  if (hit?.kind === 'wiki') {
    linkItems.push(
      { label: '打开', run: () => a.openWikilink(hit.target, true) },
      { label: '在新标签打开', run: () => a.openWikilink(hit.target) },
      { label: '拷贝双链', run: () => copy(`[[${hit.target}]]`) },
    )
  } else if (hit?.kind === 'url') {
    const local = /^https?:/i.test(hit.url) ? null : resolveLink(notePath, hit.url)
    if (local) linkItems.push({ label: '打开', run: () => a.openFile(local) }, { label: '拷贝链接', run: () => copy(hit.url) })
    else if (/^https?:/i.test(hit.url))
      linkItems.push(
        { label: '打开链接', run: () => a.openInWeb(hit.url) },
        { label: '在中间栏打开', run: () => a.openWide(hit.url, hit.text) },
        { label: '用默认浏览器打开', run: () => window.cnMenu.openExternal(hit.url) },
        { label: '拷贝链接', run: () => copy(hit.url) },
      )
  }
  const imgUrl = img?.getAttribute('src') ?? (hit?.kind === 'image' ? hit.url : null)
  if (imgUrl) {
    const rel = vaultPathOf(imgUrl) ?? (/^[a-z]+:/i.test(imgUrl) ? null : resolveLink(notePath, imgUrl))
    linkItems.push(
      img ? { copyImageAt: { x: Math.round(e.clientX), y: Math.round(e.clientY) } } : null,
      rel ? { label: '在访达中显示', run: () => window.cnMenu.reveal(rel) } : null,
      { label: '拷贝图片地址', run: () => copy(rel ?? imgUrl) },
    )
  }

  const canConvert = editable && !!block && convertible(block)
  void menuAt(e, [
    ...linkItems,
    '-',
    { label: '撤销', accel: 'CommandOrControl+Z', enabled: editable && undoDepth(state) > 0, run: () => (undo(view), view.focus()) },
    { label: '重做', accel: 'Shift+CommandOrControl+Z', enabled: editable && redoDepth(state) > 0, run: () => (redo(view), view.focus()) },
    '-',
    { edit: 'cut', enabled: editable && !sel.empty },
    { edit: 'copy', enabled: !sel.empty },
    { edit: 'paste', enabled: editable },
    { label: '全选', accel: 'CommandOrControl+A', run: () => (selectAll(view), view.focus()) },
    '-',
    editable && !sel.empty && { label: '加粗', run: () => toggleWrap(view, '**') },
    editable && !sel.empty && { label: '斜体', run: () => toggleWrap(view, '*') },
    editable && !sel.empty && !hit && { label: '加链接', run: () => addLink(view) },
    canConvert && { label: '转成', submenu: TARGETS.map(([t, label]) => ({ label, run: () => applyBlockEdit(view, convertMdBlock(view.state.doc.toString(), bi, t), 0, 'move.block') })) },
    '-',
    plain.trim() ? { label: selText.trim() ? '问 AI 这段' : '问 AI 这一块', run: () => a.askAi(plain) } : null,
    plain.trim() ? { label: selText.trim() ? '翻译这段' : '翻译这一块', run: () => translateAt(plain, { x: e.clientX, y: e.clientY }) } : null,
    piece.trim() ? { label: '复制为 Markdown', run: () => copy(piece) } : null,
  ])
}
