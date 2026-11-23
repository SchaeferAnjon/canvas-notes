/**
 * 文档里的「在这一页里找」（⇧⌘F）：找到的都铺强调色淡底，当前那一处更深、滚到看得见；↵ 下一处、⇧↵ 上一处；
 * 文档里能替换（导图设计页定的「要成批替换，切到文档看法在正文里换」）：换这一处、全部替换（一次改动，⌘Z 一下撤回）。
 * 藏着的东西不找：frontmatter（属性）、HTML 注释（行尾的 <!-- … -->、排版块）。关掉时选中当前那一处，光标回到正文。
 * 高亮是编辑器的装饰（运行时加进编辑器，不改 note-doc.ts 的配置）。
 */
import { EditorSelection, type EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { FindBar } from './FindBar'
import { useFindTarget } from './find-hub'

type Query = { q: string; cur: number; caseSens: boolean }
type Found = Query & { hits: { from: number; to: number }[]; deco: DecorationSet }

const setFind = StateEffect.define<Query | null>()

/** 不找的地方：frontmatter、HTML 注释 */
function hidden(text: string): [number, number][] {
  const out: [number, number][] = []
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text)
  if (fm) out.push([0, fm[0].length])
  for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) out.push([m.index!, m.index! + m[0].length])
  return out
}

function build(state: EditorState, q: Query): Found {
  const text = state.doc.toString()
  const needle = q.caseSens ? q.q : q.q.toLowerCase()
  const hay = q.caseSens ? text : text.toLowerCase()
  const skip = hidden(text)
  const hits: { from: number; to: number }[] = []
  // 转小写后长短变了的字（极少见）：不找，免得位置对不上
  if (needle && hay.length === text.length) {
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      const to = i + needle.length
      if (!skip.some(([a, b]) => i < b && to > a)) hits.push({ from: i, to })
    }
  }
  const cur = hits.length ? Math.min(Math.max(q.cur, 1), hits.length) : 0
  const deco = Decoration.set(hits.map((h, i) => Decoration.mark({ class: i + 1 === cur ? 'cm-find cm-find-cur' : 'cm-find' }).range(h.from, h.to)))
  return { ...q, cur, hits, deco }
}

const findField = StateField.define<Found | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFind)) return e.value ? build(tr.state, e.value) : null
    // 开着时改了字：重新找
    return v && tr.docChanged ? build(tr.state, v) : v
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v?.deco ?? Decoration.none),
})

/** 找到的变了（换了字、正文改了）：告诉开着找的条的那一个 */
const listeners = new WeakMap<EditorView, (f: Found | null) => void>()
const installed = new WeakSet<EditorView>()
function ensure(view: EditorView) {
  if (installed.has(view)) return
  installed.add(view)
  view.dispatch({
    effects: StateEffect.appendConfig.of([
      findField,
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setFind)))) listeners.get(u.view)?.(u.state.field(findField, false) ?? null)
      }),
    ]),
  })
}

export function DocFind(props: { view: () => EditorView | null; host: () => HTMLElement | null; on: boolean; readOnly: boolean; owner: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // 挂的地方（ref）第一次画时还没有：挂上以后再取
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = props.host()
    if (el !== host) setHost(el)
  })
  const [seq, setSeq] = useState(0)
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(1)
  const [caseSens, setCaseSens] = useState(false)
  const [rep, setRep] = useState('')
  const [found, setFound] = useState<{ cur: number; total: number }>({ cur: 0, total: 0 })

  useFindTarget(
    props.on && host
      ? {
          el: () => host,
          owner: props.owner,
          open: () => {
            const view = props.view()
            // 选着一小段字（一行里）：拿它当要找的
            const sel = view?.state.selection.main
            const picked = view && sel && !sel.empty && sel.to - sel.from <= 80 ? view.state.sliceDoc(sel.from, sel.to) : ''
            if (picked && !picked.includes('\n')) {
              setQ(picked)
              setCur(1)
            }
            setOpen(true)
            setSeq((s) => s + 1)
          },
        }
      : null,
  )
  // 不在文档看法了（切到白板、关了标签）：收起
  useEffect(() => {
    if (!props.on) setOpen(false)
  }, [props.on])

  // 找：装饰跟着框里的字、第几处走；当前那一处滚到看得见；开着时正文改了字也跟着重数
  useEffect(() => {
    const view = props.view()
    if (!view) return
    ensure(view)
    if (!open) {
      if (view.state.field(findField, false)) view.dispatch({ effects: setFind.of(null) })
      return
    }
    listeners.set(view, (f) => setFound({ cur: f?.cur ?? 0, total: f?.hits.length ?? 0 }))
    view.dispatch({ effects: setFind.of({ q, cur, caseSens }) })
    const f = view.state.field(findField, false)
    const h = f && f.cur ? f.hits[f.cur - 1] : undefined
    if (h) view.dispatch({ effects: EditorView.scrollIntoView(h.from, { y: 'center' }) })
    return () => void listeners.delete(view)
  }, [open, q, cur, caseSens])

  const step = (d: 1 | -1) => found.total && setCur(((((found.cur || 1) - 1 + d) % found.total) + found.total) % found.total + 1)
  const close = () => {
    const view = props.view()
    const f = view?.state.field(findField, false)
    const h = f && f.cur ? f.hits[f.cur - 1] : undefined
    setOpen(false)
    if (!view) return
    view.dispatch({ effects: setFind.of(null), ...(h ? { selection: EditorSelection.single(h.from, h.to) } : {}) })
    view.focus()
  }
  const replaceOne = () => {
    const view = props.view()
    const f = view?.state.field(findField, false)
    const h = f && f.cur ? f.hits[f.cur - 1] : undefined
    if (!view || !h || props.readOnly) return
    // 换掉的那一处没了，下一处顶上来（还是这个序号）
    view.dispatch({ changes: { from: h.from, to: h.to, insert: rep }, userEvent: 'input.replace' })
    setCur(Math.min(found.cur, Math.max(1, found.total - 1)))
  }
  const replaceAll = () => {
    const view = props.view()
    const f = view?.state.field(findField, false)
    if (!view || !f?.hits.length || props.readOnly) return
    view.dispatch({ changes: f.hits.map((h) => ({ from: h.from, to: h.to, insert: rep })), userEvent: 'input.replace.all' })
  }

  if (!open || !host) return null
  return createPortal(
    <FindBar
      className="doc-find"
      query={q}
      onQuery={(v) => (setQ(v), setCur(1))}
      count={q ? { at: found.cur, total: found.total } : null}
      onNext={() => step(1)}
      onPrev={() => step(-1)}
      onClose={close}
      placeholder={t('在这一篇里找')}
      toggles={[{ key: 'case', icon: 'case-sensitive', label: t('区分大小写'), on: caseSens, onToggle: () => (setCaseSens((v) => !v), setCur(1)) }]}
      replace={props.readOnly ? undefined : { value: rep, onValue: setRep, onOne: replaceOne, onAll: replaceAll }}
      focusSeq={seq}
    />,
    host,
  )
}
