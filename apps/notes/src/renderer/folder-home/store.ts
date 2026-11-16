/**
 * 打开一个文件夹的首页：目录树（PDF 那边做）、左栏、⌘K 都调 openFolderHome('课程/线性代数')。
 * App 订阅它，开（或切到）那个文件夹的首页标签。
 */
const subs = new Set<(folder: string) => void>()

export function openFolderHome(folder: string) {
  for (const f of subs) f(folder)
}

export function onOpenFolderHome(cb: (folder: string) => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}
