/**
 * 文件夹首页的「MeetCaption」组件（MeetCaption 联动，设计 24-meetcaption联动「从文件夹首页的组件启动 MeetCaption」，已定第 11、12 件）：
 * 课程、项目文件夹首页的主入口：在哪门课的首页点「开始上课」，项目和模式就是这门课的，下课回来还在这个首页。
 * 和 ParaRead 组件同一套样子（首页现有的组件卡、一颗实心主按钮、行高 30 的列表、同样的「没装」写法，类名借 .prw）。
 * - 没上课：下一节（系统日历里这门课的日程；没连日历照 MeetCaption 记的课表；都没有写「随时能开」）、开始上课、换成网课只换这一次、最近几节；
 * - 上课中：上了几分钟、打开字幕（叫 MeetCaption 到前面）、在这里一起记（开正在写的那一篇）；
 * - 下课回来：刚下课的一句（写进了哪一篇、作业几件），新的一节排最上面、亮两秒；
 * - 没装：一句话说明 + 下载，最近几节照样列（笔记、录音都在库里）；
 * - 会议项目：主按钮「开始开会」、换成面试，每行多「待办 N」。
 * 项目、模式：MeetCaption 连库时写进库里 .canvas-notes/meetcaption.json；没对上时项目按文件夹名。头上的小标签点了换这个文件夹默认的模式。
 */
import { Codicon } from '@cn/design'
import type { McMode } from '@cn/format'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { folderKind, type FolderHome, addWidget } from '../../shared/folder-home'
import type { McFolder, McProject, McRow } from '../../shared/meetcaption'
import { recheckFamily, useFamily } from '../family-store'
import { useLang, useT } from '../i18n'
import type { WCtx } from '../folder-home/widgets'
import { seekRecord } from './jump'
import './meetcaption.css'

const PAIR: Record<McMode, McMode> = { class: 'online', online: 'class', meeting: 'interview', interview: 'meeting', video: 'class' }
const isMeeting = (m: McMode) => m === 'meeting' || m === 'interview'
/** 模式的名字（界面上的；写进文件的是 @cn/format 的 MC_MODE_NAMES） */
function modeName(t: ReturnType<typeof useT>, m: McMode): string {
  if (m === 'online') return t('网课', { ctx: 'MeetCaption模式' })
  if (m === 'meeting') return t('会议', { ctx: 'MeetCaption模式' })
  if (m === 'interview') return t('面试', { ctx: 'MeetCaption模式' })
  if (m === 'video') return t('视频', { ctx: 'MeetCaption模式' })
  return t('课堂', { ctx: 'MeetCaption模式' })
}
const weekday = (t: ReturnType<typeof useT>, d: number) => [t('周日'), t('周一'), t('周二'), t('周三'), t('周四'), t('周五'), t('周六')][d]!

/** 这个文件夹对的项目：.canvas-notes/meetcaption.json 里的；没有就按文件夹名（课程是课堂，别的是会议） */
function projectOf(folder: string, d: McFolder | null): McProject {
  if (d?.project) return d.project
  const name = folder.split('/').pop() ?? folder
  return { id: name, folder, mode: folderKind(folder) === 'course' || folderKind(folder) === null ? 'class' : 'meeting', schedule: [] }
}

/** 下一节：系统日历（连着时）里名字对得上的；没有用课表 */
async function nextClass(p: McProject): Promise<{ at: Date; from: string } | null> {
  const now = Date.now()
  try {
    const s = await window.cnCal.state()
    if (s.active) {
      const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const evs = await window.cnCal.events(day(new Date(now)), day(new Date(now + 14 * 864e5)))
      const keys = [p.calendar, p.name, p.id, p.folder.split('/').pop()].filter((x): x is string => !!x).map((x) => x.toLowerCase())
      const hit = evs
        .filter((e) => !e.allDay && new Date(e.start).getTime() > now - 10 * 60_000 && keys.some((k) => e.title.toLowerCase().includes(k) || k.includes(e.title.toLowerCase())))
        .sort((a, b) => a.start.localeCompare(b.start))[0]
      if (hit) return { at: new Date(hit.start), from: hit.title }
    }
  } catch {
    // 日历读不到：照课表
  }
  let best: Date | null = null
  for (const s of p.schedule) {
    const [h, m] = s.time.split(':').map(Number) as [number, number]
    for (let k = 0; k < 8; k++) {
      const d = new Date(now + k * 864e5)
      if (d.getDay() !== s.weekday) continue
      d.setHours(h, m, 0, 0)
      if (d.getTime() > now - 10 * 60_000 && (!best || d < best)) best = d
    }
  }
  return best ? { at: best, from: '' } : null
}

export function McTag(p: { folder: string; mode: McMode | undefined; onMode(m: McMode): void }) {
  const t = useT()
  const [d, setD] = useState<McFolder | null>(null)
  useEffect(() => void window.cnMc.folder(p.folder).then(setD, () => setD(null)), [p.folder])
  const pr = projectOf(p.folder, d)
  const mode = p.mode ?? pr.mode
  const label = [pr.id, modeName(t, mode), mode === 'class' ? t('教室现场') : mode === 'online' ? t('电脑声音') : null].filter(Boolean).join(' · ')
  return (
    <button className="prw-tag truncate" data-testid="mc-tag" data-tip={t('点一下换这个文件夹默认的模式')} onClick={() => p.onMode(PAIR[mode])}>
      {label}
    </button>
  )
}

export function McBody(props: { c: WCtx; mode: McMode | undefined }) {
  const { c } = props
  const t = useT()
  const lang = useLang()
  const fam = useFamily()
  const [d, setD] = useState<McFolder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [next, setNext] = useState<{ at: Date; from: string } | null | undefined>(undefined)
  const [now, setNow] = useState(Date.now())
  /** 刚下课那一篇亮两秒 */
  const [flash, setFlash] = useState<string | null>(null)
  const load = useCallback(() => void window.cnMc.folder(c.folder).then((x) => (setD(x), setError(null)), (e: unknown) => setError(String((e as Error).message ?? e))), [c.folder])
  useEffect(() => {
    load()
    const a = window.cn.onFilesChanged(load)
    const b = window.cnMc.onChanged(load)
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => (a(), b(), clearInterval(timer))
  }, [load])
  const project = projectOf(c.folder, d)
  const mode = props.mode ?? project.mode
  useEffect(() => {
    let stale = false
    void nextClass(project).then((x) => !stale && setNext(x))
    return () => void (stale = true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.folder, JSON.stringify(project.schedule), d?.live?.endedAt])
  const installed = !!d?.installed || !!fam?.installed.meetcaption
  useEffect(() => {
    if (installed) setWaiting(false)
  }, [installed])
  const mine = (f?: string) => !!f && f.startsWith(c.folder + '/')
  const live = d?.live && (d.live.project === project.id || mine(d.live.file)) ? d.live : null
  const ended = live?.endedAt && now - live.endedAt < 2 * 3600_000 ? live : null
  const on = live && !live.endedAt ? live : null
  useEffect(() => {
    if (!ended?.file) return
    setFlash(ended.file)
    const timer = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(timer)
  }, [ended?.file, ended?.endedAt])
  const rows = useMemo(() => d?.records ?? [], [d])

  if (error) return <p className="fw-empty">{error}</p>
  if (!d || !fam) return null
  const app = fam.list.apps.find((a) => a.id === 'meetcaption')
  const one = app ? (lang === 'en' ? (app.one.en ?? app.one.zh) : app.one.zh) : ''
  const fail = (e: unknown) => setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  const start = (m: McMode) => void window.cnMc.start({ project: project.id, mode: m, back: c.folder }).catch(fail)
  const listen = (r: McRow) => (c.onOpen(r.path), seekRecord(r.path, { session: r.sessions[0]!, t: 0, play: true }))
  const meeting = isMeeting(mode)
  const goLabel = mode === 'meeting' ? t('开始开会') : mode === 'interview' ? t('开始面试') : t('开始上课')
  const altLabel = t('换成{mode}', { mode: modeName(t, PAIR[mode]) })
  const fileTitle = (f: string) => f.split('/').pop()!.replace(/\.md$/i, '')
  /** 最近几节落在哪个子文件夹（「上课的录音和转录」） */
  const sub = rows[0] ? rows[0].path.slice(c.folder.length + 1).split('/').slice(0, -1).join('/') : ''
  const len = (r: McRow) => [r.minutes !== null ? `${Math.floor(r.minutes / 60)}:${String(r.minutes % 60).padStart(2, '0')}` : null, r.sessions.length > 1 ? t('{n} 段', { n: r.sessions.length }) : null].filter(Boolean).join(' · ')

  const left = (at: Date) => {
    const m = Math.round((at.getTime() - now) / 60_000)
    if (m <= 0) return t('到点了')
    if (m < 60) return t('还有 {n} 分钟', { n: m })
    if (m < 24 * 60) return t('还有 {n} 小时', { n: Math.round(m / 60) })
    return t('还有 {n} 天', { n: Math.round(m / 1440) })
  }

  return (
    <div className="prw mcw" data-testid="mc-widget" data-state={!installed ? 'missing' : on ? 'live' : ended ? 'after' : 'idle'}>
      {!installed ? (
        <>
          <div className="prw-now">
            <b>{t('这台 Mac 上没装 MeetCaption')}</b>
          </div>
          <p className="prw-say">{`${one}${t('装了以后在这里一键开始上课。')}`}</p>
          <div className="prw-acts">
            {waiting ? (
              <span className="prw-wait">
                {t('等你装好')} ·{' '}
                <button className="lnk" onClick={() => void recheckFamily().then(load)}>
                  {t('装好了，再看一下')}
                </button>
              </span>
            ) : (
              <button className="prw-dl" data-testid="mc-download" onClick={() => (setWaiting(true), void window.cnFamily.download('meetcaption'))}>
                {t('下载 MeetCaption')}
              </button>
            )}
          </div>
        </>
      ) : on ? (
        <>
          <div className="prw-now mcw-live" data-testid="mc-live">
            <i className="mcw-dot" />
            <b>{meeting ? t('开会中', { ctx: 'MeetCaption' }) : t('上课中', { ctx: 'MeetCaption' })}</b>
            <span>{` · ${t('{n} 分钟', { n: Math.max(0, Math.floor((Date.now() - on.startedAt) / 60_000)) })}`}</span>
          </div>
          {on.file && (
            <div className="prw-sub">
              <span className="truncate">{t('正写进「{name}」', { name: fileTitle(on.file) })}</span>
            </div>
          )}
          <div className="prw-acts">
            <button className="prw-go" data-testid="mc-open-live" onClick={() => void window.cnMc.open(on.session).catch(fail)}>
              {t('打开字幕')}
            </button>
            {on.file && (
              <button className="prw-alt" data-testid="mc-write-here" onClick={() => c.onOpen(on.file!)}>
                {t('在这里一起记')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {ended?.file && (
            <div className="mcw-after" data-testid="mc-after">
              <Codicon name="check" size={14} />
              <span className="truncate">
                {t('刚下课 · 写进了「{name}」', { name: fileTitle(ended.file) })}
                {ended.todos ? ` · ${t('作业 {n} 件', { n: ended.todos })}${ended.dated ? t('，{n} 件带日子', { n: ended.dated }) : ''}` : ''}
              </span>
            </div>
          )}
          <div className="prw-now mcw-next" data-testid="mc-next">
            {next ? (
              <>
                <span>{meeting ? t('下一次') : t('下一节')}</span>
                <b>{`${weekday(t, next.at.getDay())} ${String(next.at.getMonth() + 1).padStart(2, '0')}-${String(next.at.getDate()).padStart(2, '0')} ${String(next.at.getHours()).padStart(2, '0')}:${String(next.at.getMinutes()).padStart(2, '0')}`}</b>
                <span className="mcw-left">{` · ${left(next.at)}${next.from ? ' · ' + t('照日历「{name}」', { name: next.from }) : ' · ' + t('照课表')}`}</span>
              </>
            ) : next === null ? (
              <span>{meeting ? t('日历里没有下一次 · 随时能开') : t('日历里没有下一节 · 随时能开')}</span>
            ) : null}
          </div>
          <div className="prw-acts">
            <button className="prw-go" data-testid="mc-start" onClick={() => start(mode)}>
              {goLabel}
            </button>
            <button className="prw-alt" data-testid="mc-start-alt" data-tip={t('只换这一次')} onClick={() => start(PAIR[mode])}>
              {altLabel}
              <Codicon name="chevron-down" size={12} />
            </button>
          </div>
        </>
      )}
      <div className="prw-hd">
        {meeting ? t('最近几次', { ctx: 'MeetCaption' }) : t('最近几节', { ctx: 'MeetCaption' })}
        {sub ? ` · ${t('落在「{dir}」', { dir: sub })}` : ''}
      </div>
      {rows.length === 0 && <p className="fw-empty">{meeting ? t('这个文件夹里还没有MeetCaption记的会。') : t('这个文件夹里还没有MeetCaption记的课。')}</p>}
      {rows.slice(0, 5).map((r) => (
        <div key={r.path} className={'fw-row prw-row mcw-row' + (flash === r.path ? ' on' : '')} data-testid="mc-row">
          <span className="mcw-date num">{r.date.slice(5)}</span>
          <button className="nm truncate" title={r.path} onClick={() => c.onOpen(r.path)}>
            {r.title}
          </button>
          <span className="r num">{len(r)}</span>
          {meeting && r.open > 0 && <span className="r mcw-todo">{t('待办 {n}', { n: r.open })}</span>}
          <button className="lnk" disabled={!r.hasAudio} title={r.hasAudio ? undefined : t('这一节没有录音')} onClick={() => listen(r)}>
            {t('▶ 听')}
          </button>
          <button className="lnk" onClick={() => c.onOpen(r.path)}>
            {t('打开笔记', { ctx: 'MeetCaption组件' })}
          </button>
        </div>
      ))}
      {rows.length > 5 && (
        <button className="fw-more" onClick={c.onAll}>
          {meeting ? t('全部{n}次 · 打开列表看', { n: rows.length }) : t('全部{n}节 · 打开列表看', { n: rows.length })}
        </button>
      )}
    </div>
  )
}

/**
 * 连库时 MeetCaption 对上的文件夹（.canvas-notes/meetcaption.json）：第一次打开它的首页时把组件放到最前面（已定第 12 件，能删能挪；
 * 放过记在 .canvas-notes/meetcaption-placed.json，删了不再放）
 */
export async function mcAutoPlace(folder: string, home: FolderHome, save: (h: FolderHome) => void) {
  if (Object.values(home.widgets).some((w) => w.type === 'meetcaption')) return
  if (!(await window.cnMc.autoPlace(folder))) return
  const r = addWidget(home, 'meetcaption', folderKind(folder) ?? 'folder')
  save({ ...r.home, order: [r.id, ...r.home.order.filter((x) => x !== r.id)] })
}
