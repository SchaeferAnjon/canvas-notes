/**
 * 本机的几类假网站（「网页和视频翻译任何网站都能用」的测试用）：每类照真网站的结构写，正文都是英文。
 * - /article：普通文章，一半段落是 p，一半是 div > span（很多博客、新闻站不用 p）
 * - /spa：单页应用，正文过一会儿才由脚本画出来；点「下一篇」换路由（pushState）再画一篇
 * - /login → /members：要登录才出正文（表单提交、种 cookie、跳到会员页）
 * - /shadow：正文在自定义元素的 shadow DOM 里（还套着一层）
 * - /iframe：正文在同源 iframe 里
 * - /csp：带严格 CSP（不许内联样式），看译文的样式还在不在
 * - /zh-Hans/video/BV…：B 站结构（__INITIAL_STATE__、播放器接口给字幕列表、字幕 json）；B 站现在中文界面会跳到带 /zh-Hans/ 的地址
 * - /vimeo/76979871：Vimeo 结构（页面里一个 <video>，字幕是 <track> 挂的 VTT）；/vimeo-xo/1：VTT 在别的域名、视频没开跨域（真 Vimeo 就这样）
 * - /lecture：随便一个网站的视频页（<video> + <track>），不是任何视频站
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'

export const BILI_ID = 'BV1xx411c7mD'
export const SUB_LINES = ['Linear algebra starts with vectors.', 'A vector is an arrow in space.', 'We can add two vectors together.', 'Scaling stretches a vector.', 'Matrices transform space.', 'That is the whole idea.', 'See you next time.', 'Thanks for watching.']

/** 每类页面的正文：测试照这几句查译文 */
export const TEXT = {
  articleP: 'The museum reopened this week after a long renovation that lasted almost three years.',
  articleSpan: 'Visitors can now walk through the new glass hall that connects the two old wings.',
  spa: 'This story was rendered by the application script after the page had already loaded.',
  spa2: 'The second story appears after the route changes without reloading the whole page.',
  members: 'Only members who have signed in can read this weekly report about the market.',
  shadow: 'This paragraph lives inside a shadow root that the page script attached to a custom element.',
  shadowDeep: 'And this one sits one shadow root deeper, inside a component nested in another component.',
  iframe: 'This article body is shown inside an iframe that comes from the same site.',
  csp: 'This page forbids inline styles with a strict content security policy header.',
  biliTitle: 'The essence of linear algebra, chapter one',
  biliDesc: 'In this series we build a visual intuition for vectors, matrices and linear transformations.',
  /** 飘在画面上的弹幕：不该翻 */
  danmaku: 'Greetings from everyone watching in Wuhan tonight',
  vimeoTitle: 'A short film about building a wooden boat by hand',
  vimeoDesc: 'Two brothers spent a whole summer shaping planks and learning old techniques from their grandfather.',
  lecture: 'Watch the lecture below and read the notes while you listen to the teacher.',
}

const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}<style>body{margin:0;padding:0 16px;font:15px/1.6 -apple-system,sans-serif;background:#fff;color:#111}video{width:100%;aspect-ratio:16/9;background:#000;display:block}</style></head><body>${body}</body></html>`

function vtt(lines: string[]): string {
  const t = (s: number) => `00:00:${String(s).padStart(2, '0')}.000`
  return 'WEBVTT\n\n' + lines.map((l, i) => `${t(i * 3)} --> ${t(i * 3 + 2)}\n${l}\n`).join('\n')
}

export async function startFakeSites(): Promise<{ server: Server; base: string }> {
  const video = readFileSync(join(__dirname, 'video.webm'))
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const html = (s: string, headers: Record<string, string> = {}) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
      res.end(s)
    }
    const p = u.pathname
    if (p === '/article')
      return html(
        page(
          'Museum reopens - Daily News',
          `<header><nav><a href="/">Home</a> <a href="/world">World</a></nav></header>
          <article><h1>The museum reopens after three years</h1>
          <p>${TEXT.articleP}</p>
          <div class="post-body"><div class="para"><span>${TEXT.articleSpan.split(' ').slice(0, 6).join(' ')} </span><span>${TEXT.articleSpan.split(' ').slice(6).join(' ')}</span></div></div>
          </article>`,
        ),
      )
    if (p === '/spa' || p === '/spa/next')
      return html(
        page(
          'Reader app',
          `<div id="app"></div><script>
          const app = document.getElementById('app')
          const show = (t) => { app.innerHTML = ''; const h = document.createElement('div'); h.className = 'title'; h.textContent = t === 1 ? 'First story' : 'Second story'; const b = document.createElement('div'); b.className = 'body'; const s = document.createElement('span'); s.textContent = t === 1 ? ${JSON.stringify(TEXT.spa)} : ${JSON.stringify(TEXT.spa2)}; b.append(s); const a = document.createElement('a'); a.href = '#'; a.textContent = 'Next story'; a.id = 'next'; a.onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/spa/next'); setTimeout(() => show(2), 300) }; app.append(h, b, a) }
          setTimeout(() => show(location.pathname === '/spa/next' ? 2 : 1), 800)
          </script>`,
        ),
      )
    if (p === '/login' && req.method === 'POST') {
      res.writeHead(303, { location: '/members', 'set-cookie': 'member=1; Path=/' })
      return res.end()
    }
    if (p === '/login') return html(page('Sign in', `<form method="post" action="/login"><label>Email <input name="email" value="a@b.c"></label><button id="signin" type="submit">Sign in</button></form>`))
    if (p === '/members') {
      if (!/member=1/.test(req.headers.cookie ?? '')) {
        res.writeHead(302, { location: '/login' })
        return res.end()
      }
      return html(page('Members', `<main><h2>Weekly report</h2><div class="report"><span>${TEXT.members}</span></div></main>`))
    }
    if (p === '/shadow')
      return html(
        page(
          'Components',
          `<x-card></x-card><script>
          customElements.define('x-inner', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'open' }); const p = document.createElement('p'); p.textContent = ${JSON.stringify(TEXT.shadowDeep)}; r.append(p) } })
          customElements.define('x-card', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'open' }); const d = document.createElement('div'); d.className = 'text'; d.textContent = ${JSON.stringify(TEXT.shadow)}; r.append(d, document.createElement('x-inner')) } })
          </script>`,
        ),
      )
    if (p === '/iframe') return html(page('Embedded', `<h2>Embedded article</h2><iframe id="body" src="/iframe-body" style="width:100%;height:300px;border:0"></iframe>`))
    if (p === '/iframe-body') return html(page('Body', `<p>${TEXT.iframe}</p>`))
    if (p === '/csp') return html(page('Strict', `<main><p>${TEXT.csp}</p></main>`).replace(/<style>[\s\S]*?<\/style>/, ''), { 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'none'" })
    if (/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?video\/BV/.test(p)) {
      const state = { videoData: { bvid: BILI_ID, cid: 123456, title: TEXT.biliTitle, owner: { name: 'Uploader' }, duration: 24, pic: '', pages: [{ cid: 123456, part: 'P1', duration: 24 }] } }
      return html(
        page(
          `${TEXT.biliTitle}_哔哩哔哩_bilibili`,
          `<div class="bpx-player-container" style="position:relative"><div class="bpx-player-video-area"><video id="v" src="/video.webm" muted playsinline></video></div>
          <div class="bpx-player-render-dm-wrap" style="position:absolute;inset:0;pointer-events:none"><div class="bili-danmaku-x-dm" style="position:absolute;left:40px;top:20px;color:#fff">${TEXT.danmaku}</div></div></div>
          <div class="video-info-container"><h1 class="video-title">${TEXT.biliTitle}</h1></div>
          <div class="basic-desc-info"><span class="desc-info-text">${TEXT.biliDesc}</span></div>
          <script>window.__INITIAL_STATE__ = ${JSON.stringify(state)}
          fetch('/api.bilibili.com/x/player/wbi/v2?aid=1&cid=123456')</script>`,
        ),
      )
    }
    if (p === '/api.bilibili.com/x/player/wbi/v2') {
      res.setHeader('content-type', 'application/json')
      const base = `http://${req.headers.host}`
      return res.end(JSON.stringify({ code: 0, data: { login_mid: 0, need_login_subtitle: false, subtitle: { subtitles: [{ lan: 'en', lan_doc: 'English', subtitle_url: `${base}/bili-sub.json` }] } } }))
    }
    if (p === '/bili-sub.json') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ body: SUB_LINES.map((content, i) => ({ from: i * 3, to: i * 3 + 2.8, content })) }))
    }
    if (p === '/vimeo/76979871')
      return html(
        page(
          `${TEXT.vimeoTitle} on Vimeo`,
          `<div class="player"><video id="v" src="/video.webm" muted playsinline crossorigin="anonymous">
            <track kind="subtitles" srclang="de" label="Deutsch" src="/sub-de.vtt"><track kind="subtitles" srclang="en" label="English" src="/sub-en.vtt"></video></div>
          <h1 class="clip-title">${TEXT.vimeoTitle}</h1><div class="description"><span>${TEXT.vimeoDesc}</span></div>`,
        ),
      )
    // Vimeo 真站这样：字幕 VTT 在别的域名（captions.vimeo.com），视频没开跨域，浏览器读不进来，要照 <track> 上的地址自己取
    if (p === '/vimeo-xo/1')
      return html(
        page(
          `${TEXT.vimeoTitle} on Vimeo`,
          `<div class="player"><video id="v" src="/video.webm" muted playsinline><track kind="subtitles" srclang="en" label="English" src="http://localhost:${(server.address() as { port: number }).port}/sub-en.vtt"></video></div>
          <h1 class="clip-title">${TEXT.vimeoTitle}</h1>`,
        ),
      )
    if (p === '/lecture')
      return html(page('Lecture 3', `<h1>Lecture 3</h1><div class="note">${TEXT.lecture}</div><video id="v" src="/video.webm" muted playsinline><track kind="captions" srclang="en" label="English" src="/sub-en.vtt"></video>`))
    if (p === '/sub-en.vtt' || p === '/sub-de.vtt') {
      res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'access-control-allow-origin': '*' })
      return res.end(vtt(p === '/sub-en.vtt' ? SUB_LINES : SUB_LINES.map((l) => `DE ${l}`)))
    }
    if (p === '/video.webm') {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Number(range[2]) : video.length - 1
        res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${start}-${end}/${video.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'access-control-allow-origin': '*' })
        return res.end(video.subarray(start, end + 1))
      }
      res.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': video.length, 'access-control-allow-origin': '*' })
      return res.end(video)
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }
}
