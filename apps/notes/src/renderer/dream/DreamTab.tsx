/**
 * 梦游对照（task-m552v，用户点过的 demo /private/tmp/canvas-notes-dream/v2/proto.html）：点报告里的一条，中间像「历史」那样开这一条。
 * 从上到下：条目头（第几条、标题、为什么、谁做的，右边收下 / 丢掉）· 这条改的文件（不止一个时一排，点哪个下面换成哪个）·
 * 文件条（名字、在哪、一句人话、「打开「文件名」」）· 挪动那一块（归类那条）· 对照（默认整篇改前 / 收下后并排，打开滚到第一处改动闪一下，
 * 右边小地图标改在全文哪里）。标签条右端：对照 / 收下后的样子 · 整篇 / 只看改动 · 并排 / 合一 · 上一处 / 下一处（记住选的）。
 * 历史里点收下的那次提交里的文件也是这个样子（头上一条「历史 · …」带「在梦游报告里看这条」）。焦点在这里时 J / K 换条、⌘↵ 收下、⌘⌫ 丢掉。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { type Chunk, MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { engineOfLabel } from '../../shared/ai-features'
import type { DreamItem, DreamReport } from '../../shared/api'
import { baseName, type DiffEntry, type DiffResult, type DiffSource } from '../../shared/diff'
import { indexOf } from '../../shared/dream-order'
import { titleOf } from '../../shared/layout'
import { blockChanges } from '../diff/blocks'
import { blockGaps } from '../block-gaps'
import { type BranchFiles, citeClicks } from '../cite'
import { blocksField, editorHost } from '../editor-host'
import { EngineLogo } from '../engine-logo'
import { isKey, useKeys } from '../keys'
import { livePreview } from '../live-preview'
import { mdWidgets } from '../md-widgets'
import { propsBlock, showPropsTable } from '../mindmap/props-block'
import { fileIcon } from '../Palette'
import { ActBtn, PageNote, TabActs } from '../shell/TabActs'
import { fitFrame, fitSrc, type VizHost, vizHost } from '../viz-embed'
import { vaultName as vaultLabel } from '../vault-name'
import { changeSpots, chunkNotes, chunksOf, delExt, FoldCtl, foldExt, foldPlan, markExt, noteExt, pureExt, type Spot } from './compare'
import { actOn, dreamNow, openDream, setCur, setCurFile, stepDream, undoItem } from './nav'
import { GROUPS } from './useDream'
import './dream-tab.css'
import '../diff/diff.css'

type Mode = 'cmp' | 'after'
type Layout = 'split' | 'unified'

/** 设好就收起来：选的看法记在本机 */
function remembered<T extends string>(key: string, def: T, ok: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && ok.includes(v) ? v : def
  } catch {
    return def
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    // 记不住不影响使用
  }
}

/** 中间栏窄于这个宽度时自动合一（同对比标签） */
const NARROW = 900
const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const isBoard = (t: string | null) => !!t && /^---\r?\n(?:[\s\S]*?\r?\n)?type:\s*board\s*(?:\r?\n)/.test(t)

export function DreamTab(props: {
  src: DiffSource
  report: DreamReport | null
  /** 历史里点的收下那次提交：这一条（头上一条「历史 · …」，没有条目头） */
  hist?: DreamItem
  active: boolean
  gitVersion: number
  /** 打开库里的文件；line：滚到第几行闪一下 */
  onOpenPath(path: string, line?: number): void
  /** 只在梦游分支上的：HTML 开梦游分支上那份，md 开那一版 */
  onOpenBranch(path: string, rev: string | undefined): void
  /** 历史里看的：换一个文件 */
  onFocus(path: string): void
  /** 历史头上「在梦游报告里看这条」 */
  onShowInReport(id: string): void
  onNotice(text: string): void
}) {
  const { src, report } = props
  const K = useKeys()
  const item = props.hist ?? (src.kind === 'dream' ? (report?.items.find((i) => i.id === src.id) ?? null) : null)
  const hist = !!props.hist
  const [res, setRes] = useState<DiffResult | { error: string } | null>(null)
  const [mode, setMode] = useState<Mode>(() => remembered('cn.dreamMode', 'cmp', ['cmp', 'after'] as const))
  const [whole, setWhole] = useState(() => remembered('cn.dreamWhole', 'whole', ['whole', 'changes'] as const) === 'whole')
  const [layout, setLayout] = useState<Layout>(() => remembered('cn.diffLayout', 'split', ['split', 'unified'] as const))
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLElement>(null)
  // 读这一条的两版：换了条、这条收下 / 丢掉 / 撤回了（打开哪一份跟着变）、历史里库变了，重读
  const key = JSON.stringify({ ...src, focus: undefined }) + `:${item?.state}:${item?.taken ?? ''}:${hist ? props.gitVersion : ''}`
  const readFor = useRef('')
  useEffect(() => {
    let stale = false
    const fetchSrc: DiffSource = src.kind === 'dream' ? { kind: 'dream', id: src.id } : src.kind === 'commit' ? { kind: 'commit', hash: src.hash } : src
    if (readFor.current !== JSON.stringify(fetchSrc)) setRes(null)
    readFor.current = JSON.stringify(fetchSrc)
    window.cn.diffFiles(fetchSrc).then(
      (r) => !stale && setRes(r),
      (e: unknown) => !stale && setRes({ error: errText(e) }),
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // 中间开的就是左栏亮着的那一条
  useEffect(() => {
    if (props.active && item && !hist) setCur(item.id)
  }, [props.active, item?.id, hist])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setNarrow(el.clientWidth < NARROW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const files = res && !('error' in res) ? res.files : []
  const focus = 'focus' in src ? src.focus : undefined
  const fi = focus ? Math.max(0, files.findIndex((f) => f.path === focus || f.from === focus)) : 0
  const f = files[fi] ?? null
  const shown: Layout = narrow ? 'unified' : layout
  const dup = item?.group === 'dup'
  const html = f?.kind === 'html'
  // 左栏小卡里这一行亮着
  useEffect(() => {
    if (props.active && item && !hist && f) setCurFile(f.path)
  }, [props.active, item?.id, hist, f?.path])
  const viewsRef = useRef<ViewsInfo | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [flash, setFlash] = useState<{ top: number; height: number; left: number; width: number; n: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /** 闪了第几下，一直往上数（闪完收起也不归零）：data-n 让测试认得出是不是新闪的那一下 */
  const flashSeq = useRef(0)

  /** 编辑器画好了（或改了折叠）：量每处改动在哪；first：打开时滚到第一处、闪一下 */
  const measure = (first: boolean) => {
    const sc = scroller.current
    const v = viewsRef.current
    if (!sc || !v) return setSpots([])
    const s = v.dom ? [domSpot(sc, v.dom)] : changeSpots(sc, v.chunks, v.b, v.a)
    setSpots(s)
    if (first && s.length) {
      sc.scrollTop = Math.max(0, s[0]!.top - sc.clientHeight * 0.3)
      // 滚过去以后编辑器把那几行画出来、量准了再闪
      requestAnimationFrame(() => {
        const again = v.dom ? [domSpot(sc, v.dom)] : changeSpots(sc, v.chunks, v.b, v.a)
        setSpots(again)
        if (again[0]) {
          sc.scrollTop = Math.max(0, again[0].top - sc.clientHeight * 0.3)
          flashAt(again[0])
        }
      })
    }
  }
  const flashAt = (s: Spot) => {
    const sc = scroller.current
    const v = viewsRef.current
    if (!sc || !v) return
    // 闪的外圈和那一栏的字一样宽（收下后的样子是 760 居中的那一列，不是整栏）
    const col = (v.dom ?? (s.kind === 'del' && v.a ? v.a.contentDOM : (v.b ?? v.a)?.contentDOM))?.getBoundingClientRect()
    const box = sc.getBoundingClientRect()
    setFlash({ top: s.top, height: s.bottom - s.top, left: col ? col.left - box.left : 0, width: col ? col.width : sc.clientWidth, n: ++flashSeq.current })
  }
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1700)
    return () => clearTimeout(t)
  }, [flash?.n])

  /**
   * 对照滚了（打开时滚到第一处改动、上一处 / 下一处、小地图、用户自己滚）：叫两栏的编辑器照新位置重画看得见的那几行。
   * CodeMirror 只在自己的「在不在页面上」观察回报以后才理会外层的滚动，刚建好时那一回报还没到（机器忙时常见），
   * 这一滚它不理，画着的还是开头那几屏，滚到的地方是空的（改动那一行、链接都不在页面上）
   */
  function onScroll() {
    setSpots((s) => [...s])
    viewsRef.current?.a?.requestMeasure()
    viewsRef.current?.b?.requestMeasure()
  }

  /** 上一处 / 下一处：这个文件里的改动，按在页面上的位置 */
  function step(d: 1 | -1) {
    const sc = scroller.current
    if (!sc) return
    const s = viewsRef.current ? (viewsRef.current.dom ? [domSpot(sc, viewsRef.current.dom)] : changeSpots(sc, viewsRef.current.chunks, viewsRef.current.b, viewsRef.current.a)) : spots
    const cur = sc.scrollTop + sc.clientHeight * 0.3
    const t = d > 0 ? s.find((x) => x.top > cur + 4) : [...s].reverse().find((x) => x.top < cur - 4)
    if (!t) return props.onNotice(d > 0 ? '后面没有改动了' : '前面没有改动了')
    sc.scrollTop = Math.max(0, t.top - sc.clientHeight * 0.3)
    requestAnimationFrame(() => {
      const v = viewsRef.current
      const again = v && !v.dom ? changeSpots(sc, v.chunks, v.b, v.a) : s
      flashAt(again.find((x) => Math.abs(x.top - t.top) < 40) ?? t)
    })
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || hist) return
    if (isKey(e, 'dream-next')) (e.preventDefault(), stepDream(1))
    else if (isKey(e, 'dream-prev')) (e.preventDefault(), stepDream(-1))
    else if (item && isKey(e, 'dream-take')) (e.preventDefault(), void actOn('take', item))
    else if (item && isKey(e, 'dream-drop') && item.commit) (e.preventDefault(), void actOn('drop', item))
  }

  const items = report?.items ?? []
  const n = indexOf(items, item?.id ?? null)
  const state = item?.state ?? 'pending'
  const note = hist ? '历史 · 已提交' : state === 'pending' ? '梦游 · 还没收下' : state === 'taken' ? '梦游 · 已收下' : '梦游 · 已丢掉'
  const showViews = !dup && f && f.kind !== 'image' && f.kind !== 'binary'
  const subject = res && !('error' in res) ? res.note.slice(res.note.indexOf(' · ') + 3) : ''

  return (
    <section className={'pane dv dt' + (narrow ? ' narrow' : '')} hidden={!props.active} data-testid="dream-tab" ref={root} tabIndex={-1} onKeyDown={onKey} aria-label="梦游对照">
      <TabActs active={props.active}>
        <PageNote>{note}</PageNote>
        {showViews && (
          <>
            <div className="seg dt-seg" role="tablist" aria-label="看法">
              {(
                [
                  ['cmp', 'git-compare', '对照', '改前、收下后并排对照'],
                  ['after', 'eye', '收下后的样子', '这个文件收下后的样子'],
                ] as const
              ).map(([m, icon, name, tip]) => (
                <button key={m} className={mode === m ? 'on' : ''} role="tab" aria-selected={mode === m} aria-label={name} data-tip={tip} data-side="below" onClick={() => (setMode(m), remember('cn.dreamMode', m))}>
                  <Codicon name={icon} size={14} />
                  <span className="lb">{name}</span>
                </button>
              ))}
            </div>
            <span className="dt-vsep" />
            <div className="seg dt-seg" role="tablist" aria-label="整篇还是只看改动">
              {(
                [
                  [true, 'list-flat', '整篇', '整篇都摆出来，改的地方标颜色'],
                  [false, 'fold', '只看改动', '没改的折起来'],
                ] as const
              ).map(([w, icon, name, tip]) => (
                <button
                  key={name}
                  className={whole === w ? 'on' : ''}
                  role="tab"
                  aria-selected={whole === w}
                  aria-label={name}
                  data-tip={tip}
                  data-side="below"
                  disabled={mode === 'after' || html}
                  onClick={() => (setWhole(w), remember('cn.dreamWhole', w ? 'whole' : 'changes'))}
                >
                  <Codicon name={icon as CodiconName} size={14} />
                  <span className="lb">{name}</span>
                </button>
              ))}
            </div>
            <span className="dt-vsep" />
            <div className="seg dt-seg" role="tablist" aria-label="排法">
              {(
                [
                  ['split', 'split-horizontal', '并排'],
                  ['unified', 'diff-single', '合一'],
                ] as const
              ).map(([m, icon, name]) => (
                <button
                  key={m}
                  className={shown === m && mode === 'cmp' ? 'on' : ''}
                  role="tab"
                  aria-selected={shown === m && mode === 'cmp'}
                  aria-label={name}
                  data-tip={narrow && m === 'split' ? '中间栏太窄，自动合一' : name}
                  data-side="below"
                  disabled={mode === 'after' || (narrow && m === 'split')}
                  onClick={() => (setLayout(m), remember('cn.diffLayout', m))}
                >
                  <Codicon name={icon} size={14} />
                  <span className="lb">{name}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <ActBtn icon="arrow-up" label="上一处" disabled={!spots.length} onClick={() => step(-1)} />
        <ActBtn icon="arrow-down" label="下一处" disabled={!spots.length} onClick={() => step(1)} />
      </TabActs>

      {hist && item ? (
        <div className="dt-hist" data-testid="dream-hist">
          <Codicon name="history" size={14} />
          <span className="truncate">{`历史 · ${subject}`}</span>
          <button className="dt-link" onClick={() => props.onShowInReport(item.id)}>
            在梦游报告里看这条
          </button>
        </div>
      ) : item ? (
        <ItemHead item={item} index={n} total={items.length} base={report?.base ?? 'main'} keys={{ take: K('dream-take'), drop: K('dream-drop') }} />
      ) : (
        <p className="dv-empty">这份梦游报告已经没有这一条了</p>
      )}

      {!res && <p className="dv-empty">读取中…</p>}
      {res && 'error' in res && <p className="dv-empty">读不出这一条的改动：{res.error}</p>}
      {res && !('error' in res) && !files.length && <p className="dv-empty">这一条没有改动</p>}
      {res && !('error' in res) && item && !dup && files.length > 1 && (
        <div className="dt-files" role="tablist" aria-label="这条改的文件">
          <span className="lb">{`这条改了${files.length}个文件`}</span>
          {files.map((x, k) => (
            <button key={x.path} className={'dt-chip' + (k === fi ? ' on' : '')} role="tab" aria-selected={k === fi} data-testid="dream-file" onClick={() => (hist ? props.onFocus(x.path) : openDream(item.id, x.path))}>
              <Codicon name={dreamIcon(x.path, isBoard(x.after))} size={14} />
              <span className="truncate">{x.kind === 'md' ? titleOf(x.now ?? x.path) : baseName(x.path)}</span>
              {x.status === 'new' ? (
                <span className="nt">新文件</span>
              ) : (
                <>
                  {x.added > 0 && <span className="a num">{`+${x.added}`}</span>}
                  {x.removed > 0 && <span className="d num">{`−${x.removed}`}</span>}
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {res && !('error' in res) && f && item && !dup && (
        <FileBar f={f} item={item} hist={hist} files={files} rev={res.rev} onOpenPath={props.onOpenPath} onOpenBranch={props.onOpenBranch} firstLine={firstChangedLine(f)} />
      )}
      {res && !('error' in res) && f && item?.move && f.path === item.move.to && item.move.from !== item.move.to && <MoveBlock item={item} files={files} />}

      {res && !('error' in res) && (dup || f) && (
        <div className="dt-wrap" data-testid="dream-cmp">
          <div className="dt-scroll" ref={scroller} data-testid="dream-scroll" onScroll={onScroll}>
            {dup && item ? (
              <DupView files={files} res={res} onOpenPath={props.onOpenPath} viewsRef={viewsRef} onReady={() => measure(false)} />
            ) : html ? (
              <HtmlView key={f!.path} f={f!} res={res} mode={mode} layout={shown} item={item} viewsRef={viewsRef} onReady={() => measure(true)} />
            ) : f!.kind === 'image' ? (
              <ImageView f={f!} res={res} />
            ) : f!.kind === 'binary' ? (
              <p className="dv-empty">{`${f!.status === 'new' ? '新文件' : '改了'}，看不了内容`}</p>
            ) : (
              <MdView key={`${f!.path}:${mode}:${shown}:${whole}`} f={f!} res={res} mode={mode} layout={shown} whole={whole} item={item} hist={hist} viewsRef={viewsRef} onReady={(first) => measure(first)} />
            )}
            <div className="dt-tail" />
            {flash && <div key={flash.n} className="dv-flash" data-n={flash.n} style={{ top: flash.top, height: flash.height, left: flash.left, width: flash.width }} />}
          </div>
          <Minimap spots={spots} scroller={scroller} onJump={(s) => (scroller.current && (scroller.current.scrollTop = Math.max(0, s.top - scroller.current.clientHeight * 0.3)), requestAnimationFrame(() => flashAt(s)))} />
        </div>
      )}
    </section>
  )
}

/** 编辑器们：并排的 a（改前）、b（收下后），合一和只有一列的是 b；HTML、可能重复用 dom 那一块整个算一处 */
interface ViewsInfo {
  a: EditorView | null
  b: EditorView | null
  chunks: readonly Chunk[]
  dom?: HTMLElement
}

/** 整块算一处改动（新建的 HTML 那一格） */
function domSpot(sc: HTMLElement, el: HTMLElement): Spot {
  const r = el.getBoundingClientRect()
  const top = r.top - sc.getBoundingClientRect().top + sc.scrollTop
  return { top, bottom: top + r.height, kind: 'add' }
}

/** 这个文件第一处改动在收下后那一版的第几行（打开时滚到那一行闪一下） */
function firstChangedLine(f: DiffEntry): number | undefined {
  if (f.kind !== 'md' || f.after === null) return undefined
  const c = chunksOf(f.before ?? '', f.after)[0]
  return c ? f.after.slice(0, c.fromB).split('\n').length : undefined
}

function ItemHead(props: { item: DreamItem; index: number; total: number; base: string; keys: { take: string | null; drop: string | null } }) {
  const { item } = props
  const dup = item.group === 'dup' || !item.commit
  const engine = item.by ? engineOfLabel(item.by) : null
  return (
    <div className="dt-head" data-testid="dream-head">
      <div className="k">
        <span data-testid="dream-k">{`${GROUPS[item.group]} · 第${props.index + 1}条，共${props.total}条`}</span>
        <span className="dt-nav">
          <button className="iconbtn" aria-label="上一条" data-tip="上一条 K" data-side="below" onClick={() => stepDream(-1)}>
            <Codicon name="chevron-up" size={14} />
          </button>
          <button className="iconbtn" aria-label="下一条" data-tip="下一条 J" data-side="below" onClick={() => stepDream(1)}>
            <Codicon name="chevron-down" size={14} />
          </button>
        </span>
      </div>
      <div className="acts">
        {item.state === 'pending' ? (
          <>
            <div className="r">
              {dup ? (
                <button className="btn btn-sm" onClick={() => void actOn('take', item)}>
                  <Codicon name="check" size={14} />
                  知道了
                </button>
              ) : (
                <>
                  <button className="btn btn-sm" onClick={() => void actOn('drop', item)}>
                    <Codicon name="close" size={14} />
                    丢掉
                  </button>
                  <button className="btn btn-sm" onClick={() => void actOn('take', item)}>
                    <Codicon name="check" size={14} />
                    收下这条
                  </button>
                </>
              )}
            </div>
            <div className="hint">{dup ? '只是提醒，不改任何文件' : [props.keys.take && `${props.keys.take} 收下`, props.keys.drop && `${props.keys.drop} 丢掉`, `收下 = 一次提交进${props.base}`].filter(Boolean).join(' · ')}</div>
          </>
        ) : (
          <div className="r">
            {item.state === 'taken' ? (
              <span className="chip-ok" data-testid="dream-taken">
                <Codicon name="pass-filled" size={14} />
                {item.taken ? (
                  <>
                    已收下 · <code className="num">{item.taken.slice(0, 7)}</code>
                  </>
                ) : (
                  '看过了'
                )}
              </span>
            ) : (
              <span className="chip-drop">已丢掉</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => void undoItem(item)}>
              <Codicon name="discard" size={14} />
              撤回
            </button>
          </div>
        )}
      </div>
      <h2>{item.title}</h2>
      <div className="why" data-testid="dream-why">
        {item.why}
      </div>
      {item.by && (
        <div className="by" data-testid="dream-by">
          {engine && <EngineLogo id={engine} size={12} />}
          {`${item.by}做的`}
        </div>
      )}
    </div>
  )
}

function FileBar(props: { f: DiffEntry; item: DreamItem; hist: boolean; files: DiffEntry[]; rev?: string; firstLine?: number; onOpenPath(path: string, line?: number): void; onOpenBranch(path: string, rev?: string): void }) {
  const { f, item } = props
  const md = f.kind === 'md'
  // 挪的那篇还没收下：名字照现在收件箱里那份；别的照现在库里那份（后来挪走了的跟过去）
  const nowPath = props.hist ? (f.exists ? f.path : null) : (f.now ?? null)
  const name = md ? titleOf(nowPath ?? f.path) : baseName(nowPath ?? f.path)
  const crumb = crumbOf(f.path, props.files, item)
  const moved = !props.hist && nowPath && nowPath !== f.path && nowPath !== f.from
  const branch = !props.hist && !nowPath && !!f.branch
  const board = isBoard(f.after)
  const label = `打开「${name}」${board ? ' · 白板' : ''}${branch ? '· 梦游分支上的' : ''}`
  const can = !!nowPath || branch
  const why = can ? undefined : item.state === 'dropped' ? '这条丢掉了，库里没有这个文件' : '这篇现在已经不在原处了（挪走或删了）'
  const at = props.hist ? f.path : (f.now ?? f.path)
  return (
    <div className="dt-fbar" data-testid="dream-fbar">
      <Codicon name={dreamIcon(f.path, board)} size={16} />
      <span className="nm truncate">{md ? titleOf(at) : baseName(at)}</span>
      <span className="dir truncate">{at === f.path ? crumb : crumbOf(at, props.files, item)}</span>
      <span className="say truncate">{`· ${f.summary}`}</span>
      <button
        className="btn btn-ghost btn-sm dt-open"
        data-testid="dream-open"
        disabled={!can}
        data-tip={why ?? (moved ? `这篇已经挪到「${dirOf(nowPath!) || vaultLabel()}」，开的是现在那份` : undefined)}
        data-side="below"
        onClick={() => (branch ? props.onOpenBranch(f.path, props.rev) : nowPath && props.onOpenPath(nowPath, nowPath === f.path || nowPath === f.from ? props.firstLine : undefined))}
      >
        <Codicon name="go-to-file" size={14} />
        <span className="truncate">{label}</span>
        {moved && <span className="kbd">{`挪到了${(dirOf(nowPath!) || vaultLabel()).split('/').pop()}`}</span>}
      </button>
    </div>
  )
}

/** 梦游里文件的图标：HTML 都是可视化，用 graph（和左栏那一条、目录树里一样） */
export const dreamIcon = (path: string, board = false): CodiconName => (/\.html?$/i.test(path) ? 'graph' : fileIcon(path, board))

/** 文件条上的「在哪」：读 PDF 的笔记、它的可视化写成目录树里挂着的样子「study project 2 › X.pdf › 笔记」，别的写文件夹 */
export function crumbOf(path: string, files: DiffEntry[], item: DreamItem): string {
  const dir = dirOf(path)
  const last = dir.split('/').pop() || vaultLabel()
  if (/ 笔记\.md$/.test(path)) {
    const pdf = baseName(path).replace(/ 笔记\.md$/, '.pdf')
    return `${last} › ${pdf}`
  }
  if (/\.html?$/i.test(path) && item.group === 'viz') {
    const note = files.find((x) => / 笔记\.md$/.test(x.path))
    if (note) return `${last} › ${baseName(note.path).replace(/ 笔记\.md$/, '.pdf')} › 笔记`
  }
  return dir || vaultLabel()
}

function MoveBlock(props: { item: DreamItem; files: DiffEntry[] }) {
  const { from, to } = props.item.move!
  const renamed = titleOf(from) !== titleOf(to)
  const others = props.files.filter((x) => x.path !== to).length
  const fromDir = dirOf(from) || vaultLabel()
  const toDir = dirOf(to) || vaultLabel()
  return (
    <div className="dt-move" data-testid="dream-move">
      <Codicon name="arrow-right" size={14} />
      <span className="loc">
        <Codicon name={fromDir === '收件箱' ? 'inbox' : 'folder'} size={14} />
        {`${fromDir}/`}
      </span>
      <s>{titleOf(from)}</s>
      <span className="ar">→</span>
      <span className="loc">
        <Codicon name={toDir === '收件箱' ? 'inbox' : 'folder'} size={14} />
        {`${toDir}/`}
      </span>
      <span className="to">{titleOf(to)}</span>
      <span className="note">
        {`这篇的图片、附件跟着挪${renamed ? `；别的笔记里写着 [[${titleOf(from)}]] 的跟着换成新名${others ? `（就是这条里的第2${others > 1 ? `到${others + 1}` : ''}个文件）` : ''}` : ''}。`}
      </span>
    </div>
  )
}

/** 还没收下的几条在梦游分支上新建、挪去改名的文件 → 那条最后一次提交（链接指着它们时开分支上那份） */
function branchFiles(report: DreamReport | null): BranchFiles {
  const out = new Map<string, string>()
  for (const it of report?.items ?? []) {
    if (it.state !== 'pending' || !it.commit) continue
    const rev = it.redoCommits?.at(-1) ?? it.commit
    for (const p of [...it.files, ...(it.move ? [it.move.to] : [])]) out.set(p, rev)
  }
  return out
}
const dreamBranch = () => branchFiles(dreamNow().report)

/** 文档样子的编辑器：只读，用编辑器现成的实时预览画（标题是标题、图是图、嵌着的可视化能拖）；链接、双链、图和文档里一样能点（cite.tsx） */
function docExt(path: string, vh: VizHost | null): Extension[] {
  return [
    citeClicks(path, dreamBranch),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    livePreview,
    propsBlock,
    showPropsTable.of(true),
    editorHost.of({ path: () => path, notice: () => {} }),
    blocksField,
    mdWidgets,
    blockGaps,
    ...(vh ? [vizHost.of(vh)] : []),
  ]
}

const vaultSrc = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const revSrc = (rev: string, p: string) => `cn-file://rev/${rev}/` + p.split('/').map(encodeURIComponent).join('/')

/** 收下后那一版里的可视化：还没收下的在梦游分支上（按那次提交读），放大开梦游分支上那份 */
function afterHost(res: DiffResult, item: DreamItem | null, hist: boolean): VizHost {
  const pending = !hist && item?.state === 'pending'
  return {
    src: (p) => (res.rev && (pending || hist) ? revSrc(res.rev, p) : vaultSrc(p)),
    pending,
    open: (p) => window.dispatchEvent(new CustomEvent('cn:dream-open-viz', { detail: { path: p, pending } })),
  }
}

function MdView(props: { f: DiffEntry; res: DiffResult; mode: Mode; layout: Layout; whole: boolean; item: DreamItem | null; hist: boolean; viewsRef: React.MutableRefObject<ViewsInfo | null>; onReady(first: boolean): void }) {
  const { f, res, mode, layout, whole, item } = props
  const host = useRef<HTMLDivElement>(null)
  const before = f.before
  const after = f.after ?? ''
  const chunks = useMemo(() => (before !== null && f.after !== null ? chunksOf(before, after) : []), [f])
  const notes = useMemo(
    () => chunkNotes({ before, after, chunks, fromPath: f.from ?? f.path, toPath: f.path, group: item?.group ?? '', say: f.summary, linkTo: /\[\[([^\]]+)\]\]/.exec(item?.sub ?? '')?.[1] }),
    [f, chunks, item?.group, item?.sub],
  )
  const ready = useRef(props.onReady)
  ready.current = props.onReady
  useEffect(() => {
    const parent = host.current!
    const vh = afterHost(res, item, props.hist)
    const ctl = new FoldCtl()
    ctl.onChange = () => requestAnimationFrame(() => ready.current(false))
    let destroy: () => void
    if (mode === 'after' || before === null || f.after === null) {
      // 收下后的样子（新建的、删掉的只有一边）：一列；改的段左边一道竖线，下面一句人话
      const doc = f.after ?? before ?? ''
      const marks = mode === 'after' ? chunks.map((c) => ({ from: c.fromB, to: Math.max(c.fromB, Math.min(c.toB, after.length)) })) : []
      const ext = [...docExt(f.after !== null ? f.path : (f.from ?? f.path), f.after !== null ? vh : null), ...(mode === 'after' ? [markExt(marks), noteExt(notes)] : [])]
      const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: ext }) })
      props.viewsRef.current = { a: null, b: v, chunks: mode === 'after' ? chunks : [], ...(mode !== 'after' ? { dom: v.dom } : {}) }
      destroy = () => v.destroy()
    } else if (layout === 'split') {
      const plan = whole ? null : foldPlan(before, after, chunks)
      const mv = new MergeView({
        parent,
        a: { doc: before, extensions: [...docExt(f.from ?? f.path, null), blockChanges, pureExt(chunks, 'a'), ...(plan ? [foldExt(plan.a, ctl, true)] : [])] },
        b: { doc: after, extensions: [...docExt(f.path, vh), blockChanges, pureExt(chunks, 'b'), noteExt(notes), ...(plan ? [foldExt(plan.b, ctl, false)] : [])] },
        gutter: false,
        highlightChanges: true,
      })
      ctl.views = [mv.a, mv.b]
      props.viewsRef.current = { a: mv.a, b: mv.b, chunks }
      destroy = () => mv.destroy()
    } else {
      const plan = whole ? null : foldPlan(null, after, chunks)
      const v = new EditorView({
        parent,
        state: EditorState.create({
          doc: after,
          extensions: [
            ...docExt(f.path, vh),
            unifiedMergeView({ original: before, mergeControls: false, gutter: false, highlightChanges: true, syntaxHighlightDeletions: false }),
            delExt(chunks, before, after.length, docExt(f.from ?? f.path, null)),
            blockChanges,
            pureExt(chunks, 'b'),
            noteExt(notes),
            ...(plan ? [foldExt(plan.b, ctl, true)] : []),
          ],
        }),
      })
      ctl.views = [v]
      props.viewsRef.current = { a: null, b: v, chunks }
      destroy = () => v.destroy()
    }
    // 画好、量好以后：滚到第一处改动、闪一下
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => ready.current(true)))
    return () => {
      cancelAnimationFrame(raf)
      props.viewsRef.current = null
      destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, mode, layout, whole])

  const cols = colsOf(props.res, props.hist)
  const single = mode === 'after' || before === null || f.after === null
  return (
    <div className={'dv-diff dt-diff doc-look' + (single ? ' dv-unified dt-single' : layout === 'unified' ? ' dv-unified' : ' dv-split') + (mode === 'after' ? ' dv-after' : '') + (before === null && mode !== 'after' ? ' dt-new' : '') + (f.after === null ? ' dt-gone' : '')}>
      <div className={'dv-cols dt-cols' + (single || layout === 'unified' ? ' one' : '')} data-testid="dream-cols">
        {mode === 'after' ? (
          <span>{`收下后的样子 · ${titleOf(f.path)}`}</span>
        ) : before === null ? (
          <>
            <span>{cols[0]}</span>
            <span>{cols[1]}</span>
          </>
        ) : layout === 'split' ? (
          <>
            <span>{cols[0]}</span>
            <span>{cols[1]}</span>
          </>
        ) : (
          <span>{`${cols[0]} → ${cols[1]}`}</span>
        )}
      </div>
      {before === null && mode !== 'after' ? (
        <div className="dt-rows">
          <Void path={f.path} item={item} />
          <div className="doc dt-cell add" ref={host} />
        </div>
      ) : (
        <div className="doc" ref={host} />
      )}
    </div>
  )
}

/** 新建的文件：左边「main 上还没有这个文件」 */
function Void(props: { path: string; item: DreamItem | null }) {
  const dir = dirOf(props.path)
  const where = dir.split('/').pop() || vaultLabel()
  const viz = props.item?.group === 'viz' && /\.html?$/i.test(props.path)
  return (
    <div className="dt-void" data-testid="dream-void">
      <Codicon name="new-file" size={28} />
      <span>main 上还没有这个文件</span>
      <span>{`收下后它在「${where}」里${viz ? '，挂在笔记下面' : ''}`}</span>
    </div>
  )
}

function colsOf(res: DiffResult, hist: boolean): [string, string] {
  return [res.left || (hist ? '改之前' : '现在的 · main'), res.right || '收下后']
}

function HtmlView(props: { f: DiffEntry; res: DiffResult; mode: Mode; layout: Layout; item: DreamItem | null; viewsRef: React.MutableRefObject<ViewsInfo | null>; onReady(): void }) {
  const { f, res, mode, layout } = props
  const vh = afterHost(res, props.item, false)
  const cell = useRef<HTMLDivElement>(null)
  const ready = useRef(props.onReady)
  ready.current = props.onReady
  useEffect(() => {
    props.viewsRef.current = cell.current ? { a: null, b: null, chunks: [], dom: cell.current } : null
    const raf = requestAnimationFrame(() => ready.current())
    return () => {
      cancelAnimationFrame(raf)
      props.viewsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, mode, layout])
  const frame = (h: number) => <iframe className="dt-viz" title={baseName(f.path)} sandbox="allow-scripts" src={vh.src(f.path)} data-testid="viz-frame" style={{ height: h }} />
  const fitted = (src: string, title: string, testid?: string) => <FitFrame src={src} title={title} testid={testid} onFit={() => ready.current()} />
  const cols = colsOf(res, false)
  if (mode === 'after')
    return (
      <div className="dv-diff dt-diff dv-after dt-single">
        <div className="dv-cols dt-cols one" data-testid="dream-cols">
          <span>收下后的样子 · 能拖</span>
        </div>
        <div className="dt-full" ref={cell}>
          {frame(560)}
        </div>
      </div>
    )
  const isNew = f.before === null
  return (
    <div className={'dv-diff dt-diff ' + (layout === 'split' ? 'dv-split' : 'dv-unified')}>
      <div className={'dv-cols dt-cols' + (layout === 'split' ? '' : ' one')} data-testid="dream-cols">
        {layout === 'split' ? (
          <>
            <span>{cols[0]}</span>
            <span>{cols[1]}</span>
          </>
        ) : (
          <span>{`${cols[0]} → ${cols[1]}${isNew ? ' · 新文件' : ''}`}</span>
        )}
      </div>
      <div className={'dt-rows' + (layout === 'split' ? '' : ' one')}>
        {layout === 'split' && (isNew ? <Void path={f.path} item={props.item} /> : <div className="dt-cell del">{fitted(vaultSrc(f.path), '改之前')}</div>)}
        <div className="dt-cell add" ref={cell}>
          {fitted(vh.src(f.path), baseName(f.path), 'viz-frame')}
        </div>
      </div>
    </div>
  )
}

/** 对照格里的可视化：跟着那一页的高（140 到 640），变了高小地图重新量 */
function FitFrame(props: { src: string; title: string; testid?: string; onFit(): void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const onFit = useRef(props.onFit)
  onFit.current = props.onFit
  useEffect(() => fitFrame(ref.current!, 140, 640, () => onFit.current()), [])
  return <iframe ref={ref} className="dt-viz" title={props.title} sandbox="allow-scripts" src={fitSrc(props.src)} data-testid={props.testid} style={{ height: 200 }} />
}

function ImageView(props: { f: DiffEntry; res: DiffResult }) {
  const { f } = props
  return (
    <div className="dv-imgs">
      {f.before && (
        <figure>
          <figcaption>{props.res.left || '之前'}</figcaption>
          <img src={f.before} alt="之前" />
        </figure>
      )}
      {f.after && (
        <figure>
          <figcaption>{props.res.right || '之后'}</figcaption>
          <img src={f.after} alt="之后" />
        </figure>
      )}
    </div>
  )
}

/** 可能重复：两篇整篇并排，两篇说同一件事的那几段淡底 */
function DupView(props: { files: DiffEntry[]; res: DiffResult; viewsRef: React.MutableRefObject<ViewsInfo | null>; onReady(): void; onOpenPath(path: string): void }) {
  const f = props.files[0]
  const aPath = f?.from ?? ''
  const bPath = f?.path ?? ''
  const ha = useRef<HTMLDivElement>(null)
  const hb = useRef<HTMLDivElement>(null)
  const ready = useRef(props.onReady)
  ready.current = props.onReady
  useEffect(() => {
    if (!f || f.before === null || f.after === null) return
    const { a, b } = sameParas(f.before, f.after)
    const va = new EditorView({ parent: ha.current!, state: EditorState.create({ doc: f.before, extensions: [...docExt(aPath, null), markExt(a)] }) })
    const vb = new EditorView({ parent: hb.current!, state: EditorState.create({ doc: f.after, extensions: [...docExt(bPath, null), markExt(b)] }) })
    props.viewsRef.current = { a: null, b: null, chunks: [] }
    const raf = requestAnimationFrame(() => ready.current())
    return () => {
      cancelAnimationFrame(raf)
      va.destroy()
      vb.destroy()
      props.viewsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f])
  const head = (p: string) => (
    <span className="dt-duph">
      <Codicon name="file-text" size={14} />
      <b>{titleOf(p)}</b>
      <span className="truncate">{dirOf(p) || vaultLabel()}</span>
      <button className="btn btn-ghost btn-xs" onClick={() => props.onOpenPath(p)}>
        <Codicon name="go-to-file" size={14} />
        <span className="truncate">{`打开「${titleOf(p)}」`}</span>
      </button>
    </span>
  )
  return (
    <div className="dv-diff dt-diff dv-split doc-look dt-dup">
      <div className="dv-cols dt-cols dup" data-testid="dream-cols">
        {head(aPath)}
        {head(bPath)}
      </div>
      <div className="dt-rows">
        <div className="doc dt-cell" ref={ha} />
        <div className="doc dt-cell" ref={hb} />
      </div>
      <p className="dt-same">浅色底的几段两篇说的是同一件事。</p>
    </div>
  )
}

/** 两篇里说同一件事的段落：按字的两两相邻（二元组）比，像的一半以上算 */
function sameParas(a: string, b: string): { a: { from: number; to: number }[]; b: { from: number; to: number }[] } {
  const paras = (t: string) => {
    const out: { from: number; to: number; g: Set<string> }[] = []
    let pos = 0
    for (const line of t.split('\n')) {
      const s = line.replace(/^#+\s*|\s+/g, '')
      if (s.length >= 12 && !/^---$|^[a-z]+:/i.test(line)) {
        const g = new Set<string>()
        for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2))
        out.push({ from: pos, to: pos + line.length, g })
      }
      pos += line.length + 1
    }
    return out
  }
  const pa = paras(a)
  const pb = paras(b)
  const dice = (x: Set<string>, y: Set<string>) => {
    let n = 0
    for (const k of x) if (y.has(k)) n++
    return (2 * n) / (x.size + y.size)
  }
  const ra: { from: number; to: number }[] = []
  const rb = new Map<number, { from: number; to: number }>()
  for (const x of pa) {
    let best = -1
    let score = 0
    pb.forEach((y, k) => {
      const d = dice(x.g, y.g)
      if (d > score) ((score = d), (best = k))
    })
    if (best >= 0 && score >= 0.45) {
      ra.push({ from: x.from, to: x.to })
      rb.set(best, { from: pb[best]!.from, to: pb[best]!.to })
    }
  }
  return { a: ra, b: [...rb.values()] }
}

/** 小地图（demo .mm）：整篇的高度缩成一条，每处改动一个色块（绿加、红删），灰块是现在看到的这一屏；点色块跳过去 */
function Minimap(props: { spots: Spot[]; scroller: React.RefObject<HTMLDivElement | null>; onJump(s: Spot): void }) {
  const box = useRef<HTMLDivElement>(null)
  const sc = props.scroller.current
  const H = sc ? Math.max(1, sc.scrollHeight) : 1
  const mh = box.current?.clientHeight ?? 0
  const vis = (s: Spot) => !!sc && s.bottom > sc.scrollTop && s.top < sc.scrollTop + sc.clientHeight
  return (
    <div
      className="dt-mm"
      ref={box}
      data-testid="dream-minimap"
      aria-label="小地图"
      onMouseDown={(e) => {
        if (!sc || (e.target as HTMLElement).closest('.mm-m')) return
        e.preventDefault()
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top
        sc.scrollTop = (y / Math.max(1, mh)) * H - sc.clientHeight / 2
      }}
    >
      {sc && mh > 0 && <div className="mm-vp" style={{ top: (sc.scrollTop / H) * mh, height: Math.max(8, (sc.clientHeight / H) * mh) }} />}
      {sc &&
        mh > 0 &&
        props.spots.map((s, k) => (
          <button
            key={k}
            className={'mm-m ' + s.kind + (vis(s) ? ' on' : '')}
            style={{ top: (s.top / H) * mh, height: Math.max(3, ((s.bottom - s.top) / H) * mh) }}
            aria-label="跳到这处改动"
            data-tip="点一下跳到这处改动"
            data-side="left"
            onMouseDown={(e) => (e.preventDefault(), e.stopPropagation(), props.onJump(s))}
          />
        ))}
    </div>
  )
}
