/**
 * 文档标题下面的元信息行（DESIGN.v3 6.1）：「收件箱 ▾ · 改于今天 10:34 · 1,240 字」，新建的是「写作 ▾ · 刚建 · 0 字」。
 * 最前面一颗「所在文件夹 ▾」（CN-11）：点开是「移到…」的文件夹菜单，点一项真的挪过去（开着的标签跟着换路径）。
 * 改于什么时候由 NoteTab 按文件的修改时间告诉编辑器（setNoteMeta）；字数按正文数（标题不算，中文一个字一个，英文一个词一个）。
 * 只是编辑器里的装饰，不动文字（打开再保存文件不变）。
 */
import { codiconEl } from '@cn/design'
import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { app } from './ctx/actions'
import { showMenu } from './ctx/menu'
import { moveMenu } from './ctx/move-menu'
import { isBookDigest } from '../shared/plugins/weread'
import { headingOf } from './title-follow'
import { when } from '../shared/when'
import { folderLabel } from './vault-name'

/** 这篇改名、挪走以后，NoteDoc 用它告诉编辑器新路径 */
export const setNotePath = StateEffect.define<string>()

/** 文件的修改时间（毫秒）；fresh：这次刚新建的 */
export const setNoteMeta = StateEffect.define<{ mtime?: number; fresh?: boolean }>()

/** 正文多少字：标题、frontmatter、注释、md 记号不算；中文一个字算一个，英文、数字一个词算一个 */
export function countWords(text: string): number {
  let body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  body = body.replace(/^# .*(?:\n|$)/, '')
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[^\n]*\n/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
  const cjk = body.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words = body.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + words
}

const thousands = (n: number) => n.toLocaleString('en-US')

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** 最外层写库名（CN-106） */
const label = folderLabel

class FolderChip extends WidgetType {
  constructor(
    readonly path: string,
    /** 「· 改于今天 10:34 · 1,240 字」 */
    readonly rest: string,
  ) {
    super()
  }
  eq(o: FolderChip) {
    return o.path === this.path && o.rest === this.rest
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-meta'
    // 拖到这一行上的图片、文件：当成拖到标题下面的空行，转给编辑器（插图在那里接）
    box.addEventListener('dragover', (e) => e.preventDefault())
    box.addEventListener('drop', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const below = view.coordsAtPos(Math.min(view.state.doc.length, view.state.doc.lineAt(view.posAtDOM(box)).to + 1))
      view.contentDOM.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, clientX: e.clientX, clientY: below ? below.top + 2 : e.clientY, bubbles: true, cancelable: true }))
    })
    const b = document.createElement('button')
    b.className = 'cm-folder'
    b.type = 'button'
    const here = folderOf(this.path)
    b.setAttribute('aria-label', `所在文件夹：${label(here)}，点开移到别处`)
    // 只写所在的那一层（整条路径标题栏的位置里已经有了），整条路径放在悬停提示里（设计复审）
    b.dataset.tip = here.includes('/') ? `${here.split('/').join(' / ')} · 移到…` : '移到…'
    b.dataset.side = 'below'
    const name = document.createElement('span')
    name.textContent = here ? here.slice(here.lastIndexOf('/') + 1) : label(here)
    b.append(codiconEl(here ? 'folder' : 'library', 13), name, codiconEl('chevron-down', 12))
    // 点它不挪光标、不进编辑
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => {
      const a = app()
      void showMenu(moveMenu([...new Set([...a.allFolders(), '收件箱'])], here, (f) => a.moveNote(this.path, f)))
    })
    const rest = document.createElement('span')
    rest.className = 'cm-meta-rest'
    rest.textContent = this.rest
    box.append(b, rest)
    return box
  }
  /** 只有「所在文件夹」按钮自己的事编辑器不管；点这一行别的空处照常把光标放进文档 */
  ignoreEvent(e: Event) {
    return !!(e.target as Element | null)?.closest?.('.cm-folder')
  }
}

interface Meta {
  path: string
  mtime: number | null
  fresh: boolean
  deco: DecorationSet
}

function chips(state: EditorState, m: Omit<Meta, 'deco'>): DecorationSet {
  // 微信读书同步来的书摘：标题下面是一行摘要（props-block.ts 的 BookMetaLine，CN-122），不画这一颗
  if (isBookDigest(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))) return Decoration.none
  const text = state.doc.toString()
  const h = headingOf(text)
  if (!h || h.line > state.doc.lines) return Decoration.none
  const line = state.doc.line(h.line)
  const n = countWords(text)
  const at = m.fresh && n === 0 ? '刚建' : m.mtime ? `改于${when(m.mtime, { time: true })}` : ''
  const rest = [at, `${thousands(n)} 字`].filter(Boolean).map((x) => ` · ${x}`).join('')
  const out: Range<Decoration>[] = [Decoration.widget({ widget: new FolderChip(m.path, rest), block: true, side: 1 }).range(line.to)]
  return Decoration.set(out)
}

/** 编辑器扩展：path 是打开时的路径，之后靠 setNotePath 更新；改于什么时候靠 setNoteMeta */
export function folderChip(path: string): Extension {
  const field = StateField.define<Meta>({
    create: (state) => {
      const m = { path, mtime: null, fresh: false }
      return { ...m, deco: chips(state, m) }
    },
    update(v, tr) {
      let m = { path: v.path, mtime: v.mtime, fresh: v.fresh }
      for (const e of tr.effects) {
        if (e.is(setNotePath)) m = { ...m, path: e.value }
        if (e.is(setNoteMeta)) m = { ...m, ...(e.value.mtime !== undefined ? { mtime: e.value.mtime } : {}), ...(e.value.fresh !== undefined ? { fresh: e.value.fresh } : {}) }
      }
      if (m.path === v.path && m.mtime === v.mtime && m.fresh === v.fresh && !tr.docChanged) return v
      return { ...m, deco: chips(tr.state, m) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return field
}
