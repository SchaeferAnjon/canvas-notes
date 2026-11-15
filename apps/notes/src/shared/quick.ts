/** 全局速记：小窗和主进程之间的接口，preload 按这个暴露成 window.quick */

import type { SkinId } from './appearance'
import { clipMarkdown } from './layout'

/** 按下快捷键那一刻，前台软件里的东西 */
export interface QuickContext {
  /** 有辅助功能权限：能带上选中的字和来源 */
  trusted: boolean
  /** 没权限时要不要提示「允许后能带上选中的字」（用户点过「不用了」就不提示） */
  hint: boolean
  /** 前台软件里选中的字 */
  selection?: string
  /** 前台软件的名字 */
  app?: string
  /** 前台是浏览器时：网址和标题 */
  url?: string
  title?: string
  /** 主窗口现在用的主题 */
  skin?: SkinId
}

export interface QuickApi {
  /** 每次弹出时收到新的上下文 */
  onContext(cb: (ctx: QuickContext) => void): () => void
  /** 存进收件箱并提交，返回新文件路径 */
  save(text: string): Promise<string>
  close(): Promise<void>
  /** 内容高度变了，窗口跟着变 */
  resize(height: number): Promise<void>
  /** 打开系统的辅助功能授权（只在用户点按钮时调用） */
  allow(): Promise<void>
  /** 不再提示授权 */
  noHint(): Promise<void>
}

/** 速记写进收件箱的 md：自己打的字在前，选中的那段写成引文加来源 */
export function quickMarkdown(text: string, ctx: Pick<QuickContext, 'selection' | 'app' | 'url' | 'title'>): string {
  const typed = text.trim()
  const sel = ctx.selection?.trim()
  if (!sel) return typed
  let quote: string
  if (ctx.url && /^https?:\/\//.test(ctx.url)) quote = clipMarkdown(sel, ctx.title ?? '', ctx.url)
  else {
    quote = sel
      .split(/\n+/)
      .map((l) => '> ' + l.trim())
      .join('\n')
    if (ctx.app) quote += `\n—— 来自 ${ctx.app}`
  }
  return typed ? `${typed}\n\n${quote}` : quote
}
