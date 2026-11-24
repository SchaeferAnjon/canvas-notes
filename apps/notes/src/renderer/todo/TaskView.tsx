/**
 * 放任务的笔记用任务界面打开（task-pd1d1，原型 noteView() 的 task、图 2-taskview）：名字叫「待办」的笔记默认是它，
 * 别的笔记点一次标签条右边的「任务」就记住这一篇（记在软件设置里，不往文件里加属性）。
 * 点一条的文字切回文档看法、滚到那一行闪一下（点勾选框只是勾，点行里空白处照旧开详情小卡）。
 * 大标题、一行「写作/待办.md · N条没做 · 任务界面（文件还是那几行）」、加一条（回车写进这一篇）、
 * 过期 / 今天 / 明天 / 以后 / 没定日子 分组（今天、明天、以后空着也出，当落点）、已完成收成一行。文件里还是那几行，只看不改一个字节。
 */
import { useEffect, useRef } from 'react'
import { isOpen, listed, noteName } from '../../shared/todo'
import { flashTodo, useTodos } from './store'
import { onTitleClick, QuickAdd, TodoGroups, TodoPop, useOwner } from './TodoList'
import { useT } from '../i18n'

/** onOpenLine：点一条的文字，切回文档看法、跳到那一行（第几行，1 起） */
export function TaskView(props: { path: string; onOpenLine: (line: number) => void }) {
  const t = useT()
  const { items } = useTodos()
  const owner = useOwner()
  const { path } = props
  const list = items.filter((t) => t.path === path)
  const open = list.filter((t) => isOpen(t) && listed(t)).length
  const openLine = useRef(props.onOpenLine)
  openLine.current = props.onOpenLine
  useEffect(() => {
    onTitleClick.set(owner, (t) => openLine.current(t.line + 1))
    return () => void onTitleClick.delete(owner)
  }, [owner])
  // 「打开笔记，到这一行」（详情小卡、画布今日的链接）落在任务界面：那一行亮一下
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; line: number }>).detail
      if (d?.path === path) flashTodo(`${path}#${d.line - 1}`)
    }
    window.addEventListener('cn:goto-line', f)
    return () => window.removeEventListener('cn:goto-line', f)
  }, [path])
  return (
    <div className="td-wrap" data-testid="task-view">
      <div className="td-view big">
        <h1>{noteName(path)}</h1>
        <div className="td-meta" data-testid="td-meta">{t('{path} · {n}条没做 · 任务界面（文件还是那几行）', { path, n: open })}</div>
        <QuickAdd where={{ note: path }} label={t('任务界面加一条')} placeholder={t('加一条，回车写进这一篇')} className="big" />
        <div role="list" aria-label={t('待办')}>
          <TodoGroups list={list} owner={owner} dropEmpty showDone />
        </div>
      </div>
      <TodoPop owner={owner} />
    </div>
  )
}
