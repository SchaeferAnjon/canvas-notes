/**
 * 右栏「笔记」标签（2026-11-20 工作区方向 A 起是独立的标签，能拖到任何位置；原型 design/workspace/proto-a.html 的 buildNote）：一篇长文档（CN-93–96）。
 * 读的就是库里那篇「… 笔记.md」（一份 PDF 一篇）：一轮（一处问的地方）一段，按页排，每一轮默认展开（问的原话、我框的图、回答都露着，
 * 2026-11-23 用户「我看不到我问的内容 还有问的这个内容的时候的图片 能不能 默认展开 一键收起」；以前只展开最近问的那一轮），
 * 筛选那一行右边一颗「全部收起 / 全部展开」；收起的一轮是一行（标题、小结的前半句、几问、时间），点开展开，单轮自己点开收起照旧；只是看法，不改文件；
 * 顶上「在这份笔记里找」（搜问题原话、回答、小结），下面一行「全部 · 只看我问的 · 旁支」和「N轮 · N问」：
 * 「只看我问的」只列问题原话（就是这份 PDF 的「我的疑惑」），「旁支」只列旁支里问的，点一条回到「全部」、展开那一轮滚过去。
 * 展开的一轮：标题 + 几问 · 时间、「第 28 页 ›」（点了 PDF 翻过去、框闪）· 我框的、我框的图（按框在 PDF 上 100% 时的宽，CN-111）、
 * 主问题条（原话）、回答原文（标题、列表、表格、公式照排）、旁支（缩进一级、左边一道竖线、被问的那句、问题条短一截）、末尾小结。
 * 下格开着旁支时在下格问，这里马上长出来、闪一下（.grow）。以前格式的段照旧显示（我的疑惑、讲通的讲法、要点、没讲通的版本、完整对话）。
 */
import { Codicon } from '@cn/design'
import { type AskMat, type AskSection, type AskTurn, CONFUSED, confusedOf, cropCaption, type Highlight, highlightsOf, HL_DOT, type HlKind, turnIds } from '@cn/format'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AiIcon } from '../engine-logo'
import { usePrefs } from '../settings-store'
import { openCards, openSpot, unsentOf, useAskedRequest, useCardsView } from './cards-store'
import { when } from '../../shared/when'
import { Markdown } from '../md-render'
import { applyMarks, type Mark } from '@cn/ai-chat/side/marks'
import * as R from './store'
import { useLang, useT } from '../i18n'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 这一轮问了几问（新格式：主问题 + 旁支问题；以前的段：问了几轮） */
const asksOf = (s: AskSection) => s.rounds
type Filter = 'all' | 'q' | 'side'

/**
 * 每份笔记哪几轮收着：all 是点了「全部收起」，flip 是和 all 反着的那几轮（自己单点开、单收起的）。
 * 记在这次开着软件的内存里（切到别的 PDF、关了右栏再开照旧）；重开软件回到默认的全展开
 */
const folds = new Map<string, { all: boolean; flip: Set<string> }>()
const NO_FOLD = { all: false, flip: new Set<string>() }
// 不翻：键，画的地方 t(label, { ctx: '笔记筛选' })（英文写短：All · Mine · Threads）
const FILTERS: [Filter, string][] = [
  ['all', '全部'], // 不翻
  ['q', '只看我问的'], // 不翻
  ['side', '旁支'], // 不翻
]
/** 「只看我问的」「旁支」里的一条：问题原话，下面一行在哪 */
interface QRow {
  sec: string
  /** 这一问的身份（送过 Anki 没有按它查） */
  id?: string
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
}) {
  const t = useT()
  const { pdf } = props
  const r = R.useReading(pdf)!
  // 出卡（task-tz7y3）：PDF 的笔记才有；送过的标「已送」，右上「出卡 · N问」是没送的
  const isPdf = /\.pdf$/i.test(pdf)
  const cardsView = useCardsView(isPdf ? { kind: 'pdf', pdf } : null)
  const sides = usePrefs((s) => s.pdf.ankiSides)
  const sent = useMemo(() => new Set((cardsView?.items ?? []).filter((x) => x.sent).map((x) => x.id)), [cardsView])
  const [hint, setHint] = useState(() => {
    try {
      return localStorage.getItem('cn.cardsHint') !== '0'
    } catch {
      return true
    }
  })
  const hideHint = () => {
    setHint(false)
    try {
      localStorage.setItem('cn.cardsHint', '0')
    } catch {
      // 记不住只是下次还说一遍
    }
  }
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // 划的线（ParaRead 联动）：按含义筛（再点一下取消）
  const kinds = R.useKinds()
  const [mean, setMean] = useState<string | null>(null)
  const [, redraw] = useState(0)
  const [ring, setRing] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => [...r.note.sections].sort((a, b) => a.page - b.page), [r.note.sections])
  // 课程首页点「第5讲 6问」、⌘K 打「我的疑惑」：换到「只看我问的」
  const askedReq = useAskedRequest()
  useEffect(() => {
    if (askedReq?.pdf === pdf) setFilter('q')
  }, [askedReq?.seq])

  // 每一轮默认展开；「全部收起」以后都收成一行；单点开、单收起的记在 flip 里
  const fold = folds.get(pdf) ?? NO_FOLD
  const isOpen = (id: string) => fold.all === fold.flip.has(id)
  const setOpen = (id: string, on: boolean) => {
    const f = folds.get(pdf) ?? NO_FOLD
    const flip = new Set(f.flip)
    if (on === f.all) flip.add(id)
    else flip.delete(id)
    folds.set(pdf, { all: f.all, flip })
    redraw((n) => n + 1)
  }
  const foldAll = (all: boolean) => {
    folds.set(pdf, { all, flip: new Set() })
    redraw((n) => n + 1)
  }

  // 看过了，竖条上的小点消失
  useEffect(() => {
    if (!props.hidden) R.seenNotes(pdf)
  }, [props.hidden, r.fresh])

  // 点了页边标记、「已记进笔记 ›」：滚到那一段并展开，外圈亮 2 秒
  useEffect(() => {
    const f = r.focus
    if (!f || props.hidden) return
    // 已经开着就不动（不记成和「全部收起」反着的那一轮）
    if (!isOpen(f.id)) setOpen(f.id, true)
    setRing(f.id)
    requestAnimationFrame(() => list.current?.querySelector(`[data-sec="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    const timer = setTimeout(() => setRing((x) => (x === f.id ? null : x)), 2000)
    return () => clearTimeout(timer)
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
  // 开着旁支切到笔记：直接落到正在问的那条旁支，不闪（照小样 A-3c）
  useEffect(() => {
    if (props.hidden || !r.side.open) return
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
    return s ? t('旁支 · {name}', { name: R.sideName(s) }) : t('旁支')
  }

  const needle = q.trim().toLowerCase()
  const shown = needle ? sections.filter((s) => hayOf(s).includes(needle)) : sections
  const hls = useMemo(() => highlightsOf(r.note.text, r.note.path), [r.note.text, r.note.path])
  const hlShown = needle ? hls.filter((h) => h.text.toLowerCase().includes(needle)) : hls
  // 每页先列划的线（看不懂的是问题段，不在这里），再列这一页问过的
  const pages = [...new Set([...shown.map((s) => s.page), ...hlShown.filter((h) => h.key !== CONFUSED).map((h) => h.page)])].sort((a, b) => a - b)
  const kindOf = (key: string) => kinds.find((k) => k.key === key)
  /** 「看不懂」那一段的「问 AI」：接着这一处问，右栏换到 AI */
  const askConfused = (s: AskSection) => {
    void R.askConfused(pdf, s)
    props.onShowConvo(s.id)
  }
  // 还没写进笔记的（AI 在后台写）先占一段
  const writingNew = r.writing.filter((id) => !sections.some((s) => s.id === id))
  const asks = sections.reduce((n, s) => n + asksOf(s), 0)
  const text = r.note.text
  const toggle = (id: string) => setOpen(id, !isOpen(id))
  const anyOpen = sections.some((s) => isOpen(s.id))
  /** 这一轮什么时候问的：本机问过的写「周二 20:14」（同全软件的日期写法），别的照笔记里的钟点 */
  const timeOf = (s: AskSection) => {
    const th = r.state.threads.find((x) => x.id === s.id)
    return th ? when(th.createdAt, { time: true }) : (s.time ?? '')
  }
  // 「只看我问的」：主问题一条一行，旁支里问的缩进；「旁支」：只列旁支里问的
  const rows: QRow[] = []
  for (const s of filter === 'all' ? [] : sections) {
    const at = s.page > 0 ? t('第{page}页 · {title}', { page: s.page, title: s.title }) : s.title
    const ids = turnIds(pdf, s)
    const side = (quote: string, q: string, id?: string) =>
      rows.push({ sec: s.id, id, quote, q, sub: s.page > 0 ? t('旁支 · 第{page}页 · 「{quote}…」', { page: s.page, quote: quote.slice(0, 14) }) : t('旁支 · 「{quote}…」', { quote: quote.slice(0, 14) }) })
    if (!s.qas) {
      if (filter === 'q') rows.push({ sec: s.id, id: s.id, q: s.doubts[0] ?? s.title, sub: at })
      continue
    }
    s.qas.forEach((qa, i) => {
      if (filter === 'q' && qa.q.trim()) rows.push({ sec: s.id, id: ids.get(`q${i}`), q: qa.q, sub: at })
      qa.sides.forEach((d, j) => d.turns.forEach((turn, k) => side(d.quote, turn.q, ids.get(`s${i}.${j}.${k}`))))
    })
  }
  const qrows = needle ? rows.filter((x) => `${x.q}\n${x.sub}`.toLowerCase().includes(needle)) : rows
  /** 问题条右端（出卡，task-tz7y3）：送过的「✓ 已送」；没送的悬停出「做成卡」，点了 AI 改好这一问、贴着问题条出一张小卡 */
  const cardMark = (s: AskSection, key: string): ReactNode => {
    const ids = turnIds(pdf, s)
    const id = ids.get(key)
    // 「还是不懂」并进上一问：标在那一问自己的问题条上，不在「还是不懂」上再标一次
    if (!id || [...ids].find(([, v]) => v === id)?.[0] !== key) return null
    if (sent.has(id))
      return (
        <span className="mk">
          <Codicon name="check" size={12} />
          {t('已送')}
        </span>
      )
    return (
      <button
        className="hov"
        aria-label={t('做成卡')}
        onClick={(e) => {
          e.stopPropagation()
          openSpot(pdf, id, (e.currentTarget.closest('.qs') as HTMLElement).getBoundingClientRect(), (e.currentTarget.closest('.reading-notes') as HTMLElement).getBoundingClientRect())
        }}
      >
        <AiIcon job="cards" size={14} />
        {/* 字画在 CSS 里：问题条的字还是原话（别处读问题条的字不带它） */}
        <span className="hov-t" data-t={t('做成卡')} />
      </button>
    )
  }
  /** 点「只看我问的」里的一条：回到「全部」，展开那一轮滚过去（旁支的滚到那条旁支） */
  const goRow = (x: QRow) => {
    setFilter('all')
    setQ('')
    if (x.quote !== undefined) return toSide(x.sec, x.quote, true)
    if (!isOpen(x.sec)) setOpen(x.sec, true)
    requestAnimationFrame(() => list.current?.querySelector(`[data-sec="${CSS.escape(x.sec)}"]`)?.scrollIntoView({ block: 'start' }))
  }

  return (
    <aside className="right aicell reading-notes" aria-label={t('笔记')} hidden={props.hidden}>
      {(text || writingNew.length > 0) && (
        <div className="nsub">
          <label className="srch">
            <Codicon name="search" size={14} />
            <input placeholder={t('在这份笔记里找')} aria-label={t('在这份笔记里找')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="nfil" role="tablist" aria-label={t('笔记筛选')}>
            {FILTERS.map(([f, label]) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {t(label, { ctx: '笔记筛选' })}
              </button>
            ))}
            {sections.length > 0 && (
              // 全部收起 / 全部展开：有一轮开着就是「全部收起」
              <button
                className="nfold"
                aria-label={anyOpen ? t('全部收起') : t('全部展开')}
                data-tip={anyOpen ? t('全部收起') : t('全部展开')}
                data-side="below"
                data-testid="notes-fold-all"
                onClick={() => foldAll(anyOpen)}
              >
                <Codicon name={anyOpen ? 'collapse-all' : 'expand-all'} size={14} />
              </button>
            )}
            {isPdf && sections.length > 0 ? (
              <button className="btn btn-xs cards-open" data-testid="cards-open" title={t('AI 把这几问改成能单独看懂的卡，你一张张过，再送进 Anki')} onClick={() => openCards({ kind: 'pdf', pdf })}>
                <AiIcon job="cards" size={14} />
                {t('出卡 · {n}问', { ctx: '笔记栏', n: unsentOf(cardsView, sides).length })}
              </button>
            ) : (
              <span className="cnt num" data-testid="note-count">{t('{n}轮 · {asks}问', { n: sections.length, asks })}</span>
            )}
          </div>
          {hls.length > 0 && (
            <div className="nmean" role="tablist" aria-label={t('按含义筛划线')} data-testid="hl-filter">
              <span className="lb">{t('划线')}</span>
              {kinds.map((k) => {
                const n = hls.filter((h) => h.key === k.key).length
                if (!n) return null
                return (
                  <button key={k.key} role="tab" aria-selected={mean === k.key} className={mean === k.key ? 'on' : ''} data-k={k.key} onClick={() => (setFilter('all'), setMean(mean === k.key ? null : k.key))}>
                    <i className={k.key === CONFUSED ? 'wv' : ''} style={{ ['--hl' as string]: HL_DOT[k.color] }} />
                    {k.name}
                    <span className="num">{n}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div
        className="notes ndoc"
        ref={list}
        // 笔记里光写页码的「第 4 页」是这份 PDF 的：按住 ⌘ 悬停弹出那一页（peek/peek.tsx）
        data-peek-pdf={isPdf ? pdf : undefined}
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
            <p>{t('还没有笔记。')}</p>
            <p>{t('在PDF上框一块问AI，问完它在后台记一段：你框的图、你问的原话和AI的回答，在回答里选一句开的旁支挂在后面。')}</p>
          </div>
        ) : mean ? (
          <>
            {hlShown
              .filter((h) => h.key === mean)
              .sort((a, b) => a.page - b.page)
              .map((h) => (
                <HlRow
                  key={h.id}
                  h={h}
                  kind={kindOf(h.key)}
                  onJump={() => R.jumpTo(pdf, h.page, h.rect)}
                  onAsk={
                    h.key === CONFUSED && !h.asked
                      ? () => {
                          const sec = sections.find((x) => x.id === h.thread)
                          if (sec) askConfused(sec)
                        }
                      : undefined
                  }
                />
              ))}
          </>
        ) : filter !== 'all' ? (
          <>
            {filter === 'side' ? (
              <div className="qhint">{t('开过的旁支')}</div>
            ) : (
              isPdf &&
              hint && (
                <div className="qhint cards-hint">
                  <Codicon name="info" size={14} />
                  <span>{t('点右上「出卡」，AI 把这几问改成能单独看懂的卡，你一张张过。')}</span>
                  <button className="x" aria-label={t('知道了')} onClick={hideHint}>
                    <Codicon name="close" size={12} />
                  </button>
                </div>
              )
            )}
            {qrows.map((x, i) => (
              <button key={i} className={'qonly' + (filter === 'q' && x.quote !== undefined ? ' br' : '') + (x.id && sent.has(x.id) ? ' done' : '')} data-testid="note-q" onClick={() => goRow(x)}>
                <Codicon name={x.quote !== undefined ? 'comment-discussion' : 'comment'} size={14} />
                <span className="qt">
                  <span className="q">{x.q}</span>
                  <span className="s">{x.sub}</span>
                </span>
                {x.id && sent.has(x.id) && (
                  <span className="st">
                    <Codicon name="check" size={12} />
                    {t('已送')}
                  </span>
                )}
              </button>
            ))}
            {!qrows.length && <div className="nempty">{needle ? t('这份笔记里没有「{q}」', { q: q.trim() }) : filter === 'q' ? t('还没问过。') : t('还没开过旁支。')}</div>}
          </>
        ) : (
          <>
            {r.filled && (
              <div className="qhint cards-hint" data-testid="crop-filled">
                <Codicon name="info" size={14} />
                <span>{r.filled}</span>
                <button className="x" aria-label={t('知道了')} onClick={() => R.setFilled(pdf, null)}>
                  <Codicon name="close" size={12} />
                </button>
              </div>
            )}
            {writingNew.map((id) => {
              const th = r.state.threads.find((x) => x.id === id)
              return (
                <section key={id} className="rnd writing pend" data-sec={id}>
                  <div className="rh">
                    <Codicon name="loading" size={14} className="spin cv" />
                    <h3>{t('正在记…')}</h3>
                  </div>
                  <div className="loc">{th && th.page > 0 ? <span>{t('第{page}页', { page: th.page })}</span> : null}</div>
                  {th?.crop && (
                    <span className="crop">
                      <img src={vaultImg(th.crop)} alt={cropCaption(th)} style={th.cropW ? { width: th.cropW } : undefined} />
                    </span>
                  )}
                  <p className="wnote">{t('AI在后台记这一段，你可以接着问')}</p>
                </section>
              )
            })}
            {pages.map((page) => [
              ...(hlShown.some((h) => h.page === page && h.key !== CONFUSED)
                ? [
                    <section key={`hl-${page}`} className="nhl" data-testid="note-hl-page">
                      <h4>{t('第{page}页 · 划的线', { page })}</h4>
                      {hlShown
                        .filter((h) => h.page === page && h.key !== CONFUSED)
                        .map((h) => (
                          <HlRow key={h.id} h={h} kind={kindOf(h.key)} ring={ring === `hl:${h.id}`} onJump={() => R.jumpTo(pdf, h.page, h.rect)} />
                        ))}
                    </section>,
                  ]
                : []),
              ...shown.filter((s) => s.page === page).map((s) =>
              !needle && !isOpen(s.id) ? (
                <FoldRow key={s.id} s={s} time={timeOf(s)} grow={grow.has(`r:${s.id}`)} onOpen={() => toggle(s.id)} />
              ) : (
                <Round
                  key={s.id}
                  s={s}
                  onAskConfused={() => askConfused(s)}
                  cardMark={isPdf ? (key) => cardMark(s, key) : undefined}
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
              ),
            ])}
            {needle && !shown.length && <div className="nempty">{t('这份笔记里没有「{q}」', { q: q.trim() })}</div>}
          </>
        )}
      </div>
    </aside>
  )
}

/** 收成一行的一轮：chevron-right 14 + 「第 27 页 · 标题」 + 小结的前半句（省略号） + 右边「1 问 · 20:14」，点开展开 */
function FoldRow(p: { s: AskSection; time: string; grow: boolean; onOpen(): void }) {
  const t = useT()
  const { s } = p
  const recap = (s.qas ? s.recap : s.good) || ''
  return (
    <section className={'rnd fold' + (p.grow ? ' grow' : '')} data-sec={s.id} data-testid="note-round">
      <button className="fh" aria-expanded={false} onClick={p.onOpen}>
        <Codicon name="chevron-right" size={14} className="cv" />
        <span className="tt">{s.page > 0 ? t('第{page}页 · {title}', { page: s.page, title: s.title }) : s.title}</span>
        <Recap text={recap.replace(/\s+/g, ' ')} />
        <span className="r num">
          <AskCount n={asksOf(s)} time={p.time} />
        </span>
      </button>
    </section>
  )
}

/**
 * 一轮问了几问 · 什么时候。英文窄：对话图标 + 数（3 · 20:21），悬停提示写全 3 questions（设计复审）；中文照旧「3问 · 20:21」
 */
function AskCount(p: { n: number; time: string }) {
  const t = useT()
  if (useLang() !== 'en') return <>{p.time ? t('{n}问 · {time}', { n: p.n, time: p.time }) : t('{n}问', { n: p.n })}</>
  return (
    <span className="asks" title={t('{n}问', { n: p.n })}>
      <Codicon name="comment-discussion" size={12} />
      {p.time ? t('{n}问 · {time}', { n: p.n, time: p.time }) : p.n}
    </span>
  )
}

/** 收起那行的小结：放不下 4 个字时整段不显示（不留「水…」这种一两个字的头） */
function Recap(p: { text: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const [hide, setHide] = useState(false)
  useLayoutEffect(() => {
    const span = el.current
    if (!span || !p.text) return
    const cs = getComputedStyle(span)
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const need = ctx.measureText(Array.from(p.text).slice(0, 4).join('') + '…').width
    const fit = () => setHide(span.clientWidth < need)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(span)
    return () => ro.disconnect()
  }, [p.text])
  return (
    <span ref={el} className="rc" style={hide ? { visibility: 'hidden' } : undefined}>
      {p.text}
    </span>
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
function QBar(p: { t: AskTurn; k: string; grow: boolean; mark?: ReactNode }) {
  const mats = p.t.mats ?? []
  return (
    <>
      <div className={'qs' + (p.grow ? ' grow' : '')} data-k={p.k}>
        <Codicon name="comment" size={14} />
        <span className="qt">{withDots(p.t.q, mats.length)}</span>
        {p.mark}
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
  /** 问题条右端的「已送」「做成卡」（key：主对话「q<i>」、旁支「s<i>.<j>.<k>」） */
  cardMark?(key: string): ReactNode
  /** 划成「看不懂」还没问过的那一问：「问 AI」 */
  onAskConfused?(): void
}) {
  const t = useT()
  const { s } = p
  const w = s.web
  // 第二行：「第 28 页 ›」（点了 PDF 翻过去、框闪）· 我框的；网页上问的是域名，点了回网页；HTML 上问的是文件名，点了打开
  const loc = w ? (
    <button title={/^https?:/i.test(w.url) ? t('回到网页 {url}', { url: w.url }) : t('打开 {url}', { url: w.url })} onClick={() => (/^https?:/i.test(w.url) ? p.onOpenWeb(w.url) : p.onOpenHtml(w.url))}>
      {`${w.label} ›`}
    </button>
  ) : (
    <button title={t('翻到这一页，框过的那块闪一下')} onClick={p.onJump}>
      {t('第{page}页 ›', { page: s.page })}
    </button>
  )
  let n = 0
  return (
    <section className={'rnd' + (p.ring ? ' flash' : '') + (p.writing ? ' writing' : '') + (p.grow.has(`r:${s.id}`) ? ' grow' : '')} data-sec={s.id} data-testid="note-round">
      <div className="rh" role="button" tabIndex={0} aria-expanded onClick={p.onFold} onKeyDown={(e) => e.key === 'Enter' && p.onFold()}>
        <Codicon name="chevron-right" size={14} className="cv" />
        <h3>{s.page > 0 ? t('第{page}页 · {title}', { page: s.page, title: s.title }) : s.title}</h3>
        <span className="r num">
          <AskCount n={asksOf(s)} time={p.time} />
          {p.writing && <Codicon name="loading" size={12} className="spin" />}
        </span>
      </div>
      <div className="loc">
        {loc}
        {s.crop && <span>{`· ${cropCaption(s)}`}</span>}
      </div>
      {s.crop && (
        <button className="crop" title={t('点一下回到原处')} onClick={p.onJump}>
          <img src={vaultImg(s.crop)} alt={cropCaption(s)} style={s.cropW ? { width: s.cropW } : undefined} className={s.cropW ? '' : 'old'} />
        </button>
      )}
      {s.quote && (
        <button className="nquote" title={t('翻到这一页，选过的那段闪一下')} onClick={p.onJump}>
          {s.quote}
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
                {confusedOf(qa.q) ? (
                  <Confused q={qa.q} asked={!!qa.a.trim() || qa.sides.length > 0} onAsk={p.onAskConfused} />
                ) : (
                  <QBar t={qa} k={`q:${s.id}:${i}`} grow={p.grow.has(`q:${s.id}:${i}`)} mark={p.cardMark?.(`q${i}`)} />
                )}
                {qa.a && (
                  <div className="am">
                    <Answer a={qa.a} marks={marks} />
                  </div>
                )}
                {qa.sides.map((d, j) => (
                  <div key={j} className="nside" data-quote={d.quote}>
                    <div className="stag">
                      <Codicon name="comment-discussion" size={11} />
                      {t('旁支 {n}', { n: j + 1 })}
                    </div>
                    <div className="q0">
                      <Codicon name="quote" size={12} />
                      <span>{d.quote}</span>
                    </div>
                    {d.turns.map((turn, k) => {
                      const key = `b:${s.id}:${d.quote}:${k}`
                      return (
                        <div key={k} className={'turn' + (p.grow.has(key) ? ' grow' : '')}>
                          <QBar t={turn} k={key} grow={false} mark={p.cardMark?.(`s${i}.${j}.${k}`)} />
                          {turn.a && (
                            <div className="am">
                              <Answer a={turn.a} />
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
              <b>{t('小结')}</b>
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
            <span>{t('可视化 · 能拖能点 · 点开在中间')}</span>
          </span>
        </button>
      )}
      {(!s.qas || s.links.length > 0) && (
        <div className="nsf">
          {!s.qas && (
            <button className="lnk" onClick={p.onConvo}>
              <Codicon name="comment" size={12} />
              {t('完整对话 · {n}轮', { n: s.rounds })}
            </button>
          )}
          {s.links.map((l) => (
            <button key={l} className="lnk wl" title={t('双链，跳到那篇')} data-peek-wiki={l} onClick={() => p.onLink(l.split('#')[0]!)}>
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
  const t = useT()
  return (
    <>
      {s.doubts.length > 0 && (
        <div className="doubt">
          <div className="lab2">
            <Codicon name="question" size={12} />
            {t('我的疑惑')}
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
            {t('讲通的讲法')}
            {s.goodVersion && <span className="ver">{t('第{n}版', { n: s.goodVersion })}</span>}
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
                {t('没讲通 · 第{n}版：{line}', { n: f.version, line: f.line })}
              </summary>
              <div className="body2">{f.text}</div>
            </details>
          ))}
        </div>
      )}
    </>
  )
}

/** 划的线一条：含义色的荧光笔涂着原文，下面一行「● 重点 · 第 2 页」，点了 PDF 翻过去；找不到字的标「位置可能不准」 */
function HlRow(p: { h: Highlight; kind?: HlKind; ring?: boolean; onJump(): void; onAsk?(): void }) {
  const t = useT()
  const { h, kind } = p
  const c = kind ? HL_DOT[kind.color] : HL_DOT.gray
  const confused = h.key === CONFUSED
  return (
    <div className={'nhr' + (p.ring ? ' flash' : '')} data-sec={`hl:${h.id}`} data-k={h.key} data-testid="note-hl">
      <button className="tx" title={t('翻到这一页，划的那句闪一下')} onClick={p.onJump}>
        <span className={confused ? 'wv' : 'mk'} style={{ ['--hl' as string]: c }}>
          {h.text}
        </span>
      </button>
      <div className="sub">
        <i className={confused ? 'wv' : ''} style={{ ['--hl' as string]: c }} />
        <span>{kind?.name ?? (h.name || h.key)}</span>
        <span>{t('第{page}页', { page: h.page })}</span>
        {confused && <span>{h.asked ? t('问过了') : h.understood ? t('看懂了') : t('还没问')}</span>}
        {p.onAsk && (
          <button className="btn btn-xs" data-testid="hl-ask" onClick={p.onAsk}>
            <AiIcon job="chat" size={12} />
            {t('问 AI')}
          </button>
        )}
      </div>
    </div>
  )
}

/** 问题段里划成「看不懂」的那一问：「看不懂」小标 + 红色波浪线下的原文；还没问过时右边「问 AI」 */
function Confused(p: { q: string; asked: boolean; onAsk?(): void }) {
  const t = useT()
  const c = confusedOf(p.q)!
  return (
    <div className="qs cf" data-testid="note-confused">
      <Codicon name="question" size={14} />
      <span className="qt">
        <b>{c.name || t('看不懂')}</b>
        <span className="wv">{c.text}</span>
      </span>
      {!p.asked && p.onAsk && (
        <button className="btn btn-xs" data-testid="hl-ask" onClick={p.onAsk}>
          <AiIcon job="chat" size={12} />
          {t('问 AI')}
        </button>
      )}
    </div>
  )
}
