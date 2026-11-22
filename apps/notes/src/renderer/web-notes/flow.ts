/**
 * 网页选字的小条、按住 ⌘ 框一块的工具条点了以后（task-6cxtc，偏好「选中小条统一、合成那颗叫引用」「网页的笔记记在正在剪进去的那篇」）：
 * - 讲解一下、翻译 + 讲一讲：进这个网页那一处的 AI（中间开着 PDF、HTML 时进它的，同框一块问），答完一问一块 [!ai] 写进这个网页正在剪进去的那篇；
 * - 引用：这段成为那一处 AI 输入框顶上的一块材料、光标进去，接着选别处再引用攒成 ①②；问完同样写进那篇；
 * - 剪藏：写进那篇（中间看得见那篇插在光标处，不然接在末尾），来源一行是回到这一段的链接；底栏说剪到了哪，带「撤回」「换一篇」；
 * - 还没定记到哪篇（没配对、没选过）：第一次问、剪时贴着小条问一句（Where.tsx），「记到这篇」顺手配成一对。
 * 软件别处（中间开着什么、底栏、AI 那一格、笔记标签）由 App 交进来（setWebNotesHost）。
 */
import type { CodiconName } from '@cn/design'
import type { Clip } from '../../shared/api'
import { clipMarkdown, titleOf } from '../../shared/layout'
import type { Material } from '../../shared/materials'
import { bookPrefix, pageHead } from '../../shared/read-along'
import type { ReadingMsg, ReadingThread } from '../../shared/reading'
import { backLabel, fragmentUrl, sourceLabel } from '../../shared/web-link'
import { askLabel, ASKED, webAskBlock } from '../../shared/web-notes'
import type { PageRect, WebSel } from '../../shared/web-reader'
import { relLink } from '../../shared/video'
import { copy } from '../ctx/menu'
import type { PopAnchor } from '../pop-place'
import { pairNote } from '../read-along/pairing'
import { pairOf } from '../read-along/store'
import * as Reading from '../reading/store'
import { askWhere, type Where } from './Where'
import { chosenFor, isSkipped, setChosen, skip, targetOf } from './target'
import { notesChanged, noteTime } from './times'
import { type Wrote, writeInto } from './write'

export interface WebNotesHost {
  /** 中间看得见的那篇（文档看法、能写）；中间收起了、开的不是文档（白板、PDF、首页）是 null */
  center(): string | null
  /** 中间开着的 PDF、库里的 HTML：网页上问的进它的 AI（同框一块问） */
  readingDoc(): string | null
  /** 库里的笔记（md 的路径） */
  notes(): readonly string[]
  /** 剪成卡片进收件箱（白板、首页在中间，或者「记到哪篇」里选了收件箱） */
  clipToInbox(c: Clip): Promise<void>
  /** 右栏 AI 换到这一处（PDF、HTML 的，或网页的 web:<网址>）、打开 */
  askIn(src: string): void
  /** 底栏一句；act：一颗按钮；undo：「撤回」 */
  notice(text: string, o?: { act?: { label: string; icon: CodiconName; run(): void }; undo?: () => void }): void
  /** 翻译设置（插件那一页） */
  openTranslateSettings(): void
  /** 右栏笔记标签开着、看得见 */
  notesShown(): boolean
  /** 打开右栏笔记标签，翻到那一条 */
  showNote(path: string, key?: string): void
  /** 文件改了：左栏、底栏 */
  refresh(): void
  /**
   * 网页占满（task-05p2w 方向 A）：占满时中间那篇（看不见，文档看法；中间开的不是文档是 null）、地址栏小牌里「换一篇…」选的那篇、
   * 这一阵是不是剪进收件箱；没占满是 null
   */
  full(): { note: string | null; pick: string | null; inbox: boolean } | null
  /** 占满时剪进了一篇：「看一眼」还原、那篇里刚剪的那段亮一下 */
  peek(path: string, md: string): void
}

let host: WebNotesHost | null = null
export const setWebNotesHost = (h: WebNotesHost | null) => void (host = h)
const H = () => {
  if (!host) throw new Error('软件还没准备好')
  return host
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 网页里那块地方（网页视口里的）在窗口里的位置：frame 是 webview 在窗口里的位置 */
export const anchorOf = (r: PageRect, frame: DOMRect): PopAnchor => ({ left: frame.left + r.x, top: frame.top + r.y, bottom: frame.top + r.y + r.h, right: frame.left + r.x + r.w })

const have = (p: string) => H().notes().includes(p)

/**
 * 这个网页现在记进哪篇（没定是 null）。网页占满时：配好对、选过的那篇（中间那篇也配了它时它优先），都没有就是中间那篇
 * （偏好「读网页时能收起中间栏、摘录照写」：地址栏小牌一直写着记进哪篇，不用再问）
 */
export function targetNow(url: string): string | null {
  const f = H().full()
  if (f) return (f.pick && have(f.pick) ? f.pick : null) ?? targetOf(url, f.note, have) ?? f.note
  return targetOf(url, H().center(), have)
}

/** 网页占满时剪藏剪到哪：这一阵剪进收件箱时是 inbox，不然同 targetNow（中间开的不是文档、也没配对时进收件箱）；没占满是 null */
export function fullClipTarget(url: string): string | 'inbox' | null {
  const f = H().full()
  if (!f) return null
  return f.inbox ? 'inbox' : (targetNow(url) ?? 'inbox')
}

/** 剪了一段（剪进哪篇或收件箱）：地址栏「记进」小牌数这一阵剪了几条 */
export const CLIPPED = 'cn:web-clipped'
const clipped = (to: string) => window.dispatchEvent(new CustomEvent(CLIPPED, { detail: to }))

/** 「记到这篇」：记下这个网站选的这篇；那篇还没配别的网站就顺手配成一对（属性 read-along 写网站根） */
async function choose(url: string, path: string) {
  setChosen(url, path)
  if (!pairOf(path)) await pairNote(path, bookPrefix(url))
  notesChanged()
}

/**
 * 问、引用之前：这个网页记进哪篇定了没有，没定（也没说过这次不记）就问一句。取消返回 false（这一下不做了）
 */
export async function ensureAsk(url: string, at: PopAnchor): Promise<boolean> {
  if (targetNow(url) || isSkipped(url)) return true
  const w = await askWhere({ kind: 'ask', at, center: H().center(), notes: H().notes() })
  if (!w) return false
  if (w.kind === 'doc') await choose(url, w.path)
  else skip(url)
  return true
}

/**
 * 小条上点了一颗（或按了它的键）：frame 是这个 webview 在窗口里的位置。
 * 讲解一下、翻译、引用、剪藏：还没定记到哪篇先问一句，这时网页上的小条和选区留着、弹层贴在小条下面（设计稿「第一次问记到哪」）；
 * 定了（或不用问）done(false) 让网页收起小条，取消了 done(true) 小条和选区照旧留着
 */
export async function onSel(sel: WebSel, frame: DOMRect, done: (keep: boolean) => void = () => {}, inCenter = false) {
  const at = anchorOf(sel.bar, frame)
  let told = false
  const settle = (keep: boolean) => {
    if (told) return
    told = true
    done(keep)
  }
  try {
    if (sel.action === 'copy') {
      await copy(sel.text)
      return H().notice('这段拷贝好了')
    }
    if (sel.action === 'settings') return H().openTranslateSettings()
    if (sel.action === 'target') return void (await pickTarget(sel.url, at))
    if (sel.action === 'clip') {
      const c = { text: sel.text, url: sel.url, title: sel.title, ...(sel.head ? { head: sel.head } : {}) }
      // 在中间开成一页的网页（task-05p2w）：剪的进收件箱（⋯ 菜单里那一项旁边写着）
      const to = inCenter ? 'inbox' : await clipTarget(c, at)
      settle(to === null)
      if (to === null) return
      return await (to === 'inbox' ? inbox(c) : clipInto(c, to))
    }
    // 中间开着 PDF、HTML 的进它的 AI，不用问
    if (!H().readingDoc() && !(await ensureAsk(sel.url, at))) return settle(true)
    settle(false)
    if (sel.action === 'quote') return await quoteWeb(sel, at)
    await askWeb(sel, at, sel.action === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲')
  } catch (e) {
    H().notice(errText(e))
  } finally {
    settle(false)
  }
}

/** 讲解一下、翻译 + 讲一讲：选中的这段带进这个网页那一处的 AI 直接问 */
async function askWeb(sel: WebSel, at: PopAnchor, prompt: string) {
  const web = { url: sel.url, title: sel.title || sel.url, text: sel.text, ...(sel.head ? { head: sel.head } : {}) }
  const doc = H().readingDoc()
  if (doc) {
    // 中间开着 PDF、HTML：进它的 AI，记进它的笔记（同网页上框着问，对上这一页）
    H().askIn(doc)
    await Reading.load(doc)
    Reading.stage(doc, { page: /\.pdf$/i.test(doc) ? Reading.get(doc).state.page : 0, quote: sel.text, web, direct: true })
    return Reading.send(doc, prompt)
  }
  if (!(await ensureAsk(sel.url, at))) return
  const src = `web:${sel.url}`
  H().askIn(src)
  await Reading.load(src)
  Reading.setWebTitle(src, sel.title)
  Reading.stage(src, { page: 0, quote: sel.text, web, direct: true })
  await Reading.send(src, prompt)
}

/** 引用：这段成为那一处 AI 输入框顶上的一块材料（来源写那段上面的小标题），光标进去 */
async function quoteWeb(sel: WebSel, at: PopAnchor) {
  const mat: Material = { kind: 'quote', text: sel.text.trim().slice(0, 20_000), src: backLabel(sel), url: sel.url }
  const doc = H().readingDoc()
  if (doc) {
    H().askIn(doc)
    return Reading.addMaterial(doc, mat)
  }
  if (!(await ensureAsk(sel.url, at))) return
  const src = `web:${sel.url}`
  H().askIn(src)
  await Reading.load(src)
  Reading.setWebTitle(src, sel.title)
  Reading.addMaterial(src, mat)
}

// ---------------------------------------------------------------- 剪藏

/** 剪下来的一段写成什么：引文 + 「—— [小标题 · 书名](回到这一段的链接)」 */
export const clipMdOf = (c: Clip & { head?: string }) => clipMarkdown(c.text, sourceLabel(c), fragmentUrl(c.url, c.text))

/**
 * 剪藏：写进这个网页正在剪进去的那篇。还没定时：中间开着能写的文档就问一句（默认它）；中间是白板、首页、PDF 就照旧剪成卡片进收件箱
 */
export async function clipWeb(c: Clip & { head?: string }, at: PopAnchor) {
  const to = await clipTarget(c, at)
  if (to === null) return
  return to === 'inbox' ? inbox(c) : clipInto(c, to)
}

/** 剪到哪：配好对的那篇；还没定时问一句（默认中间开着的那篇），中间是白板、首页、PDF 进收件箱；取消了是 null */
async function clipTarget(c: Clip, at: PopAnchor): Promise<string | 'inbox' | null> {
  const full = fullClipTarget(c.url)
  if (full) return full
  const path = targetNow(c.url)
  if (path) return path
  const center = H().center()
  if (!center) return 'inbox'
  const w = await askWhere({ kind: 'clip', at, center, notes: H().notes() })
  if (!w) return null
  if (w.kind !== 'doc') return 'inbox'
  await choose(c.url, w.path)
  return w.path
}

/** 剪进那篇（光标处或末尾），底栏说剪到了哪，带「换一篇」「撤回」 */
async function clipInto(c: Clip & { head?: string }, path: string) {
  const md = clipMdOf(c)
  const wrote = await put(path, md, true)
  void window.cn.logActivity('clip', path)
  noteTime(path, md)
  notesChanged()
  clipped(path)
  // 网页占满：底栏「记进《X》」带「看一眼」（还原、刚剪的那段亮一下）；换一篇在地址栏的小牌里
  if (H().full()) return H().notice(`记进《${titleOf(path)}》`, { act: { label: '看一眼', icon: 'eye', run: () => H().peek(path, md) }, undo: () => void undoWrote(wrote) })
  H().notice(`剪进《${titleOf(path)}》${wrote.where === 'cursor' ? '光标处' : '末尾'}`, {
    act: { label: '换一篇', icon: 'arrow-swap', run: () => void moveClip(c, md, wrote, toastAnchor()) },
    undo: () => void undoWrote(wrote),
  })
}

async function inbox(c: Clip) {
  await H().clipToInbox({ text: c.text, url: fragmentUrl(c.url, c.text), title: c.title })
  clipped('inbox')
}

/** 写进那篇：中间看得见这篇插在光标处（剪藏把光标交回那篇），不然接在末尾 */
function put(path: string, md: string, clip: boolean): Promise<Wrote> {
  const cursor = path === H().center()
  return writeInto(path, md, { cursor, focus: clip && cursor })
}

async function undoWrote(w: Wrote) {
  const ok = await w.undo()
  notesChanged()
  H().notice(ok ? `从《${titleOf(w.path)}》拿掉了` : `《${titleOf(w.path)}》里那段已经改过了，没拿掉`)
}

/** 在网页那一处的 AI 输入框里回车（框一块以后、接着问）：还没定记到哪篇先贴着输入框问一句；取消返回 false（这一问不发） */
export const ensureBeforeSend = (url: string) => (host ? ensureAsk(url, composerAnchor()) : Promise.resolve(true))

/** 右栏 AI 输入框在哪（贴着它往上问记到哪篇） */
function composerAnchor(): PopAnchor {
  const r = document.querySelector('.reading-ai [data-composer]')?.getBoundingClientRect() ?? new DOMRect(innerWidth - 400, innerHeight - 160, 360, 120)
  return { left: r.left, top: r.top, bottom: r.top, right: r.right }
}

/** 底栏那一句在哪（「换一篇」贴着它往上问） */
function toastAnchor(): PopAnchor {
  const r = document.querySelector('[data-testid="toast"]')?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2 - 160, innerHeight - 40, 320, 30)
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.right }
}

/** 「换一篇」：问剪到哪篇，从这篇拿掉、写进那篇；以后这个网站记进那篇 */
async function moveClip(c: Clip & { head?: string }, md: string, wrote: Wrote, at: PopAnchor) {
  const w = await askWhere({ kind: 'clip', at, center: H().center(), notes: H().notes(), current: wrote.path })
  if (!w || (w.kind === 'doc' && w.path === wrote.path)) return
  try {
    if (!(await wrote.undo())) return H().notice(`《${titleOf(wrote.path)}》里那段已经改过了，没挪`)
    if (w.kind !== 'doc') {
      await inbox(c)
      return H().notice('挪进收件箱了，剪成了一张卡片')
    }
    await choose(c.url, w.path)
    const again = await put(w.path, md, true)
    noteTime(w.path, md)
    notesChanged()
    H().notice(`挪到《${titleOf(w.path)}》了`, { undo: () => void undoWrote(again) })
    H().refresh()
  } catch (e) {
    H().notice(errText(e))
  }
}

/** 「⋯ › 剪到哪篇…」：换这个网站剪进哪篇（以后讲解、引用、剪藏都记进它） */
export async function pickTarget(url: string, at: PopAnchor): Promise<Where | null> {
  const cur = targetNow(url) ?? chosenFor(url)
  // 网页占满时（小牌「换一篇…」）中间那篇看不见，照样算「中间开着的」那一项
  const w = await askWhere({ kind: 'clip', at, center: H().center() ?? H().full()?.note ?? null, notes: H().notes(), current: cur })
  if (w?.kind === 'doc') {
    await choose(url, w.path)
    H().notice(`这个网站以后记进《${titleOf(w.path)}》`)
  }
  return w
}

// ---------------------------------------------------------------- 问完写进那篇

/** 网页上问的答完了：一问一块 [!ai] 写进这个网页正在剪进去的那篇；没定（这次只问不记）是 null */
async function writeAsk(n: Reading.WebNote): Promise<{ path: string; title: string } | null> {
  const url = n.thread.web?.url ?? n.src.slice(4)
  // 还没定记到哪篇（框一块以后在输入框里回车、接着问的）：答好了贴着 AI 输入框问一句；这次只问不记的不问
  if (!targetNow(url) && !isSkipped(url) && !(await ensureAsk(url, composerAnchor()))) return null
  const path = targetNow(url)
  if (!path) return null
  const th: ReadingThread = n.thread
  const q: ReadingMsg = n.question
  const links: { text: string; url: string }[] = []
  const quotes: string[] = []
  const web = th.web
  // 这一处（选的那段、框的那块）
  const passage = th.quote ?? web?.text ?? ''
  if (web && passage.trim()) {
    links.push({ text: `${backLabel({ ...(web.head ? { head: web.head } : {}), title: web.title, url: web.url })} ↩`, url: fragmentUrl(web.url, passage) })
    if (th.quote) quotes.push(th.quote)
  }
  // 引用进来的几段（网页上的带回链接）
  for (const m of q.mats ?? []) {
    if (m.kind !== 'quote') continue
    quotes.push(m.text)
    if (m.url) {
      const l = { text: `${m.src} ↩`, url: fragmentUrl(m.url, m.text) }
      if (!links.some((x) => x.url === l.url)) links.push(l)
    }
  }
  if (!links.length) links.push({ text: `${pageHead(web?.title, url)} ↩`, url })
  // 框的那块截图：这一处的第一问放一次（接着问的不再放）
  const first = !Reading.get(n.src).state.msgs.some((m) => m.thread === th.id && m.role === 'user' && m.id !== q.id && m.time <= q.time)
  const image = first && th.crop ? relLink(path, th.crop) : undefined
  const label = askLabel(q.text)
  const md = webAskBlock({ label, by: n.by, links, quotes, ...(image ? { image } : {}), answer: n.answer })
  const wrote = await put(path, md, false)
  noteTime(path, md)
  notesChanged()
  const title = titleOf(path)
  const short = label.startsWith(`${ASKED}：`) ? ASKED : label
  await window.cnReading.commit([path], `笔记：网页「${pageHead(web?.title, url)}」· ${short} → ${title}`)
  H().refresh()
  // 写在末尾（中间看不见那篇）：底栏说记进了哪，带「在笔记里看」
  if (wrote.where === 'end') {
    const text = `记进《${title}》· ${links[0]!.text.replace(/\s*↩$/, '')}`
    H().notice(text, H().notesShown() ? undefined : { act: { label: '在笔记里看', icon: 'note', run: () => H().showNote(path, md.split('\n')[0]) } })
  }
  return { path, title }
}

Reading.setWebNoteWriter(writeAsk, isSkipped)
