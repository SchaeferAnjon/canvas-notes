/**
 * 文档标题下面的元信息行（DESIGN.v3 6.1）：「收件箱 ▾ · 改于今天 10:34 · 1,240 字」，新建的是「写作 ▾ · 刚建 · 0 字」。
 * 最前面一颗「所在文件夹 ▾」（CN-11）：点开是「移到…」的文件夹菜单，点一项真的挪过去（开着的标签跟着换路径）。
 * 改于什么时候由 NoteTab 按文件的修改时间告诉编辑器（setNoteMeta）；字数按正文数（标题不算，中文一个字一个，英文一个词一个）。
 * 只是编辑器里的装饰，不动文字（打开再保存文件不变）。
 */
import { codiconEl } from '@cn/design'
import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { app } from './ctx/actions'
import { showMenu } from './ctx/menu'
import { moveMenu } from './ctx/move-menu'
import { isBookDigest } from '../shared/plugins/weread'
import { headingOf } from './title-follow'
import { when } from '../shared/when'
import { folderLabel } from './vault-name'
import { faviconEl } from './web/favicons'
import { openChipMenu, openPairPop } from './read-along/ReadAlongLayer'
import { hintKey, hintOff, type Hint, rightPage } from './read-along/store'
import { keyFor } from './keys'
import { t } from '../shared/i18n'
import { INBOX } from '../shared/layout'

/** 这篇改名、挪走以后，NoteDoc 用它告诉编辑器新路径 */
export const setNotePath = StateEffect.define<string>()

/** 文件的修改时间（毫秒）；fresh：这次刚新建的 */
export const setNoteMeta = StateEffect.define<{ mtime?: number; fresh?: boolean }>()

/**
 * 和网页配成一对（task-kbnc0 方向 A）：标题下单独一行「对着看 · 书名 · 读到 2.1.4. 索引和切片」，点开是「对着看」的菜单；
 * 还没配、这周常和一个网站一起开：标题下一句提示（只说一次，× 掉不再提）。NoteTab 按读到哪、右栏开着的网页算好交进来
 */
export interface ReadAlongView {
  chip: { book: string; title: string; at: string | null } | null
  hint: Hint | null
}
export const setReadAlong = StateEffect.define<ReadAlongView>()

/** 正文多少字：标题、frontmatter、注释、md 记号不算；中文一个字算一个，英文、数字一个词算一个 */
export function countWords(text: string): number {
  let body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  body = body.replace(/^# .*(?:\n|$)/, '')
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[^\n]*\n/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
  const cjk = body.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words = body.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + words
}

const thousands = (n: number) => n.toLocaleString('en-US')

/** 剪藏来的那篇 frontmatter 里的 source（网页才算） */
export function sourceOf(text: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text.slice(0, 20000))
  const m = fm && /^source:\s*(https?:\/\/\S+)\s*$/m.exec(fm[1]!)
  return m ? m[1]! : null
}

const hostOfUrl = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 一项：这一项的字，后面跟一个「 · 」（最后一项没有）；整项不折行 */
function item(content: Node, dot: boolean): HTMLElement {
  const it = document.createElement('span')
  it.className = 'cm-meta-item'
  it.append(content)
  if (dot) {
    const sep = document.createElement('span')
    sep.className = 'sep'
    sep.textContent = ' · '
    it.append(sep)
  }
  return it
}

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** 最外层写库名（CN-106） */
const label = folderLabel

/** 每一行在量自己哪一项换了行；行拿掉时停 */
const watching = new WeakMap<HTMLElement, ResizeObserver>()

class FolderChip extends WidgetType {
  constructor(
    readonly path: string,
    /** 「改于今天 10:34」「1,240 字」，一项一个 */
    readonly rest: string[],
    /** 剪藏来的（frontmatter 的 source）：后面写一次「· 剪自 <网站图标> 域名」（cmdk 方案 A：链接后面不再露域名） */
    readonly source: string | null = null,
    /** 和网页配成一对：单独一行「对着看」 */
    readonly ra: ReadAlongView['chip'] = null,
  ) {
    super()
  }
  eq(o: FolderChip) {
    return o.path === this.path && o.rest.join('\n') === this.rest.join('\n') && o.source === this.source && JSON.stringify(o.ra) === JSON.stringify(this.ra)
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-meta'
    // 拖到这一行上的图片、文件：当成拖到标题下面的空行，转给编辑器（插图在那里接）
    box.addEventListener('dragover', (e) => e.preventDefault())
    box.addEventListener('drop', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const below = view.coordsAtPos(Math.min(view.state.doc.length, view.state.doc.lineAt(view.posAtDOM(box)).to + 1))
      view.contentDOM.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, clientX: e.clientX, clientY: below ? below.top + 2 : e.clientY, bubbles: true, cancelable: true }))
    })
    const b = document.createElement('button')
    b.className = 'cm-folder'
    b.type = 'button'
    const here = folderOf(this.path)
    b.setAttribute('aria-label', t('所在文件夹：{name}，点开移到别处', { name: label(here) }))
    // 只写所在的那一层（整条路径标题栏的位置里已经有了），整条路径放在悬停提示里（设计复审）
    b.dataset.tip = here.includes('/') ? t('{path} · 移到…', { path: here.split('/').join(' / ') }) : t('移到…')
    b.dataset.side = 'below'
    const name = document.createElement('span')
    name.className = 'cm-folder-name'
    name.textContent = here ? here.slice(here.lastIndexOf('/') + 1) : label(here)
    b.append(codiconEl(here ? 'folder' : 'library', 13), name, codiconEl('chevron-down', 12))
    // 点它不挪光标、不进编辑
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => {
      const a = app()
      void showMenu(moveMenu([...new Set([...a.allFolders(), INBOX])], here, (f) => a.moveNote(this.path, f)))
    })
    // 每一项（文件夹、改于、字数、剪自）各是一块，整块不拆：放不下时整块换到下一行（偏好「标题下那行不折成竖排」）；
    // 「 · 」跟在前一项后面，下一项换了行时它落在行尾，藏起来（只是看不见，占的宽不变，不会来回跳）
    const host = this.source ? hostOfUrl(this.source) : ''
    box.append(item(b, true))
    const rest = document.createElement('span')
    rest.className = 'cm-meta-rest'
    this.rest.forEach((part, i) => rest.append(item(document.createTextNode(part), i < this.rest.length - 1 || !!host)))
    box.append(rest)
    if (host) {
      const src = document.createElement('span')
      src.className = 'cm-meta-src'
      src.dataset.part = '来源行' // 不翻：data-part 是设计复审圈图认的名字，不显示
      src.title = this.source!
      const label = document.createElement('span')
      label.className = 'cm-meta-host'
      label.textContent = host
      src.append(document.createTextNode(t('剪自')), faviconEl(this.source!, 14), label)
      const it = item(src, false)
      it.classList.add('src')
      box.append(it)
    }
    if (this.ra) box.append(raLine(this.ra, this.path))
    const mark = () => {
      const items = [...box.querySelectorAll<HTMLElement>('.cm-meta-item')]
      items.forEach((it, i) => {
        const next = items[i + 1]
        const end = !!next && next.offsetTop > it.offsetTop + 4
        if (it.classList.contains('end') !== end) it.classList.toggle('end', end)
      })
    }
    const ro = new ResizeObserver(mark)
    ro.observe(box)
    watching.set(box, ro)
    return box
  }
  destroy(dom: HTMLElement) {
    watching.get(dom)?.disconnect()
    watching.delete(dom)
  }
  /** 只有「所在文件夹」按钮自己的事编辑器不管；点这一行别的空处照常把光标放进文档 */
  ignoreEvent(e: Event) {
    return !!(e.target as Element | null)?.closest?.('.cm-folder, .cm-ra')
  }
}

/** 标题下「对着看」那一行：链接图标、对着看、网站图标、书名、读到哪、▾ */
function raLine(ra: NonNullable<ReadAlongView['chip']>, path: string): HTMLElement {
  const line = document.createElement('span')
  line.className = 'cm-meta-ra'
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-ra'
  b.setAttribute('aria-haspopup', 'dialog')
  b.dataset.part = '对着看' // 不翻：data-part 是设计复审圈图认的名字，不显示
  const word = document.createElement('span')
  word.textContent = t('对着看')
  const name = document.createElement('b')
  name.textContent = ra.title
  b.append(codiconEl('link', 12), word, faviconEl(ra.book, 12), name)
  if (ra.at) {
    const at = document.createElement('span')
    at.className = 'ra-at'
    at.textContent = t('· 读到 {at}', { at: ra.at })
    b.append(at)
  }
  b.append(codiconEl('chevron-down', 12))
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', () => openChipMenu(path, b))
  line.append(b)
  return line
}

/** 标题下一句提示：「配成一对？」（还没配）、「存成一张书桌？」（配了一本、又常和别的网站一起开） */
class ReadHint extends WidgetType {
  constructor(
    readonly path: string,
    readonly hint: Hint,
  ) {
    super()
  }
  eq(o: ReadHint) {
    return o.path === this.path && JSON.stringify(o.hint) === JSON.stringify(this.hint)
  }
  toDOM() {
    const h = this.hint
    const wrap = document.createElement('div')
    wrap.className = 'cm-ra-hintw'
    const box = document.createElement('div')
    box.className = 'cm-ra-hint'
    box.setAttribute('role', 'note')
    box.setAttribute('aria-label', h.kind === 'pair' ? t('配成一对？') : t('存成一张书桌？'))
    box.dataset.part = h.kind === 'pair' ? '配对提示' : '书桌提示' // 不翻：data-part 是设计复审圈图认的名字，不显示
    const txt = document.createElement('span')
    txt.className = 't'
    const name = document.createElement('b')
    name.textContent = t('「{title}」', { title: h.title })
    // 整句一个模板，{title} 换成加粗的名字（title 不给值，原样留着好切开）
    const say = h.kind === 'pair' ? t('网页{title}这周和这篇一起开了 {n} 次。配成一对？以后点开这篇，它跟着开到上次读到的那段。', { n: h.n }) : t('这篇和网页{title}这周一起开了 {n} 次。存成一张书桌？以后一下回到这一整套。', { n: h.n })
    const [before, after] = say.split('{title}')
    txt.append(before ?? '', name, after ?? '')
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'btn btn-sm ra-26'
    go.append(codiconEl(h.kind === 'pair' ? 'link' : 'layout', 13), h.kind === 'pair' ? t('配成一对') : t('存成书桌…'))
    go.addEventListener('mousedown', (e) => e.preventDefault())
    go.addEventListener('click', () => {
      const page = rightPage()
      if (h.kind === 'pair' && page) openPairPop(this.path, page, go)
      else window.dispatchEvent(new CustomEvent('cn:save-desk'))
    })
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'cm-ra-x'
    x.setAttribute('aria-label', t('不用，不再提'))
    x.dataset.tip = t('不用，不再提')
    x.append(codiconEl('close', 15))
    x.addEventListener('mousedown', (e) => e.preventDefault())
    x.addEventListener('click', () => {
      if (h.kind === 'pair') {
        hintOff(hintKey('pair', this.path, h.host))
        app().notice(t('不再提这一对。想配时：右键这篇「和右栏这个网页配成一对…」'))
      } else {
        hintOff(hintKey('desk', this.path))
        const k = keyFor('search')
        app().notice(t('不再提。想存时：{where}「存成书桌…」或左栏「书桌」的 +', { where: k ?? t('搜索框') }))
      }
    })
    box.append(h.kind === 'pair' && rightPage() ? faviconEl(rightPage()!.url, 14) : codiconEl('layout', 15), txt, go, x)
    wrap.append(box)
    return wrap
  }
  ignoreEvent(e: Event) {
    return !!(e.target as Element | null)?.closest?.('button')
  }
}

interface Meta {
  path: string
  mtime: number | null
  fresh: boolean
  ra: ReadAlongView | null
  deco: DecorationSet
}

function chips(state: EditorState, m: Omit<Meta, 'deco'>): DecorationSet {
  // 微信读书同步来的书摘：标题下面是一行摘要（props-block.ts 的 BookMetaLine，CN-122），不画这一颗
  if (isBookDigest(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))) return Decoration.none
  const text = state.doc.toString()
  const h = headingOf(text)
  if (!h || h.line > state.doc.lines) return Decoration.none
  const line = state.doc.line(h.line)
  const n = countWords(text)
  const at = m.fresh && n === 0 ? t('刚建') : m.mtime ? t('改于{when}', { when: when(m.mtime, { time: true }) }) : ''
  const rest = [at, t('{n} 字', { n: thousands(n) })].filter(Boolean)
  const out: Range<Decoration>[] = [Decoration.widget({ widget: new FolderChip(m.path, rest, sourceOf(text), m.ra?.chip ?? null), block: true, side: 1 }).range(line.to)]
  if (m.ra?.hint) out.push(Decoration.widget({ widget: new ReadHint(m.path, m.ra.hint), block: true, side: 2 }).range(line.to))
  return Decoration.set(out)
}

/** 编辑器扩展：path 是打开时的路径，之后靠 setNotePath 更新；改于什么时候靠 setNoteMeta */
export function folderChip(path: string): Extension {
  const field = StateField.define<Meta>({
    create: (state) => {
      const m = { path, mtime: null, fresh: false, ra: null }
      return { ...m, deco: chips(state, m) }
    },
    update(v, tr) {
      let m: Omit<Meta, 'deco'> = { path: v.path, mtime: v.mtime, fresh: v.fresh, ra: v.ra }
      for (const e of tr.effects) {
        if (e.is(setNotePath)) m = { ...m, path: e.value }
        if (e.is(setNoteMeta)) m = { ...m, ...(e.value.mtime !== undefined ? { mtime: e.value.mtime } : {}), ...(e.value.fresh !== undefined ? { fresh: e.value.fresh } : {}) }
        if (e.is(setReadAlong)) m = { ...m, ra: e.value.chip || e.value.hint ? e.value : null }
      }
      if (m.path === v.path && m.mtime === v.mtime && m.fresh === v.fresh && JSON.stringify(m.ra) === JSON.stringify(v.ra) && !tr.docChanged) return v
      return { ...m, deco: chips(tr.state, m) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return field
}
