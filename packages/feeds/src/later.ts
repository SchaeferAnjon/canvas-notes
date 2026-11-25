/**
 * 稍后读进画布今日（设计页 135「和家族联动」）：库里「收件箱/稍后读.md」一篇放待办，一篇稍后读一行
 *
 *   - [ ] 读：[提示词缓存省下的钱](canvas-feeds://item/a_1b2c…)
 *
 * 写法照 @cn/tasks（newTaskLine、setDone、appendTask，画布今日、画布笔记都认）：点「稍后读」加一行（勾过的那行改回没勾），
 * 读完（拿掉稍后读）勾上；在画布今日里勾上的，画布订阅下次看到就把那篇的稍后读拿掉。链接点了打开画布订阅的那一篇。
 * 纯函数（不碰文件、不碰系统时间），读写文件、提交在 apps/feeds 的 main/later.ts。
 */
import { appendTask, editLine, newTaskLine, scanTasks, setDone } from '@cn/tasks'

/** 放稍后读的那一篇（在收件箱里） */
export const LATER_NOTE = '稍后读.md'
/** 新建这一篇时的开头 */
export const LATER_HEAD = '# 稍后读\n\n'

const SCHEME = 'canvas-feeds://item/'

/** 打开画布订阅这一篇的链接 */
export const itemUrl = (id: string) => SCHEME + encodeURIComponent(id)

/** canvas-feeds://item/<编号> → 编号；不是就是 null */
export function itemIdOf(url: string): string | null {
  if (!url.startsWith(SCHEME)) return null
  try {
    const id = decodeURIComponent(url.slice(SCHEME.length).replace(/[/?#].*$/, ''))
    return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null
  } catch {
    return null
  }
}

/** 一篇稍后读写成的一行（标题里的方括号去掉，md 链接不断） */
export function laterLine(id: string, title: string): string {
  const t = title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim() || id
  return newTaskLine({ title: `读：[${t}](${itemUrl(id)})` })
}

const LINK = /\]\((canvas-feeds:\/\/item\/[^)\s]+)\)/

/** 这一篇里每一行稍后读：第几行、哪篇、勾了没有 */
export function laterTasks(text: string): { line: number; id: string; done: boolean }[] {
  const out: { line: number; id: string; done: boolean }[] = []
  for (const t of scanTasks(text)) {
    const m = LINK.exec(t.raw)
    const id = m ? itemIdOf(m[1]!) : null
    if (id) out.push({ line: t.line, id, done: t.task.done || t.task.cancelled })
  }
  return out
}

/** 点了「稍后读」：没有这一行就加一行；有、但勾过了的改回没勾（同一篇又想读了）；text 是 null 时新建这一篇 */
export function addLater(text: string | null, id: string, title: string, today: string): string {
  const base = text ?? LATER_HEAD
  const mine = laterTasks(base).filter((x) => x.id === id)
  if (!mine.length) return appendTask(base, laterLine(id, title)).text
  let out = base
  for (const x of mine) if (x.done) out = editLine(out, x.line, (l) => setDone(l, false, today))
  return out
}

/** 读完了（拿掉了稍后读）：这一篇的那几行勾上，带今天的 ✅ 日子 */
export function doneLater(text: string, id: string, today: string): string {
  let out = text
  for (const x of laterTasks(text)) if (x.id === id && !x.done) out = editLine(out, x.line, (l) => setDone(l, true, today))
  return out
}
