/**
 * 普通表格的行菜单、列菜单（task-cle3x，照 Notion 简单表格）：点行把手、列把手弹出来，样子和块菜单同一套（.blk-menu）。
 * ↑↓ 选、回车做、Esc 关；点外面也关。菜单本身不改文件，选了哪一项交回 table-edit.ts 去改。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { dismissable } from '@cn/design/dismiss'
import { Popover } from './editor-host'
import { anchorOf } from './pop-place'

export interface TableMenuItem {
  id: string
  /** 已经翻好的字（table-edit.ts 用 tNow 取） */
  label: string
  icon: CodiconName
  off?: boolean
  /** 打勾的那一项（对齐：现在是哪一种） */
  on?: boolean
  /** 这一项前面画一道分隔线 */
  sep?: boolean
}

function TableMenu(props: { label: string; items: TableMenuItem[]; onPick(id: string): void; onClose(): void }) {
  const live = props.items.filter((x) => !x.off)
  const [idx, setIdx] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const cur = live[idx]
  return (
    <div
      ref={ref}
      className="blk-menu tbl-menu"
      role="menu"
      aria-label={props.label}
      tabIndex={-1}
      onMouseLeave={() => setIdx(-1)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const d = e.key === 'ArrowDown' ? 1 : -1
          setIdx((i) => (i < 0 ? (d > 0 ? 0 : live.length - 1) : (i + d + live.length) % live.length))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (cur) props.onPick(cur.id)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onClose()
        }
      }}
    >
      {props.items.map((it) => (
        <div key={it.id} role="none">
          {it.sep && <div className="blk-sep" role="separator" />}
          <button
            role={it.on === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.on === undefined ? undefined : it.on}
            aria-disabled={it.off || undefined}
            className={(cur === it ? 'on' : '') + (it.off ? ' off' : '')}
            onMouseEnter={() => !it.off && setIdx(live.indexOf(it))}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => !it.off && props.onPick(it.id)}
          >
            {/* 单选的几项（对齐）：勾画在左边图标那一格，没选上的空着 */}
            <Codicon name={it.on === undefined ? it.icon : it.on ? 'check' : 'blank'} size={14} />
            <span className="lb">{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

let pop: Popover | null = null
let closeCur: (() => void) | null = null

/** 贴着把手弹一个菜单；关掉（选了一项、Esc、点外面）时调 onClose */
export function openTableMenu(anchor: HTMLElement, label: string, items: TableMenuItem[], onPick: (id: string) => void, onClose: () => void) {
  closeCur?.()
  pop ??= new Popover('blk-pop')
  const p = pop
  let off = () => {}
  function close() {
    if (closeCur !== close) return
    closeCur = null
    off()
    p.hide()
    onClose()
  }
  closeCur = close
  p.show(
    <TableMenu
      key={Date.now()}
      label={label}
      items={items}
      onPick={(id) => {
        close()
        onPick(id)
      }}
      onClose={close}
    />,
    anchorOf(anchor),
  )
  // 点外面（网页里也算）、Esc（焦点不在菜单里也算）、窗口失焦都关（公共的 dismissable）
  off = dismissable({ inside: () => [p.el, anchor], onClose: close })
}

/** 菜单开着吗（把手不收起来） */
export const tableMenuOpen = () => closeCur !== null
