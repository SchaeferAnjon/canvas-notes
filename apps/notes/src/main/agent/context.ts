/** 每一轮发给 AI 的第一段：用户现在在看什么（当前标签、右栏网页、选中的字、@ 点名的笔记） */
import type { AgentContext } from '../../shared/agent'

export function describeContext(c: AgentContext): string {
  const lines: string[] = []
  const t = c.tab
  if (t.type === 'note') lines.push(`当前标签：${t.board || t.mode === 'board' ? '白板' : '文档'}「${t.title}」（${t.path}）${t.mode === 'board' ? '，白板看法' : ''}`)
  else if (t.type === 'folder') lines.push(`当前标签：文件夹「${t.title}」的首页（${t.path}，里面${t.count ?? 0}篇）`)
  else if (t.type === 'none') lines.push(`当前标签：${t.title || '没有打开的标签'}`)
  else lines.push(`当前标签：${t.title}`)
  lines.push(c.web.open ? `右栏网页：开着${c.web.url ? `，${c.web.url}` : '，还没打开网址'}` : '右栏网页：没开')
  if (c.selection) lines.push(`文档里选中的字：${c.selection}`)
  if (c.mentions?.length) lines.push(`用户 @ 点名的笔记：${c.mentions.join('、')}`)
  return lines.join('\n')
}
