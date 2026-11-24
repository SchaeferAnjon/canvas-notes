/**
 * 文档里接图片：网页里的图拖进来、访达里的图拖进来、粘贴截图，存进这篇的附件文件夹后在落点那一段后面插 ![说明](附件/…)。
 * 按下 ⌘V（松手）的同一帧，落点先出现这张图（剪贴板里的数据直接显示，右下角一个小转圈）；存好后换成真文件，
 * 位置和大小不跳；存失败在图的位置写一行原因（CN-39）。占位只是装饰，不写进文字。
 */
import { type EditorState, type Range, StateEffect, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { asClip, imagesFrom, looksLikeImage, saveImages, webDragLive, webImgClipped } from './image-drop'
import { hiddenOk } from '../hidden-syntax'

/** 落在哪一行就插在那一段后面（落在空行上就插在空行处），前后各空一行；插在最后时以换行结尾 */
export function blockInsert(doc: Text, pos: number, text: string): { from: number; insert: string } {
  const line = doc.lineAt(Math.min(pos, doc.length))
  const isBlank = (n: number) => doc.line(n).text.trim() === ''
  const blank = isBlank(line.number)
  const next = line.number < doc.lines ? line.number + 1 : null
  const before = blank ? (line.number === 1 || isBlank(line.number - 1) ? '' : '\n') : '\n\n'
  const after = next === null ? '\n' : isBlank(next) ? '' : '\n'
  return { from: blank ? line.from : line.to, insert: before + text + after }
}

/**
 * 图（到 end 为止）下面留一个新段落给光标：图、空行、光标这一行（一个空块）；接着打的字由改完规整（tidy-blocks.ts）和下一段隔开
 */
export function roomBelow(text: string, end: number): { at: number; insert: string; cursor: number } {
  const rest = text.slice(end)
  const n = /^\n*/.exec(rest)![0].length
  // 图、一道缝、光标这一行（空块）；后面还有字时空块就挨着它（gap-lines.ts 的数法：一串空行第一行是缝、后面每行一个空块，task-axoxy）
  const need = rest.length === n ? 2 : 3
  return { at: end + Math.min(n, need), insert: '\n'.repeat(Math.max(0, need - n)), cursor: end + 2 }
}

interface Pending {
  id: number
  /** 落点所在行的行尾（跟着别的改动挪） */
  at: number
  urls: string[]
  error?: string
}

const addPending = StateEffect.define<Pending>()
const updatePending = StateEffect.define<{ id: number; error?: string; done?: boolean }>()

class Placeholder extends WidgetType {
  constructor(
    readonly urls: string[],
    readonly error: string | undefined,
  ) {
    super()
  }
  eq(o: Placeholder) {
    return o.urls.join() === this.urls.join() && o.error === this.error
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-image-pending'
    if (this.error) {
      const e = document.createElement('div')
      e.className = 'cm-image broken'
      e.textContent = `图没存成：${this.error}`
      wrap.appendChild(e)
      return wrap
    }
    for (const u of this.urls) {
      const fig = document.createElement('div')
      fig.className = 'cm-image'
      if (u) {
        const img = document.createElement('img')
        img.src = u
        img.alt = ''
        img.draggable = false
        fig.appendChild(img)
      } else fig.classList.add('blank')
      const spin = document.createElement('span')
      spin.className = 'cm-image-spin'
      spin.setAttribute('aria-label', '正在存')
      fig.appendChild(spin)
      wrap.appendChild(fig)
    }
    return wrap
  }
}

const pendingField = StateField.define<Pending[]>({
  create: () => [],
  update(list, tr) {
    if (tr.docChanged) list = list.map((p) => ({ ...p, at: tr.changes.mapPos(p.at, 1) }))
    for (const e of tr.effects) {
      if (e.is(addPending)) list = [...list, e.value]
      if (e.is(updatePending)) list = e.value.done ? list.filter((p) => p.id !== e.value.id) : list.map((p) => (p.id === e.value.id ? { ...p, error: e.value.error } : p))
    }
    return list
  },
  provide: (f) =>
    EditorView.decorations.from(f, (list) => {
      const out: Range<Decoration>[] = list.map((p) => Decoration.widget({ widget: new Placeholder(p.urls, p.error), block: true, side: 1 }).range(p.at))
      return Decoration.set(out, true)
    }),
})

let seq = 0

/**
 * 拖着图经过文档：图会插在哪一段后面，那里画一道插入线（和挪块的落点线同一个样子 .blk-drop）。
 * 落在空行上插在空行处（线画在那一行中间），不然画在这一段和下一段的缝里
 */
function dropLine(view: EditorView, x: number, y: number) {
  const pos = view.posAtCoords({ x, y }) ?? view.state.selection.main.head
  const doc = view.state.doc
  const line = doc.lineAt(Math.min(pos, doc.length))
  const lb = view.lineBlockAt(line.from)
  let at: number
  if (line.text.trim() === '') at = (lb.top + lb.bottom) / 2
  else if (line.number < doc.lines) at = (lb.bottom + view.lineBlockAt(doc.line(line.number + 1).from).top) / 2
  else at = lb.bottom + 4
  let el = view.dom.querySelector<HTMLElement>(':scope > .blk-drop.img-drop')
  if (!el) {
    el = document.createElement('div')
    el.className = 'blk-drop img-drop'
    el.dataset.testid = 'doc-drop-line'
    view.dom.append(el)
  }
  el.hidden = false
  el.style.top = Math.round(at + view.documentTop - view.dom.getBoundingClientRect().top - 1) + 'px'
}
const hideDropLine = (view: EditorView) => {
  const el = view.dom.querySelector<HTMLElement>(':scope > .blk-drop.img-drop')
  if (el) el.hidden = true
}

/** 落点那一段的行尾：占位画在它下面，存好的图也插在这一段后面 */
const anchorOf = (state: EditorState, pos: number) => state.doc.lineAt(Math.min(pos, state.doc.length)).to

export function docImageDrop(notePath: () => string, onNotice: (t: string) => void) {
  const handle = (view: EditorView, dt: DataTransfer, pos: number, paste: boolean) => {
    // 先在同一帧放占位：剪贴板 / 访达里的文件直接显示，网页里的图用它的地址
    const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'))
    const urls = files.length ? files.map((f) => URL.createObjectURL(f)) : ['']
    const id = ++seq
    view.dispatch({ effects: addPending.of({ id, at: anchorOf(view.state, pos), urls }) })
    void imagesFrom(dt)
      .then(async (found) => {
        // 剪贴板里的截图都叫 image.png：说明留空，文件起名「截图 N」（CN-40）
        // 从右栏网页拖来的当剪藏写（说明是图注，来源回到那张图，网页上标「剪过」）
        const cands = paste ? found.map((c) => ({ ...c, alt: '', shot: true })) : found.map(asClip)
        const p = view.state.field(pendingField).find((x) => x.id === id)
        const at = p ? p.at : pos
        if (!cands.length) return view.dispatch({ effects: updatePending.of({ id, done: true }) })
        const { md, errors } = await saveImages(notePath(), cands, '\n\n')
        const now = view.state.field(pendingField).find((x) => x.id === id)?.at ?? at
        if (md.length) {
          // 粘贴时光标还在贴的那一行（存图这一会儿没挪开）：贴完光标落到图下面空一行的新段，接着打的字在图下面
          const sel = view.state.selection.main
          const follow = paste && sel.empty && view.state.doc.lineAt(sel.head).to === now
          const ins = blockInsert(view.state.doc, now, md.join('\n\n'))
          // 软件算好的插法（图前后各空一行）：hidden-syntax 不拦（和拖进来的字不是一回事）
          view.dispatch({ changes: ins, effects: updatePending.of({ id, done: true }), userEvent: 'input.drop', annotations: hiddenOk.of(true), scrollIntoView: true })
          const web = cands.find((c) => c.web)?.web
          if (web && /^https?:/i.test(web.url)) webImgClipped(notePath(), md.join('\n\n'), web.url)
          if (follow) {
            const end = ins.from + ins.insert.trimEnd().length
            const room = roomBelow(view.state.doc.toString(), end)
            view.dispatch({ changes: room.insert ? { from: room.at, insert: room.insert } : undefined, selection: { anchor: room.cursor }, userEvent: 'input.drop', annotations: hiddenOk.of(true), scrollIntoView: true })
          }
        } else view.dispatch({ effects: updatePending.of({ id, error: errors[0] ?? '不知道为什么' }) })
        if (errors.length) {
          onNotice(`有${errors.length}张图没存成：${errors[0]}`)
          if (!md.length) setTimeout(() => view.dispatch({ effects: updatePending.of({ id, done: true }) }), 5000)
        }
      })
      .catch((e: unknown) => view.dispatch({ effects: updatePending.of({ id, error: String((e as Error)?.message ?? e) }) }))
      .finally(() => setTimeout(() => urls.forEach((u) => u && URL.revokeObjectURL(u)), 1000))
  }
  return [
    pendingField,
    EditorView.domEventHandlers({
      dragover(e, view) {
        if (view.state.readOnly || !e.dataTransfer || !Array.from(e.dataTransfer.types).some((t) => t === 'Files' || t === 'text/html' || t === 'text/uri-list')) return false
        e.preventDefault()
        // 插入线只给图（访达里的图文件、右栏网页里拖着的图），拖字进来照 CodeMirror 自己的光标
        const types = Array.from(e.dataTransfer.types)
        if (types.includes('Files') || webDragLive()) dropLine(view, e.clientX, e.clientY)
        return false
      },
      dragleave(e, view) {
        if (!view.dom.contains(e.relatedTarget as Node | null)) hideDropLine(view)
        return false
      },
      drop(e, view) {
        hideDropLine(view)
        if (view.state.readOnly || !e.dataTransfer || !looksLikeImage(e.dataTransfer)) return false
        e.preventDefault()
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
        handle(view, e.dataTransfer, pos, false)
        return true
      },
      paste(e, view) {
        const items = Array.from(e.clipboardData?.items ?? [])
        if (view.state.readOnly || !items.some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return false
        e.preventDefault()
        handle(view, e.clipboardData!, view.state.selection.main.head, true)
        return true
      },
    }),
  ]
}
