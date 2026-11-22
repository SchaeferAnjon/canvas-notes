/**
 * 这个网页的问答、剪藏记进哪篇（task-6cxtc，偏好「网页的笔记记在正在剪进去的那篇」）：
 * 1. 「记到这篇」「换一篇」「剪到哪篇…」选过的那篇（这台 Mac 记着，cn.webTarget：网站 → 那篇）：还配着这个网站、或这个网站没配别的篇时用它
 *    （那篇已经配了别的网站时不动它的配对，只记在这里）；
 * 2. 和这个网页配成一对的那篇（笔记属性 read-along 对得上这个网址）；几篇都配了它时中间开着的那篇优先，不然第一篇；
 * 3. 都没有：第一次问、剪时问一句（Where.tsx）。选了「这次只问，不记」的网站，软件开着时不再问（skip）。
 */
import { useSyncExternalStore } from 'react'
import { notesOfUrl, usePairs } from '../read-along/store'

const KEY = 'cn.webTarget'

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

/** 「记到哪篇」里给这个网站选的那篇 */
export const chosenFor = (url: string): string | null => readChosen()[siteOf(url)] ?? null

export function setChosen(url: string, path: string) {
  const all = readChosen()
  all[siteOf(url)] = path
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 记不住：下次再问一句
  }
  skipped.delete(siteOf(url))
  bump()
}

/** 选了「这次只问，不记」的网站（软件开着时不再问） */
const skipped = new Set<string>()
export const isSkipped = (url: string) => skipped.has(siteOf(url))
export function skip(url: string) {
  skipped.add(siteOf(url))
  bump()
}

/**
 * 这个网页记进哪篇；还没定是 null。center：中间开着的那篇（文档看法、能写）；have：库里还有这一篇
 */
export function targetOf(url: string, center: string | null, have: (path: string) => boolean): string | null {
  if (!/^https?:\/\//i.test(url)) return null
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
