import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RelatedItem, RelatedResult, RelatedUndo } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { openCite } from '../cite'
import { useT } from '../i18n'
import type { NoteDoc } from '../note-doc'
import type { Tab } from '../tabs'
import { HeadBtn, ViewHead } from './Shell'
import './related.css'

/**
 * 右栏「相关」（task-h7oy8，设计页 44-相关栏和生长图 1.3–1.6，全按推荐）：和这一篇相关的三组，确定的在前、猜的在后——
 * 提到这篇的 → 梦游连上的 → 像但还没连的；每条名字和出处、一句为什么、那一句原文（提到这篇的那几个字打底色），指着某一节、某一段的写「指着「…」」。
 * 「整篇 / 光标这一段」：切到这一段时，和光标那一段有关的单独一组「提到这一段的」排在最前，别的照常列在下面、不变淡。
 * 「连上」「不相关」（像但还没连的）、「撤掉」（梦游连上的）：那条原地换成一句话带「撤销」，三样都能撤销。
 * ⌘ 停在一条上弹出那一篇（peek.tsx 认 data-peek-wiki），点一条中间打开并跳到那一句，⇧⌘ 点开在新标签。
 * 数据都在主进程算（related-main.ts），这里只摆。
 */

type Group = 'para' | 'mention' | 'dream' | 'like'
/** 每组先列几条，多了「再显示 N 条」 */
const FIRST = 5

interface Gone {
  icon: CodiconName
  say: string
  undo: RelatedUndo
  /** 撤销时出错的原话 */
  error?: string
}

/** 光标所在的那一段：标题下面到下一个标题；没有标题时是空行隔开的那一段 */
function sectionAt(text: string, line: number): { from: number; to: number; label: string; heading: boolean } {
  const lines = text.split('\n')
  const heads: number[] = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    else if (!fence && /^#{1,6}\s/.test(l)) heads.push(i)
  })
  const h = [...heads].reverse().find((i) => i <= line)
  if (h !== undefined) {
    const next = heads.find((i) => i > h) ?? lines.length
    return { from: h, to: next - 1, label: lines[h]!.replace(/^#{1,6}\s+/, '').replace(/\s*#*\s*$/, ''), heading: true }
  }
  let a = line
  let b = line
  while (a > 0 && lines[a - 1]!.trim()) a--
  while (b < lines.length - 1 && lines[b + 1]!.trim()) b++
  const first = (lines[a] ?? '').replace(/^\s*(?:[-*+>]\s+|\d+[.)]\s+)?/, '').replace(/[*_=`[\]]/g, '').trim()
  return { from: a, to: b, label: first.length > 14 ? first.slice(0, 14) + '…' : first, heading: false }
}

export function RelatedView(props: {
  tab: Tab | null
  doc(): NoteDoc | null
  /** 库里的笔记变了（数一数修改时间）：重读一次 */
  version: number
  /** 看得见（开着但在别的标签后面时不算看过） */
  shown: boolean
  onClose(): void
  onImport(): void
  onDreamSettings(): void
  onSearchSettings(): void
  /** 这篇在相关栏里看过了（图标上的小点消掉） */
  onSeen(path: string): void
}) {
  const t = useT()
  const path = props.tab?.type === 'note' ? props.tab.path : null
  const [data, setData] = useState<RelatedResult | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'all' | 'para'>('all')
  const [cur, setCur] = useState<{ line: number; text: string } | null>(null)
  const [gone, setGone] = useState<Map<string, Gone>>(new Map())
  /** 点了以后从列表里没了的那几条（连上以后不再是「像但还没连的」）：原地留着那句话 */
  const ghosts = useRef(new Map<string, { item: RelatedItem; group: Group; at: number }>())
  const [more, setMore] = useState<Set<string>>(new Set())
  const [showListed, setShowListed] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** 词条卡：正在起草 / 建好了（带撤销）/ 出错 */
  const [made, setMade] = useState<{ undo: RelatedUndo; error?: string } | null>(null)
  /** 拿不准的那几处里点了「连上」的：第几处 → 撤销用的 */
  const [decided, setDecided] = useState<Map<number, RelatedUndo>>(new Map())
  const docOf = useRef(props.doc)
  docOf.current = props.doc

  // 换了一篇：从头来
  useEffect(() => {
    setData(null)
    setGone(new Map())
    ghosts.current.clear()
    setMore(new Set())
    setShowListed(false)
    setSel(null)
    setError('')
    setMade(null)
    setDecided(new Map())
  }, [path])

  useEffect(() => {
    if (!path) return
    let live = true
    window.cn.related(path).then(
      (r) => {
        if (!live) return
        setData(r)
        setError('')
      },
      (e: Error) => live && setError(e.message),
    )
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, props.version])

  // 看得见了才算看过（图标上的小点消掉）
  useEffect(() => {
    if (path && props.shown && data?.path === path) props.onSeen(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, props.shown, data])

  // 「光标这一段」：跟着光标走（半秒看一次，和大纲一样读编辑器）
  useEffect(() => {
    if (mode !== 'para' || !path) return
    const read = () => {
      const d = docOf.current()
      if (!d || d.path !== path) return
      const st = d.view.state
      const line = st.doc.lineAt(st.selection.main.head).number - 1
      const text = st.doc.toString()
      setCur((c) => (c && c.line === line && c.text === text ? c : { line, text }))
    }
    read()
    const id = window.setInterval(read, 500)
    return () => window.clearInterval(id)
  }, [mode, path])

  const sec = useMemo(() => (mode === 'para' && cur ? sectionAt(cur.text, cur.line) : null), [mode, cur])
  const inSec = (it: RelatedItem) => !!sec && it.here !== undefined && it.here >= sec.from && it.here <= sec.to

  if (!path) {
    return (
      <aside className="right related" aria-label={t('相关')}>
        <ViewHead title={t('相关')}>
          <HeadBtn icon="close" label={t('收起右栏')} onClick={props.onClose} />
        </ViewHead>
        <p className="none">{t('这一页不是笔记。打开一篇笔记，这里列出和它相关的。')}</p>
      </aside>
    )
  }

  /** 这一组现在的样子：新的数据里还在的照新的；点过、已经没了的原地留着 */
  const listOf = (group: Group, items: RelatedItem[]) => {
    const out = [...items]
    for (const [id, g] of ghosts.current) if (g.group === group && !out.some((x) => x.id === id)) out.splice(Math.min(g.at, out.length), 0, g.item)
    return out
  }

  async function act(it: RelatedItem, group: Group, kind: 'link' | 'unrelated' | 'unlink') {
    if (!path || busy) return
    setBusy(it.id)
    try {
      const u =
        kind === 'link' ? await window.cn.relatedLink(path, it.path, it.near) : kind === 'unrelated' ? await window.cn.relatedUnrelated(path, it.path) : await window.cn.relatedUnlink(path, it.path, it.src!)
      const list = group === 'dream' ? data!.dream : group === 'like' ? data!.like : data!.mention
      ghosts.current.set(it.id, { item: it, group, at: Math.max(0, list.findIndex((x) => x.id === it.id)) })
      const say =
        kind === 'link'
          ? u.words
            ? t('已连上：正文里「{words}」变成链接，字不变；那篇的「提到这篇的」里会有这一句', { words: u.words })
            : t('已连上：正文里没有单独讲它的字，加在文末「相关：」一行')
          : kind === 'unrelated'
            ? t('以后不再把《{name}》和这篇列成像的', { name: titleOf(it.path) })
            : t('已撤掉：那几个字变回普通字，梦游以后不再连这一对')
      setGone((m) => new Map(m).set(it.id, { icon: kind === 'link' ? 'check' : kind === 'unrelated' ? 'circle-slash' : 'discard', say, undo: u }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function undo(id: string) {
    const g = gone.get(id)
    if (!g || busy) return
    setBusy(id)
    try {
      await window.cn.relatedUndo(g.undo)
      ghosts.current.delete(id)
      setGone((m) => {
        const n = new Map(m)
        n.delete(id)
        return n
      })
      if (path) setData(await window.cn.related(path))
    } catch (e) {
      setGone((m) => new Map(m).set(id, { ...g, error: (e as Error).message }))
    } finally {
      setBusy(null)
    }
  }

  function open(it: RelatedItem, e: React.MouseEvent) {
    setSel(it.id)
    const how = e.metaKey && e.shiftKey ? 'behind' : 'open'
    const line = (it.line ?? 0) + 1
    openCite({ kind: 'note', path: it.path, ...(it.line !== undefined ? { anchor: { line, end: line } } : {}) }, how, titleOf(it.path), 'doc')
  }

  /** ⌘ 停在一条上：弹出那篇的开头（设计页 1.4） */
  const peekOf = (it: RelatedItem) => it.path

  function whyOf(it: RelatedItem): string {
    if (it.why) return it.why
    if (it.kind === 'like' && it.unjudged) return t('本机向量找的：内容像，梦游还没判过')
    if (it.kind === 'dream') return it.relLine === 'out' ? t('写在这篇末尾「相关：」那一行') : t('写在那篇末尾「相关：」那一行')
    const bits: string[] = []
    if (it.embed) bits.push(it.embed === 'note' ? t('嵌了这一篇') : it.embed === 'heading' ? t('嵌了这一节') : t('嵌了这一段'))
    if (it.places) bits.push(t('提到{n}处', { n: it.places }))
    return bits.join(t('，'))
  }

  function tagOf(it: RelatedItem): string | null {
    if (it.kind === 'dream' && it.night) {
      const [, m, d] = it.night.split('-').map(Number)
      return t('{m}月{d}日梦游连的', { m: m!, d: d! })
    }
    if (it.kind === 'like' && it.unjudged) return t('还没判')
    return null
  }

  function row(it: RelatedItem, group: Group) {
    const g = gone.get(it.id)
    if (g)
      return (
        <div key={it.id} className="rl-row done" data-testid="related-done" data-id={it.id}>
          <Codicon name={g.icon} size={14} />
          <div className="say">
            {g.say}
            <button type="button" className="undo" disabled={busy === it.id} onClick={() => void undo(it.id)}>
              {t('撤销')}
            </button>
            {g.error && <div className="err">{g.error}</div>}
          </div>
        </div>
      )
    const why = whyOf(it)
    const tag = tagOf(it)
    const q = it.quote
    return (
      <div
        key={it.id}
        className={'rl-row' + (sel === it.id ? ' on' : '')}
        role="listitem"
        data-testid="related-row"
        data-kind={it.kind}
        data-id={it.id}
        data-peek-wiki={peekOf(it)}
        onClick={(e) => open(it, e)}
      >
        <Codicon name="file-text" size={14} />
        <div className="l1">
          <span className="tt">{titleOf(it.path)}</span>
          {it.alsoDream && <span className="also">{t('梦游也连了')}</span>}
          {it.where && <span className="mt">{it.where}</span>}
        </div>
        {(why || tag) && (
          <div className="why">
            {tag && <span className={'tag' + (it.unjudged ? ' soft' : '')}>{tag}</span>}
            {why}
          </div>
        )}
        {q?.text && (
          <div className="q">
            {q.mark ? (
              <>
                {q.text.slice(0, q.mark[0])}
                <mark>{q.text.slice(q.mark[0], q.mark[1])}</mark>
                {q.text.slice(q.mark[1])}
              </>
            ) : (
              q.text
            )}
          </div>
        )}
        {it.to && (
          <div className="to">
            <Codicon name="target" size={11} />
            {it.to.kind === 'heading' ? t('指着「{name}」', { name: it.to.label }) : t('指着「{name}」那一段', { name: it.to.label })}
          </div>
        )}
        {group !== 'mention' && !(group === 'para' && it.kind === 'mention') && (
          <div className="acts" onClick={(e) => e.stopPropagation()}>
            {it.kind === 'like' ? (
              <>
                <button type="button" className="pri" disabled={!!busy} onClick={() => void act(it, group, 'link')}>
                  <Codicon name="link" size={13} />
                  {t('连上')}
                </button>
                <button type="button" disabled={!!busy} onClick={() => void act(it, group, 'unrelated')}>
                  {t('不相关')}
                </button>
              </>
            ) : (
              <button type="button" disabled={!!busy} onClick={() => void act(it, group, 'unlink')}>
                <Codicon name="discard" size={13} />
                {t('撤掉')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  function rows(key: Group, items: RelatedItem[]) {
    const all = listOf(key, items)
    const shown = more.has(key) ? all : all.slice(0, FIRST)
    return (
      <>
        {shown.map((it) => row(it, key))}
        {all.length > shown.length && (
          <button type="button" className="rl-mini click" onClick={() => setMore((m) => new Set(m).add(key))}>
            <Codicon name="chevron-right" size={12} />
            {t('再显示{n}条', { n: all.length - shown.length })}
          </button>
        )}
      </>
    )
  }

  function group(key: Group, title: string, n: number | null, body: React.ReactNode, hint?: string) {
    return (
      <section className="rl-grp" data-group={key} aria-label={title}>
        <div className="gh">
          <span>{title}</span>
          {n !== null && <span className="n">{n}</span>}
          {hint && <span className="hint">{hint}</span>}
        </div>
        <div className="rows" role="list">
          {body}
        </div>
      </section>
    )
  }

  const note = (icon: CodiconName, body: React.ReactNode, testid?: string) => (
    <div className="rl-note" data-testid={testid}>
      <Codicon name={icon} size={12} />
      <div>{body}</div>
    </div>
  )

  async function makeEntry(name: string) {
    if (!path || busy) return
    setBusy('entry')
    try {
      setMade({ undo: await window.cn.relatedEntry(name, path) })
      setData(await window.cn.related(path))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function undoEntry() {
    if (!made || busy || !path) return
    setBusy('entry')
    try {
      await window.cn.relatedUndo(made.undo)
      setMade(null)
      setData(await window.cn.related(path))
    } catch (e) {
      setMade({ ...made, error: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  /** 拿不准的那一处点「连上」：照 A1 把那一句里的字链到词条页（同相关栏的连上，能撤销） */
  async function linkUnsure(k: number, u: NonNullable<RelatedUndo['unsure']>[number]) {
    if (!made || busy) return
    setBusy('entry')
    try {
      const r = await window.cn.relatedLink(u.path, made.undo.b, u.quote)
      setDecided((m) => new Map(m).set(k, r))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function unlinkUnsure(k: number) {
    const r = decided.get(k)
    if (!r || busy) return
    setBusy('entry')
    try {
      await window.cn.relatedUndo(r)
      setDecided((m) => {
        const n = new Map(m)
        n.delete(k)
        return n
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** 一句里那几个字打底色（#标签里的那一截不算：链过来的是标签外面那一处） */
  const marked = (q: string, w: string) => {
    const tags = [...q.matchAll(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu)].map((m) => [m.index!, m.index! + m[0].length] as const)
    let at = q.indexOf(w)
    while (at >= 0 && tags.some(([a, b]) => at >= a && at < b)) at = q.indexOf(w, at + 1)
    return at < 0 ? q : (
      <>
        {q.slice(0, at)}
        <mark>{w}</mark>
        {q.slice(at + w.length)}
      </>
    )
  }

  /** 建好以后卡下面：链过来的那几处（哪篇、那一句）；拿不准的那几处，你来定 */
  function entryAfter() {
    if (!made) return null
    const linked = made.undo.linked ?? []
    const unsure = made.undo.unsure ?? []
    if (!linked.length && !unsure.length) return null
    return (
      <div className="rl-term-after">
        {linked.length > 0 && (
          <div className="rl-term-list" data-testid="related-entry-linked">
            <div className="h">{t('{n}篇里提到它的字链过来了', { n: new Set(linked.map((l) => l.path)).size })}</div>
            {linked.map((l, k) => (
              <div key={k} className="it">
                <a data-peek-wiki={l.path} onClick={(e) => openNote(l.path, e)}>
                  {titleOf(l.path)}
                </a>
                <div className="q">{marked(l.quote, l.words)}</div>
              </div>
            ))}
          </div>
        )}
        {unsure.length > 0 && (
          <div className="rl-term-list" data-testid="related-entry-unsure">
            <div className="h">{t('拿不准，你来定：{n}处', { n: unsure.length })}</div>
            {unsure.map((u, k) => (
              <div key={k} className="it">
                <a data-peek-wiki={u.path} onClick={(e) => openNote(u.path, e)}>
                  {titleOf(u.path)}
                </a>
                <div className="q">{marked(u.quote, u.words)}</div>
                <div className="acts">
                  {decided.has(k) ? (
                    <>
                      <span className="ok">{t('已连上')}</span>
                      <button type="button" className="undo" disabled={!!busy} onClick={() => void unlinkUnsure(k)}>
                        {t('撤销')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="pri" disabled={!!busy} onClick={() => void linkUnsure(k, u)}>
                      <Codicon name="link" size={13} />
                      {t('连上')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const openNote = (p: string, e?: React.MouseEvent) => openCite({ kind: 'note', path: p }, e?.metaKey && e.shiftKey ? 'behind' : 'open', titleOf(p), 'doc')

  /** 最上面那张「词条」卡（梦游 Wiki 那节 C1）：梦游建议过、还没有词条页 →「建词条页…」，点了才建；建好了 → 那一页，点了打开 */
  function entryCard(e: NonNullable<RelatedResult['entry']>) {
    const page = made?.undo.b ?? e.page
    const making = busy === 'entry' && !made
    return (
      <div
        className={'rl-term' + (page ? ' has' : '')}
        data-testid="related-entry"
        role="button"
        tabIndex={0}
        data-peek-wiki={page}
        onClick={(ev) => (page ? openNote(page, ev) : void makeEntry(e.name))}
      >
        <Codicon name={making ? 'loading' : 'book'} size={16} className={making ? 'spin' : undefined} />
        <div className="tx">
          <div className="t">{e.name}</div>
          <div className="s">
            {making
              ? t('正在起草：AI 读库里提到它的段，导语每句挂出处')
              : made
                ? null
                : page
                  ? t('词条页')
                  : t('库里{n}篇提到它，还没有词条页', { n: e.count })}
          </div>
          {made && (
            <div className="s">
              {t('建好了《{name}》', { name: e.name })}
              <button
                type="button"
                className="undo"
                disabled={!!busy}
                onClick={(ev) => {
                  ev.stopPropagation()
                  void undoEntry()
                }}
              >
                {t('撤销')}
              </button>
              {made.error && <span className="err">{made.error}</span>}
            </div>
          )}
        </div>
        {!making && <span className="go">{page ? t('打开') : t('建词条页…')}</span>}
      </div>
    )
  }

  let body: React.ReactNode = null
  let count = 0
  if (data) {
    const para = sec ? [...data.mention, ...data.dream, ...data.like].filter(inSec) : []
    const not = (x: RelatedItem) => !para.includes(x)
    // 词条卡上已经有那一页：「提到这篇的」不再列同一篇（一篇只在一处）
    const mention = data.mention.filter(not).filter((x) => !data.entry?.page || x.path !== data.entry.page)
    const dream = data.dream.filter(not)
    const like = data.like.filter(not)
    count = data.mention.length + data.dream.length + data.like.length + data.seq.length + data.listed.length
    const empty = !count && data.likeState === 'small'
    if (empty) {
      body = (
        <div className="rl-empty" data-testid="related-empty">
          {data.entry && (
            <div className="rl-empty-term">
              {entryCard(data.entry)}
              {entryAfter()}
            </div>
          )}
          <div className="big">
            <Codicon name="references" size={20} />
          </div>
          <h4>{t('还没有相关的笔记')}</h4>
          <p>{t('这里会列出和这篇有关的笔记，每条写一句为什么、带那一句原文：')}</p>
          <ul>
            <li>{t('提到这篇的：别的笔记里写了 [[{name}]]', { name: titleOf(path) })}</li>
            <li>{t('梦游连上的：夜里梦游读过全库后补的链接')}</li>
            <li>{t('像但还没连的：内容讲同一件事，你点「连上」才写进去')}</li>
          </ul>
          <p>{t('库里现在只有{n}篇。多写几篇，或者导进来已有的笔记，梦游跑过一晚就会有。', { n: data.notes })}</p>
          <button type="button" className="btn" onClick={props.onImport}>
            {t('导入已有的笔记…')}
          </button>
        </div>
      )
    } else {
      body = (
        <div className="rl-scroll">
          {data.entry && entryCard(data.entry)}
          {data.entry && entryAfter()}
          {sec && para.length > 0 && group('para', t('提到这一段的'), para.length, rows('para', para))}
          {group(
            'mention',
            t('提到这篇的'),
            mention.length + data.seq.length + data.listed.length,
            <>
              {!data.mention.length && !data.seq.length && !data.listed.length && note('info', t('还没有别的笔记提到这篇。'), 'related-no-mention')}
              {rows('mention', mention)}
              {data.seq.length > 0 && (
                <div className="rl-mini">
                  <Codicon name="arrow-right" size={12} />
                  <span>{t('前后篇：')}</span>
                  {data.seq.map((s, i) => (
                    <span key={s.path} className="unit">
                      <a data-peek-wiki={s.path} onClick={(e) => open({ id: s.path, kind: 'mention', path: s.path, where: '' }, e)}>
                        {titleOf(s.path)}
                      </a>
                      {i < data.seq.length - 1 && <span className="sep">·</span>}
                    </span>
                  ))}
                </div>
              )}
              {data.listed.length > 0 &&
                (showListed ? (
                  <div className="rl-mini" data-testid="related-listed">
                    <Codicon name="list-tree" size={12} />
                    <span>{t('只列着它的名字：')}</span>
                    {data.listed.map((p, i) => (
                      <span key={p} className="unit">
                        <a data-peek-wiki={p} onClick={(e) => open({ id: p, kind: 'mention', path: p, where: '' }, e)}>
                          {titleOf(p)}
                        </a>
                        {i < data.listed.length - 1 && <span className="sep">·</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="rl-mini click" data-testid="related-listed" onClick={() => setShowListed(true)}>
                    <Codicon name="list-tree" size={12} />
                    {t('还有{n}篇只列着它的名字（目录页、相关列表）', { n: data.listed.length })}
                  </button>
                ))}
            </>,
          )}
          {group(
            'dream',
            t('梦游连上的'),
            data.dreamState === 'ok' ? listOf('dream', dream).length : null,
            <>
              {data.dreamState === 'never' &&
                note(
                  'info',
                  <>
                    {t('梦游还没跑过。今晚闲下来时第一次整理，明早在这里和「梦游报告」里看它连了什么。')}
                    <a className="go" onClick={props.onDreamSettings}>
                      {t('设置 › 梦游')}
                    </a>
                  </>,
                  'related-dream-never',
                )}
              {data.dreamState === 'off' &&
                note(
                  'info',
                  <>
                    {t('梦游的「补双链」关着。')}
                    <a className="go" onClick={props.onDreamSettings}>
                      {t('设置 › 梦游')}
                    </a>
                  </>,
                )}
              {data.dreamState === 'ok' && !listOf('dream', dream).length && note('info', t('梦游还没给这篇连过东西。'))}
              {rows('dream', dream)}
            </>,
            listOf('dream', dream).length ? t('链接写在原句里') : undefined,
          )}
          {group(
            'like',
            t('像但还没连的'),
            data.likeState === 'ok' || listOf('like', like).length ? listOf('like', like).length : null,
            <>
              {data.likeState === 'indexing' &&
                note(
                  'loading',
                  <>
                    <div className="l1">
                      {data.indexing?.total
                        ? data.indexing.unit === 'chunk'
                          ? t('正在读全库找像的：{done} / {total}段', { done: data.indexing.done.toLocaleString(), total: data.indexing.total.toLocaleString() })
                          : t('正在读全库找像的：{done} / {total}篇', { done: data.indexing.done.toLocaleString(), total: data.indexing.total.toLocaleString() })
                        : t('正在读全库找像的…')}
                    </div>
                    <div>{t('在这台 Mac 上算，不上传，不花 AI 额度。')}</div>
                    {!!data.indexing?.total && (
                      <div className="prog">
                        <i style={{ width: `${Math.round((100 * data.indexing.done) / data.indexing.total)}%` }} />
                      </div>
                    )}
                  </>,
                  'related-indexing',
                )}
              {data.likeState === 'small' && note('info', t('库里不到{n}篇，先不猜像的。', { n: 20 }))}
              {data.likeState === 'off' &&
                note(
                  'info',
                  <>
                    {t('「按意思找」关着，只列梦游判过的。')}
                    <a className="go" onClick={props.onSearchSettings}>
                      {t('去打开')}
                    </a>
                  </>,
                )}
              {data.likeState === 'ok' && !listOf('like', like).length && note('info', t('没有像但还没连的。'))}
              {rows('like', like)}
            </>,
            listOf('like', like).length ? t('点「连上」才写进文件') : undefined,
          )}
        </div>
      )
    }
  }

  return (
    <aside className="right related" aria-label={t('相关')} data-cite-base={path} data-peek-side="left">
      <ViewHead title={t('相关')} sub={titleOf(path)}>
        <HeadBtn icon="close" label={t('收起右栏')} onClick={props.onClose} />
      </ViewHead>
      {data && !(!count && data.likeState === 'small') && (
        <div className="rl-tools">
          <div className="seg" role="tablist" aria-label={t('整篇 / 光标这一段')}>
            <button type="button" role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
              {t('整篇')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'para'} className={mode === 'para' ? 'on' : ''} onClick={() => setMode('para')}>
              {t('光标这一段')}
            </button>
          </div>
          <span className="cnt">{t('{n}篇', { n: count })}</span>
        </div>
      )}
      {sec && (
        <div className="rl-where" data-testid="related-where">
          <i />
          {sec.heading ? t('光标在「{name}」', { name: sec.label }) : t('光标在「{name}」这一段', { name: sec.label })}
        </div>
      )}
      {error && <p className="none err">{error}</p>}
      {!data && !error && <p className="none">{t('在找…')}</p>}
      {body}
      {data && !(!count && data.likeState === 'small') && (
        <div className="rl-foot">
          <span>
            <kbd>⌘</kbd> {t('停在一条上看内容')}
          </span>
          <span>·</span>
          <span>{t('点一条打开')}</span>
          <span>·</span>
          <span>
            <kbd>⇧⌘</kbd> {t('点开在新标签')}
          </span>
        </div>
      )}
    </aside>
  )
}
