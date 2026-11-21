/**
 * 文件的属性（方向 B，样子照 four-items 小样 2a）：标签条右端分段控件前一颗「属性」按钮，点开 320 宽的小弹层（有附件时 340），一行一个属性，
 * 名字一列 64、值是 26 高的框，类型、课程是下拉，别的直接改，软件读来的（视频的网站、时长、字幕，剪藏的来源）只看；
 * AI 填的标着「AI 填的」，用户改过就去掉。改属性不挪文件、不改名。
 * 按类型列项（CN-123、task-zligc，shared/prop-view.ts）：书摘列类型、作者、来源、划线、想法；视频列类型、网站、频道、时长、字幕、来源；
 * 剪藏列类型、来源、剪于；旧书摘的 type: weread 当书摘，选类型就地换掉那一行（CN-131）。
 */
import { Codicon } from '@cn/design'
import { setPropByUser } from '@cn/format'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { coursesOf } from '../../shared/mindmap'
import { propRows } from '../../shared/prop-view'
import { AttachGrid, AttachList, useAttachments } from '../PropsAttach'

export const TYPES = ['课件', '笔记', '导图', '可视化', '书摘']

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
  // 按类型列项，界面上的名字照软件的语言（文件里的键不改）：shared/prop-view.ts
  const rows = propRows(props.text)
  const [adding, setAdding] = useState(false)
  const courses = coursesOf(props.notes.map((n) => n.path))
  const set = (k: string, v: string) => props.onChange(setPropByUser(props.text, k, v.trim() === '' ? undefined : v))
  const [att, reload] = useAttachments(props.path, props.text)
  const [grid, setGrid] = useState(false)
  // 附件文件夹有就打开它，没有（图都在别处）就在访达里显示这篇
  const reveal = () => window.cnMenu.reveal(att?.dirExists ? att.dir : props.path)
  const pop = useRef<HTMLDivElement>(null)
  useKeepInside(pop, `${grid}${att?.items.length ?? 0}`)
  if (grid && att)
    return (
      <div ref={pop} className="mm-props grid" role="dialog" aria-label="附件">
        <AttachGrid a={att} onBack={() => setGrid(false)} onReveal={reveal} onJump={props.onJump} reload={reload} />
      </div>
    )
  return (
    <div ref={pop} className={'mm-props' + (att?.items.length ? ' with-attach' : '')} role="dialog" aria-label="属性">
      <h4>属性</h4>
      {rows.map((r) => (
        <div className={'pr' + (r.ai ? ' has-ai' : '')} key={r.key}>
          <span className="k">{r.label}</span>
          {r.kind === 'select' ? (
            <span className="sel">
              <select aria-label={r.label} value={r.raw} disabled={props.readOnly} onChange={(e) => set(r.key, e.target.value)}>
                <option value="">（没填）</option>
                {[...new Set([...(r.key === '类型' ? TYPES : courses), ...(r.raw ? [r.raw] : [])])].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <Codicon name="chevron-down" size={12} />
            </span>
          ) : r.kind === 'text' ? (
            <span className="v ro" title={r.raw === r.shown ? r.shown : `${r.shown}（文件里写的是 ${r.raw}）`}>
              {r.shown}
            </span>
          ) : (
            <PropInput label={r.label} value={r.raw} readOnly={props.readOnly} onCommit={(v) => set(r.key, v)} />
          )}
          {r.ai && <span className="ai">AI 填的</span>}
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
      <p className="foot">
        <span>AI 认出来当场填好，你改了以你为准。</span>
        <span>存在文件开头；改属性不挪文件、不改名。</span>
      </p>
    </div>
  )
}

/**
 * 弹层贴着「属性」按钮右边往左长；中间栏窄（右边开着网页，中间只剩 420）时左边会伸出中间栏被切掉：
 * 往右挪到不出中间栏左边（离边 8），右边也不出中间栏；中间栏比弹层还窄时弹层跟着收窄
 */
function useKeepInside(ref: RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.closest<HTMLElement>('main.center')
    if (!el || !box) return
    el.style.right = ''
    el.style.maxWidth = ''
    const b = box.getBoundingClientRect()
    el.style.maxWidth = `${Math.max(240, b.width - 16)}px`
    const r = el.getBoundingClientRect()
    const room = b.right - 8 - r.right
    const need = b.left + 8 - r.left
    if (need > 0) el.style.right = `${-Math.min(need, Math.max(0, room))}px`
  }, [ref, key])
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
