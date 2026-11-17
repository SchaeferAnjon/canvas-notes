/**
 * 「移到」菜单：库里每个文件夹都能选（第 1 轮修：以前只有一级和有首页的，挪不进 写作/游记 这种子文件夹）。
 * 按目录一层层排成子菜单：有子文件夹的那一项点开，第一行「放进「写作」」，下面是它的子文件夹；没有子文件夹的直接点。
 * 最前面「库的最外层」。笔记右键、文件夹右键、标题下「所在文件夹 ▾」都用这一份。
 */
import type { MenuEntry } from './menu'

/** 库里出现过的全部文件夹：文件路径的每一层上级，加上另外列出的（空文件夹） */
export function allFolders(paths: readonly string[], dirs: readonly string[] = []): string[] {
  const out = new Set<string>()
  const up = (p: string, self: boolean) => {
    const parts = p.split('/')
    for (let i = 1; i < parts.length + (self ? 1 : 0); i++) out.add(parts.slice(0, i).join('/'))
  }
  for (const p of paths) up(p, false)
  for (const d of dirs) if (d) up(d, true)
  return [...out].sort((a, b) => a.localeCompare(b, 'zh'))
}

const nameOf = (f: string) => f.split('/').pop()!

/**
 * here：现在在的文件夹（不列它自己这一项，它的子文件夹照列）；skip：不能去的（文件夹不能挪进自己里面）
 */
export function moveMenu(folders: readonly string[], here: string, pick: (folder: string) => unknown, skip: (folder: string) => boolean = () => false): MenuEntry[] {
  const kids = new Map<string, string[]>()
  for (const f of folders) {
    if (skip(f)) continue
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''
    if (!kids.has(parent)) kids.set(parent, [])
    kids.get(parent)!.push(f)
  }
  const node = (f: string): MenuEntry => {
    const sub = (kids.get(f) ?? []).map(node).filter(Boolean)
    const self = f !== here
    if (!sub.length) return self ? { label: nameOf(f), run: () => pick(f) } : null
    return { label: nameOf(f), submenu: [self && { label: `放进「${nameOf(f)}」`, run: () => pick(f) }, self && '-', ...sub] }
  }
  const top = (kids.get('') ?? []).map(node).filter(Boolean)
  return [here !== '' && !skip('') && { label: '库的最外层', run: () => pick('') }, ...top].filter(Boolean)
}
