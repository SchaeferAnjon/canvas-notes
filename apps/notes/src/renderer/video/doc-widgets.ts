/**
 * 文档模式里视频的样子：时刻块（data-part="时刻块"：截图 + 时间胶囊 + 这一秒的原文译文 + 「前后 4 行」）、
 * 问过 AI 的那块、视频卡一行（封面 + 标题 + 「YouTube · 频道 · 时长 · 这篇记了 N 处」+「接着看」）。
 * 光标进到块里就露出 md 原文。点时间、点视频链接：右栏打开并跳到那一秒（不去外部浏览器）。
 * 只加装饰不改文字，「打开再保存文件不变」不受影响。
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { fmtTime, parseMoment, parseVideoCard, siteName, videoOf } from '../../shared/video'
import { editorHost } from '../editor-host'
import { imageSrc } from '../md-widgets'
import { openVideo } from './actions'

import { HEAD } from './block-head'

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function pill(label: string, url: string): HTMLButtonElement {
  const b = el('button', 'vpill', `▶ ${label}`)
  b.type = 'button'
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
  toDOM() {
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
      hd.appendChild(el('span', 'asked', '也进了「视频里的疑惑」'))
      box.appendChild(hd)
      const body = el('div', 'body')
      body.appendChild(shot)
      const d = el('div', 'doubt')
      d.appendChild(el('div', 'lb', '我的疑惑'))
      const q = /^>\s*\*\*我的疑惑\*\*：(.*)$/m.exec(this.src)?.[1] ?? ''
      d.appendChild(el('div', '', q))
      body.appendChild(d)
      box.appendChild(body)
      return box
    }
    box.appendChild(shot)
    const main = el('div', 'main')
    main.appendChild(hd)
    const cur = m.lines.find((l) => l.current) ?? m.lines[0]
    if (cur) {
      main.appendChild(el('div', 'o', cur.text))
      if (cur.tr) main.appendChild(el('div', 't', cur.tr))
    }
    if (m.lines.length > 1) {
      const more = el('button', 'more', `› 前后 ${m.lines.length - 1} 行`)
      more.type = 'button'
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
        more.textContent = `${lines.hidden ? '›' : '⌄'} 前后 ${m.lines.length - 1} 行`
      })
      main.appendChild(more)
      main.appendChild(lines)
    }
    box.appendChild(main)
    return box
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
    tx.appendChild(el('span', '', [siteName(c.ref.site), c.meta, this.count ? `这篇记了 ${this.count} 处` : ''].filter(Boolean).join(' · ')))
    box.appendChild(tx)
    const go = el('button', 'go', '▶ 接着看')
    go.type = 'button'
    go.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      void openVideo(c.url, true)
    })
    void window.cnVideo?.lastPos(c.ref.key).then((p) => p > 3 && (go.textContent = `▶ 接着看 ${fmtTime(p)}`))
    box.appendChild(go)
    return box
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
    if (state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)) continue
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
  update: (v, tr) => (tr.docChanged || tr.selection ? build(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
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
