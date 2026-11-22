/**
 * 开着的网页（webview）和「网页的笔记」之间（task-6cxtc）：
 * - 发过去：小条上「剪藏」剪进哪篇（悬停提示、「⋯ › 剪到哪篇…」右边写的那篇，cn:clip-to），网页上问过、剪过的那几段（cn:marks）；
 *   网页载完、换了网址、记进那篇的东西变了（写进去了、换了一篇、中间换了一篇）都重发一次；
 * - 收过来：小条上点了什么（cn:sel → flow.ts），网页上点了小标（cn:mark → 笔记标签翻到那几条）。
 */
import { titleOf } from '../../shared/layout'
import type { WebSel } from '../../shared/web-reader'
import { webEntries } from '../../shared/web-notes'
import type { WebviewEl } from '../web/WebView'
import { NoteDoc } from '../note-doc'
import { fullClipTarget, onSel, targetNow } from './flow'
import { WEB_NOTES_CHANGED } from './times'

const views = new Set<WebviewEl>()

/** 主题强调色（量出真的颜色交给网页：小标、点线） */
function accColor(): string {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--acc)'
  document.body.append(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c || '#0a7ea4'
}

/** 这个网页的小条上「剪藏」说剪进哪篇；inCenter：在中间开成一页的网页（剪的进收件箱） */
function clipTo(url: string, center: string | null, inCenter: boolean): { tip: string; sub: string; target: string | null } {
  if (inCenter || fullClipTarget(url) === 'inbox') return { tip: '剪成卡片，放进收件箱', sub: '剪完底栏说剪到了哪，能撤回', target: null }
  const t = /^https?:/i.test(url) ? targetNow(url) : null
  if (t) return { tip: `剪进《${titleOf(t)}》${t === center ? '光标处' : '末尾'}`, sub: '剪完底栏说剪到了哪，能撤回、能换一篇', target: titleOf(t) }
  if (center) return { tip: `剪进《${titleOf(center)}》光标处`, sub: '第一次剪先问一句记到哪篇；剪完能撤回、能换一篇', target: null }
  return { tip: '剪成卡片，放进收件箱', sub: '剪完底栏说剪到了哪，能撤回', target: null }
}

/** 那篇现在的字：开着读编辑器，没开着读文件 */
async function textOf(path: string): Promise<string> {
  const d = [...NoteDoc.open].find((x) => x.path === path)
  if (d) return d.text
  return (await window.cn.readNote(path)).text
}

let center: () => string | null = () => null
export const setBridgeCenter = (f: () => string | null) => void (center = f)

/** 这个 webview 是中间开成一页的网页（WebTab 的 .wpane 里），不是右栏的 */
const inCenterTab = (el: WebviewEl) => !!el.closest('.wpane')

/** 给这个网页发一次剪藏提示和记号 */
async function push(el: WebviewEl) {
  let url: string
  try {
    url = el.getURL()
  } catch {
    return
  }
  el.send('cn:clip-to', clipTo(url, center(), inCenterTab(el)))
  const t = /^https?:/i.test(url) ? targetNow(url) : null
  const marks = t ? webEntries(await textOf(t).catch(() => ''), url).map((e) => ({ id: e.key, quote: e.quote, text: e.text })) : []
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

if (typeof window !== 'undefined') window.addEventListener(WEB_NOTES_CHANGED, () => refreshWebNotes())

/** 小条上点了什么（网页预加载 cn:sel）：查一遍再交给 flow.ts */
export function webSelIpc(el: WebviewEl, raw: unknown) {
  const s = raw as Partial<WebSel> | undefined
  const ok = new Set(['explain', 'translate', 'quote', 'clip', 'settings', 'target', 'copy'])
  if (!s || typeof s.action !== 'string' || !ok.has(s.action) || typeof s.text !== 'string' || typeof s.url !== 'string' || typeof s.title !== 'string') return
  const b = s.bar
  const bar = b && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? b : { x: 0, y: 0, w: 0, h: 0 }
  const sel: WebSel = { action: s.action, text: s.text.slice(0, 20_000), url: s.url, title: s.title.slice(0, 300), bar, ...(typeof s.head === 'string' && s.head ? { head: s.head.slice(0, 200) } : {}) }
  // 定了记到哪篇（或不用问）告诉网页：小条收起、选区清掉；取消了 keep，小条和选区留着
  void onSel(sel, el.getBoundingClientRect(), (keep) => el.send('cn:sel-done', keep), inCenterTab(el))
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
