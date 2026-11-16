import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap } from '@codemirror/view'
import { reconcile, textChanges } from '@cn/format'
import type { OpenedNote } from '../shared/api'
import { editorMenu } from './ctx/editor-menu'
import { docEditing } from './doc-editing'
import { livePreview } from './live-preview'
import { propsBlock } from './mindmap/props-block'
import { docImageDrop } from './web/doc-image-drop'
import { videoDocWidgets } from './video/doc-widgets'
import { materialFold } from './video/material-fold'

export type SaveState = 'saved' | 'dirty' | 'saving'

/** 刚剪进来的引文外圈闪一下（约 2 秒） */
const flashEffect = StateEffect.define<{ from: number; to: number } | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(flashEffect)) continue
      if (!e.value) return Decoration.none
      const lines: ReturnType<Decoration['range']>[] = []
      for (let pos = e.value.from; pos <= e.value.to; ) {
        const line = tr.state.doc.lineAt(pos)
        lines.push(Decoration.line({ class: 'cm-justclipped' }).range(line.from))
        pos = line.to + 1
      }
      return Decoration.set(lines)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
/** 白板：卡片摆在画布上；文档：实时预览；源文件：md 原文 */
export type ViewMode = 'board' | 'doc' | 'source'

export interface NoteDocEvents {
  onState(s: SaveState): void
  onNotice(text: string): void
  onSaved(): void
  /** ⌘ 点双链 */
  onOpenLink(target: string): void
  /** 文字变了（打字、白板上的操作、外部改动） */
  onText?(text: string): void
}

const AUTOSAVE_MS = 800

/**
 * 一篇打开的笔记：CodeMirror 加上和磁盘对账。
 * - 自动保存；内容和磁盘一样时不写（打开再保存文件不变）。
 * - 外部改动进来时三方合并，正在打的字不丢；改了同一处就把磁盘那版另存成冲突副本。
 */
export class NoteDoc {
  /** 所有打开着的笔记：改名前要先都存一遍，别处的 [[旧名]] 才改得到 */
  static readonly open = new Set<NoteDoc>()

  static saveAll(): Promise<void> {
    return Promise.all([...NoteDoc.open].map((d) => d.save())).then(() => undefined)
  }

  readonly view: EditorView
  /** 改名后会变 */
  path: string
  private mode = new Compartment()
  /** 文档模式：实时预览 + 块编辑（把手、/ 菜单、待办、表格、图片） */
  private docMode: Extension
  readonly readOnly: boolean
  /** 上次和磁盘对上的文字 */
  private base: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving = false
  /** 保存途中收到的外部改动，等这次保存完再处理 */
  private pendingRemote: string | null = null
  private destroyed = false

  constructor(
    parent: HTMLElement,
    note: OpenedNote,
    private events: NoteDocEvents,
  ) {
    this.path = note.path
    this.readOnly = note.readOnly
    this.base = note.text
    NoteDoc.open.add(this)
    this.docMode = [livePreview, propsBlock, videoDocWidgets, materialFold, docEditing({ path: () => this.path, notice: (t) => this.events.onNotice(t) })]
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: note.text,
        extensions: [
          history(),
          drawSelection(),
          markdown({ base: markdownLanguage }),
          this.mode.of(this.docMode),
          flashField,
          docImageDrop(
            () => this.path,
            (t) => this.events.onNotice(t),
          ),
          EditorView.domEventHandlers({
            mousedown: (e) => {
              const link = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink')
              if (!link || !(e.metaKey || e.ctrlKey)) return false
              e.preventDefault()
              this.events.onOpenLink(link.dataset.target ?? link.textContent ?? '')
              return true
            },
          }),
          EditorView.lineWrapping,
          EditorState.readOnly.of(note.readOnly),
          EditorView.editable.of(!note.readOnly),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void this.save()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            this.events.onText?.(u.state.doc.toString())
            const fromDisk = u.transactions.every((t) => t.annotation(Transaction.remote))
            if (!fromDisk) this.scheduleSave()
          }),
        ],
      }),
    })
    this.view.dom.addEventListener('contextmenu', this.onContextMenu)
  }

  /** 右键：文档自己的菜单（ctx/editor-menu.ts）。挂在整个编辑器上：图片、表格这些小部件不把事件交给 CodeMirror */
  private onContextMenu = (e: MouseEvent) => editorMenu(this.view, e, this.path)

  setMode(mode: ViewMode) {
    this.view.dispatch({ effects: this.mode.reconfigure(mode === 'source' ? [] : this.docMode) })
  }

  /** 白板上的操作：整篇换成 text，只改有差别的地方，能用 ⌘Z 撤销 */
  setText(text: string) {
    if (this.readOnly) return
    const changes = textChanges(this.text, text)
    if (changes.length) this.view.dispatch({ changes, userEvent: 'board' })
  }

  undo() {
    undo(this.view)
  }

  redo() {
    redo(this.view)
  }

  /** 在光标处插入（剪进文档）；返回插入的范围 */
  insertAtCursor(text: string): { from: number; to: number } {
    const state = this.view.state
    const at = state.selection.main.head
    const line = state.doc.lineAt(at)
    // 插在光标所在段的后面，前后各空一行
    const before = line.text.trim() === '' ? '' : '\n\n'
    const rest = state.doc.sliceString(line.to, line.to + 2)
    const after = rest === '' || rest === '\n' || rest === '\n\n' ? '' : '\n'
    const pos = line.text.trim() === '' ? line.from : line.to
    const insert = before + text + after
    this.view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
      userEvent: 'input.clip',
      scrollIntoView: true,
    })
    const range = { from: pos + before.length, to: pos + before.length + text.length }
    this.view.dispatch({ effects: flashEffect.of(range) })
    setTimeout(() => !this.destroyed && this.view.dispatch({ effects: flashEffect.of(null) }), 2200)
    return range
  }

  get text(): string {
    return this.view.state.doc.toString()
  }

  private scheduleSave() {
    if (this.readOnly) return
    this.events.onState('dirty')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS)
  }

  async save(): Promise<void> {
    clearTimeout(this.timer)
    if (this.readOnly || this.destroyed) return
    // 正在保存的那一轮写完会再看一次编辑器，新打的字会接着写
    if (this.saving) return
    this.saving = true
    try {
      for (;;) {
        const local = this.text
        if (local === this.base) break
        this.events.onState('saving')
        const r = await window.cn.writeNote(this.path, local, this.base)
        if (r.ok) {
          this.base = local
          this.events.onSaved()
        } else {
          await this.reconcile(r.diskText)
        }
      }
    } finally {
      this.saving = false
    }
    const remote = this.pendingRemote
    this.pendingRemote = null
    if (remote !== null) await this.applyRemote(remote)
    else this.events.onState(this.text === this.base ? 'saved' : 'dirty')
  }

  /** 磁盘上的文件被外部改了 */
  async applyRemote(remote: string): Promise<void> {
    if (this.destroyed) return
    if (this.saving) {
      this.pendingRemote = remote
      return
    }
    const needsSave = await this.reconcile(remote)
    if (needsSave) await this.save()
    else this.events.onState(this.text === this.base ? 'saved' : 'dirty')
  }

  /** 把磁盘上的 remote 和编辑器里的对账；返回之后还要不要写回 */
  private async reconcile(remote: string): Promise<boolean> {
    const local = this.text
    const r = reconcile(this.base, local, remote)
    if (r.kind === 'none') {
      if (remote === local) this.base = remote
      return local !== this.base
    }
    if (r.kind === 'update') {
      this.base = remote
      this.view.dispatch({
        changes: textChanges(local, r.text),
        annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
      })
      if (r.merged) this.events.onNotice('外部改动已经合并进来，你正在写的字都在')
      return this.text !== this.base
    }
    this.base = remote
    const copy = await window.cn.saveConflictCopy(this.path, r.conflictText)
    this.events.onNotice(`外部改了你正在写的同一处：你的版本留在这里，另一版存成「${copy}」`)
    return true
  }

  destroy() {
    NoteDoc.open.delete(this)
    this.destroyed = true
    clearTimeout(this.timer)
    this.view.destroy()
  }
}
