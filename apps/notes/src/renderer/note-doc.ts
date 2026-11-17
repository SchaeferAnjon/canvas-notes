import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { reconcile, textChanges } from '@cn/format'
import type { OpenedNote } from '../shared/api'
import { titleOf } from '../shared/layout'
import { sayMerged, saySameSpot } from './conflict-say'
import { editorMenu } from './ctx/editor-menu'
import { docEditing } from './doc-editing'
import { enterAfterTitle } from './title-follow'
import { folderChip, setNotePath } from './folder-chip'
import { flashRange, insertBlockAt, insertFlash } from './insert-flash'
import { insertPoint } from './insert-point'
import { livePreview } from './live-preview'
import { layoutLines } from './layout-lines'
import { propsBlock } from './mindmap/props-block'
import { docImageDrop } from './web/doc-image-drop'
import { videoDocWidgets } from './video/doc-widgets'
import { askPending } from './video/ask-pending'
import { materialFold } from './video/material-fold'

/** failed：写不进去（文件被锁成只读、盘满了），字另存了一篇，下次改动再试 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed'

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
  /** 光标离开了第 line 行（换到别的行、编辑器失去焦点）；输入法还在拼字时不报 */
  onLeaveLine?(line: number): void
  /** 光标挪了（下次打开放回这里，open-cursor.ts） */
  onCursor?(pos: number): void
}

const AUTOSAVE_MS = 800

/** 写失败的原话换成一句人话 */
function writeErrorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (/EACCES|EPERM|EROFS/.test(m)) return '文件不让写（可能锁成了只读）'
  if (/ENOSPC/.test(m)) return '磁盘满了'
  return m
}

/** 失败的那几篇变了就叫这些（底栏「N篇没存上」） */
const failingListeners = new Set<() => void>()
/** 第一次写不进去、字另存了：叫这些（App 出带「打开另存的」的提示条） */
const rescueListeners = new Set<(doc: NoteDoc, why: string) => void>()

/** NoteDoc.expectOwnChange 记下的：路径 → 到几点为止算软件自己改的 */
const ownChange = new Map<string, number>()

/**
 * 一篇打开的笔记：CodeMirror 加上和磁盘对账。
 * - 自动保存；内容和磁盘一样时不写（打开再保存文件不变）。
 * - 外部改动进来时三方合并，正在打的字不丢；改了同一处就把磁盘那版另存成冲突副本。
 */
export class NoteDoc {
  /** 所有打开着的笔记：改名前要先都存一遍，别处的 [[旧名]] 才改得到 */
  static readonly open = new Set<NoteDoc>()

  /** 写不进去、字另存了的那几篇（底栏不说「都提交了」，退出时不记「存完」） */
  static readonly failing = new Set<NoteDoc>()
  static onFailing(cb: () => void): () => void {
    failingListeners.add(cb)
    return () => failingListeners.delete(cb)
  }
  static onRescued(cb: (doc: NoteDoc, why: string) => void): () => void {
    rescueListeners.add(cb)
    return () => rescueListeners.delete(cb)
  }

  /** 软件自己（或外面）把 from 挪到了 to：开着的编辑器马上换路径，紧接着到的新内容、要存的字都按新路径走 */
  static follow(from: string, to: string) {
    for (const d of NoteDoc.open) if (d.path === from) d.path = to
  }

  static saveAll(): Promise<void> {
    // 白板「改字」弹层里还没点存好的字先放进编辑器（关窗口、退出、改名前都走这里）
    for (const d of NoteDoc.open) d.flushDraft()
    return Promise.all([...NoteDoc.open].map((d) => d.save())).then(() => undefined)
  }

  /** 白板「改字」弹层开着时登记：把弹层里的字写回这一篇（和 Esc 一样）；关上时登记 null */
  draft: (() => void) | null = null

  /** 弹层里没存的字先写进编辑器 */
  flushDraft() {
    const f = this.draft
    this.draft = null
    f?.()
  }

  /**
   * 软件自己马上要改这几篇（梦游报告里收下挪老图、改链接）：这几秒里它们被改不再说「外部改动已经合并进来」，
   * 提示条由做这件事的地方说（「梦游挪了图，链接已更新 · 撤回」），不把那条带撤回的提示顶掉
   */
  static expectOwnChange(paths: string[], ms = 8000) {
    const until = Date.now() + ms
    for (const p of paths) ownChange.set(p, until)
  }

  /**
   * 这一次挪动（from → to）是不是软件自己做的（梦游收下、撤回）：是的话不说「在外面」改了名。
   * 认过一次就消掉，紧接着真在外面再挪一次照样说
   */
  static takeOwnMove(from: string, to: string): boolean {
    const own = [from, to].some((p) => (ownChange.get(p) ?? 0) > Date.now())
    if (own) for (const p of [from, to]) ownChange.delete(p)
    return own
  }

  readonly view: EditorView
  private notePath: string
  /** 改名、挪走后会变；编辑器里标题下的「所在文件夹」跟着换 */
  get path(): string {
    return this.notePath
  }
  set path(p: string) {
    if (p === this.notePath) return
    this.notePath = p
    if (!this.destroyed) this.view.dispatch({ effects: setNotePath.of(p) })
  }
  private mode = new Compartment()
  /** 文档模式：实时预览 + 块编辑（把手、/ 菜单、待办、表格、图片） */
  private docMode: Extension
  readonly readOnly: boolean
  /** 上次和磁盘对上的文字 */
  private base: string
  private timer: ReturnType<typeof setTimeout> | undefined
  /** 正在写的这一轮（写完会再看一次编辑器，途中新打的字接着写）；没在写是 null */
  private writing: Promise<void> | null = null
  /** 保存途中收到的外部改动，等这次保存完再处理 */
  private pendingRemote: string | null = null
  private destroyed = false
  /** 写不进去时另存的那篇（再失败覆盖它） */
  private rescuedTo: string | null = null
  get rescued(): string | null {
    return this.rescuedTo
  }

  constructor(
    parent: HTMLElement,
    note: OpenedNote,
    private events: NoteDocEvents,
  ) {
    this.notePath = note.path
    this.readOnly = note.readOnly
    this.base = note.text
    NoteDoc.open.add(this)
    this.docMode = [livePreview, layoutLines, propsBlock, folderChip(note.path), videoDocWidgets, askPending, materialFold, docEditing({ path: () => this.path, notice: (t) => this.events.onNotice(t) })]
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: note.text,
        extensions: [
          // Chromium 的撤销栈是整个窗口共用的：别处（白板、PDF、另一个标签）按 ⌘Z 或点菜单「撤销」，
          // 浏览器会把这一步还给当初打字的那个编辑器（藏着的标签也算），它收到 historyUndo 就撤了。
          // 编辑器没有焦点时不认这种撤销：每个标签只撤自己看得见、正在用的那份
          Prec.highest(
            EditorView.domEventHandlers({
              beforeinput: (e, view) => {
                if ((e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') || view.hasFocus) return false
                e.preventDefault()
                return true
              },
            }),
          ),
          history(),
          insertPoint,
          markdown({ base: markdownLanguage }),
          this.mode.of(this.docMode),
          insertFlash,
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
            {
              // 新建的笔记：标题末尾回车，光标到标题下空一行的正文处（title-follow.ts）
              key: 'Enter',
              run: (v) => {
                const sel = v.state.selection.main
                const to = sel.empty ? enterAfterTitle(v.state.doc.toString(), sel.head) : null
                if (to === null) return false
                v.dispatch({ selection: { anchor: to }, scrollIntoView: true, userEvent: 'select' })
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if ((u.selectionSet || u.focusChanged) && !u.view.composing) {
              const was = u.startState.doc.lineAt(u.startState.selection.main.head).number
              const now = u.state.doc.lineAt(u.state.selection.main.head).number
              if (now !== was || (u.focusChanged && !u.view.hasFocus)) this.events.onLeaveLine?.(was)
            }
            if (u.selectionSet && u.view.hasFocus) this.events.onCursor?.(u.state.selection.main.head)
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

  /**
   * 在光标所在段后面插一块（剪进文档、AI 回答、记下这一刻、微信读书划线、PDF 笔记）；返回插入的范围。
   * 插完光标落在下面新的一个空段落；focus：把焦点交回文档（用户点了按钮的那几处）。
   * 后台插入的传 focus: false：不抢焦点，也不补空段落（光标停在插入的末尾，连着插几条时一条接一条）。
   */
  insertAtCursor(text: string, opts: { focus?: boolean } = {}): { from: number; to: number } {
    const state = this.view.state
    const r = insertBlockAt(state.doc.toString(), state.selection.main.head, text, opts.focus !== false)
    this.view.dispatch({
      changes: { from: r.from, to: r.to, insert: r.insert },
      selection: { anchor: r.cursor },
      userEvent: 'input.clip',
      scrollIntoView: true,
    })
    flashRange(this.view, r.range)
    if (opts.focus !== false) {
      // 右栏网页（<webview>）拿着焦点时先让它放手
      const active = document.activeElement as HTMLElement | null
      if (active && active !== this.view.contentDOM && active.tagName === 'WEBVIEW') active.blur()
      this.view.focus()
    }
    return r.range
  }

  get text(): string {
    return this.view.state.doc.toString()
  }

  private scheduleSave() {
    if (this.readOnly) return
    this.events.onState(NoteDoc.failing.has(this) ? 'failed' : 'dirty')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS)
  }

  /**
   * 存到磁盘。正在写的时候再叫：等那一轮写完才回（它写完会再看一次编辑器，这中间打的字也写进去）。
   * 以前正在写就马上回，「先存再改名」「先存再提交退出」以为存好了，其实那次写还在路上：
   * 机器慢、盘慢时改名插在读和写之间，新名字的文件是旧内容，旧名字又被写了回来（⌘W 关新建的笔记）；退出时最后几个字没写进去
   */
  async save(): Promise<void> {
    clearTimeout(this.timer)
    if (this.writing) return this.writing
    if (this.readOnly || this.destroyed) return
    this.writing = this.writeOut().then(
      () => this.setFailing(false),
      (e) => this.writeFailed(e),
    )
    try {
      await this.writing
    } finally {
      this.writing = null
    }
    const remote = this.pendingRemote
    this.pendingRemote = null
    if (remote !== null) await this.applyRemote(remote)
    else this.events.onState(this.stateNow())
  }

  private stateNow(): SaveState {
    return NoteDoc.failing.has(this) ? 'failed' : this.text === this.base ? 'saved' : 'dirty'
  }

  private setFailing(on: boolean) {
    if (on === NoteDoc.failing.has(this)) return
    if (on) NoteDoc.failing.add(this)
    else NoteDoc.failing.delete(this)
    for (const cb of failingListeners) cb()
  }

  /**
   * 写不进去：字不能只留在编辑器里（退出就没了）。另存一篇、说清楚，状态写「没存上」；下次改动再试原来的文件。
   * 另存也失败才往外抛（调的人照实记，退出时不当「存完」）
   */
  private async writeFailed(e: unknown) {
    const first = !NoteDoc.failing.has(this)
    this.rescuedTo = await window.cn.rescueNote(this.path, this.text, this.rescuedTo ?? undefined)
    this.setFailing(true)
    this.events.onState('failed')
    if (first) for (const cb of rescueListeners) cb(this, writeErrorText(e))
  }

  /** 编辑器里的字和磁盘对上为止：一轮写完再看一次，途中新打的接着写 */
  private async writeOut(): Promise<void> {
    for (;;) {
      const local = this.text
      if (local === this.base) return
      this.events.onState('saving')
      const r = await window.cn.writeNote(this.path, local, this.base)
      if (r.ok) {
        this.base = local
        this.events.onSaved()
        if (r.recreated) this.events.onNotice(`「${titleOf(r.recreated)}」原来的文件不在了，打的字存回了「${r.recreated.replace(/\.md$/i, '')}」`)
      } else {
        await this.reconcile(r.diskText)
      }
    }
  }

  /** 磁盘上的文件被外部改了 */
  async applyRemote(remote: string): Promise<void> {
    if (this.destroyed) return
    if (this.writing) {
      this.pendingRemote = remote
      return
    }
    const needsSave = await this.reconcile(remote)
    if (needsSave) await this.save()
    else this.events.onState(this.stateNow())
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
      if (r.merged && !((ownChange.get(this.path) ?? 0) > Date.now())) this.events.onNotice(sayMerged(this.path))
      return this.text !== this.base
    }
    this.base = remote
    // 同一处留编辑器里的字；外面在别处改的照样合进来（以前整篇留编辑器的，别处的外部改动只在冲突副本里）
    const others = r.text !== local
    if (others)
      this.view.dispatch({
        changes: textChanges(local, r.text),
        annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
      })
    const copy = await window.cn.saveConflictCopy(this.path, r.conflictText)
    this.events.onNotice(saySameSpot(this.path, others, { path: copy }))
    return true
  }

  destroy() {
    NoteDoc.open.delete(this)
    this.setFailing(false)
    this.destroyed = true
    clearTimeout(this.timer)
    this.view.destroy()
  }
}
