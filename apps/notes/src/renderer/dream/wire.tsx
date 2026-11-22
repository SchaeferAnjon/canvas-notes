/**
 * 梦游重新设计（task-m552v）接到 App 上的那几根线，放在这里让 App.tsx 只改几行：
 * - useDreamWiring：报告交给 nav（左栏、中间、目录树共用）；登记打开一条、收下、丢掉、撤回的跑法；梦游对照里嵌着的可视化「放大」开哪一份。
 * - CompareTab：中间的对比标签，梦游的一条、历史里收下梦游的那次提交画成梦游对照（DreamTab），别的照旧是对比标签（DiffTab）。
 * - openFirstDream：首页「看报告」开第一条没处理的（demo 的 report）。
 */
import { useEffect, useRef } from 'react'
import type { DreamItem, DreamReport } from '../../shared/api'
import type { DiffSource } from '../../shared/diff'
import { displayOrder } from '../../shared/dream-order'
import { titleOf } from '../../shared/layout'
import { DiffTab } from '../diff/DiffTab'
import { NoteDoc } from '../note-doc'
import { DreamTab } from './DreamTab'
import { dreamNow, openDream, setDreamActs, setReport } from './nav'
import { expectDreamChange } from './own-change'

const short = (s: string, n = 16) => (s.length > n ? s.slice(0, n) + '…' : s)

/** 梦游对照标签的名字：「梦游 · 极光 2」 */
export const dreamTabTitle = (it: DreamItem) => `梦游 · ${short(it.title)}`

export function useDreamWiring(o: {
  report: DreamReport | null
  setReport(r: DreamReport): void
  openDiff(src: DiffSource, title: string): void
  take(it: DreamItem): Promise<DreamReport | null>
  drop(it: DreamItem): Promise<DreamReport | null>
  notice(text: string): void
  undoFailed(e: unknown): void
  /** 撤回以后左栏、底栏重读 */
  refresh(): void
  /** 可视化整页打开：还没收下的开梦游分支上那份 */
  openHtml(path: string, branch: boolean): void
}) {
  useEffect(() => setReport(o.report), [o.report])
  const ref = useRef(o)
  ref.current = o
  useEffect(() => {
    setDreamActs({
      open(id, focus) {
        const it = ref.current.report?.items.find((i) => i.id === id) ?? dreamNow().report?.items.find((i) => i.id === id)
        if (it) ref.current.openDiff({ kind: 'dream', id, ...(focus ? { focus } : {}) }, dreamTabTitle(it))
      },
      take: (it) => ref.current.take(it),
      drop: (it) => ref.current.drop(it),
      async undo(it) {
        try {
          // 撤回也是软件自己改开着的那篇：先存盘，提示说撤回了，不说外部改动
          expectDreamChange([it])
          await NoteDoc.saveAll()
          const u = await window.cn.dreamUndo({ ids: [it.id], ...(it.state === 'taken' && it.taken ? { taken: it.taken } : {}) })
          ref.current.setReport(u.report)
          ref.current.notice('撤回了，这条又等你过目')
          ref.current.refresh()
          openDream(it.id)
          return u.report
        } catch (e) {
          ref.current.undoFailed(e)
          return null
        }
      },
    })
    const onViz = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; pending: boolean }>).detail
      ref.current.openHtml(d.path, d.pending)
    }
    window.addEventListener('cn:dream-open-viz', onViz)
    return () => {
      setDreamActs(null)
      window.removeEventListener('cn:dream-open-viz', onViz)
    }
  }, [])
}

/** 首页「看报告」：中间开第一条没处理的 */
export function openFirstDream(report: DreamReport | null) {
  const it = report ? (displayOrder(report.items).find((i) => i.state === 'pending') ?? null) : null
  if (it) openDream(it.id)
}

/** 历史里点的这次提交是不是收下梦游的那次：是就给那一条（同一次收下好几条时取改了点的那个文件的那条） */
function itemOfCommit(report: DreamReport | null, hash: string, focus?: string): DreamItem | undefined {
  const hits = (report?.items ?? []).filter((i) => i.taken && (i.taken.startsWith(hash) || hash.startsWith(i.taken)))
  return hits.find((i) => focus && (i.files.includes(focus) || i.move?.to === focus)) ?? hits[0]
}

export function CompareTab(props: {
  src: DiffSource
  title: string
  active: boolean
  gitVersion: number
  report: DreamReport | null
  onOpen(path: string, line?: number): void
  onPreviewHtml(path: string, dream: boolean): void
  openDiff(src: DiffSource, title: string): void
  /** 左栏换到梦游报告 */
  onShowReport(): void
  onNotice(text: string): void
}) {
  const { src } = props
  const hist = src.kind === 'commit' ? itemOfCommit(props.report, src.hash, src.focus) : undefined
  if (src.kind !== 'dream' && !hist)
    return <DiffTab src={src} active={props.active} gitVersion={props.gitVersion} onOpen={(p) => props.onOpen(p)} onPreviewHtml={props.onPreviewHtml} onNotice={props.onNotice} />
  return (
    <DreamTab
      src={src}
      report={props.report}
      {...(hist ? { hist } : {})}
      active={props.active}
      gitVersion={props.gitVersion}
      onOpenPath={props.onOpen}
      onOpenBranch={(p, rev) => (/\.html?$/i.test(p) ? props.onPreviewHtml(p, true) : rev && props.openDiff({ kind: 'version', hash: rev, path: p }, `${titleOf(p)} · 梦游分支上的`))}
      onFocus={(p) => props.openDiff({ ...src, focus: p } as DiffSource, props.title)}
      onShowInReport={(id) => (props.onShowReport(), openDream(id))}
      onNotice={props.onNotice}
    />
  )
}
