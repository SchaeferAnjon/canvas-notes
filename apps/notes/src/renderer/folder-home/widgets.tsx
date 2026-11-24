/**
 * 文件夹首页的各个组件（spec 9.5）。列表型的只露几条加「全部 N 份」（偏好「别把上万条全铺开」）。
 * 课件进度、我的疑惑、今天要复习的数据由 PDF 阅读和 Anki 那边写进属性；还没有时显示空状态的那句话。
 */
import { dateText, when } from '../../shared/when'
import { Codicon } from '@cn/design'
import { onFileMenu } from '../ctx/file-menu'
import { itemDrag } from './drag-item'
import { fileIcon } from '../Palette'
import { useEffect, useMemo, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { type Cond, type FolderHome, type PropFile, runCond, setWidget, type WidgetData } from '../../shared/folder-home'
import { progressDone } from '../../shared/files'
import { CLIPS, kindOf, titleOf } from '../../shared/layout'
import { catName, isChildOf, underCat } from '../../shared/categories'
import { useVaultFiles, vaultFiles } from '../files/store'
import type { AnkiReview, CardItem } from '../../shared/reading'
import type { CourseSummary } from '../../shared/feynman/api'
import { startNext } from '../feynman-after/start'
import { AiIcon } from '../engine-logo'
import { unsentOf } from '../reading/cards-store'
import { usePrefs } from '../settings-store'
import { useCover } from './slide-covers'
import { openFolderHome } from './store'
import { TodoCard } from '../todo/TodoCard'
import { isTodoNote } from '../../shared/todo'
import { useT } from '../i18n'
import { ParaReadBody } from './ParaReadWidget'
import { t as tNow } from '../../shared/i18n'

export interface WCtx {
  folder: string
  files: PropFile[]
  notes: NoteFile[]
  /** 预览时挪进来的（新路径），标「新」 */
  fresh: Set<string>
  editing: boolean
  onOpen(path: string): void
  /** 打开 PDF 翻到那一页（读PDF时问过的） */
  onOpenAt(pdf: string, page: number): void
  /** 这门课读 PDF 时问过的每一问（各篇笔记里的，送过没有） */
  asked: CardItem[]
  /** 开这份 PDF、笔记栏换到「只看我问的」 */
  onAsked(pdf: string): void
  /** 这门课没送的出卡 */
  onCards(): void
  /** 今天要复习：这门课送进去几张（Anki 开着时新卡、今天到期） */
  review: AnkiReview | null
  onOpenAnki(): void
  onAll(): void
  onCapture(): void
  /** 卡里的一份能拖走、右键有「移到…」（task-r00en）：调整首页、梦游预览时不能 */
  movable: boolean
  /** 右键「移到…」：贴着这一份弹打字找文件夹的小弹层 */
  onMoveTo(path: string, anchor: HTMLElement): void
  save(h: FolderHome): void
  /** 重读这一页的设置（待办卡里的旧待办搬进 待办.md 以后） */
  reload(): void
  home: FolderHome
  id: string
}

// 不翻：键，画的地方翻
const EMPTY: Record<string, string> = {
  courses: '还没有课。左栏「课程」头上新建一门。', // 不翻
  slides: '把PDF拖到这张卡上，就收进这门课；问到第几页也会记在这里。', // 不翻
  review: '这门课还没有卡送进Anki。在下面「读PDF时问过的」点「出卡」，AI改好你一张张过。', // 不翻
  reviews: '这几门课还没有卡送进Anki。在每门课首页「读PDF时问过的」点「出卡」。', // 不翻
  exams: '还没有哪门课填了考试日期。在那门课的首页点「考试倒计时」填。', // 不翻
  exam: '还没填考试日期。点一下填。', // 不翻
  notes: '还没有笔记和导图。读课件时问AI，笔记会自己写好放进来。', // 不翻
  doubts: '还没问过。读课件时框一块问AI，问过的都在这里，能一键出卡。', // 不翻
  feynman: '还没讲过。在白板上选导图的一支或几张卡，点工具板「费曼学习」讲给AI学生听。', // 不翻
  viz: '还没有可视化。问AI时点「做个可视化」，做好的放这里。', // 不翻
  todo: '没有待办。', // 不翻
  links: '还没有链接。', // 不翻
  board: '还没选白板。', // 不翻
  text: '写点这门课的信息：老师、教室、考试范围。', // 不翻
  recent: '这里还没动过东西。', // 不翻
  progress: '还没定阶段。', // 不翻
  drafts: '没有草稿。', // 不翻
  clips: '还没有剪藏。', // 不翻
  list: '没有符合条件的文件。改一改条件，或者等这个文件夹里多一些东西。', // 不翻
}

const name = (p: string) => titleOf(p)

/**
 * 卡里的一份（task-r00en）：按住能拖到左栏文件树的文件夹、别的文件夹首页标签上（= 移过去）；
 * 右键是文件菜单，「移到…」弹打字找的小弹层（PDF 也有，挂着的笔记、可视化一起走）
 */
const item = (c: WCtx, path: string) =>
  c.movable
    ? {
        ...itemDrag(path),
        onContextMenu(e: React.MouseEvent<HTMLElement>) {
          const el = e.currentTarget
          onFileMenu(e, path, { home: { moveTo: () => c.onMoveTo(path, el) } })
        },
      }
    : { onContextMenu: (e: React.MouseEvent<HTMLElement>) => onFileMenu(e, path) }
/** text：「全部N篇 · 打开列表看」整句，各处照自己的量词给 */
const More = (p: { n: number; shown: number; text: string; onAll(): void }) =>
  p.n > p.shown ? (
    <button className="fw-more" onClick={p.onAll}>
      {p.text}
    </button>
  ) : null

function Rows(props: { c: WCtx; list: PropFile[]; limit: number; right?(f: PropFile): string }) {
  const { c } = props
  const t = useT()
  // 同名的几篇（各个子文件夹里的「未命名」）：名字后面淡淡写在哪个子文件夹，分得出是哪篇
  const shown = props.list.slice(0, props.limit)
  // 白板画它自己的颜色方块（和树、左栏「最近」一样）
  const boardColor = new Map(c.notes.flatMap((n) => (n.board ? [[n.path, n.board.color] as const] : [])))
  const digests = new Set(c.notes.flatMap((n) => (n.digest ? [n.path] : [])))
  const dup = new Set(shown.map((f) => name(f.path)).filter((n, i, a) => a.indexOf(n) !== i))
  const sub = (p: string) => {
    const dir = p.slice(0, p.lastIndexOf('/'))
    return dir === c.folder ? '' : dir.startsWith(c.folder + '/') ? dir.slice(c.folder.length + 1) : dir
  }
  return (
    <>
      {shown.map((f) => (
        <button key={f.path} className="fw-row" onClick={() => c.onOpen(f.path)} {...item(c, f.path)}>
          {/* 不翻：属性键、属性值照文件里的写 */}
          {boardColor.has(f.path) ? <i className="sw" style={{ background: boardColor.get(f.path) }} /> : <Codicon name={f.entry ? 'database' : /\.pdf$/i.test(f.path) ? 'file-pdf' : f.props['类型'] === '导图' ? 'type-hierarchy' : fileIcon(f.path, false, digests.has(f.path))} size={14} />}
          <span className="truncate">{name(f.path)}</span>
          {/* 数据库的一条写表名（和左栏「最近」一样）；同名的几篇写在哪个子文件夹 */}
          {f.entry ? (
            <span className="fw-in truncate">{f.path.slice(0, f.path.lastIndexOf('/')).split('/').pop()}</span>
          ) : (
            dup.has(name(f.path)) && sub(f.path) && <span className="fw-in truncate">{sub(f.path)}</span>
          )}
          {c.fresh.has(f.path) && <span className="tag-new">{t('新')}</span>}
          <span className="r num">{props.right?.(f) ?? ''}</span>
        </button>
      ))}
      <More n={props.list.length} shown={props.limit} text={t('全部{n}篇 · 打开列表看', { n: props.list.length })} onAll={c.onAll} />
    </>
  )
}

export function condResult(c: WCtx, cond: Cond): PropFile[] {
  return runCond(cond.scope === 'folder' ? c.files.filter((f) => f.path.startsWith(c.folder + '/')) : c.files, cond)
}

export function CondBody(props: { c: WCtx; cond: Cond }) {
  const { c, cond } = props
  const t = useT()
  const list = condResult(c, cond)
  if (!list.length) return <p className="fw-empty">{t(EMPTY[c.home.widgets[c.id]!.type] ?? EMPTY.list!)}</p>
  const right = (f: PropFile) => (f.props['第几讲'] ? t('第{n}讲', { n: f.props['第几讲'] }) : '') // 不翻：属性键、属性值照文件里的写
  if (cond.view === 'cards')
    return (
      <div className="fw-cards">
        {list.slice(0, cond.limit).map((f) => (
          <button key={f.path} onClick={() => c.onOpen(f.path)} {...item(c, f.path)}>
            <b className="truncate">{name(f.path)}</b>
            {/* 不翻：属性键、属性值照文件里的写 */}
            <span>{right(f) || f.props['类型'] || ''}</span>
          </button>
        ))}
      </div>
    )
  if (cond.view === 'table')
    return (
      <table className="fw-table">
        <thead>
          <tr>
            <th>{t('名字')}</th>
            <th>{t('类型')}</th>
            <th>{t('第几讲')}</th>
            <th>{t('改过')}</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, cond.limit).map((f) => (
            <tr key={f.path} onClick={() => c.onOpen(f.path)} {...item(c, f.path)}>
              <td className="truncate">{name(f.path)}</td>
              {/* 不翻：属性键、属性值照文件里的写 */}
              <td>{f.props['类型'] ?? ''}</td>
              {/* 不翻：属性键、属性值照文件里的写 */}
              <td className="num">{f.props['第几讲'] ?? ''}</td>
              <td>{ago(f.mtimeMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  return <Rows c={c} list={list} limit={cond.limit} right={right} />
}

export function WidgetBody(props: { c: WCtx; w: WidgetData }) {
  const { c, w } = props
  const t = useT()
  const inFolder = c.files.filter((f) => f.path.startsWith(c.folder + '/'))
  // 名字叫「待办」的笔记在待办卡和左边「待办」格里，「最近改的」不列（设置 › 文件打开「文件树里显示待办」才列，task-pd1d1）
  const showTodo = usePrefs((s) => s.files.showTodo)
  const set = (patch: Partial<WidgetData>) => c.save(setWidget(c.home, c.id, patch))
  switch (w.type) {
    case 'notes':
    case 'drafts':
    case 'list':
      return <CondBody c={c} cond={w.cond!} />
    case 'slides': {
      const list = slidesOf(c)
      if (!list.length) return <p className="fw-empty">{t(EMPTY.slides!)}</p>
      return <Slides c={c} list={list} />
    }
    case 'doubts':
      return c.asked.length ? <Asked c={c} list={c.asked} /> : <p className="fw-empty">{t(EMPTY.doubts!)}</p>
    case 'feynman':
      return <Feynman c={c} />
    case 'viz': {
      const list = inFolder.filter((f) => f.props['类型'] === '可视化') // 不翻：属性键、属性值照文件里的写
      return list.length ? <Viz c={c} list={list} /> : <p className="fw-empty">{t(EMPTY.viz!)}</p>
    }
    case 'courses':
      return <Courses c={c} />
    case 'review':
      return c.folder === catName('课程') ? <p className="fw-empty">{t(EMPTY.reviews!)}</p> : <Review c={c} />
    case 'exam':
      // 「课程」这一页：几门课里最近的那场考试
      return c.folder === catName('课程') ? <NextExam c={c} /> : <Exam w={w} set={set} />
    case 'todo':
      return <TodoCard folder={c.folder} w={w} reload={c.reload} />
    case 'links':
      return <Links w={w} set={set} />
    case 'text':
      return <FreeText w={w} set={set} />
    case 'recent': {
      const recent = showTodo ? inFolder : inFolder.filter((f) => !isTodoNote(f.path))
      return recent.length ? <Rows c={c} list={recent} limit={4} right={(f) => when(f.mtimeMs)} /> : <p className="fw-empty">{t(EMPTY.recent!)}</p>
    }
    case 'board': {
      const boards = c.notes.filter((n) => n.board && n.path.startsWith(c.folder + '/'))
      const b = boards.find((n) => n.path === w.board) ?? boards[0]
      return b ? (
        <button className="fw-board" onClick={() => c.onOpen(b.path)} {...item(c, b.path)}>
          <span className="fw-th" style={{ background: b.board!.color }} />
          <b>{titleOf(b.path)}</b>
          <span>{t('白板 · {n}张卡片', { n: b.board!.cards })}</span>
        </button>
      ) : (
        <p className="fw-empty">{t(EMPTY.board!)}</p>
      )
    }
    case 'progress':
      return w.stages?.length ? (
        <div className="fw-stages">
          {w.stages.map((s) => (
            <div key={s.name}>
              <span className="truncate">{s.name}</span>
              <i>
                <i style={{ width: `${s.pct}%` }} />
              </i>
              <span className="num">{s.pct}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="fw-empty">{t(EMPTY.progress!)}</p>
      )
    case 'cal':
    case 'calendar':
      return <Calendar c={c} files={inFolder} weeks={w.type === 'cal' ? 20 : 5} />
    case 'pararead':
      return <ParaReadBody c={c} view={w.view ?? 'bilingual'} />
    case 'clips': {
      // 每个主题几篇：和那个主题文件夹首页头上的数一样（剪来的 PDF、网页也算）
      const topics = new Map<string, number>()
      const all = vaultFiles()
      const paths = all.length ? all.filter((f) => f.kind !== 'dir').map((f) => f.path) : c.notes.map((n) => n.path)
      for (const p of paths) {
        const k = kindOf(p)
        if (k.kind === 'clip') topics.set(k.topic!, (topics.get(k.topic!) ?? 0) + 1)
      }
      const list = [...topics].sort((a, b) => b[1] - a[1])
      return list.length ? (
        <>
          {list.slice(0, 5).map(([topic, n]) => (
            // 一行是一个主题文件夹：文件夹图标，点了开那个文件夹的首页（没分主题的开「素材」）；不翻：「未分主题」是 kindOf 给的名字，拿来比
            <button key={topic} className="fw-row" onClick={() => openFolderHome(topic === '未分主题' ? CLIPS : `${CLIPS}/${topic}`)}>
              <Codicon name="folder" size={14} />
              {/* 不翻：比的是 kindOf 给的「未分主题」，显示时翻 */}
              <span className="truncate">{topic === '未分主题' ? t('未分主题') : topic}</span>
              <span className="r num">{t('{n}篇', { n })}</span>
            </button>
          ))}
          <More n={list.length} shown={5} text={t('全部{n}个主题 · 打开列表看', { n: list.length })} onAll={c.onAll} />
        </>
      ) : (
        <p className="fw-empty">{t(EMPTY.clips!)}</p>
      )
    }
  }
}

const slideAt = (f: PropFile) => Number(f.props['问到']) || 0 // 不翻：属性键、属性值照文件里的写
const slidePages = (f: PropFile) => Number(f.props['页数']) || 0 // 不翻：属性键、属性值照文件里的写
const slideDone = (f: PropFile) => slidePages(f) > 0 && slideAt(f) >= slidePages(f)
const slideStem = (p: string) => titleOf(p).replace(/\.pdf$/i, '')

/** 这门课的课件（按第几讲排） */
export function slidesOf(c: WCtx): PropFile[] {
  return c.files
    .filter((f) => f.path.startsWith(c.folder + '/') && f.props['类型'] === '课件') // 不翻：属性键、属性值照文件里的写
    .sort((a, b) => (Number(a.props['第几讲']) || 0) - (Number(b.props['第几讲']) || 0) || a.path.localeCompare(b.path, 'zh')) // 不翻：属性键、属性值照文件里的写
}

/**
 * 课件进度放不下时摆哪几份：刚拖进来的（标「新」）→ 正在读的（最近读的在前）→ 没开始的（按第几讲）→ 读完的（最近读完的在前），
 * 取前 max 份，再按第几讲排回去。拖进几份都看得见，不被名字排在前面的挤掉。
 */
export function pickSlides(list: PropFile[], max: number, fresh: Set<string>): PropFile[] {
  if (list.length <= max) return list
  const lecture = (f: PropFile) => Number(f.props['第几讲']) || 0 // 不翻：属性键、属性值照文件里的写
  const rank = (f: PropFile) => (fresh.has(f.path) ? 0 : slideDone(f) ? 3 : slideAt(f) > 0 ? 1 : 2)
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? 0 : b.mtimeMs - a.mtimeMs))
    .slice(0, max)
    .sort((a, b) => lecture(a) - lecture(b) || a.path.localeCompare(b.path, 'zh'))
}

/**
 * 课件进度（CN-21 方向 A）：一排封面（PDF 第一页），进度是封面底边一条 3px 细条（读完变灰），
 * 下面一行名字 +「问到 10 / 43 页」；最后一格虚线框「拖 PDF 到这里」（CN-2）。
 * 多了只列几份（「别把上万条全铺开」，挑法见 pickSlides），「全部 N 份」打开列表。
 */
function Slides(props: { c: WCtx; list: PropFile[] }) {
  const { c } = props
  const t = useT()
  const max = c.editing ? 4 : 3
  const shown = pickSlides(props.list, max, c.fresh)
  const course = c.folder.split('/').pop()
  return (
    <>
      <div className="fw-covers" data-testid="slides-covers">
        {shown.map((f) => (
          <SlideCover key={f.path} c={c} f={f} />
        ))}
        {/* 格子里只放加号和一行「拖 PDF」，整句放悬停提示（CN-113：中间栏窄时两行字折成三四行） */}
        {!c.editing && (
          <div className="fw-dropcell" data-testid="slides-dropcell" data-tip={t('把PDF拖到这张卡上，就收进{name}', { name: course })} data-side="below">
            <Codicon name="add" size={14} />
            <span>{t('拖PDF')}</span>
          </div>
        )}
      </div>
      <More n={props.list.length} shown={shown.length} text={t('全部{n}份 · 打开列表看', { n: props.list.length })} onAll={c.onAll} />
    </>
  )
}

function SlideCover({ c, f }: { c: WCtx; f: PropFile }) {
  const t = useT()
  const url = useCover(f.path, f.mtimeMs)
  const at = slideAt(f)
  const pages = slidePages(f)
  const done = slideDone(f)
  return (
    <button className="fw-cover" data-testid="slide-cover" onClick={() => c.onOpen(f.path)} {...item(c, f.path)} title={titleOf(f.path)}>
      <span className="cv">
        {url && url !== 'failed' ? <img src={url} alt={t('{name} 第一页', { name: slideStem(f.path) })} draggable={false} /> : <Codicon name="file-pdf" size={20} className={url === 'failed' ? 'bad' : 'wait'} />}
        <i className={'pg' + (done ? ' done' : '')} aria-hidden>
          <i style={{ width: `${done ? 100 : pages ? Math.min(100, (at / pages) * 100) : 0}%` }} />
        </i>
      </span>
      <span className="nm">
        <span className="truncate">{slideStem(f.path)}</span>
        {c.fresh.has(f.path) && <span className="tag-new">{t('新')}</span>}
        <span className="r num">
          {done ? (
            <>
              <Codicon name="check" size={12} className="ok" />
              {t('读完')}
            </>
          ) : at ? (
            t('问到{at} / {pages}页', { at, pages: pages || '?' })
          ) : (
            t('没开始')
          )}
        </span>
      </span>
    </button>
  )
}

/**
 * 「课程」这一页的在上的课（方案 v2 分类与入口的小样）：每门课一行，书架图标、名字、一条进度、「1/5讲」（问完了几份课件 / 一共几份）；
 * 点一行开那门课的首页
 */
function Courses(props: { c: WCtx }) {
  const t = useT()
  const { files } = useVaultFiles()
  const list = useMemo(() => {
    const courses = files.filter((f) => f.kind === 'dir' && isChildOf(f.path, '课程')).map((f) => f.path)
    const prog = new Map<string, { done: number; total: number }>()
    for (const f of files) {
      if (f.kind !== 'pdf' || !underCat(f.path, '课程')) continue
      const course = f.path.split('/').slice(0, 2).join('/')
      const p = prog.get(course) ?? { done: 0, total: 0 }
      p.total++
      if (progressDone(f.progress)) p.done++
      prog.set(course, p)
    }
    return courses.sort((a, b) => a.localeCompare(b, 'zh')).map((f) => ({ folder: f, ...(prog.get(f) ?? { done: 0, total: 0 }) }))
  }, [files])
  if (!list.length) return <p className="fw-empty">{t(EMPTY.courses!)}</p>
  return (
    <>
      {list.slice(0, 6).map((x) => (
        <button key={x.folder} className="fw-row fw-course" onClick={() => openFolderHome(x.folder)}>
          <Codicon name="folder-library" size={14} />
          <span className="truncate">{x.folder.split('/')[1]}</span>
          {x.total > 0 && (
            <>
              <i className="fw-bar" aria-hidden>
                <i style={{ width: `${(x.done / x.total) * 100}%` }} />
              </i>
              <span className="r num">{t('{done}/{total}讲', { done: x.done, total: x.total })}</span>
            </>
          )}
        </button>
      ))}
      <More n={list.length} shown={6} text={t('全部{n}门 · 打开列表看', { n: list.length })} onAll={props.c.onAll} />
    </>
  )
}

/** 「课程」这一页的考试倒计时：各门课首页里填的考试，挑最近的一场「23 天 · 机器学习 期中考试」，点了开那门课 */
function NextExam(props: { c: WCtx }) {
  const t = useT()
  const { files } = useVaultFiles()
  const courses = useMemo(() => files.filter((f) => f.kind === 'dir' && isChildOf(f.path, '课程')).map((f) => f.path), [files])
  const [next, setNext] = useState<{ folder: string; days: number; label: string; date: Date } | null | undefined>(undefined)
  useEffect(() => {
    let stale = false
    void Promise.all(courses.map((f) => window.cnFolder.get(f).then((r) => ({ f, ws: Object.values(r.home.widgets) })))).then((all) => {
      if (stale) return
      const today = new Date(new Date().toDateString()).getTime()
      let best: { folder: string; days: number; label: string; date: Date } | null = null
      for (const { f, ws } of all)
        for (const w of ws) {
          if (w.type !== 'exam' || !w.date) continue
          const d = new Date(`${w.date}T00:00`)
          const days = Math.round((d.getTime() - today) / 86400_000)
          if (!Number.isFinite(days) || days < 0) continue
          if (!best || days < best.days) best = { folder: f, days, label: w.label || tNow('考试'), date: d }
        }
      setNext(best)
    })
    return () => {
      stale = true
    }
  }, [courses])
  if (next === undefined) return null
  if (!next) return <p className="fw-empty">{t(EMPTY.exams!)}</p>
  return (
    <div className="fw-exam">
      <button className="fw-exam-n" onClick={() => openFolderHome(next.folder)} title={t('点一下开那门课')}>
        <span className="big num">{next.days}</span>
        {/* n 只给英文分单复数；course 是那门课的文件夹名（课程/ 下面那一层） */}
        <small>{t('天 · {course}{label}', { n: next.days, course: next.folder.split('/')[1], label: next.label })}</small>
        <span className="sub">{t('{date} · 星期{w}', { date: dateText(next.date.getTime()), w: t(WEEK[next.date.getDay()]!, { ctx: '星期' }) })}</span>
      </button>
    </div>
  )
}

/** 课件进度的头上右端：「接着读 Lecture05 · 第 10 页 ›」（最近没读完的那份） */
export function SlidesResume(props: { c: WCtx }) {
  const { c } = props
  const t = useT()
  const resume = slidesOf(c)
    .filter((f) => slideAt(f) > 0 && !slideDone(f))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!resume) return null
  return (
    <button className="fw-resume" onClick={() => c.onOpenAt(resume.path, slideAt(resume))} onContextMenu={(e) => onFileMenu(e, resume.path)}>
      {t('接着读{name} · 第{page}页', { name: slideStem(resume.path), page: slideAt(resume) })}
      <Codicon name="chevron-right" size={12} />
    </button>
  )
}

// 不翻：键，画的地方翻（星期::一）
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** 考试倒计时：宋体大数字「23 天后期中考试」、日期；分隔线下「下次上课」。没填日期时点那句话就能填 */
function Exam(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const { w } = props
  const t = useT()
  const [edit, setEdit] = useState(false)
  const d = w.date ? new Date(`${w.date}T00:00`) : null
  const days = d && Number.isFinite(d.getTime()) ? Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86400_000) : null
  if (edit)
    return (
      <form
        className="fw-exam-edit"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          props.set({ date: String(f.get('date') ?? ''), label: String(f.get('label') ?? '').trim() || undefined, next: String(f.get('next') ?? '').trim() || undefined })
          setEdit(false)
        }}
      >
        <input name="date" type="date" aria-label={t('考试日期')} defaultValue={w.date ?? ''} autoFocus />
        <input name="label" aria-label={t('叫什么')} placeholder={t('期中考试')} defaultValue={w.label ?? ''} />
        <input name="next" aria-label={t('下次上课')} placeholder={t('下次上课 周二 10:15 · 数学楼HS 2')} defaultValue={w.next ?? ''} />
        <button className="btn btn-xs" type="submit">
          {t('好了')}
        </button>
      </form>
    )
  return (
    <div className="fw-exam">
      {days === null ? (
        <button className="fw-empty fw-link" onClick={() => setEdit(true)}>
          {t(EMPTY.exam!)}
        </button>
      ) : (
        <button className="fw-exam-n" onClick={() => setEdit(true)} title={t('点一下改日期')}>
          <span className="big num">{Math.max(0, days)}</span>
          {/* n 只给英文分单复数 */}
          <small>{days < 0 ? t('天前{label}', { n: Math.max(0, days), label: w.label || t('考试') }) : t('天后{label}', { n: Math.max(0, days), label: w.label || t('考试') })}</small>
          <span className="sub">
            {t('{date} · 星期{w}', { date: dateText(d!.getTime()), w: t(WEEK[d!.getDay()]!, { ctx: '星期' }) })}
          </span>
        </button>
      )}
      {w.next && <div className="fw-next">{w.next}</div>}
    </div>
  )
}

/**
 * 读PDF时问过的（2026-11-22 从「我的疑惑」改名，task-tz7y3，原型 proto.html#dir=b 的 courseMid）：「最近问的 · 第 N 讲」3 问（问题 + 送过的 ✓ + 页码，点了翻到那一页），
 * 每讲一颗「第5讲 6问」（点了开那份 PDF、笔记栏「只看我问的」），底下「8问 · 6问已在Anki」和「出卡 · 没送的2问」。直接读各篇笔记（别把上万条全铺开：只露 3 问）
 */
function Asked(props: { c: WCtx; list: CardItem[] }) {
  const { c } = props
  const t = useT()
  const sides = usePrefs((s) => s.pdf.ankiSides)
  const lec = (d: CardItem) => d.lecture ?? 0
  const last = Math.max(...props.list.map(lec))
  const recent = props.list.filter((d) => lec(d) === last).reverse()
  const byLec = new Map<number, { n: number; pdf: string }>()
  for (const d of props.list) if (lec(d)) byLec.set(lec(d), { n: (byLec.get(lec(d))?.n ?? 0) + 1, pdf: byLec.get(lec(d))?.pdf ?? d.pdf })
  const sent = props.list.filter((d) => d.sent).length
  const un = unsentOf({ label: '', by: '', items: props.list }, sides).length
  return (
    <>
      {last > 0 && <div className="fw-sub">{t('最近问的 · 第{n}讲', { n: last })}</div>}
      {recent.slice(0, 3).map((d) => (
        <button key={d.id} className="fw-row" onClick={() => c.onOpenAt(d.pdf, d.page)}>
          <Codicon name={d.quote !== undefined ? 'comment-discussion' : 'comment'} size={14} />
          <span className="truncate">{d.question}</span>
          <span className="r num">
            {d.sent && <Codicon name="check" size={12} className="ok" />}
            {t('第{n}页', { n: d.page })}
          </span>
        </button>
      ))}
      {byLec.size > 0 && (
        <div className="fw-chips">
          {[...byLec].sort((a, b) => b[0] - a[0]).map(([l, x]) => (
            <button key={l} className="chip num" onClick={() => c.onAsked(x.pdf)}>
              {t('第{l}讲 {n}问', { l, n: x.n })}
            </button>
          ))}
        </div>
      )}
      <div className="fw-foot">
        <span className="num">{sent ? t('{n}问 · {sent}问已在Anki', { n: props.list.length, sent }) : t('{n}问 · 都还没出卡', { n: props.list.length })}</span>
        <span className="sp" />
        <button className="btn btn-xs btn-primary" disabled={!un} onClick={c.onCards}>
          <AiIcon job="cards" size={14} />
          {un ? t('出卡 · 没送的{n}问', { n: un }) : t('都出过卡了')}
        </button>
      </div>
    </>
  )
}

/**
 * 费曼（③ feynman-after，task-yvabi，teaching.md 3.4）：一行数「核心知识点 12个 · 过 5 · 差一点 2 · 没过 1 · 没讲过 4」，
 * 「下次先讲」一个（点了打开那块白板开讲那一个点），每讲一颗「第1讲 3/5」；一讲的点都讲过了提醒串讲一次（偏好「隔几讲一次费曼」）。
 * 不另存文件：从这门课各篇里每一节的费曼注释读（① 的 courseSummary）；考试日期用这页「考试倒计时」填的。
 */
function Feynman({ c }: { c: WCtx }) {
  const t = useT()
  const exam = Object.values(c.home.widgets).find((w) => w.type === 'exam' && w.date)?.date
  // 这门课里有文件改了（讲完一轮、判过）就重读
  const sig = useMemo(() => c.files.reduce((m, f) => Math.max(m, f.mtimeMs), 0), [c.files])
  const [s, setS] = useState<CourseSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    window.cnFeynman.course(c.folder, today, exam).then(
      (v) => !stale && (setS(v), setErr(null)),
      (e) => !stale && setErr(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')),
    )
    return () => {
      stale = true
    }
  }, [c.folder, exam, sig])
  if (err) return <p className="fw-empty">{err}</p>
  if (!s) return null
  if (!s.total) return <p className="fw-empty">{t(EMPTY.feynman!)}</p>
  const why: Record<NonNullable<CourseSummary['next']>['why'], string> = {
    fail: t('上次没过，隔了一天'),
    almost: t('上次差一点，隔了三天'),
    new: t('学过了，还没讲过'),
    due: t('过了一阵，到期再讲一次'),
    exam: t('考前两周，按章串讲一遍'),
  }
  const start = (o: { path: string; topic: string; id?: string; scope?: 'point' | 'section' | 'chapter'; lecture?: number }) => {
    void startNext({ path: o.path, topic: o.topic, ...(o.id ? { roundId: o.id } : {}), scope: o.scope ?? 'point', ...(o.lecture ? { lecture: o.lecture } : {}) }, c.onOpen).catch((e) =>
      setErr(String((e as Error).message ?? e)),
    )
  }
  const chainAt = s.chain !== null ? s.topics.find((x) => x.lecture === s.chain) : undefined
  return (
    <div>
      <div className="fw-fey num" data-testid="fw-feynman-count">
        {t('核心知识点{n}个', { n: s.total })}
        {(
          [
            ['pass', t('过{n}', { n: s.pass }), s.pass],
            ['almost', t('差一点{n}', { n: s.almost }), s.almost],
            ['fail', t('没过{n}', { n: s.fail }), s.fail],
            ['none', t('没讲过{n}', { n: s.never }), s.never],
          ] as const
        ).map(([k, label, n]) => (
          <span key={k}>
            {/* 数是 0 的小点灰着：红点只给真有没过的 */}
            <i className={'fd fs-' + (n ? k : 'zero')} />
            {label}
          </span>
        ))}
      </div>
      {s.next && (
        <button className="fw-row fw-fey-next" data-testid="fw-feynman-next" onClick={() => start({ path: s.next!.path, topic: s.next!.topic, id: s.next!.id, ...(s.next!.why === 'exam' ? { scope: 'chapter' } : {}) })}>
          <Codicon name="mortar-board" size={14} />
          <span className="truncate">{t('下次先讲：{topic}', { topic: s.next.topic })}</span>
          <span className="r">{why[s.next.why]}</span>
        </button>
      )}
      {s.lectures.some((l) => l.lecture !== null) && (
        <div className="fw-chips">
          {s.lectures
            .filter((l) => l.lecture !== null)
            .map((l) => (
              <span key={l.lecture} className="chip num">
                {t('第{l}讲 {pass}/{total}', { l: l.lecture!, pass: l.pass, total: l.total })}
              </span>
            ))}
        </div>
      )}
      {s.chain !== null && chainAt && (
        <div className="fw-foot">
          <span>{t('第{l}讲的点都讲过了，串讲一次：每个点一句话，再讲点和点的关系', { l: s.chain })}</span>
          <span className="sp" />
          <button className="btn btn-xs" data-testid="fw-feynman-chain" onClick={() => start({ path: chainAt.path, topic: t('第{l}讲', { l: s.chain! }), scope: 'section', lecture: s.chain! })}>
            {t('串讲这一讲')}
          </button>
        </div>
      )}
    </div>
  )
}

/** 今天要复习（task-tz7y3）：这门课送进去过，写新卡、今天到期几张（从 Anki 读，Anki 没开写送进去几张）和「打开Anki」；没送过说在哪出卡 */
function Review({ c }: { c: WCtx }) {
  const t = useT()
  const r = c.review
  if (!r || !r.sent) return <p className="fw-empty">{t(EMPTY.review!)}</p>
  return (
    <>
      <div className="due">
        <div>
          <b className="num">{r.connected ? String(r.newCards ?? 0) : '–'}</b>
          <span>{t('新卡')}</span>
        </div>
        <div>
          <b className="num">{r.connected ? String(r.due ?? 0) : '–'}</b>
          <span>{t('今天到期')}</span>
        </div>
      </div>
      <p className="fw-empty">{r.connected ? t('牌组「{deck}」里的卡。数从Anki读，复习在Anki里做。', { deck: r.deck }) : t('{n}张在牌组「{deck}」里。Anki没开着，开了这里写今天到期几张。', { n: r.sent, deck: r.deck })}</p>
      <div className="fw-foot">
        <span className="sp" />
        <button className="btn btn-xs" onClick={c.onOpenAnki}>
          <Codicon name="link-external" size={14} />
          {t('打开Anki')}
        </button>
      </div>
    </>
  )
}

/** 可视化：缩略图墙，每张 120 宽、70 高 + 名字 + 第几讲；最多一行 */
function Viz(props: { c: WCtx; list: PropFile[] }) {
  const { c } = props
  const t = useT()
  return (
    <>
      <div className="fw-thumbs">
        {props.list.slice(0, 4).map((f) => (
          <button key={f.path} className="fw-thumb" onClick={() => c.onOpen(f.path)} {...item(c, f.path)}>
            <span className="tv">
              <Codicon name="file-code" size={20} />
            </span>
            <span className="tn">
              <span className="truncate">{titleOf(f.path).replace(/\.html?$/i, '')}</span>
              {/* 不翻：属性键、属性值照文件里的写 */}
              {f.props['第几讲'] && <small>{t('第{n}讲', { n: f.props['第几讲'] })}</small>}
            </span>
          </button>
        ))}
      </div>
      <More n={props.list.length} shown={4} text={t('全部{n}个 · 打开列表看', { n: props.list.length })} onAll={c.onAll} />
    </>
  )
}

/** 笔记和导图的组件头右边：拍一张 */
export function CaptureAction(props: { onCapture(): void }) {
  const t = useT()
  return (
    <button className="btn btn-xs fw-act" onClick={props.onCapture}>
      <Codicon name="device-camera" size={12} />
      {t('拍一张')}
    </button>
  )
}

function Links(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const t = useT()
  const links = props.w.links ?? []
  const [adding, setAdding] = useState(false)
  const [n, setN] = useState('')
  const [u, setU] = useState('')
  return (
    <div className="fw-links">
      {links.length === 0 && !adding && <p className="fw-empty">{t(EMPTY.links!)}</p>}
      {links.slice(0, 5).map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
          <Codicon name="globe" size={14} />
          <span className="truncate">{l.name}</span>
        </a>
      ))}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const url = /^(https?:|mailto:)/.test(u.trim()) ? u.trim() : `https://${u.trim()}`
            if (n.trim() && u.trim()) props.set({ links: [...links, { name: n.trim(), url }] })
            setAdding(false)
            setN('')
            setU('')
          }}
        >
          <input aria-label={t('链接名字')} placeholder={t('名字')} value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          <input aria-label={t('网址')} placeholder={t('网址')} value={u} onChange={(e) => setU(e.target.value)} />
          <button className="btn btn-xs" type="submit">
            {t('加上')}
          </button>
        </form>
      ) : (
        <button className="fw-more" onClick={() => setAdding(true)}>
          <Codicon name="add" size={12} />
          {t('加一个链接')}
        </button>
      )}
    </div>
  )
}

function FreeText(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const t = useT()
  const [edit, setEdit] = useState(false)
  if (edit)
    return (
      <textarea
        className="fw-text-edit"
        aria-label={t('自由文本')}
        defaultValue={props.w.text ?? ''}
        autoFocus
        onBlur={(e) => {
          setEdit(false)
          props.set({ text: e.currentTarget.value })
        }}
      />
    )
  return (
    <button className="fw-text" onClick={() => setEdit(true)}>
      {props.w.text ? props.w.text : <span className="fw-empty">{t(EMPTY.text!)}</span>}
    </button>
  )
}

/** 学习日历 / 日历：每天这个文件夹里动过几个文件；今天一圈紫色 */
function Calendar(props: { c: WCtx; files: PropFile[]; weeks: number }) {
  const days = new Map<string, number>()
  for (const f of props.files) {
    const k = new Date(f.mtimeMs).toDateString()
    days.set(k, (days.get(k) ?? 0) + 1)
  }
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) - (props.weeks - 1) * 7)
  const cells = Array.from({ length: props.weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  return (
    <div className="fw-cal" style={{ gridTemplateColumns: `repeat(${props.weeks}, 12px)` }}>
      {cells.map((d) => {
        const n = days.get(d.toDateString()) ?? 0
        return <i key={d.toDateString()} title={`${dateText(d.getTime())} · ${n}`} className={(d.toDateString() === today.toDateString() ? 'today ' : '') + (d > today ? 'fut' : '')} style={{ background: `var(--w${Math.min(4, n)})` }} />
      })}
    </div>
  )
}

/** 表格「改过」一列：今天、昨天、3 天前、上周、3 周前、几个月前 */
export function ago(ms: number, now = Date.now()): string {
  const d = Math.floor((new Date(now).setHours(24, 0, 0, 0) - ms) / 86400_000)
  if (d <= 0) return tNow('今天')
  if (d === 1) return tNow('昨天')
  if (d < 7) return tNow('{n}天前', { n: d })
  if (d < 14) return tNow('上周')
  if (d < 60) return tNow('{n}周前', { n: Math.floor(d / 7) })
  return tNow('{n}个月前', { n: Math.floor(d / 30) })
}
