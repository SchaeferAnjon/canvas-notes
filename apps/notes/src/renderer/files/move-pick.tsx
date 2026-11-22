/**
 * 「移到…」打字找的小弹层（task-4891y「加进左栏」⑦，图 /private/tmp/canvas-notes-visual/06-文件管理/4-加进左栏-浅.png）：
 * 目录树右键「移到…」、选了好几个时右键和底部「移到…」都弹它，代替系统菜单一层层套。
 * 头上一句「把「X」移到…」，下面一个框打字找（比的是整条路径），「刚挪去过」的最多 3 个排最前（打字时也筛它们），
 * 下面「全部文件夹」（打了字是「找到的」），右边灰字写在哪一层。本来就在的文件夹灰着点不了；数据库的记录文件夹、附件不列（app().allFolders() 已经去掉）；
 * 挪文件夹时它自己和它里面的不列。↑↓ 选、回车挪、esc 收起。「刚挪去过」记在本机（拖进文件夹也算）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryRank } from '../../shared/categories'
import { app } from '../ctx/actions'
import { composing } from '../ime'
import { Popover } from '../shell/Shell'
import { folderLabel, vaultName } from '../vault-name'
import { FolderGlyph } from './look'

const RECENT_KEY = 'cn.moveRecent'
const RECENT_MAX = 3

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** 挪进了这个文件夹（弹层里挑的、拖进去的）：排到「刚挪去过」最前 */
export function noteMovedTo(folder: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([folder, ...loadRecent().filter((f) => f !== folder)].slice(0, RECENT_MAX)))
  } catch {
    // 记不住「刚挪去过」不影响挪
  }
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p: string) => (p ? p.split('/').pop()! : vaultName())
/** 最外层按分类表的先后（收件箱、课程……），别的按名字；同一枝里按路径 */
const byPlace = (a: string, b: string) => {
  const ta = a.split('/')[0]!
  const tb = b.split('/')[0]!
  return categoryRank(ta) - categoryRank(tb) || ta.localeCompare(tb, 'zh') || a.localeCompare(b, 'zh')
}

/**
 * paths：要挪的（一篇、一个文件夹或选中的几个）；what：头上那句里的名字（选了好几个时不给）；
 * dirs：其中哪些是文件夹（它们和它们里面的不能当去处）；onPick：挑好了去哪
 */
export function MovePicker(props: { paths: string[]; what?: string; dirs: string[]; anchor: HTMLElement; side?: 'right'; onPick(folder: string): void; onClose(): void }) {
  const [q, setQ] = useState('')
  const [kb, setKb] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // 弹层先藏着量好位置才露出来（Popover），藏着时 focus 不上：等它摆好再把光标放进框里
  useEffect(() => {
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => input.current?.focus())))
    return () => cancelAnimationFrame(raf)
  }, [])
  const parents = new Set(props.paths.map(parentOf))
  /** 都在同一个文件夹里：那一个灰着 */
  const here = parents.size === 1 ? [...parents][0]! : null
  const skip = (f: string) => props.dirs.some((d) => f === d || f.startsWith(d + '/'))
  const all = useMemo(() => ['', ...app().allFolders().filter((f) => !skip(f)).sort(byPlace)], [props.paths.join('\n')])
  const w = q.trim().toLowerCase()
  const match = (f: string) => !w || (f || vaultName()).toLowerCase().includes(w)
  const recent = loadRecent().filter((f) => all.includes(f) && match(f))
  const rest = all.filter((f) => match(f) && !recent.includes(f))
  const list: { f: string; g: 'r' | 'a' }[] = [...recent.map((f) => ({ f, g: 'r' as const })), ...rest.map((f) => ({ f, g: 'a' as const }))]
  const live = list.filter((x) => x.f !== here)
  const cur = live[Math.min(kb, live.length - 1)]?.f
  const pick = (f: string) => {
    noteMovedTo(f)
    props.onClose()
    props.onPick(f)
  }
  let lastG = ''
  return (
    <Popover anchor={props.anchor} label="移到" side={props.side} onClose={props.onClose} className="movepick">
      <div className="mv-hd truncate">{props.what ? `把「${props.what}」移到…` : `把选中的${props.paths.length}个移到…`}</div>
      <label className="mv-find">
        <Codicon name="search" size={14} />
        <input
          ref={input}
          type="search"
          aria-label="挪到哪个文件夹"
          placeholder="挪到哪个文件夹（打字找）"
          value={q}
          onChange={(e) => (setQ(e.target.value), setKb(0))}
          onKeyDown={(e) => {
            if (composing(e)) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setKb((k) => Math.min(live.length - 1, k + 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setKb((k) => Math.max(0, k - 1)))
            if (e.key === 'Enter' && cur !== undefined) (e.preventDefault(), pick(cur))
          }}
        />
      </label>
      <div className="mv-list" role="menu" aria-label="文件夹">
        {list.map(({ f, g }) => {
          const head = g !== lastG ? <div className="mh">{g === 'r' ? '刚挪去过' : w ? '找到的' : '全部文件夹'}</div> : null
          lastG = g
          const where = f ? parentOf(f) : null
          return (
            <div key={g + ':' + f} role="presentation">
              {head}
              <button
                className={'mi' + (f === cur ? ' kb' : '')}
                role="menuitem"
                disabled={f === here}
                title={f === here ? '本来就在这里' : folderLabel(f)}
                onMouseMove={() => f !== here && f !== cur && setKb(live.findIndex((x) => x.f === f))}
                onClick={() => pick(f)}
              >
                {f ? <FolderGlyph folder={f} size={14} /> : <Codicon name="library" size={14} />}
                <span className="truncate">{nameOf(f)}</span>
                {where && <span className="r">{where}</span>}
              </button>
            </div>
          )
        })}
        {!list.length && <p className="mv-none">{`没有名字里带「${q.trim()}」的文件夹`}</p>}
      </div>
    </Popover>
  )
}
