/**
 * 读 PDF 时右栏 AI 那一格（方向 A：和「笔记」用竖条切换）。spec 1.3 发出去前的预览、1.5 AI 右栏。
 * 输入框是共用的那个（composer.tsx，第 2b 段）：底行谁来答 · 模型 · effort，顶上一排材料。
 * 框好的那块是那一排的第一张（不带编号，左下角「第28页」），预填「给我讲解一下」并全选（直接打字就换掉），回车就发；
 * 框着时 ⌘↵ 是改问法（预填清掉、图留着、光标在输入框里，CN-92 方向 A）；回答下面「还是不懂」「换个方式讲」，再下面一行后台记笔记的进度。
 */
import { when } from '../../shared/when'
import { Codicon } from '@cn/design'
import { AiIcon, ByLogo } from '../engine-logo'
import { onMessageMenu } from '../ctx/message-menu'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type ReadingMsg, withoutVizMark } from '../../shared/reading'
import { Markdown } from '../md-render'
import { AiError } from '../ai-error'
import { pastedUrl } from '../paste-images'
import { AiHead, AwayBar, Chip, type DockNav, Sees } from '../ai-head'
import { AiInput, type Lead, MatMsg, sendText, useComposer, useConvPick } from '../composer'
import { ChangeBlock, StepRow } from '../AiPanel'
import { readLabel } from '../ai-place'
import { fmtTime } from '../../shared/video'
import { applyMarks, type Mark } from './marks'
import { AskBox } from './side'
import * as R from './store'

/** 待问那块的小标签：PDF「第28页」；网页、HTML；视频「接着问」是「00:06 · 视频名」 */
function pendingLabel(p: R.Pending): string {
  if (!p.web) return `第${p.page}页`
  if (p.web.t !== undefined) return `${fmtTime(p.web.t)} · ${p.web.title}`
  return /^https?:/i.test(p.web.url) ? '网页' : 'HTML'
}

/** 框好一块时预填的那句 */
const PREFILL = '给我讲解一下'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const stamp = (t: number) => when(t, { time: true })

export function ReadingAi(props: {
  pdf: string
  hidden: boolean
  /** 对话菜单、看别处的对话时「这是在…问的 · 回到…」（D 组 CN-132；读 PDF 的对话从别处点开时也用这一套显示、接着问） */
  nav: DockNav
  onShowNote(id: string): void
  onOpenHtml(path: string): void
  onNotice(text: string): void
  onCollapse(): void
  /** 下格开着旁支（CN-90）：这一格是上格（side.css 按它排高低） */
  split?: { className: string; style?: CSSProperties } | null
}) {
  const { pdf } = props
  const r = R.useReading(pdf)!
  // 输入框的字和顶上那一排材料（composer.tsx）
  const c = useComposer(props.onNotice)
  const input = c.text
  const setInput = c.setText
  const box = c.ta
  // 谁来答 · 模型 · effort（CN-91 方向 C）：模型和 effort 记在这份 PDF 的对话里，没选过用设置 › AI「AI 对话」那一行
  const cp = useConvPick(r.state.pick, (p) => R.setPick(pdf, p), props.onNotice)
  const engine = cp.pick.engine
  const engines = cp.engines
  const [flashMsg, setFlashMsg] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  // 开旁支时下格出来、这一格变矮：问的那句留在看得见的地方（变矮的那几帧里跟着挪；答完划上虚线以后跟着虚线那块）
  const keep = useRef<{ side: string; range: Range | null; until: number } | null>(null)
  useEffect(() => {
    const l = list.current
    if (!l) return
    const ro = new ResizeObserver(() => {
      const k = keep.current
      if (!k) return
      if (performance.now() > k.until) {
        keep.current = null
        return
      }
      // 划上虚线了就按虚线那几段（公式把一句分成好几段）；还没划（回答还在出字）按选中的那几个字
      const spans = l.querySelectorAll<HTMLElement>(`.asked[data-side="${CSS.escape(k.side)}"]`)
      const first = spans.length ? spans[0]!.getBoundingClientRect() : k.range?.getBoundingClientRect()
      const last = spans.length ? spans[spans.length - 1]!.getBoundingClientRect() : first
      if (!first || !last || !first.height) return
      const view = l.getBoundingClientRect()
      // 问的那句放在上格靠上（上面留 48 看得到前文），下面接着露出后面的回答；已经在上面四成以内就不动
      const at = view.top + Math.min(48, view.height * 0.2)
      if (first.top < view.top + 16 || last.bottom > view.top + view.height * 0.4) l.scrollTop += first.top - at
    })
    ro.observe(l)
    return () => ro.disconnect()
  }, [])
  const keepInView = (side: string, range: Range | null) => (keep.current = { side, range, until: performance.now() + 1000 })

  // 框好一块（还没点工具条上的按钮）：输入框预填「给我讲解一下」并全选，焦点进来好回车就发；
  // 输入框里已经有自己打的字就不动它，框的这块挂在那一排第一张（光标放到最后）；
  // 改问法：输入框空着、光标在里面；马上就发的（工具条按钮、问这一页、⌘↵）不预填（CN-23）
  const pendingKey = r.pending ? `${r.pending.page}:${r.pending.rect?.join(',') ?? ''}:${r.pending.quote ?? ''}:${r.pending.blank ? 1 : 0}` : ''
  const selectNext = useRef(false)
  /** 要全选、放光标了：字没变（改问法前输入框本来就是空的）时也要再放一次 */
  const [selectSeq, setSelectSeq] = useState(0)
  const prefilled = useRef('')
  const inputNow = useRef(input)
  inputNow.current = input
  useEffect(() => {
    if (!r.pending || r.pending.direct) return
    const own = inputNow.current.trim() && inputNow.current !== prefilled.current
    if (own) {
      prefilled.current = ''
      requestAnimationFrame(() => {
        const t = box.current
        if (!t) return
        t.focus()
        t.setSelectionRange(t.value.length, t.value.length)
      })
      return
    }
    selectNext.current = true
    prefilled.current = r.pending.blank ? '' : PREFILL
    setInput(prefilled.current)
    setSelectSeq((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])
  // 框的那块不要了（esc、×、点了空白处、「引用这块」成了材料）：预填的字跟着清掉，自己打的留着
  const hadPending = useRef(false)
  useEffect(() => {
    if (r.pending) {
      hadPending.current = true
      return
    }
    if (!hadPending.current) return
    hadPending.current = false
    const pre = prefilled.current
    prefilled.current = ''
    if (pre && inputNow.current === pre) setInput('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.pending])
  // 不管从哪里发出去（回车、工具条、问这一页、⌘↵）：预填的字清掉；自己打的、还没发的字留着
  const sentSeen = useRef(r.sent)
  useEffect(() => {
    if (sentSeen.current === r.sent) return
    sentSeen.current = r.sent
    const pre = prefilled.current
    prefilled.current = ''
    if (pre && inputNow.current === pre) setInput('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.sent])
  // 排着的那几问不发了（停下、不发了、换了一块）：它们的字和材料回到输入框，光标放到最后。
  // 输入框里已经有自己打的字就接在后面、空一行（第 3 轮：点停下把刚打的字换掉了）
  useEffect(() => {
    const back = r.restore
    if (!back) return
    const pre = prefilled.current
    prefilled.current = ''
    if (inputNow.current === pre) setInput('')
    c.restore(back.text, back.mats)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.restore?.seq])
  // 外面加进来的材料（PDF 上「引用这块」、右栏网页选字「问 AI」）：编号插在光标处；预填的字不要了
  const incoming = r.incoming.length ? r.incoming[r.incoming.length - 1]!.seq : 0
  useEffect(() => {
    if (!incoming) return
    for (const g of R.takeIncoming(pdf)) {
      if (prefilled.current && inputNow.current === prefilled.current) {
        prefilled.current = ''
        setInput('')
      }
      c.add(g.mat, g.doc ? { doc: { tab: null } } : {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])
  // 等预填的字真的写进输入框以后再全选（不然写字会把光标挪到最后）
  useLayoutEffect(() => {
    if (!selectNext.current || !box.current) return
    selectNext.current = false
    box.current.focus()
    box.current.select()
  }, [input, pendingKey, selectSeq])

  // ⌘J、圆钮打开的：光标进输入框，直接打字问
  useEffect(() => {
    if (!props.hidden && R.takeAiFocus()) box.current?.focus()
  }, [props.hidden])

  // 新消息、边生成边显示：滚到底
  const lastLen = r.state.msgs.length ? r.state.msgs[r.state.msgs.length - 1]!.text.length : 0
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [r.state.msgs.length, lastLen, props.hidden])

  // 从笔记点「完整对话」：滚到那次对话，外圈亮一下
  useEffect(() => {
    const cv = r.convo
    if (!cv || props.hidden) return
    const el = list.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(cv.id)}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setFlashMsg(cv.id)
    const t = setTimeout(() => setFlashMsg(null), 2000)
    return () => clearTimeout(t)
  }, [r.convo?.seq, props.hidden])

  /** 输入框里是自己打的字（不是预填的、不是空的） */
  const own = !!input.trim() && input !== prefilled.current

  /** page：⌘↵ 在答的时候排上的，发出时带上这一页 */
  function send(page?: number) {
    const mats = c.plain()
    // 只贴了图、字里除了编号一个字都没有：默认问这张图讲的是什么（CN-24）
    const text = sendText(input, mats)
    // 还在答上一问：和点浮条「讲解一下」一样排在后面，答完依次发（store.send 排队）
    if (!text && !mats.length) return
    c.clear()
    void R.send(pdf, text, [], { ...(page ? { page } : {}), ...(mats.length ? { mats } : {}) })
  }

  /** 框着一块（选着一段）时 ⌘↵：改问法——预填的字清掉，图留着，光标在输入框里（CN-92 方向 A） */
  function rephrase() {
    const p = r.pending
    if (!p) return
    R.stage(pdf, { ...p, blank: true })
    // 已经是改问法了（预填已经清掉）：光标回到输入框
    requestAnimationFrame(() => box.current?.focus())
  }

  /**
   * ⌘↵：框着一块（不管焦点在 PDF 上还是输入框里）是改问法；没框时输入框里有自己打的问题就带上这一页问这句（HTML 带这一屏），
   * 空着或只有预填的字交给 PDF 标签「问这一页」
   */
  function cmdEnter(e: React.KeyboardEvent) {
    if (R.isWebSrc(pdf)) return
    if (r.pending && !r.pending.direct) {
      e.preventDefault()
      e.stopPropagation()
      return rephrase()
    }
    if (!own) return
    e.preventDefault()
    e.stopPropagation()
    // 还在答、没框：排在后面，发出时带上这一页（和不在答时的 ⌘↵ 一样，第 3 轮：排着发出去时没带这一页）
    if (r.running !== null) return send(r.state.page || 1)
    const text = input.trim()
    const mats = c.plain()
    c.clear()
    window.dispatchEvent(new CustomEvent(R.ASK_PAGE, { detail: { src: pdf, text, ...(mats.length ? { mats } : {}) } }))
  }

  const running = r.running !== null
  const msgs = r.state.msgs
  const lastAi = [...msgs].reverse().find((m) => m.role === 'ai')
  const sectionCount = r.note.sections.length
  // 问过的那几句（旁支）：虚线 + 小标，数字照笔记里的顺序（一处里按被问的那条回答的先后）；开着的那条小标是强调色底
  const marks = new Map<number, Mark[]>()
  for (const t of new Set((r.state.sides ?? []).map((s) => s.thread)))
    R.sidesInOrder(r, t).forEach((s, i) => marks.set(s.msg, [...(marks.get(s.msg) ?? []), { side: s.id, quote: s.quote, n: i + 1, title: `旁支 · ${R.sideName(s)}`, cur: r.side.open === s.id }]))
  /** 下格开着旁支、没收成一条：上格的「看得到」那行藏起来（照小样） */
  const sideShown = !!props.split && !r.side.fold
  /** 点小标：切到那条旁支；开着的那条再点是关掉 */
  const toggleSide = (id: string) => {
    if (r.side.open === id) return R.closeSide(pdf)
    if (!r.side.open) keepInView(id, null)
    R.showSide(pdf, id)
  }
  /** 网页上问的那几处的网页标题（头上胶囊、「看得到」写它） */
  const webTitle = [...r.state.threads].reverse().find((t) => t.web)?.web?.title ?? r.pending?.web?.title
  /** 头上胶囊、空对话里写的：这段对话是哪里的 */
  const label = readLabel(pdf, webTitle)
  const html = /\.html?$/i.test(pdf)
  const pend = r.pending
  // 输入框顶上那一排的第一张：框好的那块（左下角「第28页」）、选着的那段、视频那一帧
  const lead: Lead | null = !pend
    ? null
    : pend.quote
      ? {
          label: pendingLabel(pend),
          quote: pend.quote,
          img: pend.image && pend.web?.t !== undefined ? vaultImg(pend.image) : null,
          alt: pend.web?.t !== undefined ? `${fmtTime(pend.web.t)} 这一帧` : '选中的这段',
          removeLabel: '不要这段了',
          onRemove: () => R.unstage(pdf, true),
        }
      : {
          label: pendingLabel(pend),
          img: pend.url ?? null,
          alt: pend.page ? `第 ${pend.page} 页框的那块` : '框的那块',
          removeLabel: '不要这块了',
          onRemove: () => R.unstage(pdf, true),
        }
  // 底行提示：框着一块时说三个键（CN-92 方向 A），改问法时说怎么发、怎么取消；平时说回车和 ⌘↵
  const hintNow = pend && !pend.direct ? (pend.blank ? '↵ 发送 · esc 取消这块' : '↵ 讲解一下 · ⌘↵ 改问法 · esc 取消这块') : undefined
  const hint = R.isWebSrc(pdf) ? '↵ 发送' : html ? '↵ 发送 · ⌘↵ 问这一屏' : '↵ 发送 · ⌘↵ 问这一页'

  return (
    <aside className={'right aicell reading-ai ai' + (props.split ? ' ' + props.split.className : '')} style={props.split?.style} aria-label="边读边问 AI" hidden={props.hidden}>
      <AiHead label={label} nav={props.nav} newTip="新对话：AI 从头读这份 PDF，问过的和笔记都留着" newDisabled={running} onNew={() => void R.newChat(pdf)} onCollapse={props.onCollapse} />
      {/* 看得到（A 组读 PDF 小样）：这份 PDF · 第几页 | ✓ 读过全文几页 | 笔记几轮（还没记过不画）；看别处的对话时换成「这是在…问的」；下格开着旁支时藏起来 */}
      {props.nav.away ? (
        <AwayBar nav={props.nav} />
      ) : sideShown ? null : (
      <Sees testid="reading-sees">
        {R.isWebSrc(pdf) ? (
          <Chip on>{`网页 · ${webTitle ?? pdf.slice(4)}`}</Chip>
        ) : /\.html?$/i.test(pdf) ? (
          <Chip on>{`${stemOf(pdf)}.html`}</Chip>
        ) : (
          <Chip on>{`${stemOf(pdf)}.pdf · 第${r.state.page}页`}</Chip>
        )}
        {!R.isWebSrc(pdf) && r.pending?.web && /^https?:/i.test(r.pending.web.url) && <Chip on>{`网页 · ${r.pending.web.title}`}</Chip>}
        {r.pages > 0 &&
          (r.readN < r.pages ? (
            <Chip>
              <Codicon name="loading" size={12} className="spin" />
              <span className="num">{`正在读全文${r.readN}/${r.pages}`}</span>
            </Chip>
          ) : (
            <Chip>
              <Codicon name="check" size={12} className="ok" />
              <span className="num">{`读过全文${r.pages}页`}</span>
            </Chip>
          ))}
        {!R.isWebSrc(pdf) && sectionCount > 0 && (
          <Chip>
            <span className="num">{`笔记${sectionCount}轮`}</span>
          </Chip>
        )}
      </Sees>
      )}
      <div
        className="msgs"
        ref={list}
        onClick={(e) => {
          const a = (e.target as Element).closest<HTMLElement>('a.pg[data-page]')
          if (a) R.jumpTo(pdf, Number(a.dataset.page))
          // 问过的那句后面的小标：切到那条旁支，开着的那条再点是关掉
          const b = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
          if (b) toggleSide(b.dataset.side!)
        }}
        onKeyDown={(e) => {
          const b = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
          if (b && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            toggleSide(b.dataset.side!)
          }
        }}
      >
        {/* 空对话和别处同一个样子（D 组小样）；怎么框一块问写在输入框的占位字里，下面一个「问这一页」（⌘↵ 同一件事） */}
        {msgs.length === 0 && (
          <div className="ai-empty">
            <h2>想让它做什么？</h2>
            {/* 「⌄」字画出来像个下标 v：换成和头上对话胶囊同一个 chevron-down 图标 */}
            <p>
              {`这里是「${label}」的对话；别处问过的在上面「${label}`}
              <Codicon name="chevron-down" size={12} className="cv" />
              {'」里。'}
            </p>
            {!R.isWebSrc(pdf) && !props.nav.away && (
              <button className="sug" onClick={() => window.dispatchEvent(new CustomEvent(R.ASK_PAGE, { detail: { src: pdf, text: html ? '给我讲解一下这一屏' : '给我讲解一下这一页' } }))}>
                <AiIcon job="chat" size={14} />
                {html ? '问这一屏' : '问这一页'}
              </button>
            )}
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const startsThread = m.role === 'user' && (!prev || prev.thread !== m.thread || (prev.role === 'ai' && m.time - prev.time > 10 * 60_000))
          const isNew = r.state.newChatAt && m.time >= r.state.newChatAt && (!prev || prev.time < r.state.newChatAt)
          return (
            <Msg
              key={m.id}
              m={m}
              sep={isNew ? `新对话 · ${stamp(r.state.newChatAt!)}` : startsThread ? `${Date.now() - m.time < 10 * 60_000 ? '现在' : stamp(m.time)}${m.page ? ` · 第${m.page}页` : ''}` : null}
              flash={flashMsg === m.thread && startsThread}
              last={m === lastAi && !running}
              running={running && m.id === r.running}
              quote={startsThread ? r.state.threads.find((t) => t.id === m.thread)?.quote : undefined}
              onAgain={(t) => {
                setInput('')
                void R.send(pdf, t)
              }}
              onRephrase={(t) => {
                setInput(t)
                requestAnimationFrame(() => box.current?.focus())
              }}
              ask={m.role === 'ai' && prev?.role === 'user' ? prev.text : undefined}
              busy={running}
              marks={marks.get(m.id)}
              engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
              onShowNote={() => props.onShowNote(m.thread)}
              onRevert={() => void R.revertChange(pdf, m.id).catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}
              onViz={() => void R.makeViz(pdf, m.id)}
              onOpenHtml={props.onOpenHtml}
            />
          )
        })}
      </div>
      {/* 回答里选中一句（CN-90 方向 A）：选区下方的小框，上面一格先打问题，下面「引用进输入框 ⇧⌘L」（输入框顶上那一排的一块，来源「AI的回答 · 第28页」）、「问这句 ↵」（下格开旁支） */}
      <AskBox
        list={list}
        active={!props.hidden}
        onQuote={(text, src) => c.add({ kind: 'quote', text, src })}
        onAsk={(at, question, range) => {
          const id = R.openSide(pdf, at, question)
          // 下格本来关着：这一格要变矮，问的那句留在看得见的地方
          if (id && !r.side.open) keepInView(id, range)
        }}
      />
      <AiInput
        c={c}
        className="reading-in"
        placeholder={pend?.web?.t !== undefined ? `接着问${fmtTime(pend.web.t)}这一帧…` : pend?.blank ? '打你自己的问法…' : `跟${engineLabel}说，${R.isWebSrc(pdf) ? '在网页上按住 ⌘ 框一块' : '在左边框一块'}就能问`}
        hint={hint}
        hintNow={hintNow}
        lead={lead}
        picks={cp.picks}
        // 下格开着旁支时和「看得到」那行一样藏起来（上格要读得下去，DESIGN.v3 2.4b），收成一条时回来；旁支跟主对话用同一个开关
        omni={sideShown ? null : cp.omni}
        running={running}
        sendDisabled={!input.trim() && !c.mats.length}
        own={own}
        onSend={() => send()}
        onStop={() => R.stop(pdf)}
        onNotice={props.onNotice}
        list={list}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
            e.preventDefault()
            send()
          } else if (e.key === 'Enter' && e.metaKey) cmdEnter(e)
          else if (e.key === 'Escape') {
            e.preventDefault()
            // 框着一块、输入框里只有预填的字或空着：连图一起取消（CN-97）；打了自己的字：先离开输入框（再按 esc 在 PDF 上取消这块）
            if (r.pending && !own) R.unstage(pdf)
            box.current?.blur()
          }
        }}
        above={
          // 排着的几问自己占一整块（在那一排下面、字上面），附图再多也不挤它（第 3 轮美学）
          r.queued.length > 0 && (
            <span className="queue">
              {r.queued.map((q, i) => (
                <span key={i} className="queued" role="status" data-testid="reading-queued" title={q.text}>
                  <Codicon name="history" size={12} />
                  <span className="truncate">
                    {i === 0 ? '答完上一问自动发出' : '再接着发'}
                    {q.page ? `（带第${q.page}页）` : ''}：{q.text}
                  </span>
                  <button className="lnk" onClick={() => R.cancelQueued(pdf, i)}>
                    不发了
                  </button>
                </span>
              ))}
            </span>
          )
        }
      />
    </aside>
  )
}

function Msg(p: {
  m: ReadingMsg
  sep: string | null
  flash: boolean
  last: boolean
  running: boolean
  quote?: string
  onAgain(text: string): void
  onRephrase(text: string): void
  /** 这条回答问的是什么（出错时「再问一次」「换个问法」用） */
  ask?: string
  busy: boolean
  engine: { id: string; label?: string }
  onShowNote(): void
  /** 撤回这一问 AI 改的文件（反向提交） */
  onRevert(): void
  onViz(): void
  onOpenHtml(path: string): void
  /** 这条回答里问过的那几句（旁支）：虚线 + 小标 */
  marks?: Mark[]
}) {
  const { m } = p
  // 问过的那几句：答完以后在画好的字上划虚线、插小标（marks.ts）；有小标时字一变 .txt 整块换掉（key），React 不去动改过的节点；
  // 没有小标时不换（答着时每来一段字都整块重画，回答里的表格、公式会一闪一闪地换成新的节点）
  const txt = useRef<HTMLDivElement>(null)
  const marksKey = JSON.stringify(p.marks ?? [])
  useLayoutEffect(() => {
    if (!txt.current || !p.marks?.length || p.running) return
    return applyMarks(txt.current, p.marks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey, m.text, p.running])
  // 框的那块（或整页）：放在这一问的气泡最上面
  const crop = m.image ? (
    <div className="att">
      <img src={vaultImg(m.image)} alt={m.page ? `第 ${m.page} 页框的那块` : '框的那块'} />
    </div>
  ) : null
  return (
    <>
      {p.sep && <div className="daysep">{p.sep}</div>}
      {m.role === 'user' ? (
        <div className={'um-wrap' + (p.flash ? ' flash' : '')} data-thread={p.sep ? m.thread : undefined}>
          {/* 以前粘贴的图（没有材料那时候）照旧画在气泡上面；带材料的图在气泡里那一排列表里 */}
          {!m.mats?.length &&
            m.pasted?.map((n) => (
              <div key={n} className="att">
                <img src={pastedUrl(n)} alt="粘贴的图" />
              </div>
            ))}
          {p.quote && <div className="uq">「{p.quote}」</div>}
          {m.mats?.length ? (
            <MatMsg text={m.text} mats={m.mats} lead={crop} onContextMenu={(e) => onMessageMenu(e, m.text)} />
          ) : (
            <div className={'um' + (crop ? ' wimg' : '')} onContextMenu={(e) => onMessageMenu(e, m.text)}>
              {crop}
              {crop ? <div className="ut">{m.text}</div> : m.text}
            </div>
          )}
        </div>
      ) : (
        <div className="am" data-testid="reading-msg" data-msg={m.id} data-src={m.page ? `AI的回答 · 第${m.page}页` : 'AI的回答'} onContextMenu={(e) => m.text && onMessageMenu(e, withoutVizMark(m.text).text)}>
          {/* 出错的那条不写「✓ 读了第几页」：没答出来，下面红字说为什么 */}
          {m.text && !m.error && m.read && (
            <div className="read">
              <Codicon name="check" size={12} className="ok" />
              <span className="rd">{m.read}</span>
              {m.by && (
                <span className="by">
                  {' · '}
                  <ByLogo by={m.by} />
                  {m.by}
                </span>
              )}
            </div>
          )}
          {/* AI 动手的每一步（DESIGN.v3 2.3）：在做转圈、做完绿勾、出错红叉跟原因；全能模式下它自己跑命令、写文件也写成人话 */}
          {m.steps?.map((s) => (
            <StepRow key={s.id} s={s} />
          ))}
          {!m.text && !m.error && !m.steps?.length && <div className="thinking">正在想…</div>}
          {m.text && (
            <div className="txt md" key={p.marks?.length ? m.text : 'txt'} ref={txt}>
              <Markdown text={withoutVizMark(m.text).text} math />
            </div>
          )}
          {m.error && <AiError raw={m.error} engine={p.engine} {...(p.ask && !p.busy ? { onRetry: () => p.onAgain(p.ask!), onRephrase: () => p.onRephrase(p.ask!) } : {})} />}
          {p.last && m.text && !m.error && (
            <div className="acts">
              <button className="btn btn-xs" onClick={() => p.onAgain('还是不懂')}>
                <Codicon name="question" size={12} />
                还是不懂
              </button>
              <button className="btn btn-xs" onClick={() => p.onAgain('换个方式讲')}>
                <Codicon name="discard" size={12} />
                换个方式讲
              </button>
              {m.vizOk && !m.viz && (
                <button className="btn btn-xs" onClick={p.onViz}>
                  <Codicon name="preview" size={12} />
                  做个可视化
                </button>
              )}
            </div>
          )}
          {m.note === 'writing' && (
            <div className="noted">
              <Codicon name="loading" size={12} className="spin" />
              正在记进笔记…
            </div>
          )}
          {m.note === 'done' && (
            <div className="noted">
              <Codicon name="check" size={12} />
              {m.noteTo ? (
                `已记进${m.noteTo}`
              ) : (
                <>
                  {'已记进笔记 · '}
                  <button className="lnk" onClick={p.onShowNote}>
                    {`第${m.page ?? ''}页`}
                    <Codicon name="chevron-right" size={12} />
                  </button>
                </>
              )}
            </div>
          )}
          {m.note === 'error' && <div className="noted err">没记进笔记：{m.noteError}</div>}
          {m.change && <ChangeBlock change={m.change} onRevert={p.onRevert} />}
          {m.warn && <div className="noted err">{m.warn}</div>}
          {m.vizOk && !m.viz && !(p.last && m.text && !m.error) && (
            <div className="acts">
              <button className="btn btn-xs" onClick={p.onViz}>
                <Codicon name="preview" size={12} />
                做个可视化
              </button>
            </div>
          )}
          {m.viz?.state === 'making' && (
            <div className="vizpill" role="status">
              <Codicon name="loading" size={14} className="spin" />
              后台在做可视化 · 好了会挂进笔记，可以接着问
            </div>
          )}
          {m.viz?.state === 'done' && (
            <div className="vizpill done">
              <Codicon name="preview" size={14} />
              <span className="truncate">可视化做好了：{m.viz.path.split('/').pop()}</span>
              <button className="btn btn-xs btn-primary" onClick={() => p.onOpenHtml((m.viz as { path: string }).path)}>
                打开
              </button>
            </div>
          )}
          {m.viz?.state === 'error' && (
            <div className="noted err">
              没做成可视化：{m.viz.error}
              <button className="lnk" onClick={p.onViz}>
                再试一次
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
