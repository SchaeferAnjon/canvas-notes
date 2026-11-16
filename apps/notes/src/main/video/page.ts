/**
 * 在视频网页里（网页自己的环境，播放器的接口在那里）跑的几段小脚本：读视频的说明和字幕列表、让播放器去取某条字幕、截一帧。
 * 都包在 try 里、只读不写网站的数据；拿不到就给 null。
 */
import type { WebContents } from 'electron'

export interface YtInfo {
  videoId: string
  title: string
  author: string
  length: number
  tracks: { languageCode?: string; kind?: string; name?: { simpleText?: string; runs?: { text?: string }[] } }[]
  chapters: { start: number; title: string }[]
  ad: boolean
}

export interface BiliInfo {
  bvid: string
  cid: number
  title: string
  owner: string
  duration: number
  pic: string
}

const run = <T>(wc: WebContents, code: string): Promise<T | null> =>
  wc.isDestroyed() ? Promise.resolve(null) : (wc.executeJavaScript(`(() => { try { ${code} } catch (e) { return null } })()`, false) as Promise<T | null>).catch(() => null)

export const ytInfo = (wc: WebContents) =>
  run<YtInfo>(
    wc,
    `const p = document.getElementById('movie_player')
    const pr = (p && p.getPlayerResponse && p.getPlayerResponse()) || window.ytInitialPlayerResponse
    if (!pr || !pr.videoDetails) return null
    let chapters = []
    try {
      const mm = window.ytInitialData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap
      const ch = (mm.find((m) => m.key === 'DESCRIPTION_CHAPTERS') || mm[0]).value.chapters
      chapters = ch.map((c) => ({ start: c.chapterRenderer.timeRangeStartMillis / 1000, title: c.chapterRenderer.title.simpleText }))
    } catch (e) {}
    return {
      videoId: pr.videoDetails.videoId,
      title: pr.videoDetails.title,
      author: pr.videoDetails.author,
      length: Number(pr.videoDetails.lengthSeconds) || 0,
      tracks: ((pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || []).map((t) => ({ languageCode: t.languageCode, kind: t.kind, name: t.name })),
      chapters,
      ad: !!document.querySelector('#movie_player.ad-showing'),
    }`,
  )

/** 让 YouTube 播放器去取这条字幕（我们从它的请求里读）；在放广告时不动 */
export const ytLoadTrack = (wc: WebContents, lang: string, auto: boolean) =>
  run<boolean>(
    wc,
    `const p = document.getElementById('movie_player')
    if (!p || !p.setOption || document.querySelector('#movie_player.ad-showing')) return false
    p.loadModule && p.loadModule('captions')
    p.setOption('captions', 'track', ${JSON.stringify(auto ? { languageCode: lang, kind: 'asr' } : { languageCode: lang })})
    return true`,
  )

export const biliInfo = (wc: WebContents, p: number) =>
  run<BiliInfo>(
    wc,
    `const s = window.__INITIAL_STATE__
    const v = s && s.videoData
    if (!v) return null
    const page = (v.pages || [])[${p} - 1]
    return { bvid: v.bvid, cid: (page && page.cid) || v.cid, title: v.title + (page && v.pages.length > 1 ? ' P${p} ' + page.part : ''), owner: (v.owner && v.owner.name) || '', duration: (page && page.duration) || v.duration || 0, pic: v.pic || '' }`,
  )

/** 现在播到哪 */
export const currentTime = (wc: WebContents) => run<number>(wc, `const v = document.querySelector('video'); return v ? v.currentTime : null`)

/** 截一帧：视频原始分辨率缩到长边 1280，JPEG 0.82；box 给了就在图上画一个框（问 AI 的那块） */
export const grabFrame = (wc: WebContents, box: { x: number; y: number; w: number; h: number } | null) =>
  run<{ data: string; t: number; w: number; h: number } | { error: string }>(
    wc,
    `const vs = [...document.querySelectorAll('video')].filter((v) => v.videoWidth)
    const v = vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    if (!v) return { error: '网页里没有正在放的视频' }
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * k)
    c.height = Math.round(v.videoHeight * k)
    const g = c.getContext('2d')
    g.drawImage(v, 0, 0, c.width, c.height)
    const box = ${JSON.stringify(box)}
    if (box) {
      g.strokeStyle = '#9A48AD'
      g.lineWidth = Math.max(3, c.width / 320)
      g.strokeRect(box.x * c.width, box.y * c.height, box.w * c.width, box.h * c.height)
    }
    try {
      return { data: c.toDataURL('image/jpeg', 0.82), t: v.currentTime, w: c.width, h: c.height }
    } catch (e) {
      return { error: 'tainted' }
    }`,
  )

/** 视频在网页里的位置（画布被污染时用 capturePage 截屏幕上那一块） */
export const videoRect = (wc: WebContents) =>
  run<{ x: number; y: number; width: number; height: number; t: number }>(
    wc,
    `const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    if (!v) return null
    const r = v.getBoundingClientRect()
    return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(r.width), height: Math.round(r.height), t: v.currentTime }`,
  )
