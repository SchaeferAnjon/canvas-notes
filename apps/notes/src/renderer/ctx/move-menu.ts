/**
 * 「移到」菜单：库里每个文件夹都能选（第 1 轮修：以前只有一级和有首页的，挪不进 写作/游记 这种子文件夹）。
 * 按目录一层层排成子菜单：有子文件夹的那一项点开，第一行「放进「写作」」，下面是它的子文件夹；没有子文件夹的直接点。
 * 最前面是库本身（写库名，CN-106）。笔记右键、文件夹右键、标题下「所在文件夹 ▾」、文件树选了好几个都用这一份。
 */
import { categoryRank } from '../../shared/categories'
import { vaultName } from '../vault-name'
import type { MenuEntry } from './menu'
import { t } from '../../shared/i18n'

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
 * here：现在在的文件夹（没有子文件夹时灰着列出来、点不了，有子文件夹时只列子文件夹；null 是选了好几个、哪一项都能去）；
 * skip：不能去的（文件夹不能挪进自己里面）。数据库的记录文件夹不在 folders 里（App 的 allFolders 去掉了，task-5yp97）
 */
export function moveMenu(folders: readonly string[], here: string | null, pick: (folder: string) => unknown, skip: (folder: string) => boolean = () => false): MenuEntry[] {
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
    // 这篇本来就在的文件夹（3-藏之后 图）：灰着，看得出在哪、点不了
    if (!sub.length) return self ? { label: nameOf(f), run: () => pick(f) } : { label: nameOf(f), run: () => undefined, enabled: false }
    return { label: nameOf(f), submenu: [self && { label: t('放进「{name}」', { name: nameOf(f) }), run: () => pick(f) }, self && '-', ...sub] }
  }
  // 最外层：顶级分类按分类表的先后在前（收件箱、课程、阅读、剪藏、周记、写作、项目、生活），别的按名字在后
  const top = (kids.get('') ?? []).sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'zh')).map(node).filter(Boolean)
  return [here !== '' && !skip('') && { label: vaultName(), run: () => pick('') }, ...top].filter(Boolean)
}
