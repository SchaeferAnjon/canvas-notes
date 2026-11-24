/**
 * 视频那一处跟 AI 的问答记进哪（2026-11-24 方向 A，design/ai-note-switch）：「记到哪」那一篇（shared/video.ts 的 destForPick：
 * 开着的文档、白板，或收件箱新建的「<视频名>.md」）本身（偏好「剪藏和AI笔记同一篇」）；「记到哪」选了只问不记是 null。
 * 问框（ask-card.ts）和 AI 标签里接着问的（reading/store 的 noteAsk）共用。
 */
import { setProp } from '@cn/format'
import { videoOf, watchUrl } from '../../shared/video'
import { askDestNow } from './actions'
import { centerNow, videoTitleOf } from './store'

/** 现在挂在哪篇（界面显示用，不建） */
export function videoParentNow(url: string, title?: string): string | null {
  const v = videoOf(url)
  if (!v) return null
  return askDestNow({ title: title ?? videoTitleOf(url) ?? '', key: v.key })?.path ?? null
}

/** 要记了：收件箱那篇还没有时先建好（属性「视频: 网址」，不在中间打开）；返回那篇的路径 */
export async function videoParent(url: string, title: string): Promise<string | null> {
  const v = videoOf(url)
  if (!v) return null
  const d = askDestNow({ title: title || videoTitleOf(url) || '', key: v.key })
  if (!d) return null
  if (d.kind !== 'new' && d.kind !== 'inbox') return d.path
  const there = await window.cn.readNote(d.path).then(
    () => true,
    () => false,
  )
  if (there) return d.path
  // 不翻：写进文件的属性和标题
  const path = await window.cn.createNote(d.path.slice(0, d.path.lastIndexOf('/')), d.title, `${setProp('', '视频', watchUrl(v))}\n# ${d.title}\n`)
  centerNow()?.refresh()
  return path
}
