/**
 * 文档模式里视频的样子：时刻块（data-part="时刻块"：截图 + 时间胶囊 + 这一秒的原文译文 + 「前后 4 行」）、
 * 问过 AI 的那块、视频卡一行（封面 + 标题 + 「YouTube · 频道 · 时长 · 这篇记了 N 处」+「接着看」）。
 * 光标在哪都画成卡片，一整块：方向键直接跨过去，下面一行行首退格先选中它（atomic-blocks.ts）；要改原文用块菜单「改写法」（只在这一块露出写法，block-source.tsx）。
 * 点时间、点视频链接：右栏打开并跳到那一秒（不去外部浏览器）。
 * 只加装饰不改文字，「打开再保存文件不变」不受影响。
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { linkTo } from '@cn/format'
import { askAnswerAfter, fmtTime, parseMoment, parseVideoCard, siteName, videoOf } from '../../shared/video'
import { editorHost } from '../editor-host'
import { type Hidden, hiddenSyntax, wholeBlock } from '../hidden-syntax'
import { imageSrc } from '../md-widgets'
import { openVideo } from './actions'
import { centerNow } from './store'

import { HEAD } from './block-head'
import { catName } from '../../shared/categories'

/** 第 n 行起的一块：到空行为止 */
export function videoBlocks(state: EditorState): { from: number; to: number; kind: string; key: string }[] {
  const doc = state.doc
  const out: { from: number; to: number; kind: string; key: string }[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const m = HEAD.exec(line.text)
    if (!m) continue
    let end = n
    while (end < doc.lines && doc.line(end + 1).text.trim() !== '' && !HEAD.test(doc.line(end + 1).text)) end++
    out.push({ from: line.from, to: doc.line(end).to, kind: m[1]!, key: m[2]! })
    n = end
  }
  return out
}

/** 块部件的外层：上下 6 的内边距留缝（不用外边距，CN-64），也是窄栏时换排法的容器（CN-72） */
function wrap(box: HTMLElement): HTMLElement {
  const w = el('div', 'cm-vwrap')
  w.appendChild(box)
  return w
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function pill(label: string, url: string): HTMLButtonElement {
  const b = el('button', 'vpill', `▶ ${label}`)
  b.type = 'button'
  // 块里的按钮不进 Tab 顺序：Tab 不把光标带离正文（CN-18）
  b.tabIndex = -1
  b.title = '右栏打开，跳到这一秒'
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    void openVideo(url)
  })
  return b
}

class MomentWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly notePath: string,
  ) {
    super()
  }
  eq(o: MomentWidget) {
    return o.src === this.src && o.notePath === this.notePath
  }
  toDOM(view: EditorView) {
    const m = parseMoment(this.src)!
    const box = el('div', 'cm-vmoment' + (m.asked ? ' ask' : ''))
    box.dataset.part = m.asked ? '问答块' : '时刻块'
    const time = fmtTime(m.t)
    const shot = el('div', 'shot')
    if (m.image) {
      const img = el('img', '')
      img.src = imageSrc(this.notePath, m.image)
      img.alt = time
      img.draggable = false
      shot.appendChild(img)
    }
    shot.appendChild(el('span', 'tm', time))
    const hd = el('div', 'hd')
    hd.appendChild(pill(time, m.url))
    hd.appendChild(el('span', 'ttl', m.asked ? '问过 AI · 自动记下的' : m.title))
    if (m.asked) {
      // 在课程里的文档：这一问也在那门课的「我的疑惑」里（课程首页、⌘K「我的疑惑」直接读这一块）
      // 「课程」文件夹照这个库的名字（英文库 Courses）
      const [top, name, ...rest] = this.notePath.split('/')
      const course = top === catName('课程') && rest.length ? name : undefined
      if (course) hd.appendChild(el('span', 'asked', `也在「${course}」的「我的疑惑」里`))
      box.appendChild(hd)
      const body = el('div', 'body')
      body.appendChild(shot)
      const d = el('div', 'doubt')
      d.appendChild(el('div', 'lb', '我的疑惑'))
      const q = /^>\s*\*\*我的疑惑\*\*：(.*)$/m.exec(this.src)?.[1] ?? ''
      d.appendChild(el('div', '', q))
      // 要追问：AI 开在右栏下格，这条疑惑放进输入框当引文（CN-84）
      const more = el('button', 'askmore', '接着问')
      more.type = 'button'
      more.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        // 那一帧和 AI 当时的回答一起带上（AI 才知道「第三个箭头」指什么）
        const answer = askAnswerAfter(view.state.doc.toString(), view.posAtDOM(box))
        centerNow()?.askInRight({ quote: q, t: m.t, url: m.url, title: m.title || m.url, ...(m.image ? { image: linkTo(this.notePath, m.image) } : {}), ...(answer ? { answer } : {}) })
      })
      d.appendChild(more)
      body.appendChild(d)
      box.appendChild(body)
      return wrap(box)
    }
    box.appendChild(shot)
    const main = el('div', 'main')
    main.appendChild(hd)
    const cur = m.lines.find((l) => l.current) ?? m.lines[0]
    if (cur) {
      main.appendChild(el('div', 'o', cur.text))
      if (cur.tr) main.appendChild(el('div', 't', cur.tr))
    } else {
      // 视频没字幕时块里不空着：说一句，「生成字幕」点了右栏打开视频开始生成，生成好后这块自动补上原文和译文
      const none = el('div', 'none', '这一秒没有字幕。')
      const gen = el('button', 'gen', '生成字幕')
      gen.type = 'button'
      gen.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        void openVideo(m.url).then(() => window.cnVideo?.transcribe({ key: m.key }))
      })
      none.append(gen, '后自动补上原文和译文。')
      main.appendChild(none)
    }
    if (m.lines.length > 1) {
      const more = el('button', 'more', `› 前后${m.lines.length - 1}行`)
      more.type = 'button'
      more.tabIndex = -1
      const lines = el('div', 'lines')
      lines.hidden = true
      for (const l of m.lines) {
        lines.appendChild(el('span', 'mono' + (l.current ? ' cur' : ''), l.time))
        lines.appendChild(el('span', l.current ? 'cur' : '', l.tr ? `${l.text} / ${l.tr}` : l.text))
      }
      more.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        lines.hidden = !lines.hidden
        more.textContent = `${lines.hidden ? '›' : '⌄'}前后${m.lines.length - 1}行`
      })
      main.appendChild(more)
      main.appendChild(lines)
    }
    box.appendChild(main)
    return wrap(box)
  }
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' || !!(e.target as HTMLElement).closest('button')
  }
}

class CardWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly notePath: string,
    readonly count: number,
  ) {
    super()
  }
  eq(o: CardWidget) {
    return o.src === this.src && o.notePath === this.notePath && o.count === this.count
  }
  toDOM() {
    const c = parseVideoCard(this.src)!
    const box = el('div', 'cm-vcard')
    box.dataset.part = '视频卡'
    const cover = el('img', 'cv')
    if (c.cover) cover.src = imageSrc(this.notePath, c.cover)
    cover.alt = ''
    box.appendChild(cover)
    const tx = el('div', 'tx')
    tx.appendChild(el('b', '', c.title))
    tx.appendChild(el('span', '', [siteName(c.ref.site), c.meta, this.count ? `这篇记了${this.count}处` : ''].filter(Boolean).join(' · ')))
    box.appendChild(tx)
    const go = el('button', 'go', '▶ 接着看')
    go.type = 'button'
    go.tabIndex = -1
    go.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void openVideo(c.url, true)
    })
    void window.cnVideo?.lastPos(c.ref.key).then((p) => p > 3 && (go.textContent = `▶ 接着看${fmtTime(p)}`))
    box.appendChild(go)
    return wrap(box)
  }
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown' || !!(e.target as HTMLElement).closest('button')
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const path = state.facet(editorHost).path()
  const blocks = videoBlocks(state)
  for (const b of blocks) {
    const src = state.doc.sliceString(b.from, b.to)
    if (b.kind === 'video') {
      if (!parseVideoCard(src)) continue
      const count = blocks.filter((x) => x.kind !== 'video' && x.key === b.key).length
      out.push(Decoration.replace({ widget: new CardWidget(src, path, count), block: true }).range(b.from, b.to))
    } else if (parseMoment(src)) out.push(Decoration.replace({ widget: new MomentWidget(src, path), block: true }).range(b.from, b.to))
  }
  return Decoration.set(out, true)
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
    hiddenSyntax.of((state) => {
      const out: Hidden[] = []
      state.field(f).between(0, state.doc.length, (from, to) => void out.push(wholeBlock(state.doc, from, to, true)))
      return out
    }),
  ],
})

/** 文档里点视频的链接（带时间的、不带的）：右栏打开，不进编辑 */
const clicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || e.shiftKey || e.altKey) return false
    const link = (e.target as HTMLElement).closest('.cm-link')
    if (!link) return false
    const pos = view.posAtDOM(link)
    let url: string | null = null
    syntaxTree(view.state).iterate({
      from: pos,
      to: pos + 1,
      enter: (n) => {
        if (n.name === 'Link') {
          const u = n.node.getChild('URL')
          if (u) url = view.state.doc.sliceString(u.from, u.to)
          return false
        }
        return undefined
      },
    })
    if (!url || !videoOf(url)) return false
    e.preventDefault()
    void openVideo(url)
    return true
  },
})

export const videoDocWidgets = [field, clicks]
