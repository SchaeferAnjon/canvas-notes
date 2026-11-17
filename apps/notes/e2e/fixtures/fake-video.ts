/**
 * 本机的假视频站（端到端测试用，当成 YouTube：CN_VIDEO_TEST_ORIGIN 指过来）：
 * /watch?v=… 是一个视频页，<video> 放本机的 24 秒测试视频，播放器有 YouTube 那几个接口（getPlayerResponse、loadModule、setOption）；
 * 和真 YouTube 一样：播放器一打开自己取一条默认字幕，地址里带校验 pot；不带 pot 的请求（自己拼的、setOption 太早的）回空的。
 * 我们照播放器那条带 pot 的地址换语言去取。
 * 网站自己也画一层字幕（.ytp-caption-window-container），看我们开着时它藏没藏。
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { solidPng } from './png'

export const FAKE_VIDEO_ID = 'fakevid0001'
export const FAKE_NO_SUBS_ID = 'fakevid0002'

/** 每 3 秒一句 */
export const LINES = ['Welcome to linear transformations.', 'A matrix moves every vector.', 'Watch where i-hat lands.', 'Now watch where j-hat lands.', 'Those two landing spots are the matrix.', 'Every other vector follows along.', 'The grid lines stay parallel.', 'And the origin stays put.']

export function json3(): string {
  return JSON.stringify({
    wireMagic: 'pb3',
    events: LINES.map((utf8, i) => ({ tStartMs: i * 3000, dDurationMs: 2800, segs: [{ utf8 }] })),
  })
}

function page(id: string): string {
  const tracks = id === FAKE_VIDEO_ID ? [{ languageCode: 'en', name: { simpleText: 'English' } }, { languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } }] : []
  const pr = { videoDetails: { videoId: id, title: id === FAKE_VIDEO_ID ? 'Linear transformations and matrices' : 'A video without subtitles', author: '3Blue1Brown', lengthSeconds: '24' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${pr.videoDetails.title} - YouTube</title>
  <style>body{margin:0;font:14px/1.5 -apple-system,sans-serif;background:#fff;color:#0f0f0f}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#000}
  video{width:100%;height:100%;display:block}.ytp-caption-window-container{position:absolute;left:0;right:0;bottom:60px;text-align:center;color:#ff0;font-size:20px}
  h1{font-size:18px;margin:12px 16px 4px}.ch{margin:0 16px;color:#606060}</style></head>
  <body><div id="movie_player" class="html5-video-player"><video id="v" src="/video.webm" muted playsinline></video><div class="ytp-caption-window-container">SITE CAPTION</div></div>
  <h1>${pr.videoDetails.title}</h1><p class="ch">3Blue1Brown · 订阅者 750 万</p><p class="ch">Chapters 0:00 Intro · 0:12 Matrices</p>
  <script>
    const pr = ${JSON.stringify(pr)}
    window.ytInitialPlayerResponse = pr
    window.ytInitialData = { playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{ key: 'DESCRIPTION_CHAPTERS', value: { chapters: [{ chapterRenderer: { title: { simpleText: 'Intro' }, timeRangeStartMillis: 0 } }, { chapterRenderer: { title: { simpleText: 'Matrices' }, timeRangeStartMillis: 12000 } }] } }] } } } } } } }
    const mp = document.getElementById('movie_player')
    // 和真 YouTube 一样：焦点在网页上（不在输入框里）时空格是播放 / 暂停
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
      e.preventDefault()
      const v = document.getElementById('v')
      if (v.paused) v.play()
      else v.pause()
    })
    window.captionRequests = []
    mp.getPlayerResponse = () => pr
    mp.loadModule = () => {}
    mp.setOption = (mod, opt, track) => {
      if (mod !== 'captions' || opt !== 'track' || !track) return
      const q = new URLSearchParams({ v: pr.videoDetails.videoId, lang: track.languageCode, fmt: 'json3' })
      if (track.kind) q.set('kind', track.kind)
      window.captionRequests.push(q.toString())
      fetch('/api/timedtext?' + q).then((r) => r.text())
    }
    // 和真 YouTube 一样：播放器一打开就自己取一条默认字幕（地址里带它算的校验 pot）
    if (pr.captions.playerCaptionsTracklistRenderer.captionTracks.length) fetch('/api/timedtext?' + new URLSearchParams({ v: pr.videoDetails.videoId, lang: 'de', fmt: 'json3', pot: 'FAKEPOT' }))
  </script></body></html>`
}

export async function startFakeVideoSite(): Promise<{ server: Server; base: string; requests: string[] }> {
  const video = readFileSync(join(__dirname, 'video.webm'))
  const requests: string[] = []
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    requests.push(u.pathname + u.search)
    if (u.pathname === '/watch') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.end(page(u.searchParams.get('v') ?? FAKE_VIDEO_ID))
    }
    if (u.pathname === '/video.webm') {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Number(range[2]) : video.length - 1
        res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${start}-${end}/${video.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
        return res.end(video.subarray(start, end + 1))
      }
      res.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': video.length })
      return res.end(video)
    }
    if (u.pathname === '/api/timedtext') {
      res.setHeader('content-type', 'application/json')
      // 不带 pot 的给空的（真 YouTube 2025 年起就这样）
      return res.end(u.searchParams.get('v') === FAKE_VIDEO_ID && u.searchParams.get('pot') ? json3() : '')
    }
    if (u.pathname === '/cover.jpg') {
      res.setHeader('content-type', 'image/png')
      return res.end(solidPng(320, 180, [40, 40, 60]))
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests }
}
