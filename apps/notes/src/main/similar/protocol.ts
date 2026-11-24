import type { DuplicatePair } from '../../shared/api'

/** 主进程交给找像的笔记那个进程的活 */
export type SimilarJob = { t: 'links'; texts: [string, string][]; loose: string[] } | { t: 'ranked'; texts: [string, string][]; loose: string[]; k: number } | { t: 'dups'; docs: { id: string; text: string }[] } | { t: 'wiki'; texts: [string, string][]; asks: [string, string[]][] }

/** 找重复算的时候报的：已经比完几篇（共几篇；还在切字、算签名时 total 是 0）、这次新找到的几对 */
export interface SimilarProgress {
  done: number
  total: number
  pairs: DuplicatePair[]
}
