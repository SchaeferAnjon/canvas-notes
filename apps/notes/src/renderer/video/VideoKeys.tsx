/** 设置 › 快捷键里「看视频」那一组：⌥S、⌥D 能改（点一下再按一个 ⌥ 加字母的键），⌥K / ⌥J / ⌥L / ⌥A 只列出来 */
import { useEffect, useState } from 'react'
import { FIXED_KEYS, isVideoKey, keyLabel, type VideoKeys as Keys } from '../../shared/video-api'
import { setVideoSettings, useVideoSettings } from './store'

const NAMES: { id: keyof Keys; name: string }[] = [
  { id: 'moment', name: '记下这一刻' },
  { id: 'ask', name: '框一块问' },
]

export function VideoKeys() {
  const set = useVideoSettings()
  const [rec, setRec] = useState<keyof Keys | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRec(null)
      if (['Alt', 'Shift', 'Meta', 'Control'].includes(e.key)) return
      const k = `Alt+${e.code}`
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || !isVideoKey(k)) return setMsg('只能用 ⌥ 加一个字母或数字：网站自己的键都不带 ⌥，不会打架')
      if (FIXED_KEYS[e.code] || e.code === 'KeyA') return setMsg(`${keyLabel(k)} 已经是播放 / 进退 / 字幕开关的键`)
      const other = Object.entries(set.keys).find(([id, v]) => id !== rec && v === k)
      if (other) return setMsg(`${keyLabel(k)} 已经给了「${NAMES.find((n) => n.id === other[0])?.name}」`)
      setMsg('')
      setRec(null)
      void setVideoSettings({ keys: { ...set.keys, [rec]: k } })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, set.keys])
  return (
    <>
      <h4>
        看视频<span>右栏开着YouTube、B站的视频时管用，在文档里打字时也管用</span>
      </h4>
      <div className="wlist-set vkeys">
        {NAMES.map((n) => (
          <div key={n.id} className="row">
            <span>{n.name}</span>
            <span className="sp" />
            <button type="button" className={'vkey' + (rec === n.id ? ' rec' : '')} aria-label={`改「${n.name}」的快捷键`} onClick={() => (setMsg(''), setRec(rec === n.id ? null : n.id))}>
              {rec === n.id ? '按一个 ⌥ 加字母的键…' : <kbd>{keyLabel(set.keys[n.id])}</kbd>}
            </button>
          </div>
        ))}
        {(
          [
            ['播放 / 暂停', '⌥K'],
            ['退 / 进5秒', '⌥J / ⌥L'],
            ['字幕开关', '⌥A'],
          ] as const
        ).map(([name, k]) => (
          <div key={name} className="row">
            <span>{name}</span>
            <span className="sp" />
            <kbd>{k}</kbd>
          </div>
        ))}
      </div>
      <p className="note">{msg || '这几个键在文档里就打不出 ß ∂ ˚ ∆ ¬ 这些特殊字符（只在右栏开着视频时）。'}</p>
    </>
  )
}
