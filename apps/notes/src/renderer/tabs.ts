export type Tab =
  | { id: string; type: 'home' }
  | { id: string; type: 'note'; path: string; fresh?: boolean }
  | { id: string; type: 'inbox' }
  | { id: string; type: 'topic'; topic: string }
  /** 全部笔记、归档：可筛选、按修改时间排的长列表 */
  | { id: string; type: 'all' }
  | { id: string; type: 'archive' }
  /** 中间栏里的宽网页标签 */
  | { id: string; type: 'web'; url: string; title?: string }

let seq = 0
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`

const key = (vault: string) => `cn.tabs:${vault}`

export function loadTabs(vault: string): { tabs: Tab[]; active: string | null } {
  try {
    const raw = localStorage.getItem(key(vault))
    if (!raw) return { tabs: [], active: null }
    const v = JSON.parse(raw) as { tabs: Tab[]; active: string | null }
    return { tabs: v.tabs.map((t) => (t.type === 'note' ? { ...t, fresh: false } : t)), active: v.active }
  } catch {
    // 记不住上次开的标签不影响使用
    return { tabs: [], active: null }
  }
}

export function saveTabs(vault: string, tabs: Tab[], active: string | null) {
  try {
    localStorage.setItem(key(vault), JSON.stringify({ tabs, active }))
  } catch {
    // 同上
  }
}
