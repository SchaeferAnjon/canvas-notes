/**
 * 跳到上课记录的某一刻（MeetCaption 联动）：
 * - MeetCaption 跳过来（canvas-notes://open?file=…&t=…、canvas-notes://meetcaption?session=…&t=…，main/meetcaption.ts 交进来）：
 *   给了 back= 先回那个文件夹首页，再开那一篇，滚到那个时间点、录音停在那一秒；
 * - 文件夹首页 MeetCaption 组件「▶ 听」：开那一篇、从头放。
 * 那一篇的录音条（ClassRecordBar）开好了才接得住：没开好时先存着，开好了自己来拿。
 */
import { useEffect } from 'react'
import { t } from '../../shared/i18n'
import type { McJumpMsg } from '../../shared/meetcaption'

export interface McSeek {
  /** 哪一场；不给是这一篇的第一场 */
  session?: string
  t: number
  /** 从这一秒开始放 */
  play?: boolean
  /** 正文滚到这个时间点那一行 */
  scroll?: boolean
}

const pending = new Map<string, McSeek>()
const takers = new Map<string, (s: McSeek) => void>()

export function seekRecord(path: string, s: McSeek) {
  const f = takers.get(path)
  if (f) f(s)
  else pending.set(path, s)
}

/** 录音条开好了：接这一篇的跳转（先拿走开好之前来的那一条） */
export function onSeek(path: string, f: (s: McSeek) => void): () => void {
  takers.set(path, f)
  const p = pending.get(path)
  if (p) {
    pending.delete(path)
    f(p)
  }
  return () => void (takers.get(path) === f && takers.delete(path))
}

/** App 里用一次：接 MeetCaption 跳过来的 */
export function useMcJumps(o: { openNote(path: string): void; openFolder(folder: string): void; notice(text: string): void }) {
  useEffect(() => {
    const go = async (j: McJumpMsg) => {
      if (j.other) return o.notice(t('这一场记在另一个库里（{vault}），先换到那个库再点一次', { vault: j.vault?.split('/').pop() ?? '' }))
      let file = j.file
      if (!file && j.session) file = (await window.cnMc.find(j.session, j.t))?.file
      if (!file) return o.notice(t('库里没找到这一场的上课记录'))
      if (j.back) o.openFolder(j.back)
      o.openNote(file)
      seekRecord(file, { ...(j.session ? { session: j.session } : {}), t: j.t ?? 0, scroll: true })
    }
    void window.cnMc.takePending().then((j) => j && go(j))
    return window.cnMc.onJump((j) => void go(j))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
