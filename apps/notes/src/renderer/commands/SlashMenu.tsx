/**
 * AI 输入框打 / 的菜单（task-9womr，小样 proto-c2.html「/ 菜单」一节，偏好「/ 菜单列全、固定高度能滚」）：
 * 这里能用的全列出来，按「我的命令 / 这一篇 / 整个库」分组（组间一道横线、组名写在横线下面，照 ⌘K），列表高度定死 392，
 * 多了上下滚，打字筛的时候高度不变、菜单不跳。每条两行：引擎标志（不经 AI 的用自己的图标）、名字、写到哪的小标签，下一行做什么。
 * 右键一条（或选中时 ⌘.）：自带的「复制一份再改」、往上挪、往下挪、藏起；自己的「改这条命令」、挪、藏起、删掉；
 * 藏起的在最下面「藏着的 N 条」里放回。AI 对话和读 PDF 的输入框共用。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EngineId } from '../../shared/agent'
import { type AiCmd, type Builtin, type Ctx, hiddenHere, hideSlash, moveInGroup, type SlashGroup, slashGroups, type SlashItem, unhideSlash } from '../../shared/ai-cmds'
import { EngineLogo } from '../engine-logo'
import { isKey, keyFor } from '../keys'
import { useDismiss } from '../use-dismiss'
import { deleteAiCmd, updateSlash, useAiCmds } from './store'
import './slash.css'

export interface SlashOpts {
  /** 输入框里的字（/ 开头、中间没空格时菜单开着） */
  text: string
  /** 「这一篇」那一组按哪里列 */
  here: Ctx
  /** 也算「在这里」的（右栏开着网页、视频） */
  also?: Ctx[]
  /** 画哪一家的标志 */
  engine: EngineId
  onRun(item: SlashItem): void
  /** esc：清掉输入框里的 / */
  onClose(): void
  /** 改自己的命令、复制一份自带的再改：开「存成命令」那张表 */
  onEdit(cmd: AiCmd): void
  onCopy(b: Builtin): void
}

/** 列表定死的高（小样 392，和原来 8 条一样高）、底下那一行的高 */
const LIST_H = 392
const FOOT_H = 28

/** 一条命令的小菜单里的一项 */
interface RowAction {
  label: string
  icon: CodiconName
  red?: boolean
  disabled?: boolean
  run(): void
}

/** 底部一行提示（藏起了…、删掉了…），4 秒收起，右边「撤回」 */
interface Toast {
  text: string
  undo?: () => Promise<void>
}

export function useSlash(o: SlashOpts): { open: boolean; items: SlashItem[]; onKey(e: React.KeyboardEvent): boolean; menu: ReactNode } {
  const { mine, slash } = useAiCmds()
  const m = /^\/(\S*)$/.exec(o.text)
  const open = !!m
  const q = m?.[1] ?? ''
  const groups = open ? slashGroups({ here: o.here, also: o.also ?? [], q, mine, slash }) : []
  const items = groups.flatMap((g) => g.items)
  const hidden = open && !q ? hiddenHere({ here: o.here, also: o.also ?? [], mine, slash }) : []
  const [sel, setSel] = useState(0)
  const [rowMenu, setRowMenu] = useState<{ item: SlashItem; at: { left: number; top: number } } | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // 打的字一变，回到第一条；菜单收起时收掉小菜单
  useEffect(() => setSel(0), [q, open])
  useEffect(() => {
    if (!open) (setRowMenu(null), setShowHidden(false))
  }, [open])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])
  const at = Math.min(sel, Math.max(0, items.length - 1))

  /** 改完马上说一句（写盘在后面做完）；撤回等写完再翻回去 */
  function act(text: string, undo: Promise<() => Promise<void>>) {
    setToast({ text, undo: async () => (await undo)() })
  }
  /** 这一条所在那一组现在的先后（换顺序用） */
  const groupOf = (item: SlashItem): SlashGroup | undefined => groups.find((g) => g.items.some((x) => x.id === item.id))  // 每次画都是新的一份：按 id 认
  const actions = (item: SlashItem): RowAction[] => {
    const g = groupOf(item)
    const ids = g?.items.map((x) => x.id) ?? []
    const i = ids.indexOf(item.id)
    const move = (dir: -1 | 1) => act(`「${item.name}」${dir < 0 ? '往上' : '往下'}挪了一格`, updateSlash((s) => ({ ...s, order: moveInGroup(s.order, ids, item.id, dir) })))
    return [
      ...(item.mine
        ? [{ label: '改这条命令…', icon: 'edit' as const, run: () => o.onEdit(item.mine!) }]
        : item.builtin
          ? [{ label: '复制一份再改…', icon: 'copy' as const, run: () => o.onCopy(item.builtin!) }]
          : []),
      { label: '往上挪', icon: 'arrow-up', disabled: i <= 0, run: () => move(-1) },
      { label: '往下挪', icon: 'arrow-down', disabled: i < 0 || i >= ids.length - 1, run: () => move(1) },
      { label: '藏起', icon: 'eye-closed', run: () => act(`藏起了「${item.name}」，在最下面「藏着的」里放回`, updateSlash((s) => hideSlash(s, item.id))) },
      ...(item.mine ? [{ label: '删掉这条', icon: 'trash' as const, red: true, run: () => act(`删掉了「${item.name}」`, deleteAiCmd(item.mine!)) }] : []),
    ]
  }

  function openMenuFor(item: SlashItem, el: HTMLElement | null) {
    const r = el?.getBoundingClientRect()
    if (!r) return
    setRowMenu({ item, at: { left: Math.max(8, Math.min(r.right - 230, window.innerWidth - 238)), top: r.bottom + 4 } })
  }

  const list = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  /**
   * 列表高度：定死 392（和原来 8 条一样高），打字筛的时候不变；AI 那一格矮（上下两格、下格的 AI）放不下时，按这一格从顶到输入框的高收，
   * 只跟着格子的高变，不跟着筛出几条变
   */
  const [listH, setListH] = useState(LIST_H)
  useLayoutEffect(() => {
    const el = root.current
    const cell = el?.closest('aside')
    if (!el || !cell) return
    const fit = () => {
      const top = cell.getBoundingClientRect().top
      const bottom = el.getBoundingClientRect().bottom
      setListH(Math.max(132, Math.min(LIST_H, Math.floor(bottom - top - 8 - FOOT_H))))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cell)
    return () => ro.disconnect()
  }, [open])
  // 选中的那一条滚进看得见的地方（往上滚时把它那一组的组名也露出来）
  useLayoutEffect(() => {
    const l = list.current
    const on = l?.querySelector<HTMLElement>('.it.on')
    if (!l || !on) return
    if (on.offsetTop < l.scrollTop + 4) l.scrollTop = Math.max(0, on.offsetTop - 30)
    else if (on.offsetTop + on.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = on.offsetTop + on.offsetHeight - l.clientHeight + 6
  }, [at, q, open])

  function onKey(e: React.KeyboardEvent): boolean {
    if (!open || e.nativeEvent.isComposing) return false
    if (rowMenu) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setRowMenu(null)
        return true
      }
      return false
    }
    const n = items.length
    if (e.key === 'ArrowDown' && n) return (e.preventDefault(), setSel((at + 1) % n), true)
    if (e.key === 'ArrowUp' && n) return (e.preventDefault(), setSel((at - 1 + n) % n), true)
    if (e.key === 'Enter' && !e.shiftKey && n) return (e.preventDefault(), o.onRun(items[at]!), true)
    // esc 只收菜单（最上面那一层），不往下传：不然右栏、视频条接着收别的
    if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), o.onClose(), true)
    // 选中时这一条的小菜单：和 ⌘K「这一条能做什么」同一个键（命令表 pal-menu，改了跟着变）
    if (n && isKey(e, 'pal-menu')) {
      e.preventDefault()
      openMenuFor(items[at]!, list.current?.querySelector<HTMLElement>('.it.on') ?? null)
      return true
    }
    return false
  }

  const icon = (it: SlashItem) => (it.icon ? <Codicon name={it.icon as CodiconName} size={16} /> : <EngineLogo id={o.engine} size={16} />)
  let k = 0
  const menu = open ? (
    <div className="slash" data-testid="slash-menu" ref={root} onMouseDown={(e) => e.preventDefault()}>
      <div className="sl-list" ref={list} role="listbox" aria-label="命令" style={{ height: listH }}>
        {items.length || groups.some((g) => g.ph) ? (
          groups.map((g, gi) => (
            <Fragment key={g.key}>
              <div className={'g' + (gi === 0 ? ' first' : '')} role="presentation">
                {g.title}
              </div>
              {g.ph && <div className="ph">{g.ph}</div>}
              {g.items.map((it) => {
                const i = k++
                return (
                  <div
                    key={it.id}
                    role="option"
                    aria-selected={i === at}
                    className={'it' + (i === at ? ' on' : '')}
                    data-sl={it.id}
                    onMouseMove={() => i !== at && setSel(i)}
                    onClick={() => o.onRun(it)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSel(i)
                      openMenuFor(it, e.currentTarget)
                    }}
                  >
                    <span className="ico">{icon(it)}</span>
                    <div className="tx">
                      <div className="l1">
                        <span className="n">{it.name}</span>
                        <span className="tg">
                          {it.tags.map(([t, c]) => (
                            <span key={t} className={c ?? ''}>
                              {t}
                            </span>
                          ))}
                        </span>
                      </div>
                      <div className="d">{it.desc}</div>
                    </div>
                    <button
                      className="more"
                      aria-label={`「${it.name}」能做什么`}
                      title={`改顺序、藏起（右键也行${keyFor('pal-menu') ? `，选中时 ${keyFor('pal-menu')}` : ''}）`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openMenuFor(it, e.currentTarget.parentElement)
                      }}
                    >
                      <Codicon name="ellipsis" size={14} />
                    </button>
                  </div>
                )
              })}
            </Fragment>
          ))
        ) : (
          <div className="ph none">没有这条命令，回车直接交给AI去做</div>
        )}
        {hidden.length > 0 && (
          <>
            <div className="g hid" role="presentation">
              <button className="hid-row" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                <Codicon name="eye-closed" size={14} />
                {`藏着的 ${hidden.length} 条`}
                <Codicon name={showHidden ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
            </div>
            {showHidden &&
              hidden.map((it) => (
                <div key={it.id} className="it put" data-sl-hidden={it.id}>
                  <span className="ico">{icon(it)}</span>
                  <div className="tx">
                    <div className="l1">
                      <span className="n">{it.name}</span>
                    </div>
                    <div className="d">{it.desc}</div>
                  </div>
                  <button className="put-back" onClick={() => act(`放回了「${it.name}」`, updateSlash((s) => unhideSlash(s, it.id)))}>
                    放回
                  </button>
                </div>
              ))}
          </>
        )}
      </div>
      <div className="ft">
        {toast ? (
          <span className="sl-toast" role="status">
            {toast.text}
            {toast.undo && (
              <button
                onClick={() => {
                  void toast.undo!()
                  setToast(null)
                }}
              >
                撤回
              </button>
            )}
          </span>
        ) : (
          <>
            <span>↑↓ 选择 · ↵ 执行 · esc 关闭</span>
            <span className="r" data-testid="slash-count">{`${q ? '筛出' : '这里能用'} ${items.length} 条`}</span>
          </>
        )}
      </div>
      {rowMenu && <RowMenu item={rowMenu.item} at={rowMenu.at} actions={actions(rowMenu.item)} onClose={() => setRowMenu(null)} />}
    </div>
  ) : null
  return { open, items, onKey, menu }
}

/** 一条命令的小菜单（照 ⌘K 一条命令的菜单：230 宽、圆角 12，头一行命令名） */
function RowMenu(p: { item: SlashItem; at: { left: number; top: number }; actions: RowAction[]; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null)
  useDismiss(true, [box], () => p.onClose())
  // 往下放不下就往上弹
  const [top, setTop] = useState(p.at.top)
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0
    if (p.at.top + h > window.innerHeight - 8) setTop(Math.max(8, p.at.top - h - 52))
  }, [p.at.top])
  // 挂在 body 上：右栏的磨砂（backdrop-filter）不裁它
  return createPortal(
    <div className="sl-menu" role="menu" aria-label={p.item.name} ref={box} style={{ left: p.at.left, top }} data-composer-pop="" onMouseDown={(e) => e.preventDefault()}>
      <div className="h">{p.item.name}</div>
      {p.actions.map((a, i) => (
        <Fragment key={a.label}>
          {a.label === '藏起' && i > 0 && <div className="sep" />}
          <button
            role="menuitem"
            className={a.red ? 'red' : ''}
            disabled={a.disabled}
            onClick={() => {
              p.onClose()
              a.run()
            }}
          >
            <Codicon name={a.icon} size={14} />
            {a.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  )
}
