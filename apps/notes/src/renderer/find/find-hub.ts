/**
 * 在这一页里找（⇧⌘F，命令表 find-in-page；⌘F 照旧是全库搜索，2026-11-22 用户定）：
 * 每一种页面（文档、网页、PDF、白板、导图、AI 对话）开着时登记一个「找」的目标，按 ⇧⌘F（菜单栏「编辑」、⌘K 里点也一样）时交给当前栏（runFindInPage）；
 * 当前栏里没有能找的（大纲、历史）时交给焦点所在的那一个，再是中间栏里看得见的那一个，再没有就随便一个看得见的。
 * 找的条是同一个组件 FindBar，各页面自己摆在自己那一栏的右上角。
 */
import { useEffect, useRef } from 'react'

export interface FindTarget {
  /** 这一栏的根元素：焦点在它里面就归它 */
  el(): HTMLElement | null
  /** 打开找的条；已经开着就把框里的字全选上，好接着打 */
  open(): void
  /** 是谁的（笔记的路径）：标签条「⋯」里点「在导图里找」时按它找；没挂上的等它挂上再开 */
  owner?: string
}

type Slot = { current: FindTarget | null }
const slots = new Set<Slot>()
/** 点了「在导图里找」时那一块还没画出来（先切到白板）：等它登记时开 */
let pending: string | null = null

/** 页面开着、能找时登记（null 是这会儿不能找：没在这种看法里、只读的预览……） */
export function useFindTarget(t: FindTarget | null) {
  const ref = useRef<FindTarget | null>(t)
  ref.current = t
  const on = t !== null
  useEffect(() => {
    if (!on) return
    const slot: Slot = ref
    slots.add(slot)
    if (pending && slot.current?.owner === pending) {
      pending = null
      slot.current.open()
    }
    return () => void slots.delete(slot)
  }, [on])
}

const shown = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.getClientRects().length > 0

const targets = () => [...slots].map((s) => s.current).filter((t): t is FindTarget => t !== null)

/** 这一个目标在不在当前栏里（App 把当前栏写在 .win 的 data-pane 上：left、center 或右边一组的 id，CN-98） */
function inPane(el: HTMLElement, pane: string): boolean {
  if (pane === 'center') return !!el.closest('main.center')
  if (pane === 'left') return !!el.closest('.win > .side')
  return el.closest('[data-group]')?.getAttribute('data-group') === pane
}

/**
 * 按 ⇧⌘F：交给该找的那一栏；没有能找的返回 false。
 * 先看当前栏（查找跟着焦点，2026-11-24 用户定）：点过、焦点到过、网页里点进去过的那一栏，和 ⌘W 关的是同一栏。
 * 只看 document.activeElement 不够：点网页的标签条、工具条、滚网页都不挪焦点，焦点还留在 AI 输入框或文档里，⇧⌘F 就落到中间的文档上。
 * 当前栏里有几个（中间分屏两格）：焦点在哪格是哪格，再是分屏里当前那格（.cslot[data-on]）
 */
export function runFindInPage(): boolean {
  const list = targets().filter((t) => shown(t.el()))
  const active = document.activeElement
  const holds = (t: FindTarget) => !!active && active !== document.body && t.el()!.contains(active)
  const pane = document.querySelector<HTMLElement>('.win')?.dataset.pane
  const here = pane ? list.filter((t) => inPane(t.el()!, pane)) : []
  const pick =
    here.find(holds) ??
    here.find((t) => !!t.el()!.closest('.cslot[data-on]')) ??
    here[0] ??
    list.find(holds) ??
    list.find((t) => !!t.el()!.closest('main.center')) ??
    list[0]
  if (!pick) return false
  pick.open()
  return true
}

/** 打开某一篇的找的条（标签条「⋯」里的「在导图里找」）；那一块还没画出来就等它登记 */
export function requestFind(owner: string) {
  const hit = targets().find((t) => t.owner === owner && shown(t.el()))
  if (hit) return hit.open()
  pending = owner
}

/** 一段字里找 q（不分大小写）：每一处的起点；q 空时没有 */
export function findAll(text: string, q: string): number[] {
  const needle = q.toLowerCase()
  if (!needle) return []
  const hay = text.toLowerCase()
  const out: number[] = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i)
  return out
}
