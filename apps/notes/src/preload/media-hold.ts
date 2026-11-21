/**
 * 重开软件时恢复的网页标签：视频不自己播（task-0t4jq，主进程那边 main/web/media-hold.ts）。
 * 浏览器只拦出声的自动播；静音的、网站自己静音起播的这里停下。用户在这一页点过、按过键之后不管。
 * 软件要视频播（⌥K、点时刻跳回那一秒）走 playNow：先让主进程算一次用户动作，浏览器才许它播。
 */
import { ipcRenderer } from 'electron'

/** 这一页还拦着（网页脚本跑之前就要知道） */
const held = /^https?:$/.test(location.protocol) && ipcRenderer.sendSync('web:media-held') === true

if (held)
  addEventListener(
    'play',
    (e) => {
      if (navigator.userActivation.hasBeenActive) return
      if (e.target instanceof HTMLMediaElement) e.target.pause()
    },
    true,
  )

/** 软件要这个视频播 */
export async function playNow(v: HTMLMediaElement) {
  if (held && !navigator.userActivation.hasBeenActive) await ipcRenderer.invoke('web:media-release')
  try {
    await v.play()
  } catch (e) {
    // 恢复的标签用户还没碰过：浏览器不许没有用户动作的播放，算一次用户动作再播
    if ((e as DOMException).name !== 'NotAllowedError') return
    await ipcRenderer.invoke('web:media-release')
    await v.play().catch(() => undefined)
  }
}
