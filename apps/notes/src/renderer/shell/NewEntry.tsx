/**
 * 标题栏「首页」右边的「+」（新建入口方案 A，设计页 149，用户 2026-11-25 定）：
 * 点「+」= 新建文档（和 ⌘N、左栏头上的「新建笔记」同一个 newNote）；小箭头、按住「+」半秒、右键「+」出同一份菜单：
 * 新建文档 / 新建白板 / 新建数据库 / 从模板…（模板还没做，灰着）。菜单底「放进 收件箱 ⌄」临时换地方，只管这一次（菜单收起就回规矩）；
 * 挑文件夹用和「移到…」同一个 MovePicker（选文件夹统一用它）。
 * 放哪不在这里算：where() 是 App 的 newNoteWhere（设置 › 文件和附件「新笔记放哪」），建东西都调 App 交进来的那几个函数。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { useKeys } from '../keys'
import { useT } from '../i18n'
import { MovePicker } from '../files/move-pick'
import { useNewNoteBusy } from '../new-note-hold'
import { folderLabel } from '../vault-name'
import { INBOX } from '../../shared/layout'
import { Popover } from './Shell'
import './new-entry.css'

export interface NewEntryActions {
  /** 照规矩新的放哪（App 的 newNoteWhere） */
  where(): string
  /** folder 不给 = 照规矩；给了 = 菜单底下临时挑的 */
  newNote(folder?: string): void
  newBoard(folder?: string): void
  newBase(folder?: string): void
}

/** 按住「+」多久出菜单 */
const HOLD_MS = 500

/** 文件夹在胶囊、提示上写什么：最后一节；库本身写库名 */
const nameOf = (folder: string) => folderLabel(folder).split('/').pop()!
const iconOf = (folder: string): CodiconName => (folder === INBOX ? 'inbox' : folder === '' ? 'root-folder' : 'folder')

export function NewEntry(props: NewEntryActions) {
  const t = useT()
  const K = useKeys()
  const busy = useNewNoteBusy()
  const box = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  /** 菜单底下临时挑的地方（null = 照规矩） */
  const [picked, setPicked] = useState<string | null>(null)
  /** 悬停提示：指上去那一刻按规矩算（目录树点了别的文件夹不一定让标题栏重画） */
  const [tipWhere, setTipWhere] = useState(() => props.where())
  const hold = useRef<{ timer: number; fired: boolean } | null>(null)
  /** 「放进 ⌄」点开的挑文件夹弹层贴着的那颗胶囊；开着时菜单不因为点在弹层里而收起 */
  const [chip, setChip] = useState<HTMLElement | null>(null)
  const picking = useRef(false)
  picking.current = chip !== null

  const show = () => {
    setPicked(null)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setPicked(null)
    setChip(null)
  }
  /** 菜单里点一项：先收菜单，再建（临时挑的地方只这一次） */
  const run = (make: (folder?: string) => void, folder: string | null) => {
    close()
    make(folder ?? undefined)
  }
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer)
  }
  const where = open ? (picked ?? props.where()) : tipWhere

  return (
    <span ref={box} className={'ne' + (open ? ' on' : '')}>
      <button
        className="tb-btn ne-plus"
        aria-label={t('新建文档')}
        aria-haspopup="menu"
        aria-busy={busy || undefined}
        data-tip={t('新建文档 · 放进「{name}」', { name: nameOf(where) })}
        data-key={K('new-note') ?? undefined}
        data-side="below"
        onMouseEnter={() => setTipWhere(props.where())}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          cancelHold()
          const h = { timer: 0, fired: false }
          h.timer = window.setTimeout(() => ((h.fired = true), show()), HOLD_MS)
          hold.current = h
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onClick={() => {
          // 按住出了菜单：松手那一下的 click 不再建
          if (hold.current?.fired) return void (hold.current = null)
          hold.current = null
          props.newNote()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          show()
        }}
      >
        <Codicon name="add" />
      </button>
      <button
        className="tb-btn ne-chev"
        aria-label={t('新建白板、数据库…')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={t('新建白板、数据库…')}
        data-side="below"
        onClick={() => (open ? close() : show())}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          show()
        }}
      >
        <Codicon name="chevron-down" size={11} />
      </button>
      {open && box.current && (
        <Popover anchor={box.current} label={t('新建')} className="pop12 ne-menu" onClose={() => !picking.current && close()}>
          <NewMenu
            where={where}
            keys={{ note: K('new-note'), board: K('new-board') }}
            onNote={() => run(props.newNote, picked)}
            onBoard={() => run(props.newBoard, picked)}
            onBase={() => run(props.newBase, picked)}
            onPick={(el) => setChip((c) => (c ? null : el))}
            picking={chip !== null}
          />
        </Popover>
      )}
      {open && chip && <MovePicker paths={[]} dirs={[]} head={t('放进哪个文件夹…')} anchor={chip} onPick={(f) => setPicked(f)} onClose={() => setChip(null)} />}
    </span>
  )
}

function NewMenu(props: { where: string; keys: { note: string | null; board: string | null }; onNote(): void; onBoard(): void; onBase(): void; onPick(at: HTMLElement): void; picking: boolean }) {
  const t = useT()
  const list = useRef<HTMLDivElement>(null)
  // 开着就停在第一项（效果图上「新建文档」是亮的），回车就建。弹层先藏着量好位置才露出来，藏着时 focus 不上：一帧帧等到 focus 上为止（最多 30 帧）
  useEffect(() => {
    let raf = 0
    const tryFocus = (n: number) => {
      const first = list.current?.querySelector<HTMLButtonElement>('.mi')
      first?.focus({ preventScroll: true })
      if (document.activeElement !== first && n > 0) raf = requestAnimationFrame(() => tryFocus(n - 1))
    }
    raf = requestAnimationFrame(() => tryFocus(30))
    return () => cancelAnimationFrame(raf)
  }, [])
  /** ↑↓ 在四项之间走（灰着的跳过），回车点 */
  const step = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }
  return (
    <div ref={list} role="menu" onKeyDown={step}>
      <button className="mi" role="menuitem" onClick={props.onNote}>
        <Codicon name="new-file" />
        <span className="truncate">{t('新建文档')}</span>
        {props.keys.note && <span className="r">{props.keys.note}</span>}
      </button>
      <button className="mi" role="menuitem" onClick={props.onBoard}>
        <Codicon name="layout" />
        <span className="truncate">{t('新建白板')}</span>
        {props.keys.board && <span className="r">{props.keys.board}</span>}
      </button>
      <button className="mi" role="menuitem" onClick={props.onBase}>
        <Codicon name="database" />
        <span className="truncate">{t('新建数据库')}</span>
      </button>
      <button className="mi ne-tpl" role="menuitem" disabled>
        <Codicon name="notebook-template" />
        <span className="truncate">{t('从模板…')}</span>
        <span className="r">{t('要先做模板')}</span>
      </button>
      <div className="ms" />
      <div className="ne-foot">
        <span>{t('放进')}</span>
        <button className="ne-chip" aria-label={t('放进「{name}」，点它换地方', { name: nameOf(props.where) })} title={folderLabel(props.where)}
          aria-expanded={props.picking}
          // 小框开着时再点胶囊是收起：别让小框的「点外面就收」先收、这一下又打开
          onMouseDown={(e) => props.picking && e.stopPropagation()}
          onClick={(e) => props.onPick(e.currentTarget.querySelector<HTMLElement>('.ne-pick-at')!)}
        >
          <i className="ne-pick-at" aria-hidden="true" />
          <Codicon name={iconOf(props.where)} size={13} />
          <span className="truncate">{nameOf(props.where)}</span>
          <Codicon name="chevron-down" size={11} />
        </button>
        <span className="ne-hint">{t('点它换地方')}</span>
      </div>
    </div>
  )
}
