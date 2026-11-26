/**
 * 视频的快捷键：⌥S 记下这一刻、⌥D 框一块问（设置里能改），⌥K 播放 / 暂停、⌥J / ⌥L 退 / 进 5 秒，⌥A 双语翻译（网页和字幕一起，toggleVideoTranslate）。
 * 焦点在软件界面（文档里打字也算）时这里接；焦点在网页里时主进程接住转过来（网站收不到）。只在右栏开着视频时管用。
 */
import { useEffect } from 'react'
import { FIXED_KEYS } from '../../shared/video-api'
import { pageStateOf, webHost } from '../plugins/host'
import type { TrPageState } from '../../shared/plugins/translate'
import { ID as TR_ID, setVideoPageToggle } from '../plugins/translate/shared'
import { saveMoment } from './actions'
import { startAsk } from './ask-card'
import { setVideoSettings, videoHost, videoSettingsNow, videoStateOf } from './store'
import { ipcOn } from '../crash/ipc'

type Action = 'moment' | 'ask' | 'toggle' | 'back' | 'fwd' | 'subs'

/**
 * 视频页上的双语翻译（地址栏的按钮、⌥A、⌘K「双语翻译」、翻译菜单里的开关）：开的时候翻网页（标题、简介、评论）也开双语字幕，
 * 关的时候恢复网页原文，字幕照旧（字幕自己的开关在视频那一行）。
 * 以前在视频页上这几处只开关字幕，网页一个字都不翻，字幕开着时点了反而把字幕关了（用户 2026-11-25「youtube 不能翻译」）
 */
export function toggleVideoTranslate(wcId: number) {
  const st = videoStateOf(wcId)
  if (!st) return
  // 开没开由网页那边自己定（它报回来的状态晚 80 毫秒，连按两下看这里的会错）；字幕按报回来的状态开，多开一次也无妨
  webHost()?.command(wcId, TR_ID, 'toggle')
  if (pageStateOf<TrPageState>(wcId, TR_ID)?.on) return
  const set = videoSettingsNow()
  if (st.off || set.mode === 'off') {
    if (set.mode === 'off') void setVideoSettings({ mode: 'bi' })
    void window.cnVideo.useTrack(wcId, '__on')
  }
}

export function runVideoKey(action: Action, wcId: number) {
  const h = videoHost()
  if (!h || !videoStateOf(wcId)) return
  if (action === 'moment') void saveMoment(wcId)
  else if (action === 'ask') startAsk(wcId)
  else if (action === 'toggle') h.cmd(wcId, 'toggle')
  else if (action === 'back') h.cmd(wcId, 'skip', -5)
  else if (action === 'fwd') h.cmd(wcId, 'skip', 5)
  else if (action === 'subs') toggleVideoTranslate(wcId)
}

setVideoPageToggle((wcId) => {
  if (!videoStateOf(wcId)) return false
  toggleVideoTranslate(wcId)
  return true
})

export function useVideoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.repeat) return
      const wc = videoHost()?.activeWc()
      if (wc === null || wc === undefined || !videoStateOf(wc) || !webHost()?.visible()) return
      const keys = videoSettingsNow().keys
      const code = `Alt+${e.code}`
      const action: Action | undefined = code === keys.moment ? 'moment' : code === keys.ask ? 'ask' : FIXED_KEYS[e.code]
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      runVideoKey(action, wc)
    }
    window.addEventListener('keydown', onKey, true)
    const off = ipcOn(window.cnVideo.onKey, 'cnVideo.onKey')((a, wcId) => runVideoKey(a as Action, wcId))
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  }, [])
}
