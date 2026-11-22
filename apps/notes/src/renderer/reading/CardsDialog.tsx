/**
 * 出卡（task-tz7y3，2026-11-22 用户选方向 B「AI 先改成卡，一张张过」；原型 /private/tmp/canvas-notes-anki/proto.html#dir=b 的 reviewDlg、spotPop）。
 * - 出卡弹窗 880 × 640：头上「出卡 · Lecture05」和 AI 改到第几张；一排编号小方块（灰底要送、虚线不送、绿点已在 Anki）；
 *   中间一张纸（和 Anki 里那张一个样子：纸顶小字、问题、我框的图、答案、补充、纸底出处和「打开原文」），下面「你当时问的：「…」」；
 *   空格要不要这张、E 改（问题和答案就地改，回车改好）、← → 换一张；底下「要送N张 · 不送M张」、取消、「送进Anki · N张」。
 *   送过的默认不送、不再改写，「还是再送一张」才送；Anki 没开时底下一行说清楚、选的都留着（「怎么装」三行，「打开Anki」开了接着送）。
 * - 问题条上「做成卡」：AI 改好这一问，贴着问题条出一张小卡，能改，「送进Anki」。
 * 改好的、改过的、选了不送的都交给主进程记着（本机），关掉、Anki 没开，下次出卡接着用。
 */
import { Codicon } from '@cn/design'
import { type CardText, mapMath } from '@cn/format'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { AnkiStatus, CardItem, CardScope, CardsView } from '../../shared/reading'
import { AiIcon } from '../engine-logo'
import { useT } from '../i18n'
import { usePrefs } from '../settings-store'
import { renderTex } from '../tex'
import { cardsChanged, closeCards, closeSpot, useCardsOpen, useSpot } from './cards-store'
import './cards.css'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** 「11月21日」 */
const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
/** AI 没改出来的、以前送的没记字的：照原话和回答开头一段 */
const plainCard = (it: CardItem): CardText => ({ q: it.question, a: it.lead.replace(/\s+/g, ' ').slice(0, 120), more: '', quote: it.quote ?? '' })

/** 卡上的字：公式照文档里的认法排（KaTeX），别的照字 */
function Tx({ text }: { text: string }) {
  const parts: ReactNode[] = []
  mapMath(
    text,
    (m) => {
      const t = renderTex(m.tex, !!(m.block || m.display))
      parts.push(t.html ? <span key={parts.length} dangerouslySetInnerHTML={{ __html: t.html }} /> : <span key={parts.length}>{text.slice(m.from, m.to)}</span>)
      return ''
    },
    (t) => {
      if (t) parts.push(t)
      return t
    },
  )
  return <>{parts}</>
}

/** 一张卡（纸）：照 Anki 里「学习卡 · 问答」那张纸（答案接棒），正面背面接在一起 */
function Paper(p: { it: CardItem; card: CardText; editing: boolean; small?: boolean; qRef?: React.RefObject<HTMLDivElement | null>; aRef?: React.RefObject<HTMLDivElement | null>; onOpen?(): void }) {
  const { it, card } = p
  const more = card.more.split('\n').map((x) => x.trim().replace(/^[-•·*]\s*/, '')).filter(Boolean)
  return (
    <div className={'paper' + (p.small ? ' small' : '')}>
      <div className="top">
        <div className="meta">{`Canvas Notes · ${it.course}${it.quote !== undefined ? ' · 旁支' : ''}`}</div>
        {p.editing ? (
          <div className="pq" ref={p.qRef} contentEditable suppressContentEditableWarning>
            {card.q}
          </div>
        ) : (
          <div className="pq">
            <Tx text={card.q} />
          </div>
        )}
        {it.crop && (
          <div className="shot">
            <img src={vaultImg(it.crop)} alt="我框的" style={it.cropW ? { width: it.cropW } : undefined} />
          </div>
        )}
      </div>
      <div className="ansb">
        {p.editing ? (
          <div className="pa" ref={p.aRef} contentEditable suppressContentEditableWarning>
            {card.a}
          </div>
        ) : (
          <div className="pa">
            <Tx text={card.a} />
          </div>
        )}
        {more.length > 0 && (
          <ul className="pts">
            {more.map((m, i) => (
              <li key={i}>
                <Tx text={m} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="foot">
        <span>{`${stem(it.pdf)} · 第 ${it.page} 页`}</span>
        <button className="open" onClick={p.onOpen} title="回到这份 PDF 的这一页">
          打开原文
        </button>
      </div>
    </div>
  )
}

/** 连上 Anki（anki-learn DESIGN.md「连上 Anki」三行）：出卡弹窗里 Anki 没开时、设置 › 读PDF「Anki 没开、没装时」点「怎么装」 */
export function HowTo(p: { st: AnkiStatus; onOpen(): void }) {
  const { st } = p
  const t = useT()
  const [copied, setCopied] = useState<'id' | 'cmd' | null>(null)
  return (
    <div className="howto" role="region" aria-label="连上Anki">
      <div className="hrow">
        <i className={'dot' + (st.app ? ' g' : '')} />
        <b>Anki桌面版</b>
        <span className={st.app ? 'ok' : ''}>{st.app ? `装好了${st.app.version ? ` · ${st.app.version}` : ''}` : '没装'}</span>
        {!st.app && (
          <button className="btn btn-xs" onClick={() => void window.cnReading.ankiDownload()}>
            <Codicon name="cloud-download" size={14} />
            下载Anki
          </button>
        )}
      </div>
      <div className="hrow">
        <i className={'dot' + (st.addon ? ' g' : '')} />
        <b>AnkiConnect插件</b>
        <span className={st.addon ? 'ok' : ''}>{st.addon ? '装好了 · 编号2055492159' : 'Anki里「工具 › 附加组件 › 获取附加组件」，粘贴编号2055492159，重启Anki'}</span>
        {!st.addon && (
          <button className="btn btn-xs" onClick={() => void navigator.clipboard.writeText('2055492159').then(() => setCopied('id'))}>
            <Codicon name="copy" size={14} />
            {copied === 'id' ? '拷好了' : '复制编号'}
          </button>
        )}
      </div>
      <div className="hrow">
        <i className={'dot' + (st.connected ? ' g' : '')} />
        <b>Anki开着</b>
        <span className={st.connected ? 'ok' : ''}>{st.connected ? '开着' : '没开着'}</span>
        {!st.connected && st.app && (
          <button className="btn btn-xs" onClick={p.onOpen}>
            打开Anki
          </button>
        )}
      </div>
      {/* 8765 被别的程序占着时 AnkiConnect 起不来（2026-11-22 用户截图：python3 -m http.server 8765 占着）：查是谁、关掉、重启 Anki */}
      <div className="hrow" data-testid="howto-port">
        <i className="dot none" />
        <b>{t('8765端口被占时')}</b>
        <span>{t('复制命令贴进终端，看是哪个程序占着；关掉它，再重启Anki')}</span>
        <button className="btn btn-xs" onClick={() => void navigator.clipboard.writeText('lsof -nP -iTCP:8765 -sTCP:LISTEN').then(() => setCopied('cmd'))}>
          <Codicon name="copy" size={14} />
          {copied === 'cmd' ? t('拷好了') : t('复制命令')}
        </button>
      </div>
    </div>
  )
}

/** Anki 没开、没装、连不上插件：一行说清楚，选的都留着 */
function offText(st: AnkiStatus): string {
  if (!st.app) return '没找到Anki。装好Anki和AnkiConnect插件再送，选的都留着。'
  if (!st.addon) return 'Anki里没装AnkiConnect插件。装好插件、重启Anki再送，选的都留着。'
  return 'Anki没开着。选的都留着，开了接着送。'
}

export interface CardsHostProps {
  /** 送好了、撤回了：底下提示条（带「打开Anki」「撤回」） */
  onToast(t: { text: string; act?: { label: string; run(): void }; undo?: () => void }): void
  onNotice(text: string): void
  onOpenPdfAt(pdf: string, page: number): void
}

/** App 里放一个：出卡弹窗、「做成卡」小卡 */
export function CardsHost(p: CardsHostProps) {
  const open = useCardsOpen()
  const spot = useSpot()
  return (
    <>
      {open && <CardsDialog key={open.seq} scope={open.scope} {...p} />}
      {spot && <SpotCard key={spot.seq} spot={spot} {...p} />}
    </>
  )
}

/** 送好了说一句：几张、进了哪个牌组，牌组里已经有的跳过 */
function sentText(r: { added: string[]; duplicates: string[]; failed: Record<string, string>; decks?: string[] }): string {
  const decks = r.decks ?? []
  // 几个牌组（跟着文件夹分的）：写它们共同的上一层「课程::ecp」下的几个；其中一个就是那一层时，下面只有一个写出它的名字
  // 「和下面的「补充材料」」，几个写「和下面N个牌组」；没有共同的上一层（课程里的和「知识」一起送）只写几个
  const parts = decks.map((d) => d.split('::'))
  const common: string[] = []
  for (let k = 0; parts[0]?.[k] !== undefined && parts.every((x) => x[k] === parts[0]![k]); k++) common.push(parts[0]![k]!)
  const top = common.join('::')
  const subs = decks.filter((d) => d !== top).map((d) => d.slice(top.length + 2))
  const where =
    decks.length < 2
      ? `牌组「${decks[0] ?? '知识'}」`
      : !top
        ? `${decks.length}个牌组`
        : !decks.includes(top)
          ? `牌组「${top}」下的${decks.length}个牌组`
          : subs.length === 1
            ? `牌组「${top}」和下面的「${subs[0]}」`
            : `牌组「${top}」和下面${subs.length}个牌组`
  const failed = Object.keys(r.failed).length
  return `已送进Anki · ${r.added.length}张（${where}）${r.duplicates.length ? `，${r.duplicates.length}张Anki里已经有了，跳过` : ''}${failed ? `，${failed}张没送进去：${Object.values(r.failed)[0]}` : ''}`
}

/** 送：送好了提示条带「打开Anki」「撤回」；Anki 没开返回它的样子 */
async function sendNow(scope: CardScope, cards: { id: string; card: CardText }[], p: CardsHostProps): Promise<{ off?: AnkiStatus; error?: string } | null> {
  const r = await window.cnReading.sendCards(scope, cards)
  if (r.off) return { off: r.off }
  if (r.error) return { error: r.error }
  const failed = Object.keys(r.failed).length
  if (failed && !r.added.length && !r.duplicates.length) return { error: `一张也没送进去：${Object.values(r.failed)[0]}` }
  cardsChanged()
  const ids = [...r.added, ...r.duplicates]
  p.onToast({
    text: sentText(r),
    act: { label: '打开Anki', run: () => void window.cnReading.openAnki(r.added).catch((e) => p.onNotice(errText(e))) },
    undo: () =>
      void window.cnReading.undoCards(scope, ids).then(
        (u) => (u.error ? p.onNotice(u.error) : (cardsChanged(), p.onNotice(`撤回了：Anki 里删掉了这${r.added.length}张，笔记里不再标已送`))),
        (e) => p.onNotice(errText(e)),
      ),
  })
  return null
}

function CardsDialog(p: CardsHostProps & { scope: CardScope }) {
  const sides = usePrefs((s) => s.pdf.ankiSides)
  const [view, setView] = useState<CardsView | null>(null)
  const [cards, setCards] = useState<Record<string, CardText>>({})
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const [edited, setEdited] = useState<Set<string>>(new Set())
  const [force, setForce] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<AnkiStatus | null>(null)
  const [how, setHow] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qRef = useRef<HTMLDivElement>(null)
  const aRef = useRef<HTMLDivElement>(null)
  const job = useRef(Math.floor(Math.random() * 1e9))
  const viewRef = useRef<CardsView | null>(null)
  viewRef.current = view
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  // 读这个范围问过的几问：没送的在前（旁支设置关着不算），送过的在后；没改好的交给 AI
  useEffect(() => {
    let stale = false
    void window.cnReading.cards(p.scope).then(
      (v) => {
        if (stale) return
        const items = v.items.filter((it) => sides || it.quote === undefined || it.sent)
        const fresh = items.filter((it) => !it.sent)
        const old = items.filter((it) => it.sent)
        const ordered = { ...v, items: [...fresh, ...old] }
        const c: Record<string, CardText> = {}
        const k: Record<string, boolean> = {}
        const ed = new Set<string>()
        for (const it of fresh) {
          if (it.draft) c[it.id] = it.draft.card
          if (it.draft?.edited) ed.add(it.id)
          k[it.id] = !it.draft?.skip
        }
        for (const it of old) {
          c[it.id] = it.draft?.card ?? it.sent?.card ?? plainCard(it)
          k[it.id] = false
        }
        setView(ordered)
        setCards(c)
        setKeep(k)
        setEdited(ed)
        const want = fresh.filter((it) => !c[it.id]).map((it) => it.id)
        setPending(new Set(want))
        if (want.length) void window.cnReading.draftCards(job.current, p.scope, want).catch((e) => setFailed(errText(e)))
      },
      (e) => (p.onNotice(errText(e)), closeCards()),
    )
    const offEv = window.cnReading.onCards((e) => {
      if (e.job !== job.current) return
      if ('card' in e) {
        setCards((c) => ({ ...c, [e.id]: e.card }))
        setPending((s) => {
          const n = new Set(s)
          n.delete(e.id)
          return n
        })
      } else {
        if (e.error) setFailed(e.error)
        // 没改出来的照原话（按 E 能自己改）
        const left = (viewRef.current?.items ?? []).filter((x) => pendingRef.current.has(x.id))
        if (left.length) setCards((c) => ({ ...Object.fromEntries(left.map((x) => [x.id, plainCard(x)])), ...c }))
        setPending(new Set())
      }
    })
    const j = job.current
    return () => {
      stale = true
      offEv()
      void window.cnReading.stopCards(j)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = view?.items ?? []
  const it = items[Math.min(i, items.length - 1)]
  const fresh = items.filter((x) => !x.sent)
  const go = items.filter((x) => keep[x.id] && cards[x.id])
  const drafting = pending.size > 0
  const done = fresh.filter((x) => cards[x.id] && !pending.has(x.id)).length
  const sub = !view ? '' : drafting ? `AI 在改写 ${done}/${fresh.length}…` : `改好了${fresh.length}张${items.length - fresh.length ? ` · ${items.length - fresh.length}张送过了，不再改写` : ''} · ${view.by}`

  const step = (d: number) => {
    setEditing(false)
    setI((x) => Math.max(0, Math.min(items.length - 1, x + d)))
  }
  const toggle = () => {
    if (!it || (it.sent && !force.has(it.id))) return
    const on = !keep[it.id]
    setKeep((k) => ({ ...k, [it.id]: on }))
    if (!it.sent) void window.cnReading.keepCard(it.id, { skip: !on }).catch(() => undefined)
    if (!on) step(1)
  }
  const startEdit = () => {
    if (!it || !cards[it.id] || (it.sent && !force.has(it.id))) return
    setEditing(true)
  }
  const saveEdit = () => {
    if (!it) return
    const c = cards[it.id]!
    const q = qRef.current?.innerText.trim() || c.q
    const a = aRef.current?.innerText.trim() || c.a
    const next = { ...c, q, a }
    setCards((x) => ({ ...x, [it.id]: next }))
    setEdited((s) => new Set(s).add(it.id))
    setEditing(false)
    void window.cnReading.keepCard(it.id, { card: next, edited: true }).catch((e) => p.onNotice(errText(e)))
  }
  const send = async () => {
    if (!go.length || drafting || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await sendNow(p.scope, go.map((x) => ({ id: x.id, card: cards[x.id]! })), p)
      if (!r) return closeCards()
      if (r.off) setOff(r.off)
      if (r.error) setError(r.error)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send

  // 「打开Anki」：开了（AnkiConnect 答话了）接着送；等一分钟还没开就不等了
  const openAnki = async () => {
    try {
      if (!(await window.cnReading.openAnki())) return setHow(true)
    } catch (e) {
      return setError(errText(e))
    }
    setWaiting(true)
  }
  useEffect(() => {
    if (!waiting) return
    let n = 0
    const t = setInterval(() => {
      void window.cnReading.ankiStatus().then((st) => {
        setOff(st)
        if (st.connected) {
          clearInterval(t)
          setWaiting(false)
          setOff(null)
          void sendRef.current()
        } else if (++n > 60) {
          clearInterval(t)
          setWaiting(false)
        }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [waiting])
  // 「怎么装」开着：每 2 秒查一次
  useEffect(() => {
    if (!how || waiting) return
    const t = setInterval(() => void window.cnReading.ankiStatus().then(setOff), 2000)
    return () => clearInterval(t)
  }, [how, waiting])

  // 键：空格要不要、E 改、← → 换张、esc 关；改的时候回车改好、esc 不改了
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.isContentEditable) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) (e.preventDefault(), saveEdit())
        else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEditing(false))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') (e.preventDefault(), toggle())
      else if (e.key === 'e' || e.key === 'E') (e.preventDefault(), startEdit())
      else if (e.key === 'ArrowRight') (e.preventDefault(), step(1))
      else if (e.key === 'ArrowLeft') (e.preventDefault(), step(-1))
      else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), closeCards())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  // 改的时候光标落在问题末尾
  useEffect(() => {
    const el = qRef.current
    if (!editing || !el) return
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(r)
  }, [editing])

  const label = view?.label ?? ''
  const keepN = items.filter((x) => keep[x.id]).length
  const skipN = items.length - keepN
  const openAt = (x: CardItem) => (closeCards(), p.onOpenPdfAt(x.pdf, x.page))
  let body: ReactNode = null
  if (it && !cards[it.id]) body = (
    <div className="drafting">
      <AiIcon job="cards" size={14} />
      <span className="shimmer">{`AI 在把第${i + 1}问改成卡…`}</span>
    </div>
  )
  else if (it && it.sent && !force.has(it.id))
    body = (
      <>
        <div className="pw dim">
          <Paper it={it} card={cards[it.id]!} editing={false} onOpen={() => openAt(it)} />
        </div>
        <div className="orig done">
          <Codicon name="check" size={14} className="ok" />
          {`这一问送过了（${dayOf(it.sent.at)}），这次不送。`}
          <button
            className="btn btn-xs"
            onClick={() => {
              setForce((s) => new Set(s).add(it.id))
              setKeep((k) => ({ ...k, [it.id]: true }))
            }}
          >
            <Codicon name="refresh" size={14} />
            还是再送一张
          </button>
        </div>
      </>
    )
  else if (it)
    body = (
      <>
        <div className={'pw' + (keep[it.id] ? '' : ' skipped')}>
          <Paper it={it} card={cards[it.id]!} editing={editing} qRef={qRef} aRef={aRef} onOpen={() => openAt(it)} />
        </div>
        <div className="orig">
          <Codicon name={it.quote !== undefined ? 'comment-discussion' : 'comment'} size={14} />
          <span>{`你当时问的：「${it.question}」${it.quote !== undefined ? ` · 旁支，问的是「${it.quote.slice(0, 14)}…」` : ''}`}</span>
          {edited.has(it.id) && <span className="chip">改过</span>}
        </div>
        <div className="keys">
          {editing ? (
            <button className="btn btn-xs btn-primary" aria-label="改好了" onClick={saveEdit}>
              <Codicon name="check" size={14} />
              改好了<kbd>↵</kbd>
            </button>
          ) : (
            <>
              <button className="btn btn-xs" aria-label={keep[it.id] ? '不送这张' : '要这张'} onClick={toggle}>
                <Codicon name={keep[it.id] ? 'circle-slash' : 'check'} size={14} />
                {keep[it.id] ? '不送这张' : '要这张'}
                <kbd>空格</kbd>
              </button>
              <button className="btn btn-xs" aria-label="改" onClick={startEdit}>
                <Codicon name="edit" size={14} />改<kbd>E</kbd>
              </button>
              <button className="btn btn-xs" aria-label="上一张" onClick={() => step(-1)}>
                <Codicon name="chevron-left" size={14} />
                <kbd>←</kbd>
              </button>
              <button className="btn btn-xs" aria-label="下一张" onClick={() => step(1)}>
                <Codicon name="chevron-right" size={14} />
                <kbd>→</kbd>
              </button>
            </>
          )}
        </div>
      </>
    )

  return (
    <div className="pal-back cards-back" onMouseDown={() => closeCards()}>
      <div className="cardsdlg" role="dialog" aria-label="出卡" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dh">
          <AiIcon job="cards" size={14} />
          <b>{`出卡 · ${label}`}</b>
          <span className="sub">{sub}</span>
          <button className="x" aria-label="关闭" onClick={() => closeCards()}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        <div className="strip">
          <div className="sq" role="group" aria-label="每一张">
            {items.map((x, k) => (
              <button
                key={x.id}
                className={[keep[x.id] ? '' : 'skip', k === i ? 'cur' : '', cards[x.id] ? '' : 'wait'].filter(Boolean).join(' ')}
                aria-label={`第${k + 1}张`}
                onClick={() => (setEditing(false), setI(k))}
              >
                {k + 1}
                {x.sent && <span className="gd" />}
              </button>
            ))}
          </div>
          <span className="lg">
            <span>
              <i />
              要送
            </span>
            <span>
              <i className="d" />
              不送
            </span>
            <span>
              <span className="dot" />
              已在Anki
            </span>
          </span>
        </div>
        <div className="rvbody">
          {!view ? null : items.length ? body : <div className="drafting">这里还没问过。读 PDF 时框一块问 AI，问过的都能出卡。</div>}
          {failed && !drafting && <div className="orig warn">{failed}</div>}
        </div>
        {off && (
          <>
            <div className="warnrow" data-testid="anki-off">
              {waiting ? <Codicon name="loading" size={14} className="spin" /> : <Codicon name="warning" size={14} className="wr" />}
              <span>{waiting ? '在等Anki打开…打开了接着送' : offText(off)}</span>
              <span className="sp" />
              <button className="btn btn-xs" onClick={() => setHow((h) => !h)}>
                <Codicon name="question" size={14} />
                怎么装
              </button>
              {off.app && !waiting && (
                <button className="btn btn-xs" onClick={() => void openAnki()}>
                  打开Anki
                </button>
              )}
            </div>
            {how && <HowTo st={off} onOpen={() => void openAnki()} />}
          </>
        )}
        {error && (
          <div className="warnrow err" role="alert">
            <Codicon name="error" size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className="df">
          <span className="cnt num">{`要送${keepN}张${skipN ? ` · 不送${skipN}张` : ''}`}</span>
          <span className="sp" />
          <button className="btn btn-sm" onClick={() => closeCards()}>
            取消
          </button>
          <button className="btn btn-sm btn-primary" disabled={!go.length || drafting || busy || editing} onClick={() => void send()}>
            {busy ? (
              <>
                <Codicon name="loading" size={14} className="spin" />
                正在送…
              </>
            ) : (
              <>
                <Codicon name="send" size={14} />
                {`送进Anki · ${keepN}张`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 问题条上「做成卡」：AI 改好这一问，小卡贴在问题条下面（放不下往上挪），能改，送进 Anki */
function SpotCard(p: CardsHostProps & { spot: NonNullable<ReturnType<typeof useSpot>> }) {
  const scope = useMemo<CardScope>(() => ({ kind: 'pdf', pdf: p.spot.pdf }), [p.spot.pdf])
  const [it, setIt] = useState<CardItem | null>(null)
  const [card, setCard] = useState<CardText | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const qRef = useRef<HTMLDivElement>(null)
  const aRef = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const job = useRef(Math.floor(Math.random() * 1e9))
  const [top, setTop] = useState(p.spot.at.bottom + 6)

  useEffect(() => {
    let stale = false
    const off = window.cnReading.onCards((e) => {
      if (e.job !== job.current) return
      if ('card' in e) setCard(e.card)
      else if (e.error) setCard((c) => c ?? null)
    })
    void window.cnReading.cards(scope).then((v) => {
      const x = v.items.find((y) => y.id === p.spot.id)
      if (stale || !x) return
      setIt(x)
      if (x.draft) setCard(x.draft.card)
      else void window.cnReading.draftCards(job.current, scope, [x.id])
    })
    const j = job.current
    return () => {
      stale = true
      off()
      void window.cnReading.stopCards(j)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 放不下往上挪
  useEffect(() => {
    const h = box.current?.offsetHeight ?? 0
    setTop(Math.max(48, Math.min(p.spot.at.bottom + 6, window.innerHeight - 40 - h)))
  }, [card, editing, p.spot.at.bottom])
  // 点外面、esc 收起
  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && closeSpot()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (editing ? setEditing(false) : closeSpot(), e.stopPropagation())
      if (e.key === 'Enter' && editing && !e.shiftKey && !e.isComposing) (e.preventDefault(), save())
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => (window.removeEventListener('mousedown', onDown, true), window.removeEventListener('keydown', onKey, true))
  })
  const save = () => {
    if (!card || !it) return
    const next = { ...card, q: qRef.current?.innerText.trim() || card.q, a: aRef.current?.innerText.trim() || card.a }
    setCard(next)
    setEditing(false)
    void window.cnReading.keepCard(it.id, { card: next, edited: true })
  }
  const send = async () => {
    if (!card || !it) return
    setBusy(true)
    try {
      const r = await sendNow(scope, [{ id: it.id, card }], p)
      if (r?.off) p.onNotice('Anki 没开着：这张改好的留着，开了在笔记栏「出卡」里接着送')
      if (r?.error) p.onNotice(r.error)
      closeSpot()
    } catch (e) {
      p.onNotice(errText(e))
    } finally {
      setBusy(false)
    }
  }
  // 收在笔记栏里：离栏两边至少 8，栏窄时跟着窄
  const pane = p.spot.pane
  const W = Math.min(340, pane.right - pane.left - 16)
  const left = Math.max(pane.left + 8, Math.min(p.spot.at.right - W, pane.right - W - 8))
  return (
    <div className="cardpop" ref={box} role="dialog" aria-label="做成卡" style={{ left, top, width: W }}>
      {!it || !card ? (
        <div className="drafting">
          <AiIcon job="cards" size={14} />
          <span className="shimmer">AI 在把这一问改成卡…</span>
        </div>
      ) : (
        <>
          <Paper it={it} card={card} editing={editing} small qRef={qRef} aRef={aRef} onOpen={() => (closeSpot(), p.onOpenPdfAt(it.pdf, it.page))} />
          <div className="pb">
            {editing ? (
              <button className="btn btn-xs btn-primary" onClick={save}>
                <Codicon name="check" size={14} />
                改好了
              </button>
            ) : (
              <button className="btn btn-xs" onClick={() => setEditing(true)}>
                <Codicon name="edit" size={14} />改
              </button>
            )}
            <span className="sp" />
            <button className="btn btn-xs btn-ghost" onClick={() => closeSpot()}>
              算了
            </button>
            <button className="btn btn-xs btn-primary" disabled={busy || editing} onClick={() => void send()}>
              <Codicon name="send" size={14} />
              送进Anki
            </button>
          </div>
        </>
      )}
    </div>
  )
}
