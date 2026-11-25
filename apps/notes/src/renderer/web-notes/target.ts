/**
 * 这个网页的问答、剪藏记进哪篇（task-6cxtc，偏好「网页的笔记记在正在剪进去的那篇」）：
 * 1. 「记到这篇」「换一篇」「剪到哪篇…」选过的那篇（这台 Mac 记着，cn.webTarget：网站 → 那篇）：还配着这个网站、或这个网站没配别的篇时用它
 *    （那篇已经配了别的网站时不动它的配对，只记在这里）；
 * 2. 和这个网页配成一对的那篇（笔记属性 read-along 对得上这个网址）；几篇都配了它时中间开着的那篇优先，不然第一篇；
 * 3. 都没有：第一次问、剪时问一句（Where.tsx）。问的时候选「这次只问，不记」是把网页的「记笔记」关掉（AI 栏输入框下面那一排），关着不再问。
 * 「剪到哪篇…」选了收件箱：这个网站记成收件箱（INBOX），配对、中间开着的都不看，剪的进收件箱，问的照没定那样先问一句；
 * 选了一个文件夹（「放进一个文件夹…」、地址栏小牌「放进这个文件夹」，剪藏去处 2026-11-25）：记成 DIR + 文件夹，剪的每次一张卡片进那个文件夹（写法同收件箱），问的同收件箱
 */
import { useSyncExternalStore } from 'react'
import { notesOfUrl, usePairs } from '../read-along/store'
import { t } from '../../shared/i18n'

const KEY = 'cn.webTarget'
/** cn.webTarget 里记着「这个网站剪进收件箱」（不是一篇的路径：路径都带 .md） */
const INBOX = ':inbox'
/** cn.webTarget 里记着「这个网站剪进这个文件夹」：DIR + 库里的文件夹（'' 是库的最外层） */
const DIR = ':dir:'

const siteOf = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

let version = 0
const subs = new Set<() => void>()
const bump = () => {
  version++
  for (const s of [...subs]) s()
}

function readChosen(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** 「记到哪篇」里给这个网站选的那篇（选的是收件箱时是 null） */
export function chosenFor(url: string): string | null {
  const v = readChosen()[siteOf(url)]
  return v && v !== INBOX && !v.startsWith(DIR) ? v : null
}

/** 给这个网站选的文件夹（没选文件夹是 null；'' 是库的最外层） */
export function folderFor(url: string): string | null {
  const v = readChosen()[siteOf(url)]
  return v?.startsWith(DIR) ? v.slice(DIR.length) : null
}

/** 文件夹在底栏、提示、小牌里怎么写：库的最外层写「库里最外层」 */
export const dirLabel = (dir: string) => dir || t('库里最外层')

/** 「剪到哪篇…」给这个网站选了收件箱 */
export const inboxFor = (url: string): boolean => readChosen()[siteOf(url)] === INBOX

/** 记下这个网站剪进哪篇；'inbox'：以后剪进收件箱；{ dir }：以后剪进这个文件夹 */
export function setChosen(url: string, path: string | 'inbox' | { dir: string }) {
  const all = readChosen()
  all[siteOf(url)] = typeof path === 'object' ? DIR + path.dir : path === 'inbox' ? INBOX : path
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 记不住：下次再问一句
  }
  bump()
}

/**
 * 这个网页记进哪篇；还没定是 null。center：中间开着的那篇（文档看法、能写）；have：库里还有这一篇
 */
export function targetOf(url: string, center: string | null, have: (path: string) => boolean): string | null {
  if (!/^https?:\/\//i.test(url) || inboxFor(url) || folderFor(url) !== null) return null
  const paired = notesOfUrl(url).filter(have)
  const chosen = chosenFor(url)
  // 「记到这篇」「换一篇」选过的优先（还配着这个网站，或者这个网站没配别的）；不然中间开着的那篇，再不然第一篇
  if (chosen && have(chosen) && (paired.includes(chosen) || !paired.length)) return chosen
  if (paired.length) return center && paired.includes(center) ? center : paired[0]!
  return null
}

/** 配对、选过的变了就重画（右栏「笔记」标签亮不亮、小条上说剪进哪篇） */
export function useTargets(): number {
  usePairs()
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => version,
  )
}
