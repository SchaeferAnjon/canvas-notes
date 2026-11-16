/**
 * 界面这边看视频共用的：每个网页上的视频（主进程推来）、播到哪（网页预加载每 250 毫秒报一次）、视频设置，
 * 右栏网页面板借来的本事（给网页发命令、在右栏打开网址），中间栏开着什么（记到哪要用）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { type CenterKind, setVideoTestOrigin } from '../../shared/video'
import { DEFAULT_VIDEO_SETTINGS, type PlayTick, type VideoSettings, type VideoState } from '../../shared/video-api'
import type { NoteDoc } from '../note-doc'

// 端到端测试时本机的假视频站当成 YouTube
setVideoTestOrigin(window.cnVideo?.testOrigin ?? null)

function bus<T>(initial: T) {
  let v = initial
  const subs = new Set<() => void>()
  return {
    get: () => v,
    set(next: T) {
      v = next
      subs.forEach((f) => f())
    },
    sub(f: () => void) {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
  }
}

// ---------------------------------------------------------------- 主进程推来的

const states = bus(new Map<number, VideoState>())
const settings = bus<VideoSettings>(DEFAULT_VIDEO_SETTINGS)
let started = false

function start() {
  if (started || !window.cnVideo) return
  started = true
  window.cnVideo.onState((wcId, st) => {
    const m = new Map(states.get())
    if (st) m.set(wcId, st)
    else m.delete(wcId)
    states.set(m)
  })
  void window.cnVideo.settings().then(settings.set)
  window.cnVideo.onSettings(settings.set)
}

export function useVideoState(wcId: number | undefined): VideoState | null {
  useEffect(start, [])
  // 网页刚挂上时主进程可能已经推过了：要一次
  useEffect(() => {
    if (wcId === undefined || states.get().has(wcId) || !window.cnVideo) return
    void window.cnVideo.state(wcId).then((st) => {
      if (!st) return
      const m = new Map(states.get())
      m.set(wcId, st)
      states.set(m)
    })
  }, [wcId])
  const all = useSyncExternalStore(states.sub, states.get)
  return wcId === undefined ? null : (all.get(wcId) ?? null)
}

export const videoStateOf = (wcId: number) => states.get().get(wcId) ?? null

export function useVideoSettings(): VideoSettings {
  useEffect(start, [])
  return useSyncExternalStore(settings.sub, settings.get)
}

export const videoSettingsNow = () => settings.get()

export async function setVideoSettings(patch: Partial<VideoSettings>) {
  settings.set(await window.cnVideo.setSettings(patch))
}

// ---------------------------------------------------------------- 网页报来的

const ticks = bus(new Map<number, PlayTick>())
type BoxEvent = { wcId: number; box: { x: number; y: number; w: number; h: number }; rect: { x: number; y: number; w: number; h: number } } | { wcId: number; cancel: true }
const boxes = bus<BoxEvent | null>(null)

/** WebView 收到网页预加载的 'cn:video' 时调 */
export function videoReported(wcId: number, payload: unknown) {
  const p = payload as { type?: string } & Record<string, unknown>
  if (p?.type === 'tick') {
    const m = new Map(ticks.get())
    m.set(wcId, { t: Number(p.t) || 0, duration: Number(p.duration) || 0, paused: !!p.paused, rect: (p.rect as PlayTick['rect']) ?? null })
    ticks.set(m)
  } else if (p?.type === 'box') boxes.set({ wcId, box: p.box as { x: number; y: number; w: number; h: number }, rect: p.rect as { x: number; y: number; w: number; h: number } })
  else if (p?.type === 'boxCancel') boxes.set({ wcId, cancel: true })
}

export function useTick(wcId: number | undefined): PlayTick | null {
  const all = useSyncExternalStore(ticks.sub, ticks.get)
  return wcId === undefined ? null : (all.get(wcId) ?? null)
}

export const tickOf = (wcId: number) => ticks.get().get(wcId) ?? null

export function useBoxEvent(): BoxEvent | null {
  return useSyncExternalStore(boxes.sub, boxes.get)
}
export const clearBox = () => boxes.set(null)

// ---------------------------------------------------------------- 右栏网页面板借来的

export interface VideoHost {
  /** 给网页发命令（preload/video.ts 收） */
  cmd(wcId: number, cmd: string, arg?: unknown): void
  /** 网页元素在窗口里的位置（问话框贴着视频） */
  webviewRect(wcId: number): DOMRect | null
  /** 右栏打开带时间的视频链接：开着同一个视频就切过去、跳到那一秒 */
  openAt(url: string, t: number | null): void
  /** 现在右栏的网页（webContents id） */
  activeWc(): number | null
}

let host: VideoHost | null = null
export function setVideoHost(h: VideoHost | null) {
  host = h
}
export const videoHost = () => host

// ---------------------------------------------------------------- 中间栏开着什么

export interface Center {
  center: CenterKind
  /** 上一篇开着的文档（中间栏开着的是字幕全文时记到它） */
  lastDoc: { path: string; title: string } | null
  doc(): NoteDoc | null
  aiOpen: boolean
  openAi(): void
  notice(t: string): void
  /** 记完以后刷新左栏和底栏 */
  refresh(): void
}

const center = bus<Center | null>(null)
export const setCenter = (c: Center) => center.set(c)
export const centerNow = () => center.get()
export function useCenter(): Center | null {
  return useSyncExternalStore(center.sub, center.get)
}

// ---------------------------------------------------------------- 记好以后底部那条提示（带撤回）

export interface SavedToast {
  seq: number
  text: string
  hash: string | null
  mark: { wcId: number; t: number }
  undone?: boolean
}
const toast = bus<SavedToast | null>(null)
let toastSeq = 0
export function showSaved(t: Omit<SavedToast, 'seq'>) {
  toast.set({ ...t, seq: ++toastSeq })
}
export const setToast = (t: SavedToast | null) => toast.set(t)
export function useSavedToast(): SavedToast | null {
  return useSyncExternalStore(toast.sub, toast.get)
}

/** 每秒刷新一下（弹层里「刚刚」之类） */
export function useNow(ms = 1000) {
  const [n, set] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}
