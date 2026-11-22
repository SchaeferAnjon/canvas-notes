/**
 * 左边图标栏「文件」下面的「待办」格（task-pd1d1，原型 todoPanel()）：头上「待办 今天 N」，今天 / 七天 / 按文件夹 / 收件箱 四种分法
 * （默认按文件夹，记在本机），加一条（进 收件箱/待办.md，认「明天下午三点交论文」），下面一组组待办。
 * 按文件夹时每个文件夹一组：点箭头收起，点名字打开这个文件夹的「待办」（没有那篇就开唯一那篇笔记或文件夹首页），组下面「打开 写作/待办 ›」。
 * 左栏只有 248 宽：每行只露勾选框、标题、日子小块，出处不露。
 */
import { Codicon } from '@cn/design'
import { diffDays } from '@cn/tasks'
import { useMemo, useState } from 'react'
import { byFolder, type FolderGroup, INBOX_TODO, type TodoItem, todoLabel } from '../../shared/todo'
import { app } from '../ctx/actions'
import { FolderGlyph } from '../files/look'
import { ViewHead } from '../shell/Shell'
import { todayCount, useToday, useTodos } from './store'
import { QuickAdd, TodoGroups, TodoPop, useOwner } from './TodoList'

type Seg = 'today' | 'week' | 'folder' | 'inbox'
const SEGS: [Seg, string][] = [
  ['today', '今天'],
  ['week', '七天'],
  ['folder', '按文件夹'],
  ['inbox', '收件箱'],
]
const SEG_KEY = 'cn.todoSeg'
const FOLD_KEY = 'cn.todoFold'

function load<T>(key: string, d: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
function keep(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // 记不住只影响下次打开
  }
}

/** 点文件夹名：有「待办」那篇开它（任务界面）；只有一篇笔记里有待办开那一篇；不然开文件夹首页 */
function openGroup(g: FolderGroup) {
  if (g.todo) return app().openFile(g.todo)
  const paths = [...new Set(g.items.map((t) => t.path))]
  if (paths.length === 1) return app().openFile(paths[0]!)
  app().openFolderHome(g.folder)
}

export function TodoPanel() {
  const { items } = useTodos()
  const today = useToday()
  const owner = useOwner()
  const [seg, setSegState] = useState<Seg>(() => {
    const v = load<string>(SEG_KEY, 'folder')
    return SEGS.some(([k]) => k === v) ? (v as Seg) : 'folder'
  })
  const setSeg = (s: Seg) => (setSegState(s), keep(SEG_KEY, s))
  const [fold, setFoldState] = useState<string[]>(() => load<string[]>(FOLD_KEY, []))
  const toggle = (f: string) => {
    const next = fold.includes(f) ? fold.filter((x) => x !== f) : [...fold, f]
    setFoldState(next)
    keep(FOLD_KEY, next)
  }
  const { keep: kept } = useTodos()
  const groups = useMemo(() => byFolder(items, new Set(items.map((t) => t.path)), kept), [items, kept])
  const list = useMemo((): TodoItem[] => {
    if (seg === 'today') return items.filter((t) => t.date !== null && t.date <= today)
    if (seg === 'week') return items.filter((t) => t.date !== null && diffDays(t.date, today) < 7)
    if (seg === 'inbox') return items.filter((t) => t.path === INBOX_TODO)
    return []
  }, [items, seg, today])
  return (
    <aside className="side td-side" aria-label="待办">
      <ViewHead title="待办" sub={<span className="num">{`今天${todayCount(items, today)}`}</span>} />
      <div className="td-pane">
        <div className="td-seg" role="tablist" aria-label="待办分组">
          {SEGS.map(([k, n]) => (
            <button key={k} role="tab" aria-selected={seg === k} className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>
              {n}
            </button>
          ))}
        </div>
        <QuickAdd where={{ inbox: true }} label="加一条" placeholder="加一条，「明天下午三点交论文」" hintWhere="收件箱" />
        <div className="td-list" role="list" aria-label="待办">
          {seg === 'folder' ? (
            groups.map((g) => {
              const col = fold.includes(g.folder)
              return (
                <section key={g.folder} className="td-fg" aria-label={g.name}>
                  <div className="td-fold">
                    <button className="td-chev" aria-label={`${col ? '展开' : '收起'}${g.name}`} aria-expanded={!col} onClick={() => toggle(g.folder)}>
                      <Codicon name={col ? 'chevron-right' : 'chevron-down'} size={12} />
                    </button>
                    <button className="td-fname" title={g.todo ? `打开 ${todoLabel(g.todo)}` : '打开这一篇'} onClick={() => openGroup(g)}>
                      <FolderGlyph folder={g.folder} size={14} mono />
                      <span className="truncate">{g.name}</span>
                    </button>
                    <span className="n num">{g.open}</span>
                  </div>
                  {!col && (
                    <>
                      <TodoGroups list={g.items} owner={owner} />
                      {g.todo && (
                        <div className="td-more">
                          <button className="td-link" onClick={() => app().openFile(g.todo!)}>
                            {`打开 ${todoLabel(g.todo)} ›`}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>
              )
            })
          ) : (
            <TodoGroups list={list} owner={owner} dropEmpty={seg !== 'today'} />
          )}
          {seg === 'folder' && !groups.length && <p className="td-none">没有没做的待办。上面加一条，或者在哪篇笔记里写一行「- [ ] 」。</p>}
        </div>
      </div>
      <TodoPop owner={owner} />
    </aside>
  )
}
