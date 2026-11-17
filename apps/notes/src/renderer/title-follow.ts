/**
 * 第一行标题就是文件名（CN-12）：新建的笔记写了「# 冰岛旅游 3」、光标离开这一行，文件就改叫「冰岛旅游 3」。
 * 只跟「打开时标题和文件名一样」的笔记（新建的都是）；用户自己改过文件名的、标题本来就和文件名不一样的旧笔记不跟。
 * 这里只放纯计算，NoteTab 用它决定改不改名。
 */
import { titleOf } from '../shared/layout'

/** 开头的一级标题（frontmatter 后面第一行是「# 」的）：第几行（从 1 数）和标题字 */
export function headingOf(text: string): { line: number; title: string } | null {
  const lines = text.split('\n')
  let i = 0
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end === -1) return null
    i = end + 1
  }
  const m = /^# (.*)$/.exec(lines[i] ?? '')
  return m ? { line: i + 1, title: m[1]!.trim() } : null
}

/** 标题 → 文件名：/ \ : 换成「-」（别的不能用的字符主进程再换） */
export const nameFromTitle = (title: string) => title.replace(/[/\\:]/g, '-').replace(/\s+/g, ' ').trim()

/** 打开时就决定跟不跟：标题和文件名一样才跟 */
export const followsTitle = (text: string, path: string) => headingOf(text)?.title === titleOf(path)

/**
 * 新建的笔记（标题下面只有空行）在标题末尾按回车：光标直接到标题下空一行的正文处，不再多插一行。
 * 返回光标该去的位置；不是这种情况返回 null（照常换行）。
 */
export function enterAfterTitle(text: string, pos: number): number | null {
  const h = headingOf(text)
  if (!h) return null
  const lines = text.split('\n')
  const end = lines.slice(0, h.line).join('\n').length
  if (pos !== end || text.slice(end) !== '\n\n') return null
  return text.length
}

/**
 * 光标离开标题那一行时：要改成什么名字；不用改返回 null。
 * last：上次对上的标题（同名加了「 2」以后标题和文件名不一样，标题没再改就别一次次重改）。
 */
export function titleRename(text: string, path: string, last: string): string | null {
  const h = headingOf(text)
  if (!h || h.title === last) return null
  const name = nameFromTitle(h.title)
  return name && name !== titleOf(path) ? name : null
}
