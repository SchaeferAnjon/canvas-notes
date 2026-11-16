/**
 * BookmarkKeeper 的文件从哪来（按顺序，第一个能用的）：
 * 1. 环境变量 CN_BOOKMARKKEEPER_DIR（测试用）
 * 2. Chrome 里装的那一份：Chrome 用户资料的 Preferences 里记着它的文件夹（开发者模式加载的是源码目录，商店装的在 Extensions/ 下）
 * 3. ~/Documents/Projects/bookmark（作者自己的源码）
 * 4. 软件自带的一份（resources/bookmarkkeeper，scripts/vendor-bookmarkkeeper.mjs 拷进来的，MIT）
 * 不依赖 Electron（单元测试直接用）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** manifest 里的 key 算出来的插件 id（Chrome 里装的都是这个 id） */
export const BOOKMARKKEEPER_ID = 'aggplciegellbdfnhcbefkdnjcgnhdef'

export type SourceKind = 'env' | 'chrome' | 'projects' | 'bundled'

export interface Source {
  dir: string
  from: SourceKind
  version: string
}

/** 是 BookmarkKeeper、有新标签页，才算能用 */
export function readSource(dir: string, from: SourceKind): Source | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (!String(m.name ?? '').includes('BookmarkKeeper') || !existsSync(join(dir, 'newtab', 'index.html'))) return null
    return { dir, from, version: String(m.version ?? '') }
  } catch {
    // 没有 manifest 或读不懂：这一处不能用，看下一处
    return null
  }
}

/** Chrome 各个用户里装的 BookmarkKeeper 的文件夹 */
export function chromeInstalls(chromeRoot: string): string[] {
  let profiles: string[] = []
  try {
    profiles = readdirSync(chromeRoot).filter((n) => n === 'Default' || n.startsWith('Profile '))
  } catch {
    // 没装 Chrome
    return []
  }
  const out: string[] = []
  for (const p of profiles) {
    for (const f of ['Secure Preferences', 'Preferences']) {
      try {
        const prefs = JSON.parse(readFileSync(join(chromeRoot, p, f), 'utf8')) as { extensions?: { settings?: Record<string, { path?: unknown }> } }
        const path = prefs.extensions?.settings?.[BOOKMARKKEEPER_ID]?.path
        if (typeof path !== 'string' || !path) continue
        // 开发者模式加载的是绝对路径；商店装的是 Extensions/ 下的相对路径
        out.push(isAbsolute(path) ? path : join(chromeRoot, p, 'Extensions', path))
      } catch {
        // 这个文件没有或读不懂
      }
    }
  }
  return [...new Set(out)]
}

export function findSource(o: { env?: string; chromeRoot: string; projects: string; bundled: string }): Source | null {
  const tries: [string, SourceKind][] = [
    ...(o.env ? [[o.env, 'env'] as [string, SourceKind]] : []),
    ...chromeInstalls(o.chromeRoot).map((d) => [d, 'chrome'] as [string, SourceKind]),
    [o.projects, 'projects'],
    [o.bundled, 'bundled'],
  ]
  for (const [dir, from] of tries) {
    const s = readSource(dir, from)
    if (s) return s
  }
  return null
}
