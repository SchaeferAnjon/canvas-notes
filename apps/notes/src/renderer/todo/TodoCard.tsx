/**
 * 文件夹首页的待办卡（task-pd1d1，原型 home() 里的「待办」卡）：列这个文件夹（连子文件夹）每篇的「- [ ]」，和左边「待办」格同一份、同一套样子：
 * 过期 / 今天 / 明天 / 以后 分组和日子小块；卡比左栏宽，标题后面多露一个灰色出处（「· 小论文计划」）；已完成收成一行；
 * 底下加一条写进 <文件夹>/待办.md（没有就建）。以前存在 .首页.json 里的待办，打开首页时一次搬进 <文件夹>/待办.md（一次提交，能撤回）；
 * 撤回了的卡里留一句「首页卡里还有 N 条旧待办 · 搬进…」，点了再搬。
 */
import { useEffect, useRef } from 'react'
import type { WidgetData } from '../../shared/folder-home'
import { todoLabel, todoNoteOf } from '../../shared/todo'
import { app } from '../ctx/actions'
import { useTodos } from './store'
import { QuickAdd, TodoGroups, TodoPop, useOwner } from './TodoList'
import { useT } from '../i18n'
import { t } from '../../shared/i18n'

/** 正在搬的文件夹（首页画两次、两个标签开着同一个首页时只搬一次） */
const moving = new Set<string>()

/** 搬家：底栏说一句，带「撤回」；搬完重读首页（卡里的旧待办拿掉了） */
export async function migrateTodos(folder: string, reload: () => void, force = false) {
  if (moving.has(folder)) return
  moving.add(folder)
  try {
    const r = await window.cnTodo.migrate(folder, force)
    if (!r) return
    reload()
    app().refresh()
    const said = t('首页待办卡里的{n}条搬进了「{path}」', { n: r.moved, path: r.path })
    app().noticeUndo(r.commitError ? t('{said}；提交没成功：{err}', { said, err: r.commitError }) : said, () => {
      void window.cnTodo.unmigrate(r.undo).then((u) => {
        if (!u.ok) app().notice(u.reason === 'changed' ? t('「{path}」后来又改过，撤不回了', { path: r.path }) : t('撤不回了'))
        reload()
        app().refresh()
      })
    })
  } catch (e) {
    app().notice(t('首页待办卡里的待办没搬成：{err}', { err: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  } finally {
    moving.delete(folder)
  }
}

export function TodoCard(props: { folder: string; w: WidgetData; reload(): void }) {
  const t = useT()
  const { items } = useTodos()
  const owner = useOwner()
  const list = items.filter((t) => t.path.startsWith(props.folder + '/'))
  const legacy = props.w.todos?.length ?? 0
  const tried = useRef(false)
  // 卡里还存着旧待办、没撤回过：打开首页时搬一次
  useEffect(() => {
    if (!legacy || props.w.todosKept || tried.current) return
    tried.current = true
    void migrateTodos(props.folder, props.reload)
  }, [legacy, props.w.todosKept, props.folder])
  return (
    <div className="td-card" data-testid="todo-card" role="list" aria-label={t('待办')}>
      {list.length === 0 && !legacy && <p className="fw-empty">{t('没有待办。')}</p>}
      <TodoGroups list={list} owner={owner} src showDone limit={12} />
      {legacy > 0 && props.w.todosKept && (
        <button className="td-more td-btn td-legacy" onClick={() => void migrateTodos(props.folder, props.reload, true)}>
          {t('首页卡里还有{n}条旧待办 · 搬进「{path}」', { n: legacy, path: todoNoteOf(props.folder) })}
        </button>
      )}
      <QuickAdd where={{ folder: props.folder }} label={t('首页加一条')} placeholder={t('加一条，写进 {path}', { path: todoNoteOf(props.folder) })} className="td-qa-card" />
      <TodoPop owner={owner} />
    </div>
  )
}

/** 卡头右边「打开 ›」：开这个文件夹的「待办」（任务界面）；还没有那一篇时不出 */
export function TodoOpen(props: { folder: string }) {
  const t = useT()
  const { items } = useTodos()
  const path = todoNoteOf(props.folder)
  if (!items.some((t) => t.path === path)) return null
  return (
    <button className="td-link td-open" aria-label={t('打开 {name}', { name: todoLabel(path) })} onClick={() => app().openFile(path)}>
      {t('打开 ›')}
    </button>
  )
}
