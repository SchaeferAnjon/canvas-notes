/**
 * 对比标签（CN-48 方向 A，照 GitHub 提交页 / VS Code 的 changes）：历史里一次提交、梦游的一条改动、可能重复的两篇。
 * 每个文件一段：文件条（路径、+N −N、一句人话、打开这篇）+ 对比。md 两列各有行号，改的行整行淡绿淡红、改的字更深，
 * 没改的折起来（「展开没改的 N 行」点开，能一路展开到整篇）；新建的 md 只显示一列全文；新建的 HTML、大文件一行，源码默认收起。
 * 标签右端：文档 / 源码、并排 / 合一（中间栏窄于 900 自动合一）、上一处 / 下一处。两边都只读，要改点「打开这篇」。
 * 用 @codemirror/merge（MIT）的 MergeView 和 unifiedMergeView。
 */
import { Codicon } from '@cn/design'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BIG_LINES, type DiffEntry, type DiffResult, type DiffSource, sizeText } from '../../shared/diff'
import { blocksField, editorHost } from '../editor-host'
import { livePreview } from '../live-preview'
import { mdWidgets } from '../md-widgets'
import { propsBlock } from '../mindmap/props-block'
import { fileIcon } from '../Palette'
import { ActBtn, PageNote, TabActs } from '../shell/TabActs'
import './diff.css'

type Look = 'doc' | 'source'
type Layout = 'split' | 'unified'

/** 设好就收起来：上次选的看法、排法记住（本机） */
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

/** 中间栏窄于这个宽度时自动合一（GitHub 也这样） */
export const NARROW = 900
const COLLAPSE = { margin: 3, minSize: 6 }
const phrases = EditorState.phrases.of({ '$ unchanged lines': '展开没改的 $ 行' })

function baseExt(path: string, look: Look, md: boolean): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    lineNumbers(),
    phrases,
    ...(md ? [markdown({ base: markdownLanguage })] : []),
    // 文档：用编辑器现成的实时预览画（标题是标题、链接是链接、图片是图片）
    ...(md && look === 'doc' ? [livePreview, propsBlock, editorHost.of({ path: () => path, notice: () => {} }), blocksField, mdWidgets] : []),
  ]
}

export function DiffTab(props: {
  src: DiffSource
  active: boolean
  /** 库的 Git 状态每变一次（提交了、自动提交了、文件变了）加一：「还没提交的改动」跟着重读 */
  gitVersion: number
  /** 打开这篇（现在库里的） */
  onOpen(path: string): void
  /** 预览 HTML：梦游的看梦游分支上那份 */
  onPreviewHtml(path: string, dream: boolean): void
  onNotice(text: string): void
}) {
  const { src } = props
  const [res, setRes] = useState<DiffResult | { error: string } | null>(null)
  const [look, setLook] = useState<Look>(() => remembered('cn.diffLook', 'doc', ['doc', 'source'] as const))
  const [layout, setLayout] = useState<Layout>(() => remembered('cn.diffLayout', 'split', ['split', 'unified'] as const))
  const [narrow, setNarrow] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // 换的只是要滚到哪个文件时不重读；「还没提交的改动」每次切回这个标签、库的 Git 状态每次变了都重读
  // （第 3 轮：标签开着点「现在提交」，标签还写「→ 现在 · 还没提交」列着刚提交的文件）
  const [gen, setGen] = useState(0)
  const wasActive = useRef(props.active)
  useEffect(() => {
    if (props.active && !wasActive.current && src.kind === 'working') setGen((g) => g + 1)
    wasActive.current = props.active
  }, [props.active, src.kind])
  const srcKey = JSON.stringify({ ...src, focus: undefined })
  const key = srcKey + (src.kind === 'working' ? `:${gen}:${props.gitVersion}` : '')
  /** 上次读的是哪一份：同一份重读时旧的留着、新的到了再换（不闪「读取中」） */
  const readFor = useRef('')

  useEffect(() => {
    let stale = false
    if (readFor.current !== srcKey) setRes(null)
    readFor.current = srcKey
    window.cn.diffFiles(src).then(
      (r) => !stale && setRes(r),
      (e: unknown) => !stale && setRes({ error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }),
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setNarrow(el.clientWidth < NARROW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 侧栏点的那个文件：滚到它那段
  const focus = 'focus' in src ? src.focus : undefined
  useEffect(() => {
    if (!res || 'error' in res || !focus) return
    const sec = box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focus)}"]`)
    sec?.scrollIntoView({ block: 'start' })
  }, [res, focus])

  const shown: Layout = narrow ? 'unified' : layout

  /** 上一处 / 下一处：所有文件里改了的那些块，按在页面上的位置排 */
  function step(dir: 1 | -1) {
    const scroller = box.current
    if (!scroller) return
    const starts = [...scroller.querySelectorAll<HTMLElement>('.cm-merge-b .cm-changedLine, .dv-unified .cm-changedLine, .dv-unified .cm-deletedChunk')].filter((el) => {
      const prev = el.previousElementSibling
      return !prev || !(prev.classList.contains('cm-changedLine') || prev.classList.contains('cm-deletedChunk'))
    })
    const top = scroller.getBoundingClientRect().top
    const ys = starts.map((el) => el.getBoundingClientRect().top - top)
    const next = dir === 1 ? ys.findIndex((y) => y > 40) : ys.map((y, i) => [y, i] as const).filter(([y]) => y < -4).pop()?.[1] ?? -1
    if (next === -1) return props.onNotice(dir === 1 ? '后面没有改动了' : '前面没有改动了')
    scroller.scrollBy({ top: ys[next]! - 40 })
  }

  return (
    <section className="pane dv" hidden={!props.active} data-testid="diff-tab">
      <TabActs active={props.active}>
        {res && !('error' in res) && <PageNote>{res.note}</PageNote>}
        <div className="seg" role="tablist" aria-label="看法">
          {(
            [
              ['doc', 'file-text', '文档'],
              ['source', 'code', '源码'],
            ] as const
          ).map(([m, icon, name]) => (
            <button key={m} className={look === m ? 'on' : ''} onClick={() => (setLook(m), remember('cn.diffLook', m))} role="tab" aria-selected={look === m} aria-label={name} data-tip={name} data-side="below">
              <Codicon name={icon} size={14} />
              <span className="lb">{name}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="排法">
          {(
            [
              ['split', 'split-horizontal', '并排'],
              ['unified', 'diff-single', '合一'],
            ] as const
          ).map(([m, icon, name]) => (
            <button
              key={m}
              className={shown === m ? 'on' : ''}
              disabled={narrow && m === 'split'}
              onClick={() => (setLayout(m), remember('cn.diffLayout', m))}
              role="tab"
              aria-selected={shown === m}
              aria-label={name}
              data-tip={narrow && m === 'split' ? '中间栏太窄，自动合一' : name}
              data-side="below"
            >
              <Codicon name={icon} size={14} />
              <span className="lb">{name}</span>
            </button>
          ))}
        </div>
        {/* 一处改动都没有（都提交了）：上一处、下一处灰掉 */}
        <ActBtn icon="arrow-up" label="上一处" disabled={!res || 'error' in res || !res.files.length} onClick={() => step(-1)} />
        <ActBtn icon="arrow-down" label="下一处" disabled={!res || 'error' in res || !res.files.length} onClick={() => step(1)} />
      </TabActs>
      <div className="dv-body" ref={box}>
        {!res && <p className="dv-empty">读取中…</p>}
        {res && 'error' in res && <p className="dv-empty">读不出这次改动：{res.error}</p>}
        {res && !('error' in res) && res.files.length === 0 && <p className="dv-empty">{src.kind === 'working' ? '都提交了，没有还没提交的改动' : '这次没有改动'}</p>}
        {res &&
          !('error' in res) &&
          res.files.map((f) => (
            <FileSection key={f.path + (f.from ?? '')} f={f} res={res} look={look} layout={shown} dream={src.kind === 'dream'} onOpen={props.onOpen} onPreviewHtml={props.onPreviewHtml} />
          ))}
      </div>
    </section>
  )
}

function FileSection(props: { f: DiffEntry; res: DiffResult; look: Look; layout: Layout; dream: boolean; onOpen(path: string): void; onPreviewHtml(path: string, dream: boolean): void }) {
  const { f } = props
  const [open, setOpen] = useState(true)
  const text = f.kind === 'md' || f.kind === 'text'
  const lines = (f.after ?? f.before ?? '').split('\n').length
  // 新建的大文件、HTML：只露一行，源码默认收起
  const oneLine = f.kind === 'html' || f.kind === 'binary' || (text && f.status === 'new' && lines > BIG_LINES)
  const [src, setSrc] = useState(false)
  return (
    <section className="dv-file" data-file={f.path} aria-label={f.path}>
      <header className="dv-fh">
        <button className="dv-tw" aria-label={open ? '收起这个文件' : '展开这个文件'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        <Codicon name={fileIcon(f.path)} size={16} />
        <span className="dv-path truncate">{f.from && f.from !== f.path ? `${f.from} → ${f.path}` : f.path}</span>
        {f.status === 'new' && <span className="dv-tag">新文件</span>}
        {f.status === 'deleted' && <span className="dv-tag del">删了</span>}
        {text && (f.added > 0 || f.removed > 0) && (
          <span className="dv-num num">
            <span className="add">+{f.added}</span> <span className="del">−{f.removed}</span>
          </span>
        )}
        <span className="dv-sum truncate">{f.summary}</span>
        <span className="sp" />
        <button className="btn btn-ghost btn-sm" disabled={!f.exists} data-tip={f.exists ? undefined : '这篇现在已经不在原处了（挪走或删了）'} onClick={() => props.onOpen(f.path)}>
          <Codicon name="go-to-file" size={14} />
          打开这篇
        </button>
      </header>
      {open && oneLine && (
        <div className="dv-one">
          <span className="meta">
            {f.status === 'new' ? '新文件' : f.status === 'deleted' ? '删掉的文件' : '改了'} · {sizeText(f.size)}
            {text || f.kind === 'html' ? ` · ${lines}行` : ''}
          </span>
          <span className="sp" />
          {f.kind === 'html' && f.status !== 'deleted' && (f.exists || props.dream) && (
            <button className="btn btn-sm" onClick={() => props.onPreviewHtml(f.path, props.dream)}>
              <Codicon name="eye" size={14} />
              预览
            </button>
          )}
          {f.kind !== 'binary' && (
            <button className="btn btn-ghost btn-sm" aria-expanded={src} onClick={() => setSrc(!src)}>
              <Codicon name="code" size={14} />
              {src ? '收起源码' : f.kind === 'html' ? '看源码' : '看全文'}
            </button>
          )}
        </div>
      )}
      {open && f.kind === 'image' && <Images f={f} res={props.res} />}
      {open && (!oneLine || src) && f.kind !== 'image' && f.kind !== 'binary' && <TextDiff f={f} res={props.res} look={f.kind === 'md' && !(oneLine && src) ? props.look : 'source'} layout={props.layout} />}
    </section>
  )
}

function Images(props: { f: DiffEntry; res: DiffResult }) {
  const { f } = props
  if (!f.before && !f.after) return <div className="dv-one meta">图片太大，没放进对比 · {sizeText(f.size)}</div>
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

/** 一个文本文件的对比：两边都有 → 并排或合一；只有一边（新建、删掉）→ 一列全文 */
function TextDiff(props: { f: DiffEntry; res: DiffResult; look: Look; layout: Layout }) {
  const { f, look, layout } = props
  const host = useRef<HTMLDivElement>(null)
  const md = f.kind === 'md'
  const both = f.before !== null && f.after !== null
  const same = both && f.before === f.after
  useEffect(() => {
    const parent = host.current!
    const ext = baseExt(f.path, look, md)
    if (!both || same) {
      const v = new EditorView({ parent, state: EditorState.create({ doc: f.after ?? f.before ?? '', extensions: ext }) })
      return () => v.destroy()
    }
    if (layout === 'split') {
      const mv = new MergeView({ parent, a: { doc: f.before!, extensions: ext }, b: { doc: f.after!, extensions: ext }, collapseUnchanged: COLLAPSE, gutter: true, highlightChanges: true })
      return () => mv.destroy()
    }
    const v = new EditorView({ parent, state: EditorState.create({ doc: f.after!, extensions: [...ext, unifiedMergeView({ original: f.before!, mergeControls: false, collapseUnchanged: COLLAPSE, gutter: true, syntaxHighlightDeletions: false })] }) })
    return () => v.destroy()
  }, [f, look, layout, md, both, same])
  const label = !both ? (f.after !== null ? '这一版全文' : '删掉前的最后一版') : same ? '内容没变' : null
  return (
    <div className={'dv-diff ' + (md && look === 'doc' ? 'doc-look' : 'src-look') + (layout === 'unified' || !both || same ? ' dv-unified' : ' dv-split')}>
      {label ? (
        <div className="dv-cols one">
          <span>{label}</span>
        </div>
      ) : layout === 'split' ? (
        <div className="dv-cols">
          <span>{props.res.left}</span>
          <span>{props.res.right}</span>
        </div>
      ) : (
        <div className="dv-cols one">
          <span>
            {props.res.left} → {props.res.right}
          </span>
        </div>
      )}
      <div className={md && look === 'doc' ? 'doc' : ''} ref={host} />
    </div>
  )
}
