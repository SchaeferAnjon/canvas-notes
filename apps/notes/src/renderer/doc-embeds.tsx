/**
 * 文档里嵌白板、嵌一节（2026-11-21 方向 A5，DESIGN.v3 6.5）：
 * - 独占一行的 `![[白板]]`（指向一篇默认用白板看法打开的笔记）：头上「白板「名字」 · N列 M张卡 …… 打开白板 ›」，下面 250 高的白板缩略
 *   （列和卡照白板的样子按 50% 画，只看不点），点了在新标签开那块白板；那块白板改了跟着变；
 * - 独占一行的 `![[笔记#节名]]`：头上「引用自《笔记》› 节名 …… 去原文 ›」，下面照文档的样子画那一节，待办能直接勾，
 *   勾的是原文那一行（只改那一个字，那篇开着时编辑器跟着变）。
 * 只加装饰，不动这篇的字；一整块（光标跨过去，下面一行行首退格先选中它）。库里有哪些笔记由 NoteTab 告诉编辑器（setNoteIndex）。
 */
import { Codicon } from '@cn/design'
import { blockText, findHeading, outline, splitDoc, toggleTask } from '@cn/format'
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { type ReactNode, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Root } from 'react-dom/client'
import { guardedRoot } from './crash/root'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { app } from './ctx/actions'
import { type CardCtx, faceOf, UnitBody } from './doc-board/cards'
import { useVaultFiles } from './files/store'
import { type Hidden, hiddenSyntax, wholeBlock } from './hidden-syntax'
import { inline, Markdown } from './md-render'
import { NoteDoc } from './note-doc'
import { openCite } from './cite'
import { MapThumb } from './mindmap/MapThumb'
import './doc-embeds.css'
import { useT } from './i18n'
import { list } from '../shared/i18n'
import './doc-board/doc-board.css'
import { ipcOn } from './crash/ipc'

/** 库里的笔记（NoteTab 按左栏的列表告诉编辑器） */
export const setNoteIndex = StateEffect.define<NoteFile[]>()
const notesField = StateField.define<NoteFile[]>({
  create: () => [],
  update: (v, tr) => tr.effects.reduce((x, e) => (e.is(setNoteIndex) ? e.value : x), v),
})

const LINE = /^[ \t]*!\[\[([^\]|#^\n]+)(?:#([^\]|\n]+))?(?:\|[^\]\n]*)?\]\][ \t]*$/
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|pdf)$/i

/** 按名字找库里那一篇（同一个文件夹里的先，再是路径短的；照 Obsidian） */
function find(notes: NoteFile[], target: string, here: string): NoteFile | null {
  const low = target.trim().replace(/\.md$/i, '').toLowerCase()
  const hits = notes.filter((n) => titleOf(n.path).toLowerCase() === low || n.path.replace(/\.md$/i, '').toLowerCase() === low)
  if (!hits.length) return null
  const dir = here.includes('/') ? here.slice(0, here.lastIndexOf('/') + 1) : ''
  return [...hits].sort((a, b) => Number(!a.path.startsWith(dir)) - Number(!b.path.startsWith(dir)) || a.path.length - b.path.length)[0]!
}

/** 读一篇的字；那一篇改了跟着变（自己写进去的也跟着变：返回 set） */
function useText(path: string): string | null {
  return useTextState(path)[0]
}
function useTextState(path: string): [string | null, (t: string) => void] {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.readNote(path).then(
      (n) => live && setT(n.text),
      () => live && setT(''),
    )
    const off = ipcOn(window.cn.onNoteChanged, 'cn.onNoteChanged')((p, text) => p === path && setT(text))
    return () => ((live = false), off())
  }, [path])
  return [t, setT]
}

function Head(props: { icon: 'layout' | 'references' | 'type-hierarchy-sub'; children: ReactNode; go: string; onGo(): void }) {
  return (
    <div className="emh">
      <Codicon name={props.icon} size={14} />
      <span className="truncate">{props.children}</span>
      <button
        type="button"
        className="go"
        onMouseDown={(e) => {
          e.preventDefault()
          props.onGo()
        }}
      >
        {props.go}
      </button>
    </div>
  )
}

/** 白板缩略：列和卡照白板的样子按 50% 画（只看不点） */
/** 文档里独占一行的 ![[笔记]]：和白板上那张卡一个样子（剪藏卡：封面、标题、摘要、出处；笔记卡），双击打开那篇 */
function NoteEmbed(props: { note: NoteFile; notes: NoteFile[] }) {
  const { files } = useVaultFiles()
  const text = `![[${titleOf(props.note.path)}]]`
  const unit = { kind: 'embed', text, from: 0, to: text.length } as Parameters<typeof faceOf>[0]
  const ctx: CardCtx = { notePath: props.note.path, notes: props.notes, files, full: false }
  const f = faceOf(unit, ctx)
  const open = () => app().openFile(props.note.path)
  const t = useT()
  return (
    <div className="emb-note db-card" data-face={f.k} onDoubleClick={open} title={t('双击打开这一篇')}>
      <UnitBody u={unit} f={f} ctx={ctx} acts={{ onToggle: () => undefined, onOpen: open, onFull: open }} />
    </div>
  )
}

/**
 * 文档里嵌导图（独占一行的 `![[导图]]`，从笔记拍的导图插的就是它，task-wuv05）：头一行同嵌白板，
 * `type-hierarchy-sub` +「名字 · N个主题」+「打开 ›」；下面 170 高的导图缩略，不露列表原文和行尾注释
 */
function MapEmbed(props: { note: NoteFile }) {
  const t = useT()
  const name = titleOf(props.note.path)
  const open = () => app().openFile(props.note.path)
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="emb" data-part="笔记里的导图块" aria-label={t('导图「{name}」', { name })}>
      <Head icon="type-hierarchy-sub" go={t('打开 ›')} onGo={open}>{t('{name} · {n}个主题', { name, n: props.note.board?.nodes ?? 0 })}</Head>
      <div className="emb-map" onMouseDown={(e) => (e.preventDefault(), open())}>
        <MapThumb path={props.note.path} />
      </div>
    </div>
  )
}

function BoardEmbed(props: { note: NoteFile; notes: NoteFile[] }) {
  if (props.note.board?.nodes !== undefined) return <MapEmbed note={props.note} />
  return <ColumnsEmbed {...props} />
}

function ColumnsEmbed(props: { note: NoteFile; notes: NoteFile[] }) {
  const text = useText(props.note.path)
  const { files } = useVaultFiles()
  const name = titleOf(props.note.path)
  const b = text === null ? null : splitDoc(text)
  const cols = b ? b.columns.filter((c) => c.head || c.cards.length) : []
  const total = b ? b.total : 0
  const ctx: CardCtx = { notePath: props.note.path, notes: props.notes, files, full: false }
  const open = () => app().openFile(props.note.path)
  const t = useT()
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="emb" data-part="文档里嵌白板" aria-label={t('白板「{name}」', { name })}>
      <Head icon="layout" go={t('打开白板 ›')} onGo={open}>{t('白板「{name}」 · {cols}列 {n}张卡', { name, cols: cols.filter((c) => c.head).length, n: total })}</Head>
      <div className="emb-board" onMouseDown={(e) => (e.preventDefault(), open())}>
        <div className="emb-plane">
          <div className="emb-row">
            {cols
              .filter((c) => !c.place)
              .slice(0, 6)
              .map((c, i) => (
                <div key={i} className={'emb-col' + (c.head ? '' : ' bare')}>
                  {c.head && (
                    <h3>
                      <span className="truncate">{c.title}</span>
                      <span className="meta num">{t('{n}张', { n: c.cards.filter((u) => u.kind !== 'gap').length })}</span>
                    </h3>
                  )}
                  {c.cards
                    .filter((u) => u.kind !== 'gap')
                    .slice(0, 4)
                    .map((u) => (
                      <div key={u.from} className="db-card">
                        <UnitBody u={u} f={faceOf(u, ctx)} ctx={ctx} acts={{ onToggle: () => undefined, onOpen: () => undefined, onFull: () => undefined }} />
                      </div>
                    ))}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 一节：标题那一行起，到下一个同级或更高的标题前 */
function sectionOf(text: string, name: string): { start: number; lines: string[] } | null {
  const lines = text.split('\n')
  // 标题比较不管空白和标点（Wiki 那节 W.5）
  const at = findHeading(text, name)
  for (let i = at; i >= 0 && i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]!)
    if (!h) return null
    const level = h[1]!.length
    let j = i + 1
    let f2 = false
    for (; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j]!)) f2 = !f2
      if (f2) continue
      const hh = /^(#{1,6})\s/.exec(lines[j]!)
      if (hh && hh[1]!.length <= level) break
    }
    return { start: i + 1, lines: lines.slice(i + 1, j) }
  }
  return null
}

const TODO = /^(\s*[-*+]\s+)\[([ xX])\]\s?(.*)$/

/** 嵌一节：照文档的样子画，待办能直接勾（改的是原文那一行） */
function SectionEmbed(props: { note: NoteFile; section: string }) {
  const [text, setText] = useTextState(props.note.path)
  const name = titleOf(props.note.path)
  const t = useT()
  const sec = text === null ? null : sectionOf(text, props.section)
  const toggle = async (line: number) => {
    const cur = (await window.cn.readNote(props.note.path)).text
    const ls = cur.split('\n')
    if (ls[line] === undefined || !TODO.test(ls[line]!)) return
    ls[line] = toggleTask(ls[line]!)
    const next = ls.join('\n')
    const w = await window.cn.writeNote(props.note.path, next, cur)
    if (!w.ok) return app().notice(t('《{name}》刚被别处改过，没勾上，再点一次', { name }))
    setText(next)
    // 那一篇开在别的标签里：编辑器跟着变（自己写的不会再来「外面改了」的通知）
    for (const d of NoteDoc.open) if (d.path === props.note.path) void d.applyRemote(next)
    app().notice(/\[[xX]\]/.test(ls[line]!) ? t('勾上了：《{name}》里只改了这一行的一个字', { name }) : t('取消勾选：《{name}》里只改了这一行的一个字', { name }))
  }
  // 连着的待办画成能勾的一组，别的照文档的样子画
  const parts: ({ todo: { line: number; done: boolean; text: string }[] } | { md: string })[] = []
  sec?.lines.forEach((l, k) => {
    const m = TODO.exec(l)
    const last = parts[parts.length - 1]
    if (m) {
      const row = { line: sec.start + k, done: m[2] !== ' ', text: m[3] ?? '' }
      if (last && 'todo' in last) last.todo.push(row)
      else parts.push({ todo: [row] })
    } else if (last && 'md' in last) last.md += '\n' + l
    else parts.push({ md: l })
  })
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="emb" data-part="嵌进来的一节" aria-label={t('引用自《{name}》 {section}', { name, section: props.section })}>
      <Head icon="references" go={t('去原文 ›')} onGo={() => app().openFile(props.note.path)}>{t('引用自《{name}》› {section}', { name, section: props.section })}</Head>
      <div className="emb-sec">
        {text !== null && !sec && <p className="none">{t('《{name}》里没有「{section}」这一节', { name, section: props.section })}</p>}
        {parts.map((p, i) =>
          'todo' in p ? (
            <div key={i} className="emb-todo">
              {p.todo.map((r) => (
                <label key={r.line} className={'td' + (r.done ? ' done' : '')}>
                  <input type="checkbox" checked={r.done} onChange={() => void toggle(r.line)} onMouseDown={(e) => e.stopPropagation()} />
                  <span>{inline(r.text, r.line)}</span>
                </label>
              ))}
            </div>
          ) : p.md.trim() ? (
            <Markdown key={i} text={p.md.trim()} />
          ) : null,
        )}
      </div>
    </div>
  )
}

/**
 * 嵌一段（独占一行的 `![[笔记#^块编号]]`，梦游建的词条页里嵌的就是它，Wiki 那节 W.4）：头上「引用自《笔记》› 「开头几个字」那一段 …… 去原文 ›」，
 * 下面照文档的样子画那一段（列表项、引用块、普通段），不露行尾的块编号；那一篇改了跟着变
 */
function BlockEmbed(props: { note: NoteFile; id: string }) {
  const text = useText(props.note.path)
  const name = titleOf(props.note.path)
  const t = useT()
  const b = text === null ? null : blockText(text, props.id)
  // 卡头写这段在哪一节（正文开头下面就看得到，不再复述）；开头当题目的一级标题不算一节
  const o = b && text !== null ? outline(text) : null
  const hs = o ? o.headings.filter((h, k) => h.line < b!.line && !(k === 0 && h.level === 1)) : []
  const section = hs.length ? hs[hs.length - 1]!.text : ''
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="emb" data-part="嵌进来的一段" aria-label={t('引用自《{name}》里的一段', { name })}>
      <Head icon="references" go={t('去原文 ›')} onGo={() => openCite({ kind: 'note', path: props.note.path, anchor: { block: props.id } }, 'open', name)}>
        {section ? t('引用自《{name}》›「{section}」里的一段', { name, section }) : t('引用自《{name}》里的一段', { name })}
      </Head>
      <div className="emb-sec">
        {text !== null && !b && <p className="none">{t('《{name}》里没有这一段了（块编号 ^{id} 找不到）', { name, id: props.id })}</p>}
        {b && <Markdown text={b.text} />}
      </div>
    </div>
  )
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly kind: 'board' | 'section' | 'note' | 'block',
    readonly note: NoteFile,
    readonly section: string,
    readonly notes: NoteFile[],
  ) {
    super()
  }
  eq(o: EmbedWidget) {
    return o.kind === this.kind && o.note.path === this.note.path && o.section === this.section && o.notes === this.notes
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-embed'
    this.mount(el)
    return el
  }
  updateDOM(dom: HTMLElement) {
    this.mount(dom)
    return true
  }
  private mount(el: HTMLElement) {
    const root = ((el as HTMLElement & { _root?: Root })._root ??= guardedRoot(el, 'doc-embed'))
    flushSync(() =>
      root.render(
        this.kind === 'board' ? (
          <BoardEmbed note={this.note} notes={this.notes} />
        ) : this.kind === 'note' ? (
          <NoteEmbed note={this.note} notes={this.notes} />
        ) : this.kind === 'block' ? (
          <BlockEmbed note={this.note} id={this.section.slice(1)} />
        ) : (
          <SectionEmbed note={this.note} section={this.section} />
        ),
      ),
    )
  }
  destroy(dom: HTMLElement) {
    const root = (dom as HTMLElement & { _root?: Root })._root
    if (root) queueMicrotask(() => root.unmount())
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return this.kind === 'board' ? (this.note.board?.nodes !== undefined ? 220 : 290) : 140
  }
}

function build(state: EditorState, here: string): DecorationSet {
  const notes = state.field(notesField)
  if (!notes.length) return Decoration.none
  const out: Range<Decoration>[] = []
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('![[')) continue
    const m = LINE.exec(line.text)
    if (!m || IMAGE.test(m[1]!.trim())) continue
    const note = find(notes, m[1]!, here)
    if (!note || note.path === here) continue
    const section = (m[2] ?? '').trim()
    if (section.startsWith('^')) out.push(Decoration.replace({ widget: new EmbedWidget('block', note, section, notes), block: true }).range(line.from, line.to))
    else if (section) out.push(Decoration.replace({ widget: new EmbedWidget('section', note, section, notes), block: true }).range(line.from, line.to))
    else if (!section && note.board) out.push(Decoration.replace({ widget: new EmbedWidget('board', note, '', notes), block: true }).range(line.from, line.to))
    // 嵌一整篇（收件箱拖上白板的剪藏、文件树拖来的笔记）：画成白板上同一张卡（剪藏卡、笔记卡），不露「![[…]]」
    else if (!section) out.push(Decoration.replace({ widget: new EmbedWidget('note', note, '', notes), block: true }).range(line.from, line.to))
  }
  return Decoration.set(out)
}

/** 编辑器里的扩展：here() 是这一篇的路径（嵌自己不画） */
export function docEmbeds(here: () => string) {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, here()),
    update: (v, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setNoteIndex)) ? build(tr.state, here()) : v),
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
  return [notesField, field]
}

/**
 * 文末「提到这篇的」：哪些篇链接、嵌了这一篇（哪一节、哪一段），正文里提到的带那一句（梦游页 W.3）；
 * 只列了名字的（目录页、「相关」列表、上一篇下一篇）收成一行，点开才列。不放「连上」这类按钮，右栏「相关」是它的全版（同一份数据）。不写进文件
 */
export function Backlinks(props: { path: string; version: number; board: boolean; boards?: ReadonlyMap<string, string> }) {
  const [links, setList] = useState<Awaited<ReturnType<typeof window.cn.backlinks>>>([])
  const [open, setOpen] = useState(false)
  const t = useT()
  useEffect(() => {
    let live = true
    void window.cn.backlinks(props.path).then(
      (r) => live && setList(r),
      () => live && setList([]),
    )
    return () => void (live = false)
  }, [props.path, props.version])
  if (!links.length) return null
  const bare = links.filter((r) => r.bare)
  const shown = open ? links : links.filter((r) => !r.bare)
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="doc-backlinks" data-part="反向链接" aria-label={t('提到这篇的')}>
      <div className="bh">{t('提到这篇的')}</div>
      {shown.map((r) => {
        // 说法同右栏「相关」：嵌了的写嵌了，链到一节、一段的写「指着「…」」，普通链接不挂标签
        const how = list(
          [
            r.embed ? (props.board ? t('嵌了这块白板') : t('嵌了这一篇')) : '',
            ...r.sections.map((s) => t('指着「{name}」', { name: s })),
            ...r.blocks.map((s) => t('指着「{name}」那一段', { name: s })),
          ].filter(Boolean),
        )
        return (
          <div key={r.path} className="bl-item">
            <div className="bl">
              {props.boards?.has(r.path) ? <i className="sw bl-sw" style={{ background: props.boards.get(r.path) }} /> : <Codicon name="file-text" size={14} />}
              <button type="button" onClick={() => app().openFile(r.path)}>
                {titleOf(r.path)}
              </button>
              {how && <span className="how">{`· ${how}`}</span>}
            </div>
            {r.quote && (
              <div className="bq">
                {r.quote.mark ? (
                  <>
                    {r.quote.text.slice(0, r.quote.mark[0])}
                    <mark>{r.quote.text.slice(r.quote.mark[0], r.quote.mark[1])}</mark>
                    {r.quote.text.slice(r.quote.mark[1])}
                  </>
                ) : (
                  r.quote.text
                )}
              </div>
            )}
          </div>
        )
      })}
      {!open && bare.length > 0 && (
        <button type="button" className="bl-more" onClick={() => setOpen(true)}>
          {t('还有{n}篇只列着它的名字（目录页、相关列表）', { n: bare.length })}
        </button>
      )}
    </div>
  )
}
