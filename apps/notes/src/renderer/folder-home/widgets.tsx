/**
 * 文件夹首页的各个组件（spec 9.5）。列表型的只露几条加「全部 N 份」（偏好「别把上万条全铺开」）。
 * 课件进度、我的疑惑、今天要复习的数据由 PDF 阅读和 Anki 那边写进属性；还没有时显示空状态的那句话。
 */
import { Codicon } from '@cn/design'
import { onFileMenu } from '../ctx/file-menu'
import { useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { type Cond, type FolderHome, type PropFile, runCond, setWidget, type WidgetData } from '../../shared/folder-home'
import { titleOf } from '../../shared/layout'
import { type DoubtItem, questionOf } from '@cn/format'

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
  onAll(): void
  onCapture(): void
  save(h: FolderHome): void
  home: FolderHome
  id: string
}

const EMPTY: Record<string, string> = {
  slides: '还没有课件。把 PDF 拖进这个文件夹，就会列在这里，问到第几页也会记上。',
  review: 'Anki 里还没有这门课的牌组。在「我的疑惑」里送一次就有了。',
  exam: '还没填考试日期。点一下填。',
  notes: '还没有笔记和导图。读课件时问 AI，笔记会自己写好放进来。',
  doubts: '还没有疑惑。读课件时问过的都会记在这里。',
  viz: '还没有可视化。问 AI 时点「做个可视化」，做好的放这里。',
  todo: '没有待办。',
  links: '还没有链接。',
  board: '还没选白板。',
  text: '写点这门课的信息：老师、教室、考试范围。',
  recent: '这里还没动过东西。',
  progress: '还没定阶段。',
  drafts: '没有草稿。',
  clips: '还没有素材。',
  list: '没有符合条件的文件。改一改条件，或者等这个文件夹里多一些东西。',
}

const name = (p: string) => titleOf(p)
const More = (p: { n: number; shown: number; unit: string; onAll(): void }) =>
  p.n > p.shown ? (
    <button className="fw-more" onClick={p.onAll}>
      全部 {p.n} {p.unit} · 打开列表看
    </button>
  ) : null

function Rows(props: { c: WCtx; list: PropFile[]; limit: number; right?(f: PropFile): string }) {
  const { c } = props
  return (
    <>
      {props.list.slice(0, props.limit).map((f) => (
        <button key={f.path} className="fw-row" onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
          <Codicon name={f.props['类型'] === '导图' ? 'type-hierarchy' : 'file-text'} size={14} />
          <span className="truncate">{name(f.path)}</span>
          {c.fresh.has(f.path) && <span className="tag-new">新</span>}
          <span className="r num">{props.right?.(f) ?? ''}</span>
        </button>
      ))}
      <More n={props.list.length} shown={props.limit} unit="份" onAll={c.onAll} />
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
  const right = (f: PropFile) => (f.props['第几讲'] ? `第 ${f.props['第几讲']} 讲` : '')
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
      const list = inFolder.filter((f) => f.props['类型'] === '课件').sort((a, b) => (Number(a.props['第几讲']) || 0) - (Number(b.props['第几讲']) || 0))
      if (!list.length) return <p className="fw-empty">{EMPTY.slides}</p>
      return <Slides c={c} list={list} />
    }
    case 'doubts':
      return c.doubts.length ? <Doubts c={c} list={c.doubts} /> : <p className="fw-empty">{EMPTY.doubts}</p>
    case 'viz': {
      const list = inFolder.filter((f) => f.props['类型'] === '可视化')
      return list.length ? <Viz c={c} list={list} /> : <p className="fw-empty">{EMPTY.viz}</p>
    }
    case 'review':
      return <p className="fw-empty">{EMPTY.review}</p>
    case 'exam':
      return <Exam w={w} set={set} />
    case 'todo':
      return <Todos c={c} w={w} set={set} />
    case 'links':
      return <Links w={w} set={set} />
    case 'text':
      return <FreeText w={w} set={set} />
    case 'recent':
      return inFolder.length ? <Rows c={c} list={inFolder} limit={5} right={(f) => when(f.mtimeMs)} /> : <p className="fw-empty">{EMPTY.recent}</p>
    case 'board': {
      const boards = c.notes.filter((n) => n.board && n.path.startsWith(c.folder + '/'))
      const b = boards.find((n) => n.path === w.board) ?? boards[0]
      return b ? (
        <button className="fw-board" onClick={() => c.onOpen(b.path)} onContextMenu={(e) => onFileMenu(e, b.path)}>
          <span className="th" style={{ background: b.board!.color }} />
          <b>{titleOf(b.path)}</b>
          <span>白板 · {b.board!.cards} 张卡片</span>
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
      const topics = new Map<string, number>()
      for (const n of c.notes) if (n.kind === 'clip') topics.set(n.topic!, (topics.get(n.topic!) ?? 0) + 1)
      const list = [...topics].sort((a, b) => b[1] - a[1])
      return list.length ? (
        <>
          {list.slice(0, 5).map(([t, n]) => (
            <div key={t} className="fw-row">
              <Codicon name="file-text" size={14} />
              <span className="truncate">{t}</span>
              <span className="r num">{n} 条</span>
            </div>
          ))}
          <More n={list.length} shown={5} unit="个主题" onAll={c.onAll} />
        </>
      ) : (
        <p className="fw-empty">{EMPTY.clips}</p>
      )
    }
  }
}

/**
 * 课件进度：每份 PDF 一行，名字 +「问到 7 / 10 页」或「读完」+ 72 宽进度条；底下「接着读」最近没读完的那份。
 * 问到第几页由 PDF 阅读写进属性「问到」「页数」；还没有就是「没开始」。多了只列没读完的和最近读完的 4 份。
 */
function Slides(props: { c: WCtx; list: PropFile[] }) {
  const { c } = props
  const at = (f: PropFile) => Number(f.props['问到']) || 0
  const pages = (f: PropFile) => Number(f.props['页数']) || 0
  const done = (f: PropFile) => pages(f) > 0 && at(f) >= pages(f)
  const lecture = (f: PropFile) => Number(f.props['第几讲']) || 0
  const shown =
    props.list.length <= 4
      ? props.list
      : [...props.list.filter((f) => !done(f)), ...props.list.filter(done).sort((a, b) => b.mtimeMs - a.mtimeMs)].slice(0, 4).sort((a, b) => lecture(a) - lecture(b))
  const resume = props.list.filter((f) => at(f) > 0 && !done(f)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  const stem = (p: string) => titleOf(p).replace(/\.pdf$/i, '')
  return (
    <>
      {shown.map((f) => (
        <button key={f.path} className="fw-row" onClick={() => c.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)}>
          <Codicon name="file-text" size={14} />
          <span className="truncate">{stem(f.path)}</span>
          {c.fresh.has(f.path) && <span className="tag-new">新</span>}
          <span className="r num">
            {done(f) ? (
              <>
                <Codicon name="check" size={12} className="ok" />
                读完
              </>
            ) : at(f) ? (
              `问到 ${at(f)} / ${pages(f) || '?'} 页`
            ) : (
              '没开始'
            )}
          </span>
          <i className="fw-bar" aria-hidden>
            <i style={{ width: `${pages(f) ? Math.min(100, (at(f) / pages(f)) * 100) : 0}%` }} />
          </i>
        </button>
      ))}
      <More n={props.list.length} shown={shown.length} unit="份" onAll={c.onAll} />
      {resume && (
        <button className="btn btn-xs fw-resume" onClick={() => c.onOpen(resume.path)} onContextMenu={(e) => onFileMenu(e, resume.path)}>
          <Codicon name="file-text" size={12} />
          接着读 {stem(resume.path)} 第 {at(resume)} 页
        </button>
      )}
    </>
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
        <input name="next" aria-label="下次上课" placeholder="下次上课 周二 10:15 · 数学楼 HS 2" defaultValue={w.next ?? ''} />
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
            {d!.getMonth() + 1} 月 {d!.getDate()} 日 星期{WEEK[d!.getDay()]}
          </span>
        </button>
      )}
      {w.next && <div className="fw-next">{w.next}</div>}
    </div>
  )
}

/**
 * 我的疑惑：读 PDF 时问过的（PDF 那边按讲汇总的同一份清单）。「最近问的 · 第 N 讲」3 条（问题 + 页码，点了翻到那一页），
 * 下面每讲一颗 chip，再多一句「全部 N 条」开我的疑惑页
 */
function Doubts(props: { c: WCtx; list: DoubtItem[] }) {
  const { c } = props
  const lec = (d: DoubtItem) => d.lecture ?? 0
  const last = Math.max(...props.list.map(lec))
  const recent = props.list.filter((d) => lec(d) === last).reverse()
  const byLec = new Map<number, number>()
  for (const d of props.list) if (lec(d)) byLec.set(lec(d), (byLec.get(lec(d)) ?? 0) + 1)
  return (
    <>
      {last > 0 && <div className="fw-sub">最近问的 · 第 {last} 讲</div>}
      {recent.slice(0, 3).map((d) => (
        <button key={d.id} className="fw-row" onClick={() => c.onOpenAt(d.pdf, d.section.page)}>
          <Codicon name="question" size={14} />
          <span className="truncate">{questionOf(d.section)}</span>
          <span className="r num">第 {d.section.page} 页</span>
        </button>
      ))}
      {byLec.size > 0 && (
        <div className="fw-chips">
          {[...byLec].sort((a, b) => b[0] - a[0]).map(([l, n]) => (
            <span key={l} className="chip num">
              第 {l} 讲 {n}
            </span>
          ))}
        </div>
      )}
      {props.list.length > 3 && (
        <button className="fw-more" onClick={c.onDoubts}>
          全部 {props.list.length} 条 · 打开列表看
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
              {f.props['第几讲'] && <small>第 {f.props['第几讲']} 讲</small>}
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
      {open.length > 5 && <p className="fw-more-t">还有 {open.length - 5} 条</p>}
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
        return <i key={d.toDateString()} title={`${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${n}`} className={(d.toDateString() === today.toDateString() ? 'today ' : '') + (d > today ? 'fut' : '')} style={{ background: `var(--w${Math.min(4, n)})` }} />
      })}
    </div>
  )
}

/** 表格「改过」一列：今天、昨天、3 天前、上周、3 周前、几个月前 */
export function ago(ms: number, now = Date.now()): string {
  const d = Math.floor((new Date(now).setHours(24, 0, 0, 0) - ms) / 86400_000)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 7) return `${d} 天前`
  if (d < 14) return '上周'
  if (d < 60) return `${Math.floor(d / 7)} 周前`
  return `${Math.floor(d / 30)} 个月前`
}

function when(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}
