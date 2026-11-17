/**
 * 文档标题下面的元信息行，最前面一颗「收件箱 ▾」（CN-11）：写着这篇在哪个文件夹，点开是「移到…」的文件夹菜单，
 * 点一项真的挪过去（开着的标签跟着换路径）。只是编辑器里的装饰，不动文字（打开再保存文件不变）。
 */
import { codiconEl } from '@cn/design'
import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { app } from './ctx/actions'
import { showMenu } from './ctx/menu'
import { moveMenu } from './ctx/move-menu'
import { headingOf } from './title-follow'

/** 这篇改名、挪走以后，NoteDoc 用它告诉编辑器新路径 */
export const setNotePath = StateEffect.define<string>()

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const label = (folder: string) => folder || '库的最外层'

class FolderChip extends WidgetType {
  constructor(readonly path: string) {
    super()
  }
  eq(o: FolderChip) {
    return o.path === this.path
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
    b.dataset.tip = '移到…'
    b.dataset.side = 'below'
    const name = document.createElement('span')
    name.textContent = label(here)
    b.append(codiconEl(here ? 'folder' : 'root-folder', 13), name, codiconEl('chevron-down', 12))
    // 点它不挪光标、不进编辑
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => {
      const a = app()
      void showMenu(moveMenu([...new Set([...a.allFolders(), '收件箱'])], here, (f) => a.moveNote(this.path, f)))
    })
    box.append(b)
    return box
  }
  /** 只有「所在文件夹」按钮自己的事编辑器不管；点这一行别的空处照常把光标放进文档 */
  ignoreEvent(e: Event) {
    return !!(e.target as Element | null)?.closest?.('.cm-folder')
  }
}

function chips(state: EditorState, path: string): DecorationSet {
  const h = headingOf(state.doc.toString())
  if (!h || h.line > state.doc.lines) return Decoration.none
  const line = state.doc.line(h.line)
  const out: Range<Decoration>[] = [Decoration.widget({ widget: new FolderChip(path), block: true, side: 1 }).range(line.to)]
  return Decoration.set(out)
}

/** 编辑器扩展：path 是打开时的路径，之后靠 setNotePath 更新 */
export function folderChip(path: string): Extension {
  const field = StateField.define<{ path: string; deco: DecorationSet }>({
    create: (state) => ({ path, deco: chips(state, path) }),
    update(v, tr) {
      let p = v.path
      for (const e of tr.effects) if (e.is(setNotePath)) p = e.value
      if (p === v.path && !tr.docChanged) return v
      return { path: p, deco: chips(tr.state, p) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return field
}
