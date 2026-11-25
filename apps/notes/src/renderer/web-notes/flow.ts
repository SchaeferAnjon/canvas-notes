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
import { bookPrefix } from '../../shared/read-along'
import { backLabel, fragmentUrl, sourceLabel } from '../../shared/web-link'
import { webEntries } from '../../shared/web-notes'
import type { PageRect, WebSel } from '../../shared/web-reader'
import { setWebClipMd, WEB_IMG_CLIPPED } from '../web/image-drop'
import { copy } from '../ctx/menu'
import type { PopAnchor } from '../pop-place'
import { pairNote } from '../read-along/pairing'
import { pairOf } from '../read-along/store'
import * as Reading from '../reading/store'
import { askWhere, type Where } from './Where'
import { readSrc } from '../../shared/ai-chats'
import { type Convo, convoFor, feedConvo, showConvo } from '../ai-web-stay'
import { chosenFor, dirLabel, folderFor, inboxFor, setChosen, targetOf } from './target'
export { dirLabel }
import { imgClip, type WebImgInfo } from '../../shared/web-img'
import { noteSwitchNow, setNoteSwitch } from '../ai-note-switch'
import { videoParent, videoParentNow } from '../video/note-parent'
import { notesChanged, noteTime } from './times'
import { noteText, type Wrote, writeInto } from './write'
import { t } from '../../shared/i18n'
import { withKeys } from '../keys'
import { muteSite, siteKey, today } from '../../shared/sel-bar'
import { updateBar } from '../sel-bar/store'
import { cmdById, cmdOut, cmdText, openBarSettings } from '../sel-bar/run'

/** 底栏那句话后面的一颗按钮 */
export interface NoticeAct {
  label: string
  icon: CodiconName
  run(): void
}

export interface WebNotesHost {
  /** 中间看得见的那篇（文档看法、能写）；中间收起了、开的不是文档（白板、PDF、首页）是 null */
  center(): string | null
  /** 中间开着的 PDF、库里的 HTML：网页上问的进它的 AI（同框一块问） */
  readingDoc(): string | null
  /** 库里的笔记（md 的路径） */
  notes(): readonly string[]
  /** 剪成卡片进收件箱（白板、首页在中间，或者「记到哪篇」里选了收件箱）；folder：这个网站选了文件夹，卡片进它 */
  clipToInbox(c: Clip, folder?: string): Promise<void>
  /** 右栏 AI 换到这一处（PDF、HTML 的，或网页的 web:<网址>）、打开 */
  askIn(src: string): void
  /** 打开右栏 AI，不换对话（引用、讲解进右栏正看着、留过的那段，ai-web-stay.ts） */
  showAi(): void
  /** 底栏一句；act：一颗按钮，more：再一颗（排在 act 后面）；undo：「撤回」 */
  notice(text: string, o?: { act?: NoticeAct; more?: NoticeAct; undo?: () => void }): void
  /** 翻译设置（插件那一页） */
  openTranslateSettings(): void
  /** 右栏笔记标签开着、看得见 */
  notesShown(): boolean
  /** 打开右栏笔记标签，翻到那一条 */
  showNote(path: string, key?: string): void
  /** 文件改了：左栏、底栏 */
  refresh(): void
  /**
   * 网页占满（task-05p2w 方向 A）：占满时中间那篇（看不见，文档看法；中间开的不是文档是 null）、地址栏小牌里「换一篇…」选的那篇；
   * 没占满是 null（剪进收件箱、文件夹记在这个网站的去处里，target.ts）
   */
  full(): { note: string | null; pick: string | null } | null
  /** 占满时剪进了一篇：「看一眼」还原、那篇里刚剪的那段亮一下 */
  peek(path: string, md: string): void
  /** 「已记进《…》」点了：中间打开那篇（配成一对的网页不跟着开，右栏网页不动），滚到那一问（AI 块带的消息号是 msg）、亮一下 */
  showAsk(path: string, msg: number): void
  /** 右栏换回网页标签（小条上那颗「只在 AI 栏答」以后底栏的「回网页」） */
  showWeb(): void
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

/** 剪藏剪到哪：一篇的路径、收件箱，或这个网站选的文件夹（每次一张卡片进它，写法同收件箱） */
export type ClipDest = string | 'inbox' | { dir: string }

/**
 * 这个网页现在剪藏剪到哪，不问（地址栏小牌照它写，剪藏剪到哪篇先看它）：这个网站选了文件夹、收件箱的进它；
 * 网页占满时同 targetNow（中间开的不是文档、也没配对时进收件箱）；没占满时配好对、选过的那篇；还没定是 null（⌘S 时再看中间开着什么）
 */
export function clipDestNow(url: string): ClipDest | null {
  const dir = folderFor(url)
  if (dir !== null) return { dir }
  if (inboxFor(url)) return 'inbox'
  if (H().full()) return targetNow(url) ?? 'inbox'
  return targetNow(url)
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
 * 问、引用之前：这个网页记进哪篇定了没有，没定（「记笔记」开着）就问一句；选「这次只问，不记」是把网页的「记笔记」关掉
 * （AI 栏输入框下面那一排的开关，问答都不记；选了一篇照旧配成一对）。取消返回 false（这一下不做了）
 */
export async function ensureAsk(url: string, at: PopAnchor): Promise<boolean> {
  const sw = noteSwitchNow('web')
  if (targetNow(url) || !sw.main) return true
  const w = await askWhere({ kind: 'ask', at, center: H().center(), notes: H().notes() })
  if (!w) return false
  if (w.kind === 'doc') await choose(url, w.path)
  else await setNoteSwitch('web', { ...sw, main: false }).catch((e: unknown) => H().notice(errText(e)))
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
      const c = { text: sel.text, ...(sel.md ? { md: sel.md } : {}), url: sel.url, title: sel.title, ...(sel.head ? { head: sel.head } : {}) }
      // 在中间开成一页的网页（task-05p2w）：剪的进收件箱（⋯ 菜单里那一项旁边写着）
      const to = inCenter ? 'inbox' : await clipTarget(c, at)
      settle(to === null)
      if (to === null) return
      return await clipTo(c, to)
    }
    // 选中小条能自定义（task-26nz7）：⋯ 里「加一颗…」「小条设置…」，× 的小菜单，自己加的那颗
    const sample = { text: sel.md ?? sel.text, title: sel.title, url: sel.url, ...(sel.head ? { head: sel.head } : {}) }
    if (sel.action === 'add') return openBarSettings({ view: 'edit', sample })
    if (sel.action === 'barset') return openBarSettings({ view: 'list', sample })
    if (sel.action === 'mute-site') return await muteSiteOf(sel.url)
    if (sel.action === 'mute-all') return await muteAll()
    if (sel.action === 'cmd') {
      const c = cmdById(sel.cmd ?? '')
      if (!c) return H().notice(t('这条命令没有了'))
      const out = cmdOut(c)
      // 进哪段对话同引用（convoFor）；进这个网页自己那段、写进笔记的先定记到哪篇，只在 AI 栏答的不用问
      const to = H().readingDoc() ? null : convoFor(sel.url)
      if (out === 'note' && !H().readingDoc() && !(to && readSrc(to.key)) && !(await ensureAsk(sel.url, at))) return settle(true)
      settle(false)
      return await runOwnWeb(sel, cmdText(c, sample), c.name, out, to)
    }
    // 进哪段对话：中间开着 PDF、HTML 的进它的 AI（照旧）；不然留过的、右栏正看着的那段（ai-web-stay.ts）；都不是进这个网页自己那段。
    // 进这个网页自己那段、普通对话（看文档、首页……）的先定记到哪篇：问答照网页的「记笔记」写进剪藏那篇（AiPanel 认带着网页引用的一问，webNoteTo）；
    // 进读 PDF 那一套的记进它自己的笔记
    const to = H().readingDoc() ? null : convoFor(sel.url)
    if (!H().readingDoc() && !(to && readSrc(to.key)) && !(await ensureAsk(sel.url, at))) return settle(true)
    settle(false)
    if (sel.action === 'quote') return await quoteWeb(sel, at, to)
    await askWeb(sel, at, sel.action === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲', to)
  } catch (e) {
    H().notice(errText(e))
  } finally {
    settle(false)
  }
}

const webOf = (sel: WebSel) => ({ url: sel.url, title: sel.title || sel.url, text: sel.text, ...(sel.head ? { head: sel.head } : {}) })

/** 选中的这段带进读 PDF 那一套的一段对话（PDF、HTML 的）直接问，记进它的笔记（同网页上框着问，对上这一页） */
async function askReading(src: string, sel: WebSel, prompt: string) {
  await Reading.load(src)
  Reading.stage(src, { page: /\.pdf$/i.test(src) ? Reading.get(src).state.page : 0, quote: sel.md ?? sel.text, web: webOf(sel), direct: true })
  return Reading.send(src, prompt)
}

/**
 * 进别的一段对话（留过的、右栏正看着的，ai-web-stay.ts）：AI 那一格换到它；读 PDF 那一套的（PDF、HTML）照框着问那样进它，
 * 普通对话交给 AiPanel（引用放进输入框，讲解一下带着这块直接问）。prompt 不给是引用
 */
async function intoConvo(to: Convo, sel: WebSel, prompt?: string) {
  H().showAi()
  showConvo(to)
  const src = readSrc(to.key)
  if (!src) return feedConvo(to.key, quoteMat(sel), prompt)
  if (prompt) return askReading(src, sel, prompt)
  await Reading.load(src)
  Reading.addMaterial(src, quoteMat(sel))
}

/**
 * 按住 ⌘ 框的一块（截图）进别的一段对话（App 的 onWebBox 里 convoFor 定了 to）：这块图存进 pasted/ 成一块图材料，来源写那段上面的小标题；
 * 引用放进输入框，讲解一下、翻译 + 讲一讲带着它直接问。读 PDF 那一套的（PDF、HTML）照框着问那样进它
 */
export async function boxIntoConvo(to: Convo, box: { url: string; title: string; text?: string; head?: string }, png: Uint8Array, action: 'quote' | 'explain' | 'translate') {
  const prompt = action === 'quote' ? undefined : action === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲'
  H().showAi()
  showConvo(to)
  const web = { url: box.url, title: box.title || box.url, text: box.text ?? '', ...(box.head ? { head: box.head } : {}) }
  const src = readSrc(to.key)
  if (src && prompt) {
    await Reading.load(src)
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    Reading.stage(src, { page: /\.pdf$/i.test(src) ? Reading.get(src).state.page : 0, url, png, web, direct: true })
    return Reading.send(src, prompt)
  }
  const mat: Material = { kind: 'image', name: await window.cn.aiPaste(png, 'image/png'), src: backLabel(web), url: box.url }
  if (!src) return feedConvo(to.key, mat, prompt)
  await Reading.load(src)
  Reading.addMaterial(src, mat)
}

/** 讲解一下、翻译 + 讲一讲：选中的这段带进这个网页那一处的 AI 直接问（to：进别的一段对话） */
async function askWeb(sel: WebSel, at: PopAnchor, prompt: string, to: Convo | null = null) {
  const web = webOf(sel)
  const doc = H().readingDoc()
  if (doc) {
    // 中间开着 PDF、HTML：进它的 AI，记进它的笔记
    H().askIn(doc)
    return askReading(doc, sel, prompt)
  }
  if (to) return intoConvo(to, sel, prompt)
  if (!(await ensureAsk(sel.url, at))) return
  const src = `web:${sel.url}`
  H().askIn(src)
  await Reading.load(src)
  Reading.setWebTitle(src, sel.title)
  Reading.stage(src, { page: 0, quote: sel.md ?? sel.text, web, direct: true })
  await Reading.send(src, prompt)
}

/**
 * 自己加的那颗：选中的这段带进这个网页那一处的 AI（中间开着 PDF、HTML 的进它的），照那颗的提示词问；
 * 写进笔记的答完一块 [!ai] 写进正在剪进去的那篇（块头写那颗的名字），只在 AI 栏答的不写
 */
async function runOwnWeb(sel: WebSel, prompt: string, name: string, out: 'note' | 'answer', to: Convo | null = null) {
  const web = webOf(sel)
  const extra = { cmd: name, ...(out === 'answer' ? { noNote: true as const } : {}) }
  const doc = H().readingDoc()
  // 进别的一段对话（to，同引用）：普通对话带着这段直接问那颗的提示词、答在那里；读 PDF 那一套的照下面进它
  const other = !doc && to ? readSrc(to.key) : null
  if (!doc && to) {
    H().showAi()
    showConvo(to)
    if (!other) return feedConvo(to.key, quoteMat(sel), prompt)
  }
  const src = doc ?? other ?? `web:${sel.url}`
  if (!to || doc) H().askIn(src)
  await Reading.load(src)
  if (!doc && !other) Reading.setWebTitle(src, sel.title)
  Reading.stage(src, { page: /\.pdf$/i.test(src) ? Reading.get(src).state.page : 0, quote: sel.md ?? sel.text, web, direct: true, ...extra })
  const sent = Reading.send(src, prompt)
  if (out === 'answer' && !other) H().notice(t('答在右栏 AI 里，没动笔记'), { act: { label: t('回网页'), icon: 'globe', run: () => H().showWeb() } })
  await sent
}

/** × 的小菜单「这个网站不弹」：记进库里的名单；底栏带撤回、改名单 */
async function muteSiteOf(url: string) {
  const site = siteKey(url)
  if (!site) return
  const undo = await updateBar((b) => muteSite(b, site, today()))
  H().notice(withKeys(t('{site} 不再弹小条，选了字按 {k:enter}、{k:quote-selection} 照样能用', { site })), { act: { label: t('改名单'), icon: 'list-selection', run: () => openBarSettings({ view: 'list', focus: 'sites' }) }, undo: () => void undo() })
}

/** × 的小菜单「哪里都不弹」：关掉总开关；底栏带撤回、在设置里打开 */
async function muteAll() {
  const undo = await updateBar((b) => ({ ...b, enabled: false }))
  H().notice(t('哪里都不弹小条了'), { act: { label: t('在设置里打开'), icon: 'settings-gear', run: () => openBarSettings({ view: 'list', focus: 'on' }) }, undo: () => void undo() })
}

/** 引用的那一块：来源写那段上面的小标题「6.1.2.1 平移不变性 · zh.d2l.ai」，带网址（回到那一段） */
const quoteMat = (sel: WebSel): Material => ({ kind: 'quote', text: (sel.md ?? sel.text).trim().slice(0, 20_000), src: backLabel(sel), url: sel.url })

/** 引用：这段成为那一处 AI 输入框顶上的一块材料，光标进去（to：进别的一段对话） */
async function quoteWeb(sel: WebSel, at: PopAnchor, to: Convo | null = null) {
  const mat = quoteMat(sel)
  const doc = H().readingDoc()
  if (doc) {
    H().askIn(doc)
    return Reading.addMaterial(doc, mat)
  }
  if (to) return intoConvo(to, sel)
  if (!(await ensureAsk(sel.url, at))) return
  const src = `web:${sel.url}`
  H().askIn(src)
  await Reading.load(src)
  Reading.setWebTitle(src, sel.title)
  Reading.addMaterial(src, mat)
}

// ---------------------------------------------------------------- 剪藏

/** 剪下来的一段写成什么：引文 + 「—— [小标题 · 书名](回到这一段的链接)」 */
/** 剪下来的写 md（公式 $…$、代码块，webview-md.ts）；回到这一段的链接照网页上看得到的字 */
export const clipMdOf = (c: Clip & { head?: string; md?: string }) => clipMarkdown(c.md ?? c.text, sourceLabel(c), fragmentUrl(c.url, c.text))
// 网页里选中的字拖进文档、白板：写成和点「剪藏」同一块（web/image-drop.ts）
setWebClipMd((c) => clipMdOf(c))

/**
 * 剪藏：写进这个网页正在剪进去的那篇。还没定时：中间开着能写的文档就问一句（默认它）；中间是白板、首页、PDF 就照旧剪成卡片进收件箱
 */
export async function clipWeb(c: Clip & { head?: string }, at: PopAnchor) {
  const to = await clipTarget(c, at)
  if (to === null) return
  return clipTo(c, to)
}

/** 照剪到哪写：一篇插进去，收件箱、文件夹剪成一张卡片 */
function clipTo(c: Clip & { head?: string }, to: ClipDest) {
  if (to === 'inbox') return inboxCard(c, undefined)
  if (typeof to === 'object') return inboxCard(c, to.dir)
  return clipInto(c, to)
}

/**
 * 剪到哪：这个网站选了文件夹、收件箱的进它；配好对的那篇；还没定时问一句（默认中间开着的那篇），中间是白板、首页、PDF 进收件箱；
 * 问的时候选了文件夹，这个网站以后都进它（同「记到这篇」记住）；取消了是 null
 */
async function clipTarget(c: Clip, at: PopAnchor): Promise<ClipDest | null> {
  const now = clipDestNow(c.url)
  if (now) return now
  const center = H().center()
  if (!center) return 'inbox'
  const w = await askWhere({ kind: 'clip', at, center, notes: H().notes() })
  if (!w) return null
  if (w.kind === 'dir') {
    setChosen(c.url, { dir: w.path })
    notesChanged()
    return { dir: w.path }
  }
  if (w.kind !== 'doc') return 'inbox'
  await choose(c.url, w.path)
  return w.path
}

/**
 * 那篇里已经剪过这一段（这一页剪的、引着的原文一样）：给那一块的 md（「跳到那一处」照它找）；没剪过是 null
 */
async function clippedBefore(path: string, md: string, url: string): Promise<string | null> {
  const mine = webEntries(md, url)[0]
  if (!mine) return null
  const text = await noteText(path)
  const hit = webEntries(text, url).find((e) => e.kind === 'clip' && e.quote === mine.quote)
  return hit ? text.split('\n').slice(hit.line, hit.keyAt + 1).join('\n') : null
}

/**
 * 剪进那篇（光标处或末尾），底栏说剪到了哪，带「换一篇」「撤回」。
 * 同一段已经剪进这篇了：不写第二份，底栏「这段已经剪过了」带「跳到那一处」「再剪一份」（again：点了「再剪一份」，照写）
 */
async function clipInto(c: Clip & { head?: string }, path: string, again = false) {
  const md = clipMdOf(c)
  const before = again ? null : await clippedBefore(path, md, c.url)
  if (before !== null)
    return H().notice(t('这段已经剪过了'), {
      act: { label: t('跳到那一处'), icon: 'go-to-file', run: () => H().peek(path, before) },
      more: { label: t('再剪一份'), icon: 'add', run: () => void clipInto(c, path, true).catch((e: unknown) => H().notice(errText(e))) },
    })
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

/**
 * 网页里的图剪进了一篇（拖进文档、右键「剪进文档」，网页图拖进对话）：和剪藏一样记下时间、活动；
 * 这个网页还没定记到哪篇时就记进这篇（拖进来就是选了它），网页上那张图标「剪过」
 */
function imgClipped(path: string, md: string, url: string) {
  void window.cn.logActivity('clip', path)
  noteTime(path, md)
  if (host && !targetNow(url) && !inboxFor(url) && folderFor(url) === null) setChosen(url, path)
  notesChanged()
  clipped(path)
}
if (typeof window !== 'undefined')
  window.addEventListener(WEB_IMG_CLIPPED, (e) => {
    const d = (e as CustomEvent<{ path: string; md: string; url: string }>).detail
    imgClipped(d.path, d.md, d.url)
  })

/**
 * 剪成卡片进收件箱：⌘S 进收件箱、网页右键选字「剪成卡片」都走这里（卡片一字不差，来源带回到这一段的链接、字是 md）。
 * 这个网站选了文件夹时进那个文件夹（写法一样，剪藏去处 2026-11-25）
 */
export function inbox(c: Clip & { md?: string }) {
  return inboxCard(c, folderFor(c.url) ?? undefined)
}

/** 剪成一张卡片进收件箱（dir 给了进那个文件夹） */
async function inboxCard(c: Clip & { md?: string }, dir: string | undefined) {
  await H().clipToInbox({ text: c.md ?? c.text, url: fragmentUrl(c.url, c.text), title: c.title }, dir)
  clipped(dir === undefined ? 'inbox' : `dir:${dir}`)
}

/**
 * 网页右键图「剪成卡片」（剪藏去处 2026-11-25「网页图片也能剪进收件箱」）：收件箱（这个网站选了文件夹时进它）新建一张卡片，
 * 图存进卡片的附件，说明是图注、来源一行回到那张图（同右键「剪进文档」的图）
 */
export async function imgCard(img: WebImgInfo) {
  const dir = folderFor(img.url)
  const clip = imgClip(img)
  await window.cn.clipImageCard({ src: img.src, alt: clip.alt, title: clip.source.title, url: clip.source.url, ...(/^https?:/i.test(img.src) ? { name: img.src } : {}), ...(dir !== null ? { folder: dir } : {}) })
  clipped(dir === null ? 'inbox' : `dir:${dir}`)
  notesChanged()
  H().refresh()
  H().notice(dir === null ? t('图剪成卡片，放进收件箱了') : t('图剪成卡片，放进「{dir}」了', { dir: dirLabel(dir) }))
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
    if (w.kind === 'dir') {
      setChosen(c.url, { dir: w.path })
      await inboxCard(c, w.path)
      notesChanged()
      return H().notice(t('挪进「{dir}」了，剪成了一张卡片', { dir: dirLabel(w.path) }))
    }
    if (w.kind !== 'doc') {
      await inboxCard(c, undefined)
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

/**
 * 「⋯ › 剪到哪篇…」：换这个网站剪进哪篇（以后讲解、引用、剪藏都记进它）；
 * 选「剪成卡片，放进收件箱」：这个网站以后剪进收件箱（选过的那篇、配好对的都不用了，配对本身不动）；
 * 选「放进一个文件夹…」：这个网站以后每剪一次一张卡片进那个文件夹（同收件箱的写法）
 */
export async function pickTarget(url: string, at: PopAnchor): Promise<Where | null> {
  const cur = targetNow(url) ?? chosenFor(url)
  // 网页占满时（小牌「换一篇…」）中间那篇看不见，照样算「中间开着的」那一项
  const w = await askWhere({ kind: 'clip', at, center: H().center() ?? H().full()?.note ?? null, notes: H().notes(), current: cur, inbox: inboxFor(url), dir: folderFor(url), site: true })
  if (w) await setDest(url, w)
  return w
}

/** 这个网站以后剪到哪（「剪到哪篇…」、地址栏小牌里选的）：一篇顺手配成一对；底栏说一句 */
export async function setDest(url: string, w: Where) {
  if (w.kind === 'doc') {
    await choose(url, w.path)
    H().notice(`这个网站以后记进《${titleOf(w.path)}》`)
  } else if (w.kind === 'inbox') {
    setChosen(url, 'inbox')
    notesChanged()
    H().notice(t('这个网站以后剪进收件箱'))
  } else if (w.kind === 'dir') {
    setChosen(url, { dir: w.path })
    notesChanged()
    H().notice(t('这个网站以后剪进「{dir}」，一段一张卡片', { dir: dirLabel(w.path) }))
  }
}

// ---------------------------------------------------------------- 问完写进剪藏那篇

/**
 * 一问写进那篇本身（2026-11-24 偏好「剪藏和AI笔记同一篇」「一篇里混排舒服」）：网页、视频的问答写进剪藏那篇 / 「记到哪」那篇，
 * 看着的文档的问答写进它自己（AiPanel）。md 是主进程拼好的那几行（@cn/format renderAsk：问的那句、引用带回到网页那段的来源、图、AI 回答框）。
 * 中间看得见那篇时插在光标处，不然接在末尾（同剪藏，write.ts）；一问一次提交；写在末尾时底栏说一句，带「在笔记里看」
 */
export async function writeAskInto(note: string, md: string, o: { files: string[]; subject: string }): Promise<void> {
  const wrote = await put(note, md.trimEnd(), false)
  noteTime(note, md)
  notesChanged()
  const title = titleOf(note)
  const q = o.subject.replace(/\s+/g, ' ').trim()
  // 不翻：提交说明（写进 Git）
  await window.cnReading.commit([note, ...o.files], `笔记：${title} · ${[...q].length > 40 ? [...q].slice(0, 40).join('') + '…' : q}`)
  if (!host) return
  H().refresh()
  if (wrote.where === 'end') H().notice(t('记进《{title}》末尾', { title }), H().notesShown() ? undefined : { act: { label: t('在笔记里看'), icon: 'note', run: () => H().showNote(note, md.split('\n')[0]) } })
}

// 记了一问、撤回了一问：右栏「笔记」那几条重读
if (typeof window !== "undefined") window.addEventListener(Reading.NOTE_WRITTEN, () => notesChanged())

/** 「已记进《…》」点了：在那篇里定位到这一问，右栏网页不换（以前走通用的打开笔记，配对的网页跟着跳回书的开头） */
export function showAskIn(path: string, msg: number) {
  H().showAsk(path, msg)
}

/**
 * 网页、视频那一处写进哪篇：网页是配成一对的剪藏那篇（还没定就贴着 AI 输入框问一句；选了「这次只问，不记」= 把网页的「记笔记」关掉），
 * 视频由视频那边定（video/note-parent.ts）
 */
Reading.setNoteParents({
  now: (kind, url) => (kind === 'web' ? (host ? targetNow(url) : null) : videoParentNow(url)),
  async ask(kind, url, title) {
    if (kind === 'video') return videoParent(url, title)
    if (!host) return null
    if (!targetNow(url) && !(await ensureAsk(url, composerAnchor()))) return null
    return targetNow(url)
  },
  put: (note, md, o) => writeAskInto(note, md, o),
})

/**
 * 别的一段对话（看文档、首页……，AiPanel）里问的带着网页上引的一段：网页的「记笔记」开着、这个网页定了记进哪篇时，这一问写进那篇
 * （偏好「引用留在当前对话」以后，引用进了右栏正开着的那段对话，以前就不记了：原因见 ai-web-stay.ts）
 */
export function webNoteTo(url: string): string | null {
  if (!host || !/^https?:/i.test(url) || !noteSwitchNow('web').main) return null
  return targetNow(url)
}
