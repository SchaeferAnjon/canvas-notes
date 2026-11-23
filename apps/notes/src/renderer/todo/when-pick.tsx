/**
 * 画布笔记里的定日子和时间的选择器（task-pd289）：挂法在 @cn/calendar 的 when-host（画布今日同一个），这里给画布笔记自己的：
 * 界面语言、今天、一周从周一排（同待办首页）。
 * 原来文档里点日子小块弹的「定日子」小菜单（task-kzr3n 的 dateMenu）扩成了它：今天 / 明天 / 下周一还在最上面。
 */
import { closeWhenHost, openWhenHost, type WhenHostOpen, whenHostKey, whenHostOpen } from '@cn/calendar'
import '@cn/calendar/calendar.css'
import { uiLang } from '../../shared/i18n'
import type { PopAnchor } from '../pop-place'
import { isoToday } from './store'

export type WhenPickOpen = Omit<WhenHostOpen, 'lang' | 'today' | 'weekStart' | 'place' | 'at'> & { at: () => PopAnchor | null }

export const whenPickOpen = whenHostOpen
export const whenPickKey = whenHostKey
export const closeWhenPick = closeWhenHost

/** 放法用 @cn/calendar 默认的 placeWhen（下面、上面都放不下时放在触发点旁边，不盖住它；设计复审） */
export function openWhenPick(o: WhenPickOpen) {
  openWhenHost({ ...o, lang: uiLang(), today: isoToday(), weekStart: 1 })
}
