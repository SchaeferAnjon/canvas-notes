/**
 * 网页里自己的脚本认的键（命令表 shared/cmd-table.ts 里的双语翻译、剪藏选中的一段、引用选中的一段，task-spsmf）：
 * 主进程推过来（设置 › 快捷键、⌘K 里改了跟着换）；没推到之前用命令表里默认的。在隔离环境里，网页脚本碰不到。
 */
import { ipcRenderer } from 'electron'
import { comboOf } from '../shared/cmd-keys'
import { defaultKeysOf } from '../shared/cmd-table'

const IDS = ['translate', 'clip-selection', 'quote-selection'] as const
type PageKeyId = (typeof IDS)[number]

let keys: Record<string, string | null> = Object.fromEntries(IDS.map((id) => [id, defaultKeysOf(id)[0] ?? null]))
const subs = new Set<() => void>()
const set = (k: unknown) => {
  if (!k || typeof k !== 'object') return
  keys = { ...keys, ...(k as Record<string, string | null>) }
  subs.forEach((f) => f())
}
void ipcRenderer.invoke('keys:page').then(set, (e: Error) => console.warn('[canvas-notes] 网页里的快捷键读不到', e.message))
ipcRenderer.on('keys:page', (_e, k: unknown) => set(k))

/** 这一条现在的键（没有键是 null） */
export const pageKey = (id: PageKeyId): string | null => keys[id] ?? null

/** 按下去的是不是这一条的键（输入法正在拼字时不算） */
export const isPageKey = (e: KeyboardEvent, id: PageKeyId): boolean => !e.isComposing && !!keys[id] && comboOf(e) === keys[id]

/** 键换了（小条上写着的键跟着换） */
export function onPageKeys(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}
