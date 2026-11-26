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
/** 中文视频：中文人工字幕（轨标 zh-Hans） */
export const FAKE_ZH_ID = 'fakevid0003'
export const ZH_LINES = ['两国建交三十多年了', '我们见证了很多变化', '那么接下来我们看一下', '这一带的发展情况', '大家可以看到这个数字', '比去年多了一倍', '这说明了什么呢', '我们下面慢慢讲']
export const FAKE_NO_SUBS_ID = 'fakevid0002'

/** 每 3 秒一句 */
export const LINES = ['Welcome to linear transformations.', 'A matrix moves every vector.', 'Watch where i-hat lands.', 'Now watch where j-hat lands.', 'Those two landing spots are the matrix.', 'Every other vector follows along.', 'The grid lines stay parallel.', 'And the origin stays put.']

/** 和真 YouTube 一样：简介、评论的字在 yt-attributed-string 里（里面全是 span，没有 p） */
export const DESCRIPTION = 'In this lesson we look at how a matrix moves every vector of the plane, and why two landing spots decide everything.'
export const COMMENT = 'This finally made linear transformations click for me, thank you so much!'

export function json3(lines: string[] = LINES): string {
  return JSON.stringify({
    wireMagic: 'pb3',
    events: lines.map((utf8, i) => ({ tStartMs: i * 3000, dDurationMs: 2800, segs: [{ utf8 }] })),
  })
}

/**
 * 视频页。o.ad：先放这么多毫秒的广告（和真 YouTube 一样：播放器挂着 ad-showing，报的字幕轨是 0 条，广告完了才有、才自己去取默认字幕）；
 * o.noTracks：这一次播放器一条字幕轨都不报（第一次打开时网站没给），再打开一次就正常
 */
function page(id: string, o: { ad?: number; noTracks?: boolean } = {}): string {
  const tracks =
    id === FAKE_ZH_ID
      ? [{ languageCode: 'zh-Hans', name: { simpleText: '中文（简体）' } }]
      : id === FAKE_VIDEO_ID && !o.noTracks
        ? [{ languageCode: 'en', name: { simpleText: 'English' } }, { languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } }]
        : []
  const pr = { videoDetails: { videoId: id, title: id === FAKE_VIDEO_ID ? 'Linear transformations and matrices' : id === FAKE_ZH_ID ? '两国关系三十年' : 'A video without subtitles', author: '3Blue1Brown', lengthSeconds: '24' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${pr.videoDetails.title} - YouTube</title>
  <style>body{margin:0;font:14px/1.5 -apple-system,sans-serif;background:#fff;color:#0f0f0f}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#000}
  video{width:100%;height:100%;display:block}.ytp-caption-window-container{position:absolute;left:0;right:0;bottom:60px;text-align:center;color:#ff0;font-size:20px}
  ytd-comment-view-model,#author,#content-text{display:block}
  h1{font-size:18px;margin:12px 16px 4px}.ch{margin:0 16px;color:#606060}</style></head>
  <body><div id="movie_player" class="html5-video-player${o.ad ? ' ad-showing' : ''}"><video id="v" src="/video.webm" muted playsinline></video><div class="ytp-caption-window-container">SITE CAPTION</div></div>
  <h1><yt-formatted-string>${pr.videoDetails.title}</yt-formatted-string></h1><p class="ch">3Blue1Brown · 订阅者 750 万</p><p class="ch">Chapters 0:00 Intro · 0:12 Matrices</p>
  <div id="description"><yt-attributed-string><span class="ytAttributedStringHost"><span>${DESCRIPTION}</span></span></yt-attributed-string></div>
  <div id="comments"><ytd-comment-view-model><span id="author">@viewer</span><yt-attributed-string id="content-text"><span class="ytAttributedStringHost"><span>${COMMENT}</span></span></yt-attributed-string></ytd-comment-view-model></div>
  <script>
    const full = ${JSON.stringify(pr)}
    const ad = ${o.ad ?? 0}
    // 放广告时：视频说明照旧，字幕轨一条都没有
    const pr = ad ? { videoDetails: full.videoDetails, captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } } } : full
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
    let cur = pr
    mp.getPlayerResponse = () => cur
    mp.loadModule = () => {}
    mp.setOption = (mod, opt, track) => {
      if (mod !== 'captions' || opt !== 'track' || !track || mp.classList.contains('ad-showing')) return
      const q = new URLSearchParams({ v: full.videoDetails.videoId, lang: track.languageCode, fmt: 'json3' })
      if (track.kind) q.set('kind', track.kind)
      window.captionRequests.push(q.toString())
      fetch('/api/timedtext?' + q).then((r) => r.text())
    }
    // 和真 YouTube 一样：播放器一打开（放完广告）就自己取一条默认字幕（地址里带它算的校验 pot）
    const firstCaption = () => {
      if (cur.captions.playerCaptionsTracklistRenderer.captionTracks.length) fetch('/api/timedtext?' + new URLSearchParams({ v: full.videoDetails.videoId, lang: 'de', fmt: 'json3', pot: 'FAKEPOT' }))
    }
    if (ad)
      setTimeout(() => {
        mp.classList.remove('ad-showing')
        cur = full
        window.ytInitialPlayerResponse = full
        firstCaption()
      }, ad)
    else firstCaption()
  </script></body></html>`
}

/** 带 flaky=1 打开过的视频：第一次网站不给字幕轨，以后正常 */
const flakySeen = new Set<string>()

export async function startFakeVideoSite(): Promise<{ server: Server; base: string; requests: string[] }> {
  const video = readFileSync(join(__dirname, 'video.webm'))
  const requests: string[] = []
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    requests.push(u.pathname + u.search)
    if (u.pathname === '/watch') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      const id = u.searchParams.get('v') ?? FAKE_VIDEO_ID
      const noTracks = u.searchParams.get('flaky') === '1' && !flakySeen.has(id)
      if (u.searchParams.get('flaky') === '1') flakySeen.add(id)
      return res.end(page(id, { ad: Number(u.searchParams.get('ad')) || 0, noTracks }))
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
      const v = u.searchParams.get('v')
      return res.end(u.searchParams.get('pot') ? (v === FAKE_VIDEO_ID ? json3() : v === FAKE_ZH_ID ? json3(ZH_LINES) : '') : '')
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
