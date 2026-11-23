/** AI 对话里一条消息的右键（DESIGN.v3 9.2）：拷贝、拷贝为 Markdown、插进文档、存进收件箱（task-r00en 以前叫「存成卡片」） */
import { app } from './actions'
import { copy, menuAt } from './menu'
import { saveToInbox } from '../ans-acts'
import { t } from '../../shared/i18n'

/** md：这条消息的原文（Markdown）；点着的元素是消息本身，拷贝取它显示出来的字 */
export function onMessageMenu(e: React.MouseEvent<HTMLElement>, md: string) {
  if (!md.trim()) return
  const el = e.currentTarget
  const sel = window.getSelection()
  const picked = sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString() : ''
  const a = app()
  const doc = a.doc()
  void menuAt(e, [
    picked ? { edit: 'copy' } : { label: t('拷贝'), run: () => copy(el.innerText.trim()) },
    { label: t('拷贝为 Markdown'), run: () => copy(md) },
    '-',
    { label: t('插进文档'), enabled: !!doc, run: () => (doc!.insertAtCursor(md.trim()), a.notice(t('插进了文档光标处'))) },
    { label: t('存进收件箱'), run: () => saveToInbox(md) },
  ])
}
