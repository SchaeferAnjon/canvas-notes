/**
 * 拍照窗口的摄像头：先问系统要授权，列出摄像头按 iPhone / Mac 摄像头 / 桌上视角 分好，开选中的那一路。
 * 2026-11-16 在 M3 Max 上实测：系统（AVFoundation）里 iPhone 连着时有「Desk View Camera」，
 * 但 Electron 45 的 getUserMedia 只列出 FaceTime HD 和 iPhone 两路，读不到桌上视角；Mac 自带的摄像头也没有桌上视角。
 * 所以桌上视角只在真的列出来时能用，列不出来时窗口里照实说。
 */
import { useEffect, useRef, useState } from 'react'
import { cameraKind, type CameraKind } from '../../shared/mindmap'

export type CamState =
  | { kind: 'loading' }
  | { kind: 'live' }
  /** 这一种摄像头没有 */
  | { kind: 'missing' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }

const KEY = 'cn.mapCamera'

export function savedKind(): CameraKind {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'mac' || v === 'desk' || v === 'iphone' ? v : 'iphone'
  } catch {
    return 'iphone'
  }
}

export function useCamera(active: boolean) {
  const [want, setWant] = useState<CameraKind>(savedKind)
  const [devices, setDevices] = useState<Record<CameraKind, string | null>>({ iphone: null, mac: null, desk: null })
  const [state, setState] = useState<CamState>({ kind: 'loading' })
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [listed, setListed] = useState(false)

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }

  // 授权，列摄像头；插拔（iPhone 靠近、走开）时重列
  useEffect(() => {
    if (!active) return
    let alive = true
    const list = async () => {
      const st = await window.cnMap.cameraStatus()
      if (st === 'denied' || st === 'restricted') return alive && setState({ kind: 'denied' })
      if (st !== 'granted' && !(await window.cnMap.cameraAsk())) return alive && setState({ kind: 'denied' })
      let all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      // 还没开过摄像头时名字是空的：先随便开一路，名字就有了
      if (all.length && all.every((d) => !d.label)) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true })
        s.getTracks().forEach((t) => t.stop())
        all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      }
      const found: Record<CameraKind, string | null> = { iphone: null, mac: null, desk: null }
      for (const d of all) {
        const k = cameraKind(d.label)
        found[k] ??= d.deviceId
      }
      if (!alive) return
      setDevices(found)
      setListed(true)
    }
    list().catch((e: Error) => alive && setState(e.name === 'NotAllowedError' ? { kind: 'denied' } : { kind: 'error', message: e.message }))
    const onChange = () => void list().catch(() => undefined)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
    }
  }, [active])

  // 开选中的那一路
  const id = devices[want]
  useEffect(() => {
    if (!active || !listed) return
    stop()
    if (!id) {
      setState((s) => (s.kind === 'denied' ? s : { kind: 'missing' }))
      return
    }
    let alive = true
    setState({ kind: 'loading' })
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 4032 }, height: { ideal: 3024 } } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play().catch(() => undefined)
        }
        setState({ kind: 'live' })
      })
      .catch((e: Error) => alive && setState(e.name === 'NotAllowedError' ? { kind: 'denied' } : { kind: 'error', message: e.message }))
    return () => {
      alive = false
      stop()
    }
  }, [active, listed, id])

  useEffect(() => () => stop(), [])

  return {
    want,
    choose(k: CameraKind) {
      setWant(k)
      try {
        localStorage.setItem(KEY, k)
      } catch {
        // 记不住上次用的不影响拍
      }
    },
    has: devices,
    listed,
    state,
    /** 取景框里的 <video>：挂上时接上已经开着的那一路 */
    video(el: HTMLVideoElement | null) {
      video.current = el
      if (el && stream.current && el.srcObject !== stream.current) {
        el.srcObject = stream.current
        void el.play().catch(() => undefined)
      }
    },
    /** 现在这一帧的宽高比（高 / 宽） */
    aspect: () => (video.current?.videoWidth ? video.current.videoHeight / video.current.videoWidth : null),
    /** 现在这一帧，原尺寸的 JPEG */
    async snap(): Promise<Uint8Array> {
      const v = video.current
      if (!v || !v.videoWidth) throw new Error('摄像头还没有画面')
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('这一帧存不下来')
      return new Uint8Array(await blob.arrayBuffer())
    },
    stop,
  }
}
