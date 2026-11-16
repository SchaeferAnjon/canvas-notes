/**
 * 对照读的几块小东西：PDF 并排时右边那一栏（这一页的译文）、双语工具条（吸在页面区顶上）、术语表小卡。
 * 照 design/pdf spec 2.2、2.4。
 */
import { Codicon } from '@cn/design'
import { biKind, translatable } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { glossaryPath, parseGlossary, type Term } from '../../../shared/plugins/translate'
import type { FlowBlock } from './ReflowView'
import { type BiLayout, hashOf, request, useBi } from './store'

/** 并排：右边这一页的译文，一块一段；公式和图只占一行「公式和图不翻译，看左边原页」（连着的并成一行） */
export function SideCol(props: {
  srcKey: string
  blocks: FlowBlock[] | undefined
  course: string | null
  height: number
  /** 这一页看得到（上下多一屏）才翻 */
  visible: boolean
  hover: string | null
  onHover(id: string | null): void
}) {
  const bi = useBi(props.srcKey)
  const { blocks, visible, srcKey, course } = props
  useEffect(() => {
    if (visible && blocks) void request(srcKey, translatable(blocks), course)
  }, [visible, blocks, srcKey, course])
  if (!blocks) return <div className="bicol" style={{ height: props.height }} />
  const rows: ({ k: 'skip'; id: string } | { k: 'tr'; b: FlowBlock })[] = []
  for (const b of blocks) {
    const kind = biKind(b)
    if (kind === 'formula' || kind === 'figure') {
      if (rows[rows.length - 1]?.k !== 'skip') rows.push({ k: 'skip', id: b.id })
    } else if (translatable([b]).length) rows.push({ k: 'tr', b })
  }
  return (
    <div className="bicol" style={{ maxHeight: props.height }} onMouseLeave={() => props.onHover(null)} data-testid="bi-side">
      {rows.map((r) =>
        r.k === 'skip' ? (
          <p key={r.id} className="skip">
            <Codicon name="screen-full" size={12} />
            公式和图不翻译，看左边原页
          </p>
        ) : (
          <SideBlock key={r.b.id} b={r.b} tr={bi.tr[hashOf(r.b.text)]} on={props.hover === r.b.id} onEnter={() => props.onHover(r.b.id)} />
        ),
      )}
    </div>
  )
}

function SideBlock({ b, tr, on, onEnter }: { b: FlowBlock; tr: { state: string; text?: string; error?: string } | undefined; on: boolean; onEnter(): void }) {
  return (
    <p className={'sb' + (b.kind === 'heading' ? ' h' : '') + (on ? ' on' : '') + (tr?.state === 'err' ? ' err' : '')} data-block={b.id} onMouseEnter={onEnter}>
      {tr?.text ? tr.text : tr?.state === 'err' ? `没翻成：${tr.error}` : <span className="wait" aria-label="正在翻" />}
    </p>
  )
}

/** 双语工具条：英文 → 中文、并排 / 重排（只在对照）、译文进度、术语表、存成双语笔记 */
export function BiBar(props: {
  langs: string
  layout: BiLayout | null
  onLayout?(l: BiLayout): void
  status: string
  busy: boolean
  course: string | null
  saved: string | null
  saving: string | null
  onSave(): void
  onOpenSaved(path: string): void
  onOpenGlossary(path: string): void
}) {
  return (
    <div className="bibar" role="toolbar" aria-label="双语工具条">
      <span className="tl">{props.langs}</span>
      {props.layout && props.onLayout && (
        <div className="seg" role="radiogroup" aria-label="对照的版式">
          <button type="button" role="radio" aria-checked={props.layout === 'side'} className={props.layout === 'side' ? 'on' : ''} title="左边原页，右边译文，一页对一页" onClick={() => props.onLayout!('side')}>
            并排
          </button>
          <button type="button" role="radio" aria-checked={props.layout === 'flow'} className={props.layout === 'flow' ? 'on' : ''} title="不要原版式，一段原文跟一段译文" onClick={() => props.onLayout!('flow')}>
            重排
          </button>
        </div>
      )}
      <span className="sp" />
      <span className="tier num" data-testid="bi-status">
        {props.busy && <Codicon name="loading" size={12} className="spin" />}
        {props.status}
      </span>
      {props.course && <GlossaryButton course={props.course} onOpen={props.onOpenGlossary} />}
      {props.saved ? (
        <button type="button" className="btn btn-sm" onClick={() => props.onOpenSaved(props.saved!)} title={props.saved}>
          <Codicon name="check" size={14} />
          已存成双语笔记
        </button>
      ) : (
        <button type="button" className="btn btn-sm" disabled={!!props.saving} onClick={props.onSave}>
          <Codicon name={props.saving ? 'loading' : 'edit'} size={14} className={props.saving ? 'spin' : undefined} />
          {props.saving ?? '存成双语笔记'}
        </button>
      )}
    </div>
  )
}

/** 「术语表 · 8 条」幽灵按钮 + 280 宽小卡（一行一条，英文左、中文右）；改就开 md 改 */
function GlossaryButton({ course, onOpen }: { course: string; onOpen(path: string): void }) {
  const path = glossaryPath(course)
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    const read = () =>
      window.cn.readNote(path).then(
        (n) => alive && setTerms(parseGlossary(n.text)),
        () => alive && setTerms(null),
      )
    void read()
    const off = window.cn.onNoteChanged((p) => p === path && void read())
    return () => {
      alive = false
      off()
    }
  }, [path])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!terms) return null
  return (
    <div className="bigloss" ref={ref}>
      <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Codicon name="book" size={14} />
        术语表 · {terms.length} 条
      </button>
      {open && (
        <div className="glosspop" role="dialog" aria-label="术语表">
          <div className="gl-list">
            {terms.map((t) => (
              <div key={t.src} className="gl-row">
                <span className="s truncate">{t.src}</span>
                <span className="d truncate">{t.dst}</span>
              </div>
            ))}
            {!terms.length && <p className="gl-empty">表里还没有词</p>}
          </div>
          <div className="gl-foot">
            翻译和 AI 讲解都照这里的叫法 ·{' '}
            <button type="button" className="lnk" onClick={() => (setOpen(false), onOpen(path))}>
              打开 术语表.md
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
