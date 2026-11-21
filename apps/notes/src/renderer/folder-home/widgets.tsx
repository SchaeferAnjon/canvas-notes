/**
 * 文件夹首页的各个组件（spec 9.5）。列表型的只露几条加「全部 N 份」（偏好「别把上万条全铺开」）。
 * 课件进度、我的疑惑、今天要复习的数据由 PDF 阅读和 Anki 那边写进属性；还没有时显示空状态的那句话。
 */
import { dateText, when } from '../../shared/when'
import { Codicon } from '@cn/design'
import { onFileMenu } from '../ctx/file-menu'
import { fileIcon } from '../Palette'
import { useEffect, useMemo, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { type Cond, type FolderHome, type PropFile, runCond, setWidget, type WidgetData } from '../../shared/folder-home'
import { progressDone } from '../../shared/files'
import { CLIPS, kindOf, titleOf } from '../../shared/layout'
import { useVaultFiles, vaultFiles } from '../files/store'
import { type DoubtItem, questionOf } from '@cn/format'
import { useCover } from './slide-covers'
import { openFolderHome } from './store'

export interface WCtx {
  folder: string
  files: PropFile[]
  notes: NoteFile[]
  /** 预览时挪进来的（新路径），标「新」 */
  fresh: Set<string>
  editing: boolean
  onOpen(path: string): void
  /** 打开 PDF 翻到那一页（我的疑惑） */
  onOpenAt(pdf: string, page: number): void
  /** 开这门课的我的疑惑页 */
  onDoubts(): void
  /** 这门课读 PDF 时问过的（PDF 那边汇总的） */
  doubts: DoubtItem[]
  /** 看视频时框一块问的有几处（文档里的问答块） */
  videoDoubts?: number
  onAll(): void
  onCapture(): void
  save(h: FolderHome): void
  home: FolderHome
  id: string
}

const EMPTY: Record<string, string> = {
  courses: '还没有课。左栏「课程」头上新建一门。',
  slides: '把PDF拖到这张卡上，就收进这门课；问到第几页也会记在这里。',
  review: 'Anki里还没有这门课的牌组。在「我的疑惑」里送一次就有了。',
  reviews: 'Anki里还没有这几门课的牌组。在每门课的「我的疑惑」里送一次就有了。',
  exams: '还没有哪门课填了考试日期。在那门课的首页点「考试倒计时」填。',
  exam: '还没填考试日期。点一下填。',
  notes: '还没有笔记和导图。读课件时问AI，笔记会自己写好放进来。',
  doubts: '还没有疑惑。读课件时问过的都会记在这里。',
  viz: '还没有可视化。问AI时点「做个可视化」，做好的放这里。',
  todo: '没有待办。',
  links: '还没有链接。',
  board: '还没选白板。',
  text: '写点这门课的信息：老师、教室、考试范围。',
  recent: '这里还没动过东西。',
  progress: '还没定阶段。',
  drafts: '没有草稿。',
  clips: '还没有剪藏。',
  list: '没有符合条件的文件。改一改条件，或者等这个文件夹里多一些东西。',
}

const name = (p: string) => titleOf(p)
const More = (p: { n: number; shown: number; unit: string; onAll(): void }) =>
  p.n > p.shown ? (
    <button className="fw-more" onClick={p.onAll}>
      {`全部${p.n}${p.unit} · 打开列表看`}
    </button>
  ) : null

function Rows(props: { c: WCtx; list: PropFile[]; limit: number; right?(f: PropFile): string }) {
  const { c } = props
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
        <button key={f.path} className="fw-row" onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
          {boardColor.has(f.path) ? <i className="sw" style={{ background: boardColor.get(f.path) }} /> : <Codicon name={f.entry ? 'database' : /\.pdf$/i.test(f.path) ? 'file-pdf' : f.props['类型'] === '导图' ? 'type-hierarchy' : fileIcon(f.path, false, digests.has(f.path))} size={14} />}
          <span className="truncate">{name(f.path)}</span>
          {/* 数据库的一条写表名（和左栏「最近」一样）；同名的几篇写在哪个子文件夹 */}
          {f.entry ? (
            <span className="fw-in truncate">{f.path.slice(0, f.path.lastIndexOf('/')).split('/').pop()}</span>
          ) : (
            dup.has(name(f.path)) && sub(f.path) && <span className="fw-in truncate">{sub(f.path)}</span>
          )}
          {c.fresh.has(f.path) && <span className="tag-new">新</span>}
          <span className="r num">{props.right?.(f) ?? ''}</span>
        </button>
      ))}
      <More n={props.list.length} shown={props.limit} unit="篇" onAll={c.onAll} />
    </>
  )
}

export function condResult(c: WCtx, cond: Cond): PropFile[] {
  return runCond(cond.scope === 'folder' ? c.files.filter((f) => f.path.startsWith(c.folder + '/')) : c.files, cond)
}

export function CondBody(props: { c: WCtx; cond: Cond }) {
  const { c, cond } = props
  const list = condResult(c, cond)
  if (!list.length) return <p className="fw-empty">{EMPTY[c.home.widgets[c.id]!.type] ?? EMPTY.list}</p>
  const right = (f: PropFile) => (f.props['第几讲'] ? `第${f.props['第几讲']}讲` : '')
  if (cond.view === 'cards')
    return (
      <div className="fw-cards">
        {list.slice(0, cond.limit).map((f) => (
          <button key={f.path} onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
            <b className="truncate">{name(f.path)}</b>
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
            <th>名字</th>
            <th>类型</th>
            <th>第几讲</th>
            <th>改过</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, cond.limit).map((f) => (
            <tr key={f.path} onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
              <td className="truncate">{name(f.path)}</td>
              <td>{f.props['类型'] ?? ''}</td>
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
  const inFolder = c.files.filter((f) => f.path.startsWith(c.folder + '/'))
  const set = (patch: Partial<WidgetData>) => c.save(setWidget(c.home, c.id, patch))
  switch (w.type) {
    case 'notes':
    case 'drafts':
    case 'list':
      return <CondBody c={c} cond={w.cond!} />
    case 'slides': {
      const list = slidesOf(c)
      if (!list.length) return <p className="fw-empty">{EMPTY.slides}</p>
      return <Slides c={c} list={list} />
    }
    case 'doubts':
      return c.doubts.length || c.videoDoubts ? <Doubts c={c} list={c.doubts} videos={c.videoDoubts ?? 0} /> : <p className="fw-empty">{EMPTY.doubts}</p>
    case 'viz': {
      const list = inFolder.filter((f) => f.props['类型'] === '可视化')
      return list.length ? <Viz c={c} list={list} /> : <p className="fw-empty">{EMPTY.viz}</p>
    }
    case 'courses':
      return <Courses c={c} />
    case 'review':
      return <p className="fw-empty">{c.folder === '课程' ? EMPTY.reviews : EMPTY.review}</p>
    case 'exam':
      // 「课程」这一页：几门课里最近的那场考试
      return c.folder === '课程' ? <NextExam c={c} /> : <Exam w={w} set={set} />
    case 'todo':
      return <Todos c={c} w={w} set={set} />
    case 'links':
      return <Links w={w} set={set} />
    case 'text':
      return <FreeText w={w} set={set} />
    case 'recent':
      return inFolder.length ? <Rows c={c} list={inFolder} limit={4} right={(f) => when(f.mtimeMs)} /> : <p className="fw-empty">{EMPTY.recent}</p>
    case 'board': {
      const boards = c.notes.filter((n) => n.board && n.path.startsWith(c.folder + '/'))
      const b = boards.find((n) => n.path === w.board) ?? boards[0]
      return b ? (
        <button className="fw-board" onClick={() => c.onOpen(b.path)} onContextMenu={(e) => onFileMenu(e, b.path)}>
          <span className="fw-th" style={{ background: b.board!.color }} />
          <b>{titleOf(b.path)}</b>
          <span>{`白板 · ${b.board!.cards}张卡片`}</span>
        </button>
      ) : (
        <p className="fw-empty">{EMPTY.board}</p>
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
        <p className="fw-empty">{EMPTY.progress}</p>
      )
    case 'cal':
    case 'calendar':
      return <Calendar c={c} files={inFolder} weeks={w.type === 'cal' ? 20 : 5} />
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
          {list.slice(0, 5).map(([t, n]) => (
            // 一行是一个主题文件夹：文件夹图标，点了开那个文件夹的首页（没分主题的开「素材」）
            <button key={t} className="fw-row" onClick={() => openFolderHome(t === '未分主题' ? CLIPS : `${CLIPS}/${t}`)}>
              <Codicon name="folder" size={14} />
              <span className="truncate">{t}</span>
              <span className="r num">{`${n}篇`}</span>
            </button>
          ))}
          <More n={list.length} shown={5} unit="个主题" onAll={c.onAll} />
        </>
      ) : (
        <p className="fw-empty">{EMPTY.clips}</p>
      )
    }
  }
}

const slideAt = (f: PropFile) => Number(f.props['问到']) || 0
const slidePages = (f: PropFile) => Number(f.props['页数']) || 0
const slideDone = (f: PropFile) => slidePages(f) > 0 && slideAt(f) >= slidePages(f)
const slideStem = (p: string) => titleOf(p).replace(/\.pdf$/i, '')

/** 这门课的课件（按第几讲排） */
export function slidesOf(c: WCtx): PropFile[] {
  return c.files
    .filter((f) => f.path.startsWith(c.folder + '/') && f.props['类型'] === '课件')
    .sort((a, b) => (Number(a.props['第几讲']) || 0) - (Number(b.props['第几讲']) || 0) || a.path.localeCompare(b.path, 'zh'))
}

/**
 * 课件进度放不下时摆哪几份：刚拖进来的（标「新」）→ 正在读的（最近读的在前）→ 没开始的（按第几讲）→ 读完的（最近读完的在前），
 * 取前 max 份，再按第几讲排回去。拖进几份都看得见，不被名字排在前面的挤掉。
 */
export function pickSlides(list: PropFile[], max: number, fresh: Set<string>): PropFile[] {
  if (list.length <= max) return list
  const lecture = (f: PropFile) => Number(f.props['第几讲']) || 0
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
          <div className="fw-dropcell" data-testid="slides-dropcell" data-tip={`把PDF拖到这张卡上，就收进${course}`} data-side="below">
            <Codicon name="add" size={14} />
            <span>拖PDF</span>
          </div>
        )}
      </div>
      <More n={props.list.length} shown={shown.length} unit="份" onAll={c.onAll} />
    </>
  )
}

function SlideCover({ c, f }: { c: WCtx; f: PropFile }) {
  const url = useCover(f.path, f.mtimeMs)
  const at = slideAt(f)
  const pages = slidePages(f)
  const done = slideDone(f)
  return (
    <button className="fw-cover" data-testid="slide-cover" onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)} title={titleOf(f.path)}>
      <span className="cv">
        {url && url !== 'failed' ? <img src={url} alt={`${slideStem(f.path)} 第一页`} draggable={false} /> : <Codicon name="file-pdf" size={20} className={url === 'failed' ? 'bad' : 'wait'} />}
        <i className={'pg' + (done ? ' done' : '')} aria-hidden>
          <i style={{ width: `${done ? 100 : pages ? Math.min(100, (at / pages) * 100) : 0}%` }} />
        </i>
      </span>
      <span className="nm">
        <span className="truncate">{slideStem(f.path)}</span>
        {c.fresh.has(f.path) && <span className="tag-new">新</span>}
        <span className="r num">
          {done ? (
            <>
              <Codicon name="check" size={12} className="ok" />
              读完
            </>
          ) : at ? (
            `问到${at} / ${pages || '?'}页`
          ) : (
            '没开始'
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
  const { files } = useVaultFiles()
  const list = useMemo(() => {
    const courses = files.filter((f) => f.kind === 'dir' && f.path.startsWith('课程/') && !f.path.slice(3).includes('/')).map((f) => f.path)
    const prog = new Map<string, { done: number; total: number }>()
    for (const f of files) {
      if (f.kind !== 'pdf' || !f.path.startsWith('课程/')) continue
      const course = f.path.split('/').slice(0, 2).join('/')
      const p = prog.get(course) ?? { done: 0, total: 0 }
      p.total++
      if (progressDone(f.progress)) p.done++
      prog.set(course, p)
    }
    return courses.sort((a, b) => a.localeCompare(b, 'zh')).map((f) => ({ folder: f, ...(prog.get(f) ?? { done: 0, total: 0 }) }))
  }, [files])
  if (!list.length) return <p className="fw-empty">{EMPTY.courses}</p>
  return (
    <>
      {list.slice(0, 6).map((x) => (
        <button key={x.folder} className="fw-row fw-course" onClick={() => openFolderHome(x.folder)}>
          <Codicon name="folder-library" size={14} />
          <span className="truncate">{x.folder.slice(3)}</span>
          {x.total > 0 && (
            <>
              <i className="fw-bar" aria-hidden>
                <i style={{ width: `${(x.done / x.total) * 100}%` }} />
              </i>
              <span className="r num">{`${x.done}/${x.total}讲`}</span>
            </>
          )}
        </button>
      ))}
      <More n={list.length} shown={6} unit="门" onAll={props.c.onAll} />
    </>
  )
}

/** 「课程」这一页的考试倒计时：各门课首页里填的考试，挑最近的一场「23 天 · 机器学习 期中考试」，点了开那门课 */
function NextExam(props: { c: WCtx }) {
  const { files } = useVaultFiles()
  const courses = useMemo(() => files.filter((f) => f.kind === 'dir' && f.path.startsWith('课程/') && !f.path.slice(3).includes('/')).map((f) => f.path), [files])
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
          if (!best || days < best.days) best = { folder: f, days, label: w.label || '考试', date: d }
        }
      setNext(best)
    })
    return () => {
      stale = true
    }
  }, [courses])
  if (next === undefined) return null
  if (!next) return <p className="fw-empty">{EMPTY.exams}</p>
  return (
    <div className="fw-exam">
      <button className="fw-exam-n" onClick={() => openFolderHome(next.folder)} title="点一下开那门课">
        <span className="big num">{next.days}</span>
        <small>{`天 · ${next.folder.slice(3)}${next.label}`}</small>
        <span className="sub">{`${dateText(next.date.getTime())} · 星期${WEEK[next.date.getDay()]}`}</span>
      </button>
    </div>
  )
}

/** 课件进度的头上右端：「接着读 Lecture05 · 第 10 页 ›」（最近没读完的那份） */
export function SlidesResume(props: { c: WCtx }) {
  const { c } = props
  const resume = slidesOf(c)
    .filter((f) => slideAt(f) > 0 && !slideDone(f))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!resume) return null
  return (
    <button className="fw-resume" onClick={() => c.onOpenAt(resume.path, slideAt(resume))} onContextMenu={(e) => onFileMenu(e, resume.path)}>
      {`接着读${slideStem(resume.path)} · 第${slideAt(resume)}页`}
      <Codicon name="chevron-right" size={12} />
    </button>
  )
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** 考试倒计时：宋体大数字「23 天后期中考试」、日期；分隔线下「下次上课」。没填日期时点那句话就能填 */
function Exam(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const { w } = props
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
        <input name="date" type="date" aria-label="考试日期" defaultValue={w.date ?? ''} autoFocus />
        <input name="label" aria-label="叫什么" placeholder="期中考试" defaultValue={w.label ?? ''} />
        <input name="next" aria-label="下次上课" placeholder="下次上课 周二 10:15 · 数学楼HS 2" defaultValue={w.next ?? ''} />
        <button className="btn btn-xs" type="submit">
          好了
        </button>
      </form>
    )
  return (
    <div className="fw-exam">
      {days === null ? (
        <button className="fw-empty fw-link" onClick={() => setEdit(true)}>
          {EMPTY.exam}
        </button>
      ) : (
        <button className="fw-exam-n" onClick={() => setEdit(true)} title="点一下改日期">
          <span className="big num">{Math.max(0, days)}</span>
          <small>{days < 0 ? `天前${w.label || '考试'}` : `天后${w.label || '考试'}`}</small>
          <span className="sub">
            {`${dateText(d!.getTime())} · 星期${WEEK[d!.getDay()]}`}
          </span>
        </button>
      )}
      {w.next && <div className="fw-next">{w.next}</div>}
    </div>
  )
}

/**
 * 我的疑惑：读 PDF 时问过的（PDF 那边按讲汇总的同一份清单）。「最近问的 · 第 N 讲」3 条（问题 + 页码，点了翻到那一页），
 * 下面每讲一颗 chip（看视频时问的另一颗「视频 N」），再多一句「全部 N 条」开我的疑惑页。直接读各篇笔记和文档（2026-11-20 起没有「我的疑惑.md」）
 */
function Doubts(props: { c: WCtx; list: DoubtItem[]; videos: number }) {
  const { c } = props
  const lec = (d: DoubtItem) => d.lecture ?? 0
  const last = Math.max(...props.list.map(lec))
  const recent = props.list.filter((d) => lec(d) === last).reverse()
  const byLec = new Map<number, number>()
  for (const d of props.list) if (lec(d)) byLec.set(lec(d), (byLec.get(lec(d)) ?? 0) + 1)
  return (
    <>
      {last > 0 && <div className="fw-sub">{`最近问的 · 第${last}讲`}</div>}
      {recent.slice(0, 3).map((d) => (
        <button key={d.id} className="fw-row" onClick={() => c.onOpenAt(d.pdf, d.section.page)}>
          <Codicon name="question" size={14} />
          <span className="truncate">{questionOf(d.section)}</span>
          <span className="r num">{`第${d.section.page}页`}</span>
        </button>
      ))}
      {(byLec.size > 0 || props.videos > 0) && (
        <div className="fw-chips">
          {[...byLec].sort((a, b) => b[0] - a[0]).map(([l, n]) => (
            <span key={l} className="chip num">
              {`第${l}讲${n}`}
            </span>
          ))}
          {props.videos > 0 && <span className="chip num">{`视频${props.videos}`}</span>}
        </div>
      )}
      {props.list.length + props.videos > 3 && (
        <button className="fw-more" onClick={c.onDoubts}>
          {`全部${props.list.length + props.videos}条 · 打开列表看`}
        </button>
      )}
    </>
  )
}

/** 可视化：缩略图墙，每张 120 宽、70 高 + 名字 + 第几讲；最多一行 */
function Viz(props: { c: WCtx; list: PropFile[] }) {
  const { c } = props
  return (
    <>
      <div className="fw-thumbs">
        {props.list.slice(0, 4).map((f) => (
          <button key={f.path} className="fw-thumb" onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
            <span className="tv">
              <Codicon name="file-code" size={20} />
            </span>
            <span className="tn">
              <span className="truncate">{titleOf(f.path).replace(/\.html?$/i, '')}</span>
              {f.props['第几讲'] && <small>{`第${f.props['第几讲']}讲`}</small>}
            </span>
          </button>
        ))}
      </div>
      <More n={props.list.length} shown={4} unit="个" onAll={c.onAll} />
    </>
  )
}

/** 笔记和导图的组件头右边：拍一张 */
export function CaptureAction(props: { onCapture(): void }) {
  return (
    <button className="btn btn-xs fw-act" onClick={props.onCapture}>
      <Codicon name="device-camera" size={12} />
      拍一张
    </button>
  )
}

function Todos(props: { c: WCtx; w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const todos = props.w.todos ?? []
  const [v, setV] = useState('')
  const open = todos.filter((t) => !t.startsWith('[x]'))
  return (
    <div className="fw-todo">
      {todos.length === 0 && <p className="fw-empty">{EMPTY.todo}</p>}
      {[...open, ...todos.filter((t) => t.startsWith('[x]'))].slice(0, 5).map((t) => {
        const done = t.startsWith('[x]')
        const text = t.replace(/^\[x\]\s*/, '')
        return (
          <label key={t} className={done ? 'done' : ''}>
            <input type="checkbox" checked={done} onChange={() => props.set({ todos: todos.map((x) => (x === t ? (done ? text : `[x] ${text}`) : x)) })} />
            <span>{text}</span>
          </label>
        )
      })}
      {open.length > 5 && <p className="fw-more-t">{`还有${open.length - 5}条`}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (v.trim()) props.set({ todos: [...todos, v.trim()] })
          setV('')
        }}
      >
        <Codicon name="add" size={12} />
        <input aria-label="加一条待办" placeholder="加一条" value={v} onChange={(e) => setV(e.target.value)} />
      </form>
    </div>
  )
}

function Links(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const links = props.w.links ?? []
  const [adding, setAdding] = useState(false)
  const [n, setN] = useState('')
  const [u, setU] = useState('')
  return (
    <div className="fw-links">
      {links.length === 0 && !adding && <p className="fw-empty">{EMPTY.links}</p>}
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
          <input aria-label="链接名字" placeholder="名字" value={n} onChange={(e) => setN(e.target.value)} autoFocus />
          <input aria-label="网址" placeholder="网址" value={u} onChange={(e) => setU(e.target.value)} />
          <button className="btn btn-xs" type="submit">
            加上
          </button>
        </form>
      ) : (
        <button className="fw-more" onClick={() => setAdding(true)}>
          <Codicon name="add" size={12} />
          加一个链接
        </button>
      )}
    </div>
  )
}

function FreeText(props: { w: WidgetData; set(p: Partial<WidgetData>): void }) {
  const [edit, setEdit] = useState(false)
  if (edit)
    return (
      <textarea
        className="fw-text-edit"
        aria-label="自由文本"
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
      {props.w.text ? props.w.text : <span className="fw-empty">{EMPTY.text}</span>}
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
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 7) return `${d}天前`
  if (d < 14) return '上周'
  if (d < 60) return `${Math.floor(d / 7)}周前`
  return `${Math.floor(d / 30)}个月前`
}
