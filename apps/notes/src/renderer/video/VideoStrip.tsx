/**
 * 方向 A「视频条」：右栏网页原样，只在视频页的地址栏下面多两行。
 * 第一行：字幕开关（点开字幕菜单）、记下这一刻 ⌥S、框一块问 ⌥D、右端「记到 …」；
 * 第二行：刻度（每个时刻一根，问过 AI 的是空心圆，刚记的是紫色，播放头紫色），点一根跳回那一秒；右端「N 个时刻 ▾」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LANGS, langName, primary, SHORT } from '../../shared/plugins/translate'
import { sttErrorView } from '../../shared/stt-errors'
import { fmtTime, safeTitle, trackId } from '../../shared/video'
import { keyLabel, type MomentMark, type SubMode, type SubPlace, type VideoState } from '../../shared/video-api'
import { setPluginSettings, webHost } from '../plugins/host'
import { settingsNow as trSettings } from '../plugins/translate/shared'
import { Toggle } from '../Settings'
import { destNow, saveMoment, sendAsk, setDestInbox, startAsk } from './actions'
import { clearBox, setVideoSettings, useBoxEvent, useCenter, useSavedToast, useTick, useVideoSettings, useVideoState, videoHost } from './store'
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

export function VideoStrip({ wcId, narrow }: { wcId: number; narrow: boolean }) {
  const st = useVideoState(wcId)
  const set = useVideoSettings()
  const center = useCenter()
  const [pop, setPop] = useState<Pop>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 点外面收起弹层
  useEffect(() => {
    if (!pop) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setPop(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [pop])

  if (!st) return null
  const dest = destNow(st.title)
  const on = set.mode !== 'off' && !st.off && st.subs === 'ready'
  const lab = subLabel(st, set.mode)
  return (
    <div className="vstrip" ref={ref} role="region" aria-label="视频条">
      <div className="vbar">
        <button type="button" className={'vsub' + (on ? ' on' : '')} aria-label="字幕" aria-haspopup="dialog" aria-expanded={pop === 'subs'} title="字幕：双语、翻成什么、放在哪" onClick={() => setPop(pop === 'subs' ? null : 'subs')}>
          {st.stt && !st.stt.error ? <Codicon name="loading" size={13} className="spin" /> : <i className="vdot" />}
          <span className="truncate">{lab}</span>
          <Codicon name="chevron-down" size={12} />
        </button>
        <button type="button" className={'btn btn-sm ' + (center?.aiOpen ? '' : 'btn-primary') + ' vsave'} title={`记下这一刻 ${keyLabel(set.keys.moment)}`}
          // 按钮不留焦点：点完焦点回到视频，按空格是暂停 / 播放，不会再记一刻（CN-70）
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            videoHost()?.focus(wcId)
            void saveMoment(wcId)
          }}
        >
          <Codicon name="device-camera" size={13} />
          <span>记下这一刻</span>
          <kbd>{keyLabel(set.keys.moment)}</kbd>
        </button>
        <button type="button" className="btn btn-sm btn-ghost vask" aria-label="框一块问" title={`在画面上框一块问 AI ${keyLabel(set.keys.ask)}`} onClick={() => startAsk(wcId)}>
          <Codicon name="screen-full" size={13} />
          {!narrow && <span>框一块问</span>}
          {!narrow && <kbd>{keyLabel(set.keys.ask)}</kbd>}
        </button>
        <span className="sp" />
        {dest && (
          <button
            type="button"
            className="vdest"
            aria-label={`记到 ${dest.kind === 'new' ? `新建《${dest.title}》` : dest.title}`}
            aria-haspopup="menu"
            aria-expanded={pop === 'dest'}
            title={`记到：${dest.kind === 'inbox' ? dest.path : dest.kind === 'new' ? `新建《${dest.title}》（${dest.path}），在中间打开` : `《${dest.title}》`}`}
            onClick={() => setPop(pop === 'dest' ? null : 'dest')}
          >
            <Codicon name={dest.kind === 'board' ? 'layout' : dest.kind === 'inbox' ? 'inbox' : dest.kind === 'new' ? 'new-file' : 'file-text'} size={13} />
            {!narrow && <span className="truncate">{dest.kind === 'new' ? `新建《${dest.title}》` : dest.title}</span>}
            <Codicon name="chevron-down" size={12} />
          </button>
        )}
      </div>
      <Ticks st={st} wcId={wcId} onMenu={() => setPop(pop === 'moments' ? null : 'moments')} open={pop === 'moments'} />
      {pop === 'subs' && <SubMenu st={st} onClose={() => setPop(null)} />}
      {pop === 'dest' && dest && <DestMenu st={st} onClose={() => setPop(null)} />}
      {pop === 'moments' && <MomentsMenu st={st} wcId={wcId} onClose={() => setPop(null)} />}
      <AskBox wcId={wcId} st={st} />
    </div>
  )
}

const STAGES = ['download', 'listen', 'translate'] as const

function subLabel(st: VideoState, mode: SubMode): string {
  if (st.stt && !st.stt.error) return `生成字幕${STAGES.indexOf(st.stt.stage) + 1}/3`
  if (st.subs === 'loading') return '字幕 读取中'
  if (st.subs === 'none') return '没有字幕'
  if (st.subs === 'login') return '字幕要登录B站'
  if (st.subs === 'error') return '字幕没拿到'
  if (mode === 'off' || st.off) return '字幕关'
  const src = short(st.track)
  const tr = st.target && st.translated < st.total ? ` · ${Math.round((st.translated / Math.max(1, st.total)) * 100)}%` : ''
  return st.target ? `字幕 ${src}→${short(st.target)}${tr}` : `字幕 ${src}`
}

// ---------------------------------------------------------------- 刻度

function Ticks({ st, wcId, onMenu, open }: { st: VideoState; wcId: number; onMenu(): void; open: boolean }) {
  const tick = useTick(wcId)
  const dur = st.duration || tick?.duration || 0
  const [hover, setHover] = useState<MomentMark | null>(null)
  // 刚记的那根是紫色：底部提示还在时它对着的那一秒
  const saved = useSavedToast()
  const fresh = saved && !saved.undone && saved.mark.wcId === wcId ? saved.mark.t : null
  const pct = (t: number) => `${dur ? Math.min(100, (t / dur) * 100) : 0}%`
  return (
    <div className="vticks">
      <div className="vtrack" aria-label="时刻刻度">
        <div className="vplayed" style={{ width: pct(tick?.t ?? 0) }} />
        {st.moments.map((m, i) => (
          <button
            key={`${m.t}-${i}`}
            type="button"
            className={'vmark' + (m.asked ? ' asked' : '') + (fresh !== null && Math.abs(m.t - fresh) < 0.05 ? ' new' : '')}
            style={{ left: pct(m.t) }}
            aria-label={`${fmtTime(m.t)} 在《${m.note}》`}
            onMouseEnter={() => setHover(m)}
            onMouseLeave={() => setHover(null)}
            onClick={() => videoHost()?.cmd(wcId, 'seek', m.t)}
          />
        ))}
        <div className="vhead" style={{ left: pct(tick?.t ?? 0) }} />
        {hover && (
          <div className="vtip" style={{ left: pct(hover.t) }}>
            <span className="mono">{fmtTime(hover.t)}</span>在《{hover.note}》
          </div>
        )}
      </div>
      <button type="button" className="vcount" aria-haspopup="dialog" aria-expanded={open} onClick={onMenu}>
        {`${st.moments.length}个时刻`} <Codicon name="chevron-down" size={12} />
      </button>
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
          {st.target && st.translated < st.total && (
            <span>
              {`翻了${st.translated} / ${st.total}句`}
            </span>
          )}
        </div>
        <label className="vsearch">
          <Codicon name="search" size={13} />
          <input aria-label="翻成什么语言" placeholder="搜任何语言，比如 越南语、Deutsch" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && void target(found[0]?.code ?? q.trim())} />
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
      <p className="vfoot">和网页翻译同一个引擎、同一份缓存；地址栏的翻译图标和 ⌥A 在视频页上就是开关字幕。</p>
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

function DestMenu({ st, onClose }: { st: VideoState; onClose(): void }) {
  const center = useCenter()
  const cur = destNow(st.title)
  if (!center || !cur) return null
  const inbox = `收件箱/${st.title.slice(0, 30)}`
  const own = center.center.kind === 'doc' || center.center.kind === 'board' ? center.center : center.center.kind === 'material' && center.lastDoc ? { kind: 'doc' as const, ...center.lastDoc } : { kind: 'new' as const, title: `新建《${safeTitle(st.title)}》` }
  const pick = (toInbox: boolean) => {
    setDestInbox(toInbox)
    onClose()
  }
  return (
    <div className="menu vmenu vdestmenu" role="menu" aria-label="记到">
      {(
        <button role="menuitemradio" aria-checked={cur.kind !== 'inbox'} title={own.title} onClick={() => pick(false)}>
          <span className="ck">{cur.kind !== 'inbox' && <Codicon name="check" size={12} />}</span>
          <Codicon name={own.kind === 'board' ? 'layout' : own.kind === 'new' ? 'new-file' : 'file-text'} size={14} />
          <span className="mlabel truncate">
            {own.kind === 'board' ? '白板「时刻」列 · ' : own.kind === 'new' ? '' : '文档光标处 · '}
            {own.title}
          </span>
        </button>
      )}
      <button role="menuitemradio" aria-checked={cur.kind === 'inbox'} title={inbox} onClick={() => pick(true)}>
        <span className="ck">{cur.kind === 'inbox' && <Codicon name="check" size={12} />}</span>
        <Codicon name="inbox" size={14} />
        <span className="mlabel truncate">收件箱 · 新建一篇</span>
      </button>
      <p className="vfoot">换了中间栏的标签就回到默认：开着文档插光标处，开着白板进「时刻」列，都没开就新建一篇在中间打开。</p>
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
      {!st.moments.length && <p className="vnote">还没有。按 ⌥S 记下这一刻，按 ⌥D 框一块问。</p>}
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

// ---------------------------------------------------------------- 框好了：问话框

function AskBox({ wcId, st }: { wcId: number; st: VideoState }) {
  const ev = useBoxEvent()
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const box = ev && ev.wcId === wcId && 'box' in ev ? ev : null
  const ownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const prevFocus = useRef<Element | null>(null)

  useLayoutEffect(() => {
    if (!box) return setPos(null)
    const wv = videoHost()?.webviewRect(wcId)
    const strip = ownRef.current?.closest('.right.web')?.getBoundingClientRect()
    if (!wv || !strip) return
    const left = Math.max(8, Math.min(wv.left + box.rect.x + 12 - strip.left, strip.width - 308))
    const top = Math.min(wv.top + box.rect.y + box.rect.h + 8 - strip.top, strip.height - 230)
    setPos({ left, top })
    prevFocus.current = document.activeElement
    setQ('')
    setTimeout(() => input.current?.focus(), 0)
  }, [box?.box.x, box?.box.y, box?.box.w, box?.box.h, ev])

  if (!box || !pos) return <div ref={ownRef} hidden />
  const dest = destNow(st.title)
  const cancel = () => {
    videoHost()?.cmd(wcId, 'boxDone')
    clearBox()
    ;(prevFocus.current as HTMLElement | null)?.focus?.()
  }
  const ask = (text: string) => {
    const question = text.trim() || '给我讲解一下'
    clearBox()
    ;(prevFocus.current as HTMLElement | null)?.focus?.()
    sendAsk(wcId, box.box, question)
  }
  return (
    <div ref={ownRef} className="vask-pop" role="dialog" aria-label="问 AI" style={{ left: pos.left, top: pos.top }} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), cancel())}>
      <form
        className="vask-in"
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        <input ref={input} aria-label="想问什么" placeholder="给我讲解一下（回车就问）" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="iconbtn" aria-label="问">
          ↑
        </button>
      </form>
      <div className="vask-sug">
        {['给我讲解一下', '这个式子怎么来的？', '换个说法讲'].map((s) => (
          <button key={s} type="button" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>
      <p className="vfoot">
        {`问完自动记进${dest?.kind === 'new' ? '新建的' : ''}《${dest?.title ?? '收件箱'}》和「视频里的疑惑」· esc 取消`}
      </p>
    </div>
  )
}
