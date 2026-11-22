/**
 * AI 对话里回答下面那一排（task-83vl3）：拷贝 · 插进文档 · 引用再问（叫法同这条消息右键菜单里的「拷贝」「插进文档」）。
 * 样子同读 PDF 讲解卡下面「还是不懂 · 换个方式讲 · 做个可视化」：小号次按钮 btn-xs（24 高、Codicon 12 + 12px 字），间距 6；
 * 悬停 0.4 秒出提示（data-tip，说清做什么、插到哪；往上弹、左边和按钮对齐，不伸出右栏）。
 * 最新那条一直露着，之前的悬停那条回答（或 Tab 走到这一排）才露出来。
 * - 拷贝：整条回答的 Markdown 原文进剪贴板，按钮变「已拷贝」1.5 秒。
 * - 插进文档：中间开着的那篇，光标处（这次打开后没点进去过就接在末尾）：一个 [!ai] 提示块，块头链回这段对话（answerBlock）；
 *   焦点回到文档，光标在下面新的空段落（同剪进文档、右键「插进文档」，接着能按 Tab 写评价）。
 * - 引用再问：整条回答成为输入框顶上那一排的一块引用（来源「AI的回答」），光标进输入框接着打。
 */
import { Codicon } from '@cn/design'
import { aiBlock, calloutWords, chatLink } from '@cn/format'
import { useEffect, useState } from 'react'
import { app } from './ctx/actions'
import { copy } from './ctx/menu'
import { titleOf } from '../shared/layout'
import { withoutEffort } from '../shared/ai-features'


/**
 * 插进文档的那一块：AI 写进文档的一律是 `> [!ai]` 块（task-dtc34，和全能模式补包、/ 菜单写一段同一个 aiBlock）。
 * 块头「AI 回答 · Claude Code · Opus 5.5 · 回到 AI 对话」（回答头上的档不带，链接回到这段对话的这条回答），块里是回答原文；
 * 回答里的表格、代码块在文档里照样画（md-widgets.ts calloutWidgets）
 */
export function answerBlock(p: { md: string; by?: string; key: string; msg: number }): string {
  return aiBlock(p.md.trim(), { label: calloutWords().answer, ...(p.by ? { by: withoutEffort(p.by) } : {}), link: chatLink(p.key, p.msg) })
}

export function AnswerActs(p: { md: string; by?: string; chatKey: string; msg: number; last: boolean; onQuote(): void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const doc = app().doc()
  const where = doc ? `《${titleOf(doc.path)}》${doc.cursorPlaced ? '光标处' : '末尾'}` : ''
  return (
    <div className={'acts ans-acts' + (p.last ? ' on' : '')} data-testid="ai-ans-acts">
      <button
        className="btn btn-xs"
        data-tip="拷贝这条回答（Markdown原文）"
        data-side="above-start"
        onClick={() => {
          void copy(p.md.trim())
          setCopied(true)
        }}
      >
        <Codicon name={copied ? 'check' : 'copy'} size={12} />
        {copied ? '已拷贝' : '拷贝'}
      </button>
      <button
        className="btn btn-xs"
        aria-disabled={!doc || undefined}
        data-tip={doc ? `插到${where}\n写成 AI 块，块头链回这段对话` : '中间开着一篇文档才能插'}
        data-side="above-start"
        data-tip-class="tip-para"
        onClick={() => {
          const d = app().doc()
          if (!d) return
          d.insertAtCursor(answerBlock({ md: p.md, ...(p.by ? { by: p.by } : {}), key: p.chatKey, msg: p.msg }), { end: !d.cursorPlaced })
          app().notice(`插进了《${titleOf(d.path)}》`)
        }}
      >
        <Codicon name="insert" size={12} />
        插进文档
      </button>
      <button className="btn btn-xs" data-tip="把这条回答引进输入框，接着问" data-side="above-start" onClick={p.onQuote}>
        <Codicon name="quote" size={12} />
        引用再问
      </button>
    </div>
  )
}
