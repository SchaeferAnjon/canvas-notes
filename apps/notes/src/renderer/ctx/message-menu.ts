/**
 * AI 对话里一条消息的右键（DESIGN.v3 9.2）：拷贝、拷贝为 Markdown、插进文档、存进收件箱（task-r00en 以前叫「存成卡片」）。
 * 「插进文档」和回答下面那排的按钮走同一个函数（insertAnswer：写成 AI 块，块头链回这段对话，task-eavzx）；
 * 你发的那句右键多一项「存成快捷回复」（弹一张填好的小卡，replies/SaveReply）。
 */
import { app } from './actions'
import { copy, menuAt } from './menu'
import { insertAnswer, saveToInbox } from '../answer-row'
import { t } from '../../shared/i18n'
import { type ReplyPlace } from '../../shared/replies'

/** 这条消息是谁的、在哪：AI 的回答带上谁答的、对话的键和第几条（插进文档链回去）；你发的那句带上这一处（存成快捷回复） */
export type MsgAt = { by?: string; key?: string; msg?: number } | { user: ReplyPlace }

/** 「存成快捷回复」：你发的那句、这一处、弹在哪（replies/SaveReply 听） */
export interface SaveReplyAsk {
  text: string
  place: ReplyPlace
  x: number
  y: number
}
export const SAVE_REPLY_EVENT = 'cn:save-reply'
export const askSaveReply = (d: SaveReplyAsk) => window.dispatchEvent(new CustomEvent<SaveReplyAsk>(SAVE_REPLY_EVENT, { detail: d }))

/** md：这条消息的原文（Markdown）；点着的元素是消息本身，拷贝取它显示出来的字 */
export function onMessageMenu(e: React.MouseEvent<HTMLElement>, md: string, at: MsgAt = {}) {
  if (!md.trim()) return
  const el = e.currentTarget
  const sel = window.getSelection()
  const picked = sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString() : ''
  const doc = app().doc()
  const { clientX: x, clientY: y } = e
  if ('user' in at) {
    void menuAt(e, [
      picked ? { edit: 'copy' } : { label: t('拷贝'), run: () => copy(el.innerText.trim()) },
      { label: t('拷贝为 Markdown'), run: () => copy(md) },
      '-',
      { label: t('存进收件箱'), run: () => saveToInbox(md) },
      { label: t('存成快捷回复…'), run: () => askSaveReply({ text: md.trim(), place: at.user, x, y }) },
    ])
    return
  }
  void menuAt(e, [
    picked ? { edit: 'copy' } : { label: t('拷贝'), run: () => copy(el.innerText.trim()) },
    { label: t('拷贝为 Markdown'), run: () => copy(md) },
    '-',
    { label: t('插进文档'), enabled: !!doc, run: () => void insertAnswer({ md, ...at }) },
    { label: t('存进收件箱'), run: () => saveToInbox(md) },
  ])
}
