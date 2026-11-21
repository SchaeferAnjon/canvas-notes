/** 每一轮发给 AI 的第一段：用户现在在看什么（当前标签、右栏网页、选中的字、@ 点名的笔记） */
import type { AgentContext } from '../../shared/agent'

/** 左栏选中的交给 AI 时最多列几篇 */
const PICK_LIST = 200

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
  // 左栏选了好几个交给 AI（task-0tgz2）：很多时只列前 200 篇，写一共几篇
  if (c.picked?.files.length) {
    const fs = c.picked.files
    const more = fs.length > PICK_LIST ? `（只列前${PICK_LIST}篇）` : ''
    lines.push(`用户在左栏选中了${c.picked.count}个（文件夹算里面的笔记），一共${fs.length}篇，问的「选中的这几篇」就是它们${more}：${fs.slice(0, PICK_LIST).join('、')}`)
  }
  return lines.join('\n')
}
