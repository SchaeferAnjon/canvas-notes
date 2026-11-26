import { composing } from '../ime'
import { keyFor, useKeys } from '../keys'
/**
 * 网页栏顶上视频那一行（task-sta8n 方向 A「紧凑两档」，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a 的 .vr）：
 * 32 高，只有视频页才有：字幕、记下这一刻 ⌥S、框一块问 ⌥D、时间轴（刻度、问过的空心圆、播放头，点哪跳哪）、「N 个时刻 ▾」、记到哪。
 * 网页栏窄于 720 时快捷键提示和记到哪的名字收起；窄于 470 时只留图标、记到哪不摆。
 * 顶上收成一行时（WebPanel 的收起那一行）：记下这一刻、框一块问两颗图标和时刻数（VideoFoldTools），时间轴是那一行底边一根线（VideoHair）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { VIDEO_SUBS_EVENT } from '../settings/jump'
import { useEffect, useRef, useState } from 'react'
import { LANGS, langName, primary, SHORT } from '../../shared/plugins/translate'
import { sttErrorView } from '../../shared/stt-errors'
import { type DestPick, fmtTime, inboxPathFor, trackId } from '../../shared/video'
import { type MomentMark, type SubMode, type SubPlace, type VideoState } from '../../shared/video-api'
import { setPluginSettings, webHost } from '../plugins/host'
import { settingsNow as trSettings } from '../plugins/translate/shared'
import { Toggle } from '../Settings'
import { askDestNow, destNow, saveMoment, setDestPick, useDestPick } from './actions'
import { startAsk } from './ask-card'
import { setVideoSettings, useCenter, useSavedToast, useTick, useVideoSettings, useVideoState, videoHost } from './store'
import './video.css'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 语言的简称：英、中、日…；认不得的用名字的头两个字 */
function short(code: string | null): string {
  if (!code) return ''
  const c = code.replace(/^ai-/, '').replace(/#(auto|stt)$/, '')
  const p = primary(c)
  const m: Record<string, string> = { en: '英', zh: '中', ja: '日', ko: '韩', fr: '法', de: '德', es: '西', ru: '俄', it: '意', pt: '葡', vi: '越' }
  return m[p] ?? SHORT[c] ?? (/^[a-z]/i.test(c) ? c.slice(0, 2) : c.slice(0, 1))
}

type Pop = null | 'subs' | 'dest' | 'moments'

/** 弹层开着时：点外面、点进网页（视频）、按 esc 收起（公共的 useDismiss） */
const useOutside = (ref: React.RefObject<HTMLElement | null>, pop: Pop, close: () => void) => useDismiss(!!pop, [ref], close, { esc: 'late' })

/** 记下这一刻：按钮不留焦点，点完焦点回到视频，按空格是暂停 / 播放，不会再记一刻（CN-70） */
const momentNow = (wcId: number) => {
  videoHost()?.focus(wcId)
  void saveMoment(wcId)
}

/** 网页栏 720、470 两档：窄了先收快捷键和记到哪的名字，再窄只留图标（原型 .mid、.narrow） */
export type WebWidth = 'wide' | 'mid' | 'narrow'

export function VideoRow({ wcId, width }: { wcId: number; width: WebWidth }) {
  const st = useVideoState(wcId)
  const set = useVideoSettings()
  /** 记下这一刻、框一块问的键照命令表（设置 › 快捷键里改了跟着变） */
  const K = useKeys()
  const center = useCenter()
  const [pop, setPop] = useState<Pop>(null)
  // 设置 › 网页和视频「字幕怎么显示、记到哪 · 在视频条里改 ›」：打开字幕菜单（接住了就 preventDefault）
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setPop('subs')
    }
    window.addEventListener(VIDEO_SUBS_EVENT, on)
    return () => window.removeEventListener(VIDEO_SUBS_EVENT, on)
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, pop, () => setPop(null))
  const pick = useDestPick(st?.key ?? '')

  if (!st) return null
  const dest = destNow(st)
  const on = set.mode !== 'off' && !st.off && st.subs === 'ready'
  const lab = subLabel(st, set.mode)
  const failed = trFailed(st)
  const keys = width === 'wide'
  const destName = pick === 'none' ? '只问不记' : pick === 'inbox' ? '收件箱' : !dest ? '' : dest.kind === 'new' ? `新建《${dest.title}》` : dest.title
  return (
    <div className="vrow" ref={ref} role="region" aria-label="视频条" data-testid="web-row2">
      <button type="button" className={'vchip vsub' + (on ? ' on' : '') + (failed ? ' warn' : '')} aria-label="字幕" aria-haspopup="dialog" aria-expanded={pop === 'subs'} title={failed ? `${st.trFailed}句没翻成${st.trError ? `：${st.trError}` : ''}。点开再试一次` : '字幕：双语、翻成什么、放在哪'} onClick={() => setPop(pop === 'subs' ? null : 'subs')}>
        {st.stt && !st.stt.error ? <Codicon name="loading" size={13} className="spin" /> : <i className="vdot" />}
        <span className="truncate">
          {lab.lead && <span className="lbl">{lab.lead}</span>}
          {lab.rest}
        </span>
        <Codicon name="chevron-down" size={10} />
      </button>
      <button
        type="button"
        className={'vchip vsave' + (center?.aiOpen ? '' : ' solid')}
        aria-label="记下这一刻"
        data-tip={!keys ? `记下这一刻 ${K('video-moment')}` : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => momentNow(wcId)}
      >
        <Codicon name="device-camera" size={13} />
        <span className="lbl">记下这一刻</span>
        <kbd>{K('video-moment')}</kbd>
      </button>
      <button type="button" className="vchip vask" aria-label="框一块问" data-tip={!keys ? `框一块问 ${K('video-ask')}` : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => startAsk(wcId)}>
        <Codicon name="screen-full" size={13} />
        <span className="lbl">框一块问</span>
        <kbd>{K('video-ask')}</kbd>
      </button>
      <Track st={st} wcId={wcId} />
      <button type="button" className="vchip vcount" aria-label={`${st.moments.length}个时刻`} aria-haspopup="dialog" aria-expanded={pop === 'moments'} onClick={() => setPop(pop === 'moments' ? null : 'moments')}>
        <span>{st.moments.length}</span>
        <span className="lbl">个时刻</span>
        <Codicon name="chevron-down" size={10} />
      </button>
      {/* 记到哪：网页栏窄于 720 只留图标（原型窄于 470 不摆；默认 380 宽时要能换记到哪，留一颗图标） */}
      {dest && (
        <button
          type="button"
          className="vchip vdest"
          aria-label={`记到 ${destName}`}
          aria-haspopup="menu"
          aria-expanded={pop === 'dest'}
          data-tip={`记到哪：${destName}`}
          onClick={() => setPop(pop === 'dest' ? null : 'dest')}
        >
          <Codicon name={pick === 'none' ? 'close' : pick === 'inbox' ? 'inbox' : dest.kind === 'board' ? 'layout' : dest.kind === 'new' ? 'new-file' : 'note'} size={13} />
          <span className="dn truncate">{destName}</span>
          <Codicon name="chevron-down" size={10} />
        </button>
      )}
      {pop === 'subs' && <SubMenu st={st} onClose={() => setPop(null)} />}
      {pop === 'dest' && <DestPickMenu st={st} pick={pick} onPick={(p) => (setDestPick(st.key, p), setPop(null))} onClose={() => setPop(null)} />}
      {pop === 'moments' && <MomentsMenu st={st} wcId={wcId} onClose={() => setPop(null)} />}
    </div>
  )
}

/** 收起那一行右边：记下这一刻、框一块问两颗图标（它们的键照样能按）和时刻数（点开是时刻弹层） */
export function VideoFoldTools({ wcId }: { wcId: number }) {
  const st = useVideoState(wcId)
  const K = useKeys()
  const [pop, setPop] = useState<Pop>(null)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, pop, () => setPop(null))
  if (!st) return null
  return (
    <div className="vfold" ref={ref} role="group" aria-label="视频（收起）">
      <button type="button" className="wib" aria-label="记下这一刻" data-tip={`记下这一刻 ${K('video-moment')}`} data-side="below" onMouseDown={(e) => e.preventDefault()} onClick={() => momentNow(wcId)}>
        <Codicon name="device-camera" size={14} />
      </button>
      <button type="button" className="wib" aria-label="框一块问" data-tip={`框一块问 ${K('video-ask')}`} data-side="below" onMouseDown={(e) => e.preventDefault()} onClick={() => startAsk(wcId)}>
        <Codicon name="screen-full" size={14} />
      </button>
      <button type="button" className="vchip vcount" aria-label={`${st.moments.length}个时刻`} data-tip="记下的时刻" data-side="below" aria-haspopup="dialog" aria-expanded={pop === 'moments'} onClick={() => setPop(pop === 'moments' ? null : 'moments')}>
        <span>{st.moments.length}</span>
        <Codicon name="chevron-down" size={10} />
      </button>
      {pop === 'moments' && <MomentsMenu st={st} wcId={wcId} onClose={() => setPop(null)} />}
    </div>
  )
}

const STAGES = ['download', 'listen', 'translate'] as const

/** 这一轮翻完了还有几句没翻成（在翻的时候不算） */
const trFailed = (st: VideoState) => (st.target && !st.translating && st.trFailed > 0 ? st.trFailed : 0)

/** 字幕那一颗的字：开头的「字幕」（lead）在网页栏窄于 470 时藏起来（原型 .narrow .lbl），后面是语言对、进度、状态 */
function subLabel(st: VideoState, mode: SubMode): { lead: string; rest: string } {
  if (st.stt && !st.stt.error) return { lead: '', rest: `生成字幕${STAGES.indexOf(st.stt.stage) + 1}/3` }
  if (st.subs === 'loading') return { lead: '字幕 ', rest: '读取中' }
  if (st.subs === 'none') return { lead: '', rest: '没有字幕' }
  if (st.subs === 'login') return { lead: '', rest: '字幕要登录B站' }
  if (st.subs === 'error') return { lead: '', rest: '字幕没拿到' }
  if (mode === 'off' || st.off) return { lead: '', rest: '字幕关' }
  const src = short(st.track)
  // 没翻成时省掉语言对（菜单里看得到），按钮不加宽也放得下「N句没翻成」
  if (trFailed(st)) return { lead: '字幕 · ', rest: `${st.trFailed}句没翻成` }
  const tr = st.target && st.translated < st.total ? ` · ${Math.round((st.translated / Math.max(1, st.total)) * 100)}%` : ''
  return { lead: '字幕 ', rest: st.target ? `${src}→${short(st.target)}${tr}` : src }
}

// ---------------------------------------------------------------- 时间轴

/** 刻度、播放到哪的那几样：秒 → 百分比、刚记的那根、悬停说什么 */
function useMarks(st: VideoState, wcId: number) {
  const tick = useTick(wcId)
  const dur = st.duration || tick?.duration || 0
  // 刚记的那根亮一下：底部提示还在时它对着的那一秒
  const saved = useSavedToast()
  const fresh = saved && !saved.undone && saved.mark.wcId === wcId ? saved.mark.t : null
  const pct = (t: number) => `${dur ? Math.min(100, (t / dur) * 100) : 0}%`
  const isNew = (m: MomentMark) => fresh !== null && Math.abs(m.t - fresh) < 0.05
  /** 点在哪跳到哪 */
  const seekAt = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (dur && r.width) videoHost()?.cmd(wcId, 'seek', Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)))
  }
  return { t: tick?.t ?? 0, pct, isNew, seekAt }
}

/** 悬停说的（原型）：「00:48 记下的」「02:27 问过：…」 */
const tipOf = (m: MomentMark) => (m.asked ? `${fmtTime(m.t)} 问过：${m.text ?? ''}` : `${fmtTime(m.t)} 记下的`)

/** 视频那一行中间的时间轴：一根线、播过的那段、每个时刻一根刻度（问过的是空心圆）、播放头；点哪跳哪，点刻度跳回那一秒 */
function Track({ st, wcId }: { st: VideoState; wcId: number }) {
  const { t, pct, isNew, seekAt } = useMarks(st, wcId)
  const [hover, setHover] = useState<MomentMark | null>(null)
  return (
    <div className="vtrack" data-testid="vtrack" aria-label="时刻刻度" onClick={seekAt}>
      <div className="vplayed" style={{ width: pct(t) }} />
      {st.moments.map((m, i) => (
        <button
          key={`${m.t}-${i}`}
          type="button"
          className={'vmark' + (m.asked ? ' asked' : '') + (isNew(m) ? ' new' : '')}
          style={{ left: pct(m.t) }}
          aria-label={tipOf(m)}
          onMouseEnter={() => setHover(m)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            videoHost()?.cmd(wcId, 'seek', m.t)
          }}
        />
      ))}
      <div className="vhead" style={{ left: pct(t) }} />
      {hover && (
        <div className="vtip" style={{ left: pct(hover.t) }}>
          {tipOf(hover)}
        </div>
      )}
    </div>
  )
}

/** 收起时视频那一行变成收起那一行底边的一根线：刻度还在，指着变粗，点哪跳哪 */
export function VideoHair({ wcId }: { wcId: number }) {
  const st = useVideoState(wcId)
  if (!st) return null
  return <HairLine st={st} wcId={wcId} />
}

function HairLine({ st, wcId }: { st: VideoState; wcId: number }) {
  const { t, pct, isNew, seekAt } = useMarks(st, wcId)
  return (
    <div className="vhair" data-testid="vhair" aria-label="时刻刻度（收起）" onClick={seekAt}>
      <div className="vplayed" style={{ width: pct(t) }} />
      {st.moments.map((m, i) => (
        <i key={`${m.t}-${i}`} className={'vmark' + (m.asked ? ' asked' : '') + (isNew(m) ? ' new' : '')} style={{ left: pct(m.t) }} title={tipOf(m)} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 字幕菜单

function SubMenu({ st, onClose }: { st: VideoState; onClose(): void }) {
  const set = useVideoSettings()
  const [q, setQ] = useState('')
  const tr = trSettings()
  const notice = (t: string) => webHost()?.notice(t)
  const mode = async (m: SubMode) => {
    await setVideoSettings({ mode: m }).catch((e) => notice(errText(e)))
    void window.cnVideo.useTrack(st.wcId, m === 'off' ? '__off' : '__on')
  }
  const place = (p: SubPlace) => void setVideoSettings({ place: p }).catch((e) => notice(errText(e)))
  const target = async (code: string) => {
    try {
      await setPluginSettings('translate', { target: code })
      await window.cnVideo.setTarget(code)
      notice(`字幕改翻成${langName(code)}：先翻正在播的前后2分钟，再往后补`)
    } catch (e) {
      notice(errText(e))
    }
  }
  const found = LANGS.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase()) || l.code.toLowerCase().startsWith(q.trim().toLowerCase()))
  const cur = st.target ?? tr.target
  return (
    <div className="trm vmenu vsubmenu" role="dialog" aria-label="字幕">
      <div className="trm-sec">
        <div className="seg vseg" role="radiogroup" aria-label="字幕怎么显示">
          {(
            [
              ['bi', '双语'],
              ['tr', '只看译文'],
              ['orig', '只看原文'],
              ['off', '关'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={set.mode === id} className={set.mode === id ? 'on' : ''} onClick={() => void mode(id)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="trm-sec">
        <div className="trm-lab">原文用哪条字幕</div>
        {st.tracks.length ? (
          <div className="vlist" role="radiogroup" aria-label="原文用哪条字幕">
            {st.tracks.slice(0, 8).map((t) => (
              <button key={trackId(t)} type="button" role="radio" aria-checked={st.track === trackId(t)} onClick={() => void window.cnVideo.useTrack(st.wcId, trackId(t)).catch((e) => notice(errText(e)))}>
                <span className="ck">{st.track === trackId(t) && <Codicon name="check" size={12} />}</span>
                {t.name}
                {t.auto && <span className="t3"> · {st.site === 'bilibili' ? 'AI字幕' : '自动生成'}</span>}
              </button>
            ))}
            {st.tracks.length > 8 && <span className="vmore">{`还有${st.tracks.length - 8}条`}</span>}
          </div>
        ) : st.subs === 'login' || st.subs === 'loading' ? (
          <p className="vnote">{st.subs === 'login' ? 'B站要登录后才给字幕：点右上角「⋯」里的「导入Chrome登录」。' : '在读这个视频的字幕…'}</p>
        ) : null}
        {/* B 站没登录时看不到它的字幕：照样能自己生成（下载公开的音频听写） */}
        {(st.stt || (!st.tracks.length && (st.subs === 'none' || st.subs === 'error' || st.subs === 'login'))) && <SttBox st={st} target={cur} />}
      </div>
      <div className="trm-sec">
        <div className="trm-lab">
          翻成<span className="sp" />
          {st.target && st.translated < st.total && !trFailed(st) && (
            <span>
              {`翻了${st.translated}/${st.total}句`}
            </span>
          )}
        </div>
        {trFailed(st) > 0 && (
          <div className="aierr vtr-err" data-testid="tr-error">
            <div className="t">
              <Codicon name="error" size={12} className="ic" />
              <span>{`有${st.trFailed}句没翻成${st.trError ? `：${st.trError}` : ''}`}</span>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-sm" onClick={() => void window.cnVideo.retryTranslate(st.wcId).catch((e) => notice(errText(e)))}>
                <Codicon name="refresh" size={13} />
                再试一次
              </button>
            </div>
            {st.trRaw && <RawWords raw={st.trRaw} />}
          </div>
        )}
        <label className="vsearch">
          <Codicon name="search" size={13} />
          <input aria-label="翻成什么语言" placeholder="搜任何语言，比如 越南语、Deutsch" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => !composing(e) && e.key === 'Enter' && q.trim() && void target(found[0]?.code ?? q.trim())} />
        </label>
        <div className="trm-langs vlangs" role="radiogroup" aria-label="翻成">
          {found.map((l) => (
            <button key={l.code} type="button" role="radio" aria-checked={cur === l.code} className={cur === l.code ? 'on' : ''} onClick={() => void target(l.code)}>
              <span className="ck">{cur === l.code && <Codicon name="check" size={12} />}</span>
              {l.name}
            </button>
          ))}
          {!found.length && q.trim() && (
            <button type="button" role="radio" aria-checked={false} onClick={() => void target(q.trim())}>
              <span className="ck" />
              翻成「{q.trim()}」
            </button>
          )}
        </div>
      </div>
      <div className="trm-sec">
        <div className="trm-lab">放在哪</div>
        <div className="seg vseg" role="radiogroup" aria-label="字幕放在哪">
          {(
            [
              ['over', '盖在画面上'],
              ['below', '放在画面下面'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={set.place === id} className={set.place === id ? 'on' : ''} onClick={() => place(id)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="trm-row link"
        onClick={() => {
          onClose()
          const h = webHost()
          h?.openPopup('translate')
        }}
      >
        <Codicon name="symbol-color" size={14} />
        <span>译文样式…</span>
        <span className="sp" />
        <span className="t3">和网页翻译同一套</span>
      </button>
      <div className="trm-row">
        <span>打开视频就开字幕</span>
        <span className="sp" />
        <Toggle on={set.autoSubs} label="打开视频就开字幕" onChange={(v) => void setVideoSettings({ autoSubs: v })} />
      </div>
      <div className="trm-row">
        <span>存字幕全文时带译文</span>
        <span className="sp" />
        <Toggle on={set.withTranslation} label="存字幕全文时带译文" onChange={(v) => void setVideoSettings({ withTranslation: v })} />
      </div>
      <p className="vfoot">{`和网页翻译同一个引擎、同一份缓存；地址栏的翻译图标${keyFor('translate') ? `和 ${keyFor('translate')} ` : ''}在视频页上翻网页（标题、简介、评论）并打开双语字幕。`}</p>
    </div>
  )
}

// ---------------------------------------------------------------- 生成字幕（CN-69 方向 A）

/**
 * 没字幕的视频：一句话说三步和大概用时、花费 +「生成字幕」；生成时写到了哪一步、能停下；出错写原因和「再试一次」。
 * 下面一个方角开关「以后没字幕的视频打开就自动生成」，开一次就记住（设好就收起来）。
 */
function SttBox({ st, target }: { st: VideoState; target: string | null }) {
  const set = useVideoSettings()
  const center = useCenter()
  const notice = (t: string) => webHost()?.notice(t)
  const go = () => void window.cnVideo.transcribe({ wcId: st.wcId }).catch((e) => notice(errText(e)))
  const run = st.stt && !st.stt.error ? st.stt : null
  if (run) {
    const at = STAGES.indexOf(run.stage)
    // 三步的名字和字幕轨一致：听写那一步叫「听写 · Soniox」，正在做写「听写中 · Soniox」，做好的轨叫「English（听写 · Soniox）」
    const names = ['下载音频', '听写 · Soniox', '翻译']
    const doing = ['下载音频中', '听写中 · Soniox', '翻译中']
    return (
      <div className="vstt" data-testid="stt-box">
        <b>正在生成</b>
        {/* 一行放下三步，步与步之间的箭头挂在前一步末尾，放不下整行省略，不会有一行以分隔符开头 */}
        <div className="vstt-steps" data-testid="stt-steps">
          {names.map((n, i) => (
            <span key={n} className={i < at ? 'done' : i === at ? 'cur' : ''}>
              {i < at && <Codicon name="check" size={12} />}
              {i === at ? doing[i] : n}
            </span>
          ))}
        </div>
        <div className="vstt-bar" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={at + 1}>
          <i style={{ width: `${((at + 0.5) / 3) * 100}%` }} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void window.cnVideo.stopTranscribe(st.wcId)}>
          <Codicon name="debug-stop" size={13} />
          停下
        </button>
        <p className="vstt-foot">生成好后上面多一条「听出的语言（听写 · Soniox）」，自动选上；存进库里，换台Mac不用再听写</p>
      </div>
    )
  }
  const min = Math.max(1, Math.round((st.duration || 0) / 540))
  const yuan = ((st.duration || 0) / 3600) * 0.1 * 7.2
  const dur = st.duration ? `${Math.floor(st.duration / 60)}分${Math.round(st.duration % 60)}秒的视频约${min}分钟，Soniox${yuan < 0.1 ? '不到 ¥0.1' : `约 ¥${yuan.toFixed(1)}`}。` : ''
  const err = st.stt?.error ? sttErrorView(st.stt.error, st.site) : null
  return (
    <div className="vstt" data-testid="stt-box">
      <b>{err ? '字幕没生成成' : '这个视频没带字幕'}</b>
      {err ? (
        <div className="aierr vstt-err" data-testid="stt-error">
          <div className="t">
            <Codicon name="error" size={12} className="ic" />
            <span>{err.title}</span>
          </div>
        </div>
      ) : (
        <p>{`下载音频 → Soniox听写成原文 → 用你设的AI翻成${langName(target ?? 'zh-CN')}。${dur}`}</p>
      )}
      <div className="vstt-go">
        <button type="button" className="btn btn-sm btn-primary vstt-btn" disabled={!st.sttKey} onClick={go}>
          <Codicon name="mic" size={13} />
          {st.stt?.error ? '再试一次' : '生成字幕'}
        </button>
        {!st.sttKey && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => center?.openAiSettings()}>
            先在设置里填Soniox密钥
            <Codicon name="arrow-right" size={12} />
          </button>
        )}
      </div>
      {err?.raw && <RawWords raw={err.raw} />}
      <label className="vstt-auto">
        <span>以后没字幕的视频打开就自动生成</span>
        <Toggle on={set.autoStt} label="以后没字幕的视频打开就自动生成" onChange={(v) => void setVideoSettings({ autoStt: v }).catch((e) => notice(errText(e)))} />
      </label>
    </div>
  )
}

/** 「看原话 ›」：点开才是英文原话（等宽、能拷），和 AI 出错同一个样子 */
function RawWords({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="aierr">
      <button type="button" className="raw-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '收起原话' : '看原话'}
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open && <pre className="raw">{raw}</pre>}
    </div>
  )
}

// ---------------------------------------------------------------- 记到哪

/**
 * 「记到哪（这个视频记住）」（task-sta8n 方向 A，视频那一行和问框底下同一个菜单）：开着的这篇、新建一篇（用视频标题）、收件箱、只问不记；
 * 选了这个视频就一直用它（记在本机）。第一项照剪藏去处（2026-11-25）：这个网站配对的那篇、选的文件夹里这个视频那篇、收件箱里这个视频那篇。
 * up：在问框底栏上往上弹
 */
export function DestPickMenu({ st, pick, up, onPick, onClose }: { st: VideoState; pick: DestPick; up?: boolean; onPick(p: DestPick): void; onClose(): void }) {
  const center = useCenter()
  const ref = useRef<HTMLDivElement>(null)
  // 问框里：点外面、esc 收起（只收这个菜单，问框留着；视频那一行的由那一行管）
  useDismiss(!!up, [ref], onClose, { keep: '.ak-dst' })
  if (!center) return null
  // 问框里（up）的「记到哪」管问 AI 记进哪篇，照原来的默认（开着的这篇）；视频那一行的管记下这一刻，照剪藏去处
  const open = up ? askDestNow({ ...st, key: '' }) : destNow({ ...st, key: '' })
  const openName = !open ? '' : open.kind === 'new' ? `新建《${open.title}》` : open.title
  const rows: { p: DestPick; icon: 'file-text' | 'layout' | 'new-file' | 'inbox' | 'close'; name: string; note: string }[] = [
    // 视频那一行：记下这一刻照剪藏去处（配对的那篇 / 选的文件夹 / 收件箱，2026-11-25）；问框里：问 AI 照旧记进开着的这篇
    { p: 'open', icon: open?.kind === 'board' ? 'layout' : open?.kind === 'new' ? 'new-file' : 'file-text', name: openName, note: up ? '开着的这篇' : '照剪藏去处' },
    { p: 'new', icon: 'new-file', name: '新建一篇', note: '用视频标题' },
    { p: 'inbox', icon: 'inbox', name: '收件箱', note: '' },
    { p: 'none', icon: 'close', name: '只问不记', note: '回答只在这张卡里' },
  ]
  return (
    <div ref={ref} className={'menu vmenu vdestmenu' + (up ? ' up' : '')} role="menu" aria-label="记到哪">
      <div className="mh">记到哪（这个视频记住）</div>
      {rows.map((r) => (
        <button key={r.p} role="menuitemradio" aria-checked={pick === r.p} title={r.p === 'open' ? open?.path : r.p === 'inbox' || r.p === 'new' ? inboxPathFor(st.title) : undefined} onClick={() => onPick(r.p)}>
          <span className="ck">{pick === r.p && <Codicon name="check" size={12} />}</span>
          <Codicon name={r.icon} size={14} className="ci" />
          <span className="mlabel truncate">{r.name}</span>
          {r.note && <span className="r">{r.note}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- N 个时刻

function MomentsMenu({ st, wcId, onClose }: { st: VideoState; wcId: number; onClose(): void }) {
  const [q, setQ] = useState('')
  const chapters = st.chapters.length ? st.chapters : [{ start: 0, title: '' }]
  const list = st.moments.filter((m) => !q.trim() || `${m.text ?? ''} ${m.note}`.toLowerCase().includes(q.trim().toLowerCase()))
  const groups = chapters
    .map((c, i) => {
      const end = chapters[i + 1]?.start ?? Infinity
      const items = list.filter((m) => m.t >= c.start && m.t < end).sort((a, b) => b.t - a.t)
      return { c, items }
    })
    .filter((g) => g.items.length)
  return (
    <div className="trm vmenu vmoments" role="dialog" aria-label="时刻">
      <label className="vsearch">
        <Codicon name="search" size={13} />
        <input aria-label="在时刻里找" placeholder={`在这个视频的${st.moments.length}个时刻里找`} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!st.moments.length && <p className="vnote">{`还没有。按 ${keyFor('video-moment')} 记下这一刻，按 ${keyFor('video-ask')} 框一块问。`}</p>}
      {groups.map(({ c, items }) => (
        <div key={c.start} className="vgroup">
          {c.title && (
            <div className="trm-lab">
              <span className="mono">{fmtTime(c.start)}</span> {c.title}
            </div>
          )}
          {items.slice(0, 3).map((m) => (
            <button
              key={`${m.t}-${m.note}`}
              type="button"
              className="vmrow"
              onClick={() => {
                videoHost()?.cmd(wcId, 'seek', m.t)
                onClose()
              }}
            >
              {m.image ? <img src={`cn-file://vault/${m.image.split('/').map(encodeURIComponent).join('/')}`} alt="" /> : <span className="vth" />}
              <span className="vmt">
                <span className="truncate">{m.text || (m.asked ? '问过AI' : '记下的时刻')}</span>
                <span className="t3">
                  <span className="mono">{fmtTime(m.t)}</span> · 在《{m.note}》
                </span>
              </span>
            </button>
          ))}
          {items.length > 3 && <span className="vmore">{`还有${items.length - 3}个`}</span>}
        </div>
      ))}
      {st.material && <p className="vfoot">全部的在素材那篇「记下的时刻」里。</p>}
    </div>
  )
}
