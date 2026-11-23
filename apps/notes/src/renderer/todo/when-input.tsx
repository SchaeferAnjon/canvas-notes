/**
 * 待办三处的写时间（task-pd289）：
 * - 一行待办点日子小块、详情小卡里「…」、选着一条按「定日子」的键：pickWhenFor，选择器改什么写进那一行（主进程 todo:edit 的 when，一次一次排着写），
 *   关上时底栏说一句改成了什么，带「撤回」（这一回的几次一起撤）。
 * - 加一条的输入框（左栏「待办」格、待办首页）：useWhenInput（做法在 @cn/calendar，画布今日同一个）。打 @（开头或空格后面）、
 *   按「定日子」的键弹选择器，选的换成一句认得回来的话插进输入框；停手 0.6 秒本地认不出、看着有时间词的问 AI（when-assist.ts 的 askAi），
 *   下面那一行写 AI 认出来的，回车照它加。
 */
import { useWhenInput as useCalWhenInput, type WhenInput } from '@cn/calendar'
import type { WhenFields } from '@cn/tasks'
import type { RefObject } from 'react'
import { uiLang } from '../../shared/i18n'
import type { TodoItem } from '../../shared/todo'
import { isKey } from '../keys'
import { anchorOf } from '../pop-place'
import { nowLocal, sayWhen, scheduleTodo } from './store'
import { askAi } from './when-assist'
import { openWhenPick } from './when-pick'

/** 一条待办开选择器：贴着 el（日子小块、那一行；在详情小卡里的贴着整张小卡，不盖住它）；keys：按键开的，底下写键怎么用 */
export function pickWhenFor(t: TodoItem, el: HTMLElement, keys = false) {
  let cur: Pick<TodoItem, 'path' | 'line' | 'raw' | 'title'> = t
  let last: WhenFields = { date: t.date, time: t.time, remind: t.remind, repeat: t.repeat }
  const undos: string[] = []
  // 一次一次排着写：下一次用上一次写完以后那一行的原文去认
  let queue: Promise<unknown> = Promise.resolve()
  openWhenPick({
    align: 'end',
    keysHint: keys,
    at: () => (el.isConnected ? anchorOf(el.closest<HTMLElement>('.td-pop') ?? el) : null),
    value: last,
    onChange: (next) => {
      last = next
      queue = queue.then(async () => {
        const r = await scheduleTodo(cur, next)
        if (!r) return
        cur = { ...cur, line: r.line, raw: r.raw }
        undos.push(r.undo)
      })
      return next
    },
    onClose: () => void queue.then(() => sayWhen(t.title, last, undos)),
  })
}

/** 加一条的输入框：value、setValue 是输入框自己的；ref 是输入框（选择器贴着它）。做法在 @cn/calendar 的 useWhenInput（画布今日同一个） */
export function useWhenInput(value: string, setValue: (v: string) => void, ref: RefObject<HTMLInputElement | null>): WhenInput {
  return useCalWhenInput(value, setValue, ref, {
    lang: uiLang(),
    now: nowLocal,
    ask: askAi,
    isPickKey: (e) => isKey(e, 'todo-when'),
    weekStart: 1,
    anchor: (el) => anchorOf(el),
  })
}
