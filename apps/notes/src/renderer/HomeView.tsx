import { Codicon, type CodiconName } from '@cn/design'
import { onFileMenu } from './ctx/file-menu'
import { ActBtn, TabActs } from './shell/TabActs'
import { useEffect, useRef, useState } from 'react'
import type { Activity, DreamGroup, DreamReport, NoteFile } from '../shared/api'
import type { HomeStyle } from '../shared/appearance'
import {
  COVER_GRADIENTS,
  COVER_PHOTOS,
  greeting,
  hideWidget,
  moveWidget,
  resizeWidget,
  showWidget,
  sizeAction,
  sizeOf,
  WIDGETS,
  type BuiltinCover,
  type HomeConfig,
  type WidgetId,
} from '../shared/home'
import { titleOf } from '../shared/layout'
import { INBOX_WARN } from '../shared/sidebar'
import { COVERS, coverImage } from './covers'
import { dreamWhen, pendingOf } from './dream/useDream'
import { saveHome, useHomeConfig } from './home-store'
import './home.css'
import { when } from './ListView'

/** 本周一 0 点 */
export function weekStart(now = new Date()): number {
  const day = (now.getDay() + 6) % 7
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime()
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 首页的数：这周写了几篇、剪了几段、几条没整理、每天存了几样 */
export function accumulate(notes: NoteFile[], act: Activity | null, now = new Date()) {
  const start = weekStart(now)
  const wroteNotes = notes.filter((n) => n.kind === 'work' && !n.board && !n.draft && n.mtimeMs >= start)
  const unsorted = notes.filter((n) => n.kind === 'inbox').length
  const days = Array.from({ length: 7 }, (_, i) => act?.days[dayKey(start + i * 86400_000)] ?? 0)
  return { wrote: wroteNotes.length, wroteNotes, clipped: act?.clipsThisWeek ?? 0, unsorted, days }
}

export function useActivity(version: number) {
  const [act, setAct] = useState<Activity | null>(null)
  useEffect(() => {
    void window.cn.activity().then(setAct)
  }, [version])
  return act
}

const WEEKDAY = '一二三四五六日'
const ICONS: Record<WidgetId, CodiconName> = {
  clock: 'clockface',
  week: 'edit',
  inbox: 'inbox',
  wall: 'layout',
  boards: 'layout',
  dream: 'wand',
  recent: 'file-text',
  flip: 'arrow-swap',
}

export interface HomeProps {
  style: HomeStyle
  notes: NoteFile[]
  version: number
  dream: DreamReport | null
  dreamRunning: boolean
  /** 每加一次就进编辑首页（⌘K 里的「编辑首页」） */
  editSeq: number
  onOpenDream(): void
  onDreamNow(): void
  onOpen(path: string): void
  onInbox(): void
  onTidy(): void
  onNewBoard(): void
  onOpenWeb(): void
  onChooseFolder(): void
  onNotice(t: string): void
}

/**
 * 首页：两种样式（设置里切换）。A 上面一条封面长图，下面组件网格；B 封面铺满首页，组件是半透明玻璃。
 * 组件、编辑、换封面两种一样；设置存在库里的 .canvas-notes/首页.json。
 */
export function HomeView(props: HomeProps) {
  const cfg = useHomeConfig()
  const act = useActivity(props.version)
  const [editing, setEditing] = useState(false)
  const [gallery, setGallery] = useState(false)
  /** 正在调封面位置：拖动时的临时位置 */
  const [adjustY, setAdjustY] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ id: WidgetId; before: WidgetId | null | undefined } | null>(null)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (props.editSeq) setEditing(true)
  }, [props.editSeq])
  useEffect(() => {
    if (adjustY === null && !gallery) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAdjustY(null)
      setGallery(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjustY, gallery])

  if (!cfg) return <section className="pane" />

  const save = (c: HomeConfig) =>
    void saveHome(c).catch((e) => props.onNotice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  const a = accumulate(props.notes, act)
  const empty = props.notes.length === 0
  const now = new Date()
  const coverY = adjustY ?? cfg.coverY

  function onGripDown(e: React.PointerEvent, id: WidgetId) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id, before: undefined })
  }
  function onGripMove(e: React.PointerEvent) {
    if (!drag) return
    // 拖到中间栏上下边缘时跟着滚，远处的组件也能拖到
    const sc = grid.current?.closest('.body')
    if (sc) {
      const r = sc.getBoundingClientRect()
      if (e.clientY < r.top + 48) sc.scrollBy(0, -16)
      else if (e.clientY > r.bottom - 48) sc.scrollBy(0, 16)
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-widget]')
    const over = el?.dataset.widget as WidgetId | undefined
    const inGrid = grid.current?.contains(document.elementFromPoint(e.clientX, e.clientY))
    setDrag({ id: drag.id, before: over && over !== drag.id ? over : inGrid && !over ? null : undefined })
  }
  function onGripUp() {
    if (drag && drag.before !== undefined) save(moveWidget(cfg!, drag.id, drag.before))
    setDrag(null)
  }

  const widgets = cfg.order.map((id) => {
    const size = sizeOf(cfg, id)
    const fixed = WIDGETS.find((w) => w.id === id)!.fixed
    return (
      <div
        key={id}
        data-widget={id}
        data-testid={`widget-${id}`}
        className={
          'wd s' + size + ' w-' + id + (id === 'inbox' && a.unsorted > INBOX_WARN ? ' warn' : '') + (drag?.id === id ? ' dragging' : '') + (drag && drag.before === id ? ' drop-before' : '')
        }
      >
        {editing && (
          <>
            <button
              className="wgrip"
              aria-label={`拖动${WIDGETS.find((w) => w.id === id)!.name}`}
              title="按住拖到别的组件前面"
              onPointerDown={(e) => onGripDown(e, id)}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={() => setDrag(null)}
            >
              <Codicon name="gripper" size={14} />
            </button>
            <div className="wedit">
              {!fixed && (
                <button onClick={() => save(resizeWidget(cfg, id))}>
                  <Codicon name="arrow-swap" size={12} />
                  {sizeAction(size)}
                </button>
              )}
              <button onClick={() => save(hideWidget(cfg, id))}>
                <Codicon name="screen-normal" size={12} />
                收起
              </button>
            </div>
          </>
        )}
        <div className="wk">
          <Codicon name={ICONS[id]} size={14} />
          {WIDGETS.find((w) => w.id === id)!.name}
          {id === 'wall' && <WallLegend />}
        </div>
        <Widget id={id} {...props} a={a} act={act} />
      </div>
    )
  })

  return (
    <section className={'pane homev home-' + props.style + (editing ? ' editing' : '')} data-testid="home" data-style={props.style}>
      <TabActs active>
        {editing ? (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(false)}>
            <Codicon name="check" size={14} />
            完成
          </button>
        ) : (
          <ActBtn icon="edit" label="编辑首页" onClick={() => setEditing(true)} />
        )}
      </TabActs>
      <div className="body">
        <div className="hscroll" style={{ ['--cover-img' as string]: coverImage(cfg.cover), ['--cover-y' as string]: `${coverY}%` }}>
          <div
            className={'cover' + (adjustY !== null ? ' adjust' : '') + (gallery ? ' keep' : '')}
            data-testid="home-cover"
            data-cover={cfg.cover.kind === 'file' ? cfg.cover.path : cfg.cover.id}
            onDragOver={(e) => {
              if (!Array.from(e.dataTransfer.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              // 拖一张图到封面上：存进库里的 附件/封面/，马上换上
              const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
              if (!f) return
              e.preventDefault()
              void f
                .arrayBuffer()
                .then((b) => window.cn.dropCover(new Uint8Array(b), f.name))
                .then((p) => save({ ...cfg, cover: { kind: 'file', path: p } }))
                .catch((err) => props.onNotice(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
            }}
            onPointerDown={(e) => {
              if (adjustY === null || (e.target as HTMLElement).closest('button')) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const startY = e.clientY
              const from = adjustY
              const h = e.currentTarget.offsetHeight
              const move = (ev: PointerEvent) => setAdjustY(Math.min(100, Math.max(0, Math.round(from - ((ev.clientY - startY) / h) * 100))))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            {adjustY !== null && <span className="hint">上下拖动图片，挑一个位置</span>}
            <div className="cacts">
              {adjustY === null ? (
                <>
                  <button className="cbtn" onClick={() => setGallery((v) => !v)} aria-expanded={gallery}>
                    <Codicon name="file-media" size={14} />
                    换封面
                  </button>
                  <button className="cbtn" onClick={() => (setGallery(false), setAdjustY(cfg.coverY))}>
                    <Codicon name="arrow-swap" size={14} />
                    调整位置
                  </button>
                </>
              ) : (
                <>
                  <button className="cbtn" onClick={() => setAdjustY(null)}>
                    取消
                  </button>
                  <button
                    className="cbtn pri"
                    onClick={() => {
                      save({ ...cfg, coverY: adjustY })
                      setAdjustY(null)
                    }}
                  >
                    保存位置
                  </button>
                </>
              )}
            </div>
            {gallery && <CoverGallery cfg={cfg} onPick={save} onNotice={props.onNotice} onClose={() => setGallery(false)} />}
          </div>
          <div className="hwrap">
            <div className="hello">
              <div>
                <h2 data-testid="home-title">{greeting(now)}</h2>
                <p className="lead">
                  {now.getMonth() + 1} 月 {now.getDate()} 日 · {a.wrote + a.clipped ? `这周攒下了 ${a.wrote + a.clipped} 样东西` : '这周还没攒下东西'}
                </p>
              </div>
            </div>
            <div className="wgrid" ref={grid}>
              {empty && <StartWidget {...props} />}
              {widgets}
            </div>
            {editing && (
              <div className="tray" data-testid="home-tray">
                <div className="hd">
                  <Codicon name="add" size={14} />
                  收起来的组件，点一下放回首页
                </div>
                <div className="items">
                  {cfg.hidden.length === 0 && <span className="none">都在首页上了</span>}
                  {cfg.hidden.map((id) => (
                    <button key={id} className="ti" onClick={() => save(showWidget(cfg, id))}>
                      <Codicon name={ICONS[id]} size={14} />
                      {WIDGETS.find((w) => w.id === id)!.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** 换封面：照片 / 渐变 / 从电脑选 / 随机一张；点一张立即换，弹层不关 */
export function CoverGallery(props: { cfg: HomeConfig; onPick(c: HomeConfig): void; onNotice(t: string): void; onClose(): void }) {
  const { cfg } = props
  const [tab, setTab] = useState<'photo' | 'grad'>(cfg.cover.kind === 'builtin' && (COVER_GRADIENTS as readonly string[]).includes(cfg.cover.id) ? 'grad' : 'photo')
  const ids: readonly BuiltinCover[] = tab === 'photo' ? COVER_PHOTOS : COVER_GRADIENTS
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!box.current?.contains(t) && !t.closest('.cacts')) props.onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div className="gal" ref={box} role="dialog" aria-label="换封面">
      <div className="gt">
        <button className={tab === 'photo' ? 'on' : ''} onClick={() => setTab('photo')}>
          照片
        </button>
        <button className={tab === 'grad' ? 'on' : ''} onClick={() => setTab('grad')}>
          渐变
        </button>
        <button
          onClick={async () => {
            try {
              const p = await window.cn.pickCover()
              if (p) props.onPick({ ...cfg, cover: { kind: 'file', path: p } })
            } catch (e) {
              props.onNotice(String((e as Error).message))
            }
          }}
        >
          从电脑选
        </button>
        <span className="sp" />
        <button
          onClick={() => {
            const pool = COVER_PHOTOS.filter((x) => !(cfg.cover.kind === 'builtin' && cfg.cover.id === x))
            props.onPick({ ...cfg, cover: { kind: 'builtin', id: pool[Math.floor(Math.random() * pool.length)]! } })
          }}
        >
          <Codicon name="arrow-swap" size={12} />
          随机一张
        </button>
      </div>
      <div className="gg">
        {ids.map((id) => {
          const on = cfg.cover.kind === 'builtin' && cfg.cover.id === id
          const name = COVERS.find((c) => c.id === id)!.name
          return (
            <button key={id} className={on ? 'on' : ''} aria-pressed={on} aria-label={name} title={name} onClick={() => props.onPick({ ...cfg, cover: { kind: 'builtin', id } })}>
              <i style={{ backgroundImage: coverImage({ kind: 'builtin', id }, true) }} />
              <span>{name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 空库时排第一的「从这里开始」：三步，库里有了第一篇东西后自动消失 */
function StartWidget(props: HomeProps) {
  const steps: [string, string, string, CodiconName, () => void][] = [
    ['剪一段网页', '在右栏打开网页，选中一段就能剪进收件箱', '开网页', 'globe', props.onOpenWeb],
    ['建一块白板', '把想法摊开成卡片，拖来拖去排位置', '新建白板', 'layout', props.onNewBoard],
    ['搬进旧笔记', 'Obsidian 之类的文件夹直接打开就能用', '选文件夹', 'root-folder', props.onChooseFolder],
  ]
  return (
    <div className="wd s4 w-start" data-testid="widget-start">
      <div className="wk">
        <Codicon name="sparkle" size={14} />
        从这里开始
      </div>
      <div className="ssteps">
        {steps.map(([name, note, btn, icon, go], i) => (
          <div key={name} className="st">
            <span className="n num">{i + 1}</span>
            <b>{name}</b>
            <span>{note}</span>
            <button className="btn btn-sm" onClick={go}>
              <Codicon name={icon} size={14} />
              {btn}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function WallLegend() {
  return (
    <span className="hleg r">
      少
      {[0, 1, 2, 3, 4].map((l) => (
        <i key={l} style={{ background: `var(--w${l})` }} />
      ))}
      多
    </span>
  )
}

const DREAM_LINES: Record<DreamGroup, [string, CodiconName]> = {
  file: ['处 归类和改名', 'inbox'],
  viz: ['个 可视化', 'preview'],
  link: ['处 补了双链', 'link'],
  dup: ['对 可能重复', 'copy'],
  week: ['篇 本周小结', 'edit'],
}

function Widget(props: HomeProps & { id: WidgetId; a: ReturnType<typeof accumulate>; act: Activity | null }) {
  const { a, act, notes } = props
  switch (props.id) {
    case 'clock':
      return <ClockBody />
    case 'week': {
      const max = Math.max(1, ...a.days)
      const today = (new Date().getDay() + 6) % 7
      const more = act ? act.clipsThisWeek - act.clipsLastWeek : 0
      const best = a.days.indexOf(Math.max(...a.days))
      // 上面两个数都是 0 时柱子也是空的（建库那次提交之类不算「积累」），不和数字打架（DESIGN.v3 5.3）
      const none = a.wrote + a.clipped === 0 || a.days.every((d) => d === 0)
      return (
        <>
          <div className="wk-big" data-testid="home-stats">
            <div>
              <b className="num">{a.wrote}</b>
              <span>篇自己写的</span>
            </div>
            <div>
              <b className="num">{a.clipped}</b>
              <span>段剪来的</span>
            </div>
          </div>
          <div className={'bars' + (none ? ' none' : '')}>
            {a.days.map((d, i) => (
              <i
                key={i}
                className={(i === today ? 'today' : '') + (!none && i === best ? ' best' : '')}
                title={`周${WEEKDAY[i]} · ${d} 样`}
                style={{ height: none || d === 0 ? undefined : `${Math.max(12, (d / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="barl">
            {[...WEEKDAY].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <p className="wk-more">
            {none
              ? '这周还空着。剪一段网页，或者写一句话，这里就会长出第一根柱子。'
              : [
                  more > 0 ? (
                    <span key="m">
                      比上周多 <b className="num">{more} 段</b>，
                    </span>
                  ) : more < 0 ? (
                    `比上周少 ${-more} 段，`
                  ) : (
                    ''
                  ),
                  `周${WEEKDAY[best]}存得最多`,
                ]}
          </p>
        </>
      )
    }
    case 'inbox': {
      const items = notes.filter((n) => n.kind === 'inbox').sort((x, y) => y.createdMs - x.createdMs)
      const warn = items.length > INBOX_WARN
      return (
        <>
          <button className="big" onClick={props.onInbox}>
            <span className="num">{items.length}</span>
            <small>{warn ? '条没整理 · 堆多了' : '条没整理'}</small>
          </button>
          {items.length === 0 && <p className="empty-note">收件箱是空的。在任何软件里按 ⌥⌘N 速记，回车就落到这里。</p>}
          {items.slice(0, 3).map((n) => (
            <button key={n.path} className="li" onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
              <Codicon name="inbox" size={12} />
              <span className="truncate">{n.preview || titleOf(n.path)}</span>
            </button>
          ))}
          {items.length > 0 && (
            <div className="wgo">
              <button className={'btn btn-sm' + (warn ? ' btn-primary' : '')} onClick={props.onTidy}>
                <Codicon name="sparkle" size={14} />
                让 AI 分一分
              </button>
            </div>
          )}
        </>
      )
    }
    case 'wall':
      return <Wall days={act?.days ?? {}} />
    case 'boards': {
      const boards = notes.filter((n) => n.board).sort((x, y) => y.mtimeMs - x.mtimeMs).slice(0, 3)
      return (
        <div className="thumbs">
          {boards.map((n) => (
            <button key={n.path} className="th" onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
              <Thumb note={n} />
              <span className="n">
                <b className="truncate">{titleOf(n.path)}</b>
                <span>
                  {n.board!.nodes !== undefined ? (
                    <>
                      <span className="num">{n.board!.nodes}</span> 个节点
                    </>
                  ) : (
                    <>
                      <span className="num">{n.board!.cards}</span> 张
                    </>
                  )}{' '}
                  · {when(n.mtimeMs).replace(/ \d\d:\d\d$/, '')}
                </span>
              </span>
            </button>
          ))}
          {boards.length === 0 && (
            <button className="th new" onClick={props.onNewBoard}>
              <span>
                <Codicon name="add" size={16} />
                建第一块白板
              </span>
            </button>
          )}
        </div>
      )
    }
    case 'dream':
      return <DreamBody {...props} />
    case 'recent': {
      const works = notes.filter((n) => n.kind === 'work' && !n.board).sort((x, y) => y.mtimeMs - x.mtimeMs).slice(0, 3)
      if (!works.length) return <p className="empty-note">还没写东西。左栏「我写的」旁边的加号建一篇。</p>
      return (
        <div className="recent">
          {works.map((n) => (
            <button key={n.path} className="r" onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
              <Codicon name="file-text" size={14} />
              <span className="truncate">{titleOf(n.path)}</span>
              <span className="t">{when(n.mtimeMs)}</span>
            </button>
          ))}
        </div>
      )
    }
    case 'flip':
      return <FlipBody {...props} />
  }
}

function ClockBody() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const p = (x: number) => String(x).padStart(2, '0')
  return (
    <div className="clock">
      <div className="tm num" data-testid="clock">
        {p(now.getHours())}:{p(now.getMinutes())}
        <small>{p(now.getSeconds())}</small>
      </div>
      <div className="dt">
        {now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEKDAY[(now.getDay() + 6) % 7]}
      </div>
    </div>
  )
}

function DreamBody(props: HomeProps) {
  const r = props.dream
  if (props.dreamRunning || !r) {
    return (
      <div className="dreamw" data-testid="dream-card">
        <h3>{props.dreamRunning ? '正在梦游，跑完这里出报告' : '第一晚还没到'}</h3>
        <p>Mac 闲着时自己整理收件箱、补双链、找重复、写本周小结。</p>
        <p>改动放在单独的分支上，你点收下才算数。</p>
        {!props.dreamRunning && (
          <div className="wgo">
            <button className="btn btn-sm" onClick={props.onDreamNow}>
              <Codicon name="wand" size={14} />
              现在梦游
            </button>
          </div>
        )}
      </div>
    )
  }
  const n = r.items.length
  const left = pendingOf(r)
  const counts = (Object.keys(DREAM_LINES) as DreamGroup[]).map((g) => [g, r.items.filter((i) => i.group === g).length] as const).filter(([, c]) => c > 0)
  return (
    <div className="dreamw" data-testid="dream-card">
      <span className="dk">{dreamWhen(r).replace(' ', '梦游 · ')}</span>
      <h3>{n === 0 ? '没什么要整理的' : left === 0 ? `整理了 ${n} 处，都看完了` : `整理了 ${n} 处，等你过目`}</h3>
      <div className="drows">
        {counts.map(([g, c]) => (
          <div key={g} className="l">
            <Codicon name={DREAM_LINES[g][1]} size={12} />
            <b className="num">
              {c} {DREAM_LINES[g][0].split(' ')[0]}
            </b>
            {DREAM_LINES[g][0].split(' ')[1]}
          </div>
        ))}
      </div>
      <div className="wgo">
        <button className="btn btn-sm btn-primary" onClick={props.onOpenDream}>
          看报告
        </button>
        <span className="hint">在分支 {r.branch} 上，收下才进 main</span>
      </div>
    </div>
  )
}

function FlipBody(props: HomeProps) {
  const clips = props.notes.filter((n) => n.kind === 'clip' || (n.kind === 'inbox' && n.source))
  const [i, setI] = useState(() => Math.floor(Math.random() * 1000))
  if (!clips.length) return <p className="empty-note">剪来的东西多了，这里每次随手翻一张给你看。</p>
  const c = clips[i % clips.length]!
  return (
    <div className="flip">
      <button className="q" onClick={() => props.onOpen(c.path)} onContextMenu={(e) => onFileMenu(e, c.path)}>
        {c.preview || titleOf(c.path)}
      </button>
      <div className="from">
        {c.source ? hostOf(c.source) + ' · ' : ''}
        {when(c.createdMs)}
      </div>
      <div className="wgo">
        <button className="btn btn-sm btn-ghost" onClick={() => setI((x) => x + 1)}>
          <Codicon name="arrow-swap" size={14} />
          换一张
        </button>
      </div>
    </div>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** 积累墙：最近 52 周，每格一天，存得越多颜色越深；今天那格一圈强调色 */
function Wall({ days }: { days: Record<string, number> }) {
  const weeks = 52
  const start = weekStart() - (weeks - 1) * 7 * 86400_000
  const now = Date.now()
  const todayKey = dayKey(now)
  const cells: { k: string; n: number; future: boolean }[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const t = start + i * 86400_000
    const k = dayKey(t)
    cells.push({ k, n: days[k] ?? 0, future: t > now })
  }
  const max = Math.max(1, ...cells.map((c) => c.n))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)))
  const none = cells.every((c) => c.n === 0)
  return (
    <div className="wall" data-testid="wall">
      <div className="hgrid">
        {cells.map((c) => (
          <i key={c.k} className={(c.future ? 'future' : 'l' + level(c.n)) + (c.k === todayKey ? ' today' : '')} title={`${c.k} · ${c.n} 样`} />
        ))}
      </div>
      {none && <p className="empty-note">每格一天，存得越多颜色越深。今天这一格等你填上。</p>}
    </div>
  )
}

/** 白板缩略图：按卡片真实位置缩小画 */
function Thumb({ note }: { note: NoteFile }) {
  const rects = note.board!.thumb
  const W = 200
  const H = 74
  if (!rects.length) return <span className="p" />
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  const scale = Math.min((W - 20) / (maxX - minX || 1), (H - 16) / (maxY - minY || 1), 0.2)
  return (
    <span className="p">
      {rects.map((r, i) => (
        <i
          key={i}
          className={r.k}
          style={{ left: 10 + (r.x - minX) * scale, top: 8 + (r.y - minY) * scale, width: Math.max(6, r.w * scale), height: Math.max(5, r.h * scale) }}
        />
      ))}
    </span>
  )
}
