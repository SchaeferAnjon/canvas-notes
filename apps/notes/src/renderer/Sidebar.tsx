import { when } from '../shared/when'
import { useKeys } from './keys'
import { Codicon } from '@cn/design'
import { fileIcon } from './Palette'
import { useMemo, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { RECENT_PAGE, type RecentGroup, recentOf } from '../shared/recent'
import { type ArchiveDays, INBOX_WARN } from '../shared/sidebar'
import { RenameInput } from './note-menu'
import { onFileMenu } from './ctx/file-menu'
import { GhostRows, MovedMark, type DreamPreview } from './dream/preview'
import { FileTree } from './files/FileTree'
import { vaultName } from './vault-name'
import { noteType, TypeChips, useSideType } from './files/type-filter'
import { HeadBtn, ViewHead } from './shell/Shell'
import './sidebar.css'
import type { Tab } from './tabs'
import { useNewNoteBusy } from './new-note-hold'
import { AiIcon, EngineLogo, useChatEngine } from './engine-logo'

/**
 * 左栏（2026-11-17 用户定 `左栏按维度组织`）：「文件」按位置（目录树）、「最近」按时间；
 * 分隔线下面是摘到活动栏的文件夹，各占一格（dir:<文件夹>）：都是它自己那一枝目录树（2026-11-18 方向 A「活动栏平铺」：
 * 收件箱、课程这些顶级分类也一样），底下一行「在「文件」里看位置」。梦游报告由 App 直接放 DreamPanel。
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
  onOpenFolder(folder: string): void
  /** 摘出来的文件夹底下「在「文件」里看位置」 */
  onShowInFiles(folder: string): void
}) {
  const { notes, active } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const boards = useMemo(() => new Map(notes.flatMap((n) => (n.board ? [[n.path, n.board.color] as const] : []))), [notes])
  const digests = useMemo(() => new Set(notes.flatMap((n) => (n.digest ? [n.path] : []))), [notes])
  const noteTypes = useMemo(() => new Map(notes.flatMap((n) => (noteType(n) === 'doc' ? [] : [[n.path, noteType(n)] as const]))), [notes])
  const activePath = active?.type === 'folder' ? active.folder : active && 'path' in active ? active.path : null
  const isOn = (path: string) => active?.type === 'note' && active.path === path
  const menu = (e: React.MouseEvent, path: string) => onFileMenu(e, path, { rename: () => setRenaming(path) })

  /** 一行笔记：图标（白板是它的颜色方块）、名字、右边时间或卡片数 */
  const row = (n: NoteFile, right?: React.ReactNode) => (
    <button key={n.path} className={'si' + (isOn(n.path) ? ' on' : '')} onClick={() => props.onOpenNote(n.path)} onContextMenu={(e) => menu(e, n.path)} title={n.path}>
      {n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={n.table ? 'database' : fileIcon(n.path, false, n.digest)} />}
      {renaming === n.path ? <RenameInput path={n.path} onDone={() => setRenaming(null)} onRename={props.onRename} /> : <span className="truncate">{titleOf(n.path)}</span>}
      {/* 数据库的一条：后面淡淡写是哪个表的，和普通笔记分得开 */}
      {n.table && renaming !== n.path && <span className="s-table truncate">{n.table}</span>}
      {props.preview?.preview.marks.get(n.path) && <MovedMark m={props.preview.preview.marks.get(n.path)!} pv={props.preview} />}
      {n.draft && <span className="tag-draft">草稿</span>}
      {right !== undefined && <span className="c num">{right}</span>}
    </button>
  )

  const folder = props.view.startsWith('dir:') ? props.view.slice(4) : null
  const inboxN = folder === INBOX_DIR ? notes.filter((n) => n.kind === 'inbox').length : 0
  return (
    <aside className={'side' + (props.preview ? ' previewing' : '') + (props.view === 'files' || folder ? ' tree-mode' : '')} aria-label={viewName(props.view)}>
      {props.view === 'files' && (
        <FileTree
          title="文件"
          vaultName={vaultName()}
          onNewNote={props.onNewNote}
          onNewBoard={props.onNewBoard}
          activePath={activePath}
          onOpen={props.onOpenFile}
          onOpenFolder={props.onOpenFolder}
          preview={props.preview ?? null}
          onRename={props.onRename}
          boards={boards}
          noteTypes={noteTypes}
          digests={digests}
          pins={props.pins}
        />
      )}
      {props.view === 'recent' && <RecentSide {...props} row={row} />}
      {folder && (
        <>
          <FileTree
            key={folder}
            vaultName={vaultName()}
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
            digests={digests}
            pins={props.pins}
          />
          {/* 收件箱堆多了（超过 20 条）：底下多一行琥珀色「让 AI 分一分」（平时没有，和小样里的样子一样） */}
          {folder === INBOX_DIR && inboxN > INBOX_WARN && (
            <div className="sall s-warn">
              <button className="si s-tidy" aria-label={`收件箱堆了${inboxN}条，让AI分进课程、周记、剪藏这些`} data-tip="跑 /整理收件箱：只给建议，点同意之前一条都不挪" data-side="right" onClick={props.onTidy}>
                <AiIcon job="chat" size={14} />
                <span className="truncate">{`收件箱堆了${inboxN}条 · 让AI分一分`}</span>
              </button>
            </div>
          )}
          <div className="sall s-loc">
            <button className="si" onClick={() => props.onShowInFiles(folder)}>
              <Codicon name="files" size={14} />
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
  const K = useKeys()
  const newBusy = useNewNoteBusy()
  /** 「问AI」画 AI 对话正在用的那家的标志（CN-127，设置里换了当场跟着换） */
  const engine = useChatEngine()
  const [sideType, setType] = useSideType()
  // 「附件」只在文件树里有：这里当「全部」
  const type = sideType === 'att' ? 'all' : sideType
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
        <HeadBtn icon="new-file" label="新建笔记" keys={K('new-note') ?? undefined} busy={newBusy} onClick={props.onNewNote} />
        <HeadBtn icon="layout" label="新建白板" onClick={props.onNewBoard} />
        <HeadBtn icon="comment-discussion" glyph={<EngineLogo id={engine.id} size={15} />} label="问AI" keys={K('ask-ai') ?? undefined} onClick={props.onAskAi} />
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
