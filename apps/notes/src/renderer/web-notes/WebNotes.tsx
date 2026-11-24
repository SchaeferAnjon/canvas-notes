/**
 * 右栏「笔记」标签开着配好对的网页时（task-6cxtc 设计稿摆法 B，用户：「这个就改成和pdf一样就行」）：只列这个网页正在剪进去的那篇里来自这一页的几条
 * （问的、讲解的、剪的），新的在上；「全部 · 问的 · 剪的」能筛，顶上能搜；点一条网页跳回那段、亮一下，中间那篇（开着的话）滚到这一条。
 * 和读 PDF 的笔记同一个标签、同一个用法；那篇在编辑器里开着就读编辑器里的字（边写边变），没开着读文件。
 */
import { Codicon } from '@cn/design'
import { EditorView } from '@codemirror/view'
import { useEffect, useMemo, useState } from 'react'
import { when } from '../../shared/when'
import { titleOf } from '../../shared/layout'
import { type WebEntry, webEntries } from '../../shared/web-notes'
import { AiIcon } from '../engine-logo'
import { flashRange } from '../insert-flash'
import { useKey } from '../keys'
import { NoteDoc } from '../note-doc'
import { timeOf, WEB_NOTES_CHANGED } from './times'
import './web-notes.css'

type Filter = 'all' | 'ask' | 'clip'

const docOf = (path: string) => [...NoteDoc.open].find((d) => d.path === path) ?? null

/** 那篇现在的字：开着读编辑器（半秒看一次变没变），没开着读文件（写进去以后、换了网页再读） */
function useDocText(path: string, hidden: boolean): string | null {
  const [text, setText] = useState<string | null>(() => docOf(path)?.text ?? null)
  useEffect(() => {
    let alive = true
    const read = () => {
      const d = docOf(path)
      if (d) return setText((t) => (t === d.text ? t : d.text))
      void window.cn.readNote(path).then(
        (n) => alive && setText(n.text),
        () => alive && setText(''),
      )
    }
    read()
    const on = () => read()
    window.addEventListener(WEB_NOTES_CHANGED, on)
    const t = hidden ? undefined : setInterval(() => docOf(path) && read(), 600)
    return () => {
      alive = false
      window.removeEventListener(WEB_NOTES_CHANGED, on)
      clearInterval(t)
    }
  }, [path, hidden])
  return text
}

/**
 * 每一条 key 那一行（块头、剪藏的来源那一行）在 git 里是哪次提交写的（作者时间）：别处写的、清过本机记录的、改过头一行的也有时间。
 * 读的是磁盘上的字，和编辑器里没保存的字行号可能对不上，所以按 key 对；只在那篇换了、这几条的 key 变了时重查，不是每打一个字都跑 git
 */
function useGitTimes(path: string, url: string, keys: string): ReadonlyMap<string, number> {
  const [times, setTimes] = useState<ReadonlyMap<string, number>>(new Map())
  useEffect(() => {
    if (!keys) return
    let alive = true
    void window.cn.lineTimes(path).then((r) => {
      if (!alive) return
      const m = new Map<string, number>()
      if (r) for (const e of webEntries(r.lines.join('\n'), url)) if (r.at[e.keyAt]) m.set(e.key, r.at[e.keyAt]!)
      setTimes(m)
    })
    return () => {
      alive = false
    }
  }, [path, url, keys])
  return times
}

/** 中间那篇（看得见的话）滚到这一条、左边那道竖线亮一下；不抢焦点（光标还在笔记标签里） */
export function revealInDoc(path: string, line: number): boolean {
  const d = [...NoteDoc.open].find((x) => x.path === path && x.view.dom.offsetParent)
  if (!d) return false
  const view = d.view
  const n = Math.min(Math.max(1, line + 1), view.state.doc.lines)
  const l = view.state.doc.line(n)
  // 一条：块头（剪藏是引文第一行）到这一块最后一行
  let end = n
  while (end < view.state.doc.lines && /^\s*>/.test(view.state.doc.line(end + 1).text)) end++
  if (end < view.state.doc.lines && /^——\s/.test(view.state.doc.line(end + 1).text)) end++
  view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 48 }) })
  flashRange(view, { from: l.from, to: view.state.doc.line(end).to })
  return true
}

export function WebNotes(props: {
  /** 记进的那篇 */
  path: string
  /** 右栏前面那个网页 */
  url: string
  hidden: boolean
  /** 点一条：网页跳回那段、亮一下 */
  onGo(e: WebEntry): void
  /** 外面要翻到的那一条（网页上点小标、底栏「在笔记里看」）：头一行的原文 */
  focus: { line: string; seq: number } | null
}) {
  const text = useDocText(props.path, props.hidden)
  const all = useMemo(() => (text === null ? [] : webEntries(text, props.url)), [text, props.url])
  const gitAt = useGitTimes(props.path, props.url, all.map((e) => e.key).join('\0'))
  // 时间：这台 Mac 记着的优先，没有用 git 里那一行的提交时间；新的在上，知道时间的按时间，不知道的按在那篇里的先后（后面的算新）
  const list = useMemo(() => {
    const at = (e: WebEntry) => timeOf(props.path, e.key.slice(0, e.key.lastIndexOf('\n'))) ?? gitAt.get(e.key) ?? 0
    return all.map((e) => ({ e, at: at(e) })).sort((a, b) => b.at - a.at || b.e.line - a.e.line)
  }, [all, props.path, gitAt])
  const [filter, setFilter] = useState<Filter>('all')
  const [find, setFind] = useState(false)
  const [q, setQ] = useState('')
  const [on, setOn] = useState<string | null>(null)
  const clipKey = useKey('clip-selection')
  const quoteKey = useKey('quote-selection')

  // 网页上点了小标、底栏「在笔记里看」：回到「全部」，那一条亮着、滚进来
  useEffect(() => {
    const f = props.focus
    if (!f) return
    const hit = list.find((x) => x.e.key.startsWith(f.line + '\n'))
    if (!hit) return
    setFilter('all')
    setQ('')
    setOn(hit.e.key)
    requestAnimationFrame(() => document.querySelector(`.web-notes [data-key="${CSS.escape(hit.e.key)}"]`)?.scrollIntoView({ block: 'nearest' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.seq, list.length])

  const asks = list.filter((x) => x.e.kind === 'ask').length
  const clips = list.length - asks
  const t = q.trim().toLowerCase()
  const shown = list.filter((x) => (filter === 'all' || x.e.kind === filter) && (!t || `${x.e.title}\n${x.e.quote}\n${x.e.head}`.toLowerCase().includes(t)))
  const tabs: [Filter, string][] = [
    ['all', `全部 ${list.length}`],
    ['ask', `问的 ${asks}`],
    ['clip', `剪的 ${clips}`],
  ]
  return (
    <aside className="right aicell web-notes" aria-label="笔记" hidden={props.hidden} data-testid="web-notes">
      <div className="wn-bar" role="tablist" aria-label="笔记筛选">
        {tabs.map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        <button type="button" className="iconbtn wn-find" aria-label="在这几条里找" aria-pressed={find} data-tip="在这几条里找" data-side="below" onClick={() => (setFind((v) => !v), setQ(''))}>
          <Codicon name="search" size={14} />
        </button>
      </div>
      {find && (
        <label className="wn-q">
          <Codicon name="search" size={14} />
          <input autoFocus aria-label="在这几条里找" placeholder="在这几条里找" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setFind(false), setQ(''))} />
        </label>
      )}
      <div className="wn-list">
        {shown.map(({ e, at }) => (
          <button
            key={e.key}
            type="button"
            className={'wn-row' + (on === e.key ? ' on' : '')}
            data-testid="web-note"
            data-key={e.key}
            onClick={() => {
              setOn(e.key)
              props.onGo(e)
              revealInDoc(props.path, e.line)
            }}
          >
            <span className="wn-ic">{e.kind === 'clip' ? <Codicon name="quote" size={14} /> : e.label === '你问' ? <Codicon name="comment" size={14} /> : <AiIcon job="chat" size={14} />}</span>
            <span className="wn-tx">
              <span className="t">{e.title}</span>
              {/* 自己问的露出引的那段（①），旧写法的 [!ai] 块、新写法都认（2026-11-24 用户：「把那个问题、引用也都显示出来」） */}
              {e.kind === 'ask' && e.label === '你问' && e.quote && <span className="q">{`「${e.quote.length > 60 ? e.quote.slice(0, 59) + '…' : e.quote}」`}</span>}
              <span className="s">{`${e.head} · ${e.label}`}</span>
            </span>
            {at > 0 && <span className="wn-at num">{when(at)}</span>}
            <span className="wn-go">
              回到网页这段
              <Codicon name="reply" size={12} />
            </span>
          </button>
        ))}
        {!shown.length && (
          <div className="wn-empty">
            {t
              ? `这几条里没有「${q.trim()}」`
              : list.length
                ? filter === 'ask'
                  ? '还没在这个网页上问过。'
                  : '还没从这个网页剪过。'
                : `还没有来自这个网页的笔记。在网页上选一段点「讲解一下」「引用${quoteKey ? ` ${quoteKey}` : ''}」或「剪藏${clipKey ? ` ${clipKey}` : ''}」，就记进《${titleOf(props.path)}》。`}
          </div>
        )}
      </div>
      <div className="wn-foot">点一条：网页跳回那段、亮一下；中间那篇滚到这一条</div>
    </aside>
  )
}
