/**
 * 右栏「笔记」标签（2026-11-20 工作区方向 A 起是独立的标签，能拖到任何位置；原型 design/workspace/proto-a.html 的 buildNote）：一篇长文档（CN-93–96）。
 * 读的就是库里那篇「… 笔记.md」（一份 PDF 一篇）：一轮（一处问的地方）一段，按页排，最近问的那一轮展开，旧的每轮收成一行（标题、小结的前半句、几问、时间），点开展开；
 * 顶上「在这份笔记里找」（搜问题原话、回答、小结），下面一行「全部 · 只看我问的 · 旁支」和「N轮 · N问」：
 * 「只看我问的」只列问题原话（就是这份 PDF 的「我的疑惑」），「旁支」只列旁支里问的，点一条回到「全部」、展开那一轮滚过去。
 * 展开的一轮：标题 + 几问 · 时间、「第 28 页 ›」（点了 PDF 翻过去、框闪）· 我框的、我框的图（按框在 PDF 上 100% 时的宽，CN-111）、
 * 主问题条（原话）、回答原文（标题、列表、表格、公式照排）、旁支（缩进一级、左边一道竖线、被问的那句、问题条短一截）、末尾小结。
 * 下格开着旁支时在下格问，这里马上长出来、闪一下（.grow）。以前格式的段照旧显示（我的疑惑、讲通的讲法、要点、没讲通的版本、完整对话）。
 */
import { Codicon } from '@cn/design'
import { type AskMat, type AskSection, type AskTurn, cropCaption } from '@cn/format'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { when } from '../../shared/when'
import { Markdown } from '../md-render'
import { applyMarks, type Mark } from './marks'
import * as R from './store'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 这一轮问了几问（新格式：主问题 + 旁支问题；以前的段：问了几轮） */
const asksOf = (s: AskSection) => s.rounds
type Filter = 'all' | 'q' | 'side'
const FILTERS: [Filter, string][] = [
  ['all', '全部'],
  ['q', '只看我问的'],
  ['side', '旁支'],
]
/** 「只看我问的」「旁支」里的一条：问题原话，下面一行在哪 */
interface QRow {
  sec: string
  /** 旁支里问的：被问的那一句 */
  quote?: string
  q: string
  sub: string
}

/** 搜的时候看的字：标题、问题原话、回答、旁支、小结（以前的段：疑惑、讲通的讲法、要点） */
function hayOf(s: AskSection): string {
  const turns = (s.qas ?? []).flatMap((qa) => [qa, ...qa.sides.flatMap((d) => d.turns)])
  return [s.title, s.recap ?? '', ...turns.flatMap((t) => [t.q, t.a]), ...(s.qas ?? []).flatMap((qa) => qa.sides.map((d) => d.quote)), s.good, ...s.doubts, ...s.points].join('\n').toLowerCase()
}

/** 一轮里每一块的记号：第一次画出来以后新长出来的那几块闪一下（照小样 data-k） */
function keysOf(s: AskSection): string[] {
  const out = [`r:${s.id}`]
  ;(s.qas ?? []).forEach((qa, i) => {
    out.push(`q:${s.id}:${i}`)
    qa.sides.forEach((d) => d.turns.forEach((_, j) => out.push(`b:${s.id}:${d.quote}:${j}`)))
  })
  if (s.recap) out.push(`rc:${s.id}:${s.recap}`)
  // 做好的可视化挂上来：那张卡闪一下
  if (s.viz) out.push(`v:${s.id}:${s.viz.path}`)
  return out
}

export function ReadingNotes(props: {
  pdf: string
  hidden: boolean
  onOpenNote(path: string): void
  onOpenLink(target: string): void
  onShowConvo(id: string): void
  onOpenHtml(path: string): void
  onOpenWeb(url: string): void
  onOpenDoubts(folder: string): void
}) {
  const { pdf } = props
  const r = R.useReading(pdf)!
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** 自己点开的、自己收起的那几轮（最近问的那一轮不点也展开） */
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [ring, setRing] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => [...r.note.sections].sort((a, b) => a.page - b.page), [r.note.sections])

  // 最近问的那一轮展开，旧的每轮收成一行（自己点开的照旧开着）
  const newest = r.state.threads.length ? r.state.threads.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).id : null
  const isOpen = (id: string) => opened.has(id) || (id === newest && !closed.has(id))
  const setOpen = (id: string, on: boolean) => {
    setOpened((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
    setClosed((s) => {
      const n = new Set(s)
      if (on) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // 看过了，竖条上的小点消失
  useEffect(() => {
    if (!props.hidden) R.seenNotes(pdf)
  }, [props.hidden, r.fresh])

  // 点了页边标记、「已记进笔记 ›」：滚到那一段并展开，外圈亮 2 秒
  useEffect(() => {
    const f = r.focus
    if (!f || props.hidden) return
    // 已经开着（最近一轮）就不记成「自己点开的」，不然来了新的一轮它也收不起来
    if (!isOpen(f.id)) setOpen(f.id, true)
    setRing(f.id)
    requestAnimationFrame(() => list.current?.querySelector(`[data-sec="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    const t = setTimeout(() => setRing((x) => (x === f.id ? null : x)), 2000)
    return () => clearTimeout(t)
  }, [r.focus?.seq, props.hidden])

  /** 展开那一轮，滚到那条旁支（离顶 60）；flash：闪一下（「在笔记里看」、点小标），开着旁支切过来时不闪 */
  const toSide = (thread: string, quote: string, flash: boolean) => {
    if (!isOpen(thread)) setOpen(thread, true)
    let tries = 0
    const go = () => {
      const el = [...(list.current?.querySelectorAll<HTMLElement>(`[data-sec="${CSS.escape(thread)}"] .nside`) ?? [])].find((e) => e.dataset.quote === quote)
      if (el) {
        list.current!.scrollTop += el.getBoundingClientRect().top - list.current!.getBoundingClientRect().top - 60
        if (!flash) return
        el.classList.remove('grow')
        void el.offsetWidth
        el.classList.add('grow')
      } else if (tries++ < 40) setTimeout(go, 100)
    }
    requestAnimationFrame(go)
  }
  // 「在笔记里看」、笔记里点小标：展开那一轮，滚到那条旁支，闪一下
  useEffect(() => {
    const f = r.sideFocus
    if (!f || props.hidden) return
    toSide(f.thread, f.quote, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.sideFocus?.seq, props.hidden])
  // 开着旁支（没收成一条）切到笔记：直接落到正在问的那条旁支，不闪（照小样 A-3c）
  useEffect(() => {
    if (props.hidden || !r.side.open || r.side.fold) return
    const s = (r.state.sides ?? []).find((x) => x.id === r.side.open)
    if (s?.msgs.length) toSide(s.thread, s.quote, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hidden])

  // 新长出来的那几块闪一下 1.6 秒（看着笔记的时候；没在看时不记作看过，切过来再闪）；
  // 这一批里第一块长出来的问题条（或旁支的一问）滚进来，整块放不下时它的顶停在列表顶下 12
  const seen = useRef<Set<string> | null>(null)
  const [grow, setGrow] = useState<Set<string>>(new Set())
  const keys = sections.flatMap(keysOf)
  const keysAll = keys.join('\n')
  useLayoutEffect(() => {
    if (props.hidden) return
    if (!seen.current) {
      seen.current = new Set(keys)
      return
    }
    const fresh = keys.filter((k) => !seen.current!.has(k))
    if (!fresh.length) return
    for (const k of fresh) seen.current.add(k)
    setGrow((g) => new Set([...g, ...fresh]))
    setTimeout(
      () =>
        setGrow((g) => {
          const n = new Set(g)
          for (const k of fresh) n.delete(k)
          return n
        }),
      1700,
    )
    requestAnimationFrame(() => {
      const l = list.current
      const all = [...(l?.querySelectorAll<HTMLElement>('.grow:not(.rnd)') ?? [])]
      const el = all.find((e) => e.matches('.turn, .qs')) ?? all[0]
      if (!l || !el) return
      const view = l.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      if (b.height > view.height - 24) l.scrollTop += b.top - view.top - 12
      else el.scrollIntoView({ block: 'nearest' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysAll, props.hidden])
  /** 笔记里一条旁支的名字（对话记录里那一条的：改过的名字、问的第一句） */
  const sideTitle = (thread: string, quote: string) => {
    const s = (r.state.sides ?? []).find((x) => x.thread === thread && x.quote === quote)
    return s ? `旁支 · ${R.sideName(s)}` : '旁支'
  }

  const t = q.trim().toLowerCase()
  const shown = t ? sections.filter((s) => hayOf(s).includes(t)) : sections
  // 还没写进笔记的（AI 在后台写）先占一段
  const writingNew = r.writing.filter((id) => !sections.some((s) => s.id === id))
  const asks = sections.reduce((n, s) => n + asksOf(s), 0)
  const text = r.note.text
  const toggle = (id: string) => setOpen(id, !isOpen(id))
  /** 这一轮什么时候问的：本机问过的写「周二 20:14」（同全软件的日期写法），别的照笔记里的钟点 */
  const timeOf = (s: AskSection) => {
    const th = r.state.threads.find((x) => x.id === s.id)
    return th ? when(th.createdAt, { time: true }) : (s.time ?? '')
  }
  // 「只看我问的」：主问题一条一行，旁支里问的缩进；「旁支」：只列旁支里问的
  const rows: QRow[] = []
  for (const s of filter === 'all' ? [] : sections) {
    const at = `${s.page > 0 ? `第${s.page}页 · ` : ''}${s.title}`
    const side = (quote: string, q: string) => rows.push({ sec: s.id, quote, q, sub: `旁支 · ${s.page > 0 ? `第${s.page}页 · ` : ''}「${quote.slice(0, 14)}…」` })
    if (!s.qas) {
      if (filter === 'q') rows.push({ sec: s.id, q: s.doubts[0] ?? s.title, sub: at })
      continue
    }
    for (const qa of s.qas) {
      if (filter === 'q' && qa.q.trim()) rows.push({ sec: s.id, q: qa.q, sub: at })
      for (const d of qa.sides) for (const turn of d.turns) side(d.quote, turn.q)
    }
  }
  const qrows = t ? rows.filter((x) => `${x.q}\n${x.sub}`.toLowerCase().includes(t)) : rows
  /** 点「只看我问的」里的一条：回到「全部」，展开那一轮滚过去（旁支的滚到那条旁支） */
  const goRow = (x: QRow) => {
    setFilter('all')
    setQ('')
    if (x.quote !== undefined) return toSide(x.sec, x.quote, true)
    if (!isOpen(x.sec)) setOpen(x.sec, true)
    requestAnimationFrame(() => list.current?.querySelector(`[data-sec="${CSS.escape(x.sec)}"]`)?.scrollIntoView({ block: 'start' }))
  }

  return (
    <aside className="right aicell reading-notes" aria-label="笔记" hidden={props.hidden}>
      {(text || writingNew.length > 0) && (
        <div className="nsub">
          <label className="srch">
            <Codicon name="search" size={14} />
            <input placeholder="在这份笔记里找" aria-label="在这份笔记里找" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="nfil" role="tablist" aria-label="笔记筛选">
            {FILTERS.map(([f, label]) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
            <span className="cnt num" data-testid="note-count">{`${sections.length}轮 · ${asks}问`}</span>
          </div>
        </div>
      )}
      <div
        className="notes ndoc"
        ref={list}
        onClick={(e) => {
          const b = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
          if (!b) return
          const sec = b.closest<HTMLElement>('[data-sec]')?.dataset.sec
          const quote = b.dataset.side!
          if (sec) R.focusSide(pdf, sec, quote)
        }}
      >
        {!text && !writingNew.length ? (
          <div className="nempty">
            <p>还没有笔记。</p>
            <p>在PDF上框一块问AI，问完它在后台记一段：你框的图、你问的原话和AI的回答，在回答里选一句开的旁支挂在后面。</p>
          </div>
        ) : filter !== 'all' ? (
          <>
            <div className="qhint">{filter === 'q' ? '这份 PDF 问过的都在这里（以前的「我的疑惑」）。点一条跳到那一轮。' : '开过的旁支'}</div>
            {qrows.map((x, i) => (
              <button key={i} className={'qonly' + (filter === 'q' && x.quote !== undefined ? ' side' : '')} data-testid="note-q" onClick={() => goRow(x)}>
                <Codicon name={x.quote !== undefined ? 'comment-discussion' : 'comment'} size={14} />
                <span className="qt">
                  <span className="q">{x.q}</span>
                  <span className="s">{x.sub}</span>
                </span>
              </button>
            ))}
            {!qrows.length && <div className="nempty">{t ? `这份笔记里没有「${q.trim()}」` : filter === 'q' ? '还没问过。' : '还没开过旁支。'}</div>}
          </>
        ) : (
          <>
            {writingNew.map((id) => {
              const th = r.state.threads.find((x) => x.id === id)
              return (
                <section key={id} className="rnd writing pend" data-sec={id}>
                  <div className="rh">
                    <Codicon name="loading" size={14} className="spin cv" />
                    <h3>正在记…</h3>
                  </div>
                  <div className="loc">{th && th.page > 0 ? <span>{`第${th.page}页`}</span> : null}</div>
                  {th?.crop && (
                    <span className="crop">
                      <img src={vaultImg(th.crop)} alt={cropCaption(th)} style={th.cropW ? { width: th.cropW } : undefined} />
                    </span>
                  )}
                  <p className="wnote">AI在后台记这一段，你可以接着问</p>
                </section>
              )
            })}
            {shown.map((s) =>
              !t && !isOpen(s.id) ? (
                <FoldRow key={s.id} s={s} time={timeOf(s)} grow={grow.has(`r:${s.id}`)} onOpen={() => toggle(s.id)} />
              ) : (
                <Round
                  key={s.id}
                  s={s}
                  time={timeOf(s)}
                  ring={ring === s.id}
                  grow={grow}
                  writing={r.writing.includes(s.id)}
                  sideTitle={(quote) => sideTitle(s.id, quote)}
                  onFold={() => toggle(s.id)}
                  onJump={() => R.jumpTo(pdf, s.page, s.rect)}
                  onJumpPage={(page) => R.jumpTo(pdf, page)}
                  onConvo={() => props.onShowConvo(s.id)}
                  onLink={props.onOpenLink}
                  onOpenHtml={props.onOpenHtml}
                  onOpenWeb={props.onOpenWeb}
                />
              ),
            )}
            {t && !shown.length && <div className="nempty">这份笔记里没有「{q.trim()}」</div>}
          </>
        )}
      </div>
    </aside>
  )
}

/** 收成一行的一轮：chevron-right 14 + 「第 27 页 · 标题」 + 小结的前半句（省略号） + 右边「1 问 · 20:14」，点开展开 */
function FoldRow(p: { s: AskSection; time: string; grow: boolean; onOpen(): void }) {
  const { s } = p
  const recap = (s.qas ? s.recap : s.good) || ''
  return (
    <section className={'rnd fold' + (p.grow ? ' grow' : '')} data-sec={s.id} data-testid="note-round">
      <button className="fh" aria-expanded={false} onClick={p.onOpen}>
        <Codicon name="chevron-right" size={14} className="cv" />
        <span className="tt">{`${s.page > 0 ? `第${s.page}页 · ` : ''}${s.title}`}</span>
        <span className="rc">{recap.replace(/\s+/g, ' ')}</span>
        <span className="r num">{`${asksOf(s)}问${p.time ? ` · ${p.time}` : ''}`}</span>
      </button>
    </section>
  )
}

/** 问题条里的字：①② 换成小圆点数字（只换有那么多块材料的编号） */
function withDots(q: string, n: number): ReactNode[] {
  const out: ReactNode[] = []
  let run = ''
  for (const ch of q) {
    const k = MARKS.indexOf(ch) + 1
    if (k && k <= n) {
      if (run) out.push(run)
      run = ''
      out.push(
        <span key={out.length} className="fn">
          {k}
        </span>,
      )
    } else run += ch
  }
  if (run) out.push(run)
  return out
}

/** 一问的问题条（主问题整栏宽 --fill2，旁支里的 78% 宽 --fill）：comment 14 + 原话 500；带的材料在下面一行一条 */
function QBar(p: { t: AskTurn; k: string; grow: boolean }) {
  const mats = p.t.mats ?? []
  return (
    <>
      <div className={'qs' + (p.grow ? ' grow' : '')} data-k={p.k}>
        <Codicon name="comment" size={14} />
        <span>{withDots(p.t.q, mats.length)}</span>
      </div>
      {mats.length > 0 && (
        <div className="qmats">
          {mats.map((m: AskMat, i) => (
            <div key={i} className="fni" title={m.kind === 'quote' ? m.text : m.src}>
              <span className="fn">{i + 1}</span>
              {m.kind === 'image' ? (
                <>
                  <img src={vaultImg(m.path)} alt={m.src} />
                  <span className="fs">{m.src}</span>
                </>
              ) : (
                <>
                  <span className="fq">{m.text}</span>
                  <span className="fs">{`· ${m.src}`}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** 回答原文：照排（标题、列表、表格、公式）；marks 是这一问的回答里问过的那几句（虚线 + 小标） */
function Answer(p: { a: string; marks?: Mark[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(p.marks ?? [])
  useLayoutEffect(() => {
    if (!ref.current || !p.marks?.length) return
    return applyMarks(ref.current, p.marks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.a])
  return (
    <div className="txt md" key={p.a} ref={ref}>
      <Markdown text={p.a} math />
    </div>
  )
}

function Round(p: {
  s: AskSection
  /** 什么时候问的（「周二 20:14」） */
  time: string
  ring: boolean
  grow: Set<string>
  writing: boolean
  sideTitle(quote: string): string
  onFold(): void
  onJump(): void
  onJumpPage(page: number): void
  onConvo(): void
  onLink(target: string): void
  onOpenHtml(path: string): void
  onOpenWeb(url: string): void
}) {
  const { s } = p
  const w = s.web
  // 第二行：「第 28 页 ›」（点了 PDF 翻过去、框闪）· 我框的；网页上问的是域名，点了回网页；HTML 上问的是文件名，点了打开
  const loc = w ? (
    <button title={/^https?:/i.test(w.url) ? `回到网页 ${w.url}` : `打开 ${w.url}`} onClick={() => (/^https?:/i.test(w.url) ? p.onOpenWeb(w.url) : p.onOpenHtml(w.url))}>
      {`${w.label} ›`}
    </button>
  ) : (
    <button title="翻到这一页，框过的那块闪一下" onClick={p.onJump}>{`第${s.page}页 ›`}</button>
  )
  let n = 0
  return (
    <section className={'rnd' + (p.ring ? ' flash' : '') + (p.writing ? ' writing' : '') + (p.grow.has(`r:${s.id}`) ? ' grow' : '')} data-sec={s.id} data-testid="note-round">
      <div className="rh" role="button" tabIndex={0} aria-expanded onClick={p.onFold} onKeyDown={(e) => e.key === 'Enter' && p.onFold()}>
        <Codicon name="chevron-right" size={14} className="cv" />
        <h3>{`${s.page > 0 ? `第${s.page}页 · ` : ''}${s.title}`}</h3>
        <span className="r num">
          {`${asksOf(s)}问${p.time ? ` · ${p.time}` : ''}`}
          {p.writing && <Codicon name="loading" size={12} className="spin" />}
        </span>
      </div>
      <div className="loc">
        {loc}
        {s.crop && <span>{`· ${cropCaption(s)}`}</span>}
      </div>
      {s.crop && (
        <button className="crop" title="点一下回到原处" onClick={p.onJump}>
          <img src={vaultImg(s.crop)} alt={cropCaption(s)} style={s.cropW ? { width: s.cropW } : undefined} className={s.cropW ? '' : 'old'} />
        </button>
      )}
      {s.figures.map((f) => (
        <figure key={f.path} className="nfig">
          <button className="crop" onClick={() => p.onJumpPage(s.page)}>
            <img src={vaultImg(f.path)} alt={f.caption} />
          </button>
          <figcaption>{f.caption}</figcaption>
        </figure>
      ))}
      {s.qas ? (
        <>
          {s.qas.map((qa, i) => {
            const marks: Mark[] = qa.sides.map((d) => ({ side: d.quote, quote: d.quote, n: ++n, title: p.sideTitle(d.quote) }))
            return (
              <div key={i} className="qa">
                <QBar t={qa} k={`q:${s.id}:${i}`} grow={p.grow.has(`q:${s.id}:${i}`)} />
                {qa.a && (
                  <div className="am">
                    <Answer a={qa.a} marks={marks} />
                  </div>
                )}
                {qa.sides.map((d, j) => (
                  <div key={j} className="nside" data-quote={d.quote}>
                    <div className="stag">
                      <Codicon name="comment-discussion" size={11} />
                      {`旁支 ${j + 1}`}
                    </div>
                    <div className="q0">
                      <Codicon name="quote" size={12} />
                      <span>{d.quote}</span>
                    </div>
                    {d.turns.map((t, k) => {
                      const key = `b:${s.id}:${d.quote}:${k}`
                      return (
                        <div key={k} className={'turn' + (p.grow.has(key) ? ' grow' : '')}>
                          <QBar t={t} k={key} grow={false} />
                          {t.a && (
                            <div className="am">
                              <Answer a={t.a} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
          {s.recap && (
            <div className={'recap' + (p.grow.has(`rc:${s.id}:${s.recap}`) ? ' grow' : '')}>
              <b>小结</b>
              <span>{s.recap}</span>
            </div>
          )}
        </>
      ) : (
        <OldBody s={s} />
      )}
      {s.viz && (
        <button className={'vcard' + (p.grow.has(`v:${s.id}:${s.viz.path}`) ? ' grow' : '')} data-testid="viz-card" onClick={() => p.onOpenHtml(s.viz!.path)}>
          <span className="vc-th">
            <Codicon name="file-code" size={18} />
          </span>
          <span className="tx">
            <b className="truncate">{s.viz.title}</b>
            <span>可视化 · 能拖能点 · 点开在中间</span>
          </span>
        </button>
      )}
      {(!s.qas || s.links.length > 0) && (
        <div className="nsf">
          {!s.qas && (
            <button className="lnk" onClick={p.onConvo}>
              <Codicon name="comment" size={12} />
              {`完整对话 · ${s.rounds}轮`}
            </button>
          )}
          {s.links.map((l) => (
            <button key={l} className="lnk wl" title="双链，跳到那篇" onClick={() => p.onLink(l.split('#')[0]!)}>
              [[{l}]]
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** 以前格式的一段照旧显示：我的疑惑、讲通的讲法、要点、没讲通的版本 */
function OldBody({ s }: { s: AskSection }) {
  return (
    <>
      {s.doubts.length > 0 && (
        <div className="doubt">
          <div className="lab2">
            <Codicon name="question" size={12} />
            我的疑惑
          </div>
          {s.doubts.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
        </div>
      )}
      {s.good && (
        <div className="good">
          <div className="lab2">
            <Codicon name="check" size={12} />
            讲通的讲法{s.goodVersion && <span className="ver">{`第${s.goodVersion}版`}</span>}
          </div>
          <p>{s.good}</p>
        </div>
      )}
      {s.points.length > 0 && (
        <ul className="pts">
          {s.points.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {s.failed.length > 0 && (
        <div className="bad">
          {s.failed.map((f) => (
            <details key={f.version}>
              <summary>
                <Codicon name="chevron-right" size={12} />
                {`没讲通 · 第${f.version}版：${f.line}`}
              </summary>
              <div className="body2">{f.text}</div>
            </details>
          ))}
        </div>
      )}
    </>
  )
}
