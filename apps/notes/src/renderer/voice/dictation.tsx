/**
 * 语音输入（费曼学习第 2 节，task-yvabi）：能放进任何输入框的麦克风 + Soniox 实时听写。
 *
 * 用法（外面的输入框是受控的 textarea 或 input）：
 *   const d = useDictation({ inputRef, value, onChange: setValue, terms: ['范数', '三角不等式'] })   // terms 可不给
 *   <div className={`我的框${d.active ? ' dict-rec' : ''}`}>      // 说的时候红边
 *     <DictationBar d={d} />                                     // 顶上「● 听写中 · Soniox ▮▮▮ 0:02 … 再点一下停」
 *     <textarea ref={inputRef} value={value} onChange={…} />
 *     <DictationLive d={d} />                                    // 说的时候顶替 textarea：定了的黑字、没定的灰字
 *     <DictationNote d={d} />                                    // 「听写好了：能直接改…」、没密钥、出错
 *     <div className="底栏"><DictationMic d={d} /> …</div>      // 麦克风：点一下开始再点停；按住超过半秒算按住说、松手停
 *   </div>
 *   发送前：const text = await d.finish()   // 正在听写就先停下、等最后的字定稿，返回框里最后的字
 *
 * 说的字接在开始时的光标处（先打几个字再说，接在后面）；说的时候 textarea 藏起来（style.display），
 * 停了放回来、字留在框里、光标在说的字末尾；外面要改框里的字（「填一段示例」）先 await d.finish() 或 d.cancel()。
 * 同一时间只有一个框在听写：另一个框开始时这个先停下。
 */
import { Codicon } from '@cn/design'
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BRAND } from '../../shared/brand'
import type { DictErrorCode, DictEvent } from '../../shared/voice-api'
import { useT } from '../i18n'
import { openSettingsAt } from '../settings/jump'
import { type Capture, MicError, startCapture } from './capture'
import './voice.css'

type Field = HTMLTextAreaElement | HTMLInputElement
export type DictPhase = 'idle' | 'starting' | 'rec' | 'stopping'
export type DictNote = null | { kind: 'done' } | { kind: 'error'; code: DictErrorCode; detail?: string }

export interface Dictation {
  phase: DictPhase
  /** 在听写（连着、说着、在收尾） */
  active: boolean
  /** 按住超过半秒：松手就停 */
  holding: boolean
  prefix: string
  sep: string
  final: string
  interim: string
  suffix: string
  /** 最近几段的音量（0 到 1），音量条用 */
  levels: number[]
  /** 开始说的时间（毫秒），用时用 */
  since: number
  note: DictNote
  liveStyle: CSSProperties | null
  toggle(): void
  press(): void
  release(): void
  /** 正在听写就先停下、等最后的字定稿；返回框里最后的字 */
  finish(): Promise<string>
  /** 不要了：马上停，已经出来的字留着 */
  cancel(): void
  dismiss(): void
}

/** 英文接英文中间补个空格；中文不补 */
const sepOf = (before: string, said: string) => (/[A-Za-z0-9,.;:!?]$/.test(before) && /^[A-Za-z0-9]/.test(said) ? ' ' : '')
/** 按住多久算「按住说」 */
const HOLD_MS = 500

/** 正在听写的那个框：别的框开始前先让它停下 */
let current: { finish(): Promise<string> } | null = null

export function useDictation(o: {
  inputRef: RefObject<Field | null>
  value: string
  onChange(v: string): void
  /** 这段话可能说到的词（知识点名、导图节点），Soniox 照它少听错同音字 */
  terms?: string[]
}): Dictation {
  const [, bump] = useState(0)
  const render = () => bump((n) => n + 1)
  const s = useRef({
    phase: 'idle' as DictPhase,
    id: 0,
    prefix: '',
    final: '',
    interim: '',
    suffix: '',
    levels: [0, 0, 0, 0, 0],
    since: 0,
    note: null as DictNote,
    holding: false,
    downAt: 0,
    holdTimer: 0 as ReturnType<typeof setTimeout> | 0,
    stopAsap: false,
    cap: null as Capture | null,
    liveStyle: null as CSSProperties | null,
    hiddenDisplay: '',
    /** 连上了、框已经换成说的样子（没密钥这种一下就回来的，不闪一下红边） */
    live: false,
    caret: null as null | { text: string; pos: number },
    ended: null as null | (() => void),
    stopping: null as Promise<string> | null,
    starting: null as Promise<void> | null,
  }).current
  /** 这个框在 current 里的样子（每次渲染的 api 都是新的，这个不变） */
  const handle = useRef({ finish: () => apiRef.current.finish() }).current
  const ext = useRef(o)
  ext.current = o

  const said = () => s.final + s.interim
  const joined = () => s.prefix + sepOf(s.prefix, said()) + said() + s.suffix
  const push = () => {
    ext.current.onChange(joined())
    render()
  }

  const showField = () => {
    const el = ext.current.inputRef.current
    if (s.live && el) el.style.display = s.hiddenDisplay
    s.live = false
  }

  /** 收尾：关麦克风，没定的字也留下，放回输入框、光标放在说的字末尾 */
  async function wrapUp(): Promise<string> {
    const cap = s.cap
    s.cap = null
    s.id = 0
    if (cap) await cap.stop()
    s.final += s.interim
    s.interim = ''
    const text = joined()
    const pos = (s.prefix + sepOf(s.prefix, s.final) + s.final).length
    if (!s.note && s.final.trim()) s.note = { kind: 'done' }
    s.phase = 'idle'
    s.holding = false
    s.downAt = 0
    s.stopping = null
    if (current === handle) current = null
    showField()
    s.caret = { text, pos }
    ext.current.onChange(text)
    render()
    return text
  }

  async function start() {
    if (s.phase !== 'idle') return
    if (current && current !== handle) await current.finish()
    current = handle
    const el = ext.current.inputRef.current
    const v = el?.value ?? ext.current.value
    const a = el?.selectionStart ?? v.length
    const b = el?.selectionEnd ?? v.length
    s.prefix = v.slice(0, a)
    s.suffix = v.slice(b)
    s.final = s.interim = ''
    s.levels = [0, 0, 0, 0, 0]
    s.note = null
    s.stopAsap = false
    s.phase = 'starting'
    s.since = Date.now()
    if (el) {
      // 说的时候顶替输入框的那一块：字号、行高、内边距（连边框宽）照输入框，高度不比它矮
      const cs = getComputedStyle(el)
      const pad = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => parseFloat(cs[`padding${side}`]) + parseFloat(cs[`border${side}Width`])
      s.liveStyle = { font: cs.font, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, padding: `${pad('Top')}px ${pad('Right')}px ${pad('Bottom')}px ${pad('Left')}px`, minHeight: el.offsetHeight }
    }
    render()
    const r = await window.cnVoice.start({ terms: ext.current.terms })
    if (!r.ok) {
      s.note = { kind: 'error', code: r.code, detail: r.detail }
      await wrapUp()
      return
    }
    // 等的时候框没了（cancel 收过尾了）
    if (s.phase !== 'starting') return void window.cnVoice.cancel(r.id)
    const field = ext.current.inputRef.current
    if (field) {
      s.hiddenDisplay = field.style.display
      field.style.display = 'none'
    }
    s.live = true
    s.id = r.id
    const id = r.id
    let cap: Capture
    try {
      cap = await startCapture((pcm, level) => {
        if (s.id !== id) return
        window.cnVoice.audio(id, pcm)
        s.levels = [...s.levels.slice(1), Math.min(1, Math.sqrt(level) * 2.5)]
        render()
      })
    } catch (e) {
      window.cnVoice.cancel(id)
      s.note = e instanceof MicError ? { kind: 'error', code: e.code, detail: e.message } : null
      await wrapUp()
      if (!(e instanceof MicError)) throw e
      return
    }
    // 连麦克风的这一会儿 Soniox 已经报错收尾了
    if (s.id !== id || s.phase !== 'starting') return void cap.stop()
    s.cap = cap
    s.phase = 'rec'
    s.since = Date.now()
    render()
    if (s.stopAsap) void stop()
  }

  function stop(): Promise<string> {
    if (s.phase === 'idle') return Promise.resolve(ext.current.inputRef.current?.value ?? ext.current.value)
    if (s.phase === 'starting') {
      // 还在连：连上麦克风马上停（start 最后看 stopAsap），等这一段收尾
      s.stopAsap = true
      return s.starting!.then(() => s.stopping ?? joined())
    }
    if (s.stopping) return s.stopping
    s.phase = 'stopping'
    render()
    const id = s.id
    s.stopping = (async () => {
      const cap = s.cap
      s.cap = null
      if (cap) await cap.stop()
      // 主进程等 Soniox 定稿（最多 8 秒），定下的字和 end / error 都从事件里来
      await new Promise<void>((r) => {
        s.ended = r
        void window.cnVoice.stop(id)
      })
      return wrapUp()
    })()
    return s.stopping
  }

  function onEvent(ev: DictEvent) {
    if (!s.id || ev.id !== s.id) return
    if (ev.kind === 'text') {
      s.final += ev.final
      s.interim = ev.interim
      push()
      return
    }
    if (ev.kind === 'error') s.note = { kind: 'error', code: ev.code, detail: ev.detail }
    if (s.phase === 'stopping') {
      s.ended?.()
      s.ended = null
    } else if (ev.kind === 'error') void wrapUp()
  }

  const apiRef = useRef<Dictation>(null as unknown as Dictation)
  const api: Dictation = {
    phase: s.phase,
    active: s.phase !== 'idle' && s.live,
    holding: s.holding,
    prefix: s.prefix,
    sep: sepOf(s.prefix, said()),
    final: s.final,
    interim: s.interim,
    suffix: s.suffix,
    levels: s.levels,
    since: s.since,
    note: s.note,
    liveStyle: s.liveStyle,
    toggle() {
      if (s.phase === 'idle') s.starting = start()
      else void stop()
    },
    press() {
      if (s.phase !== 'idle') {
        s.downAt = 0
        void stop()
        return
      }
      s.downAt = Date.now()
      s.holdTimer = setTimeout(() => {
        if (s.downAt && s.phase !== 'idle') (s.holding = true), render()
      }, HOLD_MS)
      s.starting = start()
    },
    release() {
      if (s.holdTimer) clearTimeout(s.holdTimer)
      const held = s.downAt && Date.now() - s.downAt >= HOLD_MS
      s.downAt = 0
      if (held) void stop()
    },
    finish: () => stop(),
    cancel() {
      if (s.phase === 'idle') return
      if (s.id) window.cnVoice.cancel(s.id)
      s.ended?.()
      s.ended = null
      void wrapUp()
    },
    dismiss() {
      s.note = null
      render()
    },
  }
  apiRef.current = api

  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  useEffect(() => window.cnVoice.onEvent((ev) => onEventRef.current(ev)), [])
  // 框没了（关掉、换题）：停下，不留着连
  useEffect(() => () => apiRef.current.cancel(), [])

  // 停了以后：字进到框里那一刻把光标放到说的字末尾
  useLayoutEffect(() => {
    const c = s.caret
    const el = o.inputRef.current
    if (!c || !el || el.value !== c.text) return
    s.caret = null
    el.focus()
    el.setSelectionRange(c.pos, c.pos)
  })

  // 「听写好了」、出错那一行：一动键盘就收起
  const noted = !!s.note
  useEffect(() => {
    const el = o.inputRef.current
    if (!noted || !el) return
    const off = () => {
      s.note = null
      render()
    }
    el.addEventListener('keydown', off)
    return () => el.removeEventListener('keydown', off)
  }, [noted, o.inputRef, s])

  return api
}

/** 麦克风按钮（回答框左下、相机左边） */
export function DictationMic({ d, className }: { d: Dictation; className?: string }) {
  const t = useT()
  return (
    <button
      type="button"
      className={`dict-mic${d.active ? ' on' : ''}${className ? ' ' + className : ''}`}
      aria-label={d.active ? t('停下听写') : t('语音输入')}
      aria-pressed={d.active}
      title={t('说：点一下开始、再点一下停；也能按住说、松手停（Soniox 听写）')}
      // 不抢输入框的焦点：开始时要读光标在哪
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        d.press()
      }}
      onPointerUp={() => d.release()}
      onPointerCancel={() => d.release()}
      // 键盘（回车、空格）点的：没有 pointer 事件
      onClick={(e) => {
        if (e.detail === 0) d.toggle()
      }}
    >
      <Codicon name={d.active ? 'mic-filled' : 'mic'} size={14} />
    </button>
  )
}

/** 说的时候框顶上那一行：红点、听写中 · Soniox、音量条、用时，右边「再点一下停」 */
export function DictationBar({ d }: { d: Dictation }) {
  const t = useT()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!d.active) return
    const iv = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(iv)
  }, [d.active])
  if (!d.active) return null
  const sec = Math.max(0, Math.floor((Date.now() - d.since) / 1000))
  return (
    <div className="dict-bar" role="status" data-testid="dict-bar">
      <i className="dict-dot" />
      <span>{t('听写中 · Soniox')}</span>
      <span className="dict-lv" aria-hidden="true">
        {d.levels.map((l, i) => (
          <i key={i} style={{ height: 3 + Math.round(11 * l) }} />
        ))}
      </span>
      <span className="dict-tm">{`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}</span>
      <span className="dict-sp" />
      <span className="dict-hint">{d.phase === 'stopping' ? t('收尾中…') : d.holding ? t('松手停') : t('再点一下停')}</span>
    </div>
  )
}

/** 说的时候顶替输入框：开始前框里的字照常，定了的字黑、没定的灰，光标跟在说的字后面 */
export function DictationLive({ d }: { d: Dictation }) {
  if (!d.active) return null
  return (
    <div className="dict-live" style={d.liveStyle ?? undefined} data-testid="dict-live">
      {d.prefix + d.sep}
      <span className="fin">{d.final}</span>
      <span className="int">{d.interim}</span>
      <i className="dict-caret" />
      {d.suffix}
    </div>
  )
}

/** 框下面那一行：听写好了、没填密钥、没麦克风权限、断线超时这些 */
export function DictationNote({ d }: { d: Dictation }) {
  const t = useT()
  const n = d.note
  if (!n || d.active) return null
  if (n.kind === 'done') return <div className="dict-note" data-testid="dict-note">{t('听写好了：能直接改，改好了再发')}</div>
  if (n.code === 'no-key')
    return (
      <div className="dict-note" data-testid="dict-note">
        <button type="button" className="dict-go" onClick={() => openSettingsAt('soniox')}>
          {t('先在设置里填 Soniox 密钥 →')}
        </button>
      </div>
    )
  const say: Record<Exclude<DictErrorCode, 'no-key'>, string> = {
    'mic-denied': t('没有麦克风权限，听不到你说话'),
    'no-mic': t('没找到麦克风：接上麦克风或耳机再点一次'),
    net: t('网络断了，听写停了；说过的字都在框里'),
    auth: t('Soniox 密钥不对或过期了，听写停了'),
    quota: t('Soniox 账户余额用完了：到 soniox.com 充值后再说'),
    timeout: t('Soniox 太久没回话，听写停了；说过的字都在框里'),
    busy: t('Soniox 那边同时连的太多，过一会儿再试'),
    server: t('Soniox 那边出错了，过一会儿再试'),
  }
  return (
    <div className="dict-note err" role="alert" data-testid="dict-note">
      <span className="dict-msg" title={n.code === 'mic-denied' ? t('系统设置 › 隐私与安全性 › 麦克风，打开 {app}', { app: BRAND.name }) : n.detail}>
        {say[n.code]}
      </span>
      {n.code === 'mic-denied' && (
        <button type="button" className="dict-go" onClick={() => void window.cnVoice.openMicSettings()}>
          {t('打开系统设置 →')}
        </button>
      )}
      {n.code === 'auth' && (
        <button type="button" className="dict-go" onClick={() => openSettingsAt('soniox')}>
          {t('到设置里换一个 →')}
        </button>
      )}
    </div>
  )
}
