/**
 * MeetCaption 上课记录的录音条（MeetCaption 联动，设计 24「下课：录音条」「▶ 就地播」，已定第 3、7、9、15 件）：
 * 属性里有 meetcaption: 的那一篇，正文上面一条：
 * - 「录音 · 3 段 · 2 小时 30 分 · 点任何一个 ▶ 时间就在这里听」+「在 MeetCaption 里打开」（装了才有，深链 meetcaption://open）；
 * - 正文里每个 ▶ 时间默认就地播（点了从那一秒放，不去 MeetCaption）；
 * - 「字幕全文」：.canvas-notes/字幕/meetcaption/<场>.vtt，双语一句一行，正在放的那句亮着，点一句从那句放；
 * - 「关键画面」：录音那一处的 画面-HH.MM.SS.jpg，点一张从那一刻放；
 * - 录音在「<库名>-录音」仓库（.canvas-notes/录音/，Git LFS）：还是指针时写「还没下到这台 Mac 上」，字幕照样能跳（下载留了接口）。
 * 文件一个字不改：只在编辑器外面画、只拦 ▶ 链接的点击，「打开再保存文件不变」不受影响。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { Codicon } from '@cn/design'
import { clockLabel, clockToSession, cueAt, lineAtTime, parseMcOpen, readMcRecord, sessionClock, spanLabel, durationMinutes, prop } from '@cn/format'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { McRecordData } from '../../shared/meetcaption'
import { useFamily } from '../family-store'
import { goToLines } from '../goto-line'
import { useT } from '../i18n'
import { onSeek, type McSeek } from './jump'
import './meetcaption.css'

const typeOf = (rel: string) => (/\.webm$/i.test(rel) ? 'audio/webm' : /\.(m4a|mp4)$/i.test(rel) ? 'audio/mp4' : /\.ogg$/i.test(rel) ? 'audio/ogg' : /\.wav$/i.test(rel) ? 'audio/wav' : /\.mp3$/i.test(rel) ? 'audio/mpeg' : '')

/** 点到的是不是 ▶ 时间链接：是就给它的网址 */
function linkUrlAt(view: EditorView, target: HTMLElement): string | null {
  const link = target.closest('.cm-link')
  if (!link || !view.dom.contains(link)) return null
  const pos = view.posAtDOM(link)
  let url: string | null = null
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos + 1,
    enter: (n) => {
      if (n.name === 'Link') {
        const u = n.node.getChild('URL')
        if (u) url = view.state.doc.sliceString(u.from, u.to)
        return false
      }
      return undefined
    },
  })
  return url
}

export function ClassRecordBar(props: { path: string; text: string; view: () => EditorView | null; onNotice(text: string): void }) {
  const { path } = props
  const t = useT()
  const fam = useFamily()
  const [data, setData] = useState<McRecordData | null>(null)
  const [open, setOpen] = useState<'subs' | 'frames' | null>(null)
  /** 正在放哪一段（第几场）、放到第几秒、在不在放 */
  const [seg, setSeg] = useState(0)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const urls = useRef(new Map<string, string>())
  const loaded = useRef<string | null>(null)
  const subsRef = useRef<HTMLDivElement>(null)
  const textRef = useRef(props.text)
  textRef.current = props.text

  useEffect(() => {
    let stale = false
    void window.cnMc.record(path).then(
      (d) => !stale && setData(d),
      (e: unknown) => !stale && setWhy(String((e as Error).message ?? e)),
    )
    return () => void (stale = true)
  }, [path])
  useEffect(
    () => () => {
      for (const u of urls.current.values()) URL.revokeObjectURL(u)
    },
    [],
  )

  /** 跳到第 i 段的第 t 秒；play 就从那里放 */
  const seekTo = useCallback(
    async (i: number, sec: number, play: boolean) => {
      if (!data) return
      setSeg(i)
      setTime(sec)
      setWhy(null)
      const rel = data.recordings[i]
      const state = data.audio[i]
      if (!rel || state !== 'ready') {
        // 没录音、还没下：字幕照样跳到那一句
        setWhy(state === 'pointer' ? t('这一段的录音还没下到这台 Mac 上；字幕在，先跳到那一句') : t('这一段没有录音；字幕在，先跳到那一句'))
        setOpen('subs')
        return
      }
      const a = audio.current!
      if (loaded.current !== rel) {
        let u = urls.current.get(rel)
        if (!u) {
          try {
            u = URL.createObjectURL(new Blob([(await window.cnMc.audio(rel)) as BlobPart], { type: typeOf(rel) }))
          } catch (e) {
            setWhy(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
            return
          }
          urls.current.set(rel, u)
        }
        a.src = u
        loaded.current = rel
        const ok = await new Promise<boolean>((r) => (a.readyState >= 1 ? r(true) : (a.addEventListener('loadedmetadata', () => r(true), { once: true }), a.addEventListener('error', () => r(false), { once: true }))))
        if (!ok) {
          loaded.current = null
          setWhy(t('这一段的录音放不了：{why}', { why: a.error?.message || String(a.error?.code ?? '') }))
          return
        }
      }
      a.currentTime = sec
      // 换了一段（又点了别处）时上一下 play 被打断，不算出错
      if (play) await a.play().catch((e: unknown) => (e as Error).name !== 'AbortError' && setWhy(String((e as Error).message ?? e)))
    },
    [data, t],
  )

  /** 一刻（哪一场、第几秒）→ 跳；scroll 时正文滚到那一行 */
  const go = useCallback(
    (s: McSeek) => {
      if (!data) return
      const i = Math.max(0, s.session ? data.sessions.indexOf(s.session) : 0)
      void seekTo(i, s.t, !!s.play)
      if (s.scroll) {
        const rec = readMcRecord(textRef.current)
        const line = rec ? lineAtTime(rec, data.sessions[i]!, s.t) : null
        if (line) void goToLines(path, line)
      }
    },
    [data, path, seekTo],
  )
  useEffect(() => (data ? onSeek(path, go) : undefined), [data, path, go])

  // 正文里点 ▶ 时间：就地播（不去 MeetCaption）
  useEffect(() => {
    const v = props.view()
    if (!v || !data) return
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
      const url = linkUrlAt(v, e.target as HTMLElement)
      const hit = url ? parseMcOpen(url) : null
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      go({ session: hit.session, t: hit.t, play: true })
    }
    v.dom.addEventListener('mousedown', down, true)
    return () => v.dom.removeEventListener('mousedown', down, true)
  }, [props, data, go])

  // 放的时候字幕跟着走：正在放的那句亮、滚到看得见
  const subs = data?.subtitles[seg] ?? []
  const cur = cueAt(subs, time)
  useEffect(() => {
    if (open !== 'subs' || cur < 0) return
    const el = subsRef.current?.querySelector<HTMLElement>(`[data-seg="${seg}"][data-cue="${cur}"]`)
    const box = subsRef.current
    if (el && box) box.scrollTop = el.offsetTop - box.clientHeight / 3
  }, [open, cur, seg])

  if (!data) return why ? <div className="mcr mcr-err">{why}</div> : null
  const installed = !!fam?.installed.meetcaption
  const mins = durationMinutes(prop(props.text, '时长') ?? undefined)
  const total = mins !== null ? (mins >= 60 ? t('{h} 小时 {m} 分', { h: Math.floor(mins / 60), m: mins % 60 }) : t('{m} 分钟', { m: mins })) : null
  const anyAudio = data.audio.some((x) => x === 'ready' || x === 'pointer')
  const clockOf = (i: number, sec: number, withSec = false) => {
    const c = sessionClock(data.sessions[i]!)
    return c === null ? spanLabel(sec) : clockLabel(c + sec, withSec)
  }
  const nCues = data.subtitles.reduce((n, s) => n + s.length, 0)
  const toggle = () => {
    const a = audio.current!
    if (playing) a.pause()
    else if (loaded.current) void a.play()
    else void seekTo(seg, time, true)
  }

  return (
    <div className="mcr" data-testid="mc-record" data-seg={seg} data-playing={playing ? '1' : '0'}>
      <div className="mcr-bar">
        <button className="mcr-play" data-testid="mc-play" disabled={!anyAudio} aria-label={playing ? t('停') : t('放')} onClick={toggle}>
          <Codicon name={playing ? 'debug-pause' : 'play'} size={16} />
        </button>
        <b>{t('录音', { ctx: 'MeetCaption' })}</b>
        {loaded.current ? (
          <span className="mcr-at num" data-testid="mc-at">
            {data.sessions.length > 1 ? `${t('第 {n} 段', { n: seg + 1 })} · ` : ''}
            {clockOf(seg, time)}
            <span className="mcr-span">{` · ${spanLabel(time)} / ${spanLabel(dur)}`}</span>
          </span>
        ) : (
          <span className="mcr-say truncate">
            {[data.sessions.length > 1 ? t('{n} 段', { n: data.sessions.length }) : null, total, anyAudio ? t('点任何一个 ▶ 时间就在这里听') : t('没有录音，点 ▶ 时间跳到那一句字幕')].filter(Boolean).join(' · ')}
          </span>
        )}
        <span className="sp" />
        {installed && (
          <button className="mcr-mc" data-testid="mc-open-in" onClick={() => void window.cnMc.open(data.sessions[seg]!, loaded.current ? Math.floor(time) : undefined).catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}>
            {t('在 MeetCaption 里打开')}
          </button>
        )}
      </div>
      {loaded.current && (
        <input
          className="mcr-seek"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(dur))}
          value={Math.floor(time)}
          aria-label={t('拖到哪一秒')}
          onChange={(e) => void seekTo(seg, Number(e.target.value), playing)}
        />
      )}
      {why && (
        <div className="mcr-why" data-testid="mc-why">
          {why}
          {data.audio[seg] === 'pointer' && (
            <button className="lnk" onClick={() => void window.cnMc.fetchAudio(data.recordings[seg]!).catch((e: unknown) => setWhy(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}>
              {t('下下来')}
            </button>
          )}
        </div>
      )}
      <div className="mcr-tabs">
        <button className={open === 'subs' ? 'on' : ''} data-testid="mc-subs-tab" disabled={!nCues} onClick={() => setOpen(open === 'subs' ? null : 'subs')}>
          <Codicon name={open === 'subs' ? 'chevron-down' : 'chevron-right'} size={12} />
          {t('字幕全文 · {n} 句', { n: nCues })}
        </button>
        <button className={open === 'frames' ? 'on' : ''} data-testid="mc-frames-tab" disabled={!data.frames.length} onClick={() => setOpen(open === 'frames' ? null : 'frames')}>
          <Codicon name={open === 'frames' ? 'chevron-down' : 'chevron-right'} size={12} />
          {t('关键画面 · {n} 张', { n: data.frames.length })}
        </button>
      </div>
      {open === 'subs' && (
        <div className="mcr-subs" ref={subsRef} data-testid="mc-subs">
          {data.subtitles.map((cues, i) => (
            <div key={i}>
              {data.sessions.length > 1 && <div className="mcr-seg">{t('第 {n} 段 · {at}', { n: i + 1, at: clockOf(i, 0) })}</div>}
              {cues.map((c, k) => (
                <button key={k} className={'mcr-cue' + (i === seg && k === cur ? ' on' : '')} data-seg={i} data-cue={k} onClick={() => void seekTo(i, c.start, true)}>
                  <span className="mcr-t num">{clockOf(i, c.start, true)}</span>
                  <span className="mcr-x">
                    {c.who && <em>{c.who}</em>}
                    {c.text}
                    {c.tr && <span className="mcr-tr">{c.tr}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {open === 'frames' && (
        <div className="mcr-frames" data-testid="mc-frames">
          {data.frames.map((f) => {
            const at = clockToSession(data.sessions, f.clock)
            return (
              <button key={f.path} className="mcr-frame" data-testid="mc-frame" disabled={!at} onClick={() => at && go({ ...at, play: true, scroll: true })}>
                <img src={'cn-file://vault/' + f.path.split('/').map(encodeURIComponent).join('/')} alt="" loading="lazy" />
                <span className="num">{clockLabel(f.clock, true)}</span>
              </button>
            )
          })}
        </div>
      )}
      <audio
        ref={audio}
        data-testid="mc-audio"
        preload="metadata"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}
