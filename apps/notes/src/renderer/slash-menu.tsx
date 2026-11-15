import { Icon } from '@cn/design'
import { relativeLink, tableMarkdown } from '@cn/format'
import { Prec, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  CalendarDays,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  LayoutGrid,
  Link,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pilcrow,
  Quote,
  Sparkles,
  SquareCheck,
  Table,
} from 'lucide-react'
import { useState } from 'react'
import type { NoteFile } from '../shared/api'
import { BRAND } from '../shared/brand'
import { titleOf } from '../shared/layout'
import { editorHost, Popover } from './editor-host'

/**
 * 文档里的 / 菜单（像 Notion）：在空行或行首打 /（中文输入法打出的「、」也算），弹出插入菜单；
 * 接着打字筛选，↑↓ 选，回车插入，Esc 关。插进去的都是普通 md。
 * 打 [[ 弹出笔记列表（「链接到笔记」也走这里）。
 */

type Mode = 'slash' | 'link' | 'ai'

interface SlashState {
  mode: Mode
  /** / 或 [[ 的位置；AI 模式下是要插入的位置 */
  from: number
  /** 是点「+」加出来的那一行：Esc 时连这一行一起拿掉 */
  plus: boolean
}

export const openSlash = StateEffect.define<{ from: number; plus?: boolean; mode?: Mode }>()
const closeSlash = StateEffect.define<null>()

const SLASH_CHARS = ['/', '、']

function markerLen(s: SlashState) {
  return s.mode === 'link' ? 2 : 1
}

const slashField = StateField.define<SlashState | null>({
  create: () => null,
  update(v, tr) {
    if (v && tr.docChanged) v = { ...v, from: tr.changes.mapPos(v.from, -1) }
    for (const e of tr.effects) {
      if (e.is(openSlash)) v = { mode: e.value.mode ?? 'slash', from: e.value.from, plus: !!e.value.plus }
      if (e.is(closeSlash)) return null
    }
    const doc = tr.state.doc
    if (!v && tr.docChanged && tr.isUserEvent('input.type')) {
      tr.changes.iterChanges((_fa, _ta, fb, _tb, ins) => {
        const s = ins.toString()
        if (SLASH_CHARS.includes(s)) {
          const line = doc.lineAt(fb)
          if (/^[ \t]*$/.test(doc.sliceString(line.from, fb))) v = { mode: 'slash', from: fb, plus: false }
        } else if (s === '[' && doc.sliceString(fb - 1, fb) === '[') v = { mode: 'link', from: fb - 1, plus: false }
      })
    }
    if (!v || v.mode === 'ai') return v
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

const queryOf = (state: EditorState, s: SlashState) => state.doc.sliceString(s.from + markerLen(s), state.selection.main.head)

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
    scrollIntoView: true,
  })
}

interface SlashItem {
  id: string
  label: string
  desc: string
  icon: LucideIcon
  /** 筛选用的别名（英文、拼音） */
  keys: string
  run(view: EditorView, from: number, to: number): void | Promise<void>
}

const prefix = (p: string) => (view: EditorView, from: number, to: number) => replace(view, from, to, p)

const ITEMS: SlashItem[] = [
  { id: 'text', label: '正文', desc: '普通的一段字', icon: Pilcrow, keys: 'text paragraph zhengwen zw p', run: prefix('') },
  { id: 'h1', label: '一级标题', desc: '# 大标题', icon: Heading1, keys: 'h1 heading title biaoti bt yiji', run: prefix('# ') },
  { id: 'h2', label: '二级标题', desc: '## 小节标题', icon: Heading2, keys: 'h2 heading biaoti bt erji', run: prefix('## ') },
  { id: 'h3', label: '三级标题', desc: '### 小标题', icon: Heading3, keys: 'h3 heading biaoti bt sanji', run: prefix('### ') },
  { id: 'todo', label: '待办列表', desc: '- [ ] 能勾选的一项', icon: SquareCheck, keys: 'todo task check daiban db', run: prefix('- [ ] ') },
  { id: 'bullet', label: '无序列表', desc: '- 一项', icon: List, keys: 'bullet list ul liebiao lb wuxu', run: prefix('- ') },
  { id: 'ordered', label: '有序列表', desc: '1. 第一项', icon: ListOrdered, keys: 'ordered number list ol liebiao lb youxu', run: prefix('1. ') },
  { id: 'quote', label: '引用', desc: '> 一段引文', icon: Quote, keys: 'quote blockquote yinyong yy', run: prefix('> ') },
  {
    id: 'code',
    label: '代码块',
    desc: '``` 等宽的代码',
    icon: Code,
    keys: 'code daima dm',
    run(view, from, to) {
      const line = view.state.doc.lineAt(from)
      const rest = view.state.doc.sliceString(to, line.to)
      view.dispatch({
        changes: { from, to: line.to, insert: '```\n' + rest + '\n```' },
        selection: { anchor: from + 4 + rest.length },
        userEvent: 'input.slash',
      })
    },
  },
  {
    id: 'hr',
    label: '分隔线',
    desc: '--- 一条横线',
    icon: Minus,
    keys: 'hr divider line fengexian fgx',
    run(view, from, to) {
      const md = from === 0 ? '***' : '---'
      insertOwnBlock(view, from, to, md, md.length + 2, 0, true)
    },
  },
  {
    id: 'table',
    label: '表格',
    desc: '3 列 3 行的 md 表格',
    icon: Table,
    keys: 'table biaoge bg',
    run(view, from, to) {
      // 选中第一格「列 1」，直接打字就换掉
      insertOwnBlock(view, from, to, tableMarkdown(3, 3), 2, 3)
    },
  },
  {
    id: 'image',
    label: '图片',
    desc: '选一张图，拷进库的「附件」',
    icon: Image,
    keys: 'image picture img tupian tp',
    async run(view, from, to) {
      const host = view.state.facet(editorHost)
      if (typeof window.cn.pickImage !== 'function') return host.notice('「图片」这条还在做')
      replace(view, from, to, '')
      const picked = await window.cn.pickImage()
      if (!picked) return
      const at = view.state.selection.main.head
      const alt = titleOf(picked).replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')
      replace(view, at, at, `![${alt}](${relativeLink(host.path(), picked)})`)
    },
  },
  {
    id: 'link',
    label: '链接到笔记',
    desc: '[[笔记名]]，从列表里挑',
    icon: Link,
    keys: 'link note wikilink lianjie lj biji',
    run(view, from, to) {
      replace(view, from, to, '[[]]', 2)
      view.dispatch({ effects: openSlash.of({ from, mode: 'link' }) })
    },
  },
  {
    id: 'board',
    label: '白板',
    desc: '新建一块子白板，插入 [[名字]]',
    icon: LayoutGrid,
    keys: 'board canvas baiban bb',
    async run(view, from, to) {
      const host = view.state.facet(editorHost)
      replace(view, from, to, '')
      const p = await window.cn.createBoard(folderOf(host.path()), '未命名白板')
      const at = view.state.selection.main.head
      replace(view, at, at, `[[${titleOf(p)}]]`)
      host.notice(`新建了白板「${titleOf(p)}」，⌘ 点链接打开`)
    },
  },
  {
    id: 'date',
    label: '日期',
    desc: '今天的日期',
    icon: CalendarDays,
    keys: 'date today riqi rq jintian',
    run: (view, from, to) => replace(view, from, to, today()),
  },
  {
    id: 'ai',
    label: 'AI 写一段',
    desc: '说一句要写什么，写好插在这里',
    icon: Sparkles,
    keys: 'ai write xie xieyiduan',
    run(view, from, to) {
      if (typeof window.cn.aiAsk !== 'function') return view.state.facet(editorHost).notice('「AI 写一段」这条还在做')
      replace(view, from, to, '')
      view.dispatch({ effects: openSlash.of({ from, mode: 'ai' }) })
    },
  },
]

function filterItems(q: string): SlashItem[] {
  const s = q.trim().toLowerCase()
  if (!s) return ITEMS
  return ITEMS.filter((it) => it.label.toLowerCase().includes(s) || it.keys.split(' ').some((k) => k.startsWith(s)))
}

function filterNotes(notes: NoteFile[], q: string, self: string): NoteFile[] {
  const s = q.trim().toLowerCase()
  return notes
    .filter((n) => n.path !== self && (!s || titleOf(n.path).toLowerCase().includes(s)))
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
  icon: LucideIcon
  name: string
  desc: string
}

function Menu(props: { label: string; rows: Row[]; idx: number; empty: string; onPick(i: number): void; onHover(i: number): void }) {
  return (
    <div className="slash-menu" role="listbox" aria-label={props.label}>
      {props.rows.length === 0 && <div className="slash-empty">{props.empty}</div>}
      {props.rows.map((r, i) => (
        <button
          key={r.key}
          role="option"
          aria-selected={i === props.idx}
          className={i === props.idx ? 'on' : ''}
          onMouseDown={(e) => {
            e.preventDefault()
            props.onPick(i)
          }}
          onMouseMove={() => i !== props.idx && props.onHover(i)}
        >
          <span className="ib">
            <Icon of={r.icon} size={14} />
          </span>
          <span className="tx">
            <b>{r.name}</b>
            <span>{r.desc}</span>
          </span>
        </button>
      ))}
      <div className="keys">↑↓ 选择 · ↵ 插入 · esc 关闭</div>
    </div>
  )
}

const AI_SYSTEM = `你是 ${BRAND.name} 笔记软件里的写作助手。用户在写一篇笔记，请你按要求写一段能直接放进文中的文字。
用中文（除非笔记是别的语言），平实、直接；只输出要插入的那段 Markdown，不加解释、不加引号、不重复原文。`

function aiPrompt(path: string, text: string, at: number, want: string): string {
  const note = text.slice(0, at) + '⟨在这里写⟩' + text.slice(at)
  return `命令：写一段\n文件：${path}\n\n要写的：${want}\n\n下面是这篇笔记现在的内容，⟨在这里写⟩ 是要插入的位置。写一到三段，只输出这段文字。\n\n<note>\n${note}\n</note>`
}

let aiSeq = 1_000_000

function AiBox(props: { onSubmit(want: string, id: number): Promise<void>; onClose(): void }) {
  const [want, setWant] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  return (
    <div className="slash-ai" role="dialog" aria-label="AI 写一段">
      <div className="slash-ai-row">
        <span className="ib">
          <Icon of={Sparkles} size={14} />
        </span>
        <input
          autoFocus
          aria-label="让 AI 写什么"
          placeholder={busy !== null ? 'AI 正在写…' : '让 AI 写什么？比如：总结上面三段'}
          value={want}
          disabled={busy !== null}
          onChange={(e) => setWant(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              if (busy !== null) void window.cn.aiStop(busy)
              props.onClose()
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && want.trim() && busy === null) {
              e.preventDefault()
              const id = ++aiSeq
              setBusy(id)
              setError('')
              props.onSubmit(want.trim(), id).catch((err: Error) => {
                setBusy(null)
                setError(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
              })
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
            停
          </button>
        )}
      </div>
      <div className="keys">{error || (busy !== null ? 'AI 正在写，写好插在光标处 · esc 停下' : '↵ 开始写 · esc 关闭')}</div>
    </div>
  )
}

class SlashView {
  private pop = new Popover('slash-pop')
  private idx = 0
  private lastKey = ''
  private notes: NoteFile[] = []
  private notesFor = -1

  constructor(readonly view: EditorView) {}

  update(u: ViewUpdate) {
    const s = u.state.field(slashField)
    // 菜单开着时焦点离开编辑器（点了别处），或 AI 框开着时又点回正文：关
    if (s && u.focusChanged && (s.mode === 'ai' ? u.view.hasFocus : !u.view.hasFocus)) {
      queueMicrotask(() => this.close())
      return
    }
    if (!s) return this.pop.hide()
    const key = `${s.mode}:${s.from}:${queryOf(u.state, s)}`
    if (key !== this.lastKey) this.idx = 0
    this.lastKey = key
    if (s.mode === 'link' && this.notesFor !== s.from) {
      this.notesFor = s.from
      void window.cn.listNotes().then((n) => {
        this.notes = n
        this.render()
      })
    }
    this.render()
  }

  destroy() {
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
      const notes = filterNotes(this.notes, q, this.view.state.facet(editorHost).path())
      return {
        rows: notes.map((n) => ({
          key: n.path,
          icon: n.board ? LayoutGrid : FileText,
          name: titleOf(n.path),
          desc: n.board ? `白板 · ${n.path}` : n.path,
        })),
        pick: (i) => {
          const n = notes[i]
          if (!n) return
          const close = this.view.state.doc.sliceString(to, to + 2) === ']]' ? 2 : 0
          const insert = `[[${titleOf(n.path)}]]`
          this.close()
          replace(this.view, s.from, to + close, insert)
        },
      }
    }
    const items = filterItems(q)
    return {
      rows: items.map((it) => ({ key: it.id, icon: it.icon, name: it.label, desc: it.desc })),
      pick: (i) => {
        const it = items[i]
        if (!it) return
        this.close()
        Promise.resolve(it.run(this.view, s.from, to)).catch((e: Error) => this.view.state.facet(editorHost).notice(String(e.message)))
      },
    }
  }

  render() {
    const s = this.state
    if (!s) return this.pop.hide()
    const from = s.from
    this.view.requestMeasure({
      key: this,
      read: (view) => view.coordsAtPos(from),
      write: (coords) => {
        const cur = this.state
        if (!cur || !coords) return this.pop.hide()
        const anchor = { left: coords.left, top: coords.top, bottom: coords.bottom }
        if (cur.mode === 'ai') {
          this.pop.show(<AiBox key={'ai' + cur.from} onSubmit={(w, id) => this.writeAi(w, id)} onClose={() => this.close(true)} />, anchor)
          return
        }
        const { rows, pick } = this.rows()
        if (this.idx >= rows.length) this.idx = 0
        this.pop.show(
          <Menu
            label={cur.mode === 'link' ? '链接到笔记' : '插入'}
            rows={rows}
            idx={this.idx}
            empty={cur.mode === 'link' ? '没有叫这个名字的笔记' : '没有匹配的，按 esc 关掉'}
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

  /** 关掉；点「+」加出来的那一行还只有「/查询」时一起拿掉 */
  escape() {
    const s = this.state
    if (s?.plus && s.mode === 'slash') {
      const doc = this.view.state.doc
      const line = doc.lineAt(s.from)
      const only = line.from === s.from && line.to === this.view.state.selection.main.head
      if (only) {
        const pre = doc.sliceString(line.from - 2, line.from) === '\n\n' ? 2 : 0
        this.close()
        this.view.dispatch({ changes: { from: line.from - pre, to: line.to }, userEvent: 'delete.slash' })
        return
      }
    }
    this.close()
  }

  close(focus = false) {
    if (this.state) this.view.dispatch({ effects: closeSlash.of(null) })
    this.pop.hide()
    if (focus) this.view.focus()
  }

  private async writeAi(want: string, id: number) {
    const s = this.state
    if (!s) return
    const host = this.view.state.facet(editorHost)
    const reply = await window.cn.aiAsk(id, AI_SYSTEM, aiPrompt(host.path(), this.view.state.doc.toString(), s.from, want))
    const cur = this.state
    if (!cur || cur.mode !== 'ai') return
    const at = cur.from
    const line = this.view.state.doc.lineAt(at)
    const text = reply.trim()
    // 插在空行上就直接放；行里有字就另起一段
    const insert = line.text.trim() === '' ? text : '\n\n' + text
    this.close(true)
    replace(this.view, at, at, insert)
  }
}

const slashView = ViewPlugin.fromClass(SlashView)

const withMenu = (run: (p: SlashView) => boolean | void) => (view: EditorView) => {
  const s = view.state.field(slashField)
  if (!s || s.mode === 'ai') return false
  const p = view.plugin(slashView)
  if (!p) return false
  return run(p) !== false
}

const slashKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: withMenu((p) => p.move(1)) },
    { key: 'ArrowUp', run: withMenu((p) => p.move(-1)) },
    { key: 'Enter', run: withMenu((p) => p.enter()) },
    { key: 'Tab', run: withMenu((p) => p.enter()) },
    { key: 'Escape', run: withMenu((p) => p.escape()) },
  ]),
)

export const slashMenu = [slashField, slashView, slashKeys]
