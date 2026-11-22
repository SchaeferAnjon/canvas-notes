import type { DiffSource } from '../shared/diff'

export type Tab =
  | { id: string; type: 'home' }
  | { id: string; type: 'note'; path: string; fresh?: boolean }
  | { id: string; type: 'inbox' }
  | { id: string; type: 'topic'; topic: string }
  /** 最近：按时间看全部笔记（替掉原来的「全部笔记」） */
  | { id: string; type: 'recent' }
  /** 归档：可筛选、按修改时间排的长列表 */
  | { id: string; type: 'archive' }
  /** 中间栏里的宽网页标签 */
  | { id: string; type: 'web'; url: string; title?: string }
  /** 读 PDF：右栏是 AI 和笔记 */
  | { id: string; type: 'pdf'; path: string }
  /** 右栏网页的阅读视图（双语对照读） */
  | { id: string; type: 'webread'; url: string; title: string }
  /** 库里的 HTML（做好的可视化），在沙箱里跑 */
  | { id: string; type: 'html'; path: string; dream?: boolean }
  /** 文件夹首页（课程/<课>、项目/<项目>、生活、写作）；fresh：刚新建的，进编辑、标题能改 */
  | { id: string; type: 'folder'; folder: string; fresh?: boolean }
  /** 对比标签（历史的一次提交、梦游的一条、可能重复的两篇）；没 pinned 的是预览标签（斜体），再开一个对比就换掉它，双击才固定 */
  | { id: string; type: 'diff'; src: DiffSource; title: string; pinned?: boolean }
  /** 梦游预览 · 挪老图：报告里那一条（按笔记分组列出每张从哪到哪） */
  | { id: string; type: 'oldimages'; item: string }
  /** 最近删掉的（30 天里删的，task-5yp97） */
  | { id: string; type: 'trash' }

let seq = 0
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`

const key = (vault: string) => `cn.tabs:${vault}`

const str = (v: unknown): v is string => typeof v === 'string'

/** 存着的一个标签对不对得上它那一种要的字段（task-pyb39：缺了 path 的笔记标签一渲染就抛错，整窗白屏） */
export function validTab(t: unknown): t is Tab {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  if (!str(o.id) || !o.id) return false
  switch (o.type) {
    case 'home':
    case 'inbox':
    case 'recent':
    case 'archive':
    case 'trash':
      return true
    case 'note':
    case 'pdf':
    case 'html':
      return str(o.path) && !!o.path
    case 'topic':
      return str(o.topic)
    case 'web':
      return str(o.url) && (o.title === undefined || str(o.title))
    case 'webread':
      return str(o.url) && str(o.title)
    case 'folder':
      return str(o.folder)
    case 'diff':
      return !!o.src && typeof o.src === 'object' && str((o.src as Record<string, unknown>).kind) && str(o.title)
    case 'oldimages':
      return str(o.item)
    default:
      return false
  }
}

/**
 * 上次开着的标签。坏的（不是数组、少字段、不认识的种类、重复的 id）丢掉并记一行日志（onDrop），别的照样恢复。
 * 原来的「全部笔记」标签换成「最近」；「我的疑惑」那一页 2026-11-22 拿掉了（task-tz7y3），上次开着的不再开
 */
export function parseTabs(raw: string | null, onDrop: (why: string) => void = () => {}): { tabs: Tab[]; active: string | null } {
  if (!raw) return { tabs: [], active: null }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    onDrop('标签记录不是 JSON')
    return { tabs: [], active: null }
  }
  const list = v && typeof v === 'object' ? (v as { tabs?: unknown }).tabs : undefined
  if (!Array.isArray(list)) {
    onDrop('标签记录里没有标签列表')
    return { tabs: [], active: null }
  }
  const tabs: Tab[] = []
  const seen = new Set<string>()
  const bad: string[] = []
  for (const t of list) {
    const o = t as { id?: unknown; type?: unknown } | null
    if (o && typeof o === 'object' && o.type === 'doubts') continue
    const u = o && typeof o === 'object' && o.type === 'all' && str(o.id) ? { id: o.id, type: 'recent' } : t
    if (!validTab(u) || seen.has(u.id)) {
      bad.push(JSON.stringify(o && typeof o === 'object' ? { type: o.type } : typeof o))
      continue
    }
    seen.add(u.id)
    tabs.push(u.type === 'note' || u.type === 'folder' ? { ...u, fresh: false } : u)
  }
  if (bad.length) onDrop(`丢掉 ${bad.length} 个标签：${bad.join('、')}`)
  const active = (v as { active?: unknown }).active
  return { tabs, active: str(active) ? active : null }
}

export function loadTabs(vault: string, onDrop?: (why: string) => void): { tabs: Tab[]; active: string | null } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key(vault))
  } catch {
    // 本机存储打不开：记不住上次开的标签不影响使用
  }
  return parseTabs(raw, onDrop)
}

export function saveTabs(vault: string, tabs: Tab[], active: string | null) {
  try {
    localStorage.setItem(key(vault), JSON.stringify({ tabs, active }))
  } catch {
    // 同上
  }
}

const under = (p: string, folder: string) => p === folder || p.startsWith(folder + '/')

/** 文件夹改了名：里面的文件标签、这个文件夹（和下面的）首页都换成新路径 */
export function retargetTabs(tabs: Tab[], from: string, to: string): Tab[] {
  const map = (p: string) => (under(p, from) ? to + p.slice(from.length) : p)
  return tabs.map((t) => {
    if ((t.type === 'note' || t.type === 'pdf' || t.type === 'html') && under(t.path, from)) return { ...t, path: map(t.path) }
    if (t.type === 'folder' && under(t.folder, from)) return { ...t, folder: map(t.folder) }
    return t
  })
}

/** 文件夹移到废纸篓了：里面的标签都关掉 */
export function tabsOutside(tabs: Tab[], folder: string): Tab[] {
  return tabs.filter((t) => !(('path' in t && under(t.path, folder)) || ('folder' in t && under(t.folder, folder))))
}
