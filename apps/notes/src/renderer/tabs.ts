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
  /** 一门课（一个文件夹）的我的疑惑 */
  | { id: string; type: 'doubts'; folder: string }
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

let seq = 0
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`

const key = (vault: string) => `cn.tabs:${vault}`

export function loadTabs(vault: string): { tabs: Tab[]; active: string | null } {
  try {
    const raw = localStorage.getItem(key(vault))
    if (!raw) return { tabs: [], active: null }
    const v = JSON.parse(raw) as { tabs: Tab[]; active: string | null }
    // 原来的「全部笔记」标签换成「最近」
    const tabs = v.tabs.map((t): Tab => ((t.type as string) === 'all' ? { id: t.id, type: 'recent' } : t))
    return { tabs: tabs.map((t) => (t.type === 'note' || t.type === 'folder' ? { ...t, fresh: false } : t)), active: v.active }
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

const under = (p: string, folder: string) => p === folder || p.startsWith(folder + '/')

/** 文件夹改了名：里面的文件标签、这个文件夹（和下面的）首页、我的疑惑标签都换成新路径 */
export function retargetTabs(tabs: Tab[], from: string, to: string): Tab[] {
  const map = (p: string) => (under(p, from) ? to + p.slice(from.length) : p)
  return tabs.map((t) => {
    if ((t.type === 'note' || t.type === 'pdf' || t.type === 'html') && under(t.path, from)) return { ...t, path: map(t.path) }
    if ((t.type === 'folder' || t.type === 'doubts') && under(t.folder, from)) return { ...t, folder: map(t.folder) }
    return t
  })
}

/** 文件夹移到废纸篓了：里面的标签都关掉 */
export function tabsOutside(tabs: Tab[], folder: string): Tab[] {
  return tabs.filter((t) => !(('path' in t && under(t.path, folder)) || ('folder' in t && under(t.folder, folder))))
}
