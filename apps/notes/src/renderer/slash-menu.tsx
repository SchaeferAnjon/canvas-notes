import { Codicon, type CodiconName } from '@cn/design'
import { aiCalloutHead, aiWroteHead, calloutWords, fmValue, insertMdBlockAfter, relativeLink, tableMarkdown, textChanges } from '@cn/format'
import { Facet, Prec, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { BRAND } from '../shared/brand'
import { answerLangName } from '../shared/answer-lang'
import { titleOf } from '../shared/layout'
import { withoutEffort } from '../shared/ai-features'
import { insertBase } from './base/base-block'
import { drawnBlocks, editorHost, Popover } from './editor-host'
import { AiIcon } from './engine-logo'
import { toggleFold } from './fold-block'
import { hiddenOk } from './hidden-syntax'
import { AiStreamWrite } from './ai-write'
import { canStream } from './ai-spot'
import { keepTail, openTail } from './tail-line'
import { useT } from './i18n'
import { tIn, t as tNow, uiLang } from '../shared/i18n'

/**
 * 文档里的插入菜单（DESIGN.v3 6.3）：在行首打 /（中文输入法打出的「、」也算），或点块旁的「+」，弹出插入菜单；
 * 分「基本、图片和表格、链接、AI」四组，每行右边一列是它在 md 里的写法；接着打字筛选，↑↓ 选，回车插入，Esc 关。
 * 插进去的都是普通 md。打 [[ 弹出笔记列表（「链接到笔记」「白板链接」也走这里）。
 * - 点「+」：文档里不写「/」，菜单关了什么都不留；选了一项才在这一块后面（文末那一行就是文末）新起一块（CN-107）。
 * - 打的「/」没选就失焦、光标离开那一行：拿掉「/」和后面筛选的字（CN-107）；按 Esc 只关菜单，「/」留着当普通字。
 */

type Mode = 'slash' | 'link' | 'ai'

/** 点「+」开的菜单插在哪：这一块（第 index 块）后面，或者文末那一行 */
export type PlusAt = { block: number } | { tail: true }

interface SlashState {
  mode: Mode
  /** / 或 [[ 的位置；AI 模式下是要插入的位置；点「+」开的菜单没有（-1） */
  from: number
  /** 点「+」开的：插到哪；打的字只筛选，不进文档 */
  plus: PlusAt | null
  /** 点「+」开的菜单里打的筛选字 */
  q: string
  /** 只列白板（「白板链接」） */
  boards: boolean
  /** 为这一次新起的空行（AI 框什么都没写就收起时拿掉，文件一个字节都不多） */
  made: { from: number; to: number } | null
  /** AI 模式：总结这页（写成三句话放在开头），不用说要写什么 */
  summary: boolean
}

export const openSlash = StateEffect.define<{ from: number; plus?: PlusAt; mode?: Mode; boards?: boolean; made?: { from: number; to: number } | null; summary?: boolean }>()
const closeSlash = StateEffect.define<'pick' | 'esc' | 'auto'>()
const plusQuery = StateEffect.define<string>()

const SLASH_CHARS = ['/', '、']

function markerLen(s: SlashState) {
  return s.mode === 'link' ? 2 : 1
}

export const slashField = StateField.define<SlashState | null>({
  create: () => null,
  update(v, tr) {
    if (v && tr.docChanged) v = { ...v, from: v.from < 0 ? v.from : tr.changes.mapPos(v.from, -1), made: v.made && { from: tr.changes.mapPos(v.made.from, -1), to: tr.changes.mapPos(v.made.to, 1) } }
    for (const e of tr.effects) {
      if (e.is(openSlash))
        v = { mode: e.value.mode ?? 'slash', from: e.value.from, plus: e.value.plus ?? null, q: '', boards: !!e.value.boards, made: e.value.made ?? null, summary: !!e.value.summary }
      if (e.is(closeSlash)) return null
      if (e.is(plusQuery) && v) v = { ...v, q: e.value }
    }
    const doc = tr.state.doc
    if (!v && tr.docChanged && tr.isUserEvent('input.type')) {
      // 打的「/」：看光标前面那个字。块缝规整（tidy-blocks）会把补的空行并进同一个改动（插进去的是「/\n」不是「/」），不能只认插进去的正好是「/」
      const sel = tr.state.selection.main
      const at = sel.head - 1
      if (sel.empty && at >= 0 && SLASH_CHARS.includes(doc.sliceString(at, sel.head))) {
        let typed = false
        tr.changes.iterChanges((_fa, _ta, fb, tb, ins) => {
          if (fb <= at && tb >= sel.head && SLASH_CHARS.some((c) => ins.toString().includes(c))) typed = true
        })
        const line = doc.lineAt(at)
        if (typed && /^[ \t]*$/.test(doc.sliceString(line.from, at))) v = { mode: 'slash', from: at, plus: null, q: '', boards: false, made: null, summary: false }
      }
      if (!v)
        tr.changes.iterChanges((_fa, _ta, fb, _tb, ins) => {
          if (ins.toString() === '[' && doc.sliceString(fb - 1, fb) === '[') v = { mode: 'link', from: fb - 1, plus: null, q: '', boards: false, made: null, summary: false }
        })
    }
    // AI 框、「+」开的菜单、白板链接的挑选（文档里没有「/」「[[」）：不按文档里的字关
    if (!v || v.mode === 'ai' || v.plus || v.from < 0) return v
    // / 或 [[ 被删了、光标跑出去了：关
    const sel = tr.state.selection.main
    const start = v.from + markerLen(v)
    const line = doc.lineAt(v.from)
    const marker = doc.sliceString(v.from, start)
    if (v.mode === 'slash' ? !SLASH_CHARS.includes(marker) : marker !== '[[') return null
    if (!sel.empty || sel.head < start || sel.head > line.to) return null
    const q = doc.sliceString(start, sel.head)
    if (v.mode === 'slash' && (/^\s/.test(q) || /\s\S*\s/.test(q) || q.length > 24)) return null
    if (v.mode === 'link' && (q.includes(']') || q.length > 80)) return null
    return v
  },
})

const queryOf = (state: EditorState, s: SlashState) => (s.plus ? s.q : s.mode === 'link' && s.from < 0 ? s.q : state.doc.sliceString(s.from + markerLen(s), state.selection.main.head))

/** 打的「/」还在菜单里（没选）：/ 那一行和光标 */
export function slashLine(state: EditorState): { from: number; plus: PlusAt | null } | null {
  const s = state.field(slashField, false)
  if (!s || s.mode === 'ai') return null
  return { from: s.from, plus: s.plus }
}

// ---------- 插入的东西 ----------

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** 把「/查询」换成 insert，光标放在 insert 里的 cursor 处（默认最后） */
function replace(view: EditorView, from: number, to: number, insert: string, cursor = insert.length, select = 0) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursor, head: from + cursor + select },
    userEvent: 'input.slash',
    // 斜杠插的块（折叠块）先收着、下一步才展开：选中标题字是有意的，hidden-syntax 不把选区挪出来
    annotations: hiddenOk.of(true),
    scrollIntoView: true,
  })
}

/** 这一行前面要不要先空一行（上一行是正文时，--- 会把它变成标题、表格会粘上去） */
function blankBefore(state: EditorState, from: number): string {
  const line = state.doc.lineAt(from)
  if (line.number === 1) return ''
  return state.doc.line(line.number - 1).text.trim() === '' ? '' : '\n'
}

/**
 * 插一块独占几行的东西（分隔线、表格），前后和别的段落隔一个空行；
 * newPara：后面再空出一段给光标（分隔线插完接着写下一段）。
 */
function insertOwnBlock(view: EditorView, from: number, to: number, md: string, cursor: number, select = 0, newPara = false) {
  const state = view.state
  const line = state.doc.lineAt(from)
  const pre = blankBefore(state, from)
  const rest = state.doc.sliceString(to, line.to)
  const nextBlank = line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() === ''
  const after = rest || newPara ? '\n\n' + rest : nextBlank ? '' : '\n'
  view.dispatch({
    changes: { from, to: line.to, insert: pre + md + after },
    selection: { anchor: from + pre.length + cursor, head: from + pre.length + cursor + select },
    userEvent: 'input.slash',
    annotations: hiddenOk.of(true),
    scrollIntoView: true,
  })
}

export interface SlashItem {
  id: string
  label: string
  desc: string
  icon: CodiconName
  /** 右边一列：它在 md 里的写法（没有写法的空着） */
  md: string
  /** 哪一组 */
  group: '基本' | '图片和表格' | '链接' | 'AI'
  /** 筛选用的别名（英文、拼音） */
  keys: string
  run(view: EditorView, from: number, to: number): void | Promise<void>
}

/**
 * 斜杠菜单里的提示块：类型、名字、图标（颜色和图标同 callout.ts）、这一种自己的搜法（拼音、英文）。
 * 5 种不打字就全列（task-r00en，用户定「全部列出来」）；tishi、tip、callout 这类总称 5 种都出，名字的拼音、英文只出那一种
 */
// 不翻：键，画的地方翻（菜单项名字整句一条，带「插入菜单」）
const CALLOUTS: [string, string, CodiconName, string][] = [
  ['info', '提示块 · 说明', 'info', 'shuoming sm info note'], // 不翻
  ['warning', '提示块 · 注意', 'warning', 'zhuyi zy warning caution attention'], // 不翻
  ['question', '提示块 · 疑惑', 'question', 'yihuo yh question faq help'], // 不翻
  ['success', '提示块 · 讲通了', 'pass', 'jiangtongle jtl success done check'], // 不翻
  ['danger', '提示块 · 出错', 'error', 'chucuo cc danger error bug failure'], // 不翻
]

const prefix = (p: string) => (view: EditorView, from: number, to: number) => replace(view, from, to, p)

/**
 * 在白板的一张卡里打 /（偏好「白板卡别挂位置行」：空白卡片也能打 /，和文档同一个菜单）：
 * 标题、小标题插 ####、#####——## 在白板上是一列，插进卡里就把这张卡变成新的一列了
 */
export const slashInCard = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })
const CARD_MD: Record<string, string> = { h2: '####', h3: '#####' }
/** 菜单右边一列写的 md 写法（卡里的标题不一样） */
export function itemMd(id: string, inCard: boolean): string {
  if (inCard && CARD_MD[id]) return CARD_MD[id]!
  return ITEMS.find((it) => it.id === id)?.md ?? ''
}
const heading = (id: 'h2' | 'h3', md: string) => (view: EditorView, from: number, to: number) => replace(view, from, to, (view.state.facet(slashInCard) ? CARD_MD[id]! : md) + ' ')

// 不翻：组名是键（排序、比较用），画的地方翻
export const GROUPS = ['基本', '图片和表格', '链接', 'AI'] as const

/** 名字、说明、写法照 DESIGN.v3 6.3 的表；表外的几项（提示块、折叠块、日期、数据库）排在各组最后 */
// 不翻：名字、说明、组名是键，画的地方翻（名字带「插入菜单」）；插进文档的 md 是写进文件的
const ITEMS: SlashItem[] = [
  { id: 'text', group: '基本', label: '正文', desc: '纯文字', md: '', icon: 'text-size', keys: 'text paragraph zhengwen zw p', run: prefix('') }, // 不翻
  { id: 'h2', group: '基本', label: '标题', desc: '大一号的小标题', md: '##', icon: 'symbol-keyword', keys: 'h2 heading title biaoti bt erji', run: heading('h2', '##') }, // 不翻
  { id: 'h3', group: '基本', label: '小标题', desc: '再小一号', md: '###', icon: 'symbol-keyword', keys: 'h3 heading xiaobiaoti xbt sanji', run: heading('h3', '###') }, // 不翻
  { id: 'todo', group: '基本', label: '待办', desc: '带勾选框的一条', md: '- [ ]', icon: 'checklist', keys: 'todo task check daiban db', run: prefix('- [ ] ') }, // 不翻
  { id: 'bullet', group: '基本', label: '列表', desc: '圆点列表', md: '-', icon: 'list-unordered', keys: 'bullet list ul liebiao lb', run: prefix('- ') }, // 不翻
  { id: 'ordered', group: '基本', label: '编号列表', desc: '1. 2. 3.', md: '1.', icon: 'list-ordered', keys: 'ordered number list ol bianhao bh', run: prefix('1. ') }, // 不翻
  { id: 'quote', group: '基本', label: '引用', desc: '左边一道竖线', md: '>', icon: 'quote', keys: 'quote blockquote yinyong yy', run: prefix('> ') }, // 不翻
  {
    id: 'code',
    group: '基本', // 不翻
    label: '代码', // 不翻
    desc: '等宽，原样保留', // 不翻
    md: '```',
    icon: 'code',
    keys: 'code daima dm',
    run(view, from, to) {
      const line = view.state.doc.lineAt(from)
      const rest = view.state.doc.sliceString(to, line.to)
      view.dispatch({
        changes: { from, to: line.to, insert: '```\n' + rest + '\n```' },
        selection: { anchor: from + 4 + rest.length },
        userEvent: 'input.slash',
        annotations: hiddenOk.of(true),
      })
    },
  },
  {
    id: 'hr',
    group: '基本', // 不翻
    label: '分隔线', // 不翻
    desc: '一条细线', // 不翻
    md: '***',
    icon: 'dash',
    keys: 'hr divider line fengexian fgx',
    // 项目规矩：分隔不用 ---（正文下面紧跟 --- 会变成标题）
    run: (view, from, to) => insertOwnBlock(view, from, to, '***', 5, 0, true),
  },
  // 提示块（callout）：先写标题，回车在块里写正文，空行再回车出块（doc-keys.ts）
  ...CALLOUTS.map(
    ([type, name, icon, own]): SlashItem => ({
      id: 'callout-' + type,
      group: '基本', // 不翻
      label: name,
      desc: '先写标题，回车写正文', // 不翻
      md: `> [!${type}]`,
      icon,
      keys: `callout tishikuai tsk tishi tip tips ${own}`,
      run: prefix(`> [!${type}] `),
    }),
  ),
  {
    id: 'details',
    group: '基本', // 不翻
    label: '折叠块', // 不翻
    desc: '点开才看得到里面的字', // 不翻
    md: '<details>',
    icon: 'chevron-right',
    keys: 'details fold zhedie zdk shouqi',
    run(view, from, to) {
      // 和提示块一样：先写标题（「收起的内容」选中，打字就换掉），回车进块里写正文（fold-block.ts 的 enterInFoldTitle）
      // 不翻：写进文件的默认标题
      insertOwnBlock(view, from, to, '<details><summary>收起的内容</summary>\n\n\n\n</details>', '<details><summary>'.length, '收起的内容'.length)
      // 刚插的块先展开
      view.dispatch({ effects: toggleFold.of(view.state.doc.lineAt(view.state.selection.main.head).from) })
    },
  },
  { id: 'date', group: '基本', label: '日期', desc: '今天的日期', md: '', icon: 'calendar', keys: 'date today riqi rq jintian', run: (view, from, to) => replace(view, from, to, today()) }, // 不翻
  {
    id: 'image',
    group: '图片和表格', // 不翻
    label: '图片', // 不翻
    desc: '拖进来或从网页剪', // 不翻
    md: '![]()',
    icon: 'file-media',
    keys: 'image picture img tupian tp',
    async run(view, from, to) {
      const host = view.state.facet(editorHost)
      if (typeof window.cn.pickImage !== 'function') return host.notice(tNow('「图片」这条还在做'))
      replace(view, from, to, '')
      const picked = await window.cn.pickImage(host.path())
      if (!picked) return
      const at = view.state.selection.main.head
      // 说明默认空（CN-40）：悬停图片时点「加说明…」再写
      replace(view, at, at, `![](${relativeLink(host.path(), picked)})`)
    },
  },
  {
    id: 'table',
    group: '图片和表格', // 不翻
    label: '表格', // 不翻
    desc: '几行几列', // 不翻
    md: '| |',
    icon: 'table',
    keys: 'table biaoge bg',
    run(view, from, to) {
      // 选中第一格「列 1」，直接打字就换掉（表格画成能直接改的格子，md-widgets.ts 接着在格子里编辑）
      insertOwnBlock(view, from, to, tableMarkdown(3, 3), 2, 3)
    },
  },
  {
    id: 'base',
    group: '图片和表格', // 不翻
    label: '数据库', // 不翻
    desc: '每一行是一篇笔记', // 不翻
    md: '```base',
    icon: 'database',
    keys: 'database base db shujuku sjk biao',
    run(view, from, to) {
      const host = view.state.facet(editorHost)
      return insertBase(view, host.path(), from, to).catch((e: unknown) => host.notice(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    },
  },
  {
    // 从笔记拍导图（task-wuv05）：做好的导图放在这篇旁边，光标处插一块缩略图（![[导图]]）；白板卡里不列（白板上用工具板「拍导图」）
    id: 'mindmap',
    // 不翻：名字、说明是键，画的地方翻（DATA 登记了 label、desc）
    group: '图片和表格',
    label: '拍导图', // 不翻
    desc: '拍手写的导图，插一块缩略图', // 不翻
    md: '![[ ]]',
    icon: 'device-camera',
    keys: 'mindmap map photo camera daotu dt paizhao',
    async run(view, from, to) {
      replace(view, from, to, '')
      // 用到时再拿（note-doc 要 DOM，单元测试里只读这张表）
      const { captureIntoView } = await import('./mindmap/place')
      if (!captureIntoView(view)) view.state.facet(editorHost).notice(tNow('这一篇是只读的，插不了导图'))
    },
  },
  {
    id: 'board',
    group: '链接', // 不翻
    label: '白板链接', // 不翻
    desc: '把一块白板嵌进来', // 不翻
    md: '[[ ]]',
    icon: 'layout',
    keys: 'board canvas baiban bb lianjie',
    run(view, from, to) {
      // 从库里的白板里挑（第一行「新建白板」）；插好的 [[白板]] 独占一行，画成一张白板卡
      replace(view, from, to, '')
      view.dispatch({ effects: openSlash.of({ from: -1, mode: 'link', boards: true }) })
    },
  },
  {
    id: 'link',
    group: '链接', // 不翻
    label: '链接到笔记', // 不翻
    desc: '双链，兼容 Obsidian', // 不翻
    md: '[[ ]]',
    icon: 'link',
    keys: 'link note wikilink lianjie lj biji shuanglian',
    run(view, from, to) {
      replace(view, from, to, '[[]]', 2)
      view.dispatch({ effects: openSlash.of({ from, mode: 'link' }) })
    },
  },
  {
    id: 'ai',
    group: 'AI', // 不翻
    label: 'AI 写一段', // 不翻
    desc: '接着上下文往下写', // 不翻
    md: '',
    icon: 'edit',
    keys: 'ai write xie xieyiduan',
    run(view, from, to) {
      if (typeof window.cn.aiAsk !== 'function') return view.state.facet(editorHost).notice(tNow('「AI 写一段」这条还在做'))
      replace(view, from, to, '')
      view.dispatch({ effects: openSlash.of({ from, mode: 'ai', made: aiMade(view, from) }) })
    },
  },
  {
    id: 'aisum',
    group: 'AI', // 不翻
    label: 'AI 总结这页', // 不翻
    desc: '写成三句话放在开头', // 不翻
    md: '',
    icon: 'list-flat',
    keys: 'ai summary zongjie zj',
    run(view, from, to) {
      if (typeof window.cn.aiAsk !== 'function') return view.state.facet(editorHost).notice(tNow('「AI 总结这页」这条还在做'))
      replace(view, from, to, '')
      view.dispatch({ effects: openSlash.of({ from, mode: 'ai', summary: true, made: aiMade(view, from) }) })
    },
  },
]

/** AI 两项为它新起的那一行：「+」新起的，或在文末那一行上打「/」选的（那一行定下来，AI 框什么都没写就收起时一起拿掉） */
function aiMade(view: EditorView, from: number): { from: number; to: number } | null {
  const made = view.state.field(slashMade, false)
  if (made) return made
  const at = keepTail(view, from)
  return at === null ? null : { from: at, to: at }
}

/** 点「+」新起的那一行（AI 两项接着用它：AI 框什么都没写就收起时一起拿掉） */
const setMade = StateEffect.define<{ from: number; to: number } | null>()
const slashMade = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setMade)) return e.value
    return v && tr.docChanged ? { from: tr.changes.mapPos(v.from, -1), to: tr.changes.mapPos(v.to, 1) } : v
  },
})

/** 菜单里列哪几项（2026-11-21 起白板上也画得出数据库卡：白板、文档一样） */
export function filterItems(q: string): SlashItem[] {
  const s = q.trim().toLowerCase()
  if (!s) return ITEMS
  // 英文界面另认英文名（打 numbered、callout 能找到），只认词头：打 ai 不会因为 Plain text 里有 ai 就排到前面；
  // 中文界面和以前一样，只认中文名、说明和别名
  const enHit = (en: string) => en.toLowerCase().split(/[^a-z0-9]+/).some((w) => w && w.startsWith(s))
  return ITEMS.filter(
    (it) =>
      it.label.toLowerCase().includes(s) ||
      it.desc.toLowerCase().includes(s) ||
      (it.md && it.md === s) ||
      it.keys.split(' ').some((k) => k.startsWith(s)) ||
      (uiLang() === 'en' && (enHit(tIn('en', it.label, { ctx: '插入菜单' })) || enHit(tIn('en', it.desc)))),
  )
}

function filterNotes(notes: NoteFile[], q: string, self: string, boards: boolean): NoteFile[] {
  const s = q.trim().toLowerCase()
  return notes
    .filter((n) => n.path !== self && (!boards || n.board) && (!s || titleOf(n.path).toLowerCase().includes(s)))
    .sort((a, b) => {
      // 名字以查询开头的排前面，其次最近改过的
      const pa = titleOf(a.path).toLowerCase().startsWith(s) ? 0 : 1
      const pb = titleOf(b.path).toLowerCase().startsWith(s) ? 0 : 1
      return pa - pb || b.mtimeMs - a.mtimeMs
    })
    .slice(0, 8)
}

// ---------- 菜单 ----------

interface Row {
  key: string
  icon: CodiconName
  name: string
  desc: string
  md?: string
  group?: string
  ai?: boolean
}

function Menu(props: { label: string; rows: Row[]; idx: number; empty: string; foot: string; onPick(i: number): void; onHover(i: number): void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  // 当前那一行滚进来（↑↓ 选到下面看不见的）。花括号不能省：Electron 里 scrollIntoView 返回 Promise，
  // 当成清理函数交给 React，重画时报「destroy_ is not a function」，整个菜单被卸掉、打字筛选时偶尔一片空
  useEffect(() => {
    ref.current?.querySelector('button.on')?.scrollIntoView({ block: 'nearest' })
  }, [props.idx, props.rows.length])
  return (
    <div ref={ref} className="slash-menu" role="listbox" aria-label={props.label}>
      {props.rows.length === 0 && <div className="slash-empty">{props.empty}</div>}
      {props.rows.map((r, i) => (
        <div key={r.key} role="none">
          {r.group && r.group !== props.rows[i - 1]?.group && <div className="slash-g">{t(r.group, { ctx: '插入菜单' })}</div>}
          <button
            role="option"
            aria-selected={i === props.idx}
            className={(i === props.idx ? 'on' : '') + (r.ai ? ' ai-row' : '')}
            onMouseDown={(e) => {
              e.preventDefault()
              props.onPick(i)
            }}
            onMouseMove={() => i !== props.idx && props.onHover(i)}
          >
            <span className="ib">{r.ai ? <AiIcon job="chat" size={16} /> : <Codicon name={r.icon} size={16} />}</span>
            <span className="tx">
              <b>{r.name}</b>
              <span>{r.desc}</span>
            </span>
            {r.md && <code>{r.md}</code>}
          </button>
        </div>
      ))}
      <div className="keys">{props.foot}</div>
    </div>
  )
}

/** 写的语言默认跟界面语言（task-zojmg），所以每次现取 */
// 不翻：给 AI 的提示词
const aiSystem = () => `你是 ${BRAND.name} 笔记软件里的写作助手。用户在写一篇笔记，请你按要求写一段能直接放进文中的文字。
用${answerLangName()}（除非笔记是别的语言），平实、直接；只输出要插入的那段 Markdown，不加解释、不加引号、不重复原文。`

function aiPrompt(path: string, text: string, at: number, want: string): string {
  const note = text.slice(0, at) + '⟨在这里写⟩' + text.slice(at) // 不翻：给 AI 的提示词
  const ask = want || '接着上下文往下写一段' // 不翻：给 AI 的提示词
  // 不翻：给 AI 的提示词和命令名
  return `命令：写一段\n文件：${path}\n\n要写的：${ask}\n\n下面是这篇笔记现在的内容，⟨在这里写⟩ 是要插入的位置。写一到三段，只输出这段文字。\n\n<note>\n${note}\n</note>`
}

function summaryPrompt(path: string, text: string): string {
  // 不翻：给 AI 的提示词和命令名
  return `命令：总结这页\n文件：${path}\n\n把下面这篇笔记写成三句话的总结，放在文章开头。只输出这三句话，不加标题、不加引号。\n\n<note>\n${text}\n</note>`
}

let aiSeq = 1_000_000

function AiBox(props: { summary: boolean; onSubmit(want: string, id: number): Promise<void>; onClose(): void }) {
  const t = useT()
  const [want, setWant] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const start = (text: string) => {
    const id = ++aiSeq
    setBusy(id)
    setError('')
    props.onSubmit(text, id).catch((err: Error) => {
      setBusy(null)
      setError(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    })
  }
  // 总结这页：不用说要写什么，一打开就开始
  useEffect(() => {
    if (props.summary) start('')
  }, [])
  return (
    <div className="slash-ai" role="dialog" aria-label={props.summary ? t('AI 总结这页', { ctx: '插入菜单' }) : t('AI 写一段', { ctx: '插入菜单' })}>
      <div className="slash-ai-row">
        <span className="ib">
          <AiIcon job="chat" size={16} />
        </span>
        <input
          autoFocus
          aria-label={t('让 AI 写什么')}
          placeholder={busy !== null ? (props.summary ? t('AI正在总结这页…') : t('AI正在写…')) : t('接着上下文往下写，或者说一句要写什么')}
          value={want}
          disabled={busy !== null}
          onChange={(e) => setWant(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Escape') {
              e.preventDefault()
              if (busy !== null) void window.cn.aiStop(busy)
              props.onClose()
            } else if (e.key === 'Enter' && busy === null) {
              e.preventDefault()
              start(want.trim())
            }
          }}
        />
        {busy !== null && (
          <button
            className="btn btn-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              void window.cn.aiStop(busy)
              props.onClose()
            }}
          >
            {t('停')}
          </button>
        )}
      </div>
      <div className="keys">{error || (busy !== null ? (props.summary ? t('AI正在总结，写好放在开头 · esc 停下') : t('AI正在写，写好插在光标处 · esc 停下')) : t('↵ 开始写 · esc 关闭'))}</div>
    </div>
  )
}

class SlashView {
  private pop = new Popover('slash-pop')
  private idx = 0
  private lastKey = ''
  private notes: NoteFile[] = []
  private notesFor = ''

  /** 「+」开的菜单：在菜单外面按下鼠标（点了正文、点了别处）就收起，什么都不留 */
  private onDown = (e: MouseEvent) => {
    const s = this.state
    if (!s?.plus || this.pop.el.contains(e.target as Node)) return
    if ((e.target as HTMLElement).closest?.('.blk-add')) return
    this.close()
  }

  constructor(readonly view: EditorView) {
    document.addEventListener('mousedown', this.onDown, true)
  }

  update(u: ViewUpdate) {
    const was = u.startState.field(slashField)
    const s = u.state.field(slashField)
    // 「+」开的插入菜单开着：编辑器里不露输入光标（字不进文档，露着像要打进上一段）
    u.view.dom.classList.toggle('cn-nocaret', !!s?.plus)
    // 打的「/」没选就失焦、光标离开那一行：和点「+」不选一样，什么都不留（CN-107）
    if (was && was.mode === 'slash' && !was.plus && !s) {
      const how = u.transactions.flatMap((t) => t.effects.filter((e) => e.is(closeSlash)).map((e) => e.value as string))[0]
      const left = (u.focusChanged && !u.view.hasFocus) || (!u.docChanged && u.selectionSet)
      if (!how && left) queueMicrotask(() => this.dropTyped(was, u.startState))
    }
    // 菜单开着时焦点离开编辑器（点了别处），或 AI 框开着时又点回正文：关；「+」开的菜单点了正文别处也关
    if (s && u.focusChanged && (s.mode === 'ai' ? u.view.hasFocus : !u.view.hasFocus)) {
      queueMicrotask(() => (s.mode === 'slash' && !s.plus ? this.dropTyped(s, u.state, true) : this.close(false, s.mode === 'ai')))
      return
    }
    if (!s) return this.pop.hide()
    const key = `${s.mode}:${s.from}:${s.boards}:${queryOf(u.state, s)}`
    if (key !== this.lastKey) this.idx = 0
    this.lastKey = key
    if (s.mode === 'link' && this.notesFor !== key.split(':').slice(0, 3).join(':')) {
      this.notesFor = key.split(':').slice(0, 3).join(':')
      void window.cn.listNotes().then((n) => {
        this.notes = n
        this.render()
      })
    }
    this.render()
  }

  /** 拿掉打的「/查询」（还原封不动在那里时）；close：同时关菜单 */
  private dropTyped(s: SlashState, state: EditorState, close = false) {
    if (close && this.state) this.view.dispatch({ effects: closeSlash.of('auto') })
    const doc = this.view.state.doc
    if (s.from < 0 || s.from >= doc.length) return
    const line = doc.lineAt(s.from)
    // 那一行从 / 到行尾的字：/ 后面只有筛选的字（没有空格）才拿掉
    const typed = doc.sliceString(s.from, line.to)
    const was = state.doc.sliceString(s.from, state.doc.lineAt(s.from).to)
    const m = /^[/、][^\s/、]*/.exec(typed)
    if (!m || !was.startsWith(m[0])) return
    this.view.dispatch({ changes: { from: s.from, to: s.from + m[0].length }, userEvent: 'delete.slash', annotations: hiddenOk.of(true) })
  }

  destroy() {
    document.removeEventListener('mousedown', this.onDown, true)
    this.pop.destroy()
  }

  get state() {
    return this.view.state.field(slashField)
  }

  /** 当前的选项 */
  rows(): { rows: Row[]; pick: (i: number) => void } {
    const s = this.state!
    const q = queryOf(this.view.state, s)
    const to = this.view.state.selection.main.head
    if (s.mode === 'link') {
      const notes = filterNotes(this.notes, q, this.view.state.facet(editorHost).path(), s.boards)
      const rows: Row[] = notes.map((n) => ({
        key: n.path,
        icon: n.board ? 'layout' : 'file-text',
        name: titleOf(n.path),
        desc: n.board ? tNow('白板 · {path}', { path: n.path }) : n.path,
      }))
      // 白板链接：第一行新建一块（原来「/白板」新建子白板的那一步）
      if (s.boards) rows.unshift({ key: '+new', icon: 'add', name: tNow('新建白板'), desc: tNow('在这篇旁边新建一块白板，插入它的链接') })
      return {
        rows,
        pick: (i) => {
          if (s.boards) {
            this.close()
            const at = this.view.state.selection.main.head
            if (i === 0) return void this.newBoard(at)
            const n = notes[i - 1]
            if (!n) return
            return this.putBoard(at, titleOf(n.path))
          }
          const n = notes[i]
          if (!n) return
          const close = this.view.state.doc.sliceString(to, to + 2) === ']]' ? 2 : 0
          const insert = `[[${titleOf(n.path)}]]`
          this.close()
          replace(this.view, s.from, to + close, insert)
        },
      }
    }
    const inCard = this.view.state.facet(slashInCard)
    const items = filterItems(q).filter((it) => !(inCard && it.id === 'mindmap'))
    // 不打字时分组列出；打了字按组的先后排（组名照样写在每组上面）
    const sorted = GROUPS.flatMap((g) => items.filter((it) => it.group === g))
    return {
      rows: sorted.map((it) => ({ key: it.id, icon: it.icon, name: tNow(it.label, { ctx: '插入菜单' }), desc: tNow(it.desc), md: itemMd(it.id, inCard), group: it.group, ai: it.group === 'AI' })),
      pick: (i) => {
        const it = sorted[i]
        if (!it) return
        if (s.plus) return this.pickPlus(it, s.plus)
        this.view.dispatch({ effects: closeSlash.of('pick') })
        this.pop.hide()
        Promise.resolve(it.run(this.view, s.from, to)).catch((e: Error) => this.view.state.facet(editorHost).notice(String(e.message)))
      },
    }
  }

  /** 点「+」开的菜单选了一项：这时才新起一行（这一块后面，或文末），在那一行上插这一项 */
  private pickPlus(it: SlashItem, plus: PlusAt) {
    const view = this.view
    view.dispatch({ effects: closeSlash.of('pick') })
    this.pop.hide()
    view.focus()
    let at: number
    if ('tail' in plus) {
      // 文末那一行：照「点了那一行」新起一段（前面和上一块隔一个空行），选的这一项插在那里
      const r = openTail(view, true)
      if (r === null) return
      at = r
    } else {
      // 这一块后面新起一个空行（和前后的块各隔一个空行，同块菜单「复制一块」放的位置）
      const old = view.state.doc.toString()
      const edit = insertMdBlockAfter(old, plus.block, '', drawnBlocks(view))
      view.dispatch({ changes: textChanges(old, edit.text), selection: { anchor: edit.at }, userEvent: 'input.block', annotations: hiddenOk.of(true), scrollIntoView: true })
      at = edit.at
    }
    view.dispatch({ effects: setMade.of({ from: at, to: at }) })
    Promise.resolve(it.run(view, at, at)).catch((e: Error) => view.state.facet(editorHost).notice(String(e.message)))
  }

  private async newBoard(at: number) {
    const host = this.view.state.facet(editorHost)
    const p = await window.cn.createBoard(folderOf(host.path()), '未命名白板') // 不翻：新建时的默认名字（文件名）
    this.putBoard(this.view.state.selection.main.head === at ? at : this.view.state.selection.main.head, titleOf(p))
    host.notice(tNow('新建了白板「{name}」', { name: titleOf(p) }))
  }

  /** [[白板]] 独占一行（画成白板卡）：插在光标那一行，前后和别的段落隔开，光标落到卡下面新起的一段 */
  private putBoard(at: number, name: string) {
    const md = `[[${name}]]`
    const line = this.view.state.doc.lineAt(at)
    if (line.text.trim() === '') insertOwnBlock(this.view, line.from, line.to, md, md.length + 2, 0, true)
    else replace(this.view, at, at, md)
  }

  render() {
    const s = this.state
    if (!s) return this.pop.hide()
    const from = s.plus ? -1 : s.from
    this.view.requestMeasure({
      key: this,
      read: (view) => this.anchor(view, s, from),
      write: (anchor) => {
        const cur = this.state
        if (!cur || !anchor) return this.pop.hide()
        if (cur.mode === 'ai') {
          this.pop.show(<AiBox key={'ai' + cur.from} summary={cur.summary} onSubmit={(w, id) => this.writeAi(w, id)} onClose={() => this.close(true, true)} />, anchor)
          return
        }
        const { rows, pick } = this.rows()
        if (this.idx >= rows.length) this.idx = 0
        const q = queryOf(this.view.state, cur)
        this.pop.show(
          <Menu
            label={cur.mode === 'link' ? (cur.boards ? tNow('白板链接', { ctx: '插入菜单' }) : tNow('链接到笔记', { ctx: '插入菜单' })) : tNow('插入')}
            rows={rows}
            idx={this.idx}
            empty={cur.mode === 'link' ? (cur.boards ? tNow('没有叫这个名字的白板') : tNow('没有叫这个名字的笔记')) : tNow('没有叫「{q}」的块', { q })}
            foot={cur.mode === 'link' ? tNow('↑↓ 选择 · ↵ 插入 · esc 关闭') : tNow('右边是它在 md 里的写法 · ↑↓ 选择 · ↵ 插入 · esc 关闭')}
            onPick={pick}
            onHover={(i) => {
              this.idx = i
              this.render()
            }}
          />,
          anchor,
        )
      },
    })
  }

  /** 菜单贴在哪：打的 / 下面；「+」开的贴在那一块（文末那一行）下面 4，左边和块对齐 */
  private anchor(view: EditorView, s: SlashState, from: number): { left: number; top: number; bottom: number } | null {
    if (s.plus) {
      const box = plusBox(view, s.plus)
      return box ? { left: box.left, top: box.top - 2, bottom: box.bottom - 2 } : null
    }
    if (from < 0) {
      const c = view.coordsAtPos(view.state.selection.main.head)
      return c && { left: c.left, top: c.top, bottom: c.bottom }
    }
    const c = view.coordsAtPos(from)
    if (!c) return null
    const left = view.contentDOM.getBoundingClientRect().left
    return { left: s.mode === 'slash' ? left : c.left, top: c.top, bottom: c.bottom }
  }

  move(d: number): boolean {
    const n = this.rows().rows.length
    if (!n) return true
    this.idx = (this.idx + d + n) % n
    this.render()
    return true
  }

  enter(): boolean {
    const { rows, pick } = this.rows()
    if (!rows.length) {
      this.close()
      return false
    }
    pick(this.idx)
    return true
  }

  escape() {
    this.close(true)
  }

  /** 「+」开的菜单打字筛选：字不进文档 */
  typePlus(text: string): boolean {
    const s = this.state
    if (!s?.plus) return false
    this.view.dispatch({ effects: plusQuery.of(s.q + text) })
    return true
  }

  backPlus(): boolean {
    const s = this.state
    if (!s?.plus) return false
    if (!s.q) return true
    this.view.dispatch({ effects: plusQuery.of(Array.from(s.q).slice(0, -1).join('')) })
    return true
  }

  close(focus = false, dropMade = false) {
    const s = this.state
    if (s) this.view.dispatch({ effects: closeSlash.of('esc') })
    this.pop.hide()
    // AI 框什么都没写就收起：为它新起的空行拿掉
    if (dropMade && s?.made) {
      const { from, to } = s.made
      const doc = this.view.state.doc
      if (to <= doc.length && doc.sliceString(from, to).trim() === '') this.dropLine(from)
    }
    if (focus) this.view.focus()
  }

  /** 拿掉 pos 那一个空行，连同把它和上一块隔开的空行（「+」新起的那几个换行） */
  private dropLine(pos: number) {
    const doc = this.view.state.doc
    const line = doc.lineAt(pos)
    if (line.text !== '') return
    const from = line.number > 2 && doc.line(line.number - 1).text === '' ? doc.line(line.number - 1).from - 1 : Math.max(0, line.from - 1)
    this.view.dispatch({ changes: { from, to: line.to }, userEvent: 'delete.slash', annotations: hiddenOk.of(true) })
  }

  /**
   * AI 写一段、总结这页：AI 的字边收边写进编辑器、一点点长出来（ai-write.ts，task-6kun1）；第一批字到了问的小框收起。
   * 写进去的和以前一次插进去的一样：写一段插在那一空行（行里有字另起一段），总结这页插在开头、后面空一行；
   * 写的字包在一个 [!ai] 块里（task-dtc34）：「AI 写的 · 哪家 · 模型」，总结这页是「AI 总结 · …」
   */
  private async writeAi(want: string, id: number) {
    const s = this.state
    if (!s) return
    const host = this.view.state.facet(editorHost)
    const text = this.view.state.doc.toString()
    const by = withoutEffort((await window.cn.aiPrefs()).labels.chat)
    // 白板卡里就地改的小编辑器（不边收边写的那种）：卡就是卡，不包（同白板上 AI 加的卡，task-dtc34）
    const head = !canStream(this.view.state) ? undefined : s.summary ? aiCalloutHead({ label: calloutWords().summary, ...(by ? { by } : {}) }) : aiWroteHead(by ? { by } : {})
    const w = new AiStreamWrite(this.view, id, host.path(), () => {
      const cur = this.state
      // 字来之前小框已经收了（点回了正文）：不写
      if (!cur || cur.mode !== 'ai') return null
      if (cur.summary) {
        // 总结这页：放在开头（标题和它下面那一行后面），这一行新起的空行拿掉
        this.close(true, true)
        return { pos: summaryAt(this.view.state), before: '', after: '\n\n' }
      }
      const at = cur.from
      this.close(true)
      // 插在空行上就直接放；行里有字就另起一段
      return { pos: at, before: this.view.state.doc.lineAt(at).text.trim() === '' ? '' : '\n\n', after: '' }
    }, head)
    const off = window.cn.onAiEvent((eid, e) => {
      if (eid === id && e.type === 'text') w.push(e.delta)
    })
    try {
      const reply = await window.cn.aiAsk(id, aiSystem(), s.summary ? summaryPrompt(host.path(), text) : aiPrompt(host.path(), text, s.from, want))
      await w.done(reply)
      if (!w.started && this.state?.mode === 'ai') this.close(true, true)
    } catch (e) {
      // 还没开始写：照旧在小框里说为什么；写到一半出错：停在已经显出来的那里，底部说一句
      if (!w.started) throw e
      const stopped = w.stopped
      w.stop()
      if (!stopped) host.notice(tNow('AI 没写完：{err}', { err: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
    } finally {
      off()
    }
  }
}

/** 总结放哪：标题（# 开头的第一行）下面空一行；没有标题放最前面（frontmatter 后面） */
function summaryAt(state: EditorState): number {
  const text = state.doc.toString()
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text)
  let pos = fm ? fm[0].length : 0
  const rest = text.slice(pos)
  const h = /^# .*(?:\n|$)/.exec(rest)
  if (h) {
    pos += h[0].length
    while (text[pos] === '\n') pos++
  }
  return pos
}

/** 「+」开的菜单贴哪一块：那一块最后一行的下沿（文末那一行就是它自己） */
function plusBox(view: EditorView, plus: PlusAt): { left: number; top: number; bottom: number } | null {
  const left = view.contentDOM.getBoundingClientRect().left
  if ('tail' in plus) {
    const el = view.dom.querySelector('.cm-tailline')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left, top: r.top, bottom: r.bottom }
  }
  const b = drawnBlocks(view)[plus.block]
  if (!b) return null
  const first = view.coordsAtPos(b.from, 1)
  const last = view.lineBlockAt(b.to)
  const top = first ? first.top : view.documentTop + view.lineBlockAt(b.from).top
  const bottom = view.documentTop + last.bottom
  // 一块很高（表格、图片）：贴着第一行下面，不跑到屏幕外
  return { left, top, bottom: Math.min(bottom, top + 34) }
}

const slashView = ViewPlugin.fromClass(SlashView)

const withMenu = (run: (p: SlashView) => boolean | void) => (view: EditorView) => {
  const s = view.state.field(slashField)
  if (!s || s.mode === 'ai') return false
  const p = view.plugin(slashView)
  if (!p) return false
  return run(p) !== false
}

/** 点「+」开插入菜单（文档里不写「/」） */
export function openPlus(view: EditorView, at: PlusAt) {
  view.dispatch({ effects: openSlash.of({ from: -1, plus: at }) })
}

/** 开着的菜单是不是点「+」开的、插在哪 */
export function plusOpen(state: EditorState): PlusAt | null {
  return state.field(slashField, false)?.plus ?? null
}

const slashKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: withMenu((p) => p.move(1)) },
    { key: 'ArrowUp', run: withMenu((p) => p.move(-1)) },
    { key: 'Enter', run: withMenu((p) => p.enter()) },
    { key: 'Tab', run: withMenu((p) => p.enter()) },
    { key: 'Escape', run: withMenu((p) => p.escape()) },
    { key: 'Backspace', run: withMenu((p) => p.backPlus()) },
  ]),
)

/** 「+」开的菜单开着时打的字：只筛选，不进文档 */
const plusInput = EditorView.inputHandler.of((view, _from, _to, text) => {
  const s = view.state.field(slashField)
  if (!s?.plus) return false
  return view.plugin(slashView)?.typePlus(text) ?? false
})

export const slashMenu = [slashField, slashMade, slashView, slashKeys, plusInput]
