/**
 * 视频的快捷键：⌥S 记下这一刻、⌥D 框一块问（设置里能改），⌥K 播放 / 暂停、⌥J / ⌥L 退 / 进 5 秒，⌥A 开关字幕。
 * 焦点在软件界面（文档里打字也算）时这里接；焦点在网页里时主进程接住转过来（网站收不到）。只在右栏开着视频时管用。
 */
import { useEffect } from 'react'
import { FIXED_KEYS } from '../../shared/video-api'
import { webHost } from '../plugins/host'
import { setVideoPageToggle } from '../plugins/translate/shared'
import { saveMoment } from './actions'
import { startAsk } from './ask-card'
import { setVideoSettings, videoHost, videoSettingsNow, videoStateOf } from './store'

type Action = 'moment' | 'ask' | 'toggle' | 'back' | 'fwd' | 'subs'

/** 开关字幕：开着就关掉这个视频的，关着就按上次的样子打开 */
export function toggleSubs(wcId: number) {
  const st = videoStateOf(wcId)
  if (!st) return
  const set = videoSettingsNow()
  if (st.off || set.mode === 'off') {
    if (set.mode === 'off') void setVideoSettings({ mode: 'bi' })
    void window.cnVideo.useTrack(wcId, '__on')
  } else void window.cnVideo.useTrack(wcId, '__off')
}

export function runVideoKey(action: Action, wcId: number) {
  const h = videoHost()
  if (!h || !videoStateOf(wcId)) return
  if (action === 'moment') void saveMoment(wcId)
  else if (action === 'ask') startAsk(wcId)
  else if (action === 'toggle') h.cmd(wcId, 'toggle')
  else if (action === 'back') h.cmd(wcId, 'skip', -5)
  else if (action === 'fwd') h.cmd(wcId, 'skip', 5)
  else if (action === 'subs') toggleSubs(wcId)
}

// 地址栏的翻译按钮、⌥A 在视频页上就是开关字幕
setVideoPageToggle((wcId) => {
  if (!videoStateOf(wcId)) return false
  toggleSubs(wcId)
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
    const off = window.cnVideo.onKey((a, wcId) => runVideoKey(a as Action, wcId))
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  }, [])
}
