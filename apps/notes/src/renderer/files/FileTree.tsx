import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import { buildTree, type FileEntry, fileName, folderOfPath, folderProgress, hasFolderHome, previewFiles, type TreeNode } from '../../shared/files'
import { MovedMark, type DreamPreview } from '../dream/preview'
import { fileIcon } from '../Palette'
import { Progress } from '../search/QuickOpen'
import { useVaultFiles } from './store'
import { folderMenu, onFileMenu } from '../ctx/file-menu'
import { menuAt } from '../ctx/menu'
import { app } from '../ctx/actions'
import { RenameInput } from '../note-menu'
import './file-tree.css'

const OPEN_KEY = 'cn.treeOpen'
/** 一个文件夹先显示这么多，多的点「再显示」（别把上万条全铺开） */
const PAGE = 100

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
 * 左栏「全部文件」：整个库的目录树（md、PDF、HTML），PDF 和课程文件夹旁边是进度。
 * 点课程 / 项目 / 生活 / 写作下面文件夹的名字开它的首页，点箭头只展开；点文件按类型开标签。
 * 梦游预览开着时画成改好以后的样子：挪来的标「新」，原来的位置留划掉的影子。
 * 独立组件：以后左边改成图标栏 + 侧栏时整个挪过去就行。
 */
export function FileTree(props: { activePath: string | null; onOpen(path: string): void; onOpenFolder(path: string): void; preview?: DreamPreview | null; onRename(path: string, name: string): void }) {
  const { files, loaded } = useVaultFiles()
  const [open, setOpen] = useState(loadOpen)
  const [pages, setPages] = useState<Record<string, number>>({})
  /** 右键「重命名」：原地改名的那一篇 */
  const [renaming, setRenaming] = useState<string | null>(null)
  const pv = props.preview

  const { tree, real, ghosts } = useMemo(() => {
    if (!pv) return { tree: buildTree(files), real: new Map<string, string>(), ghosts: new Map<string, string>() }
    const p = previewFiles(files, pv.moves)
    const ghostEntries: FileEntry[] = p.ghosts.map((g) => ({ path: g.from, kind: 'md', mtimeMs: 0 }))
    return { tree: buildTree([...p.files, ...ghostEntries]), real: p.moved, ghosts: new Map(p.ghosts.map((g) => [g.from, g.to])) }
  }, [files, pv])

  // 开着的文件所在的文件夹自动展开
  useEffect(() => {
    if (!props.activePath) return
    setOpen((o) => {
      const need = ancestors(props.activePath!).filter((d) => !o.has(d))
      return need.length ? new Set([...o, ...need]) : o
    })
  }, [props.activePath])
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

  const rows: React.ReactNode[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    const limit = pages[nodes[0] ? folderOfPath(nodes[0].path) : ''] ?? PAGE
    for (const n of nodes.slice(0, limit)) {
      const pad = { paddingLeft: 8 + depth * 16 }
      if (n.kind === 'dir') {
        const isOpen = open.has(n.path)
        const home = hasFolderHome(n.path)
        const fp = folderProgress(n)
        rows.push(
          <div
            key={n.path}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isOpen}
            aria-selected={props.activePath === n.path}
            tabIndex={-1}
            className={'si ft-row' + (props.activePath === n.path ? ' on' : '')}
            style={pad}
            title={home ? '点名字开首页，点箭头展开' : n.path}
            onClick={() => (home ? props.onOpenFolder(n.path) : toggle(n.path))}
            onKeyDown={(e) => e.key === 'Enter' && (home ? props.onOpenFolder(n.path) : toggle(n.path))}
            onContextMenu={(e) => void menuAt(e, folderMenu(n.path))}
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
            <Codicon name="folder" size={16} />
            <span className="truncate">{n.name}</span>
            {/* 课程文件夹：问完了几讲 / 一共几讲；一讲都没问完不写（默认状态不加标签） */}
            {fp && fp.done > 0 && (
              <span className="ft-meta num">
                {fp.done}/{fp.total} 讲
              </span>
            )}
          </div>,
        )
        if (isOpen) walk(n.children, depth + 1)
        continue
      }
      const ghostTo = ghosts.get(n.path)
      if (ghostTo) {
        rows.push(
          <div key={'ghost:' + n.path} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row pv-ghost" style={pad} title={`挪到 ${ghostTo}`}>
            <span className="ft-tw" />
            <Codicon name="inbox" size={16} />
            <s className="truncate">{shown(n.name)}</s>
            <span className="to truncate">挪到 {fileName(folderOfPath(ghostTo))}</span>
          </div>,
        )
        continue
      }
      const realPath = real.get(n.path) ?? n.path
      const mark = pv?.preview.marks.get(n.path)
      rows.push(
        <div
          key={n.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={props.activePath === realPath}
          tabIndex={-1}
          className={'si ft-row' + (props.activePath === realPath ? ' on' : '')}
          style={pad}
          title={n.path}
          onClick={() => props.onOpen(realPath)}
          onKeyDown={(e) => e.key === 'Enter' && props.onOpen(realPath)}
          onContextMenu={(e) => onFileMenu(e, realPath, { rename: () => setRenaming(realPath) })}
        >
          <span className="ft-tw" />
          <Codicon name={fileIcon(n.path)} size={16} />
          {renaming === realPath ? (
            <RenameInput path={realPath} onDone={() => setRenaming(null)} onRename={props.onRename} />
          ) : (
            <span className="truncate">{shown(n.name)}</span>
          )}
          {mark && pv && <MovedMark m={mark} pv={pv} />}
          {n.kind === 'pdf' && (
            <span className="ft-meta">
              <Progress p={n.entry?.progress} />
            </span>
          )}
        </div>,
      )
    }
    if (nodes.length > limit) {
      const dir = folderOfPath(nodes[0]!.path)
      rows.push(
        <button key={'more:' + dir} className="si s-more ft-more" style={{ paddingLeft: 36 + depth * 16 }} onClick={() => setPages((p) => ({ ...p, [dir]: limit + PAGE }))}>
          还有 <span className="num">{nodes.length - limit}</span> 个 · 再显示 {Math.min(PAGE, nodes.length - limit)} 个
        </button>,
      )
    }
  }
  walk(tree, 0)

  return (
    <div
      className="ftree"
      role="tree"
      aria-label="全部文件"
      // 空白处右键：在库的最外层新建
      onContextMenu={(e) =>
        e.target === e.currentTarget &&
        void menuAt(e, [
          { label: '新建笔记', run: () => app().newNote('') },
          { label: '新建白板', run: () => app().newBoard('') },
        ])
      }
    >
      {rows}
      {loaded && !tree.length && <p className="s-none">库里还没有笔记、PDF 或 HTML</p>}
    </div>
  )
}
