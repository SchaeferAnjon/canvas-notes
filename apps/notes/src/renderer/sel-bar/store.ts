/**
 * 选中小条在界面这边（task-26nz7）：表存在命令.json 的 bar（cmd-store 管写盘和撤回），自己的按钮就是自己的 AI 命令（commands/store.ts）。
 * - 某一处的小条要画的：几颗、名字（自带的照界面语言）、键（照命令表、命令.json 里设的）；
 * - 改表：每次改都给撤回；
 * - 刚存好的那一颗：第一次出来描一圈强调色（网页上的小条、设置的预览都认）。
 */
import { useSyncExternalStore } from 'react'
import { type AiCmd } from '../../shared/ai-cmds'
import { defaultKeysOf } from '../../shared/cmd-table'
import { t } from '../../shared/i18n'
import { type BarConfig, type BarItem, type BarOwn, type BarPlace, barAt, docItems } from '../../shared/sel-bar'
import { cmdConfig, updateCmds, useCmds } from '../search/cmd-store'
import { localAiCmds, useAiCmds, vaultAiCmds } from '../commands/store'
import { keyFor } from '../keys'

/** 自己的命令里小条要的（名字、在哪能用） */
export const ownsOf = (mine: readonly AiCmd[]): BarOwn[] => mine.map((c) => ({ id: c.id, name: c.name, where: c.where }))

/** 现在的自己的命令（库里的在前，这台 Mac 上的接着） */
export const mineNow = (): AiCmd[] => [...vaultAiCmds(cmdConfig()), ...localAiCmds()]

/** 表和自己的命令（React 里用） */
export function useBar(): { bar: BarConfig; mine: AiCmd[] } {
  const cfg = useCmds()
  const { mine } = useAiCmds()
  return { bar: cfg.bar, mine }
}

/** 改表；返回撤回 */
export async function updateBar(fn: (b: BarConfig) => BarConfig): Promise<() => Promise<void>> {
  const before = await updateCmds((cfg) => {
    const next = fn(cfg.bar)
    return next === cfg.bar ? cfg : { ...cfg, bar: next }
  })
  return async () => void (await updateCmds((cfg) => ({ ...cfg, bar: before.bar })))
}

/** 一颗按钮这一处的键（没有是 null）：讲解一下是回车；引用在网页是「引用选中的一段」、PDF HTML 是「问这一页」那个键 */
export function barKey(id: string, place: BarPlace): string | null {
  if (id === 'explain') return defaultKeysOf('enter')[0] ?? null
  if (id === 'quote') return keyFor(place === 'web' ? 'quote-selection' : 'ask-page')
  if (id === 'clip') return keyFor('clip-selection')
  if (id === 'copy') return defaultKeysOf('copy')[0] ?? null
  if (id === 'translate' || id === 'only') return null
  return keyFor(id)
}

/** 画出来的一颗：名字照界面语言（自己的原样）、键 */
export interface BarBtn extends BarItem {
  label: string
  key: string | null
  /** ⋯ 里右边那句（翻好的） */
  right?: string
}

const btnOf = (it: BarItem, place: BarPlace): BarBtn => ({ ...it, label: it.mine ? it.name : t(it.name), key: barKey(it.id, place), ...(it.r ? { right: t(it.r) } : {}) })

/** 某一处的小条：条上（竖线前、竖线后）、⋯ 里 */
export function barView(bar: BarConfig, mine: readonly AiCmd[], place: BarPlace): { main: BarBtn[]; tail: BarBtn[]; more: BarBtn[] } {
  const v = barAt(bar, ownsOf(mine), place)
  return { main: v.main.map((x) => btnOf(x, place)), tail: v.tail.map((x) => btnOf(x, place)), more: v.more.map((x) => btnOf(x, place)) }
}

/** 文档里选了字的右键菜单最上面那一组 */
export const docBtns = (bar: BarConfig, mine: readonly AiCmd[]): BarBtn[] => docItems(bar, ownsOf(mine)).map((x) => btnOf(x, 'doc'))

// ---------------------------------------------------------------- 刚存好的那一颗

let fresh: string | null = null
let freshV = 0
const freshSubs = new Set<() => void>()
/** 刚存好、放上了条的那一颗：下一次小条出来时描一圈强调色（出来一次就不再描） */
export function markFresh(id: string | null) {
  fresh = id
  freshV++
  for (const f of freshSubs) f()
}
export const freshNow = () => fresh
export function onFresh(f: () => void): () => void {
  freshSubs.add(f)
  return () => freshSubs.delete(f)
}
export function useFresh(): string | null {
  useSyncExternalStore(
    (cb) => onFresh(cb),
    () => freshV,
  )
  return fresh
}
