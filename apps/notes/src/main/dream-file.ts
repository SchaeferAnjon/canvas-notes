/**
 * 梦游的「归类和改名」挪过去以后，文件里要跟着改的地方（开头的标题、相对链接、别处的双链）。
 * 归法本身（问 AI 的话、一批批问、读回答、去处）在 shared/filing.ts，和 /整理收件箱 共用；这里只给梦游分支上的提交用。
 */
import { relativeLink, resolveLink } from '@cn/format'
import { titleOf } from '../shared/layout'

/**
 * 挪动后 md 里跟着改的：开头的一级标题是旧名就换成新名；相对链接（图片、附件）按新位置重算。
 * 别的一个字不动。
 */
export function movedText(text: string, from: string, to: string): string {
  const oldTitle = titleOf(from)
  const newTitle = titleOf(to)
  let out = text
  if (oldTitle !== newTitle) {
    const fm = /^---\n[\s\S]*?\n---\n/.exec(out)?.[0] ?? ''
    const rest = out.slice(fm.length)
    const h = new RegExp(`^(\\n*)# ${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*(\\n|$)`).exec(rest)
    if (h) out = fm + h[1] + `# ${newTitle}` + h[2] + rest.slice(h[0].length)
  }
  if (from.split('/').slice(0, -1).join('/') !== to.split('/').slice(0, -1).join('/')) {
    out = out.replace(/(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g, (all, a: string, url: string, b: string) => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return all
      const abs = resolveLink(from, url)
      return abs ? a + relativeLink(to, abs) + b : all
    })
  }
  return out
}

/** 改名后别的笔记里的 [[旧名]]、[[旧名|…]]、[[旧名#…]] 换成新名 */
export function relinkText(text: string, oldName: string, newName: string): string {
  if (oldName === newName) return text
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`\\[\\[${esc}(?=[\\]|#^])`, 'g'), `[[${newName}`)
}
