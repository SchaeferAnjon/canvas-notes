/**
 * 白板上「费曼 · 范数」这一列（设计页 16-费曼学习 第 1、3、5、6 节，原型 design/feynman/proto.html 的 .fc）：
 * 列头（标志和模型、材料、看过材料几次、这一节的进度、只给核心的小点、暂停）→ 这次要讲到 → 学生开口 → 你讲的、学生追问 → 回答框
 * → 讲完了看判定 → 判定卡、缺口、说法提醒、完整版、四个按钮。暂停时收成一句「暂停在第 N 轮……」和「接着讲」。
 * 字都在文档那一节里（shared/feynman/doc.ts），这里只照它画；一时的状态（在想、长出来、标出来的那句）在 store.ts。
 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CORE_MAX, type Candidate, type CoreState, type Entry, type FeynmanMeta, findRounds, type Gap, roundById, roundsUsed, type RoundSection, verdictLine } from '../../shared/feynman'
import { GROW_TICK, growStep } from '../../shared/ai-grow'
import { still } from '../ai-act-store'
import { GlowRing } from '../ai-glow'
import { ByLogo, EngineLogo, useChatEngine } from '../engine-logo'
import { useT } from '../i18n'
import { composing } from '../ime'
import { isKey, keyFor } from '../keys'
import { showMenu } from '../ctx/menu'
import * as A from './after'
import { DictationBar, DictationLive, DictationMic, DictationNote, useDictation } from '../voice/dictation'
import * as S from './store'
import './feynman.css'

export interface ColumnProps {
  path: string
  id: string
  text: string
  readOnly: boolean
  /** 导图白板（「补进导图」）还是卡片（「拍成导图」） */
  fromMap: boolean
  style?: React.CSSProperties
  /** 白板底部提示 */
  onSay(text: string, undo?: () => void): void
  /** 这块白板在前台（esc 才归它） */
  active: boolean
}

const STATE_CLS: Record<CoreState, 'good' | 'vague' | 'missing' | 'wrong'> = { clear: 'good', asked: 'good', fixed: 'good', vague: 'vague', missing: 'missing', wrong: 'wrong' }
const DOT_CLS = { good: 'ok', vague: 'vague', missing: 'miss', wrong: 'bad' } as const

export function FeynmanColumn(p: ColumnProps) {
  const t = useT()
  S.useFeynman()
  const r = roundById(p.text, p.id)
  const live = S.liveOf(p.id)
  const body = useRef<HTMLDivElement>(null)
  const col = useRef<HTMLElement>(null)
  const status = r?.meta.status
  // 刚出来、刚开讲：白板平移到这一列整个露出来（不改缩放）。打开白板时早就有的一轮不平移（以前一打开就把白板推到它那里，左边的列被推到工具板底下）
  const mounted = useRef(false)
  useEffect(() => {
    const first = !mounted.current
    mounted.current = true
    if (first && !S.isFresh(p.id)) return
    // 还要摆到落点去（写进文档时先出在一排的末尾）：摆好、重画以后再平移，不往一排末尾那里滚
    if (S.placeOf(p.id)) return
    reveal(col.current)
  }, [status === 'draft', status === 'talking'])
  // 讲着时 esc：学生在想先停下它，再按一次暂停（列在前台、焦点不在别的输入框、输入法没在组字）
  useEffect(() => {
    if (status !== 'talking' || !p.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || composing(e)) return
      if (!col.current?.checkVisibility()) return
      const tgt = e.target as HTMLElement | null
      if (tgt?.closest?.('input, textarea, [contenteditable="true"]') && !col.current.contains(tgt)) return
      if (document.querySelector('.ed-pop:not([hidden]), [role="dialog"], [role="menu"]')) return
      const did = S.esc(p.path, p.id)
      if (did) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, p.active, p.path, p.id])
  // 新的一段出来、回答框出来：滚到底
  const count = r?.entries.length ?? 0
  const verdictKey = r?.meta.verdict ? r.meta.verdict + (r.meta.redone ? '+' : '') : ''
  const lastVerdict = useRef(verdictKey)
  useLayoutEffect(() => {
    const b = body.current
    if (!b) return
    // 刚判完：判定那张顶到列头下面（往下翻是缺口、完整版）；别的时候滚到底，回答框整个露出来
    if (verdictKey && verdictKey !== lastVerdict.current) {
      const res = b.querySelector<HTMLElement>('.fy-res')
      if (res) b.scrollTop = res.offsetTop - b.offsetTop - 8
    } else if (!verdictKey || live?.input || live?.thinking) b.scrollTop = b.scrollHeight
    lastVerdict.current = verdictKey
  }, [count, live?.input, !!live?.thinking, verdictKey])
  if (!r) return null
  const m = r.meta
  const cores = m.points.filter((x) => x.kind === 'core')
  const judged = m.status === 'judged' && !!m.states
  const paused = m.status === 'paused' || (m.status === 'talking' && !live)
  const talking = m.status === 'talking' && !!live
  const label = S.labelOf(m.id) ?? labelFrom(m, t)
  return (
    <section
      ref={col}
      className={'fy-col' + (live?.thinking ? ' think' : '') + (paused ? ' paused' : '')}
      data-testid="fy-col"
      data-id={m.id}
      data-status={paused ? 'paused' : m.status}
      aria-label={t('费曼 · {topic}', { topic: m.topic })}
      style={p.style}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {live?.thinking && <GlowRing mode="loop" className="fy-glow" />}
      <header className="fy-h">
        <div className="fy-t">
          <Codicon name="mortar-board" size={15} />
          <b>{t('费曼 · {topic}', { topic: m.topic })}</b>
          <span className="sp" />
          <Dots m={m} judged={judged} />
          {m.status === 'draft' && !p.readOnly && (
            <button type="button" className="fy-x" data-testid="fy-discard" aria-label={t('不讲了')} data-tip={t('不讲了：这一列拿掉')} data-side="below" onClick={() => S.discard(p.path, p.id)}>
              <Codicon name="close" size={14} />
            </button>
          )}
          {m.status !== 'draft' && !p.readOnly && (
            <button
              type="button"
              className="fy-x"
              data-testid="fy-more"
              aria-label={t('更多')}
              data-tip={t('更多')}
              data-side="below"
              onClick={() =>
                void showMenu([
                  ...(talking && !live?.thinking && r.entries.some((e) => e.kind === 'me') ? [{ label: t('现在结束，看判定'), run: () => void S.finish(p.path, p.id) }] : []),
                  { label: t('删掉这一轮'), run: () => S.discard(p.path, p.id) },
                ])
              }
            >
              <Codicon name="ellipsis" size={14} />
            </button>
          )}
          {talking && !live?.redo && (
            <button type="button" className="fy-pz" data-testid="fy-pause" data-tip={t('暂停：讲过的都留着；材料先露出来（也可以按 esc）')} data-side="below" onClick={() => S.pause(p.path, p.id)}>
              <Codicon name="debug-pause" size={14} />
              {t('暂停')}
            </button>
          )}
        </div>
        <div className="fy-m">
          <ByEngine by={m.by} />
          <span className="dim">·</span>
          <span className="lb">{label}</span>
          {m.peeks > 0 && <span className="peeks" data-testid="fy-peeks">{t('看过材料{n}次', { n: m.peeks })}</span>}
        </div>
        <Progress text={p.text} m={m} />
      </header>
      {paused ? (
        <div className="fy-pzline" data-testid="fy-paused">
          <span>{t('暂停在第{n}轮。讲过的、问过的都存在这一节里；材料先露出来，接着讲时再盖上，这次暂停记成看过一次材料。', { n: roundNo(m) || 1 })}</span>
          <button type="button" className="fy-btn solid" data-testid="fy-resume" onClick={() => S.resume(p.path, p.id)}>
            <Codicon name="play" size={14} />
            {t('接着讲')}
          </button>
        </div>
      ) : (
        <div className="fy-b" ref={body}>
          <Plan r={r} path={p.path} readOnly={p.readOnly} onSay={p.onSay} />
          {m.status !== 'draft' && <Opener m={m} />}
          <Entries r={r} live={live} path={p.path} fromMap={p.fromMap} readOnly={p.readOnly} onSay={p.onSay} />
          {live?.thinking && live.stream && (
            <div className="fy-ai ask" data-testid="fy-stream">
              <AiHead who={t('学生')} by={m.by} />
              <div className="q">
                {live.stream}
                <span className="fy-caret" />
              </div>
            </div>
          )}
          {live?.thinking && (
            <div className="fy-wait" data-testid="fy-thinking">
              <span className="breath" />
              {live.thinking.word}
              <span className="sp" />
              <span className="k">{t('停下 esc')}</span>
            </div>
          )}
          {live?.note && !live.thinking && <div className="fy-note">{live.note}</div>}
          {live?.input && live.input !== 'end' && !live.thinking && !p.readOnly && <Answer path={p.path} id={p.id} live={live} demo={demoOf(r, live)} terms={[m.topic, ...m.points.map((x) => x.text)]} first={!r.entries.some((e) => e.kind === 'me')} />}
          {live?.input === 'end' && !live.thinking && (
            <div className="fy-done">
              <span>{t('问了{n}轮。了解即可的不追问。', { n: roundNo(m) })}</span>
              <button type="button" className="fy-btn solid" data-testid="fy-finish" onClick={() => void S.finish(p.path, p.id)}>
                {t('讲完了，看判定')}
              </button>
            </div>
          )}
          {m.status === 'talking' && !live?.input && !live?.thinking && live && !judged && (
            <div className="fy-done">
              <span className="sp" />
              <button type="button" className="fy-btn ghost" onClick={() => void S.finish(p.path, p.id)}>
                {t('讲完了，看判定')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 把白板平移到这一列整个露出来：离白板四边至少 24，左边让出工具板（96）；放不下时先保列头。不改缩放
 */
export function reveal(el: HTMLElement | null) {
  const wrap = el?.closest<HTMLElement>('.board-wrap')
  if (!el || !wrap) return
  const w = wrap.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  let dx = 0
  let dy = 0
  if (r.right > w.right - 24) dx = r.right - (w.right - 24)
  if (r.left - dx < w.left + 96) dx = r.left - (w.left + 96)
  if (r.bottom > w.bottom - 24) dy = r.bottom - (w.bottom - 24)
  if (r.top - dy < w.top + 64) dy = r.top - (w.top + 64)
  if (dx || dy) wrap.scrollBy({ left: dx, top: dy, behavior: still() ? 'auto' : 'smooth' })
}

/** 列头第二行：照什么核对（没记下时按材料猜一句） */
function labelFrom(m: FeynmanMeta, t: ReturnType<typeof useT>): string {
  const map = m.from.find((f) => f.kind === 'map')
  const web = m.cover.some((c) => c.kind === 'web')
  const cards = m.from.filter((f) => f.kind === 'card').length
  if (map && map.kind === 'map') return web ? t('照导图「{name}」这一支和配对的网页核对', { name: map.text }) : t('照导图「{name}」这一支核对', { name: map.text })
  if (cards) return web ? t('照这{n}张卡和配对的网页核对', { n: cards }) : t('照这{n}张卡核对', { n: cards })
  const pdf = m.from.find((f) => f.kind === 'pdf')
  if (pdf && pdf.kind === 'pdf') return t('照《{name}》核对', { name: pdf.path.split('/').pop()!.replace(/\.pdf$/i, '') })
  return m.noMaterial ? t('没有材料，AI 自己定的要点') : t('照库里的笔记核对')
}

/** 第几轮追问（学生追问、拉回核心才算一轮） */
const roundNo = (m: FeynmanMeta) => roundsUsed(m.asked)

/**
 * 「填一段示例」填什么（原型的演示用）：先讲一段时是前几条核心的正确说法（留一条给学生问），回答追问时是问的那一条的，
 * 当场再讲时是那几处的；没有正确说法（你加的）就不出这颗
 */
function demoOf(r: RoundSection, live: S.Live): string | undefined {
  const m = r.meta
  const ans = (ids: string[]) => ids.map((id) => m.points.find((p) => p.id === id)?.answer ?? '').filter(Boolean).join('；')
  const cores = m.points.filter((p) => p.kind === 'core')
  if (live.input === 'redo') return ans(live.redo ?? []) || undefined
  if (live.input === 'explain') return ans(cores.slice(0, Math.max(1, cores.length - 1)).map((p) => p.id)) || undefined
  const last = [...m.asked].reverse().find((a) => a.point)
  return last?.point ? ans([last.point]) || undefined : undefined
}

function ByEngine({ by }: { by?: string }) {
  const eng = useChatEngine()
  return (
    <span className="by" data-testid="fy-by">
      {by ? <ByLogo by={by} /> : <EngineLogo id={eng.id} size={12} className="by-logo" />}
      {by ?? eng.label}
    </span>
  )
}

/** 列头的小点：只有核心占；讲的时候讲到了变灰，判过以后才变绿、黄、红 */
function Dots({ m, judged }: { m: FeynmanMeta; judged: boolean }) {
  const t = useT()
  const cores = m.points.filter((x) => x.kind === 'core')
  return (
    <span className="fy-dots" data-testid="fy-dots" data-tip={t('核心{n}条：讲的时候讲到了变灰；判过以后绿 讲清 · 黄 含糊 · 红 讲错 · 虚线 没讲到', { n: cores.length })} data-side="below">
      {cores.map((c) => {
        const st = judged ? m.states?.find((s) => s.id === c.id)?.state : undefined
        const fixedNow = !!m.gaps?.some((g) => g.point === c.id && g.redone)
        const cls = fixedNow ? 'ok' : st ? DOT_CLS[STATE_CLS[st]] : m.touched?.includes(c.id) ? 'touched' : ''
        return <i key={c.id} className={cls} data-k={c.id} />
      })}
    </span>
  )
}

/** 这一节的进度：这一节里几个知识点，过的绿、差一点黄、没过红、正在讲蓝 */
function Progress({ text, m }: { text: string; m: FeynmanMeta }) {
  const t = useT()
  const sib = m.siblings ?? []
  if (sib.length < 2) return null
  const rounds = findRounds(text)
  const last = (topic: string) => rounds.filter((x) => x.meta.topic === topic && x.meta.verdict).at(-1)?.meta.verdict
  const at = sib.indexOf(m.topic)
  return (
    <div className="fy-sec" data-testid="fy-progress">
      <span className="secp">
        {sib.map((s) => {
          const v = s === m.topic && !m.verdict ? 'cur' : (s === m.topic ? m.verdict : last(s))
          return <i key={s} className={v === 'pass' ? 'ok' : v === 'almost' ? 'near' : v === 'fail' ? 'bad' : v === 'cur' ? 'cur' : ''} title={s} />
        })}
      </span>
      {at >= 0 ? t('这一节第{i}个 · 共{n}个', { i: at + 1, n: sib.length }) : t('这一节共{n}个', { n: sib.length })}
    </div>
  )
}

/** 这次要讲到：讲之前能改（移到了解即可 / 移到核心 / × / 加一条），「开始讲」后收成几行名字 */
function Plan({ r, path, readOnly, onSay }: { r: RoundSection; path: string; readOnly: boolean; onSay(t: string): void }) {
  const t = useT()
  const m = r.meta
  const draft = m.status === 'draft' && !readOnly
  const [liteOpen, setLiteOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const cores = m.points.filter((x) => x.kind === 'core')
  const lites = m.points.filter((x) => x.kind === 'extra')
  const judged = !!m.states
  const row = (pt: (typeof m.points)[number]) => {
    const st = judged ? m.states?.find((s) => s.id === pt.id)?.state : undefined
    const cir = pt.kind === 'core' && !draft ? (st ? DOT_CLS[STATE_CLS[st]] : m.touched?.includes(pt.id) ? 'touched' : '') : ''
    return (
      <div key={pt.id} className="pt" data-testid="fy-point" data-k={pt.id} data-kind={pt.kind}>
        <i className={'cir ' + cir} />
        <span className="tx">{pt.text}</span>
        {draft && (
          <>
            <span className="ev">{pt.basis}</span>
            <button
              type="button"
              className="sw"
              onClick={() => {
                const to = pt.kind === 'core' ? 'extra' : 'core'
                if (to === 'core' && cores.length + 1 > CORE_MAX) onSay(t('核心超过{n}条：拆成两个点讲？', { n: CORE_MAX }))
                S.movePoint(path, m.id, pt.id, to)
              }}
            >
              {pt.kind === 'core' ? t('移到了解即可') : t('移到核心')}
            </button>
            <button type="button" className="x" aria-label={t('这次不讲这一条')} data-tip={t('这次不讲这一条')} onClick={() => S.dropPoint(path, m.id, pt.id)}>
              <Codicon name="close" size={12} />
            </button>
          </>
        )}
      </div>
    )
  }
  return (
    <div className={'fy-plan' + (draft ? '' : ' done') + (liteOpen ? ' lopen' : '')} data-testid="fy-plan">
      <div className="h">
        <ByLogo by={m.by ?? ''} />
        <b>{t('这次要讲到')}</b>
        <span>{draft ? t('核心{n}条，讲清就过', { n: cores.length }) : t('核心{n}条 · 了解即可{k}条', { n: cores.length, k: lites.length })}</span>
      </div>
      <div className="rows core">{cores.map(row)}</div>
      {draft && cores.length > CORE_MAX && (
        <div className="fy-split" data-testid="fy-split">
          <Codicon name="lightbulb" size={13} />
          {t('核心超过{n}条：拆成两个点讲？', { n: CORE_MAX })}
        </div>
      )}
      {draft && lites.length > 0 && (
        <>
          <button type="button" className="lhd" data-testid="fy-lite" onClick={() => setLiteOpen((v) => !v)}>
            <Codicon name="chevron-right" size={12} />
            <b>{t('了解即可 {n}条', { n: lites.length })}</b>
            {t('讲不到不影响过')}
          </button>
          <div className="rows lite">{lites.map(row)}</div>
        </>
      )}
      {draft && (
        <div className="pf">
          {adding ? (
            <input
              className="fy-add"
              autoFocus
              aria-label={t('加一条要讲的事')}
              placeholder={t('写一句要讲的事（不写答案），回车放进核心')}
              onKeyDown={(e) => {
                if (composing(e)) return
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim()
                  if (v) S.addPoint(path, m.id, v)
                  setAdding(false)
                }
                if (e.key === 'Escape') (e.stopPropagation(), setAdding(false))
              }}
              onBlur={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="fy-btn ghost" data-testid="fy-addp" onClick={() => setAdding(true)}>
              <Codicon name="add" size={14} />
              {t('加一条')}
            </button>
          )}
          <span className="sp" />
          <button type="button" className="fy-btn solid" data-testid="fy-begin" disabled={!cores.length} onClick={() => S.begin(path, m.id)}>
            {t('开始讲')}
          </button>
        </div>
      )}
    </div>
  )
}

/** AI 块头：引擎标志、谁在说、模型 */
function AiHead({ who, by, n, icon }: { who: string; by?: string; n?: number; icon?: 'lightbulb' }) {
  return (
    <div className="h">
      <ByLogo by={by ?? ''} />
      {icon && <Codicon name={icon} size={13} className="ic" />}
      {n ? <span className="n num">{n}</span> : null}
      <b>{who}</b>
      {by && <span>{by}</span>}
    </div>
  )
}

/** 开讲前学生先开口（不进文件：每一轮都一样的一句） */
function Opener({ m }: { m: FeynmanMeta }) {
  const t = useT()
  return (
    <div className="fy-ai ask" data-part="学生开口">
      <AiHead who={t('学生')} by={m.by} />
      <div className="q">{t('我没学过{topic}。你用自己的话给我讲讲：它是什么，拿来干嘛？', { topic: m.topic })}</div>
    </div>
  )
}

function Entries({ r, live, path, fromMap, readOnly, onSay }: { r: RoundSection; live: S.Live | undefined; path: string; fromMap: boolean; readOnly: boolean; onSay(t: string, undo?: () => void): void }) {
  const t = useT()
  const m = r.meta
  let meCount = 0
  /** 学生引的那一句：只标最近一段里有它的那一段 */
  const hl = live?.hl ?? null
  const hlAt = hl ? r.entries.findLastIndex((e) => e.kind === 'me' && e.text.includes(hl)) : -1
  let n = 0
  /** 学生说过的每一句和注释里的 asked 一一对上：一轮只在头一次问一条核心时标号 */
  let ai = 0
  const seen = new Set<string>()
  let afterVerdict = false
  let redoShown = false
  const out: React.ReactNode[] = []
  r.entries.forEach((e, i) => {
    const fresh = live?.fresh === i
    if (e.kind === 'me') {
      meCount++
      if (afterVerdict && !redoShown) {
        redoShown = true
        out.push(
          <div key={'rd' + i} className="fy-round">
            {t('第2轮 · 只讲这几处')}
          </div>,
        )
      }
      out.push(<Mine key={i} e={e} first={meCount === 1} again={afterVerdict} hl={i === hlAt ? hl : null} />)
      return
    }
    if (e.kind === 'student' || e.kind === 'confirm') {
      const { quote, rest } = splitQuote(e.text)
      const a = afterVerdict ? undefined : m.asked[ai++]
      const fresh1 = !!a && (a.act === 'ask' || a.act === 'redirect') && !seen.has(a.point ?? String(ai))
      if (fresh1) (seen.add(a!.point ?? String(ai)), n++)
      out.push(
        <div key={i} className="fy-ai ask" data-part={a?.act === 'redirect' ? '先讲核心' : '学生追问'} data-testid="fy-student">
          <AiHead who={t('学生')} by={e.by} n={fresh1 ? n : undefined} />
          {quote !== null && <div className="quote">{t('你说「{q}」', { q: quote })}</div>}
          <div className="q">
            <Grow text={rest} on={fresh} id={m.id} />
          </div>
        </div>,
      )
      return
    }
    if (e.kind === 'reveal') {
      if (!afterVerdict) ai++
      const lines = e.text.split('\n')
      const src = lines.at(-1)?.match(/^(?:出处：|Source: )(.+)$/) ?? e.text.match(/(?:出处：|Source: )([^\n]+?)。?$/)
      const main = src ? e.text.slice(0, e.text.lastIndexOf(src[0])).replace(/[。\s]+$/, '。') : e.text
      out.push(
        <div key={i} className="fy-ai reveal" data-part="说穿" data-testid="fy-reveal">
          <AiHead who={t('说穿了')} by={e.by} icon="lightbulb" />
          <div className="q">
            <Grow text={main} on={fresh} id={m.id} />
          </div>
          {src && <div className="src">{t('出处：{src}', { src: src[1]! })}</div>}
        </div>,
      )
      return
    }
    if (e.kind === 'verdict') {
      afterVerdict = true
      if (m.states) out.push(<Verdict key={i} m={m} />)
      return
    }
    if (e.kind === 'gaps') {
      if (m.gaps) out.push(<Gaps key={i} r={r} path={path} fromMap={fromMap} readOnly={readOnly} wording={r.entries.find((x) => x.kind === 'wording')?.text ?? ''} redoing={!!live?.redo} onSay={onSay} />)
      return
    }
    if (e.kind === 'wording') return
    if (e.kind === 'full') {
      out.push(
        <div key={i} className="fy-ai full" data-part="完整版" data-testid="fy-full">
          <AiHead who={t('完整版')} by={e.by} />
          <div className="q">{e.text}</div>
        </div>,
      )
    }
  })
  // 刚点「再讲这几处」、还没讲：分隔线先出来
  if (live?.redo && !redoShown)
    out.push(
      <div key="rd" className="fy-round">
        {t('第2轮 · 只讲这几处')}
      </div>,
    )
  return <>{out}</>
}

/** 学生那一句头一行「你说「…」」拿出来单独画 */
function splitQuote(text: string): { quote: string | null; rest: string } {
  const m = /^(?:你说「([^」\n]*)」|You said “([^”\n]*)”)[。.，,]?\s*/.exec(text)
  return m ? { quote: (m[1] ?? m[2])!, rest: text.slice(m[0].length) } : { quote: null, rest: text }
}

/** 你讲的（第一段带框，答的缩进一格）；被学生引了的那一句标出来 */
function Mine({ e, first, again, hl }: { e: Entry; first: boolean; again: boolean; hl: string | null }) {
  const t = useT()
  const sents = e.text.split(/(?<=[。；！？!?;])/)
  return (
    <div className={'fy-mine' + (first || again ? '' : ' reply')} data-part="我讲的" data-testid="fy-mine">
      <div className="l">{again ? t('我讲的 · 第2轮') : first ? t('我讲的') : t('我答')}</div>
      {sents.map((s, k) => (
        <span key={k} className={'s' + (hl && s.includes(hl) ? ' fy-hl' : '')}>
          {s}
        </span>
      ))}
    </div>
  )
}

/** AI 写的一点点长出来（偏好「AI 写进文档要一点点长出来」：每 60 毫秒 2 个字，长的加速；减少动态时一下全出） */
function Grow({ text, on, id }: { text: string; on: boolean; id: string }) {
  const [shown, setShown] = useState(on && !still() ? 0 : text.length)
  useEffect(() => {
    if (!on || still()) {
      setShown(text.length)
      return
    }
    setShown(0)
    const step = growStep(text.length)
    let k = 0
    const tm = setInterval(() => {
      k += step
      setShown(Math.min(k, text.length))
      if (k >= text.length) {
        clearInterval(tm)
        S.grown(id)
      }
    }, GROW_TICK)
    return () => clearInterval(tm)
  }, [on, text])
  return (
    <>
      {text.slice(0, shown)}
      {shown < text.length && <span className="fy-caret" />}
    </>
  )
}

/** 回答框：打字、拍一张手画的图、填示例、讲完了（⌘↵）；左下给麦克风留着位置（④ 语音线） */
function Answer({ path, id, live, first, demo, terms }: { path: string; id: string; live: S.Live; first: boolean; demo?: string; terms: string[] }) {
  const t = useT()
  const [v, setV] = useState('')
  // 回答框左下的麦克风（④ 语音线，Soniox 实时听写，边说边出字）：terms 给这一轮的知识点名和要点，听写才认得出「范数」
  const ta = useRef<HTMLTextAreaElement>(null)
  const d = useDictation({ inputRef: ta, value: v, onChange: setV, terms })
  const [img, setImg] = useState<{ name: string; mime: string; base64: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const kind = live.input!
  const reply = kind === 'reply'
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [v])
  useEffect(() => {
    ta.current?.focus({ preventScroll: true })
  }, [kind])
  // 「讲完了」：正在听写就先停下、等最后的字定稿再交
  const go = async () => {
    const s = (d.active ? await d.finish() : v).trim()
    if (!s) return
    setV('')
    setImg(null)
    void S.send(path, id, s, img ? { mime: img.mime, base64: img.base64 } : undefined)
  }
  const ph = kind === 'redo' ? t('只讲上面这几处。点麦克风说，或者直接打字。') : first ? t('用自己的话讲，像讲给没学过的同学听。点麦克风说，或者直接打字。') : t('回答它… 点麦克风说也行')
  return (
    <div className={'fy-inp' + (reply ? ' small reply' : '') + (d.active ? ' dict-rec' : '')} data-part="回答框" data-testid="fy-answer">
      <DictationBar d={d} />
      <textarea
        ref={ta}
        value={v}
        placeholder={ph}
        aria-label={ph}
        rows={reply ? 2 : 3}
        onChange={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composing(e)) return
          if (isKey(e.nativeEvent, 'submit')) (e.preventDefault(), void go())
        }}
      />
      <DictationLive d={d} />
      <DictationNote d={d} />
      {img && (
        <div className="imgs">
          <span className="chip" data-testid="fy-img">
            <img src={`data:${img.mime};base64,${img.base64}`} alt="" />
            {img.name}
            <button type="button" aria-label={t('拿掉这张图')} onClick={() => setImg(null)}>
              <Codicon name="close" size={11} />
            </button>
          </span>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        data-testid="fy-photo-file"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (!f) return
          const rd = new FileReader()
          rd.onload = () => setImg({ name: f.name, mime: f.type, base64: String(rd.result).replace(/^data:[^,]*,/, '') })
          rd.readAsDataURL(f)
        }}
      />
      <div className="f">
        <DictationMic d={d} />
        <button
          type="button"
          className="ib"
          data-testid="fy-photo"
          data-tip={t('拍一张手画的图放进来（AI 看图）')}
          aria-label={t('拍一张手画的图放进来（AI 看图）')}
          onClick={() => file.current?.click()}
        >
          <Codicon name="device-camera" size={14} />
        </button>
        {demo && (
          <button type="button" className="fy-btn ghost demo" data-testid="fy-demo" onClick={() => (d.cancel(), setV(demo), ta.current?.focus())}>
            {t('填一段示例')}
          </button>
        )}
        <span className="sp" />
        <button type="button" className="fy-btn solid" data-testid="fy-send" disabled={!v.trim() && !d.active} onClick={() => void go()}>
          {reply ? t('回') : t('讲完了')}
          {keyFor('submit') && <kbd>{keyFor('submit')}</kbd>}
        </button>
      </div>
    </div>
  )
}

/** 判定：判定一行（现在怎样、差在哪、下一步）、每条核心的状态和原话、怎么判、看过材料那句 */
function Verdict({ m }: { m: FeynmanMeta }) {
  const t = useT()
  const v = m.verdict ?? 'fail'
  const w = splitVerdict(verdictLine(m))
  const cores = m.points.filter((x) => x.kind === 'core')
  const asks = roundNo(m)
  const STATE_WORD: Record<CoreState, string> = { clear: t('讲清'), asked: t('追问后补上'), fixed: t('说错后改对'), vague: t('含糊'), missing: t('没讲到'), wrong: t('讲错') }
  return (
    <div className={'fy-res ' + v} data-part="判定" data-testid="fy-verdict" data-verdict={v}>
      <div className="rt">
        <i />
        <b>{w.word}</b>
        {m.redone && <span className="fy-tag">{t('· 当场补讲')}</span>}
        <span className="sp" />
        <span className="m">{t('第{n}次 · 问了{k}轮', { n: m.nth, k: asks })}</span>
      </div>
      <div className="why">{w.why}</div>
      {w.next && (
        <div className="nx">
          {t('下一步：')}
          {w.next}
        </div>
      )}
      <div className="rows" data-part="每条核心的状态">
        {cores.map((c) => {
          const s = m.states?.find((x) => x.id === c.id)
          const st = s?.state ?? 'missing'
          const fixedNow = !!m.gaps?.some((g) => g.point === c.id && g.redone)
          return (
            <div key={c.id} className={'rrow st-' + (fixedNow ? 'good' : STATE_CLS[st])} data-k={c.id} data-state={fixedNow ? 'redone' : st}>
              <div className="l1">
                <i />
                <span className="nm">{c.text}</span>
                <span className="st">{fixedNow ? t('{was} · 当场补讲清了', { was: STATE_WORD[st] }) : STATE_WORD[st]}</span>
              </div>
              {s?.quote && <div className="qt">「{s.quote}」</div>}
            </div>
          )
        })}
      </div>
      <div className="rule" data-part="怎么判">
        {t('怎么判：有一条核心讲错就没过；没有讲错时，含糊和没讲到合起来 0条过、1条差一点、2条以上没过。追问后补上、说错后改对都算讲清；了解即可不算。')}
      </div>
      {m.peeks > 0 && <div className="rm">{t('讲的时候看过一眼材料：判定照常，下次再讲的日子提前。')}</div>}
    </div>
  )
}

/** ① 写的判定一行「没过：……。下一步：……。讲的时候看过材料N次：……」拆成三句画（看过材料那句另画在下面） */
function splitVerdict(line: string): { word: string; why: string; next: string } {
  const body = line.replace(/讲的时候看过材料\d+次：[^。]*。?$/, '')
  const i = body.indexOf('：')
  const head = i === -1 ? body : body.slice(0, i)
  const rest = i === -1 ? '' : body.slice(i + 1)
  const k = rest.indexOf('下一步：')
  return { word: head.replace(/ · 当场补讲$/, ''), why: (k === -1 ? rest : rest.slice(0, k)).trim(), next: k === -1 ? '' : rest.slice(k + 4).trim() }
}

/** 缺口（出卡勾选）、说法提醒、四个按钮 */
function Gaps({ r, path, fromMap, readOnly, wording, redoing, onSay }: { r: RoundSection; path: string; fromMap: boolean; readOnly: boolean; wording: string; redoing: boolean; onSay(t: string, undo?: () => void): void }) {
  const t = useT()
  const m = r.meta
  const gaps = m.gaps ?? []
  const KIND: Record<Gap['kind'], string> = { wrong: t('讲错'), vague: t('含糊'), missing: t('没讲到'), fixed: t('说错后改对'), asked: t('追问后补上'), clear: t('讲清'), extra: t('了解即可'), recap: t('过了也出一张') }
  const nameOf = (g: Gap) => (g.kind === 'recap' ? t('用两三句讲清{topic}', { topic: m.topic }) : (m.points.find((x) => x.id === g.point)?.text ?? ''))
  const core = gaps.filter((g) => g.kind === 'wrong' || g.kind === 'vague' || g.kind === 'missing')
  const lite = gaps.filter((g) => g.kind === 'extra').length
  const cards = gaps.filter((g) => g.card && !g.sent).length
  const ctx: A.AfterCtx = { path, round: r, say: onSay }
  const pass = m.verdict === 'pass'
  return (
    <div className="fy-gaps" data-part="缺口清单" data-testid="fy-gaps">
      <div className="h">
        <ByLogo by={m.by ?? ''} />
        <b>{core.length ? t('缺口 {n}处', { n: core.length }) : t('出卡')}</b>
        <span className="sp" />
        {lite > 0 && <span>{t('了解即可{n}条不算', { n: lite })}</span>}
      </div>
      {gaps.map((g, i) => (
        <div key={i} className={'g' + (g.kind === 'extra' ? ' lite' : '')} data-testid="fy-gap" data-kind={g.kind}>
          <div>
            <span className={'tg ' + (g.kind === 'wrong' ? 'bad' : g.kind === 'vague' ? 'vague' : 'miss')}>{KIND[g.kind]}</span>
            <span className="nm">{nameOf(g)}</span>
            {g.quote && <div className="you">{t('你说「{q}」', { q: g.quote })}</div>}
          </div>
          <div className="fix">{g.right}</div>
          {g.src && <div className="src">{t('出处：{src}', { src: g.src })}</div>}
          {g.sent ? (
            <div className="st">{t('✓ 已送进Anki')}</div>
          ) : g.redone ? (
            <div className="st">{t('✓ 当场补讲清了')}</div>
          ) : null}
          {!g.sent && (
            <label className={'ck' + (g.card ? ' on' : '')}>
              <input type="checkbox" checked={g.card} disabled={readOnly} onChange={() => S.toggleCard(path, m.id, i)} />
              <span className="sq">
                <Codicon name="check" size={11} />
              </span>
              {t('出卡')}
            </label>
          )}
        </div>
      ))}
      {wording && (
        <div className="fy-wd" data-part="说法提醒">
          <b>{t('说法提醒（不算错）')}</b>
          {wording
            .split('\n')
            .filter((l) => l.trim())
            .map((l, k) => (
              <div key={k}>{l.replace(/^[-*]\s+/, '')}</div>
            ))}
        </div>
      )}
      {!readOnly && (
        <div className="gacts">
          {core.length > 0 && !m.redone && (
            <button type="button" className="fy-btn ghost" data-testid="fy-redo" disabled={redoing} onClick={() => S.redo(path, m.id)}>
              {t('再讲这{n}处', { n: core.length })}
            </button>
          )}
          <span className="sp" />
          <button type="button" className="fy-btn" data-testid="fy-tomap" onClick={() => (fromMap ? A.toMap(ctx) : A.snapMap(ctx))}>
            <Codicon name="type-hierarchy" size={14} />
            {fromMap ? t('补进导图') : t('拍成导图')}
          </button>
          <button type="button" className="fy-btn solid" data-testid="fy-cards" disabled={!cards} onClick={() => A.makeCards(ctx)}>
            {cards ? t('出卡 · {n}张', { n: cards }) : t('出卡')}
          </button>
        </div>
      )}
      <div className="rv" data-part="记进笔记和进度">
        <Codicon name="file" size={14} />
        <span>{t('进度记在这一轮，课程首页排「下次先讲」')}</span>
        <span className="sp" />
        {!readOnly && (
          <button type="button" className="lnk" data-testid="fy-tonote" onClick={() => A.toNote(ctx)}>
            {t('记进笔记')}
          </button>
        )}
      </div>
    </div>
  )
}

/** 还没写进文档的一轮：在列要点、PDF 先挑一个知识点、出错 */
export function PendingColumn({ p, style }: { p: S.Pending; style?: React.CSSProperties }) {
  const t = useT()
  const el = useRef<HTMLElement>(null)
  useEffect(() => reveal(el.current), [!!p.pick])
  return (
    <section ref={el} className="fy-col think" data-testid="fy-pending" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {!p.pick && !p.error && <GlowRing mode="loop" className="fy-glow" />}
      <header className="fy-h">
        <div className="fy-t">
          <Codicon name="mortar-board" size={15} />
          <b>{t('费曼学习')}</b>
          <span className="sp" />
          <button type="button" className="fy-x" aria-label={t('不讲了')} data-tip={t('不讲了')} onClick={() => S.dropPending(p.key)}>
            <Codicon name="close" size={14} />
          </button>
        </div>
        <div className="fy-m">
          <ByEngine />
          <span className="dim">·</span>
          <span className="lb">{p.word}</span>
        </div>
      </header>
      <div className="fy-b">
        {p.error ? (
          <div className="fy-note err">{p.error}</div>
        ) : p.pick ? (
          <div className="fy-pick" data-testid="fy-pick">
            <div className="h">
              <b>{p.pick.why === 'pdf' ? t('这一讲的知识点') : p.pick.why === 'branch' ? t('「{name}」这一支分成几个点', { name: p.pick.title }) : t('核心超过5条，分成了几个点')}</b>
              <span>{t('挑一个先讲；一次讲一个点，3 到 5 分钟')}</span>
            </div>
            {p.pick.items.map((c: Candidate, i) => (
              <button key={c.name + i} type="button" className="pk" data-testid="fy-pick-item" onClick={() => void S.pickOne(p.key, c)}>
                <span className="tx">{c.name}</span>
                <span className="ev">{pickNote(c, t)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="fy-wait">
            <span className="breath" />
            {p.word}
          </div>
        )}
      </div>
    </section>
  )
}

/** 单子上一项后面的小字：第几页、估几条核心、上次讲的结果 */
function pickNote(c: Candidate, t: ReturnType<typeof useT>): string {
  const pdf = c.refs.find((r) => r.kind === 'pdf')
  const pages = pdf && pdf.kind === 'pdf' && pdf.pages ? (pdf.pages[0] === pdf.pages[1] ? t('第{n}页', { n: pdf.pages[0] }) : t('第{a}–{b}页', { a: pdf.pages[0], b: pdf.pages[1] })) : ''
  const last = c.last === 'pass' ? t('上次过') : c.last === 'almost' ? t('上次差一点') : c.last === 'fail' ? t('上次没过') : ''
  return [pages, c.cores ? t('核心{n}条', { n: c.cores }) : '', last].filter(Boolean).join(' · ')
}

/** 盖住的东西上浮的一颗「讲完再看 · 按住看一眼」：按住露出、松手又盖上，每按一次记一次 */
export function PeekChip({ id, style, testid = 'fy-peek' }: { id: string; style?: React.CSSProperties; testid?: string }) {
  const t = useT()
  return (
    <div className="fy-cover-chip" style={style} data-testid={testid} onMouseDown={(e) => e.stopPropagation()}>
      <Codicon name="eye-closed" size={14} />
      <b>{t('讲完再看')}</b>
      <HoldPeek id={id} />
    </div>
  )
}

/** 「按住看一眼」那颗：按下露出，松手、移出窗口、失焦都盖回去 */
export function HoldPeek({ id, className }: { id: string; className?: string }) {
  const t = useT()
  return (
    <button
      type="button"
      className={'fy-hold' + (className ? ' ' + className : '')}
      data-testid="fy-hold"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        S.peek(id, true)
        // 松手、按键被系统收走、窗口藏起来（切走、最小化）都盖回去。不跟窗口失焦走：别的窗口一冒出来（通知、另一个软件启动）
        // 就失焦，按着的手还没松，材料不该自己盖回去（按住的时候 pointer capture 还在，松手照样收得到）
        const off = () => {
          S.peek(id, false)
          window.removeEventListener('pointerup', off)
          window.removeEventListener('pointercancel', off)
          document.removeEventListener('visibilitychange', hidden)
        }
        const hidden = () => document.visibilityState === 'hidden' && off()
        window.addEventListener('pointerup', off)
        window.addEventListener('pointercancel', off)
        document.addEventListener('visibilitychange', hidden)
      }}
    >
      <Codicon name="eye" size={14} />
      {t('按住看一眼')}
    </button>
  )
}

/** 这块白板上正在讲（盖着）的那一轮：给白板用 */
export function useCovered(path: string, text: string): S.Covered | null {
  S.useFeynman()
  return S.coveredIn(path, text)
}

