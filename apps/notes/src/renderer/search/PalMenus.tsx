/**
 * ⌘K 里一条命令的菜单（DESIGN.v3 3.2）：钉住 ⌘P、挪到 ›、设快捷键…、起别名…、（自己加的）改这条命令… / 删掉这条、藏起 ⌘⌫；
 * 和它开的几个小弹层：设快捷键（按下组合键，撞了说撞了谁）、起别名、新的一组的名字。
 * 画在 ⌘K 的遮罩层里（fixed，窗口坐标），点它们不算点遮罩。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { comboOf, keyProblem } from '../../shared/cmd-keys'
import { ownerOf } from './cmd-store'

const W = 230
const SUB_W = 170

export interface MenuCmd {
  id: string
  name: string
  keys: string | null
  alias?: string
  pinned: boolean
  own: boolean
  /** 自己加的、表单改得了的（打开一处、打开网址）；以后的 AI 命令另有自己的改法 */
  ownEditable?: boolean
  /** 快捷键是它自己那块接的（双语翻译 ⌥A）：「设快捷键…」灰着 */
  fixedKeys?: boolean
}

export type MenuAct = { kind: 'pin' } | { kind: 'move'; to: string } | { kind: 'newGroup' } | { kind: 'keys' } | { kind: 'alias' } | { kind: 'edit' } | { kind: 'delete' } | { kind: 'hide' }

/** x：菜单的右边对齐到这里（照小样：⋯ 开的右边对齐 ⋯，右键开的在指针左边）；y：菜单的顶 */
export function RowMenu(props: {
  cmd: MenuCmd
  x: number
  y: number
  groups: { id: string; name: string }[]
  /** 按 ⌘. 开的：焦点进菜单第一项，↑↓ ↵ 能用；鼠标开的不抢焦点（照小样，不亮第一项） */
  byKey?: boolean
  onAct(a: MenuAct, at: { left: number; top: number }): void
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const moveBtn = useRef<HTMLButtonElement>(null)
  const [sub, setSub] = useState(false)
  const [pos, setPos] = useState({ left: Math.max(10, Math.min(props.x - W, window.innerWidth - W - 10)), top: props.y })
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setPos((p) => ({ ...p, top: Math.max(10, Math.min(props.y, window.innerHeight - h - 10)) }))
  }, [props.y])
  useEffect(() => {
    if (props.byKey) ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus()
  }, [props.byKey])
  const c = props.cmd
  const act = (a: MenuAct) => props.onAct(a, pos)
  const item = (icon: CodiconName, label: string, a: MenuAct, right?: React.ReactNode, cls = '', disabled = false) => (
    <button key={label} role="menuitem" className={'pal-mi' + cls} disabled={disabled} onClick={() => act(a)} onMouseEnter={() => setSub(false)}>
      <Codicon name={icon} size={14} />
      <span className="nm">{label}</span>
      {right}
    </button>
  )
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(sub ? '.pal-sub [role=menuitem]' : ':scope > [role=group] > [role=menuitem]:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    } else if (e.key === 'ArrowRight' && (document.activeElement as HTMLElement | null)?.dataset.sub) {
      e.preventDefault()
      setSub(true)
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.pal-sub [role=menuitem]')?.focus())
    } else if (e.key === 'ArrowLeft' && sub) {
      e.preventDefault()
      setSub(false)
      ref.current?.querySelector<HTMLButtonElement>('[data-sub]')?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    }
  }
  const subLeft = pos.left + W + SUB_W - 4 > window.innerWidth - 10 ? -SUB_W + 4 : W - 4
  return (
    <div ref={ref} className="pal-menu" role="menu" aria-label={`「${c.name}」能做什么`} style={{ left: pos.left, top: pos.top, width: W }} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
      <div className="pal-mhead">{c.name}</div>
      <div role="group">
        {item(c.pinned ? 'pinned' : 'pin', c.pinned ? '取消钉住' : '钉住', { kind: 'pin' }, <kbd>⌘P</kbd>)}
        <button ref={moveBtn} role="menuitem" className={'pal-mi' + (sub ? ' kb' : '')} data-sub="1" aria-haspopup="menu" aria-expanded={sub} onMouseEnter={() => setSub(true)} onClick={() => setSub(true)}>
          <Codicon name="arrow-right" size={14} />
          <span className="nm">挪到</span>
          <span className="sub">
            <Codicon name="chevron-right" size={12} />
          </span>
        </button>
        {sub && (
          <div className="pal-menu pal-sub" role="menu" aria-label="挪到" style={{ left: subLeft, top: (moveBtn.current?.offsetTop ?? 64) - 6, width: SUB_W }}>
            <div role="group">
              {props.groups.map((g) => (
                <button key={g.id} role="menuitem" className="pal-mi" onClick={() => act({ kind: 'move', to: g.id })}>
                  <span className="nm">{g.name}</span>
                </button>
              ))}
            </div>
            <div role="group">
              <button role="menuitem" className="pal-mi" onClick={() => act({ kind: 'newGroup' })}>
                <Codicon name="add" size={14} />
                <span className="nm">新的一组…</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <div role="group">
        {item('record-keys', '设快捷键…', { kind: 'keys' }, c.keys ? <kbd>{c.keys}</kbd> : undefined, '', !!c.fixedKeys)}
        {item('mention', '起别名…', { kind: 'alias' }, c.alias ? <span className="h">{c.alias}</span> : undefined)}
      </div>
      {c.own && (
        <div role="group">
          {c.ownEditable && item('edit', '改这条命令…', { kind: 'edit' })}
          {item('trash', '删掉这条', { kind: 'delete' }, undefined, ' danger')}
        </div>
      )}
      <div role="group">{item('eye-closed', '藏起', { kind: 'hide' }, <kbd>⌘⌫</kbd>)}</div>
    </div>
  )
}

/** 小弹层的位置：菜单左边往左 70（照小样），不出窗口 */
const miniPos = (at: { left: number; top: number }) => ({ left: Math.max(10, Math.min(at.left - 70, window.innerWidth - 310)), top: Math.max(10, Math.min(at.top, window.innerHeight - 180)) })

/** 设快捷键：按下组合键；撞了别的命令说撞了谁、按「好」换给这一条；软件自己的键、不带 ⌘ ⌃ 的「好」灰着 */
export function KeysMini(props: { id: string; name: string; at: { left: number; top: number }; onOk(combo: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [got, setGot] = useState<string | null>(null)
  useEffect(() => ref.current?.focus(), [])
  const problem = got ? keyProblem(got) : null
  const clash = got && !problem ? ownerOf(got, props.id) : null
  const why = problem ?? (clash ? `已经给了「${clash.name}」，按「好」就换给这一条` : null)
  return (
    <div
      ref={ref}
      className="pal-mini"
      role="dialog"
      aria-label="设快捷键"
      tabIndex={-1}
      style={miniPos(props.at)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 按下去的键只记下来，不让它走到别处（⌘N 不会新建笔记）
        e.preventDefault()
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') return props.onClose()
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && got && !problem) return props.onOk(got)
        const c = comboOf(e)
        if (c) setGot(c)
      }}
    >
      <div className="t">给「{props.name}」设快捷键（软件开着时在哪都能按）</div>
      <div className={'keys' + (got ? '' : ' wait')} aria-live="polite">
        {got ?? '现在按下组合键…'}
      </div>
      {why && <div className="why">{why}</div>}
      <div className="acts">
        <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
          取消
        </button>
        <button className="btn btn-sm btn-primary" disabled={!got || !!problem} onClick={() => got && props.onOk(got)}>
          好
        </button>
      </div>
    </div>
  )
}

/** 一行字的小弹层：起别名、新的一组的名字 */
export function TextMini(props: { label: string; title: string; value: string; placeholder: string; at: { left: number; top: number }; onOk(v: string): void; onClose(): void }) {
  const [v, setV] = useState(props.value)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <div className="pal-mini" role="dialog" aria-label={props.label} style={miniPos(props.at)} onMouseDown={(e) => e.stopPropagation()}>
      <div className="t">{props.title}</div>
      <input
        ref={input}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') (e.preventDefault(), props.onOk(v))
          if (e.key === 'Escape') (e.preventDefault(), props.onClose())
        }}
      />
      <div className="acts">
        <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
          取消
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => props.onOk(v)}>
          好
        </button>
      </div>
    </div>
  )
}
