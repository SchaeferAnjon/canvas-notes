/**
 * 存在本机、不进库的：视频的设置，每个视频上次看到哪一秒、选的哪条字幕、记过的时刻（刻度上画的），视频卡要的说明。
 * <userData>/video/state.json；写盘攒半秒一次。不碰 Electron，能单独测。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type MomentMark, normalizeVideoSettings, type VideoSettings } from '../../shared/video-api'
import { logDropped } from '../crash-log'

export interface VideoRecord {
  pos: number
  track: string | null
  title: string
  channel: string
  duration: number
  cover?: string
  moments: MomentMark[]
  material?: string
  /** 记录更新的时间，太多时先丢旧的 */
  at: number
}

interface State {
  settings: VideoSettings
  videos: Record<string, VideoRecord>
}

/** 最多记这么多个视频（多的丢最久没看的） */
const MAX_VIDEOS = 2000

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * 每个视频的记录对上格式（task-pyb39）：看到哪一秒、时刻不是数字的、时刻不是数组的，补成能用的；整条不是对象的丢掉并记一行日志。
 * 这些记录打开视频时直接给界面画刻度、时刻列表，坏一条不能让界面渲染抛错
 */
function validVideos(v: unknown): Record<string, VideoRecord> {
  if (v === undefined) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    logDropped('video', '视频记录不是对象')
    return {}
  }
  const out: Record<string, VideoRecord> = {}
  let bad = 0
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    if (!r || typeof r !== 'object') {
      bad++
      continue
    }
    const o = r as Record<string, unknown>
    const moments = Array.isArray(o.moments) ? o.moments.filter((m): m is MomentMark => !!m && typeof m === 'object' && num((m as MomentMark).t, NaN) >= 0 && typeof (m as MomentMark).note === 'string') : []
    if (Array.isArray(o.moments) && moments.length !== o.moments.length) bad++
    out[k] = {
      ...(o as unknown as VideoRecord),
      pos: num(o.pos),
      track: typeof o.track === 'string' ? o.track : null,
      title: text(o.title),
      channel: text(o.channel),
      duration: num(o.duration),
      moments,
      at: num(o.at),
    }
  }
  if (bad) logDropped('video', `${bad} 个视频记录有坏的地方，丢掉了坏的那部分`)
  return out
}

export class VideoStore {
  private s: State
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private file: string) {
    let raw: Partial<State> = {}
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[video] 本机记录读不出来，重新记', (e as Error).message)
    }
    this.s = { settings: normalizeVideoSettings(raw?.settings), videos: validVideos(raw?.videos) }
  }

  settings(): VideoSettings {
    return this.s.settings
  }

  setSettings(patch: Partial<VideoSettings>): VideoSettings {
    this.s.settings = normalizeVideoSettings({ ...this.s.settings, ...patch, keys: { ...this.s.settings.keys, ...(patch.keys ?? {}) } })
    this.save()
    return this.s.settings
  }

  get(key: string): VideoRecord | undefined {
    return this.s.videos[key]
  }

  update(key: string, patch: Partial<VideoRecord>): VideoRecord {
    const cur: VideoRecord = this.s.videos[key] ?? { pos: 0, track: null, title: '', channel: '', duration: 0, moments: [], at: 0 }
    const next = { ...cur, ...patch, at: Date.now() }
    this.s.videos[key] = next
    const keys = Object.keys(this.s.videos)
    if (keys.length > MAX_VIDEOS) {
      keys.sort((a, b) => this.s.videos[a]!.at - this.s.videos[b]!.at)
      for (const k of keys.slice(0, keys.length - MAX_VIDEOS)) delete this.s.videos[k]
    }
    this.save()
    return next
  }

  addMoment(key: string, m: MomentMark) {
    const cur = this.get(key)?.moments ?? []
    this.update(key, { moments: [...cur.filter((x) => Math.abs(x.t - m.t) > 0.05 || x.note !== m.note), m].sort((a, b) => a.t - b.t) })
  }

  removeMoment(key: string, t: number) {
    const cur = this.get(key)?.moments ?? []
    this.update(key, { moments: cur.filter((x) => Math.abs(x.t - t) > 0.05) })
  }

  private save() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(this.s))
    renameSync(this.file + '.tmp', this.file)
  }
}
