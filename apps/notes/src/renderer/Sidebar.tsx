import { when } from '../shared/when'
import { Codicon } from '@cn/design'
import { useMemo, useState } from 'react'
import type { NoteFile } from '../shared/api'
import type { FolderEntry } from '../shared/folder-home'
import { folderOfPath, progressDone } from '../shared/files'
import { titleOf } from '../shared/layout'
import { RECENT_PAGE, type RecentGroup, recentOf } from '../shared/recent'
import { type ArchiveDays, INBOX_WARN } from '../shared/sidebar'
import { FolderRename, RenameInput } from './note-menu'
import { app } from './ctx/actions'
import { folderMenu, onFileMenu } from './ctx/file-menu'
import { menuAt } from './ctx/menu'
import { GhostRows, MovedMark, type DreamPreview } from './dream/preview'
import { FileTree } from './files/FileTree'
import { FolderGlyph, LookPicker } from './files/look'
import { useVaultFiles } from './files/store'
import { noteType, TypeChips, useSideType } from './files/type-filter'
import { HeadBtn, ViewHead } from './shell/Shell'
import './sidebar.css'
import type { Tab } from './tabs'
import { useNewNoteBusy } from './new-note-hold'

/**
 * 左栏（2026-11-17 用户定 `左栏按维度组织`）：「文件」按位置（目录树）、「最近」按时间；
 * 分隔线下面是摘到活动栏的文件夹，各占一格（dir:<文件夹>）：课程是课程列表、收件箱是最新的收件，别的是它自己那一枝目录树。
 * 梦游报告由 App 直接放 DreamPanel。
 */
export type SideView = 'files' | 'recent' | 'dream' | `dir:${string}`
export const COURSES = '课程'
export const INBOX_DIR = '收件箱'
export const viewName = (v: SideView) => (v === 'files' ? '文件' : v === 'recent' ? '最近' : v === 'dream' ? '梦游报告' : v.slice(4).split('/').pop()!)

export function Sidebar(props: {
  view: Exclude<SideView, 'dream'>
  notes: NoteFile[]
  pins: string[]
  archiveDays: ArchiveDays
  active: Tab | null
  onOpenNote(path: string): void
  onOpenInbox(): void
  /** 中间开「最近」整页 */
  onOpenRecent(): void
  onOpenArchive(): void
  onNewNote(): void
  onNewBoard(): void
  onAskAi(): void
  /** 目录树里点了文件（md、PDF、HTML） */
  onOpenFile(path: string): void
  /** 收件箱堆多了：让 AI 分一分 */
  onTidy(): void
  /** 右键菜单里点了「重命名」后，在左栏原地改名 */
  onRename(path: string, name: string): void
  /** 梦游预览开着：notes 已经是改好以后的样子，挪来的行标「新」，收件箱里留影子 */
  preview?: DreamPreview | null
  /** 有首页的文件夹（课程/<课>、项目/<项目>、生活、写作）；fresh：只在梦游预览里才有的 */
  folders: (FolderEntry & { fresh?: boolean })[]
  onOpenFolder(folder: string): void
  onNewCourse(): void
  /** 摘出来的文件夹底下「在「文件」里看位置」 */
  onShowInFiles(folder: string): void
}) {
  const { notes, active } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const [look, setLook] = useState<{ folder: string; el: HTMLElement } | null>(null)
  const boards = useMemo(() => new Map(notes.flatMap((n) => (n.board ? [[n.path, n.board.color] as const] : []))), [notes])
  const noteTypes = useMemo(() => new Map(notes.flatMap((n) => (noteType(n) === 'doc' ? [] : [[n.path, noteType(n)] as const]))), [notes])
  const activePath = active?.type === 'folder' ? active.folder : active && 'path' in active ? active.path : null
  const isOn = (path: string) => active?.type === 'note' && active.path === path
  const menu = (e: React.MouseEvent, path: string) => onFileMenu(e, path, { rename: () => setRenaming(path) })
  const folderAt = (e: React.MouseEvent, folder: string) => {
    const el = e.currentTarget as HTMLElement
    void menuAt(e, folderMenu(folder, { rename: () => setRenaming(folder), look: () => setLook({ folder, el }) }))
  }

  /** 一行笔记：图标（白板是它的颜色方块）、名字、右边时间或卡片数 */
  const row = (n: NoteFile, right?: React.ReactNode) => (
    <button key={n.path} className={'si' + (isOn(n.path) ? ' on' : '')} onClick={() => props.onOpenNote(n.path)} onContextMenu={(e) => menu(e, n.path)} title={n.path}>
      {n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={n.table ? 'database' : n.kind === 'inbox' ? 'inbox' : n.kind === 'clip' ? 'quote' : /(^|\/)我的疑惑\.md$/.test(n.path) ? 'question' : 'file-text'} />}
      {renaming === n.path ? <RenameInput path={n.path} onDone={() => setRenaming(null)} onRename={props.onRename} /> : <span className="truncate">{titleOf(n.path)}</span>}
      {/* 数据库的一条：后面淡淡写是哪个表的，和普通笔记分得开 */}
      {n.table && renaming !== n.path && <span className="s-table truncate">{n.table}</span>}
      {props.preview?.preview.marks.get(n.path) && <MovedMark m={props.preview.preview.marks.get(n.path)!} pv={props.preview} />}
      {n.draft && <span className="tag-draft">草稿</span>}
      {right !== undefined && <span className="c num">{right}</span>}
    </button>
  )

  const folder = props.view.startsWith('dir:') ? props.view.slice(4) : null
  return (
    <aside className={'side' + (props.preview ? ' previewing' : '') + (props.view === 'files' || (folder && folder !== COURSES && folder !== INBOX_DIR) ? ' tree-mode' : '')} aria-label={viewName(props.view)}>
      {look && <LookPicker folder={look.folder} anchor={look.el} onClose={() => setLook(null)} />}
      {props.view === 'files' && (
        <FileTree
          title="文件"
          onNewNote={props.onNewNote}
          onNewBoard={props.onNewBoard}
          activePath={activePath}
          onOpen={props.onOpenFile}
          onOpenFolder={props.onOpenFolder}
          preview={props.preview ?? null}
          onRename={props.onRename}
          boards={boards}
          noteTypes={noteTypes}
          pins={props.pins}
        />
      )}
      {props.view === 'recent' && <RecentSide {...props} row={row} />}
      {folder === COURSES && <CourseSide {...props} renaming={renaming} setRenaming={setRenaming} folderAt={folderAt} />}
      {folder === INBOX_DIR && <InboxSide {...props} row={row} />}
      {folder && folder !== COURSES && folder !== INBOX_DIR && (
        <>
          <FileTree
            key={folder}
            title={folder.split('/').pop()!}
            root={folder}
            onNewNote={props.onNewNote}
            onNewBoard={props.onNewBoard}
            activePath={activePath}
            onOpen={props.onOpenFile}
            onOpenFolder={props.onOpenFolder}
            preview={props.preview ?? null}
            onRename={props.onRename}
            boards={boards}
            noteTypes={noteTypes}
            pins={props.pins}
          />
          <div className="sall">
            <button className="si" onClick={() => props.onShowInFiles(folder)}>
              <Codicon name="files" />
              <span className="truncate">在「文件」里看位置</span>
              <span className="c">{folder}/</span>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

type RowFn = (n: NoteFile, right?: React.ReactNode) => React.ReactNode

/** 「最近」：置顶 → 今天 → 这周 → 按月收起；底下只留「归档」 */
function RecentSide(props: Parameters<typeof Sidebar>[0] & { row: RowFn }) {
  const newBusy = useNewNoteBusy()
  const [type, setType] = useSideType()
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<Record<string, number>>({})
  const now = Date.now()
  const m = useMemo(
    () => recentOf(props.notes, { pins: props.pins, now, archiveDays: props.archiveDays, keep: type === 'all' ? undefined : (n) => noteType(n) === type }),
    // now 每次渲染都变，只在笔记、置顶、筛选变了时重算
    [props.notes, props.pins, props.archiveDays, type],
  )
  const group = (g: RecentGroup) => {
    const folded = g.key !== 'today' && g.key !== 'week'
    const open = !folded || openMonths.has(g.key)
    const limit = shown[g.key] ?? RECENT_PAGE
    return (
      <div className="s-group" role="group" aria-label={g.label} key={g.key}>
        {folded ? (
          <button className="si s-fold" aria-expanded={open} onClick={() => setOpenMonths((s) => (s.has(g.key) ? new Set([...s].filter((x) => x !== g.key)) : new Set([...s, g.key])))}>
            <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
            <span className="truncate">{g.label}</span>
            <span className="c num">{`${g.items.length}篇`}</span>
          </button>
        ) : (
          <div className="sh">{g.label}</div>
        )}
        {open && g.items.slice(0, limit).map((n) => props.row(n, when(n.mtimeMs, { now })))}
        {open && g.items.length > limit && (
          <button className="si s-more" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + RECENT_PAGE }))}>
            <span className="num">{`还有${g.items.length - limit}篇 · 再显示${Math.min(RECENT_PAGE, g.items.length - limit)}篇`}</span>
          </button>
        )}
      </div>
    )
  }
  return (
    <>
      <ViewHead
        title="最近"
        sub={
          <span className="num" data-testid="recent-count">
            {`${m.total}篇`}
          </span>
        }
      >
        <HeadBtn icon="new-file" label="新建笔记" keys="⌘N" busy={newBusy} onClick={props.onNewNote} />
        <HeadBtn icon="layout" label="新建白板" onClick={props.onNewBoard} />
        <HeadBtn icon="sparkle" label="问AI" keys="⌘J" onClick={props.onAskAi} />
        <HeadBtn icon="link-external" label="在中间打开" onClick={props.onOpenRecent} />
      </ViewHead>
      <TypeChips value={type} onChange={setType} className="side-chips" />
      <nav className="nav" aria-label="笔记">
        {m.pinned.length > 0 && (
          <div className="s-group" role="group" aria-label="置顶">
            <div className="sh">
              <Codicon name="pinned" size={12} />
              置顶
            </div>
            {m.pinned.map((n) => props.row(n, when(n.mtimeMs, { now })))}
          </div>
        )}
        {m.groups.map(group)}
        {props.preview && <GhostRows pv={props.preview} />}
        {!m.pinned.length && !m.groups.length && <p className="s-none">{type === 'all' ? '还没有笔记' : '没有这一类的笔记'}</p>}
      </nav>
      <div className="sall">
        <button
          className={'si' + (props.active?.type === 'archive' ? ' on' : '')}
          onClick={props.onOpenArchive}
          title={props.archiveDays ? `${props.archiveDays} 天没改过的，左栏不显示` : '没开自动归档'}
        >
          <Codicon name="archive" />
          归档
          <span className="c num" data-testid="archive-count">
            {`${m.archived}篇`}
          </span>
        </button>
      </div>
    </>
  )
}

/** 「课程」（默认摘在左边）：每门课一行，问完了几讲 / 一共几讲；点开课程首页 */
function CourseSide(props: Parameters<typeof Sidebar>[0] & { renaming: string | null; setRenaming(f: string | null): void; folderAt(e: React.MouseEvent, f: string): void }) {
  const { files } = useVaultFiles()
  const courses = props.folders.filter((f) => f.kind === 'course')
  const progress = useMemo(() => {
    const out = new Map<string, { done: number; total: number }>()
    for (const f of files) {
      if (f.kind !== 'pdf') continue
      const c = folderOfPath(f.path)
      const p = out.get(c) ?? { done: 0, total: 0 }
      p.total++
      if (progressDone(f.progress)) p.done++
      out.set(c, p)
    }
    return out
  }, [files])
  return (
    <>
      <ViewHead title="课程" sub={<span className="num">{`${courses.length}门`}</span>}>
        <HeadBtn icon="new-folder" label="新建一门课" onClick={props.onNewCourse} />
      </ViewHead>
      <nav className="nav" aria-label="课程">
        {courses.map((f) => {
          const p = progress.get(f.folder)
          return (
            <button
              key={f.folder}
              className={'si' + (props.active?.type === 'folder' && props.active.folder === f.folder ? ' on' : '')}
              onClick={() => props.onOpenFolder(f.folder)}
              onContextMenu={(e) => props.folderAt(e, f.folder)}
              title={`${f.folder} · 点开首页`}
            >
              <FolderGlyph folder={f.folder} />
              {props.renaming === f.folder ? <FolderRename folder={f.folder} onDone={() => props.setRenaming(null)} /> : <span className="truncate">{f.folder.split('/').pop()}</span>}
              {f.fresh && <span className="tag-new">新</span>}
              {p && (
                <span className="c num">
                  {`${p.done}/${p.total}讲`}
                </span>
              )}
            </button>
          )
        })}
        {courses.length === 0 && <p className="s-none">还没有课程。点右上角新建一门</p>}
      </nav>
    </>
  )
}

/** 「收件箱」（默认摘在左边）：只列最新的 60 条（别把上万条全铺开），更多在中间打开 */
function InboxSide(props: Parameters<typeof Sidebar>[0] & { row: RowFn }) {
  const newBusy = useNewNoteBusy()
  const inbox = useMemo(() => props.notes.filter((n) => n.kind === 'inbox').sort((a, b) => b.mtimeMs - a.mtimeMs), [props.notes])
  const warn = inbox.length > INBOX_WARN
  const now = Date.now()
  return (
    <>
      <ViewHead title="收件箱" sub={<span className="num">{`${inbox.length}条`}</span>}>
        {/* 新笔记本来就进收件箱：这里也有一颗（建在收件箱里，不看开着的文件夹首页） */}
        <HeadBtn icon="new-file" label="新建笔记" keys="⌘N" busy={newBusy} onClick={() => void app().newNote(INBOX_DIR)} />
        <HeadBtn icon="sparkle" label={warn ? `收件箱堆了${inbox.length}条，让AI按主题分进素材` : '让AI分一分'} className={warn ? 's-tidy' : undefined} onClick={props.onTidy}>
          {warn && <span>让AI分一分</span>}
        </HeadBtn>
        <HeadBtn icon="link-external" label="在中间打开整个收件箱" onClick={props.onOpenInbox} />
      </ViewHead>
      <nav className="nav" aria-label="笔记">
        {inbox.slice(0, 60).map((n) => props.row(n, when(n.mtimeMs, { now })))}
        {inbox.length === 0 && <p className="s-none">收件箱是空的</p>}
        {inbox.length > 60 && (
          <button className="si s-more" onClick={props.onOpenInbox}>
            <span className="num">{`还有${inbox.length - 60}条，在中间打开`}</span>
          </button>
        )}
      </nav>
    </>
  )
}

