import { trackDrag } from '@cn/design/drag-end'
import { useDismiss } from '@cn/design/dismiss'
import { CATEGORIES, catName } from '../shared/categories'
import { useKeys } from './keys'
import { dreamDoes, type DreamSettings } from '../shared/dream-settings'
import { buildTree, folderProgress } from '../shared/files'
import type { FolderCover } from '../shared/folder-home'
import { useDesc } from './files/category-store'
import { folderLook, useLeft } from './files/left-store'
import { AnyCodicon } from './files/look'
import { useVaultFiles } from './files/store'
import { folderCoverCss } from './folder-home/cover'
import { Codicon, type CodiconName } from '@cn/design'
import { onFileMenu } from './ctx/file-menu'
import { AiIcon } from './engine-logo'
import { menuAt } from './ctx/menu'
import { ActBtn, TabActs } from './shell/TabActs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  type Cover,
  DEFAULT_HOME,
  type HomeConfig,
  type WidgetId,
} from '../shared/home'
import { titleOf } from '../shared/layout'
import { INBOX_WARN } from '../shared/sidebar'
import { COVERS, coverImage } from './covers'
import { dreamWhen, pendingOf } from './dream/useDream'
import { saveHome, useHomeConfig } from './home-store'
import './home.css'
import { dateText, when } from '../shared/when'
import { appSettings } from './settings-store'
import { isTodoNote } from '../shared/todo'
import { rich, useT } from './i18n'
import { uiLang } from '../shared/i18n'

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

/** 这周第 i 天（周一是 0）的叫法，跟界面语言：narrow「一」「M」、short「周一」「Mon」、long「星期一」「Monday」 */
const wk = (i: number, style: 'narrow' | 'short' | 'long') => new Intl.DateTimeFormat(uiLang() === 'en' ? 'en-US' : 'zh-CN', { weekday: style }).format(new Date(2024, 0, 1 + i))
const ICONS: Record<WidgetId, CodiconName> = {
  cats: 'folder',
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
  /** 样式 B 勾了「整页背景用窗口背景那张图」：用这张图（url 是 null 时用标题栏的纯色），换封面变灰（CN-52） */
  winBg?: { url: string | null; wall?: boolean } | null
  notes: NoteFile[]
  version: number
  dream: DreamReport | null
  dreamRunning: boolean
  /** 设置 › 梦游：卡片上说它会做什么、什么时候自己梦游 */
  dreamSettings: DreamSettings
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
  /** 首页分类卡（方向 C）：开这一类的首页（左栏不在「文件」时换到它那一枝） */
  onOpenCategory(name: string): void
  onNotice(t: string): void
}

/** 两个封面是不是同一张（空库时没换过的默认封面换成深海光） */
const sameCover = (a: Cover, b: Cover) => (a.kind === 'file' ? b.kind === 'file' && a.path === b.path : b.kind === 'builtin' && a.id === b.id)

/**
 * 首页：两种样式（设置里切换）。A 上面一条封面长图，下面组件网格；B 封面铺满首页，组件是半透明玻璃。
 * 组件、编辑、换封面两种一样；设置存在库里的 .canvas-notes/首页.json。
 */
export function HomeView(props: HomeProps) {
  const t = useT()
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
    const c = cfg!
    let before: WidgetId | null | undefined
    setDrag({ id, before })
    // 松手没送到页面（窗口外松手、失焦）：当没拖过，组件不挪（trackDrag，task-0nz63）
    trackDrag<PointerEvent>(e, {
      move: (ev) => {
        // 拖到中间栏上下边缘时跟着滚，远处的组件也能拖到
        const sc = grid.current?.closest('.body')
        if (sc) {
          const r = sc.getBoundingClientRect()
          if (ev.clientY < r.top + 48) sc.scrollBy(0, -16)
          else if (ev.clientY > r.bottom - 48) sc.scrollBy(0, 16)
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-widget]')
        const over = el?.dataset.widget as WidgetId | undefined
        const inGrid = grid.current?.contains(document.elementFromPoint(ev.clientX, ev.clientY))
        before = over && over !== id ? over : inGrid && !over ? null : undefined
        setDrag({ id, before })
      },
      end: (how) => {
        if (how === 'up' && before !== undefined) save(moveWidget(c, id, before))
        setDrag(null)
      },
    })
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
              aria-label={t('拖动{name}', { name: t(WIDGETS.find((w) => w.id === id)!.name) })}
              title={t('按住拖到别的组件前面')}
              onPointerDown={(e) => onGripDown(e, id)}
            >
              <Codicon name="gripper" size={14} />
            </button>
            <div className="wedit">
              {!fixed && (
                <button onClick={() => save(resizeWidget(cfg, id))}>
                  <Codicon name="arrow-swap" size={12} />
                  {t(sizeAction(size))}
                </button>
              )}
              <button onClick={() => save(hideWidget(cfg, id))}>
                <Codicon name="screen-normal" size={12} />
                {t('收起')}
              </button>
            </div>
          </>
        )}
        <div className="wk">
          <Codicon name={ICONS[id]} size={14} />
          {t(WIDGETS.find((w) => w.id === id)!.name)}
          {id === 'wall' && <WallLegend />}
          {id === 'cats' && <span className="r num">{t('{n}个 · 点开看它的首页', { n: CATEGORIES.length })}</span>}
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
            {t('完成')}
          </button>
        ) : (
          <>
            <ActBtn icon="edit" label={t('编辑首页')} text onClick={() => setEditing(true)} />
            <ActBtn
              icon="ellipsis"
              label={t('更多')}
              onClick={(e) =>
                void menuAt(e, [
                  {
                    label: t('换封面'),
                    run: () => {
                      if (props.winBg) return props.onNotice(t('首页现在用窗口背景那张图：设置 › 外观 › 首页样式 里取消「整页背景用窗口背景那张图」，就能换封面'))
                      document.querySelector('.homev:not([hidden]) .hscroll')?.closest('.body')?.scrollTo({ top: 0, behavior: 'smooth' })
                      setGallery(true)
                    },
                  },
                  { label: t('编辑首页'), run: () => setEditing(true) },
                ])
              }
            />
          </>
        )}
      </TabActs>
      <div className="body">
        <div
          className="hscroll"
          style={{
            ['--cover-img' as string]: props.winBg
              ? props.winBg.url
                ? `url("${props.winBg.url}")`
                : props.winBg.wall
                  ? 'var(--wall-glow), var(--wall-base)'
                  : 'linear-gradient(var(--title), var(--title))'
              : coverImage(empty && sameCover(cfg.cover, DEFAULT_HOME.cover) ? { kind: 'builtin', id: 'glow' } : cfg.cover),
            ['--cover-y' as string]: `${props.winBg ? 50 : coverY}%`,
          }}
        >
          <div
            className={'cover' + (adjustY !== null ? ' adjust' : '') + (gallery ? ' keep' : '')}
            data-testid="home-cover"
            data-cover={props.winBg ? 'window' : cfg.cover.kind === 'file' ? cfg.cover.path : cfg.cover.id}
            onDragOver={(e) => {
              if (props.winBg) return
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
              // 松手没送到页面：停在最后的位置（还要点「好了」才存；trackDrag，task-0nz63）
              trackDrag<PointerEvent>(e, { move: (ev) => setAdjustY(Math.min(100, Math.max(0, Math.round(from - ((ev.clientY - startY) / h) * 100)))) })
            }}
          >
            {adjustY !== null && <span className="hint">{t('上下拖动图片，挑一个位置')}</span>}
            <div className="cacts">
              {props.winBg ? (
                <button
                  className="cbtn"
                  aria-disabled="true"
                  aria-label={t('换封面（整页背景用的是窗口背景那张图，不能换）')}
                  data-tip={t('整页背景用的是窗口背景那张图：设置 › 外观 › 首页样式 里取消勾选就能换封面')}
                  data-side="below"
                  onClick={() => props.onNotice(t('首页现在用窗口背景那张图：设置 › 外观 › 首页样式 里取消「整页背景用窗口背景那张图」，就能换封面'))}
                >
                  <Codicon name="file-media" size={14} />
                  {t('换封面')}
                </button>
              ) : adjustY === null ? (
                <>
                  <button className="cbtn" onClick={() => setGallery((v) => !v)} aria-expanded={gallery}>
                    <Codicon name="file-media" size={14} />
                    {t('换封面')}
                  </button>
                  <button className="cbtn" onClick={() => (setGallery(false), setAdjustY(cfg.coverY))}>
                    <Codicon name="arrow-swap" size={14} />
                    {t('调整位置')}
                  </button>
                </>
              ) : (
                <>
                  <button className="cbtn" onClick={() => setAdjustY(null)}>
                    {t('取消')}
                  </button>
                  <button
                    className="cbtn pri"
                    onClick={() => {
                      save({ ...cfg, coverY: adjustY })
                      setAdjustY(null)
                    }}
                  >
                    {t('保存位置')}
                  </button>
                </>
              )}
            </div>
            {gallery && <CoverGallery cfg={cfg} onPick={save} onNotice={props.onNotice} onClose={() => setGallery(false)} />}
          </div>
          <div className="hwrap">
            <div className="hello">
              <div>
                {/* 空库（还一篇都没有）：先说这是个新库（第三版空库那屏），不问候「夜深了」 */}
                <h2 data-testid="home-title">{empty ? t('欢迎，这是一个新库') : t(greeting(now))}</h2>
                <p className="lead">
                  {empty
                    ? t('先存点东西进来，首页会慢慢长出来。')
                    : a.wrote + a.clipped
                      ? t('{date} · 这周攒下了{n}样东西', { date: dateText(now.getTime()), n: a.wrote + a.clipped })
                      : t('{date} · 这周还没攒下东西', { date: dateText(now.getTime()) })}
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
                  {t('收起来的组件，点一下放回首页')}
                </div>
                <div className="items">
                  {cfg.hidden.length === 0 && <span className="none">{t('都在首页上了')}</span>}
                  {cfg.hidden.map((id) => (
                    <button key={id} className="ti" onClick={() => save(showWidget(cfg, id))}>
                      <Codicon name={ICONS[id]} size={14} />
                      {t(WIDGETS.find((w) => w.id === id)!.name)}
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
  const t = useT()
  const { cfg } = props
  const [tab, setTab] = useState<'photo' | 'grad'>(cfg.cover.kind === 'builtin' && (COVER_GRADIENTS as readonly string[]).includes(cfg.cover.id) ? 'grad' : 'photo')
  const ids: readonly BuiltinCover[] = tab === 'photo' ? COVER_PHOTOS : COVER_GRADIENTS
  const box = useRef<HTMLDivElement>(null)
  // 点外面（网页里也算）、Esc 收起（公共的 useDismiss）；里面能挑本机图片（系统对话框会让窗口失焦），失焦不算
  useDismiss(true, [box], () => props.onClose(), { keep: '.cacts', blur: false })
  return (
    <div className="gal" ref={box} role="dialog" aria-label={t('换封面')}>
      <div className="gt">
        <button className={tab === 'photo' ? 'on' : ''} onClick={() => setTab('photo')}>
          {t('照片')}
        </button>
        <button className={tab === 'grad' ? 'on' : ''} onClick={() => setTab('grad')}>
          {t('渐变')}
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
          {t('从电脑选')}
        </button>
        <span className="sp" />
        <button
          onClick={() => {
            const pool = COVER_PHOTOS.filter((x) => !(cfg.cover.kind === 'builtin' && cfg.cover.id === x))
            props.onPick({ ...cfg, cover: { kind: 'builtin', id: pool[Math.floor(Math.random() * pool.length)]! } })
          }}
        >
          <Codicon name="arrow-swap" size={12} />
          {t('随机一张')}
        </button>
      </div>
      <div className="gg">
        {ids.map((id) => {
          const on = cfg.cover.kind === 'builtin' && cfg.cover.id === id
          const name = t(COVERS.find((c) => c.id === id)!.name)
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
  const t = useT()
  const steps: [string, string, string, CodiconName, () => void][] = [
    [t('剪一段网页'), t('在右栏打开网页，选中一段就能剪进收件箱'), t('开网页'), 'globe', props.onOpenWeb],
    [t('建一块白板'), t('把想法摊开成卡片，拖来拖去排位置'), t('新建白板'), 'layout', props.onNewBoard],
    [t('搬进旧笔记'), t('Obsidian之类的文件夹直接打开就能用'), t('选文件夹'), 'root-folder', props.onChooseFolder],
  ]
  return (
    <div className="wd s4 w-start" data-testid="widget-start">
      <div className="wk">
        <Codicon name="rocket" size={14} />
        {t('从这里开始')}
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
  const t = useT()
  return (
    <span className="hleg r">
      {t('少')}
      {[0, 1, 2, 3, 4].map((l) => (
        <i key={l} style={{ background: `var(--w${l})` }} />
      ))}
      {t('多')}
    </span>
  )
}

const DREAM_ICONS: Record<DreamGroup, CodiconName> = { attach: 'file-media', file: 'inbox', viz: 'preview', link: 'link', unsure: 'question', recheck: 'circle-slash', dup: 'copy', week: 'edit', alias: 'tag', entry: 'book' }

/**
 * 首页的「分类」（方向 C「首页分类卡」）：八张卡四列，上面一条 60 高的封面（和那一类首页的横幅同一张），
 * 下面图标（染那一类的颜色）+ 名字，再一行「4篇 · 放什么」；课程写「2门课 · 1/2讲」。点一张开那一类的首页
 */
function Categories(props: { onOpen(name: string): void }) {
  const t = useT()
  const { files } = useVaultFiles()
  const desc = useDesc()
  useLeft()
  const [covers, setCovers] = useState<Record<string, FolderCover>>({})
  useEffect(() => {
    let stale = false
    void Promise.all(CATEGORIES.map((c) => window.cnFolder.get(c.name).then((r) => [c.name, r.home.cover] as const))).then((l) => !stale && setCovers(Object.fromEntries(l)))
    return () => {
      stale = true
    }
  }, [files])
  const tree = useMemo(() => buildTree(files.filter((f) => f.kind !== 'img' && f.kind !== 'att')), [files])
  return (
    <div className="ccards" data-testid="home-cats">
      {CATEGORIES.map((c) => {
        const node = tree.find((n) => n.kind === 'dir' && n.name === c.name)
        const n = node?.count ?? 0
        const courses = c.name === catName('课程') && node ? node.children.filter((x) => x.kind === 'dir') : []
        const prog = courses.reduce((p, x) => {
          const fp = folderProgress(x)
          return fp ? { done: p.done + fp.done, total: p.total + fp.total } : p
        }, { done: 0, total: 0 })
        // 不翻：磁盘上的文件夹名
        const meta = c.name === catName('课程') ? [t('{n}门课', { n: courses.length }), ...(prog.total ? [t('{done}/{total}讲', { done: prog.done, total: prog.total })] : [])] : [t('{n}篇', { n })]
        /** 「放什么」：用户自己改过的照原样，默认那句跟界面语言 */
        const d = desc(c.name)
        const look = folderLook(c.name)
        return (
          <button key={c.name} className="ccard" data-testid={`cat-${c.name}`} onClick={() => props.onOpen(c.name)}>
            <span className="cv" style={{ backgroundImage: folderCoverCss(covers[c.name] ?? c.cover, c.name) }} />
            <span className="cb">
              <span className="cn">
                <span style={look.color ? { color: look.color } : undefined}>
                  <AnyCodicon name={look.icon} size={14} />
                </span>
                {c.name}
              </span>
              <span className="cm">{[...meta, d === c.desc ? t(c.desc) : d].join(' · ')}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Widget(props: HomeProps & { id: WidgetId; a: ReturnType<typeof accumulate>; act: Activity | null }) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const t = useT()
  const K = useKeys()
  const { a, act, notes } = props
  switch (props.id) {
    case 'cats':
      return <Categories onOpen={props.onOpenCategory} />
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
              <span>{t('篇自己写的', { n: a.wrote })}</span>
            </div>
            <div>
              <b className="num">{a.clipped}</b>
              <span>{t('段剪来的', { n: a.clipped })}</span>
            </div>
          </div>
          <div className={'bars' + (none ? ' none' : '')}>
            {a.days.map((d, i) => (
              <i
                key={i}
                className={(i === today ? 'today' : '') + (!none && i === best ? ' best' : '')}
                title={t('{day} · {n} 样', { day: wk(i, 'short'), n: d })}
                style={{ height: none || d === 0 ? undefined : `${Math.max(12, (d / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="barl">
            {a.days.map((_, i) => (
              <span key={i}>{wk(i, 'narrow')}</span>
            ))}
          </div>
          <p className="wk-more">
            {none
              ? t('这周还空着。剪一段网页，或者写一句话，这里就会长出第一根柱子。')
              : more > 0
                ? rich(t('比上周多{n}，{day}存得最多', { day: wk(best, uiLang() === 'en' ? 'long' : 'short') }), { n: <b className="num">{t('{n}段', { ctx: '本周积累', n: more })}</b> })
                : more < 0
                  ? t('比上周少{n}段，{day}存得最多', { n: -more, day: wk(best, uiLang() === 'en' ? 'long' : 'short') })
                  : t('{day}存得最多', { day: wk(best, uiLang() === 'en' ? 'long' : 'short') })}
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
            <small>{warn ? t('条没整理 · 堆多了') : t('条没整理')}</small>
          </button>
          {items.length === 0 && <p className="empty-note">{t('收件箱是空的。在任何软件里按 {key} 速记，回车就落到这里。', { key: K('quick-note') })}</p>}
          {items.slice(0, 3).map((n) => (
            <button key={n.path} className="li" onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
              <Codicon name="inbox" size={12} />
              <span className="truncate">{n.preview || titleOf(n.path)}</span>
            </button>
          ))}
          {items.length > 0 && (
            <div className="wgo">
              <button className={'btn btn-sm' + (warn ? ' btn-primary' : '')} onClick={props.onTidy}>
                <AiIcon job="chat" size={14} />
                {t('让AI分一分')}
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
                  <span>
                    {n.board!.nodes !== undefined ? (
                      <span className="num">{t('{n}个节点', { n: n.board!.nodes })}</span>
                    ) : (
                      <span className="num">{t('{n}张卡片', { n: n.board!.cards })}</span>
                    )}
                  </span>
                  <span>· {when(n.mtimeMs)}</span>
                </span>
              </span>
            </button>
          ))}
          {boards.length === 0 && (
            <button className="th new" onClick={props.onNewBoard}>
              <span>
                <Codicon name="add" size={16} />
                {t('建第一块白板')}
              </span>
            </button>
          )}
        </div>
      )
    }
    case 'dream':
      return <DreamBody {...props} />
    case 'recent': {
      // 名字叫「待办」的笔记在左边「待办」格里，不算写的东西（设置 › 文件打开「文件树里显示待办」才列，task-pd1d1）
      const works = notes.filter((n) => n.kind === 'work' && !n.board && (appSettings().files.showTodo || !isTodoNote(n.path))).sort((x, y) => y.mtimeMs - x.mtimeMs).slice(0, 3)
      if (!works.length) return <p className="empty-note">{t('还没写东西。左栏「我写的」旁边的加号建一篇。')}</p>
      return (
        <div className="recent">
          {works.map((n) => (
            <button key={n.path} className="r" onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
              <Codicon name="file-text" size={14} />
              <span className="truncate">{titleOf(n.path)}</span>
              {/* 和网页配成一对的（task-kbnc0）：点开网页跟着开 */}
              <span className="t">{n.readAlong ? t('网页跟着开 · {when}', { when: when(n.mtimeMs) }) : when(n.mtimeMs)}</span>
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
  const t = useT()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const p = (x: number) => String(x).padStart(2, '0')
  return (
    <div className="clock">
      <div className="tm num" data-testid="clock">
        {p(now.getHours())}:{p(now.getMinutes())}
        <small>{p(now.getSeconds())}</small>
      </div>
      <div className="dt">
        {t('{date} · {weekday}', { ctx: '时钟', date: dateText(now.getTime()), weekday: wk((now.getDay() + 6) % 7, 'long') })}
      </div>
    </div>
  )
}

function DreamBody(props: HomeProps) {
  const t = useT()
  const r = props.dream
  if (props.dreamRunning || !r) {
    return (
      <div className="dreamw" data-testid="dream-card">
        <h3>{props.dreamRunning ? t('正在梦游，跑完这里出报告') : t('第一晚还没到')}</h3>
        <p>{props.dreamSettings.auto ? t('Mac闲着时自己{does}。', { does: dreamDoes(props.dreamSettings) || t('梦游', { ctx: '首页梦游卡' }) }) : t('自己梦游关着（设置 › 梦游），点「现在梦游」才整理。')}</p>
        <p>{t('改动放在单独的分支上，你点收下才算数。')}</p>
        {/* 第一次梦游前说清在哪关（task-587os：梦游默认开、不拦着） */}
        {props.dreamSettings.auto && !props.dreamRunning && <p data-testid="dream-off-hint">{t('不想让它自己整理：设置 › 梦游 里关。')}</p>}
        {!props.dreamRunning && (
          <div className="wgo">
            <button className="btn btn-sm" onClick={props.onDreamNow}>
              <AiIcon job="dream" size={14} />
              {t('现在梦游')}
            </button>
          </div>
        )}
      </div>
    )
  }
  const n = r.items.length
  const left = pendingOf(r)
  /** 一行：粗体的数（带量词）和后面那句 */
  const line = (g: DreamGroup, c: number): [string, string] =>
    g === 'attach'
      ? [t('{n}张', { ctx: '梦游卡', n: c }), t('老图挪进各篇的文件夹', { n: c })]
      : g === 'file'
        ? [t('{n}处', { ctx: '梦游卡', n: c }), t('归类和改名', { ctx: '梦游卡', n: c })]
        : g === 'viz'
          ? [t('{n}个', { ctx: '梦游卡', n: c }), t('可视化', { ctx: '梦游卡', n: c })]
          : g === 'link'
            ? [t('{n}处', { ctx: '梦游卡', n: c }), t('补了双链', { ctx: '梦游卡', n: c })]
            : g === 'dup'
              ? [t('{n}对', { ctx: '梦游卡', n: c }), t('可能重复', { ctx: '梦游卡', n: c })]
              : [t('{n}篇', { ctx: '梦游卡', n: c }), t('本周小结', { ctx: '梦游卡', n: c })]
  const w = dreamWhen(r)
  const sp = w.indexOf(' ')
  const counts = (Object.keys(DREAM_ICONS) as DreamGroup[]).map((g) => [g, r.items.filter((i) => i.group === g).length] as const).filter(([, c]) => c > 0)
  return (
    <div className="dreamw" data-testid="dream-card">
      <span className="dk">{sp < 0 ? w : t('{day}梦游 · {time}', { day: w.slice(0, sp), time: w.slice(sp + 1) })}</span>
      <h3>{n === 0 ? t('没什么要整理的') : left === 0 ? t('整理了{n}处，都看完了', { n }) : t('整理了{n}处，等你过目', { n })}</h3>
      <div className="drows">
        {counts.map(([g, c]) => (
          <div key={g} className="l">
            <Codicon name={DREAM_ICONS[g]} size={12} />
            <b className="num">{line(g, c)[0]}</b>
            {line(g, c)[1]}
          </div>
        ))}
      </div>
      <div className="wgo">
        <button className="btn btn-sm btn-primary" onClick={props.onOpenDream}>
          {t('看报告')}
        </button>
        <span className="hint">{t('在分支{branch}上，收下才进main', { branch: r.branch })}</span>
      </div>
    </div>
  )
}

function FlipBody(props: HomeProps) {
  const t = useT()
  const clips = props.notes.filter((n) => n.kind === 'clip' || (n.kind === 'inbox' && n.source))
  const [i, setI] = useState(() => Math.floor(Math.random() * 1000))
  if (!clips.length) return <p className="empty-note">{t('剪来的东西多了，这里每次随手翻一张给你看。')}</p>
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
          {t('换一张')}
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

/**
 * 积累墙：最近 52 周，每格一天，存得越多颜色越深；今天那格一圈强调色。
 * 卡片窄到放不下 52 周（首页开着 AI 浮窗、窗口窄）时只画放得下的整周，最近的在右边，最左一列不会被卡片边切成半格（第 5 轮美学）
 */
function Wall({ days }: { days: Record<string, number> }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(52)
  useLayoutEffect(() => {
    const el = ref.current!
    // 每格 12、间距 3：n 周占 15n - 3
    const fit = () => setWeeks(Math.max(1, Math.min(52, Math.floor((el.clientWidth + 3) / 15))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const start = weekStart() - (weeks - 1) * 7 * 86400_000
  const now = Date.now()
  const todayKey = dayKey(now)
  const cells: { k: string; n: number; future: boolean }[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const ms = start + i * 86400_000
    const k = dayKey(ms)
    cells.push({ k, n: days[k] ?? 0, future: ms > now })
  }
  const max = Math.max(1, ...cells.map((c) => c.n))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)))
  const none = cells.every((c) => c.n === 0)
  return (
    <div className="wall" data-testid="wall" ref={ref}>
      <div className="hgrid">
        {cells.map((c) => (
          <i key={c.k} className={(c.future ? 'future' : 'l' + level(c.n)) + (c.k === todayKey ? ' today' : '')} title={t('{day} · {n} 样', { day: c.k, n: c.n })} />
        ))}
      </div>
      {none && <p className="empty-note">{t('每格一天，存得越多颜色越深。今天这一格等你填上。')}</p>}
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
