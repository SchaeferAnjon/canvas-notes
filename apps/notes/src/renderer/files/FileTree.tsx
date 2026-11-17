import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildTree, type FileEntry, fileName, folderOfPath, folderProgress, isTreeSort, previewFiles, subtree, TREE_SORTS, type TreeNode, type TreeSort } from '../../shared/files'
import { MovedMark, type DreamPreview } from '../dream/preview'
import { fileIcon } from '../Palette'
import { Progress } from '../search/QuickOpen'
import { setTreePicked, takeReveal, useVaultFiles } from './store'
import { folderMenu, onFileMenu } from '../ctx/file-menu'
import { menuAt } from '../ctx/menu'
import { app } from '../ctx/actions'
import { FolderRename, RenameInput } from '../note-menu'
import { HeadBtn, MenuItem, Popover, ViewHead } from '../shell/Shell'
import { FolderGlyph, LookPicker } from './look'
import { revealHeading } from './reveal'
import { fileType, TypeChips, type TypeFilter, useSideType } from './type-filter'
import './file-tree.css'

const OPEN_KEY = 'cn.treeOpen'
const VIEW_KEY = 'cn.treeView'
/** 一个文件夹先显示这么多，多的点「再显示」（别把上万条全铺开） */
const PAGE = 100
/** 定位到的那一行一圈强调色外圈，约 2 秒后消失（和白板上刚落下的卡片一样） */
const RING_MS = 2000

/** 目录树里拖着的笔记（库里的相对路径） */
const DRAG_MIME = 'application/x-cn-note'
/** 拖着的是文件夹（和访达一样能拖进别的文件夹） */
const DRAG_DIR = 'application/x-cn-folder'

/** 排序菜单里的：六种排法、三个开关、自动定位当前文件；记在本机 */
export interface TreeView {
  sort: TreeSort
  foldersFirst: boolean
  pinsFirst: boolean
  counts: boolean
  autoReveal: boolean
}
const DEFAULT_VIEW: TreeView = { sort: 'name-asc', foldersFirst: true, pinsFirst: true, counts: true, autoReveal: true }

function loadView(): TreeView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<TreeView> | null
    if (!v) return DEFAULT_VIEW
    return {
      sort: isTreeSort(v.sort) ? v.sort : DEFAULT_VIEW.sort,
      foldersFirst: v.foldersFirst !== false,
      pinsFirst: v.pinsFirst !== false,
      counts: v.counts !== false,
      autoReveal: v.autoReveal !== false,
    }
  } catch {
    return DEFAULT_VIEW
  }
}

function loadOpen(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['课程'])
  } catch {
    return new Set(['课程'])
  }
}

const ancestors = (p: string) => {
  const out: string[] = []
  for (let d = folderOfPath(p); d; d = folderOfPath(d)) out.push(d)
  return out
}

const shown = (name: string) => name.replace(/\.(md|pdf|html?)$/i, '')

/**
 * 左栏「文件」（按位置，Obsidian 式目录树）：头上六个图标（新建笔记、新建文件夹、新建白板、定位当前文件、排序、全部收起），
 * 一排类型筛选，下面是整个库的目录树（md、PDF、HTML、空文件夹）；每个文件夹后面是篇数，置顶的有图钉，能有自己的图标和颜色。
 * 点文件夹的名字开它的首页（顺手展开），点箭头只展开；点文件按类型开标签。
 * root：摘到活动栏的文件夹，只画它自己那一枝。梦游预览开着时画成改好以后的样子：挪来的标「新」，原来的位置留划掉的影子。
 */
export function FileTree(props: {
  /** 头上的字：「文件」或摘出来的文件夹的名字 */
  title: string
  root?: string
  onNewNote(): void
  onNewBoard(): void
  activePath: string | null
  onOpen(path: string): void
  onOpenFolder(path: string): void
  preview?: DreamPreview | null
  onRename(path: string, name: string): void
  /** 白板：路径 → 它自己的颜色（目录树里画颜色方块，不画文档图标） */
  boards: Map<string, string>
  /** md 是哪类（白板、素材；没有的是文档），类型筛选用 */
  noteTypes: ReadonlyMap<string, Exclude<TypeFilter, 'all'>>
  pins: string[]
}) {
  const { files, loaded } = useVaultFiles()
  const [open, setOpen] = useState(loadOpen)
  const [view, setView] = useState(loadView)
  const [type, setType] = useSideType()
  const [pages, setPages] = useState<Record<string, number>>({})
  /** 右键「重命名」：原地改名的那一篇或那个文件夹 */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** 点过的文件夹（新建笔记、文件夹放进它里面）；点文件后换成没有 */
  const [picked, setPicked] = useState<string | null>(null)
  /** 正在新建文件夹：在哪个文件夹里（'' 是库的最外层） */
  const [making, setMaking] = useState<string | null>(null)
  const [sortMenu, setSortMenu] = useState<HTMLElement | null>(null)
  const [look, setLook] = useState<{ folder: string; el: HTMLElement } | null>(null)
  /** 刚定位到的那一行：一圈外圈，2 秒后消失 */
  const [ring, setRing] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  /** 拖着一篇笔记或一个文件夹经过的文件夹（松手就挪进去） */
  const [dropOn, setDropOn] = useState<string | null>(null)
  /** 正在拖的文件夹（dragover 时读不到 dataTransfer 里的值，自己记着，不让拖进它自己里面） */
  const draggingDir = useRef<string | null>(null)
  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = [...e.dataTransfer.types]
      const dir = types.includes(DRAG_DIR) ? draggingDir.current : null
      if (!types.includes(DRAG_MIME) && !dir) return
      // 文件夹不能拖进它自己、它里面，拖回原来的上一层也不算
      if (dir && (folder === dir || folder.startsWith(dir + '/') || folderOfPath(dir) === folder)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropOn !== folder) setDropOn(folder)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && dropOn === folder) setDropOn(null)
    },
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(DRAG_MIME)
      const dir = e.dataTransfer.getData(DRAG_DIR)
      setDropOn(null)
      draggingDir.current = null
      if (!path && !dir) return
      e.preventDefault()
      e.stopPropagation()
      if (dir) {
        if (folder !== dir && !folder.startsWith(dir + '/') && folderOfPath(dir) !== folder) void app().moveFolder(dir, folder)
      } else if (folderOfPath(path) !== folder) void app().moveNote(path, folder)
    },
  })
  const pv = props.preview
  // 新建笔记（⌘N、头上的按钮）放进点过的文件夹；摘出来的文件夹里没点过就放进它自己；目录树关了就不算
  useEffect(() => setTreePicked(picked ?? props.root ?? null), [picked, props.root])
  useEffect(() => () => setTreePicked(null), [])
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // 记不住排法不影响使用
    }
  }, [view])
  // 从摘出来的文件夹点「在「文件」里看位置」过来：展开到它、滚过去、一圈外圈
  useEffect(() => {
    const r = props.root ? null : takeReveal()
    if (!r) return
    setOpen((o) => new Set([...o, ...ancestors(r)]))
    setRing(r)
    scrollTo(r)
  }, [])
  useEffect(() => {
    if (!ring) return
    const t = setTimeout(() => setRing(null), RING_MS)
    return () => clearTimeout(t)
  }, [ring])

  const pinSet = useMemo(() => new Set(props.pins), [props.pins])
  const { tree, real, ghosts } = useMemo(() => {
    const keep = type === 'all' ? undefined : (f: FileEntry) => fileType(f, props.noteTypes) === type
    const opts = { sort: view.sort, foldersFirst: view.foldersFirst, pinsFirst: view.pinsFirst, pins: pinSet, keep }
    let real = new Map<string, string>()
    let ghosts = new Map<string, string>()
    let list = files
    if (pv) {
      const p = previewFiles(files, pv.moves)
      list = [...p.files, ...p.ghosts.map((g): FileEntry => ({ path: g.from, kind: 'md', mtimeMs: 0 }))]
      real = p.moved
      ghosts = new Map(p.ghosts.map((g) => [g.from, g.to]))
    }
    const all = buildTree(list, opts)
    return { tree: props.root ? subtree(all, props.root) : all, real, ghosts }
  }, [files, pv, view.sort, view.foldersFirst, view.pinsFirst, pinSet, type, props.noteTypes, props.root])

  const openTo = (path: string) =>
    setOpen((o) => {
      const need = ancestors(path).filter((d) => !o.has(d))
      return need.length ? new Set([...o, ...need]) : o
    })
  const scrollTo = (path: string) =>
    requestAnimationFrame(() => treeRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }))
  // 自动定位当前文件（VS Code 的 Auto Reveal）：切标签时展开到那一篇、滚过去
  useEffect(() => {
    if (!props.activePath || !view.autoReveal) return
    openTo(props.activePath)
    scrollTo(props.activePath)
  }, [props.activePath, view.autoReveal])
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
    } catch {
      // 记不住展开了哪些不影响使用
    }
  }, [open])

  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const openFolder = (p: string) => {
    setPicked(p)
    setOpen((o) => (o.has(p) ? o : new Set([...o, p])))
    props.onOpenFolder(p)
  }

  /** 新建文件夹放在哪：点过的文件夹；没点过就是开着的文件所在的文件夹；都没有是最外层（摘出来的文件夹里是它自己） */
  const isDir = (p: string) => files.some((f) => f.kind === 'dir' && f.path === p)
  const inRoot = (p: string) => !props.root || p === props.root || p.startsWith(props.root + '/')
  const around = props.activePath && inRoot(props.activePath) ? (isDir(props.activePath) ? props.activePath : folderOfPath(props.activePath)) : null
  const target = picked ?? around ?? props.root ?? ''
  const startFolder = (parent: string) => {
    if (parent) setOpen((o) => new Set([...o, parent, ...ancestors(parent)]))
    setMaking(parent)
  }
  const makeFolder = async (parent: string, name: string) => {
    setMaking(null)
    if (!name.trim()) return
    try {
      const f = await window.cnFolder.make(parent, name)
      setPicked(f)
      app().refresh()
      app().notice(`建好了「${f}」`)
    } catch (e) {
      app().notice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  /** 定位当前文件：展开到它那一层，滚过去，一圈外圈 2 秒 */
  const reveal = () => {
    if (!props.activePath) return app().notice('现在没有开着库里的文件')
    if (!inRoot(props.activePath)) return app().notice(`开着的文件不在「${props.title}」里`)
    if (type !== 'all') setType('all')
    openTo(props.activePath)
    setRing(props.activePath)
    scrollTo(props.activePath)
  }
  const setV = (patch: Partial<TreeView>) => setView((v) => ({ ...v, ...patch }))

  const newFolderRow = (parent: string, depth: number) => (
    <div key={'new:' + parent} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row ft-new" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="ft-tw" />
      <Codicon name="folder" size={16} />
      <input
        className="si-rename"
        aria-label="新文件夹的名字"
        autoFocus
        placeholder="新文件夹"
        onBlur={(e) => void makeFolder(parent, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
          if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = ''), e.currentTarget.blur())
        }}
      />
    </div>
  )

  const rows: React.ReactNode[] = []
  const walk = (nodes: TreeNode[], depth: number, dir: string) => {
    if (making === dir) rows.push(newFolderRow(dir, depth))
    const limit = pages[dir] ?? PAGE
    for (const [i, n] of nodes.slice(0, limit).entries()) {
      const pad = { paddingLeft: 8 + depth * 14 }
      if (n.kind === 'dir') {
        const isOpen = open.has(n.path)
        const fp = folderProgress(n)
        const on = props.activePath === n.path
        rows.push(
          <div
            key={n.path}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isOpen}
            aria-selected={on}
            tabIndex={-1}
            data-path={n.path}
            className={'si ft-row' + (on ? ' on' : picked === n.path ? ' picked' : '') + (ring === n.path ? ' ring' : '') + (dropOn === n.path ? ' drop' : '')}
            style={pad}
            title={n.path}
            {...dropProps(n.path)}
            draggable={!pv && renaming !== n.path}
            onDragStart={(e) => {
              e.stopPropagation()
              draggingDir.current = n.path
              e.dataTransfer.setData(DRAG_DIR, n.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => ((draggingDir.current = null), setDropOn(null))}
            onClick={() => openFolder(n.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openFolder(n.path)
              if (e.key === 'F2') setRenaming(n.path)
            }}
            onContextMenu={(e) => {
              setPicked(n.path)
              const el = e.currentTarget
              void menuAt(e, folderMenu(n.path, { rename: () => setRenaming(n.path), newFolder: () => startFolder(n.path), look: () => setLook({ folder: n.path, el }) }))
            }}
          >
            <span
              className="ft-tw"
              role="button"
              aria-label={`${isOpen ? '收起' : '展开'} ${n.name}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(n.path)
              }}
            >
              <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
            </span>
            <FolderGlyph folder={n.path} open={isOpen} />
            {renaming === n.path ? <FolderRename folder={n.path} onDone={() => setRenaming(null)} /> : <span className="truncate">{n.name}</span>}
            <span className="ft-fl" />
            {n.pinned && (
              <span className="ft-pin" aria-label="置顶了">
                <Codicon name="pinned" size={12} />
              </span>
            )}
            {/* 课程文件夹：问完了几讲 / 一共几讲（一讲都没问完不写）；别的写篇数 */}
            {fp && fp.done > 0 ? (
              <span className="ft-meta num">
                {`${fp.done}/${fp.total}讲`}
              </span>
            ) : (
              view.counts && <span className="ft-count num">{n.count}</span>
            )}
          </div>,
        )
        if (isOpen) walk(n.children, depth + 1, n.path)
        else if (making === n.path) rows.push(newFolderRow(n.path, depth + 1))
        continue
      }
      const ghostTo = ghosts.get(n.path)
      if (ghostTo) {
        rows.push(
          <div key={'ghost:' + n.path} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row pv-ghost" style={pad} title={`挪到 ${ghostTo}`}>
            <span className="ft-tw" />
            <Codicon name="inbox" size={16} />
            <s className="truncate">{shown(n.name)}</s>
            <span className="to truncate">{`挪到${fileName(folderOfPath(ghostTo))}`}</span>
          </div>,
        )
        continue
      }
      // 软件汇总的（排在课程最上面）和下面自己的笔记之间一条细线
      const prevAuto = i > 0 && !!nodes[i - 1]!.entry?.auto
      if (prevAuto && !n.entry?.auto) rows.push(<div key={'sep:' + n.path} className="ft-sep" role="separator" style={{ marginLeft: 36 + depth * 14 }} />)
      const realPath = real.get(n.path) ?? n.path
      const mark = pv?.preview.marks.get(n.path)
      rows.push(
        <div
          key={n.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={props.activePath === realPath}
          tabIndex={-1}
          data-path={realPath}
          className={'si ft-row ft-fit' + (props.activePath === realPath ? ' on' : '') + (ring === realPath ? ' ring' : '')}
          style={pad}
          title={n.path}
          // 笔记能拖进别的文件夹（松在文件夹那一行上）
          draggable={n.kind === 'md' && !pv}
          onDragStart={(e) => (e.dataTransfer.setData(DRAG_MIME, realPath), (e.dataTransfer.effectAllowed = 'move'))}
          onDragEnd={() => setDropOn(null)}
          onClick={() => (setPicked(null), props.onOpen(realPath))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onOpen(realPath)
            if (e.key === 'F2' && /\.md$/i.test(realPath)) setRenaming(realPath)
          }}
          onContextMenu={(e) => onFileMenu(e, realPath, { rename: () => setRenaming(realPath) })}
        >
          <span className="ft-tw" />
          {props.boards.has(realPath) ? <i className="sw ft-sw" style={{ background: props.boards.get(realPath) }} /> : <Codicon name={fileIcon(n.path)} size={16} />}
          {renaming === realPath ? (
            <RenameInput path={realPath} onDone={() => setRenaming(null)} onRename={props.onRename} />
          ) : (
            <span className="truncate">{shown(n.name)}</span>
          )}
          {/* PDF、HTML 名字后面一个小标（照 Obsidian）；md 不加（默认状态不加标签） */}
          {(n.kind === 'pdf' || n.kind === 'html') && <span className="ft-ext">{n.kind === 'pdf' ? 'PDF' : 'HTML'}</span>}
          {n.entry?.auto && (
            <span className="ft-auto" data-tip={`软件按这里各篇笔记汇总的，${n.entry.auto.count}条；要改就改笔记里那一段`}>
              自动汇总
            </span>
          )}
          {mark && pv && <MovedMark m={mark} pv={pv} />}
          <span className="ft-fl" />
          {n.pinned && (
            <span className="ft-pin" aria-label="置顶了">
              <Codicon name="pinned" size={12} />
            </span>
          )}
          {n.entry?.doubts && (
            <button
              className="ft-meta ft-doubts num"
              data-tip={`跳到「${shown(fileName(n.entry.doubts.summary))}」里这一讲`}
              onClick={(e) => {
                e.stopPropagation()
                void revealHeading(n.entry!.doubts!.summary, n.entry!.doubts!.heading)
              }}
            >
              {`疑惑${n.entry.doubts.n}`}
            </button>
          )}
          {n.kind === 'pdf' && (
            <span className="ft-meta">
              <Progress p={n.entry?.progress} />
            </span>
          )}
        </div>,
      )
    }
    if (nodes.length > limit) {
      rows.push(
        <button key={'more:' + dir} className="si s-more ft-more" style={{ paddingLeft: 36 + depth * 14 }} onClick={() => setPages((p) => ({ ...p, [dir]: limit + PAGE }))}>
          <span className="num">{`还有${nodes.length - limit}个 · 再显示${Math.min(PAGE, nodes.length - limit)}个`}</span>
        </button>,
      )
    }
  }
  walk(tree, 0, props.root ?? '')
  const sortNow = TREE_SORTS.find((s) => s.id === view.sort)!

  return (
    <>
      <ViewHead title={props.title}>
        <HeadBtn icon="new-file" label="新建笔记" keys="⌘N" onClick={props.onNewNote} />
        <HeadBtn icon="new-folder" label="新建文件夹" keys={target ? `放进「${fileName(target)}」` : '放在库的最外层'} onClick={() => startFolder(target)} />
        <HeadBtn icon="layout" label="新建白板" onClick={props.onNewBoard} />
        <HeadBtn icon="target" label="定位当前文件" onClick={reveal} />
        <HeadBtn icon="sort-precedence" label="排序" keys={`${sortNow.label} · ${sortNow.hint}`} on={!!sortMenu} onClick={(e) => {
          const el = e.currentTarget
          setSortMenu((m) => (m ? null : el))
        }} />
        <HeadBtn icon="collapse-all" label="全部收起" onClick={() => setOpen(new Set())} />
      </ViewHead>
      <TypeChips value={type} onChange={setType} className="side-chips" />
      {sortMenu && (
        <Popover anchor={sortMenu} label="排序" onClose={() => setSortMenu(null)} className="sortpop">
          <div className="mh">排序</div>
          {TREE_SORTS.map((s) => (
            <MenuItem key={s.id} icon={view.sort === s.id ? 'check' : undefined} label={s.label} right={s.hint} onClick={() => setV({ sort: s.id })} />
          ))}
          <div className="ms" />
          <MenuItem icon={view.foldersFirst ? 'check' : undefined} label="文件夹排在前面" onClick={() => setV({ foldersFirst: !view.foldersFirst })} />
          <MenuItem icon={view.pinsFirst ? 'check' : undefined} label="置顶的排在最前" onClick={() => setV({ pinsFirst: !view.pinsFirst })} />
          <MenuItem icon={view.counts ? 'check' : undefined} label="显示篇数" onClick={() => setV({ counts: !view.counts })} />
          <div className="ms" />
          <MenuItem icon={view.autoReveal ? 'check' : undefined} label="自动定位当前文件" onClick={() => setV({ autoReveal: !view.autoReveal })} />
        </Popover>
      )}
      {look && <LookPicker folder={look.folder} anchor={look.el} onClose={() => setLook(null)} />}
      <nav className="nav" aria-label="笔记">
        <div
          className="ftree"
          role="tree"
          aria-label={props.root ? `${props.title} 的文件` : '全部文件'}
          ref={treeRef}
          // 空白处：点一下就不再「选着」哪个文件夹（新建文件夹放到开着的文件旁边或最外层）；右键在这一层新建
          onClick={(e) => e.target === e.currentTarget && setPicked(null)}
          onContextMenu={(e) =>
            e.target === e.currentTarget &&
            void menuAt(e, [
              { label: '新建笔记', run: () => app().newNote(props.root ?? '') },
              { label: '新建白板', run: () => app().newBoard(props.root ?? '') },
              { label: '新建文件夹', run: () => (setPicked(null), startFolder(props.root ?? '')) },
            ])
          }
        >
          {rows}
          {loaded && !tree.length && making === null && <p className="s-none">{type === 'all' ? (props.root ? '这个文件夹还是空的' : '库里还没有笔记、PDF或HTML') : '没有这一类的文件'}</p>}
        </div>
      </nav>
    </>
  )
}
