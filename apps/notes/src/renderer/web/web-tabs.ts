/**
 * 右栏的网页标签：开了哪些、当前是哪个、每个中间栏标签上次看的是哪个网页（右栏跟着标签走）。记在本机。
 * 纯函数，界面拿它算下一个状态。
 */

export interface WebTab {
  id: string
  url: string
  title: string
}

export interface WebTabs {
  tabs: WebTab[]
  active: string | null
  /** 中间栏标签 id → 它上次看的网页标签 id */
  owners: Record<string, string>
}

export const EMPTY: WebTabs = { tabs: [], active: null, owners: {} }

let seq = 0
export const newTabId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`

const KEY = 'cn.webtabs'

export function loadWebTabs(): WebTabs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<WebTabs>
    const tabs = (v.tabs ?? []).filter((t) => t && typeof t.id === 'string' && typeof t.url === 'string' && /^https?:/.test(t.url))
    const active = tabs.some((t) => t.id === v.active) ? v.active! : (tabs[0]?.id ?? null)
    const owners = Object.fromEntries(Object.entries(v.owners ?? {}).filter(([, id]) => tabs.some((t) => t.id === id)))
    return { tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: String(t.title ?? '') })), active, owners }
  } catch {
    // 记不住上次开的网页不影响使用
    return EMPTY
  }
}

export function saveWebTabs(s: WebTabs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 同上
  }
}

/** 新开一个网页标签，排在当前标签后面；background 时不切过去 */
export function openTab(s: WebTabs, url: string, opts: { id?: string; background?: boolean; owner?: string | null } = {}): WebTabs {
  const tab: WebTab = { id: opts.id ?? newTabId(), url, title: '' }
  const at = s.active ? s.tabs.findIndex((t) => t.id === s.active) + 1 : s.tabs.length
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)]
  if (opts.background && s.active) return { ...s, tabs }
  return activate({ ...s, tabs }, tab.id, opts.owner ?? null)
}

/** 关掉一个：关的是当前的，就切到右边那个（没有就左边） */
export function closeTab(s: WebTabs, id: string): WebTabs {
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i === -1) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active
  const owners = Object.fromEntries(Object.entries(s.owners).filter(([, w]) => w !== id))
  return { tabs, active, owners }
}

export function activate(s: WebTabs, id: string, owner: string | null): WebTabs {
  if (!s.tabs.some((t) => t.id === id)) return s
  const owners = owner ? { ...s.owners, [owner]: id } : s.owners
  if (s.active === id && owners === s.owners) return s
  return { ...s, active: id, owners }
}

/** 换了中间栏的标签：它上次看的网页还开着就切过去 */
export function followOwner(s: WebTabs, owner: string | null): WebTabs {
  const id = owner ? s.owners[owner] : undefined
  if (!id || id === s.active || !s.tabs.some((t) => t.id === id)) return s
  return { ...s, active: id }
}

export function updateTab(s: WebTabs, id: string, patch: Partial<Omit<WebTab, 'id'>>): WebTabs {
  const t = s.tabs.find((x) => x.id === id)
  if (!t || Object.entries(patch).every(([k, v]) => t[k as keyof WebTab] === v)) return s
  return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, ...patch } : x)) }
}
