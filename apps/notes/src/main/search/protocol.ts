/** 主进程和搜索进程之间的消息 */
import type { SearchStatus } from '../../shared/search'

export type ToWorker =
  | { t: 'open'; root: string; userData: string; indexDir: string; modelDir: string | null }
  | { t: 'scan' }
  | ({ id: number } & Query)

/** 要回答的查询 */
export type Query = { t: 'pdfText'; q: string } | { t: 'meaning'; q: string }

export type FromWorker = { t: 'status'; s: SearchStatus } | { t: 'reply'; id: number; ok: true; value: unknown } | { t: 'reply'; id: number; ok: false; error: string }
