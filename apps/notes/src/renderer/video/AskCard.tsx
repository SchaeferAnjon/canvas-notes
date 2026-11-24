/**
 * 框一块问的问框（task-sta8n 方向 A，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a 的 .ask；和旁支 A「就地展开」同一套：
 * 圆角 12、--pop 底、--shadow-up，回答左边 2px 强调色竖线）。放在视频下沿下面 10，尖角对着框的中间，不盖视频；宽 380（网页栏窄时栏宽减 24）。
 * 头：框住那块的小图 96 × 54（左下角时间小牌）、「问框住的这一块」、「00:06 这一帧 ·」和默认勾上的「带上前后字幕」，右边「重框」「×」；
 * 建议四颗（两颗固定、两颗小活现想）；多行输入（最多 4 行再滚），底下谁来答 · 模型 · effort（ai-picker.tsx，看不了图的灰着写「看不了图」）、发送；
 * 最底下「记进《…》▾」能换（这个视频记住）、「esc 关掉」。问出去回答就在问框里长出来，下面是回答下面那排（task-eavzx）：
 * 拷贝 · 插进文档 · ⋯（到 AI 对话里接着聊、存进收件箱、拷贝为 Markdown）｜ 快捷回复（默认还是不懂 · 换个方式讲）；
 * 「接着问」去掉了（问框下面就是输入框）。没答出来是 再问一次 · 换个问法 · 换一家 那排。
 * 回答那块（.ak-an，data-side-host="video-ask"）留给旁支（task-4edsc）：选一句岔开问挂在那一段下面；开着旁支时旁支的输入框和「记到哪」
 * 钉在问框底部（主输入框那一行让给它，收起旁支再回来；task-5yp97 选法 2）。
 */
import { Codicon } from '@cn/design'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EngineInfo } from '../../shared/agent'
import { fitPick, pickLabel, resolvePick } from '@cn/ai-engines/shared'
import { titleOf as titleOfPath } from '../../shared/layout'
import { fmtTime } from '../../shared/video'
import { AiPicker, engineFamily, type Family } from '@cn/ai-chat/ai-picker'
import { AiIcon } from '../engine-logo'
import { composing } from '../ime'
import { useKeys } from '../keys'
import { Markdown } from '../md-render'
import { closeFileSide, SideText, type Spot, useFileSideHost, useFileText } from '../side/file-side'
import { onPageOutside } from '../web/page-outside'
import { askDestNow, setDestPick, useDestPick } from './actions'
import { askCardQuestion, type AskCardState, findAskBlock, chatInAiTab, closeAskCard, dropFailedTurn, goToSaved, setAskCtx, startAsk, stopAskCard, useAskCard, type VisionPick } from './ask-card'
import { AnswerRow } from '../answer-row'
import { AiError } from '@cn/ai-chat/ai-error'
import { t as tNow } from '../../shared/i18n'
import { useTick, videoHost, videoStateOf } from './store'
import { useNoteSwitch } from '../ai-note-switch'
import { DestPickMenu } from './VideoStrip'
import { hideToolMarkup } from '../../shared/tool-markup'
import './ask-card.css'
import { ipcOn } from '../crash/ipc'

/** 两颗固定的建议（另两颗小活看那一帧和字幕现想，排在它俩中间，同原型） */
const FIXED = ['讲解这一块', '换个说法讲'] as const

const PICK_KEY = 'cn.videoAskPick'

/** 问框底下选的模型、effort：记在本机；没选过用设置 › AI「看图问」那一行（看图问只有 Claude Code） */
function useVisionPick(): { engines: EngineInfo[]; pick: VisionPick | null; set(p: VisionPick): void } {
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [base, setBase] = useState<VisionPick | null>(null)
  const [own, setOwn] = useState<VisionPick | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null') as VisionPick | null
      return v && typeof v.model === 'string' ? v : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    let live = true
    const load = () =>
      void window.cn.aiPrefs().then((v) => {
        if (!live) return
        setEngines(v.engines)
        const p = resolvePick(v.prefs, 'vision')
        setBase({ model: p.model ?? '', ...(p.effort ? { effort: p.effort } : {}) })
      })
    load()
    const off = ipcOn(window.cn.onAiPrefsChanged, 'cn.onAiPrefsChanged')(load)
    return () => {
      live = false
      off()
    }
  }, [])
  const want = own ?? base
  const models = engines.find((e) => e.id === 'claude')?.models ?? []
  const fit = want ? fitPick('claude', models, want) : null
  const pick = fit ? { model: fit.model ?? '', ...(fit.effort ? { effort: fit.effort } : {}) } : null
  return {
    engines,
    pick,
    set(p) {
      setOwn(p)
      try {
        localStorage.setItem(PICK_KEY, JSON.stringify(p))
      } catch {
        // 存不下只是下次不记得
      }
    },
  }
}

export function AskCard({ wcId, pageUrl }: { wcId: number; pageUrl: string }) {
  const c = useAskCard()
  if (!c || c.wcId !== wcId) return null
  return <Card key={c.seq} c={c} pageUrl={pageUrl} />
}

function Card({ c, pageUrl }: { c: AskCardState; pageUrl: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [destOpen, setDestOpen] = useState(false)
  const vision = useVisionPick()
  /** 写在问框里的键照命令表（esc、回车、换行这类固定的也从那里取） */
  const K = useKeys()
  const st = videoStateOf(c.wcId)
  const dpick = useDestPick(c.key)
  const pos = usePlace(ref, c)
  const answered = c.turns.length > 0
  const asking = c.turns.some((t) => t.state === 'wait')
  const time = fmtTime(c.t ?? 0)

  // 打开时光标进输入框（打字就是问这一块）：摆好位置（看得见）的那一下就给，问框一露出来就能打字、回车
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (!pos || focused.current) return
    focused.current = true
    input.current?.focus({ preventScroll: true })
  }, [pos])
  // 回答长出来时跟着往下走，这一问（问的那句）顶到上沿就停住：长回答从头读得到；答的时候自己滚过就不再跟，下一问再跟
  const follow = useRef({ n: -1, off: false, set: 0 })
  useLayoutEffect(() => {
    const b = body.current
    const last = b?.lastElementChild
    if (!b || !last) return
    const f = follow.current
    if (f.n !== c.turns.length) Object.assign(f, { n: c.turns.length, off: false })
    if (f.off) return
    b.scrollTop = last.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 4
    f.set = b.scrollTop
  }, [c.turns])
  // 焦点在网页里（问出去以后焦点回到了视频）按 esc：在答就停下，答完关掉
  useEffect(() => onPageOutside((what) => what === 'esc' && (asking ? stopAskCard() : closeAskCard())), [asking])

  const ask = (text: string) => {
    if (!vision.pick || asking) return
    setQ('')
    input.current?.blur()
    void askCardQuestion(text, vision.pick, pageUrl)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || composing(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (destOpen) return setDestOpen(false)
    if (asking) stopAskCard()
    else closeAskCard()
  }

  const families: Family[] = vision.engines.map((e) => (e.id === 'claude' ? { ...engineFamily(e), note: '能看图' } : { ...engineFamily(e), note: '看不了图', off: true, title: '看图问只有 Claude Code 能看图' }))
  const by = vision.pick ? pickLabel({ engine: 'claude', model: vision.pick.model, ...(vision.pick.effort ? { effort: vision.pick.effort } : {}) }) : ''
  const sugg = c.sugg.length ? [FIXED[0], ...c.sugg, FIXED[1]] : [...FIXED]
  // 写进「记到哪」那篇本身（2026-11-24 偏好「剪藏和AI笔记同一篇」）；视频的「记笔记」关着就不记
  const sw = useNoteSwitch('video')
  const dest = st && sw.main ? askDestNow(st) : null
  const saved = c.saved
  const destName = !dest ? tNow('只问不记') : titleOfPath(dest.path)
  const last = c.turns.length - 1
  // 开着的旁支是不是这个问框里的（看全软件那一份，不靠各问回报）
  const sideOpen = (useFileSideHost() ?? '').startsWith(`ask:${c.seq}:`)
  const sideText = useFileText(c.saved && c.saved !== 'none' ? c.saved.path : null)
  // 收起旁支回到问框（×、esc、引用、换个问法）：输入框回来了就把光标放进去（以前靠「接着问」，task-eavzx 拿掉了）
  const wasSide = useRef(sideOpen)
  useLayoutEffect(() => {
    const was = wasSide.current
    wasSide.current = sideOpen
    if (sideOpen || !was) return
    input.current?.focus()
  }, [sideOpen])
  const wake = () => closeFileSide()
  /** 开着旁支时钉旁支输入框的那一格（问框底部） */
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  /** 旁支小框「引用」：那句进问框的输入框 */
  const quoteIn = (quote: string) => {
    setQ((x) => `「${quote}」${x}`)
    if (sideOpen) wake()
    else requestAnimationFrame(() => input.current?.focus())
  }

  return (
    <div
      ref={ref}
      className={'ak' + (answered ? ' answered' : '') + (pos?.up ? ' up' : '')}
      role="dialog"
      aria-label="问 AI"
      data-part="框一块问的问框"
      style={(pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, ['--ax' as string]: `${pos.ax}px` } : { visibility: 'hidden' }) as CSSProperties}
      onKeyDown={onKey}
    >
      <div className="ak-head">
        <div className="ak-thumb">
          {c.thumb && <img src={c.thumb} alt="框住的那块" draggable={false} />}
          <b>{time}</b>
        </div>
        <div className="ak-ht">
          <div className="ak-t truncate">{answered ? `你问：${c.turns[0]!.q}` : '问框住的这一块'}</div>
          <div className="ak-s">
            <span>{`${time} 这一帧 ·`}</span>
            <button type="button" role="checkbox" aria-checked={c.ctx} aria-label="带上前后字幕" className={'ak-ctx' + (c.ctx ? ' on' : '')} title="把这一帧前后 30 秒的字幕一起给 AI" onMouseDown={(e) => e.preventDefault()} onClick={() => setAskCtx(!c.ctx)}>
              <span className="bx">{c.ctx && <Codicon name="check" size={10} />}</span>
              带上前后字幕
            </button>
          </div>
        </div>
        <div className="ak-x">
          <button type="button" className="ak-ib" aria-label="重框" data-tip="重框" data-side="below" onClick={() => startAsk(c.wcId)}>
            <Codicon name="screen-full" size={14} />
          </button>
          <button type="button" className="ak-ib" aria-label="关掉" data-tip="关掉" data-key={K('escape') ?? undefined} data-side="below" onClick={closeAskCard}>
            <Codicon name="close" size={14} />
          </button>
        </div>
      </div>
      {c.error && <div className="ak-err">{c.error}</div>}
      {answered && (
        <div
          className="ak-body"
          ref={body}
          role="log"
          aria-label="回答"
          onScroll={(e) => {
            if (Math.abs(e.currentTarget.scrollTop - follow.current.set) > 2) follow.current.off = true
          }}
        >
          {c.turns.map((t, i) => (
            <div key={i} className="ak-turn">
              <div className="ak-q">
                <span>{t.q}</span>
              </div>
              <div className="ak-an" data-side-host="video-ask" data-turn={i}>
                <div className="ak-meta" data-testid="ak-meta">
                  <Codicon name="check" size={12} />
                  <span className="truncate">{`看了 ${time} 这一帧 · ${t.by || by}`}</span>
                </div>
                {t.state === 'wait' && !t.a && (
                  <div className="ak-wait" data-testid="ak-wait">
                    <i className="ak-breath" />
                    <span>{`AI 正在看 ${time} 这一帧…`}</span>
                    <button type="button" className="ak-stop" onMouseDown={(e) => e.preventDefault()} onClick={stopAskCard}>
                      停下 <kbd>{K('escape')}</kbd>
                    </button>
                  </div>
                )}
                {t.a &&
                  (t.state === 'done' ? (
                    // 答好的回答里选一句能开旁支（task-p90ra）：就地长在这一段下面，问答写进那篇讲解块下面的 `> [!side]`
                    <SideText spot={turnSpot(c, i, sideText, pageUrl, quoteIn, sideOpen ? dock : null)} md={hideToolMarkup(t.a)} className="ak-tx" testid="ak-answer" />
                  ) : (
                    <div className="ak-tx md" data-testid="ak-answer">
                      <Markdown text={hideToolMarkup(t.a)} cites={{ conv: `video:${pageUrl}` }} />
                    </div>
                  ))}
                {t.state === 'error' && (
                  <div className="ak-aierr">
                    <AiError
                      raw={t.error ?? ''}
                      engine={{ id: 'claude', label: 'Claude Code' }}
                      {...(i === last && !asking
                        ? {
                            onRetry: () => {
                              dropFailedTurn()
                              ask(t.q)
                            },
                            onRephrase: () => {
                              setQ(t.q)
                              if (sideOpen) wake()
                              else requestAnimationFrame(() => input.current?.focus())
                            },
                          }
                        : {})}
                    />
                  </div>
                )}
                {t.state === 'done' && i === last && (
                  <AnswerRow
                    md={hideToolMarkup(t.a)}
                    {...(t.by || by ? { by: t.by || by } : {})}
                    last
                    keepLabels
                    host={{ place: 'video', busy: asking, send: ask, vars: () => ({ question: t.q }) }}
                    menu={[{ id: 'to-chat', icon: <AiIcon job="chat" size={14} />, label: tNow('到 AI 对话里接着聊'), tip: tNow('这几问几答带去右栏 AI 对话，AI 看得到这一帧'), onClick: () => void chatInAiTab(pageUrl) }]}
                    testId="ak-ans-acts"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!answered && (
        <div className="ak-sug" data-testid="ak-sug">
          {sugg.map((s) => (
            <button key={s} type="button" className="ak-sg" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {sideOpen ? (
        // 开着旁支：旁支的输入框和「记到哪」那一行钉在这里（主输入框那一行让给它，收起旁支再回来；task-5yp97 选法 2）。
        // 旁支多长、回答区滚到哪都看得见输入框，问框也不往上长、不挡视频；上面一条细线和滚着的问答分开
        <div className="ak-dock side-dock" ref={setDock} data-testid="ak-side-dock" />
      ) : (
      <div className="ak-in" data-testid="ak-in">
        <textarea
          ref={input}
          rows={1}
          aria-label="想问什么"
          placeholder={answered ? '接着问这一块…' : `问这一块…（空着 ${K('enter')} 就是「讲解这一块」）`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (composing(e) || e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            ask(q)
          }}
        />
        <div className={'ak-row' + (answered ? ' answered' : '')}>
          {vision.pick && (
            <AiPicker
              look="bar"
              ids={{ family: 'ai-engine', model: 'ai-model', effort: 'ai-effort' }}
              familyMenu="AI 引擎"
              familyHead="谁来看这一帧"
              families={families}
              value={{ family: 'claude', model: vision.pick.model, ...(vision.pick.effort ? { effort: vision.pick.effort } : {}) }}
              unsetEffort={null}
              effortFoot="只管看图问；默认在设置 › AI「看图问」那一行。"
              hideFamily={answered}
              onFamily={() => undefined}
              onModel={(id) => vision.set({ model: id, ...(vision.pick?.effort ? { effort: vision.pick.effort } : {}) })}
              onEffort={(id) => vision.set({ model: vision.pick!.model, ...(id ? { effort: id } : {}) })}
            />
          )}
          {/* 放得下才出（放不下整句折到第二行被藏起来），选 AI 那几颗不让它挤 */}
          <span className="ak-hintbox">
            <span className="ak-hint">{`${K('enter')} 问 · ${K('newline')} 换行`}</span>
          </span>
          <button type="button" className={'ak-send' + (asking ? ' off' : '')} aria-label="问" title="问" disabled={asking} onClick={() => ask(q)}>
            <Codicon name="arrow-up" size={14} />
          </button>
        </div>
      </div>
      )}
      <div className="ak-foot">
        {saved && saved !== 'none' ? (
          <button type="button" className="ak-dst saved" onClick={goToSaved}>
            <Codicon name="check" size={12} />
            <span className="truncate">{`已记进《${saved.dest.title}》`}</span>
            <Codicon name="chevron-right" size={10} />
          </button>
        ) : saved === 'none' ? (
          <span className="ak-dst">
            <Codicon name="note" size={13} />
            <span className="truncate">没记进笔记（只问不记）</span>
          </span>
        ) : (
          <button type="button" className="ak-dst" aria-haspopup="menu" aria-expanded={destOpen} disabled={answered} onClick={() => setDestOpen((o) => !o)}>
            <Codicon name="note" size={13} />
            <span className="truncate">{dest ? `记进《${destName}》` : sw.main ? '只问不记' : tNow('只问不记 · 记笔记关着')}</span>
            <Codicon name="chevron-down" size={10} />
          </button>
        )}
        <span className="ak-esc">{`${K('escape')} 关掉`}</span>
        {destOpen && st && <DestPickMenu st={st} pick={dpick} up onPick={(p) => (setDestPick(c.key, p), setDestOpen(false))} onClose={() => setDestOpen(false)} />}
      </div>
    </div>
  )
}

/**
 * 问框里第 i 问的回答上挂旁支的那一处（task-p90ra）：问答写进记进的那一篇、这一问那块讲解（[!ai]）下面；
 * 「只问不记」的只留在问框里；第一问还在写进文档时先不让开
 */
function turnSpot(c: AskCardState, i: number, text: string, pageUrl: string, onQuote: (q: string) => void, dock: HTMLElement | null): Spot {
  const t = c.turns[i]!
  const saved = c.saved && c.saved !== 'none' ? c.saved : null
  const title = saved ? (saved.dest.kind === 'inbox' ? titleOfPath(saved.path) : saved.dest.title) : c.title
  const time = fmtTime(c.t ?? 0)
  return {
    host: `ask:${c.seq}:${i}`,
    path: saved?.path ?? null,
    title,
    text,
    find: (x) => findAskBlock(x, t.id),
    where: `看视频《${c.title}》${time} 这一帧时问框里 AI 的回答`,
    lead: `他当时问的：${t.q}`,
    body: t.a,
    record: saved ? { icon: 'file', text: `写在《${title}》里，挂在这段回答下面` } : { icon: 'comment-discussion', text: '只在这个问框里，没记进笔记' },
    onQuote,
    place: saved ? `file:${saved.path}` : `web:${pageUrl}`,
    readOnly: c.saved === null,
    dock,
    replies: 'video',
  }
}

/**
 * 问框摆在哪：视频下沿下面 10、尖角对着框的中间，左右离网页栏边至少 12；宽 380，网页栏窄时栏宽减 24。
 * 最高：视频下面剩下的地方（240 到 520）；不够 240 时让网页往上滚一点（框的上沿还看得见为止），问框跟着视频走
 */
function usePlace(ref: React.RefObject<HTMLDivElement | null>, c: AskCardState): { left: number; top: number; width: number; maxHeight: number; ax: number; up: boolean } | null {
  const tick = useTick(c.wcId)
  const rect = tick?.rect ?? c.rect
  const [size, setSize] = useState(0)
  const scrolled = useRef(false)
  const [pos, setPos] = useState<ReturnType<typeof usePlace>>(null)
  useEffect(() => {
    const panel = ref.current?.closest('.right.web')
    if (!panel) return
    const ro = new ResizeObserver(() => setSize((n) => n + 1))
    ro.observe(panel)
    return () => ro.disconnect()
  }, [ref])
  useLayoutEffect(() => {
    const panel = ref.current?.closest('.right.web')?.getBoundingClientRect()
    const wv = videoHost()?.webviewRect(c.wcId)
    if (!panel || !wv) return
    const W = panel.width
    const width = Math.min(380, W - 24)
    const cx = wv.left - panel.left + rect.x + (c.box.x + c.box.w / 2) * rect.w
    const left = Math.max(12, Math.min(cx - width / 2, W - width - 12))
    const top = wv.top - panel.top + rect.y + rect.h + 10
    const room = panel.height - top - 8
    // 视频下面不够放：网页往上滚一点（只滚一次，框的上沿留在网页里看得见）
    if (room < 240 && !scrolled.current) {
      scrolled.current = true
      const boxTop = rect.y + c.box.y * rect.h
      const by = Math.min(240 - room, Math.max(0, boxTop - 8))
      if (by > 4) videoHost()?.cmd(c.wcId, 'scrollBy', by)
    }
    setPos({ left, top, width, maxHeight: Math.max(240, Math.min(520, room)), ax: Math.max(14, Math.min(width - 26, cx - left - 6)), up: false })
  }, [rect.x, rect.y, rect.w, rect.h, size, c.box, c.wcId])
  return pos
}
