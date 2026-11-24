/** 主进程和搜索进程之间的消息 */
import type { RelatedNote, SearchStatus } from '../../shared/search'

/** 大模型（bge-m3）在哪：dir 是下好、校验过的目录；fake 是测试模式的假下载（拿 e5 换个名字顶着） */
export type BigModel = { dir: string; fake?: false } | { dir: null; fake: true }

export type ToWorker =
  | { t: 'open'; root: string; userData: string; indexDir: string; modelDir: string | null; big: BigModel | null }
  /** bge-m3 刚下好：在后台用它重建索引，建完再换过去（查询照用现在的） */
  | { t: 'upgrade'; big: BigModel }
  | { t: 'scan' }
  | ({ id: number } & Query)

/** 要回答的查询 */
export type Query = { t: 'pdfText'; q: string } | { t: 'meaning'; q: string } | { t: 'related'; paths: string[]; k: number } | { t: 'passages'; qs: string[]; k: number }

/** passages 的回答：每句最像的几段；意思索引没开、没建好时是 null */
export type PassagesReply = { model: string; hits: { path: string; score: number; text: string }[][] } | null

/** related 的回答：意思索引没开、没建好时是 null */
export type RelatedReply = { model: string; related: [string, RelatedNote[]][] } | null

/**
 * 模型那一路的状态：model 是现在查询用的（没有模型是 null）；big 是大模型：none 没给，indexing 在用它建索引
 * （done / total 是段数，还在读 PDF 的字时 total 是 0），ready 已经换过去了，error 载入或建索引出错了
 */
export type EmbedFromWorker = { model: string | null; big: 'none' | 'indexing' | 'ready' | 'error'; done: number; total: number; error?: string }

export type FromWorker =
  | { t: 'status'; s: SearchStatus }
  | { t: 'embed'; s: EmbedFromWorker }
  | { t: 'reply'; id: number; ok: true; value: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
