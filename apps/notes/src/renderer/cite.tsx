/**
 * AI 回答里的引用能点开（task-3e53q，用户：「他列举出来的文档、某一行、某一段、网页上的某一段……我都能直接按 Command 点开」）。
 * md-render.tsx 把 [字](链接)、[[双链]] 画成 <a class="cite">（以前 [字](链接) 是一个光秃秃的 <u>，点了什么都不做）。
 * 这里在整个窗口上接住点它：AI 对话、旁支、读 PDF 的 AI、讲解卡、AI 块的旁支、白板卡、视频问框，哪里画的都一样：
 * - 点一下：贴着它出一张预览卡，右上角小字写是哪种东西（笔记 / PDF / 网页 / 白板卡 / 数据库 / 待办 / 历史），卡上「打开 ⌘点」「新标签打开 ⇧⌘点」「拷贝」；
 * - ⌘点：打开（笔记滚到那几行、PDF 翻到那页框闪、白板转到那张卡外圈亮、数据库一行在右栏「记录」开、待办那一行闪、一次提交开对比标签；网页在右栏）；
 *   中间换了一篇，右栏 AI 不跟着换对话（ai-stay.ts，已定 3）；
 * - ⇧⌘点：开在后面的新标签（不切走，切过去时再滚、再闪），底栏说一句；网页 ⌥⌘点在中间栏开。
 * 「第 N 页」页码小牌和别的链接一样：点一下出卡（那页缩略图、框画出来），⌘点再翻过去（已定 1）。
 * 指哪一篇、哪几行按 @cn/format 的 citeOf / citeOfWiki 认；相对谁认：最近的 [data-cite-base]（白板、读 PDF 笔记写着这篇的路径），没有是库根目录（AI 的工作目录）。
 * 是笔记的再细认一层（refine）：「白板.md#^卡号」是白板卡，「笔记.md#L12」那一行是 - [ ] 的是待办，数据库数据源文件夹里的一篇是数据库一行。
 * 只读的文档（梦游对照的两栏、收下后的样子，task-x7mk6）里的双链、链接、图片、「第 N 页」走 citeClicks，同一套点法和预览卡。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { anchorLines, boardCardOf, type Cite, type CiteAnchor, type CiteMiss, citeOf, citeOfWiki, notePdfCandidates, pageLinkOf, recordFields, type Rect } from '@cn/format'
import { parseTaskLine } from '@cn/tasks'
import { type Extension } from '@codemirror/state'
import { type EditorView, ViewPlugin } from '@codemirror/view'
import { type ReactNode, useEffect, useState } from 'react'
import type { CommitInfo } from '../shared/api'
import type { FileEntry } from '../shared/files'
import { t } from '../shared/i18n'
import { type TodoItem, whenText } from '../shared/todo'
import { when } from '../shared/when'
import { parseFragment } from '../shared/web-link'
import { titleOf } from '../shared/layout'
import { citeAuto } from './cite-names'
import { stayAi } from './ai-stay'
import { loadBaseCtx } from './base/layout-ctx'
import { openRecord } from './base/record-open'
import { app } from './ctx/actions'
import { linkAt } from './ctx/editor-menu'
import { copy } from './ctx/menu'
import { usePdfPage } from './doc-board/pdf-page'
import { Popover } from './editor-host'
import { goToLines, whenShown } from './goto-line'
import { keyFor } from './keys'
import { prettyUrl } from './md-link'
import { wantView } from './note-mode'
import * as Reading from './reading/store'
import { flyToCard } from './shell/OutlineView'
import { isoToday, tickTodo } from './todo/store'
import { Favicon } from './web/favicons'

/** 梦游分支上才有的文件（还没收下的一条新建的、挪去改名后的）：路径 → 开哪次提交里的那份 */
export type BranchFiles = ReadonlyMap<string, string>

/** 库里没有、梦游分支上有（task-x7mk6）：开梦游分支上那一份，和梦游对照文件条上「打开「x」· 梦游分支上的」一样 */
type OnBranch = { kind: 'branch'; path: string; rev: string }
/** PDF 带修改时间（预览卡上那页的缩略图按它缓存） */
type PdfCite = Extract<Cite, { kind: 'pdf' }> & { mtimeMs: number }
/** 白板里的一张卡：「白板.md#^卡号」 */
type BoardCite = { kind: 'board'; path: string; id: string }
/** 数据库一行（一行就是一篇）：src 是它所在的数据库块（```base 里那段 YAML），folder 是数据源文件夹 */
type RowCite = { kind: 'row'; path: string; src: string; folder: string }
/** 待办一条：「待办.md#L12」那一行是 - [ ]；line 从 1 数 */
type TodoCite = { kind: 'todo'; path: string; line: number }
type Found = Exclude<Cite, { kind: 'pdf' }> | PdfCite | BoardCite | RowCite | TodoCite | CiteMiss | OnBranch

let root: Promise<string> | null = null
const vaultRoot = () => (root ??= window.cn.vault().then((v) => v?.path ?? ''))

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const readText = (path: string) => window.cn.readNote(path).then((n) => n.text)

/** 认成了库里一篇笔记的，再看它是不是白板卡、待办、数据库一行；PDF 带上修改时间 */
async function refine(c: Cite | CiteMiss, all: readonly FileEntry[]): Promise<Found> {
  if (c.kind === 'pdf') return { ...c, mtimeMs: all.find((f) => f.path === c.path)?.mtimeMs ?? 0 }
  if (c.kind !== 'note') return c
  const a = c.anchor
  if (a && 'block' in a) return boardCardOf(await readText(c.path), a.block) !== null ? { kind: 'board', path: c.path, id: a.block } : c
  if (a && 'line' in a) {
    if (a.end !== a.line) return c
    const raw = (await readText(c.path)).replace(/\r\n/g, '\n').split('\n')[a.line - 1]
    return raw !== undefined && parseTaskLine(raw) ? { kind: 'todo', path: c.path, line: a.line } : c
  }
  if (a) return c
  const folder = folderOf(c.path)
  const base = (await window.cn.boardBases()).find((b) => b.folder === folder)
  return base ? { kind: 'row', path: c.path, src: base.src, folder } : c
}

/** 写在笔记 base 里（AI 回答给空串）的一个链接指什么；库里找不到再按梦游分支上的找 */
export async function findCite(link: { href?: string; wiki?: string; label?: string }, base: string, branch?: BranchFiles): Promise<Found> {
  const [all, r] = await Promise.all([window.cnFiles.all(), vaultRoot()])
  const files = all.filter((f) => f.kind !== 'dir').map((f) => f.path)
  const find = (fs: readonly string[]) => {
    const ctx = { base, root: r, files: fs }
    return link.wiki !== undefined ? citeOfWiki(link.wiki, ctx) : citeOf(link.href ?? '', ctx, link.label)
  }
  const c = find(files)
  if (c.kind !== 'missing' || !branch?.size) return refine(c, all)
  const have = new Set(files)
  const only = [...branch.keys()].filter((p) => !have.has(p))
  if (!only.length) return c
  const b = find([...files, ...only])
  return (b.kind === 'note' || b.kind === 'file' || b.kind === 'pdf') && !have.has(b.path) && branch.has(b.path) ? { kind: 'branch', path: b.path, rev: branch.get(b.path)! } : c
}

/** 读 PDF 的 AI 回答里光写页码的「[第 4 页](#page=4)」：开着的那份 PDF 的那一页 */
async function pageOfOpenPdf(path: string, page: number): Promise<Found> {
  const f = (await window.cnFiles.all()).find((x) => x.path === path)
  return { kind: 'pdf', path, page, mtimeMs: f?.mtimeMs ?? 0 }
}

/** 笔记里的「[第 4 页](x.pdf#page=4&rect=…)」「[第 4 页](#page=4)」：光写页码的按这篇的来源、旁边同名的、前后最近的页码链接找是哪份 PDF */
async function pageCite(note: string, href: string, text: string, pos: number, label: string): Promise<Found> {
  const a = pageLinkOf(note, href)!
  if (a.file) return findCite({ href, label }, note)
  const pdfs = (await window.cnFiles.all()).filter((f) => f.kind === 'pdf')
  const want = notePdfCandidates(note, text, pos)
  // 写的路径在库里没有（PDF 挪过）：按名字找
  const f = want.map((p) => pdfs.find((q) => q.path === p)).find(Boolean) ?? want.map((p) => pdfs.find((q) => baseName(q.path) === baseName(p))).find(Boolean)
  if (!f) return { kind: 'missing', label }
  return { kind: 'pdf', path: f.path, page: a.page, ...(a.rect ? { rect: a.rect } : {}), mtimeMs: f.mtimeMs }
}

const lineText = (from: number, to: number) => (to > from ? t('第{from}–{to}行', { from, to }) : t('第{line}行', { line: from }))
const anchorText = (a: CiteAnchor) => ('line' in a ? lineText(a.line, a.end) : 'block' in a ? t('^{block} 那一段', { block: a.block }) : t('「{heading}」那一段', { heading: a.heading }))

/** open：⌘点；behind：⇧⌘点（开在后面的新标签，不切走）；wide：⌥⌘点（网页在中间栏开，和文档里一样） */
export type CiteHow = 'open' | 'behind' | 'wide'

/** 点的时候按着哪几个键 → 怎么开 */
export const howOf = (e: { shiftKey: boolean; altKey: boolean }): CiteHow => (e.shiftKey ? 'behind' : e.altKey ? 'wide' : 'open')

/** 白板开好后（开在后面的等它切到前面）转到那张卡、外圈亮一下，不选中 */
function revealCard(path: string, id: string) {
  const t0 = Date.now()
  const find = () => {
    const host = [...document.querySelectorAll<HTMLElement>('[data-cite-base]')].find((x) => x.dataset.citeBase === path)
    const el = host?.querySelector(`[data-id="${CSS.escape(id)}"]`)
    if (el) return whenShown(el, () => requestAnimationFrame(() => flyToCard(path, id, { select: false })))
    if (Date.now() - t0 < 6000) setTimeout(find, 50)
  }
  find()
}

/**
 * 打开引用。网页没有「开在后面」：⇧⌘、⌥⌘ 都在中间栏开；笔记、PDF 的 ⌥⌘ 和 ⌘ 一样。
 * 笔记带了几行 / 标题 / 块：开好后滚到那里、闪一下；找不到那一处底栏说一句（照样开着）。
 * from：cite 是 AI 回答里点的（中间换了一篇右栏 AI 不跟着换，已定 3）；doc 是文档里 ⌘点链接（照旧跟着换）
 */
export function openCite(c: Found, how: CiteHow = 'open', label = '', from: 'cite' | 'doc' = 'cite') {
  const a = app()
  const behind = how === 'behind'
  if (from === 'cite' && !behind && c.kind !== 'chat' && c.kind !== 'row') stayAi()
  const back = (path: string) => behind && a.noticeBehind(t('《{name}》开在后面的标签里了', { name: /\.md$/i.test(path) ? titleOf(path) : baseName(path) }), (x) => 'path' in x && x.path === path)
  switch (c.kind) {
    case 'missing':
      return a.notice(t('库里没找到「{label}」', { label: c.label }))
    case 'outside':
      return a.notice(t('这个文件不在库里：{path}', { path: c.path }))
    case 'web':
      if (how !== 'open') return a.openWide(c.url, label || undefined)
      return parseFragment(c.url) ? a.openWebAt(c.url) : a.openInWeb(c.url, c.url)
    case 'chat':
      return a.openChat(c.key, c.msg)
    case 'branch':
      // 梦游那边（dream/wire.tsx）接：md 开那一版（只读），HTML 开梦游分支上那份
      return void window.dispatchEvent(new CustomEvent('cn:dream-open-branch', { detail: { path: c.path, rev: c.rev } }))
    case 'file':
      if (!behind) return a.openFile(c.path)
      a.openFileBehind(c.path)
      return back(c.path)
    case 'commit':
      return void window.cn.commitInfo(c.hash).then((info) => {
        if (!info) return a.notice(t('历史里没有这次提交：{hash}', { hash: c.hash.slice(0, 7) }))
        a.openDiff({ kind: 'commit', hash: info.hash }, `${info.subject.slice(0, 24)} · ${info.hash.slice(0, 7)}`, behind)
        if (behind) a.noticeBehind(t('这次改动开在后面的标签里了'), (x) => x.type === 'diff' && x.src.kind === 'commit' && x.src.hash === info.hash)
      })
    case 'row':
      // 和数据库里点一行一样：右栏「记录」开这一行；⇧⌘ 是这一篇开在后面的新标签
      if (!behind) return openRecord({ path: c.path, src: c.src })
      a.openFileBehind(c.path)
      return back(c.path)
    case 'board':
      wantView(c.path, 'board')
      if (behind) a.openFileBehind(c.path)
      else a.openFile(c.path)
      back(c.path)
      return revealCard(c.path, c.id)
    case 'pdf': {
      const { path, page, rect } = c
      if (!behind) return page ? a.openPdfAt(path, page, rect) : a.openFile(path)
      a.openFileBehind(path)
      back(path)
      if (!page) return
      // 后面的标签藏着，翻页滚不动：等它切到前面再翻
      const t0 = Date.now()
      const find = () => {
        const el = [...document.querySelectorAll<HTMLElement>('section.pdfpane')].find((x) => x.dataset.path === path)
        if (el) return whenShown(el, () => Reading.jumpTo(path, page, rect))
        if (Date.now() - t0 < 4000) setTimeout(find, 50)
      }
      return find()
    }
    case 'todo':
    case 'note': {
      if (behind) a.openFileBehind(c.path)
      else a.openFile(c.path)
      back(c.path)
      const anchor = c.kind === 'todo' ? { line: c.line, end: c.line } : c.anchor
      if (!anchor) return
      void goToLines(c.path, (text) => anchorLines(text, anchor), { later: behind }).then((r) => {
        if (!r) a.notice(t('《{name}》里没找到{where}，开在上次看到的地方', { name: titleOf(c.path), where: anchorText(anchor) }))
      })
    }
  }
}

// ---------- 预览卡 ----------

let pop: Popover | null = null
let showingEl: HTMLElement | null = null

export function hideCiteCard() {
  showingEl = null
  pop?.hide()
}

function popover(): Popover {
  if (pop) return pop
  pop = new Popover('lk-card-host')
  // esc 只收卡（旁支、问框这些照旧开着）
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !pop?.open) return
      e.preventDefault()
      e.stopPropagation()
      hideCiteCard()
    },
    true,
  )
  window.addEventListener('pointerdown', (e) => pop?.open && !pop.el.contains(e.target as Node) && !showingEl?.contains(e.target as Node) && hideCiteCard(), true)
  // 链接所在的那一栏滚了（回答滚了）：卡对不上那个链接了。别处滚（中间的 PDF 正翻着页）不收
  window.addEventListener(
    'scroll',
    (e) => {
      const at = e.target as Node
      if (pop?.open && !pop.el.contains(at) && (at === document || !showingEl || at.contains(showingEl))) hideCiteCard()
    },
    true,
  )
  return pop
}

/** 引到的几行：笔记里那几行（最多 6 行），没写哪几行是正文开头 4 行（标题、属性、空行跳过） */
function excerpt(text: string, anchor?: CiteAnchor): { lines: string[]; more: number; at: string | null } | null {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (anchor) {
    const r = anchorLines(text, anchor)
    if (!r) return null
    const lines = all.slice(r.from - 1, r.to).filter((l) => l.trim())
    return { lines: lines.slice(0, 6), more: Math.max(0, lines.length - 6), at: lineText(r.from, r.to) }
  }
  const fm = /^---\n[\s\S]*?\n---(\n|$)/.exec(text)
  const body = (fm ? text.slice(fm[0].length) : text).split('\n')
  const lines = body.filter((l) => l.trim() && !/^#\s/.test(l) && !/^<!--.*-->\s*$/.test(l)).slice(0, 4)
  return { lines, more: 0, at: null }
}

/** 一行引到的字：去掉行首的标题号、列表号、引文号，链接只留字（卡里不画 md） */
const plainLine = (l: string) =>
  l
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\s\^[\w-]+\s*$/, '')
    .replace(/(\*\*|==|~~|`)/g, '')

/** 读一样东西给卡用：还在读是 null（失败照样抛出来，不吞） */
function useLoad<T>(key: string | null, load: () => Promise<T>): [T | null, () => void] {
  const [got, setGot] = useState<{ key: string; v: T } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (key === null) return
    let live = true
    void load().then((v) => live && setGot({ key, v }))
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])
  return [key !== null && got?.key === key ? got.v : null, () => setTick((n) => n + 1)]
}

const folderName = (p: string) => folderOf(p) || t('库根目录')

/** 右上角小字：是哪种东西 */
function kindName(c: Found): string | null {
  switch (c.kind) {
    case 'note':
      return t('笔记', { ctx: '引用种类' })
    case 'pdf':
      return 'PDF'
    case 'web':
      return t('网页', { ctx: '引用种类' })
    case 'board':
      return t('白板卡', { ctx: '引用种类' })
    case 'row':
      return t('数据库', { ctx: '引用种类' })
    case 'todo':
      return t('待办', { ctx: '引用种类' })
    case 'commit':
      return t('历史', { ctx: '引用种类' })
    case 'file':
      return t('文件', { ctx: '引用种类' })
    case 'chat':
      return t('AI 对话', { ctx: '引用种类' })
    case 'branch':
      return t('梦游', { ctx: '引用种类' })
    default:
      return null
  }
}

/** PDF 那一页的缩略图：按卡宽画，框在的那一截滚到当中，框画出来（强调色描边 + 淡底）；没框是那页上面一截 */
const THUMB_H = 132
function PdfThumb({ c }: { c: PdfCite }) {
  const page = c.page ?? 1
  const url = usePdfPage(c.path, c.mtimeMs, page, 720)
  const [w, setW] = useState(0)
  const [ratio, setRatio] = useState(0)
  if (url === 'failed') return null
  const h = w * ratio
  const r = c.rect
  const off = r && h > THUMB_H ? Math.min(Math.max(0, (r[1] + r[3] / 2) * h - THUMB_H / 2), h - THUMB_H) : 0
  return (
    <div className="thumb" ref={(el) => void (el && el.clientWidth !== w && setW(el.clientWidth))} data-testid="cite-thumb">
      {url && <img src={url} alt="" style={{ top: -off }} onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} />}
      {r && ratio > 0 && <span className="box" style={{ left: `${r[0] * 100}%`, width: `${r[2] * 100}%`, top: r[1] * h - off, height: r[3] * h }} />}
    </div>
  )
}

/** 白板卡：那张卡本身（第一行粗体当标题 + 下面两行） */
function BoardBody({ c }: { c: BoardCite }) {
  const [text] = useLoad(`${c.path}#${c.id}`, () => readText(c.path))
  if (text === null) return null
  const card = boardCardOf(text, c.id)
  if (card === null) return <div className="ex miss">{t('白板里没有这张卡了')}</div>
  const lines = card
    .split('\n')
    .filter((l) => l.trim() && !/^<!--.*-->\s*$/.test(l))
    .map(plainLine)
  return (
    <div className="bc" data-testid="cite-board-card">
      <b>{lines[0]}</b>
      {lines.slice(1, 3).map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  )
}

/** 数据库一行：表头前四列的属性 */
function RowBody({ c }: { c: RowCite }) {
  const [fields] = useLoad(`${c.path}\n${c.src}`, async () => recordFields(await loadBaseCtx(c.src), c.path, 0).slice(0, 4))
  if (!fields?.length) return null
  return (
    <div className="rows" data-testid="cite-row">
      {fields.map((f) => [
        <span key={f.col.id + ':k'} className="k">
          {f.col.label}
        </span>,
        <span key={f.col.id + ':v'}>{f.cell.text || '—'}</span>,
      ])}
    </div>
  )
}

/** 待办一条：勾选框能直接勾（底栏「撤回」，⌘Z 也行）+ 那一条 + 日子 */
function TodoBody({ c }: { c: TodoCite }) {
  const [text, reload] = useLoad(`${c.path}#${c.line}`, () => readText(c.path))
  const [busy, setBusy] = useState(false)
  if (text === null) return null
  const raw = text.replace(/\r\n/g, '\n').split('\n')[c.line - 1] ?? ''
  const task = parseTaskLine(raw)
  if (!task) return <div className="ex miss">{t('这一行已经不是待办了')}</div>
  const tick = async () => {
    if (busy) return
    setBusy(true)
    const item: TodoItem = { key: `${c.path}#${c.line - 1}`, id: task.id, path: c.path, line: c.line - 1, raw, title: task.title, done: task.done, cancelled: task.cancelled, doing: task.doing, dupOf: null, dups: [], date: task.date, time: task.time, remind: task.remind, repeat: task.repeat, prio: task.prio, parent: null }
    await tickTodo(item)
    setBusy(false)
    reload()
  }
  return (
    <div className="td">
      <button className={'bx' + (task.done ? ' on' : '')} role="checkbox" aria-checked={task.done} aria-label={task.done ? t('取消勾选「{title}」', { title: task.title }) : t('勾掉「{title}」', { title: task.title })} onClick={() => void tick()}>
        {task.done && <Codicon name="check" size={11} />}
      </button>
      <span className="tt">
        <span className={task.done ? 'done' : undefined}>{task.title}</span>
        {task.date && <span className="due">{whenText(task.date, task.time, isoToday())}</span>}
      </span>
    </div>
  )
}

/** 一次提交改了哪几篇（最多列 4 篇）和加减行数 */
function CommitFiles({ info }: { info: CommitInfo }) {
  const files = info.files.slice(0, 4)
  return (
    <div className="files" data-testid="cite-commit-files">
      {files.map((f) => (
        <div key={f.path}>
          <Codicon name={/\.pdf$/i.test(f.path) ? 'file-pdf' : 'file'} size={12} />
          <span className="nm">{/\.md$/i.test(f.path) ? titleOf(f.path) : baseName(f.path)}</span>
          {f.added > 0 && <span className="pl">{`+${f.added}`}</span>}
          {f.removed > 0 && <span className="mi">{`−${f.removed}`}</span>}
        </div>
      ))}
      {info.files.length > files.length && <div className="more">{t('还有{n}篇', { n: info.files.length - files.length })}</div>}
    </div>
  )
}

function CiteCard({ c, label, el }: { c: Found; label: string; el?: HTMLElement }) {
  const [copied, setCopied] = useState(false)
  const notePath = c.kind === 'note' ? c.path : null
  const branchMd = c.kind === 'branch' && /\.md$/i.test(c.path) ? c : null
  // 梦游分支上的：读那次提交里的那份
  const [text] = useLoad(notePath ?? (branchMd ? `${branchMd.rev}:${branchMd.path}` : null), () =>
    branchMd ? window.cn.diffFiles({ kind: 'version', hash: branchMd.rev, path: branchMd.path }).then((r) => r.files[0]?.after ?? '') : readText(notePath!),
  )
  const [info] = useLoad(c.kind === 'commit' ? c.hash : null, () => window.cn.commitInfo((c as { hash: string }).hash))
  const href =
    c.kind === 'web'
      ? c.url
      : c.kind === 'commit'
        ? `canvas-notes://commit/${c.hash}`
        : c.kind === 'board'
          ? `${c.path}#^${c.id}`
          : c.kind === 'todo'
            ? `${c.path}#L${c.line}`
            : c.kind === 'note' || c.kind === 'pdf' || c.kind === 'file' || c.kind === 'branch' || c.kind === 'row'
              ? c.path
              : ''
  const go = (how: CiteHow) => (hideCiteCard(), openCite(c, how, label))

  let icon: CodiconName = 'file'
  let title = label
  let sub: ReactNode = ''
  let at: string | null = null
  let body: ReactNode = null
  let open = t('打开')
  switch (c.kind) {
    case 'note':
      title = titleOf(c.path)
      sub = folderName(c.path)
      break
    case 'pdf':
      icon = 'file-pdf'
      title = baseName(c.path)
      sub = folderName(c.path) + (c.page ? ' · ' + t('第{page}页', { page: c.page }) : '')
      body = <PdfThumb c={c} />
      if (c.page) open = t('翻到这页')
      break
    case 'file':
      title = baseName(c.path)
      sub = folderName(c.path)
      break
    case 'board':
      icon = 'layout'
      title = titleOf(c.path)
      sub = folderName(c.path) + ' · ' + t('白板里的一张卡')
      body = <BoardBody c={c} />
      open = t('打开白板')
      break
    case 'row':
      icon = 'database'
      title = titleOf(c.path)
      sub = (baseName(c.folder) || t('库根目录')) + ' · ' + t('一行', { ctx: '数据库' })
      body = <RowBody c={c} />
      open = t('打开这一行')
      break
    case 'todo':
      icon = 'checklist'
      title = titleOf(c.path)
      sub = folderName(c.path)
      at = lineText(c.line, c.line)
      body = <TodoBody c={c} />
      break
    case 'commit':
      icon = 'git-commit'
      title = info?.subject ?? label
      sub = info ? [when(Date.parse(info.date), { time: true }), info.hash.slice(0, 7), t('改了{n}篇', { n: info.files.length })].join(' · ') : c.hash.slice(0, 7)
      body = info && info.files.length > 0 && <CommitFiles info={info} />
      open = t('看这次改动')
      break
    case 'web':
      sub = prettyUrl(c.url.replace(/#.*$/, ''))
      open = t('右栏打开')
      break
    case 'chat':
      icon = 'comment-discussion'
      sub = t('AI 对话里的一条回答')
      open = t('回到对话')
      break
    case 'branch':
      icon = 'git-branch'
      title = /\.md$/i.test(c.path) ? titleOf(c.path) : baseName(c.path)
      sub = t('梦游分支上的 · 收下后才在库里')
      open = t('打开分支上那份')
      break
    default:
      icon = 'warning'
      sub = c.kind === 'outside' ? t('不在库里：{path}', { path: c.path }) : t('库里没找到这一篇')
  }
  const ex = c.kind === 'note' && text !== null ? excerpt(text, c.anchor) : c.kind === 'branch' && text ? excerpt(text) : null
  at ??= ex?.at ?? null
  const quote = c.kind === 'web' ? parseFragment(c.url)?.text : undefined
  const second = c.kind === 'web' ? t('中间栏打开') : t('新标签打开')
  const canOpen = c.kind !== 'missing' && c.kind !== 'outside'
  const kind = kindName(c)
  // 软件按名字认的（cite-names.tsx）：多一行小字说为什么认，和「不是这篇」
  const auto = citeAuto(el ?? null, hideCiteCard)
  return (
    <div className={`lk-card cite-card k-${c.kind}`} role="dialog" aria-label={t('引用')}>
      <div className="top">
        {c.kind === 'web' ? <Favicon url={c.url} size={14} /> : <Codicon name={icon} size={14} />}
        <b>{title || label}</b>
        {kind && <span className="kind">{kind}</span>}
      </div>
      <div className="u" title={href || undefined}>
        {sub}
        {at && <span className="at">{` · ${at}`}</span>}
      </div>
      {c.kind === 'note' && text !== null && !ex && c.anchor && <div className="ex miss">{t('没找到{where}，打开后在上次看到的地方', { where: anchorText(c.anchor) })}</div>}
      {ex && ex.lines.length > 0 && (
        <div className={'ex' + (c.kind === 'note' && c.anchor ? ' hit' : '')}>
          {ex.lines.map((l, i) => (
            <p key={i}>{plainLine(l)}</p>
          ))}
          {ex.more > 0 && <p className="more">{t('还有{n}行', { n: ex.more })}</p>}
        </div>
      )}
      {quote && (
        <div className="ex hit">
          <p>{quote}</p>
        </div>
      )}
      {auto}
      {body}
      <div className="acts">
        {canOpen && (
          <button onClick={() => go('open')}>
            <Codicon name={c.kind === 'chat' ? 'comment-discussion' : c.kind === 'web' ? 'layout-sidebar-right' : 'go-to-file'} size={13} />
            {open} <span className="k">{keyFor('cmd-click')}</span>
          </button>
        )}
        {canOpen && c.kind !== 'chat' && c.kind !== 'branch' && (
          <button onClick={() => go(c.kind === 'web' ? 'wide' : 'behind')}>
            <Codicon name={c.kind === 'web' ? 'layout-centered' : 'multiple-windows'} size={13} />
            {second} <span className="k">{keyFor(c.kind === 'web' ? 'cmd-alt-click' : 'cmd-shift-click')}</span>
          </button>
        )}
        {href && (
          <button onClick={() => void copy(href).then(() => setCopied(true))}>
            <Codicon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? t('已拷贝') : t('拷贝')}
          </button>
        )}
      </div>
    </div>
  )
}

/** 预览卡收在链接所在的这一栏里（右栏 AI、白板、中间文档），离两边 8；栏窄时卡跟着窄 */
function showCard(el: HTMLElement, c: Found, label = el.textContent ?? '') {
  const r = el.getBoundingClientRect()
  showingEl = el
  const col = (el.closest('aside, [role="complementary"], .board, .pane') ?? document.body).getBoundingClientRect()
  const p = popover()
  const w = Math.min(372, col.width - 16)
  p.el.style.setProperty('--cite-w', `${w}px`)
  const left = Math.max(col.left + 8, Math.min(r.left, col.right - 8 - w))
  p.show(<CiteCard key={Date.now()} c={c} label={label} el={el} />, { left, top: r.top, bottom: r.bottom })
}

/** 点一下出卡（同一个链接上再点一下收起）；⌘点、⇧⌘点、⌥⌘点按 openCite 开 */
function clickCite(e: MouseEvent, el: HTMLElement, found: () => Promise<Found>, label: string) {
  const mod = e.metaKey || e.ctrlKey
  if (!mod && showingEl === el && pop?.open) return hideCiteCard()
  const how = howOf(e)
  void found().then((c) => {
    if (!el.isConnected) return
    if (!mod) return showCard(el, c, label)
    hideCiteCard()
    openCite(c, how, label)
  })
}

/**
 * 笔记里光写页码的「[第 3 页](#page=3)」画在白板卡里（读 PDF 笔记切成的白板、问答卡）：和别的引用一样点一下出卡、⌘点翻过去（已定 1）。
 * note：这块白板是哪篇；text、pos：全文和这张卡在哪（按前后找是哪份 PDF）
 */
export function clickPage(e: MouseEvent, el: HTMLElement, note: string, href: string, text: string, pos: number) {
  const label = el.textContent ?? ''
  clickCite(e, el, () => pageCite(note, href, text, pos, label), label)
}

const linkOf = (el: HTMLElement) => ({ href: el.dataset.href, wiki: el.dataset.wiki, label: el.textContent ?? '' })
const baseOf = (el: HTMLElement) => el.closest<HTMLElement>('[data-cite-base]')?.dataset.citeBase ?? ''

/** 整个窗口接住点 a.cite（main.tsx 里装一次） */
export function installCiteClicks() {
  window.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('a.cite, a.pg[data-page]')
      if (!el || e.button !== 0) return
      // 读 PDF 的 AI 回答里光写页码的「第 4 页」（开着的那份 PDF，[data-cite-pdf] 写着是哪份）；别处这种页码小牌（读 PDF 笔记、白板卡里）各自接
      const pdf = el.classList.contains('cite') ? null : (el.closest<HTMLElement>('[data-cite-pdf]')?.dataset.citePdf ?? null)
      if (!el.classList.contains('cite') && !pdf) return
      e.preventDefault()
      e.stopPropagation()
      const label = el.textContent ?? ''
      clickCite(e, el, () => (pdf ? pageOfOpenPdf(pdf, Number(el.dataset.page)) : findCite(linkOf(el), baseOf(el))), label)
    },
    true,
  )
  // 文档里 ⌘点、链接卡「打开」、右键「打开」库里的链接（ctx/editor-menu.ts 的 openLinkHit 发来）：带 #L12、#标题 的开了滚到那里；库里没有的照旧开（新建）
  window.addEventListener('cn:open-link', (e) => {
    const d = (e as CustomEvent<{ note: string; href: string; label: string; local: string; behind?: boolean }>).detail
    void findCite({ href: d.href, label: d.label }, d.note).then((c) => (c.kind === 'missing' ? app().openFile(d.local) : openCite(c, d.behind ? 'behind' : 'open', d.label, 'doc')))
  })
  // 白板卡上的链接：按下不拖卡、不选卡（点了是看引用）
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('a.cite, a.pg[data-page]')
      if (el && e.button === 0 && el.closest('.bcard, .db-card')) e.stopPropagation()
    },
    true,
  )
  // ⇧⌘点链接：按下时不把回答里从上次光标到这里的字选上（⇧ 点本来是扩选区）
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 0 && e.shiftKey && (e.target as Element | null)?.closest?.('a.cite, [data-cite-pdf] a.pg[data-page]')) e.preventDefault()
    },
    true,
  )
}

// ---------- 只读的文档（梦游对照，task-x7mk6） ----------

/** 文件地址 cn-file://vault/<路径> → 库里的相对路径 */
const vaultPathOf = (src: string) => (src.startsWith('cn-file://vault/') ? src.slice('cn-file://vault/'.length).split('/').map(decodeURIComponent).join('/') : null)

/** 点着的是哪个链接：el 是贴预览卡的那个元素；page：「第 N 页」那种在文里的位置（光写 #page=N 的按它前后找是哪份 PDF） */
type Hit = { el: HTMLElement; link: { href?: string; wiki?: string; label: string }; page?: number }

function hitAt(view: EditorView, e: MouseEvent, base: string): Hit | null {
  const target = e.target as HTMLElement
  // 双链：改了的那几个字另包一层（cm-changedText），一个双链会拆成几截，每截都带 data-wiki
  const wiki = target.closest<HTMLElement>('.cm-wikilink')
  if (wiki) return { el: wiki, link: { wiki: wiki.dataset.wiki ?? '', label: wiki.dataset.target ?? wiki.textContent ?? '' } }
  // 画成图的附件（只认点在图上：右上角「在访达中显示」、下面的说明不算）
  const img = target.closest<HTMLImageElement>('.cm-image img')
  if (img) {
    const src = img.getAttribute('src') ?? ''
    return { el: img, link: { href: vaultPathOf(src) ?? src, label: img.alt } }
  }
  const at = (pos: number | null, el: HTMLElement): Hit | null => {
    if (pos === null) return null
    const line = view.state.doc.lineAt(pos)
    const h = linkAt(line.text, pos - line.from)
    if (!h) return null
    if (h.kind === 'wiki') return { el, link: { wiki: h.target, label: h.target } }
    const label = h.kind === 'url' ? h.text : ''
    return { el, link: { href: h.url, label }, ...(pageLinkOf(base, h.url) ? { page: pos } : {}) }
  }
  const link = target.closest<HTMLElement>('.cm-link')
  if (link) return at(view.posAtDOM(link, 0), link)
  // 没画成链接的原文（视频块里的 ![图](…) 这种）：按着 ⌘ 时也认，和文档里 ⌘点一样
  if (e.metaKey || e.ctrlKey) return at(view.posAtCoords({ x: e.clientX, y: e.clientY }), target)
  return null
}

/**
 * 只读的文档里的链接接上同一套点法（梦游对照的改前、收下后两栏，收下后的样子，可能重复的两篇；task-x7mk6）：
 * 点一下出预览卡；⌘点打开（笔记到那几行、PDF 到那页）；⇧⌘点开在后面的新标签；网页 ⌥⌘点在中间栏开；「第 N 页」也是先出卡（那页缩略图），⌘点再翻过去。
 * base：这一栏是哪篇（相对链接按它认）；branch：梦游分支上才有的文件（库里找不到时开分支上那份）。
 * 在编辑器外框上抢先接（捕获）：按下就让编辑器挪光标的话，实时预览把光标那一行换回原文，链接那一截没了，松手时点不到它；
 * 画成图的附件是挂件，编辑器的 domEventHandlers 不收挂件里的点击。合一里删掉的段是套在里面的小编辑器，各接各的
 */
export function citeClicks(base: string, branch?: () => BranchFiles): Extension {
  return ViewPlugin.define((view) => {
    const mine = (e: MouseEvent) => e.button === 0 && (e.target as Element).closest('.cm-editor') === view.dom
    const down = (e: MouseEvent) => {
      if (!mine(e) || !hitAt(view, e, base)) return
      // 不挪光标、不选字（⇧ 点也不扩选区）
      e.preventDefault()
      e.stopPropagation()
    }
    const click = (e: MouseEvent) => {
      if (!mine(e)) return
      const h = hitAt(view, e, base)
      if (!h) return
      e.preventDefault()
      e.stopPropagation()
      const { link } = h
      const pos = h.page
      clickCite(e, h.el, () => (pos !== undefined ? pageCite(base, link.href!, view.state.doc.toString(), pos, link.label) : findCite(link, base, branch?.())), link.label)
    }
    view.dom.addEventListener('mousedown', down, true)
    view.dom.addEventListener('click', click, true)
    return {
      destroy() {
        view.dom.removeEventListener('mousedown', down, true)
        view.dom.removeEventListener('click', click, true)
      },
    }
  })
}

/** 按住 ⌘ 悬停弹出那一篇（task-hqula，peek/peek.tsx）用这几个认链接，和点一下、⌘点认的是同一个东西 */
export { pageCite, pageOfOpenPdf, type Found }
