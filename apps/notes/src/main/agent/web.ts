/**
 * AI 操纵右栏网页：主进程拿着 <webview> 的 webContents，读字、点、输入、滚动。
 * 点和输入用真的鼠标键盘事件（sendInputEvent / insertText），网页分不出是人还是 AI。
 */
import type { WebContents } from 'electron'
import type { EngineId } from '../../shared/agent'
import { logoHtml } from '../../shared/engine-logo-html'
import type { WebPage } from './tools'

let current: WebContents | null = null
const loadedAt = new WeakMap<WebContents, number>()

/** index.ts 里 did-attach-webview 时调：右栏网页现在是这个 */
export function attachWeb(wc: WebContents) {
  current = wc
  loadedAt.set(wc, 0)
  wc.on('did-stop-loading', () => loadedAt.set(wc, Date.now()))
  wc.on('did-fail-load', () => loadedAt.set(wc, Date.now()))
  wc.once('destroyed', () => {
    if (current === wc) current = null
  })
}

/** 右栏有好几个网页标签：用户切到哪个，AI 就操纵哪个（web/index.ts 调） */
export function setActiveWeb(wc: WebContents) {
  if (loadedAt.has(wc)) current = wc
}

export function webContents(): WebContents | null {
  return current && !current.isDestroyed() ? current : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 等右栏网页在 since 之后载入完（新开的面板要先等 webview 挂上） */
export async function waitLoaded(since: number, timeoutMs = 20_000): Promise<WebContents> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const wc = webContents()
    if (wc && (loadedAt.get(wc) ?? 0) >= since && !wc.isLoading()) return wc
    await sleep(100)
  }
  throw new Error('网页 20 秒还没打开，可能网络不通')
}

function need(): WebContents {
  const wc = webContents()
  if (!wc) throw new Error('右栏网页没开。先用 web_open 打开一个网址。')
  return wc
}

/** 给能点的东西编上号（data-cn-ref），web_click / web_type 按号找 */
const READ = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  document.querySelectorAll('[data-cn-ref]').forEach((el) => el.removeAttribute('data-cn-ref'))
  const items = []
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [contenteditable=true]')) {
    if (items.length >= 200 || !vis(el)) continue
    const ref = items.length + 1
    el.setAttribute('data-cn-ref', String(ref))
    const tag = el.tagName
    const kind = tag === 'A' || el.getAttribute('role') === 'link' ? 'link' : tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio)$/i.test(el.type) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable ? 'input' : 'button'
    items.push({ ref, kind, text: label(el), href: tag === 'A' ? el.href : undefined })
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim()
  return { url: location.href, title: document.title, text: text.length > 12000 ? text.slice(0, 12000) + '\\n…（后面还有，往下滚再读）' : text, items, selection: String(getSelection() || '').trim().slice(0, 4000) }
})()`

export async function readPage(): Promise<WebPage> {
  return (await need().executeJavaScript(READ, true)) as WebPage
}

/** 找到元素、滚进视野，返回它中心点在网页里的坐标 */
function locate(target: { ref?: number; text?: string }): string {
  return `(() => {
    const t = ${JSON.stringify(target)}
    let el = t.ref ? document.querySelector('[data-cn-ref="' + t.ref + '"]') : null
    if (!el && t.text) {
      const want = t.text.trim().toLowerCase()
      const all = [...document.querySelectorAll('a, button, input[type=submit], input[type=button], [role=button], [role=link], summary, label')]
      const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase()
      el = all.find((e) => txt(e) === want) || all.find((e) => txt(e).includes(want))
    }
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) }
  })()`
}

export async function click(target: { ref?: number; text?: string }): Promise<string> {
  const wc = need()
  const at = (await wc.executeJavaScript(locate(target), true)) as { x: number; y: number; label: string } | null
  if (!at) throw new Error('网页上没找到这个链接或按钮。先 web_read 看一下现在有什么。')
  const before = Date.now()
  wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
  wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  // 点了可能会跳页：等一会儿，跳了就等它载完
  await sleep(400)
  if (wc.isLoading()) await waitLoaded(before, 15_000).catch(() => undefined)
  return `点了「${at.label}」。现在是：${wc.getTitle()}\n${wc.getURL()}`
}

export async function type(ref: number, text: string, submit: boolean): Promise<string> {
  const wc = need()
  const ok = (await wc.executeJavaScript(
    `(() => { const el = document.querySelector('[data-cn-ref="${Number(ref)}"]'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if (el.select) el.select(); else document.execCommand('selectAll'); return true })()`,
    true,
  )) as boolean
  if (!ok) throw new Error('没找到这个输入框。先 web_read 拿到编号。')
  if (text) wc.insertText(text)
  else wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
  if (submit) {
    const before = Date.now()
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    wc.sendInputEvent({ type: 'char', keyCode: '\r' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await sleep(400)
    if (wc.isLoading()) await waitLoaded(before, 15_000).catch(() => undefined)
  }
  return submit ? `输入好了，按了回车。现在是：${wc.getTitle()}\n${wc.getURL()}` : '输入好了'
}

export async function scroll(to: 'down' | 'up' | 'top' | 'bottom'): Promise<string> {
  const code = {
    down: 'scrollBy(0, innerHeight * 0.85)',
    up: 'scrollBy(0, -innerHeight * 0.85)',
    top: 'scrollTo(0, 0)',
    bottom: 'scrollTo(0, document.documentElement.scrollHeight)',
  }[to]
  const r = (await need().executeJavaScript(`(() => { ${code}; return [Math.round(scrollY), document.documentElement.scrollHeight - innerHeight] })()`, true)) as [number, number]
  return `滚到了 ${r[0]} / ${Math.max(0, r[1])}`
}

// ---------- AI 动手看得见（DESIGN.v3 2.3）：网页里「AI」小指针、正在选的那段亮一下、剪下的段落标「✂ 剪成卡片」 ----------

/** 软件的强调色（跟着主题，界面量好交过来）：指针、亮的那一圈、剪下的竖线都用它 */
export interface AccentColors {
  acc: string
  accBg: string
  /** 强调色底上的字色（深色主题的强调色是浅的，字是深的） */
  accOn: string
  ring: string
}

/** 网页里画这些用的样式和指针：只在第一次用时加一次，样式写在网页自己的 <head> 里，名字都带 cn-ai 不和网站打架 */
const SETUP = (c: AccentColors, engine: EngineId) => `(() => {
  const c = ${JSON.stringify(c)}
  const logo = ${JSON.stringify(logoHtml(engine))}
  let st = document.getElementById('cn-ai-style')
  if (!st) { st = document.createElement('style'); st.id = 'cn-ai-style'; (document.head || document.documentElement).appendChild(st) }
  st.textContent = \`
    [data-cn-ai-hit]{box-shadow:0 0 0 2px \${c.ring}!important;background:color-mix(in srgb,\${c.acc} 8%,transparent)!important;border-radius:4px!important;transition:box-shadow .25s,background .25s}
    [data-cn-ai-clip]{position:relative!important}
    [data-cn-ai-clip]::before{content:'';position:absolute;left:-9px;top:2px;bottom:2px;width:3px;border-radius:2px;background:color-mix(in srgb,\${c.acc} 60%,transparent)}
    .cn-ai-cliptag{display:inline-flex!important;align-items:center;gap:4px;margin-left:6px;padding:2px 10px;border-radius:999px;background:#111113!important;color:#fff!important;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif!important;vertical-align:1px;white-space:nowrap;text-decoration:none!important;letter-spacing:0!important}
    .cn-ai-cliptag svg{width:12px;height:12px;flex:none}
    #cn-ai-cursor{position:absolute;z-index:2147483647;pointer-events:none;opacity:0;left:40%;top:120px;transition:left .55s cubic-bezier(.3,.8,.25,1),top .55s cubic-bezier(.3,.8,.25,1),opacity .2s}
    #cn-ai-cursor.on{opacity:1}
    #cn-ai-cursor > svg{display:block;width:20px;height:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
    #cn-ai-cursor > span{position:absolute;left:16px;top:16px;display:inline-flex;align-items:center;gap:4px;background:\${c.accBg};color:\${c.accOn};font:500 11px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:1px 6px 1px 2px;border-radius:999px;white-space:nowrap}
    #cn-ai-cursor .cn-ai-lg{display:grid;place-items:center;width:14px;height:14px;border-radius:50%;background:\${c.accOn};color:\${c.accBg}}
    #cn-ai-cursor .cn-ai-lg svg,#cn-ai-cursor .cn-ai-lg img{display:block;width:10px;height:10px;filter:none}
  \`
  if (!document.getElementById('cn-ai-cursor')) {
    const el = document.createElement('div')
    el.id = 'cn-ai-cursor'
    el.innerHTML = '<svg viewBox="0 0 20 20"><path d="M3.5 2.2 16.6 9.4 10.4 10.9 7.4 16.8Z" fill="' + c.accBg + '" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span><i class="cn-ai-lg"></i>AI</span>'
    document.body.appendChild(el)
  }
  // 指针旁画动手的那一家的标志（每次都放一遍：中途换了引擎也跟着换）
  document.querySelector('#cn-ai-cursor .cn-ai-lg').innerHTML = logo
  return true
})()`

const sleepUntil = async (ms: number, stopped?: () => boolean) => {
  const end = Date.now() + ms
  while (Date.now() < end && !stopped?.()) await sleep(Math.min(50, end - Date.now()))
}

/**
 * AI 去拿网页里的一段：找到含这几个字的最小那一段（p、li、blockquote、标题……），滚到中间，指针移过去（0.55 秒），
 * 这一段亮一下（约 0.5 秒），再选中它（后面 web_clip 剪的就是它）。找不到返回 false。
 */
export async function pickBlock(text: string, colors: AccentColors, engine: EngineId, stopped?: () => boolean): Promise<boolean> {
  const wc = need()
  await wc.executeJavaScript(SETUP(colors, engine), true)
  const found = (await wc.executeJavaScript(
    `(() => {
      const want = ${JSON.stringify(text.replace(/\s+/g, ' ').trim())}
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
      const all = [...document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, figcaption, td, div')]
      const hits = all.filter((el) => norm(el.innerText).includes(want))
      // 最里面那一层（自己的孩子里没有也含这几个字的）
      const el = hits.find((h) => !hits.some((o) => o !== h && h.contains(o)))
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      document.querySelectorAll('[data-cn-ai-hit]').forEach((x) => x.removeAttribute('data-cn-ai-hit'))
      el.setAttribute('data-cn-ai-pick', '1')
      return true
    })()`,
    true,
  )) as boolean | null
  if (!found) return false
  await sleep(120)
  // 指针移过去：段落左上往里一点（跟着网页滚，指针放在文档坐标里）
  await wc.executeJavaScript(
    `(() => { const el = document.querySelector('[data-cn-ai-pick]'); const cur = document.getElementById('cn-ai-cursor'); if (!el || !cur) return; const r = el.getBoundingClientRect(); cur.style.left = (r.left + scrollX + Math.min(30, r.width / 2)) + 'px'; cur.style.top = (r.top + scrollY + Math.min(10, r.height / 2)) + 'px'; cur.classList.add('on') })()`,
    true,
  )
  await sleepUntil(550, stopped)
  await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-cn-ai-pick]'); if (el) el.setAttribute('data-cn-ai-hit', '1') })()`, true)
  await sleepUntil(450, stopped)
  await wc.executeJavaScript(
    `(() => { const el = document.querySelector('[data-cn-ai-pick]'); if (!el) return; el.removeAttribute('data-cn-ai-hit'); const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r) })()`,
    true,
  )
  return true
}

/** 剪进收件箱的那篇 → 网页里标着它的那一段的编号（撤回后按它去掉标记） */
const clipMarks = new Map<string, { wc: WebContents; id: string }>()
let markSeq = 0

/**
 * 剪下的那一段（AI 刚选的，或用户自己选中的那段所在的块）：左边一道竖线、段尾黑色小胶囊「✂ 剪成卡片」。剪完留着，撤回后去掉（unmarkClips）
 */
export async function markClip(path: string, colors: AccentColors, engine: EngineId): Promise<void> {
  const wc = webContents()
  if (!wc) return
  await wc.executeJavaScript(SETUP(colors, engine), true)
  const id = `m${++markSeq}`
  const ok = (await wc.executeJavaScript(
    `(() => {
      let el = document.querySelector('[data-cn-ai-pick]')
      if (!el) {
        const s = getSelection()
        let n = s && s.rangeCount ? s.getRangeAt(0).startContainer : null
        if (n && n.nodeType !== 1) n = n.parentElement
        el = n ? n.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, figcaption, td, div') : null
      }
      if (!el) return false
      el.removeAttribute('data-cn-ai-pick')
      el.setAttribute('data-cn-ai-clip', ${JSON.stringify(id)})
      const tag = document.createElement('span')
      tag.className = 'cn-ai-cliptag'
      tag.setAttribute('data-cn-ai-tag', ${JSON.stringify(id)})
      tag.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="4.2" cy="4.2" r="2.2"/><circle cx="4.2" cy="11.8" r="2.2"/><path d="M6 5.6 14 12.6M6 10.4 14 3.4"/></svg>剪成卡片'
      el.appendChild(tag)
      getSelection()?.removeAllRanges()
      return true
    })()`,
    true,
  )) as boolean
  if (ok) clipMarks.set(path, { wc, id })
}

/** 撤回了：这几篇对应的标记去掉（网页没换页时） */
export async function unmarkClips(paths: string[]): Promise<void> {
  for (const p of paths) {
    const m = clipMarks.get(p)
    if (!m) continue
    clipMarks.delete(p)
    if (m.wc.isDestroyed()) continue
    await m.wc
      .executeJavaScript(
        `(() => { document.querySelectorAll('[data-cn-ai-tag="${m.id}"]').forEach((t) => t.remove()); document.querySelectorAll('[data-cn-ai-clip="${m.id}"]').forEach((e) => e.removeAttribute('data-cn-ai-clip')) })()`,
        true,
      )
      .catch(() => undefined)
  }
}

/** 标着的是哪几篇（撤回后看哪几篇已经不在了） */
export const markedClips = () => [...clipMarks.keys()]

/** 这一轮做完：网页里的 AI 指针收起来（剪下的标记留着） */
export async function endWebAct(): Promise<void> {
  const wc = webContents()
  if (!wc) return
  await wc
    .executeJavaScript(`(() => { document.getElementById('cn-ai-cursor')?.classList.remove('on'); document.querySelectorAll('[data-cn-ai-hit],[data-cn-ai-pick]').forEach((e) => (e.removeAttribute('data-cn-ai-hit'), e.removeAttribute('data-cn-ai-pick'))) })()`, true)
    .catch(() => undefined)
}

/** 选中的字；whole 或没选中时是整页正文 */
export async function pageForClip(whole: boolean): Promise<{ text: string; url: string; title: string }> {
  const wc = need()
  const r = (await wc.executeJavaScript(
    `(() => ({ sel: String(getSelection() || '').trim(), body: (document.body ? document.body.innerText : '').trim(), url: location.href, title: document.title }))()`,
    true,
  )) as { sel: string; body: string; url: string; title: string }
  const text = !whole && r.sel ? r.sel : r.body
  if (!text) throw new Error('这个网页上没有字可剪')
  return { text: text.slice(0, 20000), url: r.url, title: r.title }
}
