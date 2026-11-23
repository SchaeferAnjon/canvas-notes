/**
 * AI 对话里回答下面那一排（task-83vl3）：拷贝 · 插进文档 · ⋯（叫法同这条消息右键菜单里的「拷贝」「插进文档」）。
 * 以前还有「引用再问」（整条回答进输入框），task-bppvn 拿掉（用户 r77：「不就是直接问么?」同一段对话 AI 本来就看得到）；
 * 要指着某一句问，在回答里选中那句，小框里「引用 ⌘↵」（side/AskBox.tsx）。
 * 样子同读 PDF 讲解卡下面「还是不懂 · 换个方式讲 · 做个可视化」：小号次按钮 btn-xs（24 高、Codicon 12 + 12px 字），间距 6；
 * 悬停 0.4 秒出提示（data-tip，说清做什么、插到哪；往上弹、左边和按钮对齐，不伸出右栏）。
 * 最新那条一直露着，之前的悬停那条回答（或 Tab 走到这一排）才露出来。
 * - 拷贝：整条回答的 Markdown 原文进剪贴板，按钮变「已拷贝」1.5 秒。
 * - 插进文档：中间开着的那篇，光标处（这次打开后没点进去过就接在末尾）：一个 [!ai] 提示块，块头链回这段对话（answerBlock）；
 *   焦点回到文档，光标在下面新的空段落（同剪进文档、右键「插进文档」，接着能按 Tab 写评价）。
 * - ⋯（task-r00en，「找不到的功能」第 7 件）：不常用的收在这里，不占主位置；里面「存进收件箱」（以前只在右键里、叫「存成卡片」，
 *   名字让人以为是 Anki 卡或白板卡）。弹层同别的 ⋯（pop12：圆角 12、内边距 6、行 30 圆角 8、图标 14 --t2）。
 */
import { Codicon } from '@cn/design'
import { aiBlock, calloutWords, chatLink } from '@cn/format'
import { useEffect, useState } from 'react'
import { app } from './ctx/actions'
import { copy } from './ctx/menu'
import { MenuItem, Popover } from './shell/Shell'
import { t } from '../shared/i18n'
import { titleOf } from '../shared/layout'
import { t as tNow } from '../shared/i18n'
import { useT } from './i18n'
import { withoutEffort } from '../shared/ai-features'


/**
 * 插进文档的那一块：AI 写进文档的一律是 `> [!ai]` 块（task-dtc34，和全能模式补包、/ 菜单写一段同一个 aiBlock）。
 * 块头「AI 回答 · Claude Code · Opus 5.5 · 回到 AI 对话」（回答头上的档不带，链接回到这段对话的这条回答），块里是回答原文；
 * 回答里的表格、代码块在文档里照样画（md-widgets.ts calloutWidgets）
 */
export function answerBlock(p: { md: string; by?: string; key: string; msg: number }): string {
  return aiBlock(p.md.trim(), { label: calloutWords().answer, ...(p.by ? { by: withoutEffort(p.by) } : {}), link: chatLink(p.key, p.msg) })
}

/** 这条回答原样存进收件箱（回答下面 ⋯ 和右键「存进收件箱」同一件事） */
export async function saveToInbox(md: string) {
  await window.cn.capture(md.trim())
  app().refresh()
  app().notice(t('存进了收件箱'), 'inbox')
}

export function AnswerActs(p: { md: string; by?: string; chatKey: string; msg: number; last: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [more, setMore] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const doc = app().doc()
  return (
    <div className={'acts ans-acts' + (p.last || more ? ' on' : '')} data-testid="ai-ans-acts">
      <button
        className="btn btn-xs"
        data-tip={t('拷贝这条回答（Markdown原文）')}
        data-side="above-start"
        onClick={() => {
          void copy(p.md.trim())
          setCopied(true)
        }}
      >
        <Codicon name={copied ? 'check' : 'copy'} size={12} />
        {copied ? t('已拷贝') : t('拷贝')}
      </button>
      <button
        className="btn btn-xs"
        aria-disabled={!doc || undefined}
        data-tip={
          !doc
            ? t('中间开着一篇文档才能插')
            : doc.cursorPlaced
              ? t('插到《{name}》光标处\n写成 AI 块，块头链回这段对话', { name: titleOf(doc.path) })
              : t('插到《{name}》末尾\n写成 AI 块，块头链回这段对话', { name: titleOf(doc.path) })
        }
        data-side="above-start"
        data-tip-class="tip-para"
        onClick={() => {
          const d = app().doc()
          if (!d) return
          d.insertAtCursor(answerBlock({ md: p.md, ...(p.by ? { by: p.by } : {}), key: p.chatKey, msg: p.msg }), { end: !d.cursorPlaced })
          app().notice(tNow('插进了《{name}》', { name: titleOf(d.path) }))
        }}
      >
        <Codicon name="insert" size={12} />
        {t('插进文档')}
      </button>
      <button
        className={'btn btn-xs ans-more' + (more ? ' on' : '')}
        aria-label={t('这条回答还能做什么')}
        aria-haspopup="menu"
        aria-expanded={!!more}
        data-tip={t('更多')}
        data-side="above-start"
        onClick={(e) => setMore(more ? null : e.currentTarget)}
      >
        <Codicon name="ellipsis" size={14} />
      </button>
      {more && (
        <Popover anchor={more} label={t('这条回答还能做什么')} className="pop12 ans-menu" align="end" onClose={() => setMore(null)}>
          <MenuItem icon="inbox" label={t('存进收件箱')} title={t('这条回答原样存成收件箱里的一篇，之后再分')} onClick={() => (setMore(null), void saveToInbox(p.md))} />
        </Popover>
      )}
    </div>
  )
}
