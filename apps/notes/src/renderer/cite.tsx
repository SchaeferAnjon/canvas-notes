/**
 * AI 回答里的引用能点开（task-3e53q，用户：「他列举出来的文档、某一行、某一段、网页上的某一段……我都能直接按 Command 点开」）。
 * md-render.tsx 把 [字](链接)、[[双链]] 画成 <a class="cite">（以前 [字](链接) 是一个光秃秃的 <u>，点了什么都不做）。
 * 这里在整个窗口上接住点它：AI 对话、旁支、读 PDF 的 AI、讲解卡、AI 块的旁支、白板卡、视频问框，哪里画的都一样：
 * - 点一下：贴着它出一张预览卡（标题 + 引到的那几行 / 网址 / 第几页），卡上「打开 ⌘点」「新标签打开 ⇧⌘点」「拷贝链接」；
 * - ⌘点：打开，和文档里 ⌘点链接一样（笔记、PDF 在中间开标签；网页在右栏；回到 AI 对话）；
 * - ⇧⌘点：笔记、PDF 开在后面的新标签（不切走，切过去时再滚到那几行）；网页在中间栏开。
 * 指哪一篇、哪几行按 @cn/format 的 citeOf / citeOfWiki 认；相对谁认：最近的 [data-cite-base]（白板、读 PDF 笔记写着这篇的路径），没有是库根目录（AI 的工作目录）。
 * 只读的文档（梦游对照的两栏、收下后的样子，task-x7mk6）里的双链、链接、图片、「第 N 页」走 citeClicks，同一套点法和预览卡。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { anchorLines, type Cite, type CiteAnchor, type CiteMiss, citeOf, citeOfWiki, pageLinkOf } from '@cn/format'
import { type Extension } from '@codemirror/state'
import { type EditorView, ViewPlugin } from '@codemirror/view'
import { useEffect, useState } from 'react'
import { t } from '../shared/i18n'
import { parseFragment } from '../shared/web-link'
import { titleOf } from '../shared/layout'
import { app } from './ctx/actions'
import { linkAt } from './ctx/editor-menu'
import { copy } from './ctx/menu'
import { Popover } from './editor-host'
import { goToLines, whenShown } from './goto-line'
import { keyFor } from './keys'
import { prettyUrl } from './md-link'
import { openPageLink } from './page-link'
import * as Reading from './reading/store'
import { Favicon } from './web/favicons'

/** 梦游分支上才有的文件（还没收下的一条新建的、挪去改名后的）：路径 → 开哪次提交里的那份 */
export type BranchFiles = ReadonlyMap<string, string>

/** 库里没有、梦游分支上有（task-x7mk6）：开梦游分支上那一份，和梦游对照文件条上「打开「x」· 梦游分支上的」一样 */
type OnBranch = { kind: 'branch'; path: string; rev: string }
type Found = Cite | CiteMiss | OnBranch

let root: Promise<string> | null = null
const vaultRoot = () => (root ??= window.cn.vault().then((v) => v?.path ?? ''))

/** 写在笔记 base 里（AI 回答给空串）的一个链接指什么；库里找不到再按梦游分支上的找 */
export async function findCite(link: { href?: string; wiki?: string; label?: string }, base: string, branch?: BranchFiles): Promise<Found> {
  const [all, r] = await Promise.all([window.cnFiles.all(), vaultRoot()])
  const files = all.filter((f) => f.kind !== 'dir').map((f) => f.path)
  const find = (fs: readonly string[]) => {
    const ctx = { base, root: r, files: fs }
    return link.wiki !== undefined ? citeOfWiki(link.wiki, ctx) : citeOf(link.href ?? '', ctx, link.label)
  }
  const c = find(files)
  if (c.kind !== 'missing' || !branch?.size) return c
  const have = new Set(files)
  const only = [...branch.keys()].filter((p) => !have.has(p))
  if (!only.length) return c
  const b = find([...files, ...only])
  return (b.kind === 'note' || b.kind === 'file' || b.kind === 'pdf') && !have.has(b.path) && branch.has(b.path) ? { kind: 'branch', path: b.path, rev: branch.get(b.path)! } : c
}

const anchorText = (a: CiteAnchor) => ('line' in a ? (a.end > a.line ? `第 ${a.line}–${a.end} 行` : `第 ${a.line} 行`) : 'block' in a ? `^${a.block} 那一段` : `「${a.heading}」那一段`)

/** open：⌘点；behind：⇧⌘点（开在后面的新标签，不切走）；wide：⌥⌘点（网页在中间栏开，和文档里一样） */
export type CiteHow = 'open' | 'behind' | 'wide'

/** 点的时候按着哪几个键 → 怎么开 */
export const howOf = (e: { shiftKey: boolean; altKey: boolean }): CiteHow => (e.shiftKey ? 'behind' : e.altKey ? 'wide' : 'open')

/**
 * 打开引用。网页没有「开在后面」：⇧⌘、⌥⌘ 都在中间栏开；笔记、PDF 的 ⌥⌘ 和 ⌘ 一样。
 * 笔记带了几行 / 标题 / 块：开好后滚到那里、闪一下；找不到那一处底栏说一句（照样开着）
 */
export function openCite(c: Found, how: CiteHow = 'open', label = '') {
  const a = app()
  const behind = how === 'behind'
  switch (c.kind) {
    case 'missing':
      return a.notice(`库里没找到「${c.label}」`)
    case 'outside':
      return a.notice(`这个文件不在库里：${c.path}`)
    case 'web':
      if (how !== 'open') return a.openWide(c.url, label || undefined)
      return parseFragment(c.url) ? a.openWebAt(c.url) : a.openInWeb(c.url, c.url)
    case 'chat':
      return a.openChat(c.key, c.msg)
    case 'branch':
      // 梦游那边（dream/wire.tsx）接：md 开那一版（只读），HTML 开梦游分支上那份
      return void window.dispatchEvent(new CustomEvent('cn:dream-open-branch', { detail: { path: c.path, rev: c.rev } }))
    case 'file':
      return behind ? a.openFileBehind(c.path) : a.openFile(c.path)
    case 'pdf': {
      const { path, page, rect } = c
      if (!behind) return page ? a.openPdfAt(path, page, rect) : a.openFile(path)
      a.openFileBehind(path)
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
    case 'note': {
      if (behind) a.openFileBehind(c.path)
      else a.openFile(c.path)
      const anchor = c.anchor
      if (!anchor) return
      void goToLines(c.path, (text) => anchorLines(text, anchor), { later: behind }).then((r) => {
        if (!r) a.notice(`《${titleOf(c.path)}》里没找到${anchorText(anchor)}，开在上次看到的地方`)
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
  // 回答滚了：卡对不上那个链接了
  window.addEventListener('scroll', (e) => pop?.open && !pop.el.contains(e.target as Node) && hideCiteCard(), true)
  return pop
}

/** 引到的几行：笔记里那几行（最多 6 行），没写哪几行是正文开头 4 行（标题、属性、空行跳过） */
function excerpt(text: string, anchor?: CiteAnchor): { lines: string[]; more: number; at: string | null } | null {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (anchor) {
    const r = anchorLines(text, anchor)
    if (!r) return null
    const lines = all.slice(r.from - 1, r.to).filter((l) => l.trim())
    return { lines: lines.slice(0, 6), more: Math.max(0, lines.length - 6), at: r.to > r.from ? `第 ${r.from}–${r.to} 行` : `第 ${r.from} 行` }
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

function CiteCard({ c, label }: { c: Found; label: string }) {
  const [text, setText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const notePath = c.kind === 'note' ? c.path : null
  const branchMd = c.kind === 'branch' && /\.md$/i.test(c.path) ? c : null
  useEffect(() => {
    if (!notePath && !branchMd) return
    let live = true
    // 梦游分支上的：读那次提交里的那份
    const read = branchMd ? window.cn.diffFiles({ kind: 'version', hash: branchMd.rev, path: branchMd.path }).then((r) => r.files[0]?.after ?? '') : window.cn.readNote(notePath!).then((n) => n.text)
    read.then((x) => live && setText(x)).catch(() => live && setText(''))
    return () => void (live = false)
  }, [notePath, branchMd?.path, branchMd?.rev])
  const href = c.kind === 'web' ? c.url : c.kind === 'note' || c.kind === 'pdf' || c.kind === 'file' || c.kind === 'branch' ? c.path : ''
  const go = (how: CiteHow) => (hideCiteCard(), openCite(c, how, label))
  const folder = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '库根目录')

  let icon: CodiconName = 'file'
  let title = label
  let sub = ''
  if (c.kind === 'note') {
    title = titleOf(c.path)
    sub = folder(c.path)
  } else if (c.kind === 'pdf') {
    icon = 'file-pdf'
    title = c.path.split('/').pop()!
    sub = folder(c.path) + (c.page ? ` · 第 ${c.page} 页` : '')
  } else if (c.kind === 'file') {
    title = c.path.split('/').pop()!
    sub = folder(c.path)
  } else if (c.kind === 'web') {
    sub = prettyUrl(c.url.replace(/#.*$/, ''))
  } else if (c.kind === 'chat') {
    icon = 'comment-discussion'
    sub = 'AI 对话里的一条回答'
  } else if (c.kind === 'branch') {
    icon = 'git-branch'
    title = /\.md$/i.test(c.path) ? titleOf(c.path) : c.path.split('/').pop()!
    sub = t('梦游分支上的 · 收下后才在库里')
  } else {
    icon = 'warning'
    sub = c.kind === 'outside' ? `不在库里：${c.path}` : '库里没找到这一篇'
  }
  const ex = c.kind === 'note' && text !== null ? excerpt(text, c.anchor) : c.kind === 'branch' && text ? excerpt(text) : null
  const quote = c.kind === 'web' ? parseFragment(c.url)?.text : undefined
  const open = c.kind === 'chat' ? '回到对话' : c.kind === 'web' ? '右栏打开' : c.kind === 'branch' ? t('打开分支上那份') : '打开'
  const second = c.kind === 'web' ? '中间栏打开' : '新标签打开'
  const canOpen = c.kind !== 'missing' && c.kind !== 'outside'
  return (
    <div className="lk-card cite-card" role="dialog" aria-label="引用">
      <div className="top">
        {c.kind === 'web' ? <Favicon url={c.url} size={14} /> : <Codicon name={icon} size={14} />}
        <b>{title || label}</b>
      </div>
      <div className="u" title={href || undefined}>
        {sub}
        {ex?.at && <span className="at">{` · ${ex.at}`}</span>}
      </div>
      {c.kind === 'note' && text !== null && !ex && c.anchor && <div className="ex miss">{`没找到${anchorText(c.anchor)}，打开后在上次看到的地方`}</div>}
      {ex && ex.lines.length > 0 && (
        <div className={'ex' + (c.kind === 'note' && c.anchor ? ' hit' : '')}>
          {ex.lines.map((l, i) => (
            <p key={i}>{plainLine(l)}</p>
          ))}
          {ex.more > 0 && <p className="more">{`还有 ${ex.more} 行`}</p>}
        </div>
      )}
      {quote && (
        <div className="ex hit">
          <p>{quote}</p>
        </div>
      )}
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
            {copied ? '已拷贝' : '拷贝'}
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
  p.show(<CiteCard key={Date.now()} c={c} label={label} />, { left, top: r.top, bottom: r.bottom })
}

const linkOf = (el: HTMLElement) => ({ href: el.dataset.href, wiki: el.dataset.wiki, label: el.textContent ?? '' })
const baseOf = (el: HTMLElement) => el.closest<HTMLElement>('[data-cite-base]')?.dataset.citeBase ?? ''

/** 整个窗口接住点 a.cite（main.tsx 里装一次） */
export function installCiteClicks() {
  window.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('a.cite')
      if (!el || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      // 「第 4 页」那种页码小牌：点一下就翻过去（和读 PDF、白板上一样），不出预览卡
      const mod = e.metaKey || e.ctrlKey || el.classList.contains('pg')
      // 同一个链接上再点一下：收起卡
      if (!mod && showingEl === el && pop?.open) return hideCiteCard()
      void findCite(linkOf(el), baseOf(el)).then((c) => {
        if (!el.isConnected) return
        if (!mod) return showCard(el, c)
        hideCiteCard()
        openCite(c, howOf(e), el.textContent ?? '')
      })
    },
    true,
  )
  // 文档里 ⌘点、链接卡「打开」、右键「打开」库里的链接（ctx/editor-menu.ts 的 openLinkHit 发来）：带 #L12、#标题 的开了滚到那里；库里没有的照旧开（新建）
  window.addEventListener('cn:open-link', (e) => {
    const d = (e as CustomEvent<{ note: string; href: string; label: string; local: string; behind?: boolean }>).detail
    void findCite({ href: d.href, label: d.label }, d.note).then((c) => (c.kind === 'missing' ? app().openFile(d.local) : openCite(c, d.behind ? 'behind' : 'open', d.label)))
  })
  // 白板卡上的链接：按下不拖卡、不选卡（点了是看引用）
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('a.cite')
      if (el && e.button === 0 && el.closest('.bcard, .db-card')) e.stopPropagation()
    },
    true,
  )
  // ⇧⌘点链接：按下时不把回答里从上次光标到这里的字选上（⇧ 点本来是扩选区）
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 0 && e.shiftKey && (e.target as Element | null)?.closest?.('a.cite')) e.preventDefault()
    },
    true,
  )
}

// ---------- 只读的文档（梦游对照，task-x7mk6） ----------

/** 文件地址 cn-file://vault/<路径> → 库里的相对路径 */
const vaultPathOf = (src: string) => (src.startsWith('cn-file://vault/') ? src.slice('cn-file://vault/'.length).split('/').map(decodeURIComponent).join('/') : null)

/** 点着的是哪个链接：el 是贴预览卡的那个元素；page：「第 N 页」那种（点一下就翻过去，不出卡）在文里的位置 */
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
 * 点一下出预览卡；⌘点打开（笔记到那几行、PDF 到那页）；⇧⌘点开在后面的新标签；网页 ⌥⌘点在中间栏开；「第 N 页」点一下就翻过去。
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
      const mod = e.metaKey || e.ctrlKey
      const { link } = h
      if (h.page !== undefined) {
        hideCiteCard()
        // 写了哪份 PDF 的按引用开（⇧⌘ 开在后面）；光写 #page=N 的按这篇的来源找是哪份
        if (pageLinkOf(base, link.href!)?.file) void findCite(link, base).then((c) => openCite(c, mod ? howOf(e) : 'open', link.label))
        else openPageLink(base, link.href!, view.state.doc.toString(), h.page, link.label)
        return
      }
      // 同一个链接上再点一下：收起卡
      if (!mod && showingEl === h.el && pop?.open) return hideCiteCard()
      void findCite(link, base, branch?.()).then((c) => {
        if (!h.el.isConnected) return
        if (!mod) return showCard(h.el, c, link.label)
        hideCiteCard()
        openCite(c, howOf(e), link.label)
      })
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
