/**
 * AI 操纵右栏网页：主进程拿着 <webview> 的 webContents，读字、点、输入、滚动。
 * 点和输入用真的鼠标键盘事件（sendInputEvent / insertText），网页分不出是人还是 AI。
 */
import type { WebContents } from 'electron'
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
