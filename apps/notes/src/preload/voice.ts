import { ipcRenderer } from 'electron'
import type { CnVoiceApi, DictEvent } from '../shared/voice-api'

/** 语音输入（main/voice）：preload 暴露成 window.cnVoice */
export const voiceApi: CnVoiceApi = {
  start: (opts) => ipcRenderer.invoke('voice:start', opts),
  audio: (id, pcm) => ipcRenderer.send('voice:audio', id, pcm),
  stop: (id) => ipcRenderer.invoke('voice:stop', id),
  cancel: (id) => ipcRenderer.send('voice:cancel', id),
  onEvent(cb) {
    const h = (_e: unknown, ev: DictEvent) => cb(ev)
    ipcRenderer.on('voice:event', h)
    return () => void ipcRenderer.removeListener('voice:event', h)
  },
  openMicSettings: () => ipcRenderer.invoke('voice:mic-settings'),
}
