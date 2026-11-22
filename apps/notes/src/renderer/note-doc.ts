import { history, redo, undo } from '@codemirror/commands'
import { isKey } from './keys'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { reconcile, textChanges } from '@cn/format'
import type { OpenedNote } from '../shared/api'
import { titleOf } from '../shared/layout'
import { sayMerged, saySameSpot } from './conflict-say'
import { addLink, editorMenu, linkAt, openLinkHit } from './ctx/editor-menu'
import { docEditing } from './doc-editing'
import { noteKeys } from './note-keys'
import { folderChip, setNotePath } from './folder-chip'
import { flashRange, insertBlockAt, insertFlash } from './insert-flash'
import { aiSpot, aiWroteNote, spotRange } from './ai-spot'
import { takeWrote } from './ai-act-store'
import { insertPoint } from './insert-point'
import { livePreview } from './live-preview'
import { layoutLines } from './layout-lines'
import { propsBlock } from './mindmap/props-block'
import { docImageDrop } from './web/doc-image-drop'
import { videoDocWidgets } from './video/doc-widgets'
import { askPending } from './video/ask-pending'
import { materialFold } from './video/material-fold'
import { docSides } from './side/doc-side'
import { summaryRetry } from './video/summary-retry'
import { provisional, provisionalRange } from './tail-line'
import { appSettings } from './settings-store'

/**
 * failed：哪都写不进去（原文件、它旁边、库最外层都不让写，像盘满了），字只在内存里（另备了一份在软件设置目录），下次改动再试。
 * 只是原文件写不进去、另存成了一篇的不算 failed：编辑器从此指向另存的那篇，照常 saved / dirty
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed'

/** 白板：卡片摆在画布上；文档：所见即所得（只有这两种看法，没有「源文件」：2026-11-17 用户定，方向 A「块上露写法」） */
export type ViewMode = 'board' | 'doc'

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

/** 字只在内存里的那几篇变了就叫这些（底栏「N篇写不进去，字只在内存里」） */
const failingListeners = new Set<() => void>()
/** 原文件写不进去、字另存成了一篇、编辑器换到了那篇：叫这些（App 把标签跟过去，出带「打开另存的」的提示条） */
const rescueListeners = new Set<(doc: NoteDoc, from: string, why: string) => void>()
/** 第一次哪都写不进去、字只在内存里：叫这些（App 出提示条） */
const strandedListeners = new Set<(doc: NoteDoc, why: string) => void>()

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
  /** 拼写检查（设置 › 文档和白板）：开着的编辑器都跟着换 */
  private static spellOn = false
  private readonly spell = new Compartment()
  static setSpell(on: boolean) {
    if (on === NoteDoc.spellOn) return
    NoteDoc.spellOn = on
    for (const d of NoteDoc.open) d.view.dispatch({ effects: d.spell.reconfigure(spellAttr(on)) })
  }
  /** 字体、字号、行距、版心换了（设置 › 文档和白板）：开着的编辑器重新量一遍行高 */
  static restyle() {
    for (const d of NoteDoc.open) d.view.requestMeasure()
  }

  /** 哪都写不进去、字只在内存里的那几篇（底栏不说「都提交了」，退出前要用户确认，不记「存完」） */
  static readonly failing = new Set<NoteDoc>()
  static onFailing(cb: () => void): () => void {
    failingListeners.add(cb)
    return () => failingListeners.delete(cb)
  }
  static onRescued(cb: (doc: NoteDoc, from: string, why: string) => void): () => void {
    rescueListeners.add(cb)
    return () => rescueListeners.delete(cb)
  }
  static onStranded(cb: (doc: NoteDoc, why: string) => void): () => void {
    strandedListeners.add(cb)
    return () => strandedListeners.delete(cb)
  }

  /** 软件自己（或外面）把 from 挪到了 to（一篇，或一个文件夹连里面的）：开着的编辑器马上换路径，紧接着到的新内容、要存的字都按新路径走 */
  static follow(from: string, to: string) {
    for (const d of NoteDoc.open) {
      if (d.path === from) d.path = to
      else if (d.path.startsWith(from + '/')) d.path = to + d.path.slice(from.length)
    }
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
  readonly readOnly: boolean
  /** 上次和磁盘对上的文字 */
  private base: string
  private timer: ReturnType<typeof setTimeout> | undefined
  /** 正在写的这一轮（写完会再看一次编辑器，途中新打的字接着写）；没在写是 null */
  private writing: Promise<void> | null = null
  /** 保存途中收到的外部改动，等这次保存完再处理 */
  private pendingRemote: string | null = null
  private destroyed = false
  /**
   * 原文件写不进去、字另存到了现在这篇：原来那篇的路径（标签上标明「原文件写不进去，字在这里」）。
   * 一篇笔记的字任何时刻只有一个落盘目标：另存以后保存、退出时的保存都只写现在这篇（照常先比后写），不再碰原文件
   */
  private rescuedFromPath: string | null = null
  get rescuedFrom(): string | null {
    return this.rescuedFromPath
  }
  /** 哪都写不进去时，字在软件设置目录里的备份（绝对路径；备份也没写进去是 null） */
  private stashPath: string | null = null
  get stash(): string | null {
    return this.stashPath
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
    /** 文档模式：所见即所得 + 块编辑（把手、/ 菜单、待办、表格、图片） */
    const docMode: Extension = [livePreview, layoutLines, propsBlock, folderChip(note.path), videoDocWidgets, askPending, materialFold, summaryRetry(() => this.path, (t) => this.events.onNotice(t)), docSides, docEditing({ path: () => this.path, notice: (t) => this.events.onNotice(t) }), aiSpot(() => this.path)]
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
          docMode,
          insertFlash,
          docImageDrop(
            () => this.path,
            (t) => this.events.onNotice(t),
          ),
          EditorView.domEventHandlers({
            mousedown: (e, view) => {
              if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false
              const wiki = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink')
              if (wiki) {
                e.preventDefault()
                this.events.onOpenLink(wiki.dataset.target ?? wiki.textContent ?? '')
                return true
              }
              // ⌘ 点链接：右栏网页开（同一个网址开着就切过去）；⌘⌥ 点：中间栏开（同右键「在中间栏打开」）
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos === null) return false
              const line = view.state.doc.lineAt(pos)
              const hit = linkAt(line.text, pos - line.from)
              if (hit?.kind !== 'url') return false
              e.preventDefault()
              openLinkHit(this.path, hit.url, hit.text, e.altKey, view.state.doc.toString(), pos)
              return true
            },
          }),
          EditorView.lineWrapping,
          this.spell.of(spellAttr(appSettings().editor.spell)),
          EditorState.readOnly.of(note.readOnly),
          EditorView.editable.of(!note.readOnly),
          keymap.of([
            // 马上存盘（键照命令表，默认 ⌘S）
            { any: (_v, e) => isKey(e, 'save-now') && (void this.save(), true) },
            // 选了字按「加链接」的键（默认 ⌘K，右键菜单上写着）：加链接；没选字时照旧是搜索。
            // 放在这一层、软件的快捷键（noteKeys 里第一条）前面：先轮到它
            { any: (v, e) => isKey(e, 'add-link') && !v.state.selection.main.empty && !v.state.readOnly && (void addLink(v), true) },
            ...noteKeys,
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
            // 外面改的不再写回；文末那一行点进去还没打字时暂时加的换行（tail-line.ts）不存盘
            const fromDisk = u.transactions.every((t) => t.annotation(Transaction.remote) || t.annotation(provisional))
            if (!fromDisk) this.scheduleSave()
          }),
        ],
      }),
    })
    this.view.dom.addEventListener('contextmenu', this.onContextMenu)
    // 编辑器外框上挂一个只读的 cnText：端到端测试直接读 md 原文（软件里没有「源文件」看法可切了）
    Object.defineProperty(this.view.dom, 'cnText', { get: () => this.text })
    // 按住 ⌘：指着的链接变 --acc-t 加下划线、鼠标变手（点了在右栏开）
    window.addEventListener('keydown', this.onMeta)
    window.addEventListener('keyup', this.onMeta)
    window.addEventListener('blur', this.offMeta)
  }

  private onMeta = (e: KeyboardEvent) => this.view.dom.classList.toggle('cn-meta', e.metaKey || e.ctrlKey)
  private offMeta = () => this.view.dom.classList.remove('cn-meta')

  /** 右键：文档自己的菜单（ctx/editor-menu.ts）。挂在整个编辑器上：图片、表格这些小部件不把事件交给 CodeMirror */
  private onContextMenu = (e: MouseEvent) => editorMenu(this.view, e, this.path)

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
  /** ai：AI 这一轮只写这一段（turn）：这一段左边竖线里光往下走、下面「停下」那一颗（ai-spot.ts），不闪「刚插进来」 */
  insertAtCursor(text: string, opts: { focus?: boolean; ai?: number } = {}): { from: number; to: number } {
    const state = this.view.state
    const r = insertBlockAt(state.doc.toString(), state.selection.main.head, text, opts.focus !== false)
    this.view.dispatch({
      changes: { from: r.from, to: r.to, insert: r.insert },
      selection: { anchor: r.cursor },
      userEvent: 'input.clip',
      scrollIntoView: true,
    })
    if (opts.ai !== undefined) spotRange(this.view, r.range, opts.ai)
    else flashRange(this.view, r.range)
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

  /** 要存盘的字：文末那一行点进去还没打正文时暂时加的换行不算（tail-line.ts），打开再保存文件不变 */
  private get diskText(): string {
    const t = this.text
    const r = provisionalRange(this.view.state)
    return r ? t.slice(0, r.from) + t.slice(r.to) : t
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
    return NoteDoc.failing.has(this) ? 'failed' : this.diskText === this.base ? 'saved' : 'dirty'
  }

  private setFailing(on: boolean) {
    if (on === NoteDoc.failing.has(this)) return
    if (on) NoteDoc.failing.add(this)
    else NoteDoc.failing.delete(this)
    for (const cb of failingListeners) cb()
  }

  /**
   * 写不进去：字不能只留在编辑器里（退出就没了）。
   * 原文件写不进去：另存成新的一篇，编辑器从此指向那篇（标签跟过去），以后只写那篇。
   * 另存也写不进去（盘满了、哪都没有写权限），或者另存的那篇也写不进去了：字备份进软件设置目录，状态写「写不进去，字只在内存里」；
   * 下次改动再试现在这篇（腾出空间后就存上）
   */
  private async writeFailed(e: unknown) {
    let why = writeErrorText(e)
    if (!this.rescuedFromPath) {
      const from = this.path
      const text = this.diskText
      try {
        const to = await window.cn.rescueNote(from, text)
        this.rescuedFromPath = from
        this.base = text
        this.path = to
        this.setFailing(false)
        this.events.onSaved()
        for (const cb of rescueListeners) cb(this, from, why)
        // 另存途中又打的字：照常存进另存的那篇
        if (this.diskText !== this.base) this.scheduleSave()
        return
      } catch (e2) {
        why = /ENOSPC/.test(String(e2)) ? '磁盘满了' : '原文件和它旁边都写不进去（磁盘满了，或者没有写权限）'
      }
    }
    const first = !NoteDoc.failing.has(this)
    // 备份也写不进去（设置目录也在满了的盘上）：照实说，不假装有备份
    this.stashPath = await window.cn.stashNote(this.path, this.text, this.stashPath ?? undefined).catch(() => null)
    this.setFailing(true)
    if (first) for (const cb of strandedListeners) cb(this, why)
  }

  /** 编辑器里的字和磁盘对上为止：一轮写完再看一次，途中新打的接着写 */
  private async writeOut(): Promise<void> {
    for (;;) {
      const local = this.diskText
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
    // AI 刚写的（主进程先说过）：合进来时新的字一点点长出来（ai-spot.ts）；编辑器藏着（白板看法、后面的标签）就不用
    const ai = takeWrote(this.path)
    const marks = [Transaction.remote.of(true), Transaction.addToHistory.of(false), ...(ai !== null && this.view.dom.offsetParent ? [aiWroteNote.of(ai)] : [])]
    if (r.kind === 'update') {
      this.base = remote
      this.view.dispatch({
        changes: textChanges(local, r.text),
        annotations: marks,
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
        annotations: marks,
      })
    const copy = await window.cn.saveConflictCopy(this.path, r.conflictText)
    this.events.onNotice(saySameSpot(this.path, others, { path: copy }))
    return true
  }

  destroy() {
    window.removeEventListener('keydown', this.onMeta)
    window.removeEventListener('keyup', this.onMeta)
    window.removeEventListener('blur', this.offMeta)
    NoteDoc.open.delete(this)
    this.setFailing(false)
    this.destroyed = true
    clearTimeout(this.timer)
    this.view.destroy()
  }
}

/** 编辑器的 spellcheck：Chromium 用系统的拼写检查，英文拼错的词下面画红线，中文不查 */
const spellAttr = (on: boolean) => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' })
