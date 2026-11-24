/**
 * 梦游对照（task-m552v，用户点过的 demo /private/tmp/canvas-notes-dream/v2/proto.html）：点报告里的一条，中间像「历史」那样开这一条。
 * 从上到下：条目头（第几条、标题、为什么、谁做的，右边收下 / 丢掉）· 这条改的文件（不止一个时一排，点哪个下面换成哪个）·
 * 文件条（名字、在哪、一句人话、「打开「文件名」」）· 挪动那一块（归类那条）· 对照。
 * 对照就是历史那一套（diff/DiffTab.tsx 的 TextDiff，2026-11-24 用户定：「就用历史那一套就OK了」）：两列行号、改的行淡绿淡红、改的字更深，
 * 没改的折起来「展开没改的 N 行」；标签条右端同历史：并排 / 合一 · 上一处 / 下一处（和历史记同一份）。
 * 只是不露源码（DESIGN.v3 2.7a，偏好「只文档白板不露源码」）：历史那一组「文档 / 源码」这里没有，一直是文档样子。
 * 梦游自己加的只有：链接、双链 ⌘点开（指着梦游分支上新建的开分支上那份）、收下后那边画梦游分支上的可视化。
 * 可视化（HTML）、图片、可能重复（两篇整篇并排，说同一件事的段淡底）不是文字对比，照旧各自的画法。
 * 历史里点收下的那次提交里的文件也是这个样子（头上一条「历史 · …」带「在梦游报告里看这条」）。焦点在这里时 J / K 换条、⌘↵ 收下、⌘⌫ 丢掉。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { ChangeBar, UndoButton } from '@cn/ai-chat/answer-bar'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { engineOfLabel } from '@cn/ai-engines/shared'
import type { DreamItem, DreamReport } from '../../shared/api'
import { baseName, type DiffEntry, type DiffResult, type DiffSource } from '../../shared/diff'
import { indexOf } from '../../shared/dream-order'
import { t } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { Images, type Layout, NARROW, rememberedLayout, stepChange, TextDiff, ViewSegs } from '../diff/DiffTab'
import { blockGaps } from '../block-gaps'
import { type BranchFiles, citeClicks } from '../cite'
import { peekBranch } from '../peek/peek'
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
import { chunksOf, markExt } from './compare'
import { actOn, dreamNow, openDream, setCur, setCurFile, stepDream, undoItem } from './nav'
import { GROUPS } from './useDream'
import { actNames, Evidence } from './evidence'
import { EntryActs } from './entry-acts'
import './dream-tab.css'
import '../diff/diff.css'

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
  const [layout, setLayout] = useState<Layout>(rememberedLayout)
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLElement>(null)
  // 读这一条的两版：换了条、这条收下 / 丢掉 / 撤回了（打开哪一份跟着变）、历史里库变了，重读
  const focus = 'focus' in src ? src.focus : undefined
  // 词条页那条：提到它的几篇，左边一直是第一篇，右边是点的那篇（默认第二篇；梦游对照复审：以前只看得到两篇）
  const mentions = item?.entry && !item.commit && item.files.length > 1 ? item.files : null
  const right = mentions ? (focus && focus !== mentions[0] && mentions.includes(focus) ? focus : mentions[1]!) : undefined
  const key = JSON.stringify({ ...src, focus: undefined }) + `:${item?.state}:${item?.taken ?? ''}:${hist ? props.gitVersion : ''}:${right ?? ''}`
  const readFor = useRef('')
  useEffect(() => {
    let stale = false
    const fetchSrc: DiffSource = mentions && right ? { kind: 'pair', a: mentions[0]!, b: right } : src.kind === 'dream' ? { kind: 'dream', id: src.id } : src.kind === 'commit' ? { kind: 'commit', hash: src.hash } : src
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
  const fi = focus ? Math.max(0, files.findIndex((f) => f.path === focus || f.from === focus)) : 0
  const f = files[fi] ?? null
  const shown: Layout = narrow ? 'unified' : layout
  // 只是提醒、没有提交的（可能重复、可以建的词条页）：不是改动，两篇整篇并排（梦游对照复审：以前词条页那条拿两篇无关的笔记按字比，满屏红绿、写「改了 36 处」）
  const dup = !!item && !item.commit
  const html = f?.kind === 'html'
  // 左栏小卡里这一行亮着
  useEffect(() => {
    if (props.active && item && !hist && f) setCurFile(f.path)
  }, [props.active, item?.id, hist, f?.path])
  const scroller = useRef<HTMLDivElement>(null)
  // 打开「x」滚到第一处改动那一行：按需算一次（整篇两版逐行比，几千行的要几十毫秒，不能每画一次都算）
  const firstLine = useMemo(() => (f ? firstChangedLine(f) : undefined), [f])
  // 链接按各自那篇的路径点开；收下后那边画梦游分支上的可视化
  const sides = useMemo(() => (f && res && !('error' in res) ? { a: cmpExt(f.from ?? f.path, null), b: cmpExt(f.path, afterHost(res, item, hist)) } : undefined), [f, res, item?.state, hist])

  /** 上一处 / 下一处：这个文件里的改动，按在页面上的位置 */
  function step(d: 1 | -1) {
    if (scroller.current && !stepChange(scroller.current, d)) props.onNotice(d > 0 ? '后面没有改动了' : '前面没有改动了')
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
        {showViews && <ViewSegs look="doc" layout={shown} narrow={narrow} onLayout={setLayout} />}
        <ActBtn icon="arrow-up" label="上一处" disabled={!showViews || html} onClick={() => step(-1)} />
        <ActBtn icon="arrow-down" label="下一处" disabled={!showViews || html} onClick={() => step(1)} />
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
      {item && mentions && mentions.length > 2 && (
        <div className="dt-files" role="tablist" aria-label="提到它的几篇" data-testid="dream-mentions">
          <span className="lb">{t('提到它的{n}篇', { n: mentions.length })}</span>
          {mentions.map((p, k) => (
            <button
              key={p}
              className={'dt-chip' + (k === 0 || p === right ? ' on' : '')}
              role="tab"
              aria-selected={k === 0 || p === right}
              data-tip={k === 0 ? t('左边一直是这篇') : undefined}
              data-side="below"
              onClick={() => k > 0 && openDream(item.id, p)}
            >
              <Codicon name="file-text" size={14} />
              <span className="truncate">{titleOf(p)}</span>
            </button>
          ))}
        </div>
      )}
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
      {res && !('error' in res) && f && item && !dup && <FileBar f={f} item={item} hist={hist} files={files} rev={res.rev} onOpenPath={props.onOpenPath} onOpenBranch={props.onOpenBranch} firstLine={firstLine} />}
      {res && !('error' in res) && f && item?.move && f.path === item.move.to && item.move.from !== item.move.to && <MoveBlock item={item} files={files} />}

      {res && !('error' in res) && (dup || f) && (
        <div className="dv-body" ref={scroller} data-testid="dream-scroll">
          {dup && item ? (
            <DupView files={files} entry={item.entry?.name} onOpenPath={props.onOpenPath} />
          ) : html ? (
            <HtmlView key={f!.path} f={f!} res={res} layout={shown} item={item} />
          ) : f!.kind === 'image' ? (
            <Images f={f!} res={res} />
          ) : f!.kind === 'binary' ? (
            <p className="dv-empty">{`${f!.status === 'new' ? '新文件' : '改了'}，看不了内容`}</p>
          ) : (
            <TextDiff f={f!} res={res} look={f!.kind === 'md' ? 'doc' : 'source'} layout={shown} sides={sides} cols={colsOf(res, hist)} />
          )}
        </div>
      )}
    </section>
  )
}

/** 这个文件第一处改动在收下后那一版的第几行（「打开「x」」滚到那一行） */
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
              {item.entry ? (
                <EntryActs item={item} busy={false} solid testId="dream-head-entry" />
              ) : dup ? (
                <button className="btn btn-sm" onClick={() => void actOn('take', item)}>
                  <Codicon name="check" size={14} />
                  知道了
                </button>
              ) : (
                // 收不收那一套（task-eavzx）：不要（无边框）· 收下（实心，这一屏只有它一颗）；左边报告里同一个顺序
                <ChangeBar testId="dream-change-bar" reject={{ label: actNames(item).drop, onClick: () => void actOn('drop', item) }} accept={{ label: actNames(item).take, onClick: () => void actOn('take', item) }} solid />
              )}
            </div>
            <div className="hint">{item.entry ? t('点了才建，建好后底栏能撤销') : dup ? '只是提醒，不改任何文件' : [props.keys.take && `${props.keys.take} ${actNames(item).take}`, props.keys.drop && `${props.keys.drop} ${actNames(item).drop}`, `收下 = 一次提交进${props.base}`].filter(Boolean).join(' · ')}</div>
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
            <UndoButton label={t('撤回')} onClick={() => void undoItem(item)} />
          </div>
        )}
      </div>
      <h2>{item.title}</h2>
      <div className="why" data-testid="dream-why">
        {item.why}
      </div>
      <Evidence item={item} />
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

/** 对照里梦游自己加的：链接、双链、图和文档里一样能点（cite.tsx，指着梦游分支上新建的开分支上那份）；vh：画梦游分支上的可视化 */
function cmpExt(path: string, vh: VizHost | null): Extension[] {
  return [citeClicks(path, dreamBranch), peekBranch.of(dreamBranch), ...(vh ? [vizHost.of(vh)] : [])]
}

/** 可能重复那两篇的编辑器：只读，用编辑器现成的实时预览画（标题是标题、图是图）；链接、双链能点 */
function docExt(path: string): Extension[] {
  return [
    ...cmpExt(path, null),
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

/** 可视化（HTML）：改前、收下后各画一格（新建的左边「main 上还没有这个文件」） */
function HtmlView(props: { f: DiffEntry; res: DiffResult; layout: Layout; item: DreamItem | null }) {
  const { f, res, layout } = props
  const vh = afterHost(res, props.item, false)
  const fitted = (src: string, title: string, testid?: string) => <FitFrame src={src} title={title} testid={testid} />
  const cols = colsOf(res, false)
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
        <div className="dt-cell add">{fitted(vh.src(f.path), baseName(f.path), 'viz-frame')}</div>
      </div>
    </div>
  )
}

/** 对照格里的可视化：跟着那一页的高（140 到 640） */
function FitFrame(props: { src: string; title: string; testid?: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => fitFrame(ref.current!, 140, 640), [])
  return <iframe ref={ref} className="dt-viz" title={props.title} sandbox="allow-scripts" src={fitSrc(props.src)} data-testid={props.testid} style={{ height: 200 }} />
}

/**
 * 只是提醒的两篇（可能重复、可以建的词条页）：两篇整篇并排，抬头写两篇名字，说同一件事的那几段淡底，不比字、不写改了几处。
 * 词条页那条：淡底的是两篇里提到那个词的段（没有一段提到时退回按字像不像找）
 */
function DupView(props: { files: DiffEntry[]; entry?: string; onOpenPath(path: string): void }) {
  const f = props.files[0]
  const aPath = f?.from ?? ''
  const bPath = f?.path ?? ''
  const ha = useRef<HTMLDivElement>(null)
  const hb = useRef<HTMLDivElement>(null)
  const marks = useMemo(() => (f && f.before !== null && f.after !== null ? marksOf(f.before, f.after, props.entry) : null), [f, props.entry])
  const same = !!marks && (marks.a.length > 0 || marks.b.length > 0)
  useEffect(() => {
    if (!f || f.before === null || f.after === null || !marks) return
    const { a, b } = marks
    const va = new EditorView({ parent: ha.current!, state: EditorState.create({ doc: f.before, extensions: [...docExt(aPath), markExt(a)] }) })
    const vb = new EditorView({ parent: hb.current!, state: EditorState.create({ doc: f.after, extensions: [...docExt(bPath), markExt(b)] }) })
    return () => {
      va.destroy()
      vb.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, marks])
  const head = (p: string) => (
    <span className="dt-duph">
      <Codicon name="file-text" size={14} />
      <b className="truncate">{titleOf(p)}</b>
      <span className="dir truncate">{dirOf(p) || vaultLabel()}</span>
      <button className="btn btn-ghost btn-xs" aria-label={`打开「${titleOf(p)}」`} data-tip={`打开「${titleOf(p)}」`} data-side="below" onClick={() => props.onOpenPath(p)}>
        <Codicon name="go-to-file" size={14} />
        打开
      </button>
    </span>
  )
  return (
    <div className="dv-diff dt-diff dv-split doc-look dt-dup">
      <div className="dv-cols dt-cols dup" data-testid="dream-cols">
        {head(aPath)}
        {head(bPath)}
      </div>
      {same && <p className="dt-same">{marks!.word && props.entry ? t('浅色底的几段都提到{name}。', { name: quoteName(props.entry) }) : '浅色底的几段两篇说的是同一件事。'}</p>}
      <div className="dt-rows">
        <div className="doc dt-cell" ref={ha} />
        <div className="doc dt-cell" ref={hb} />
      </div>
    </div>
  )
}

/** 「《动手学深度学习》」那样带书名号的词照原样写，别的加「」 */
const quoteName = (name: string) => (/^[《「]/.test(name) ? name : `「${name}」`)

/** 两篇里一个词出现在哪几段（一行算一段；比的时候不分大小写，书名号可有可无） */
function parasWith(text: string, name: string): { from: number; to: number }[] {
  const bare = name.replace(/^[《「](.*)[》」]$/, '$1').toLowerCase()
  const out: { from: number; to: number }[] = []
  let pos = 0
  for (const line of text.split('\n')) {
    if (bare && line.toLowerCase().includes(bare)) out.push({ from: pos, to: pos + line.length })
    pos += line.length + 1
  }
  return out
}

/** 淡底铺哪几段：词条页那条是提到那个词的段，别的（和词条页两篇都没提到时）是两篇说同一件事的段 */
function marksOf(a: string, b: string, entry?: string): { a: { from: number; to: number }[]; b: { from: number; to: number }[]; word: boolean } {
  if (entry) {
    const m = { a: parasWith(a, entry), b: parasWith(b, entry), word: true }
    if (m.a.length || m.b.length) return m
  }
  return { ...sameParas(a, b), word: false }
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
