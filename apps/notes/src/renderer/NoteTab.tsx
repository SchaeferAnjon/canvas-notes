import { Codicon } from '@cn/design'
import { accelFor, useKeyHandler, useKeys } from './keys'
import { fmValue, hasOldLayout, isMindmap, needsConvert, needsSummaryConvert } from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile, OpenedNote } from '../shared/api'
import { nameNotice, safeName } from '../shared/file-name'
import { titleOf } from '../shared/layout'
import { underCat } from '../shared/categories'
import { BoardView, type BoardZoomApi } from './BoardView'
import { loadZoom, saveZoom } from './board-zoom'
import { type MenuEntry, showMenu } from './ctx/menu'
import { DocBoardView } from './doc-board/DocBoardView'
import { PanelGuard } from './crash/Guard'
import { BoardCorner } from './doc-board/corner'
import { inboxOf } from './doc-board/inbox'
import { app } from './ctx/actions'
import { AiActLayer } from './ai-act'
import { DocToc, isWide, setWide } from './doc-toc'
import { followsTitle, headingOf, titleRename } from './title-follow'
import { moveCursor, openCursor, saveCursor, savedCursor } from './open-cursor'
import { PropsButton } from './mindmap/PropsButton'
import { MapLayoutButton, useMapCommands } from './mindmap/LayoutMenu'
import { requestExport } from './mindmap/export-store'
import { requestFind } from './find/find-hub'
import { DocFind } from './find/DocFind'
import { tv } from '../shared/i18n'
import { NoteDoc, type SaveState, type ViewMode } from './note-doc'
import { setNoteMeta, setReadAlong } from './folder-chip'
import { useReadAlongView } from './read-along/note-view'
import { setBoards } from './board-link'
import { Backlinks, setNoteIndex } from './doc-embeds'
import { createPortal } from 'react-dom'
import { ActBtn, noteLeavers, noteRenamers, PageNote, TabActs } from './shell/TabActs'
import { takeStray, takeTyping } from './new-note-hold'
import { appSettings, publishSettings, usePrefs } from './settings-store'
import { isTodoNote } from '../shared/todo'
import type { NoteView } from '../shared/prefs'
import { TaskView } from './todo/TaskView'
import { openSettingsAt } from './settings/jump'
import { useT } from './i18n'
import { t as tNow } from '../shared/i18n'

export interface NoteTabProps {
  /** 标签 id：标签上改名时按它找到这一篇的改名 */
  tabId: string
  path: string
  active: boolean
  /** 刚新建：文档把光标放进标题、选中「未命名」；白板在标签上改名（onWantRename） */
  fresh: boolean
  /** 刚新建的白板：标签上进改名框 */
  onWantRename(): void
  /** 标签上正在改名：编辑器先不抢焦点 */
  renaming: boolean
  /** 标签条右端「更多」：改名、置顶、移到废纸篓（系统菜单）；extra：这一页自己加的几项（宽版） */
  onMenu(e: React.MouseEvent, extra: MenuEntry[]): void
  /** ⌥⌘O：右栏打开大纲（目录浮层头一行） */
  onOpenOutline(): void
  notes: NoteFile[]
  /** 右栏开着：白板缩到 0.8 */
  rightOpen: boolean
  /** 当前标签的编辑器，给剪藏和 AI 用 */
  onDoc(doc: NoteDoc | null): void
  /** 当前标签换了看法（剪藏工具条跟着变） */
  onMode(mode: ViewMode): void
  onOpenPath(path: string, fresh?: boolean): void
  onRenamed(newPath: string): void
  onSaved(): void
  onNotice(text: string): void
  onOpenLink(target: string): void
}

/** 三种看法：任务（task-pd1d1，名字叫「待办」的默认）、白板、文档 */
type Mode = NoteView

/**
 * 打开时用哪种看法：这一篇记住过的（软件设置 files.noteViews，不往文件里加属性）→ 名字叫「待办」的用任务 → 白板用白板 → 文档。
 * chosen：是记住的或「待办」那篇（读完文件后不再按属性 type: board 改）
 */
function firstMode(path: string, notes: NoteFile[]): { mode: Mode; chosen: boolean } {
  const v = appSettings().files.noteViews[path]
  if (v) return { mode: v, chosen: true }
  if (isTodoNote(path)) return { mode: 'task', chosen: true }
  return { mode: notes.find((n) => n.path === path)?.board ? 'board' : 'doc', chosen: false }
}

/** 记住这一篇用哪种看法：只记和默认不一样的（「待办」那篇默认任务；别的笔记只记「任务」，白板、文档照以前按属性） */
function rememberView(path: string, m: Mode) {
  const cur = appSettings().files.noteViews
  const views = { ...cur }
  if (isTodoNote(path) ? m === 'task' : m !== 'task') delete views[path]
  else views[path] = m
  if (views[path] === cur[path]) return
  void window.cn.setSettings({ files: { noteViews: views } }).then(publishSettings)
}

/** 改名、挪走：记住的看法跟到新路径 */
function moveView(from: string, to: string) {
  const cur = appSettings().files.noteViews
  if (!cur[from]) return
  const views = { ...cur, [to]: cur[from]! }
  delete views[from]
  void window.cn.setSettings({ files: { noteViews: views } }).then(publishSettings)
}

/** 文件名是软件起的「未命名」「未命名 N」 */
const untitledTitle = (t: string) => /^未命名( \d+)?$/.test(t)
const untitled = (path: string) => untitledTitle(titleOf(path))

/** 新建的笔记先读好再开标签：标签一出来编辑器就在、光标就在标题里（机器慢时不再有「标签出来了、编辑器还没好」那一会儿，那时打的头几个字会丢） */
const preread = new Map<string, OpenedNote>()
export const primeNote = (note: OpenedNote) => void preread.set(note.path, note)

/** 编辑器拿焦点；新建笔记的期间换到这一篇、编辑器还没好时打的字（new-note-hold.ts 接着的）放在光标处 */
function focusTaking(d: NoteDoc) {
  d.view.focus()
  const stray = takeStray()
  if (stray && !d.readOnly) d.view.dispatch(d.view.state.replaceSelection(stray), { userEvent: 'input.type', scrollIntoView: true })
}

export function NoteTab(props: NoteTabProps) {
  const { path, active, fresh } = props
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const doc = useRef<NoteDoc | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const [readOnly, setReadOnly] = useState(false)
  // 白板一打开就是白板样式：左栏的列表已经知道它是白板，不等读完文件（不然先闪一下文档，读完又跳回白板，
  // 这中间点的「文档」也会被盖掉）
  const first = useRef<{ mode: Mode; chosen: boolean } | null>(null)
  first.current ??= firstMode(path, props.notes)
  const [mode, setMode] = useState<Mode>(first.current.mode)
  const modeRef = useRef(mode)
  modeRef.current = mode
  /** 写在提示上的键照命令表（改了跟着变） */
  const K = useKeys()
  // 白板 / 文档切换的键（默认 ⌘E）：这一篇在前面时它接
  useKeyHandler('toggle-view', props.active ? () => (pick(modeRef.current === 'doc' ? 'board' : 'doc'), true) : null)
  /** 用户自己点过看法（或者这一篇记住了看法、是「待办」）：读完文件后不再按 frontmatter 改 */
  const picked = useRef(first.current.chosen)
  /** 换看法（标签条右边 任务 / 白板 / 文档、⌘E）：记住这一篇；离开文档时编辑器交出焦点（藏着的编辑器不能接打字） */
  function pick(m: Mode) {
    picked.current = true
    if (m !== 'doc' && doc.current?.view.hasFocus) doc.current.view.contentDOM.blur()
    setMode(m)
    rememberView(pathNow.current, m)
  }
  const [text, setText] = useState<string | null>(null)
  /** 宽版：版心跟中间栏走、最宽 1100（CN-26），记在这一篇上 */
  const [wide, setWideState] = useState(() => isWide(path))
  const bodyRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const renaming = props.renaming
  /** 白板缩放：每块白板自己的比例记在本机（不写进文件） */
  const [zoom, setZoomState] = useState(() => loadZoom(path))
  const setZoom = (z: number) => (setZoomState(z), saveZoom(pathNow.current, z))
  const zoomApi = useRef<BoardZoomApi | null>(null)
  // 右栏开着时白板缩到 0.8（设置 › 文档和白板「右栏开着时白板缩小」能关）
  const shrink = usePrefs((s) => s.editor.boardShrink)
  const boardScale = zoom * (props.rightOpen && shrink ? 0.8 : 1)
  const cb = useRef(props)
  cb.current = props

  // 只在这个标签打开时建一次编辑器；改名不重建
  const firstPath = useRef(path)
  const wasFresh = useRef(fresh)
  /** 第一行标题就是文件名（title-follow.ts）：打开时标题和文件名一样才跟；用户自己改了名就不跟 */
  const follow = useRef(false)
  /** 上次和文件名对上的标题 */
  const lastTitle = useRef('')
  /** 自己跟着标题改的名：路径变成它不算「用户改了名」 */
  const ownRename = useRef<string | null>(null)
  const pathNow = useRef(path)
  /** 跟着标题改名一次接一次：正在改的时候又叫（光标离开标题、紧接着 ⌘W），等这次改完再看要不要再改，关标签拿到的是改好的路径 */
  const titleTurn = useRef<Promise<void>>(Promise.resolve())
  useLayoutEffect(() => {
    let cancelled = false
    let d: NoteDoc | null = null
    let off = () => {}
    /** 光标位置停手 0.5 秒再记（下次打开放回这里） */
    let cursorTimer: ReturnType<typeof setTimeout> | undefined
    const keepCursor = () => {
      clearTimeout(cursorTimer)
      if (d && !d.readOnly) saveCursor(d.path, d.view.state.selection.main.head)
    }
    const init = (note: OpenedNote) => {
      if (cancelled) return
      setReadOnly(note.readOnly)
      d = new NoteDoc(host.current!, note, {
        onState: setState,
        onNotice: (t) => cb.current.onNotice(t),
        onSaved: () => cb.current.onSaved(),
        onOpenLink: (t) => cb.current.onOpenLink(t),
        onText: setText,
        onLeaveLine: (line) => {
          if (line === headingOf(d!.text)?.line) void followTitle()
        },
        onCursor: () => {
          clearTimeout(cursorTimer)
          cursorTimer = setTimeout(keepCursor, 500)
        },
      })
      doc.current = d
      // 标题下一行：新建的写「刚建」，旧的写改于什么时候（文件的修改时间）
      const f = cb.current.notes.find((n) => n.path === note.path)
      d.view.dispatch({ effects: setNoteMeta.of({ fresh: wasFresh.current, ...(f ? { mtime: f.mtimeMs } : {}) }) })
      setText(note.text)
      // 文件名还是软件起的「未命名」「未命名 N」也跟（CN-12：以前建的笔记标题改了、文件名停在「未命名」）
      follow.current = !note.readOnly && (followsTitle(note.text, firstPath.current) || untitled(firstPath.current))
      lastTitle.current = headingOf(note.text)?.title ?? ''
      // 打开时标题已经不是「未命名…」：当场按标题改一次名（重名加「 2」），底栏说一句
      if (follow.current && !wasFresh.current && untitled(firstPath.current) && lastTitle.current && !untitledTitle(lastTitle.current)) {
        const from = titleOf(firstPath.current)
        lastTitle.current = ''
        void followTitle().then(() => {
          if (pathNow.current !== firstPath.current) cb.current.onNotice(tNow('《{from}》按第一行标题改名为《{to}》', { from, to: titleOf(pathNow.current) }))
        })
      }
      const board = fmValue(note.text, 'type') === 'board'
      if (board && !picked.current) setMode('board')
      if (wasFresh.current && board) cb.current.onWantRename()
      else if (wasFresh.current && !note.readOnly) {
        // 新建的文档：光标进标题，「未命名」全选，打字就替换
        const h = headingOf(note.text)
        const line = h ? d.view.state.doc.line(h.line) : null
        // 建的时候用户换到了别的标签，新笔记在后台开：不抢焦点（第 6 轮）
        if (cb.current.active) d.view.focus()
        // 点了新建到这会儿（盘慢时一两秒）打的字：第一行换掉「未命名」，回车后面的是正文
        const early = takeTyping(note.path)
        if (line && early) {
          const [first, ...rest] = early.split('\n')
          const insert = first + (rest.length ? '\n\n' + rest.join('\n') : '')
          d.view.dispatch({ changes: { from: line.from + 2, to: line.to, insert }, selection: { anchor: line.from + 2 + insert.length }, userEvent: 'input.type' })
        } else if (line) d.view.dispatch({ selection: { anchor: line.from + 2, head: line.to } })
      } else {
        // 已有的笔记：放回上次离开的地方，没记过放在正文开头（标题下第一段末尾）；不落在藏着的「# 」前面
        if (!note.readOnly) d.view.dispatch({ selection: { anchor: openCursor(note.text, savedCursor(note.path)) }, scrollIntoView: true })
        // 任务界面、白板看法里编辑器藏着：不拿焦点（不然打的字悄悄写进文件）
        if (cb.current.active && modeRef.current === 'doc') focusTaking(d)
      }
      off = window.cn.onNoteChanged((p, text) => {
        if (d && p === d.path) void d.applyRemote(text)
      })
    }
    /**
     * 旧写法的白板（用注释存列的）第一次打开：一次转成「## 列名」写法，主进程写回、单独一次提交（2026-11-21 方向 A），
     * 编辑器拿转好的字；底栏说一句，带「撤回」（文件回到转之前、以后不再自动转，还用以前的自由白板看）
     */
    const convert = async (note: OpenedNote): Promise<OpenedNote> => {
      if (note.readOnly || !needsConvert(note.text)) return note
      const r = await window.cn.boardConvert(note.path).catch((e: Error) => {
        cb.current.onNotice(tNow('《{name}》没转成新写法：{err}', { name: titleOf(note.path), err: String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
        return null
      })
      if (!r) return note
      const name = titleOf(note.path)
      const said = tNow('《{name}》改成了按「##」分列的写法：{columns}列、{cards}张卡，位置都留着', { name, columns: r.columns, cards: r.cards })
      app().noticeUndo(r.commitError ? tNow('{said}；提交没成功：{err}', { said, err: r.commitError }) : said, () => {
        void (async () => {
          await NoteDoc.saveAll()
          await window.cn.boardKeepOld(pathNow.current, r.old, d?.text ?? r.text)
          if (d) await d.applyRemote(r.old)
          cb.current.onNotice(tNow('撤回了：《{name}》回到以前的写法，以后打开不再自动转；「⋯」里能再转', { name }))
          cb.current.onSaved()
        })().catch((e: Error) => cb.current.onNotice(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      })
      cb.current.onSaved()
      return { ...note, text: r.text }
    }
    /**
     * 以前写法的「AI 总结的」卡（编号行后面一段普通的字）第一次打开：一次写成 `> [!ai] AI 总结` 提示块（task-5yp97，这样能选一句开旁支），
     * 主进程写回、单独一次提交，编辑器拿改好的字；底栏说一句，带「撤回」（文件回到改之前、以后打开不再自动改）
     */
    const convertSummary = async (note: OpenedNote): Promise<OpenedNote> => {
      if (note.readOnly || !needsSummaryConvert(note.text)) return note
      const r = await window.cn.summaryConvert(note.path).catch((e: Error) => {
        cb.current.onNotice(tNow('《{name}》里的 AI 总结卡没改成新写法：{err}', { name: titleOf(note.path), err: String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
        return null
      })
      if (!r) return note
      const name = titleOf(note.path)
      const said = r.cards > 1 ? tNow('《{name}》里{n}张「AI 总结的」卡改了写法：能选一句开旁支了', { name, n: r.cards }) : tNow('《{name}》里的「AI 总结的」卡改了写法：能选一句开旁支了', { name })
      app().noticeUndo(r.commitError ? tNow('{said}；提交没成功：{err}', { said, err: r.commitError }) : said, () => {
        void (async () => {
          await NoteDoc.saveAll()
          await window.cn.summaryKeepOld(pathNow.current, r.old, d?.text ?? r.text)
          if (d) await d.applyRemote(r.old)
          cb.current.onNotice(tNow('撤回了：《{name}》里的总结卡回到以前的写法，以后打开不再自动改', { name }))
          cb.current.onSaved()
        })().catch((e: Error) => cb.current.onNotice(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      })
      cb.current.onSaved()
      return { ...note, text: r.text }
    }
    const pre = preread.get(firstPath.current)
    preread.delete(firstPath.current)
    if (pre) init(pre)
    else void window.cn.readNote(firstPath.current).then(convert).then(convertSummary).then(init)
    return () => {
      cancelled = true
      off()
      keepCursor()
      const x = d
      if (x) void x.save().finally(() => x.destroy())
    }
  }, [])

  // 改名、挪走：宽版跟着新路径走
  const lastPath = useRef(path)
  useEffect(() => {
    if (doc.current) doc.current.path = path
    // 路径变了、名字也变了，又不是跟着标题改的：用户自己改了名，从此不再跟
    if (titleOf(path) !== titleOf(pathNow.current) && path !== ownRename.current) follow.current = false
    pathNow.current = path
    if (lastPath.current !== path && wide) setWide(path, true, lastPath.current)
    if (lastPath.current !== path) (moveCursor(lastPath.current, path), moveView(lastPath.current, path))
    lastPath.current = path
  }, [path])

  /** 用以前的自由白板看：导图、撤回了转写法还是旧写法的白板 */
  const legacy = text !== null && (isMindmap(text) || (fmValue(text, 'type') === 'board' && hasOldLayout(text)))
  // ⌘K 里「导图：收起到第一层」「导图：全部展开」（task-wuv05）：当前这篇是导图白板时归它
  useMapCommands(active && !readOnly && text !== null && isMindmap(text), text, (t) => doc.current?.setText(t), path, () => modeRef.current !== 'board' && pick('board'))

  // 独占一行的 [[白板]] 画成白板卡：库里白板的颜色、卡片数（board-link.ts）
  const boards = useMemo(
    () => new Map(props.notes.flatMap((n) => (n.board ? [[titleOf(n.path).toLowerCase(), { path: n.path, color: n.board.color, cards: n.board.nodes ?? n.board.cards, icon: n.board.icon, ...(n.board.nodes !== undefined ? { map: true } : {}) }] as const] : []))),
    [props.notes],
  )
  /** 文末「提到这篇的」里白板、导图画它自己的颜色方块（task-wuv05） */
  const boardColors = useMemo(() => new Map(props.notes.flatMap((n) => (n.board ? [[n.path, n.board.color] as const] : []))), [props.notes])
  useEffect(() => {
    doc.current?.view.dispatch({ effects: setBoards.of(boards) })
  }, [boards, text === null])
  // 文档里嵌白板、嵌一节（doc-embeds.tsx）：库里有哪些笔记
  useEffect(() => {
    doc.current?.view.dispatch({ effects: setNoteIndex.of(props.notes) })
  }, [props.notes, text === null])
  // 和网页配成一对（task-kbnc0）：标题下「对着看 · 书名 · 读到 …」、一句「配成一对？」的提示
  const readAlong = useReadAlongView(path, active, text)
  const readAlongKey = JSON.stringify(readAlong)
  useEffect(() => {
    doc.current?.view.dispatch({ effects: setReadAlong.of(readAlong) })
  }, [readAlongKey, text === null])
  /** 文末「提到这篇的」跟着库里的改动重读 */
  const linkVersion = props.notes.reduce((m, n) => Math.max(m, n.mtimeMs), 0) + props.notes.length

  // 存了盘、外面改了：左栏的列表重读，标题下一行的「改于…」跟着换
  const mtime = props.notes.find((n) => n.path === path)?.mtimeMs
  useEffect(() => {
    if (mtime !== undefined) doc.current?.view.dispatch({ effects: setNoteMeta.of({ mtime }) })
  }, [mtime])

  // 切到别的标签：光标在标题上也算离开了
  useEffect(() => {
    if (!active) void followTitle()
  }, [active])

  /** 光标离开标题那一行：标题改了就把文件改成标题的名字（重名加「 2」，底栏说一句） */
  function followTitle(): Promise<void> {
    titleTurn.current = titleTurn.current.then(renameToTitle)
    return titleTurn.current
  }

  async function renameToTitle() {
    const d = doc.current
    if (!follow.current || !d || d.readOnly) return
    const name = titleRename(d.text, pathNow.current, lastTitle.current)
    if (!name) return
    try {
      lastTitle.current = headingOf(d.text)?.title ?? ''
      await NoteDoc.saveAll()
      const p = await window.cn.renameNote(pathNow.current, name, true)
      ownRename.current = p
      // 马上换：接着打的字自动保存时写进新文件，不在旧名字那里再建一份
      d.path = p
      pathNow.current = p
      cb.current.onRenamed(p)
      // 标题里有「?」这类不能当文件名的字：说清换成了什么；真撞了名才说「已经有」
      const said = nameNotice(lastTitle.current, titleOf(p), '篇', safeName(name)) // 不翻：量词是传给 shared/file-name 选句子的参数
      if (said) cb.current.onNotice(said)
    } catch (e) {
      cb.current.onNotice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  useEffect(() => {
    if (active && !renaming && mode === 'doc' && doc.current) focusTaking(doc.current)
  }, [active, renaming, mode])

  useEffect(() => {
    if (active) cb.current.onDoc(doc.current)
  }, [active, text === null])

  useEffect(() => {
    if (active) cb.current.onMode(mode === 'task' ? 'doc' : mode)
  }, [active, mode])

  useEffect(() => {
    noteRenamers.set(props.tabId, rename)
    noteLeavers.set(props.tabId, leave)
    return () => {
      noteRenamers.delete(props.tabId)
      noteLeavers.delete(props.tabId)
    }
  })

  /** 关标签：写了标题没回车、没点走就 ⌘W，也先按标题改名（和光标离开标题、切标签一样） */
  async function leave(): Promise<string> {
    // 白板「改字」弹层里打的字：和 Esc 一样先存回这一篇，关标签时编辑器收起前会存盘
    doc.current?.flushDraft()
    await followTitle()
    return pathNow.current
  }

  async function rename(name: string) {
    if (!name.trim() || name.trim() === titleOf(path)) return
    // 用户自己改名（标签、F2、面包屑）：以后不再跟着标题改
    follow.current = false
    try {
      // 第一行是「# 旧名」就跟着改成新名
      const d = doc.current
      const old = titleOf(path)
      if (d && d.text.startsWith(`# ${old}\n`)) d.setText(`# ${name.trim()}\n` + d.text.slice(old.length + 3))
      await NoteDoc.saveAll()
      const p = await window.cn.renameNote(path, name)
      cb.current.onRenamed(p)
      if (d && !d.readOnly) {
        d.view.focus()
        d.view.dispatch({ selection: { anchor: d.view.state.doc.length } })
      }
    } catch (e) {
      cb.current.onNotice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  /**
   * 白板右上角的缩放「80% ▾」和「收件箱 N」（task-wz7gb）：浮在白板上，不在标签条里，切任务 / 白板 / 文档时标签条那一排不动。
   * 只有当前标签挂（⇧⌘I 只归前面这块白板）
   */
  const corner =
    active && mode === 'board' ? (
      <BoardCorner
        pct={Math.round(boardScale * 100)}
        zoomKeys={[K('zoom-in'), K('zoom-out'), K('zoom-reset')].filter(Boolean).join(' ') || undefined}
        inboxCount={inboxOf(props.notes, path).length}
        onZoomMenu={() =>
          void showMenu([
            { label: t('放大'), accel: accelFor('zoom-in'), run: () => zoomApi.current?.step(1) },
            { label: t('缩小'), accel: accelFor('zoom-out'), run: () => zoomApi.current?.step(-1) },
            { label: '100%', accel: accelFor('zoom-reset'), run: () => zoomApi.current?.set(1) },
            { label: t('适合窗口'), accel: accelFor('zoom-fit'), run: () => zoomApi.current?.fit() },
            '-',
            { label: t('触控板捏合、按住 ⌘ 滚动也能缩放'), enabled: false, run: () => undefined },
          ])
        }
      />
    ) : null

  return (
    <section className="pane" hidden={!active} data-path={path} ref={paneRef}>
      <TabActs active={active}>
        <span className={'txt' + (state === 'failed' ? ' failed' : '')} hidden={state === 'saved'} data-testid="save-state" data-state={state}>
          {state === 'failed' && <i className="gdot err" />}
          {state === 'saving' ? t('正在保存') : state === 'saved' ? '' : state === 'failed' ? t('写不进去，字只在内存里') : t('未保存')}
        </span>
        {/* 原文件写不进去、字另存到了这一篇（标签跟过来了）：说清楚这篇是什么 */}
        {doc.current?.rescuedFrom && doc.current.path === path && <PageNote strong tip={t('原文件 {path} 写不进去（锁成了只读或盘满了），打的字都存在这一篇', { path: doc.current.rescuedFrom })}>{t('原文件写不进去，字在这里')}</PageNote>}
        {readOnly && (
          <span className="txt warn" data-testid="page-note" title={t('文件里有软件读不懂的字节，为了不改坏它，不保存')}>
            {t('只读')}
          </span>
        )}
        {!readOnly && text !== null && isMindmap(text) && underCat(path, '收件箱') && (
          <PageNote>
            {t('收件箱 · 今晚梦游时归类、起名')}
          </PageNote>
        )}
        {/* 导图白板才有的「布局 ▾」（task-wuv05）：文档、白板两种看法都在，切换时这一排不跳 */}
        {text !== null && isMindmap(text) && <MapLayoutButton text={text} readOnly={readOnly} onChange={(t) => doc.current?.setText(t)} />}
        {text !== null && (
          <PropsButton
            path={path}
            text={text}
            notes={props.notes}
            readOnly={readOnly}
            onChange={(t) => doc.current?.setText(t)}
            onJump={(at) => {
              // 白板看法里先切到文档，再把光标放到那张图、滚过去
              if (mode !== 'doc') ((picked.current = true), setMode('doc'))
              requestAnimationFrame(() => {
                const v = doc.current?.view
                if (!v) return
                v.dispatch({ selection: { anchor: Math.min(at, v.state.doc.length) }, scrollIntoView: true })
                v.focus()
              })
            }}
          />
        )}
        <div className="seg" role="tablist" aria-label={t('看法')}>
          {(
            [
              ['task', 'checklist', t('任务')],
              ['board', 'layout', t('白板')],
              ['doc', 'file-text', t('文档')],
            ] as const
          ).map(([m, icon, name]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => pick(m)} role="tab" aria-selected={mode === m} aria-label={name} data-tip={name} data-key={mode === m || m === 'task' ? undefined : (K('toggle-view') ?? undefined)} data-side="below">
              <Codicon name={icon} size={14} />
              <span className="lb">{name}</span>
            </button>
          ))}
        </div>
        <ActBtn
          icon="ellipsis"
          label={t('更多')}
          onClick={(e) =>
            props.onMenu(e, [
              mode === 'doc' && {
                label: t('宽版'),
                checked: wide,
                run: () => {
                  setWide(path, !wide)
                  setWideState(!wide)
                },
              },
              // 撤回过转写法、还用以前的自由白板的：能再转（导图不转）
              legacy && !readOnly && text !== null && !isMindmap(text) && {
                label: t('改成按「##」分列的写法'),
                run: async () => {
                  await NoteDoc.saveAll()
                  const r = await window.cn.boardConvert(path, true)
                  if (!r) return cb.current.onNotice(t('这块白板已经是按「##」分列的写法了'))
                  await doc.current?.applyRemote(r.text)
                  cb.current.onNotice(t('改成了按「##」分列的写法：{columns}列、{cards}张卡，位置都留着', { columns: r.columns, cards: r.cards }))
                  cb.current.onSaved()
                },
              },
              // 导图（第二批 ④⑫）：在导图里找、导出图片 / PDF / OPML 大纲（导出要照画出来的样子画，文档看法里点了先切到白板）
              ...(text !== null && isMindmap(text)
                ? [
                    '-' as const,
                    { label: tv('在导图里找'), accel: accelFor('find-in-page'), run: () => (modeRef.current !== 'board' && pick('board'), requestFind(path)) },
                    { label: tv('导出图片…'), run: () => (requestExport(path, 'png'), modeRef.current !== 'board' && pick('board')) },
                    { label: tv('导出 PDF…'), run: () => (requestExport(path, 'pdf'), modeRef.current !== 'board' && pick('board')) },
                    { label: tv('导出 OPML 大纲…'), run: () => (requestExport(path, 'opml'), modeRef.current !== 'board' && pick('board')) },
                  ]
                : []),
              // 从用的地方跳到设置（方向 A 的 A3）：最下面一项到设置 › 文档和白板，那一行闪一下
              '-',
              mode === 'board' ?{ label: t('白板设置：点阵、右栏开着时缩小…'), run: () => openSettingsAt('boardShrink') } : { label: t('字体、字号、版心…'), run: () => openSettingsAt('size') },
            ])
          }
        />
      </TabActs>
      <div className="body" hidden={mode !== 'doc'} ref={bodyRef}>
        <div className={'doc ' + mode + (wide ? ' wide' : '')} ref={host} />
      </div>
      {/* 文末「提到这篇的」：画在编辑器下面（版心里），不写进文件 */}
      {mode === 'doc' && text !== null && host.current && createPortal(<Backlinks path={path} version={linkVersion} board={fmValue(text, 'type') === 'board'} boards={boardColors} />, host.current)}
      {/* AI 在这篇文档里动手（插入、改写）：外圈和顶上「AI 正在改这篇 · 停下 esc」（DESIGN.v3 2.3）；白板看法里由白板自己画 */}
      {mode === 'doc' && <AiActLayer area="doc" path={path} host={paneRef} />}
      {/* 任务界面（task-pd1d1）：这一篇的待办，和左边「待办」格、文件夹首页的待办卡同一份、同一套样子 */}
      {mode === 'task' && <TaskView path={path} />}
      {/* 在这一篇里找（⇧⌘F）：文档看法里；白板看法里由白板、导图自己找 */}
      <DocFind view={() => doc.current?.view ?? null} host={() => paneRef.current} on={active && mode === 'doc' && text !== null} readOnly={readOnly} owner={path} />
      {mode === 'doc' && text !== null && <DocToc text={text} doc={() => doc.current} scroller={() => bodyRef.current} onOpenOutline={() => cb.current.onOpenOutline()} />}
      {/* 白板就是这篇文档（2026-11-21 方向 A，doc-board/）：type: board 的也是；导图和撤回了转写法的旧白板照旧用自由白板 */}
      {/* 白板出错只白板这一格换成出错卡（task-pyb39），标签头、切回文档照常 */}
      <PanelGuard area="board" label={t('白板')}>
      {mode === 'board' && text !== null && !legacy && (
        <DocBoardView
          text={text}
          notePath={path}
          notes={props.notes}
          readOnly={readOnly}
          active={active}
          scale={boardScale}
          zoom={zoom}
          onZoom={setZoom}
          zoomApi={zoomApi}
          corner={corner}
          onChange={(t) => doc.current?.setText(t)}
          onDraft={(f) => doc.current && (doc.current.draft = f)}
          onNotice={(t) => cb.current.onNotice(t)}
          onCreateSubBoard={async () => {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
            const p = await window.cn.createBoard(dir, '未命名白板', titleOf(path)) // 不翻：新建时的默认名字（文件名）
            cb.current.onOpenPath(p, true)
            return titleOf(p)
          }}
          onOpenDoc={(pos) => {
            picked.current = true
            setMode('doc')
            requestAnimationFrame(() => {
              const v = doc.current?.view
              if (!v) return
              v.focus()
              v.dispatch({ selection: { anchor: Math.min(pos, v.state.doc.length) }, scrollIntoView: true })
            })
          }}
        />
      )}
      {mode === 'board' && text !== null && legacy && (
        <BoardView
          text={text}
          notePath={path}
          notes={props.notes}
          scale={boardScale}
          zoom={zoom}
          onZoom={setZoom}
          active={active}
          zoomApi={zoomApi}
          corner={corner}
          readOnly={readOnly}
          onChange={(t) => doc.current?.setText(t)}
          onUndo={() => doc.current?.undo()}
          onRedo={() => doc.current?.redo()}
          onOpen={(p) => cb.current.onOpenPath(p)}
          onNotice={(t) => cb.current.onNotice(t)}
          onDraft={(f) => doc.current && (doc.current.draft = f)}
          onCreateSubBoard={async () => {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
            const p = await window.cn.createBoard(dir, '未命名白板', titleOf(path)) // 不翻：新建时的默认名字（文件名）
            cb.current.onOpenPath(p, true)
            return titleOf(p)
          }}
        />
      )}
      </PanelGuard>
    </section>
  )
}
