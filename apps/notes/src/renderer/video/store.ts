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
  // 主进程这边后台做完的事（生成字幕后补上了几处时刻）：中间栏底部提示一句
  window.cnVideo.onNotice((text) => center.get()?.notice(text))
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
  /** 右栏打开带时间的视频链接：开着同一个视频就切过去、跳到那一秒（still：跳过去停住，看着那一帧） */
  openAt(url: string, t: number | null, still?: boolean): void
  /** 现在右栏的网页（webContents id） */
  activeWc(): number | null
  /** 焦点交回视频网页（点完视频条上的按钮，空格还是暂停 / 播放，CN-70） */
  focus(wcId: number): void
}

let host: VideoHost | null = null
export function setVideoHost(h: VideoHost | null) {
  host = h
}
export const videoHost = () => host

// ---------------------------------------------------------------- 中间栏开着什么

/** 视频问答块上「接着问」：那一问问的什么、在哪个视频第几秒 */
export interface AskFrom {
  quote: string
  t: number
  url: string
  title: string
  /** 那一问框的那一帧（库里的路径）：接着问时附给 AI */
  image?: string
  /** 那一问 AI 的回答（块后面的 [!ai] 提示块） */
  answer?: string
}

export interface Center {
  center: CenterKind
  /** 上一篇开着的文档（中间栏开着的是字幕全文时记到它） */
  lastDoc: { path: string; title: string } | null
  doc(): NoteDoc | null
  aiOpen: boolean
  openAi(): void
  /** 右栏网页（视频）下格开 AI 追问；from：问答块上「接着问」那一问（问的话放进输入框当引文，标「00:06 · 视频名」） */
  askInRight(from?: AskFrom): void
  notice(t: string): void
  /** 记完以后刷新左栏和底栏 */
  refresh(): void
  /** 中间栏开这一篇（CN-70：没开文档时新建的那篇） */
  open(path: string): void
  /** 中间开着的这一篇改名（CN-80：「未命名」改成视频名），别处的 [[旧名]] 跟着改 */
  rename(path: string, name: string): Promise<void>
  /** 设置 › AI（填 Soniox 密钥） */
  openAiSettings(): void
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
