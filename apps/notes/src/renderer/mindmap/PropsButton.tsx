/**
 * 文件的属性（方向 B）：标签条右端分段控件前一颗「属性」按钮，点开 320 宽的小弹层，一行一个属性，
 * 类型、课程是下拉，别的直接改；AI 填的标着「AI 填的」，用户改过就去掉。改属性不挪文件、不改名。
 * 按类型列项（CN-123）：书摘列类型、作者、来源、划线、想法，不列课程、第几讲；旧书摘的 type: weread 当书摘，选类型就地换掉那一行（CN-131）。
 */
import { Codicon } from '@cn/design'
import { aiFilled, fileType, HIDDEN_KEYS, readProps, setPropByUser } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { coursesOf } from '../../shared/mindmap'
import { AttachGrid, AttachList, useAttachments } from '../PropsAttach'

export const TYPES = ['课件', '笔记', '导图', '可视化', '书摘']
/** 常用的放前面，没写的也列出来让人填 */
const COMMON = ['类型', '课程', '第几讲', '来源', '日期']
/** 这几种类型自己的一套（写没写都列出来）；没列的类型用 COMMON */
const KEYS_BY_TYPE: Record<string, string[]> = { 书摘: ['类型', '作者', '来源', '划线', '想法'] }

type PropsProps = { path: string; text: string; notes: NoteFile[]; readOnly: boolean; onChange(text: string): void; /** 附件网格里双击一张：跳到文中那一处 */ onJump(offset: number): void }

export function PropsButton(props: PropsProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', off, true)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="mm-propbtn" ref={box}>
      <button className={'ab-act wt' + (open ? ' on' : '')} aria-label="属性" aria-expanded={open} data-tip="属性" data-side="below" onClick={() => setOpen((v) => !v)}>
        <Codicon name="tag" size={16} />
        <span className="lb">属性</span>
      </button>
      {open && <PropsPop {...props} />}
    </div>
  )
}

function PropsPop(props: PropsProps) {
  const all = readProps(props.text).filter((p) => !HIDDEN_KEYS.has(p.key))
  const ai = aiFilled(props.text)
  const type = fileType(props.text) ?? ''
  const own = Object.hasOwn(KEYS_BY_TYPE, type) ? KEYS_BY_TYPE[type]! : null
  const head = own ?? COMMON.filter((k) => all.some((p) => p.key === k) || k === '类型' || k === '课程')
  const keys = [...head, ...all.map((p) => p.key).filter((k) => !head.includes(k) && (own !== null || !COMMON.includes(k)))]
  const value = (k: string) => (k === '类型' ? type : (all.find((p) => p.key === k)?.value ?? ''))
  const [adding, setAdding] = useState(false)
  const courses = coursesOf(props.notes.map((n) => n.path))
  const set = (k: string, v: string) => props.onChange(setPropByUser(props.text, k, v.trim() === '' ? undefined : v))
  const [att, reload] = useAttachments(props.path, props.text)
  const [grid, setGrid] = useState(false)
  // 附件文件夹有就打开它，没有（图都在别处）就在访达里显示这篇
  const reveal = () => window.cnMenu.reveal(att?.dirExists ? att.dir : props.path)
  if (grid && att)
    return (
      <div className="mm-props grid" role="dialog" aria-label="附件">
        <AttachGrid a={att} onBack={() => setGrid(false)} onReveal={reveal} onJump={props.onJump} reload={reload} />
      </div>
    )
  return (
    <div className={'mm-props' + (att?.items.length ? ' with-attach' : '')} role="dialog" aria-label="属性">
      <h4>属性</h4>
      {keys.map((k) => (
        <div className="pr" key={k}>
          <span className="k">{k}</span>
          {k === '类型' || k === '课程' ? (
            <select aria-label={k} value={value(k)} disabled={props.readOnly} onChange={(e) => set(k, e.target.value)}>
              <option value="">（没填）</option>
              {[...new Set([...(k === '类型' ? TYPES : courses), ...(value(k) ? [value(k)] : [])])].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <PropInput label={k} value={value(k)} readOnly={props.readOnly} onCommit={(v) => set(k, v)} />
          )}
          <span className="ai">{ai.includes(k) && value(k) ? 'AI填的' : ''}</span>
        </div>
      ))}
      {adding ? (
        <NewProp
          onDone={(k, v) => {
            setAdding(false)
            if (k && v) set(k, v)
          }}
        />
      ) : (
        !props.readOnly && (
          <button className="add" onClick={() => setAdding(true)}>
            <Codicon name="add" size={12} />
            加一个属性
          </button>
        )
      )}
      {att && <AttachList a={att} onAll={() => setGrid(true)} onReveal={reveal} reload={reload} />}
      <p className="foot">AI认出来当场填好，你改了以你为准。存在文件开头；改属性不挪文件、不改名。</p>
    </div>
  )
}

function PropInput(props: { label: string; value: string; readOnly: boolean; onCommit(v: string): void }) {
  const [v, setV] = useState(props.value)
  useEffect(() => setV(props.value), [props.value])
  return (
    <input
      aria-label={props.label}
      value={v}
      readOnly={props.readOnly}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== props.value && props.onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.preventDefault(), e.currentTarget.blur())
      }}
    />
  )
}

function NewProp(props: { onDone(k: string, v: string): void }) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const done = () => props.onDone(k.trim().replace(/[:#\n]/g, ''), v.trim())
  return (
    <div
      className="pr new"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) done()
      }}
    >
      <input className="k" aria-label="属性名" placeholder="名字" autoFocus value={k} onChange={(e) => setK(e.target.value)} />
      <input
        aria-label="属性值"
        placeholder="值"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.preventDefault(), done())
        }}
      />
    </div>
  )
}
