import { Codicon } from '@cn/design'
import { fmValue, isMindmap } from '@cn/format'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoteFile, OpenedNote } from '../shared/api'
import { nameNotice, safeName } from '../shared/file-name'
import { titleOf } from '../shared/layout'
import { EDIT_SOURCE } from './block-handles'
import { BoardView, type BoardZoomApi } from './BoardView'
import { loadZoom, saveZoom } from './board-zoom'
import { type MenuEntry, showMenu } from './ctx/menu'
import { DocBoardView } from './doc-board/DocBoardView'
import { DocToc, isWide, setWide } from './doc-toc'
import { followsTitle, headingOf, titleRename } from './title-follow'
import { moveCursor, openCursor, saveCursor, savedCursor } from './open-cursor'
import { PropsButton } from './mindmap/PropsButton'
import { NoteDoc, type SaveState, type ViewMode } from './note-doc'
import { ActBtn, noteLeavers, noteRenamers, PageNote, TabActs } from './shell/TabActs'
import { takeTyping } from './new-note-hold'

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

/** 新建的笔记先读好再开标签：标签一出来编辑器就在、光标就在标题里（机器慢时不再有「标签出来了、编辑器还没好」那一会儿，那时打的头几个字会丢） */
const preread = new Map<string, OpenedNote>()
export const primeNote = (note: OpenedNote) => void preread.set(note.path, note)

export function NoteTab(props: NoteTabProps) {
  const { path, active, fresh } = props
  const host = useRef<HTMLDivElement>(null)
  const doc = useRef<NoteDoc | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const [readOnly, setReadOnly] = useState(false)
  // 白板一打开就是白板样式：左栏的列表已经知道它是白板，不等读完文件（不然先闪一下文档，读完又跳回白板，
  // 这中间点的「文档」也会被盖掉）
  const [mode, setMode] = useState<ViewMode>(() => (props.notes.find((n) => n.path === path)?.board ? 'board' : 'doc'))
  /** 用户自己点过看法：读完文件后不再按 frontmatter 改 */
  const picked = useRef(false)
  const [text, setText] = useState<string | null>(null)
  /** 宽版：版心跟中间栏走、最宽 1100（CN-26），记在这一篇上 */
  const [wide, setWideState] = useState(() => isWide(path))
  const bodyRef = useRef<HTMLDivElement>(null)
  const renaming = props.renaming
  /** 白板缩放：每块白板自己的比例记在本机（不写进文件） */
  const [zoom, setZoomState] = useState(() => loadZoom(path))
  const setZoom = (z: number) => (setZoomState(z), saveZoom(pathNow.current, z))
  const zoomApi = useRef<BoardZoomApi | null>(null)
  const boardScale = zoom * (props.rightOpen ? 0.8 : 1)
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
      setText(note.text)
      follow.current = !note.readOnly && followsTitle(note.text, firstPath.current)
      lastTitle.current = headingOf(note.text)?.title ?? ''
      const board = fmValue(note.text, 'type') === 'board'
      if (board && !picked.current) setMode('board')
      if (wasFresh.current && board) cb.current.onWantRename()
      else if (wasFresh.current && !note.readOnly) {
        // 新建的文档：光标进标题，「未命名」全选，打字就替换
        const h = headingOf(note.text)
        const line = h ? d.view.state.doc.line(h.line) : null
        d.view.focus()
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
        d.view.focus()
      }
      off = window.cn.onNoteChanged((p, text) => {
        if (d && p === d.path) void d.applyRemote(text)
      })
    }
    const pre = preread.get(firstPath.current)
    preread.delete(firstPath.current)
    if (pre) init(pre)
    else void window.cn.readNote(firstPath.current).then(init)
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
    if (lastPath.current !== path) moveCursor(lastPath.current, path)
    lastPath.current = path
  }, [path])

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
      const said = nameNotice(lastTitle.current, titleOf(p), '篇', safeName(name))
      if (said) cb.current.onNotice(said)
    } catch (e) {
      cb.current.onNotice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  useEffect(() => {
    doc.current?.setMode(mode)
  }, [mode])

  // 块菜单「在源文件里改这一块」：切到源文件，选中这一段
  useEffect(() => {
    const el = host.current
    if (!el) return
    const on = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: number; to: number }>).detail
      picked.current = true
      setMode('source')
      requestAnimationFrame(() => {
        const v = doc.current?.view
        if (!v) return
        v.focus()
        v.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
      })
    }
    el.addEventListener(EDIT_SOURCE, on)
    return () => el.removeEventListener(EDIT_SOURCE, on)
  }, [])

  useEffect(() => {
    if (active && !renaming && mode !== 'board') doc.current?.view.focus()
  }, [active, renaming, mode])

  useEffect(() => {
    if (active) cb.current.onDoc(doc.current)
  }, [active, text === null])

  useEffect(() => {
    if (active) cb.current.onMode(mode)
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

  return (
    <section className="pane" hidden={!active} data-path={path}>
      <TabActs active={active}>
        <span className={'txt' + (state === 'failed' ? ' failed' : '')} hidden={state === 'saved'} data-testid="save-state" data-state={state}>
          {state === 'failed' && <i className="gdot err" />}
          {state === 'saving' ? '正在保存' : state === 'saved' ? '' : state === 'failed' ? '没存上' : '未保存'}
        </span>
        {readOnly && (
          <span className="txt warn" data-testid="page-note" title="文件里有软件读不懂的字节，为了不改坏它，不保存">
            只读
          </span>
        )}
        {!readOnly && text !== null && isMindmap(text) && path.startsWith('收件箱/') && (
          <PageNote>
            收件箱 · 今晚梦游时归类、起名
          </PageNote>
        )}
        {text !== null && (
          <PropsButton
            path={path}
            text={text}
            notes={props.notes}
            readOnly={readOnly}
            onChange={(t) => doc.current?.setText(t)}
            onJump={(at) => {
              // 白板看法里先切到文档，再把光标放到那张图、滚过去
              if (mode === 'board') ((picked.current = true), setMode('doc'))
              requestAnimationFrame(() => {
                const v = doc.current?.view
                if (!v) return
                v.dispatch({ selection: { anchor: Math.min(at, v.state.doc.length) }, scrollIntoView: true })
                v.focus()
              })
            }}
          />
        )}
        <div className="seg" role="tablist" aria-label="看法">
          {(
            [
              ['board', 'layout', '白板'],
              ['doc', 'file-text', '文档'],
              ['source', 'code', '源文件'],
            ] as const
          ).map(([m, icon, name]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => ((picked.current = true), setMode(m))} role="tab" aria-selected={mode === m} aria-label={name} data-tip={name} data-side="below">
              <Codicon name={icon} size={14} />
              <span className="lb">{name}</span>
            </button>
          ))}
        </div>
        {mode === 'board' && (
          // 比例本身就是按钮，点开是缩放菜单（按钮带菜单）
          <button
            className="ab-act zoom"
            aria-label="缩放"
            data-testid="board-zoom"
            data-tip="缩放"
            data-key="⌘+ ⌘− ⌘0"
            data-side="below"
            onClick={() =>
              void showMenu([
                { label: '放大', accel: 'CommandOrControl+=', run: () => zoomApi.current?.step(1) },
                { label: '缩小', accel: 'CommandOrControl+-', run: () => zoomApi.current?.step(-1) },
                { label: '100%', accel: 'CommandOrControl+0', run: () => zoomApi.current?.set(1) },
                { label: '适合窗口', accel: 'Shift+CommandOrControl+1', run: () => zoomApi.current?.fit() },
                '-',
                { label: '触控板捏合、按住 ⌘ 滚动也能缩放', enabled: false, run: () => undefined },
              ])
            }
          >
            <span className="num">{Math.round(boardScale * 100)}%</span>
            <Codicon name="chevron-down" size={12} />
          </button>
        )}
        <ActBtn
          icon="ellipsis"
          label="更多"
          onClick={(e) =>
            props.onMenu(e, [
              mode !== 'board' && {
                label: '宽版',
                checked: wide,
                run: () => {
                  setWide(path, !wide)
                  setWideState(!wide)
                },
              },
            ])
          }
        />
      </TabActs>
      <div className="body" hidden={mode === 'board'} ref={bodyRef}>
        <div className={'doc ' + mode + (wide ? ' wide' : '')} ref={host} />
      </div>
      {mode === 'doc' && text !== null && <DocToc text={text} doc={() => doc.current} scroller={() => bodyRef.current} onOpenOutline={() => cb.current.onOpenOutline()} />}
      {/* 普通文档切到白板：按节摆成列（方向 A，doc-board/）；type: board 的白板和导图照旧 */}
      {mode === 'board' && text !== null && fmValue(text, 'type') !== 'board' && !isMindmap(text) && (
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
          onChange={(t) => doc.current?.setText(t)}
          onDraft={(f) => doc.current && (doc.current.draft = f)}
          onNotice={(t) => cb.current.onNotice(t)}
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
      {mode === 'board' && text !== null && (fmValue(text, 'type') === 'board' || isMindmap(text)) && (
        <BoardView
          text={text}
          notePath={path}
          notes={props.notes}
          scale={boardScale}
          zoom={zoom}
          onZoom={setZoom}
          active={active}
          zoomApi={zoomApi}
          readOnly={readOnly}
          onChange={(t) => doc.current?.setText(t)}
          onUndo={() => doc.current?.undo()}
          onRedo={() => doc.current?.redo()}
          onOpen={(p) => cb.current.onOpenPath(p)}
          onNotice={(t) => cb.current.onNotice(t)}
          onDraft={(f) => doc.current && (doc.current.draft = f)}
          onCreateSubBoard={async () => {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
            const p = await window.cn.createBoard(dir, '未命名白板')
            cb.current.onOpenPath(p, true)
            return titleOf(p)
          }}
        />
      )}
    </section>
  )
}
