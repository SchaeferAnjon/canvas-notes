/**
 * 文档的右键菜单（DESIGN.v3 9.2）：
 * 点在链接、双链、图上先给它们的几项；下面是编辑、格式、转成、问 AI / 翻译、复制为 Markdown。
 */
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import { aiBlockAt, blockIndexAt, parseChatLink, type BlockTarget, convertible, convertMdBlock, findBlocks, plainOf, resolveLink, wrapRange } from '@cn/format'
import type { EditorView } from '@codemirror/view'
import { markAi, makeMine } from '../ai-mark'
import { t } from '../../shared/i18n'
import { applyBlockEdit } from '../block-handles'
import { inHighlight, toggleHighlight } from '../highlight'
import { accelFor } from '../keys'
import { toggleFormat } from '../wysiwyg'
import { parseFragment } from '../../shared/web-link'
import { app } from './actions'
import { copy, type MenuEntry, menuAt } from './menu'
import { translateAt } from './translate'
import { mdLinkAt } from '../md-link'
import { openPageLink } from '../page-link'

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

/**
 * 打开文档里的一个链接：网址在右栏网页开（同一个网址已经开着就切过去），wide 时在中间栏开；
 * 库里文件的链接（附件/…pdf）开那个文件；PDF 某一页的（「第 3 页」，doc、pos：笔记全文和链接在哪）打开 PDF 翻到那页
 */
export function openLinkHit(notePath: string, url: string, text: string, wide: boolean, doc = '', pos = 0) {
  const a = app()
  // 回到网页那一段的链接（#:~:text=，task-6cxtc）：右栏网页翻到那一页那段、亮一下
  if (!wide && parseFragment(url)) return a.openWebAt(url)
  if (/^https?:/i.test(url)) return wide ? a.openWide(url, text) : a.openInWeb(url, url)
  // 「回到 AI 对话」（AI 回答插进文档时带的，task-83vl3）：AI 格换到那段对话、滚到那条回答
  const chat = parseChatLink(url)
  if (chat) return a.openChat(chat.key, chat.msg)
  if (openPageLink(notePath, url, doc, pos, text)) return
  const local = resolveLink(notePath, url)
  if (local) a.openFile(local)
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
    if (local) linkItems.push({ label: '打开', run: () => openLinkHit(notePath, hit.url, hit.text, false, text, pos) }, { label: '拷贝链接', run: () => copy(hit.url) })
    else if (/^https?:/i.test(hit.url))
      linkItems.push(
        { label: '打开链接', run: () => a.openInWeb(hit.url) },
        { label: '在中间栏打开', run: () => a.openWide(hit.url, hit.text) },
        { label: '用默认浏览器打开', run: () => window.cnMenu.openExternal(hit.url) },
        { label: '拷贝链接', run: () => copy(hit.url) },
      )
    // [字](网址) 另一组：改链接…（链接下面出卡、网址那一行是输入框）、去掉链接（只留字）。DESIGN.v3 9.2，cmdk 方案 A
    const md = editable ? mdLinkAt(state.doc, pos) : null
    // 链接卡那一块碰 DOM，点了才载（右键菜单的单元测试在 Node 里载这个文件）
    if (md) linkItems.push('-', { label: '改链接…', run: () => import('../link-card').then((m) => m.editLinkAt(view, pos)) }, { label: '去掉链接', run: () => import('../link-card').then((m) => m.unlink(view, md)) })
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
  // AI 块（task-dtc34）：点在 AI 块里是「变成我的字」，点在普通的段落上（或选了几段）是「标成 AI 写的」
  const markFrom = sel.empty ? pos : sel.from
  const markTo = sel.empty ? pos : sel.to
  const aiHere = editable ? aiBlockAt(text, markFrom) : null
  const canMark = editable && !aiHere && wrapRange(text, markFrom, markTo).wrapped > 0
  const hl = inHighlight(text, sel.from, sel.to)
  void menuAt(e, [
    ...linkItems,
    '-',
    { label: '撤销', accel: accelFor('undo'), enabled: editable && undoDepth(state) > 0, run: () => (undo(view), view.focus()) },
    { label: '重做', accel: accelFor('redo'), enabled: editable && redoDepth(state) > 0, run: () => (redo(view), view.focus()) },
    '-',
    { edit: 'cut', enabled: editable && !sel.empty },
    { edit: 'copy', enabled: !sel.empty },
    { edit: 'paste', enabled: editable },
    { label: '全选', accel: accelFor('select-all'), run: () => (selectAll(view), view.focus()) },
    '-',
    // 格式一组，快捷键写在右边（CN-67 A）；「转成」另起一组
    editable && !sel.empty && { label: '加粗', accel: accelFor('bold'), run: () => (toggleFormat('StrongEmphasis')(view), view.focus()) },
    editable && !sel.empty && { label: '斜体', accel: accelFor('italic'), run: () => (toggleFormat('Emphasis')(view), view.focus()) },
    editable && (!sel.empty || hl) && { label: hl ? '取消高亮' : '高亮', accel: accelFor('highlight'), run: () => toggleHighlight(view) },
    editable && !sel.empty && !hit && { label: '加链接', accel: accelFor('add-link'), run: () => addLink(view) },
    '-',
    canConvert && { label: '转成', submenu: TARGETS.map(([t, label]) => ({ label, run: () => applyBlockEdit(view, convertMdBlock(view.state.doc.toString(), bi, t), 0, 'move.block') })) },
    aiHere ? { label: t('变成我的字'), run: () => makeMine(view, aiHere.from) } : null,
    canMark ? { label: t('标成 AI 写的'), run: () => markAi(view, markFrom, markTo) } : null,
    '-',
    plain.trim() ? { label: selText.trim() ? '问 AI 这段' : '问 AI 这一块', accel: selText.trim() ? accelFor('ask-ai') : undefined, ai: 'chat', run: () => a.askAi(plain) } : null,
    plain.trim() ? { label: selText.trim() ? '翻译这段' : '翻译这一块', ai: 'translate', run: () => translateAt(plain, { x: e.clientX, y: e.clientY }) } : null,
    // AI 那两项（带引擎标志）自成一组：macOS 不给没图的项留位置，混在一组里字对不齐
    '-',
    piece.trim() ? { label: '复制为 Markdown', run: () => copy(piece) } : null,
  ])
}
