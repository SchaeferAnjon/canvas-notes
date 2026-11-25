/**
 * 「移到…」打字找的小弹层（task-4891y「加进左栏」⑦，图 /private/tmp/canvas-notes-visual/06-文件管理/4-加进左栏-浅.png）：
 * 目录树右键「移到…」、选了好几个时右键和底部「移到…」都弹它，代替系统菜单一层层套。
 * 头上一句「把「X」移到…」，下面一个框打字找（比的是整条路径），「刚挪去过」的最多 3 个排最前（打字时也筛它们），
 * 下面「全部文件夹」（打了字是「找到的」），右边灰字写在哪一层。本来就在的文件夹灰着点不了；数据库的记录文件夹、附件不列（app().allFolders() 已经去掉）；
 * 挪文件夹时它自己和它里面的不列。↑↓ 选、回车挪、esc 收起。「刚挪去过」记在本机（拖进文件夹也算）。
 * allowNew（剪藏去处、梦游去处、新建入口选文件夹时）：列表最后一行「新建文件夹…」（钉在列表下面，不跟着滚），点了就地输名字，建在当前选中的文件夹里（↑↓、打字选着的那个；
 * 没选就库的最外层），回车建好（同文件树的新建文件夹，cnFolder.make）直接当选了它。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryRank } from '../../shared/categories'
import { app } from '../ctx/actions'
import { composing } from '../ime'
import { Popover } from '../shell/Shell'
import { folderLabel, vaultName } from '../vault-name'
import { FolderGlyph } from './look'
import { useT } from '../i18n'

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
 * paths：要挪的（一篇、一个文件夹或选中的几个）；what：头上那句里的名字（选了好几个时不给）；head：不是挪东西、只挑个地方时整句换掉（新建入口「放进哪个文件夹…」）；
 * dirs：其中哪些是文件夹（它们和它们里面的不能当去处）；onPick：挑好了去哪
 */
export function MovePicker(props: { paths: string[]; what?: string; head?: string; dirs: string[]; anchor: HTMLElement; side?: 'right'; allowNew?: boolean; onPick(folder: string): void; onClose(): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [kb, setKb] = useState(0)
  /** 用键盘（↑↓）、打字选过一个：「新建文件夹…」建在它里面（指针经过不算，去点最后一行的路上会扫过别的行） */
  const [chose, setChose] = useState(false)
  /** 正在输新文件夹的名字 */
  const [making, setMaking] = useState(false)
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
  /** 新文件夹建在哪 */
  const parent = chose && cur !== undefined ? cur : ''
  const make = async (name: string) => {
    if (!name.trim()) return setMaking(false)
    try {
      const f = await window.cnFolder.make(parent, name)
      app().refresh()
      pick(f)
    } catch (e) {
      app().notice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  let lastG = ''
  return (
    <Popover anchor={props.anchor} label={t('移到')} side={props.side} onClose={props.onClose} className="movepick">
      <div className="mv-hd truncate">{props.head ?? (props.what ? t('把「{name}」移到…', { name: props.what }) : t('把选中的{n}个移到…', { n: props.paths.length }))}</div>
      <label className="mv-find">
        <Codicon name="search" size={14} />
        <input
          ref={input}
          type="search"
          aria-label={t('挪到哪个文件夹')}
          placeholder={t('挪到哪个文件夹（打字找）')}
          value={q}
          onChange={(e) => (setQ(e.target.value), setKb(0), setChose(!!e.target.value.trim()))}
          onKeyDown={(e) => {
            if (composing(e)) return
            if (e.key === 'ArrowDown') (e.preventDefault(), setChose(true), setKb((k) => Math.min(live.length - 1, k + 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setChose(true), setKb((k) => Math.max(0, k - 1)))
            if (e.key === 'Enter' && cur !== undefined) (e.preventDefault(), pick(cur))
          }}
        />
      </label>
      <div className="mv-list" role="menu" aria-label={t('文件夹')}>
        {list.map(({ f, g }) => {
          const head = g !== lastG ? <div className="mh">{g === 'r' ? t('刚挪去过') : w ? t('找到的') : t('全部文件夹')}</div> : null
          lastG = g
          const where = f ? parentOf(f) : null
          return (
            <div key={g + ':' + f} role="presentation">
              {head}
              <button
                className={'mi' + (f === cur && !making ? ' kb' : '')}
                role="menuitem"
                disabled={f === here}
                title={f === here ? t('本来就在这里') : folderLabel(f)}
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
        {!list.length && <p className="mv-none">{t('没有名字里带「{q}」的文件夹', { q: q.trim() })}</p>}
      </div>
      {props.allowNew && (
        <div className="mv-foot">
          {making ? (
            <label className="mi mv-new">
              <Codicon name="new-folder" size={14} />
              <input
                autoFocus
                aria-label={t('新文件夹的名字')}
                placeholder={t('新文件夹')}
                onBlur={(e) => !e.currentTarget.value.trim() && setMaking(false)}
                onKeyDown={(e) => {
                  if (composing(e)) return
                  e.stopPropagation()
                  if (e.key === 'Enter') (e.preventDefault(), void make(e.currentTarget.value))
                  if (e.key === 'Escape') (e.preventDefault(), setMaking(false), input.current?.focus())
                }}
              />
              <span className="r">{parent ? t('建在「{name}」里', { name: nameOf(parent) }) : t('建在最外层')}</span>
            </label>
          ) : (
            <button className="mi" role="menuitem" onClick={() => setMaking(true)}>
              <Codicon name="new-folder" size={14} />
              <span className="truncate">{t('新建文件夹…')}</span>
            </button>
          )}
        </div>
      )}
    </Popover>
  )
}
