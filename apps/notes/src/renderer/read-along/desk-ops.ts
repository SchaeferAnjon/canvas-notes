/**
 * 存成书桌（task-kbnc0 方向 B，原型 proto.html#scene=b）：一张书桌记下中间开着哪几篇、右栏哪几个网页、各读到哪、样子
 * （左栏、网页、中间栏开没开）；点一张就回到那一套，换之前的样子是左栏最上面那张「刚才」，底栏「回到刚才」、⌘Z、后退都回得去。开着的那张（这次开软件里）改动自动记下：
 * 读到哪、多开的标签。网页是配好对的那本书时，读到哪用 读到哪.json 那一份（书桌里只记是哪本书）。
 * 文件在库里 .canvas-notes/书桌/<名字>.json，跟着 Git 走（main/read-along.ts）。
 */
import type { CodiconName } from '@cn/design'
import { booksOf, type Desk, deskJson, deskSummary, type DeskTab, inBook, type PagePos, sameDesk } from '../../shared/read-along'
import type { WebDeskApi } from '../WebPanel'
import type { WebTabs } from '../web/web-tabs'
import { headOf } from './pairing'
import { t as tNow } from '../../shared/i18n'
import { awayNow, deskOnNow, desksNow, loadDesks, pairBooks, pairOf, positionOf, setAway, setDeskOn, usePairs } from './store'
import type { Went } from './web'

export interface DeskLayout {
  /** 左栏开着 */
  left: boolean
  /** 右栏网页开着、在前面 */
  web: boolean
  /** 中间栏开着（收起中间栏时网页占满） */
  center: boolean
}

export interface DeskHost {
  notice(text: string, opts?: { undo?: () => void; act?: { label: string; icon: CodiconName; run(): void } }): void
  /** 中间开着的笔记（按标签先后）和在前面的那篇 */
  center(): { notes: string[]; active: string | null }
  /** 中间换成这几篇；返回换之前的样子（回到刚才的样子用） */
  setCenter(notes: string[], active: string | null): unknown
  restoreCenter(prev: unknown): void
  web(): WebDeskApi | null
  layout(): DeskLayout
  /** 照书桌摆：返回摆之前的样子 */
  setLayout(l: DeskLayout): DeskLayout
  /** 右栏几栏、网页在不在前面写成一句（存的时候列出来） */
  layoutText(): string
  /** 左栏换到「书桌」 */
  showDesks(): void
  /** 收起底栏正中那句提示（切书桌时：前面那句的「撤回」不再占着 ⌘Z） */
  quiet(): void
  /** 后退历史里下一个走到的位置（切书桌时记下：后退退到这之前就是回到刚才） */
  navAt(): number
}

let host: DeskHost | null = null
export const setDeskHost = (h: DeskHost) => void (host = h)
const H = () => {
  if (!host) throw new Error('软件还没准备好')
  return host
}
/** 存成书桌对话框要的本事（App 每次画完交进来的那一份） */
export const deskHost = H
const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 一个网页标签记成什么：配好对的书记「这本书」，别的记自己读到哪 */
function tabOf(t: { url: string; title: string; pos: PagePos | null }, books: Iterable<string>): DeskTab {
  const book = booksOf(books, t.url)[0]
  if (book) return { url: t.url, title: t.title, book }
  return { url: t.url, title: t.title, ...(t.pos ? { pos: t.pos } : {}) }
}

/** 现在的样子写成一张书桌；pick：要带的网页标签（存的时候勾的） */
export function snapshotDesk(name: string, books: Iterable<string>, pick?: (id: string) => boolean, notes?: (p: string) => boolean, layout = true, auto = true): Desk {
  const h = H()
  const c = h.center()
  const w = h.web()?.snapshot() ?? { tabs: [], active: null }
  const tabs = w.tabs.filter((t) => !pick || pick(t.id))
  const list = c.notes.filter((p) => !notes || notes(p))
  const ai = tabs.findIndex((t) => t.id === w.active)
  const d: Desk = { name, notes: list, web: tabs.map((t) => tabOf(t, books)), auto, saved: new Date().toISOString() }
  if (c.active && list.includes(c.active)) d.active = c.active
  if (ai >= 0) d.webActive = ai
  if (layout) {
    const l = h.layout()
    d.layout = { left: l.left, web: l.web, ...(l.center ? {} : { center: false }) }
  }
  return d
}

/** 存一张新的：底栏能撤回（删掉这张） */
export async function saveNewDesk(d: Desk): Promise<void> {
  const h = H()
  // 左栏马上换到「书桌」：等存好、列好再换的话，这中间用户点了别的（左栏「文件」）会被拉回来
  h.showDesks()
  let file: string
  try {
    file = await window.cnRead.saveDesk(d)
  } catch (e) {
    return h.notice(errText(e))
  }
  await loadDesks()
  const name = desksNow().find((x) => x.file === file)?.desk.name ?? d.name
  if (d.auto) turnOn(file)
  h.notice(`存好了书桌「${name}」：${d.notes.length} 篇笔记、${d.web.length} 个网页`, {
    undo: () =>
      void window.cnRead.removeDesk(file).then(
        () => (setDeskOn(deskOnNow() === file ? null : deskOnNow()), void loadDesks(), h.notice('撤回了')),
        (e) => h.notice(errText(e)),
      ),
  })
}

/** 书桌里一个网页回到哪：配好对的书用 读到哪.json 那一份，别的用书桌自己记的 */
function posOfTab(t: DeskTab): { url: string; pos: PagePos | null } {
  if (t.book) {
    const p = positionOf(t.book)
    if (p && inBook(t.book, p.url)) return { url: p.url, pos: p }
    return { url: t.url, pos: null }
  }
  return { url: t.url, pos: t.pos ?? null }
}

/** 换之前的样子原样（这次开软件里切的才有）：中间的标签、右栏网页、样子、开着的是哪一张 */
interface Exact {
  center: unknown
  web: WebTabs | null
  layout: DeskLayout | null
  on: string | null
}

/** 中间、右栏换成这一套，前面那个网页回到读到的那段（landed：回到的那段的小标题，没回到是 null）；返回换之前的样子 */
function applyDesk(d: Desk, landed: (head: string | null) => void): Exact {
  const h = H()
  const prev: Exact = { center: h.setCenter(d.notes, d.active ?? null), web: null, layout: null, on: deskOnNow() }
  const web = h.web()
  const at = Math.min(d.webActive ?? 0, Math.max(0, d.web.length - 1))
  const front = d.web[at]
  const frontPos = front ? posOfTab(front) : null
  const say = (how?: Went['how']) => landed(frontPos?.pos && (how === 'exact' || how === 'fuzzy') ? headOf(frontPos.pos) : null)
  if (d.layout) prev.layout = h.setLayout({ left: d.layout.left, web: d.layout.web && d.web.length > 0, center: d.layout.center !== false })
  if (web && d.web.length) prev.web = web.replace(d.web.map((t) => ({ title: t.title, ...posOfTab(t) })), at, frontPos?.pos ? (how) => say(how) : undefined)
  if (!frontPos?.pos) say()
  return prev
}

/**
 * 点一张：中间、右栏换成那一套，前面那个网页回到读到的那段。换之前的样子记成「刚才」（左栏书桌最上面一张，只留最近一张）；
 * 底栏一直有「已切到书桌「…」· 回到刚才」，⌘Z、后退也回得去（以前只有底栏 10 秒的「回到刚才的样子」，过了就回不去了）
 */
export function openDesk(file: string) {
  const h = H()
  const e = desksNow().find((x) => x.file === file)
  if (!e) return h.notice('这张书桌已经不在了')
  const d = e.desk
  const before = snapshotDesk(tNow('刚才', { ctx: '书桌' }), pairBooks(), undefined, undefined, true, false)
  const navAt = h.navAt()
  // 前面那句（比如刚存好书桌的「撤回」）收起：这时 ⌘Z 是回到刚才，不是撤回那一句
  h.quiet()
  // 切到了哪张底栏左边那句一直说着；提示只说网页回到了哪段（设计复审：以前两句同时说「打开了书桌」）
  const exact = applyDesk(d, (head) => head && h.notice(`网页回到「${head}」那段`))
  if (d.auto) turnOn(file)
  setAway({ name: d.name, desk: before, exact, navAt, quiet: false })
}

/** 回到刚才（底栏、⌘Z、后退、「刚才」卡）：这次开软件里切的原样放回，重开软件后照「刚才」卡摆 */
export function backToBefore() {
  const a = awayNow()
  if (!a) return
  // 过了一会儿才回：用那时候的软件（App 每次画完交进来的那一份），不用打开书桌时的旧样子
  const h = H()
  setAway(null)
  const x = a.exact as Exact | null
  if (x) {
    h.restoreCenter(x.center)
    if (x.web) h.web()?.restore(x.web)
    if (x.layout) h.setLayout(x.layout)
    if (x.on && desksNow().some((e) => e.file === x.on)) turnOn(x.on)
    else setDeskOn(null)
  } else {
    applyDesk(a.desk, () => {})
    setDeskOn(null)
  }
  // 底栏点完按钮会先收起那一句：下一下再说
  setTimeout(() => h.notice('回到了刚才的样子'))
}

/** 底栏那句 × 掉：「刚才」卡留着 */
export function quietAway() {
  const a = awayNow()
  if (a && !a.quiet) setAway({ ...a, quiet: true })
}

/** 用现在的样子更新：底栏能撤回（放回更新前的） */
export async function updateDesk(file: string, books: Iterable<string>) {
  const h = H()
  const e = desksNow().find((x) => x.file === file)
  if (!e) return
  const before = deskJson(e.desk)
  const d = snapshotDesk(e.desk.name, books, undefined, undefined, !!e.desk.layout, e.desk.auto)
  try {
    await window.cnRead.saveDesk(d, file)
  } catch (err) {
    return h.notice(errText(err))
  }
  await loadDesks()
  h.notice(`书桌「${e.desk.name}」更新成现在的样子了`, {
    undo: () => void window.cnRead.restoreDesk(file, before).then(() => (void loadDesks(), h.notice('撤回了'))),
  })
}

export async function renameDesk(file: string, name: string): Promise<string | null> {
  const h = H()
  try {
    const to = await window.cnRead.renameDesk(file, name)
    if (deskOnNow() === file) setDeskOn(to)
    await loadDesks()
    return to
  } catch (e) {
    h.notice(errText(e))
    return null
  }
}

/** 删掉这张书桌：笔记和网页都不动；底栏能撤回 */
export async function removeDesk(file: string) {
  const h = H()
  const e = desksNow().find((x) => x.file === file)
  let text: string
  try {
    text = await window.cnRead.removeDesk(file)
  } catch (err) {
    return h.notice(errText(err))
  }
  if (deskOnNow() === file) setDeskOn(null)
  await loadDesks()
  const name = e?.desk.name ?? ''
  h.notice(`删掉了书桌「${name}」：笔记和网页都没动`, {
    undo: () =>
      void window.cnRead.restoreDesk(file, text).then(
        () => (void loadDesks(), h.notice('书桌回来了')),
        (err) => h.notice(errText(err)),
      ),
  })
}

/** 这张从什么时候开着：刚打开、刚存好的那几秒里（中间、右栏还在一样样换上来）不自动记 */
let onSince = 0
function turnOn(file: string) {
  onSince = Date.now()
  setDeskOn(file)
}
/** 刚打开的这几秒不记（设计复审：以前打开到一半就记了一遍，右栏网页还没开，样子被记成「网页关着」） */
const SETTLE = 2500

/**
 * 开着的那张自动记下改动（原型「读到哪、多开的标签」）：停手 1.5 秒照现在的写一遍，和文件里一样就不写。
 * 只记中间的几篇、右栏的网页和各读到哪；样子、前面是哪一个不动（那些只在「用现在的样子更新」时改）；
 * 网页、笔记全关了不当成要清空，留着原来的
 */
let autoTimer: ReturnType<typeof setTimeout> | undefined
export function deskChanged(books: Iterable<string>) {
  const file = deskOnNow()
  if (!file || !host) return
  clearTimeout(autoTimer)
  const list = [...books]
  autoTimer = setTimeout(() => {
    if (Date.now() - onSince < SETTLE) return deskChanged(list)
    const e = desksNow().find((x) => x.file === file)
    if (!e || !e.desk.auto || !host || deskOnNow() !== file) return
    const now = snapshotDesk(e.desk.name, list, undefined, undefined, false, true)
    const next: Desk = { ...e.desk, notes: now.notes.length ? now.notes : e.desk.notes, web: now.web.length ? now.web : e.desk.web, saved: now.saved }
    if (next.active && !next.notes.includes(next.active)) delete next.active
    if (next.webActive !== undefined && next.webActive >= next.web.length) delete next.webActive
    if (sameDesk(next, e.desk)) return
    void window.cnRead.saveDesk(next, file).then(() => loadDesks())
  }, 1500)
}

/** 卡片上那一行小字：「1 篇笔记 · 1 个网页」 */
export const summary = (d: Desk) => deskSummary(d)

/** 书桌的网页里哪本书在读（存的时候勾选那一行右边「读到 …」） */
export function readingOf(url: string, pos: PagePos | null, pairs: ReadonlyMap<string, string>): string | null {
  const book = booksOf(pairs.values(), url)[0]
  const p = book ? positionOf(book) : pos
  return p && (book ? inBook(book, p.url) : true) ? headOf(p) : null
}

export { usePairs, pairOf }
