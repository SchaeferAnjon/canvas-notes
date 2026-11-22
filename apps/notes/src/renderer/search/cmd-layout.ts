/**
 * ⌘K 没打字时的几组（DESIGN.v3 3.1）：钉住的、书桌、最近打开、去哪、新建和导入、让AI做、网页、库和同步、设置和外观，
 * 自己建的组接在后面，再是收成一行的「更多命令 ›」；最后一组是「加一条自己的命令…」「藏着的 N 条」。
 * 纯函数：组和行算好交给 Palette 画。
 */
import { type CmdConfig, GROUPS, materialize } from '../../shared/commands'
import { t } from '../../shared/i18n'

export interface LayoutCmd {
  id: string
  /** 它自己那一组（取消钉住回到这里；默认表里没有的接在这一组最后） */
  home?: string
  keys?: string
  /** 文件夹首页一个个的：收在「文件夹首页」那一行下面，打字时才一条条出来 */
  folder?: string
  /** 只在打字时出（打「我的疑惑」时那一条说明）：不是命令，没打字时哪组都不放 */
  searchOnly?: boolean
  /** 一张书桌（task-kbnc0）：在「书桌」一组（钉住的后面、最近打开前面），没有自己的菜单 */
  desk?: boolean
}

export type EmptyRow =
  | { kind: 'cmd'; id: string; gid: string }
  /** 文件夹首页那一行（点开列出一个个） */
  | { kind: 'folders'; gid: string; n: number; open: boolean }
  /** 文件夹首页一个个的（往里缩、没有 ⋯ 和把手） */
  | { kind: 'child'; id: string }
  /** 一张书桌（没有 ⋯ 和把手） */
  | { kind: 'desk'; id: string }
  /** 「更多命令 ›」那一行（点开在下面列出来，task-xy89o） */
  | { kind: 'more'; n: number; open: boolean }
  | { kind: 'note'; path: string }
  /** 钉住的空了、拖着时的空组：落点 */
  | { kind: 'empty'; gid: string }
  | { kind: 'add' }
  | { kind: 'hidden'; n: number; open: boolean }
  /** 藏着的一条：右端「放回」 */
  | { kind: 'put'; id: string }

export interface Section {
  /** 组的 id；最后那组是 tail */
  id: string
  name: string
  rows: EmptyRow[]
}

export const FOLDERS_ID = 'folders'

/** 组名：八组是固定的（跟界面语言），自己建的用它的名字（是用户的字，不翻） */
export function groupName(cfg: CmdConfig, id: string): string {
  const builtin = GROUPS.find((g) => g.id === id)
  if (builtin) return t(builtin.name)
  return (cfg.groups ?? []).find((g) => g.id === id)?.name ?? t('我的一组')
}

export function emptySections(o: {
  cfg: CmdConfig
  cmds: readonly LayoutCmd[]
  /** 最近打开的几篇（已经按先后、只有还在的） */
  recent: readonly string[]
  /** 文件夹首页那一行点开了没有 */
  foldersOpen: boolean
  /** 「更多命令」那一行点开了没有 */
  moreOpen?: boolean
  showHidden: boolean
  /** 拖着的时候空组也画出来当落点 */
  dragging: boolean
}): Section[] {
  const listed = o.cmds.filter((c) => !c.folder && !c.searchOnly && !c.desk)
  const desks = o.cmds.filter((c) => c.desk)
  const children = o.cmds.filter((c) => c.folder)
  const have = new Set(listed.map((c) => c.id))
  // 文件夹首页那一行：有文件夹首页时才有
  if (children.length) have.add(FOLDERS_ID)
  const avail = [...listed.map((c) => ({ id: c.id, home: c.home, keys: c.keys })), ...(children.length ? [{ id: FOLDERS_ID, home: 'go' }] : [])]
  const hidden = new Set(o.cfg.hidden)
  const L = materialize(o.cfg, avail)
  const out: Section[] = []
  // 更多命令画在自己建的组后面
  const order = [...GROUPS.map((x) => x.id).filter((x) => x !== 'more'), ...L.filter((x) => !GROUPS.some((b) => b.id === x.id)).map((x) => x.id), 'more']
  for (const g of order) {
    if (g === 'recent') {
      if (o.recent.length) out.push({ id: g, name: groupName(o.cfg, g), rows: o.recent.slice(0, 3).map((path) => ({ kind: 'note', path })) })
      continue
    }
    const entry = L.find((x) => x.id === g)
    if (!entry) continue
    if (g === 'more') {
      // 收成一行「更多命令 › N 条」，点开在下面一条条列出来（照文件夹首页那一行）；拖着时不当落点
      const ids = entry.items.filter((id) => have.has(id) && !hidden.has(id))
      if (ids.length) out.push({ id: g, name: '', rows: [{ kind: 'more', n: ids.length, open: !!o.moreOpen }, ...(o.moreOpen ? ids.map((id): EmptyRow => ({ kind: 'cmd', id, gid: g })) : [])] })
      continue
    }
    // 书桌（task-kbnc0）：存好的一张张在前，组里的命令（「存成书桌…」）在后；没有书桌时照样有这一组（task-xy89o）
    const rows: EmptyRow[] = g === 'desks' ? desks.map((c) => ({ kind: 'desk', id: c.id })) : []
    for (const id of entry.items) {
      if (!have.has(id) || hidden.has(id)) continue
      if (id === FOLDERS_ID) {
        rows.push({ kind: 'folders', gid: g, n: children.length, open: o.foldersOpen })
        if (o.foldersOpen) for (const c of children) if (!hidden.has(c.id)) rows.push({ kind: 'child', id: c.id })
      } else rows.push({ kind: 'cmd', id, gid: g })
    }
    if (!rows.length && g !== 'pin' && !o.dragging) continue
    if (!rows.length) rows.push({ kind: 'empty', gid: g })
    out.push({ id: g, name: groupName(o.cfg, g), rows })
  }
  const tail: EmptyRow[] = [{ kind: 'add' }]
  const hid = o.cfg.hidden.filter((id) => have.has(id) || o.cmds.some((c) => c.id === id))
  if (hid.length) {
    tail.push({ kind: 'hidden', n: hid.length, open: o.showHidden })
    if (o.showHidden) for (const id of hid) tail.push({ kind: 'put', id })
  }
  out.push({ id: 'tail', name: '', rows: tail })
  return out
}

/** 键盘、鼠标能选中的行（空组那一行不算） */
export const selectable = (r: EmptyRow) => r.kind !== 'empty'
