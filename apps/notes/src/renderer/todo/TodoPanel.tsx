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
import { aboutToday, openTodayApp, todayCount, useToday, useTodayInstalled, useTodos } from './store'
import todayIcon from '../assets/today-icon.png'
import { QuickAdd, TodoGroups, TodoPop, useOwner } from './TodoList'
import { useT } from '../i18n'
import { catName } from '../../shared/categories'

type Seg = 'today' | 'week' | 'folder' | 'inbox'
const SEGS: Seg[] = ['today', 'week', 'folder', 'inbox']
const SEG_KEY = 'cn.todoSeg'
const FOLD_KEY = 'cn.todoFold'

function load<T>(key: string, d: T): T {
  try {
    const s = localStorage.getItem(key)
    const v = s === null ? d : (JSON.parse(s) as T)
    // 记坏了的（该是数组的不是数组，task-pyb39）当没记过
    return v !== null && Array.isArray(v) === Array.isArray(d) && typeof v === typeof d ? v : d
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
  const t = useT()
  const segName: Record<Seg, string> = { today: t('今天'), week: t('七天'), folder: t('按文件夹'), inbox: t('收件箱') }
  const { items } = useTodos()
  const today = useToday()
  const owner = useOwner()
  const installed = useTodayInstalled()
  const [seg, setSegState] = useState<Seg>(() => {
    const v = load<string>(SEG_KEY, 'folder')
    return SEGS.some((k) => k === v) ? (v as Seg) : 'folder'
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
    <aside className="side td-side" aria-label={t('待办')}>
      <ViewHead title={t('待办')} sub={<span className="num">{t('今天{n}', { n: todayCount(items, today) })}</span>}>
        {/* 头上「画布今日」那一颗（v2 原型 25b，task-kzr3n）：装了打开画布今日；没装是「了解画布今日」，开官网上下载它的那一节 */}
        {installed ? (
          <button className="td-today" aria-label={t('在画布今日里打开')} data-tip={t('在画布今日里打开')} data-side="below" onClick={openTodayApp}>
            <img src={todayIcon} width={14} height={14} alt="" />
            {t('画布今日')}
          </button>
        ) : (
          <button className="td-link td-about" onClick={aboutToday}>
            {t('了解画布今日')}
          </button>
        )}
      </ViewHead>
      <div className="td-pane">
        <div className="td-seg" role="tablist" aria-label={t('待办分组')}>
          {SEGS.map((k) => (
            <button key={k} role="tab" aria-selected={seg === k} className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>
              {segName[k]}
            </button>
          ))}
        </div>
        <QuickAdd where={{ inbox: true }} label={t('加一条')} placeholder={t('加一条，「明天下午三点交论文」')} hintWhere={catName('收件箱')} />
        <div className="td-list" role="list" aria-label={t('待办')}>
          {seg === 'folder' ? (
            groups.map((g) => {
              const col = fold.includes(g.folder)
              return (
                <section key={g.folder} className="td-fg" aria-label={g.name}>
                  <div className="td-fold">
                    <button className="td-chev" aria-label={col ? t('展开{name}', { name: g.name }) : t('收起{name}', { name: g.name })} aria-expanded={!col} onClick={() => toggle(g.folder)}>
                      <Codicon name={col ? 'chevron-right' : 'chevron-down'} size={12} />
                    </button>
                    <button className="td-fname" title={g.todo ? t('打开 {name}', { name: todoLabel(g.todo) }) : t('打开这一篇')} onClick={() => openGroup(g)}>
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
                            {t('打开 {name} ›', { name: todoLabel(g.todo) })}
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
          {seg === 'folder' && !groups.length && <p className="td-none">{t('没有没做的待办。上面加一条，或者在哪篇笔记里写一行「- [ ] 」。')}</p>}
        </div>
      </div>
      <TodoPop owner={owner} />
    </aside>
  )
}
