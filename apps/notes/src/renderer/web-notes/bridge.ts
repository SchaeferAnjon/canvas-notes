/**
 * 开着的网页（webview）和「网页的笔记」之间（task-6cxtc）：
 * - 发过去：小条上「剪藏」剪进哪篇（悬停提示、「⋯ › 剪到哪篇…」右边写的那篇，cn:clip-to），网页上问过、剪过的那几段（cn:marks）；
 *   网页载完、换了网址、记进那篇的东西变了（写进去了、换了一篇、中间换了一篇）都重发一次；
 * - 收过来：小条上点了什么（cn:sel → flow.ts），网页上点了小标（cn:mark → 笔记标签翻到那几条）。
 */
import { titleOf } from '../../shared/layout'
import { SEL_ACTIONS, type WebSel } from '../../shared/web-reader'
import { markFresh } from '../sel-bar/store'
import { onWebBarChange, webBarSpec } from '../sel-bar/web'
import { webEntries } from '../../shared/web-notes'
import type { WebviewEl } from '../web/WebView'
import { noteText } from './write'
import { clipDestNow, dirLabel, onSel, targetNow } from './flow'
import { t as tNow } from '../../shared/i18n'
import { WEB_NOTES_CHANGED } from './times'

const views = new Set<WebviewEl>()

/** 网页上的 💬 是一张剪成的卡片（不是正在剪进去的那篇里的一条）：id 是它加卡片的路径（不带换行：网页那边按换行分 id） */
export const CARD = 'card:'

/** 主题强调色（量出真的颜色交给网页：小标、点线） */
function accColor(): string {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--acc)'
  document.body.append(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c || '#0a7ea4'
}

/** 这个网页的小条上「剪藏」说剪进哪篇（剪藏去处规则：配对的那篇 / 选的文件夹 / 收件箱，中间开着什么都一样） */
function clipTo(url: string, center: string | null): { tip: string; sub: string; target: string | null } {
  const dest = clipDestNow(url)
  // 进收件箱、文件夹：「⋯ › 剪到哪篇…」右边写收件箱 / 那个文件夹
  if (dest === 'inbox') return { tip: '剪成卡片，放进收件箱', sub: '剪完底栏说剪到了哪，能撤回', target: '收件箱' }
  if (typeof dest === 'object') return { tip: tNow('剪成卡片，放进「{dir}」', { dir: dirLabel(dest.dir) }), sub: tNow('一段一张卡片，写法同收件箱'), target: dirLabel(dest.dir) }
  const t = dest
  return { tip: `剪进《${titleOf(t)}》${t === center ? '光标处' : '末尾'}`, sub: '剪完底栏说剪到了哪，能撤回、能换一篇', target: titleOf(t) }
}

let center: () => string | null = () => null
export const setBridgeCenter = (f: () => string | null) => void (center = f)
/** 中间开着的那篇（文档、白板都算）：右键「剪进文档」、拖进去的都在它里面，网页上照样标「剪过」 */
let openNote: () => string | null = () => null
export const setBridgeOpen = (f: () => string | null) => void (openNote = f)

/** 给这个网页发一次剪藏提示和记号 */
async function push(el: WebviewEl) {
  let url: string
  try {
    url = el.getURL()
  } catch {
    return
  }
  el.send('cn:clip-to', clipTo(url, center()))
  // 选中小条（task-26nz7）：条上、⋯ 里有哪几颗，总开关、不弹的网站
  el.send('cn:bar', webBarSpec(accColor()))
  const http = /^https?:/i.test(url)
  const t = http ? targetNow(url) : null
  const marks = t ? webEntries(await noteText(t).catch(() => ''), url).map((e) => ({ id: e.key, quote: e.quote, text: e.text, ...(e.img ? { img: true } : {}) })) : []
  // 剪成卡片的（收件箱、选的文件夹里 source 是这一页的）也打 💬（剪藏去处 2026-11-25）；id 是 CARD + 那张卡片，点了打开它
  const cards = http ? await window.cn.webCards(url).catch(() => []) : []
  for (const c of cards) if (c.path !== t) for (const e of webEntries(c.text, url)) marks.push({ id: `${CARD}${c.path}`, quote: e.quote, text: e.text, ...(e.img ? { img: true } : {}) })
  // 中间开着的那篇不是去处时（右键「剪进文档」、拖进去的进它）：它里面来自这一页的也标，点了打开它
  const open = http ? openNote() : null
  if (open && open !== t && !cards.some((c) => c.path === open))
    for (const e of webEntries(await noteText(open).catch(() => ''), url)) marks.push({ id: `${CARD}${open}`, quote: e.quote, text: e.text, ...(e.img ? { img: true } : {}) })
  el.send('cn:marks', { marks, color: accColor() })
}

/** 一个 webview 挂上了：登记，载完、换了网址时发一次 */
export function attachWebNotes(el: WebviewEl): () => void {
  views.add(el)
  return () => views.delete(el)
}

/** 这个网页载完、换了网址 */
export const webNotesNav = (el: WebviewEl) => void push(el)

/** 记进哪篇、那篇里的东西变了：每个开着的网页都重发 */
export function refreshWebNotes() {
  for (const v of views) void push(v)
}

if (typeof window !== 'undefined') {
  window.addEventListener(WEB_NOTES_CHANGED, () => refreshWebNotes())
  // 选中小条的表、自己的命令、刚存好的那颗变了：每个网页的小条照新的画（只发小条那一份）
  onWebBarChange(() => {
    const spec = webBarSpec(accColor())
    for (const v of views) {
      try {
        v.send('cn:bar', spec)
      } catch {
        // 还没挂好的网页：挂好时 push 会发
      }
    }
  })
}

/** 网页说刚存好的那颗已经描过一圈了 */
export const webBarSeen = () => markFresh(null)

/** 小条上点了什么（网页预加载 cn:sel）：查一遍再交给 flow.ts */
export function webSelIpc(el: WebviewEl, raw: unknown) {
  const s = raw as Partial<WebSel> | undefined
  if (!s || typeof s.action !== 'string' || !SEL_ACTIONS.includes(s.action) || typeof s.text !== 'string' || typeof s.url !== 'string' || typeof s.title !== 'string') return
  if (s.action === 'cmd' && (typeof s.cmd !== 'string' || !/^own-[\w-]{1,40}$/.test(s.cmd))) return
  const b = s.bar
  const bar = b && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? b : { x: 0, y: 0, w: 0, h: 0 }
  const sel: WebSel = { action: s.action, ...(s.action === 'cmd' ? { cmd: s.cmd } : {}), text: s.text.slice(0, 20_000), ...(typeof s.md === 'string' && s.md.trim() ? { md: s.md.slice(0, 40_000) } : {}), url: s.url, title: s.title.slice(0, 300), bar, ...(typeof s.head === 'string' && s.head ? { head: s.head.slice(0, 200) } : {}) }
  // 定了记到哪篇（或不用问）告诉网页：小条收起、选区清掉；取消了 keep，小条和选区留着
  void onSel(sel, el.getBoundingClientRect(), (keep) => el.send('cn:sel-done', keep))
}

/** 网页上点了小标：笔记标签翻到这几条里的第一条 */
let markHandler: ((url: string, ids: string[]) => void) | null = null
export const setMarkHandler = (f: ((url: string, ids: string[]) => void) | null) => void (markHandler = f)
export function webMarkIpc(el: WebviewEl, raw: unknown) {
  if (!Array.isArray(raw)) return
  const ids = raw.filter((x): x is string => typeof x === 'string').slice(0, 50)
  if (!ids.length) return
  let url = ''
  try {
    url = el.getURL()
  } catch {
    return
  }
  markHandler?.(url, ids)
}
