/**
 * 同步来源的接口（设计页 61-同步来源第 5 节）：每一家只写「怎么翻列表、怎么取一篇、怎么写成 md」，
 * 其余（定时、认重复、下图、写盘、记录、提交、撤回、设置页那几行）是 runner.ts 和 index.ts 共用的。
 * 以后接 Readwise、flomo……照 getnote.ts 写一个，在 index.ts 的 runners 里加一行（「接一个…」的名单 CATALOG 里把它标成 ready）。不碰 Electron。
 */
import type { RemoteItem, SourceSettings } from '@cn/format'

/** 那边说不行：界面照 kind 说人话，不报错码 */
export class SourceError extends Error {
  constructor(
    public kind: 'auth' | 'nokey' | 'perm' | 'member' | 'quota' | 'busy' | 'net' | 'other',
    message: string,
    /** 要用户去哪一页（开通会员、开放平台） */
    public link?: string,
  ) {
    super(message)
  }
}

export interface SyncAdapter<Doc = unknown> {
  id: string
  /** 界面上的名字（不翻：服务自己的名字） */
  name: string
  /** 认重复的属性：一篇的、合并过的几篇的 */
  idProp: string
  idsProp: string
  /** 那边删了、改了时标在库里那篇上的属性 */
  deletedProp: string
  newerProp: string
  /** 库里一篇都没有时默认放哪（照库语言：剪藏/Get笔记、Clippings/Get Notes） */
  defaultFolder(): string
  /** 翻一页（新的在前）：第一页 cursor 给 null；next 是 null 就翻完了 */
  page(cursor: string | null, signal: AbortSignal): Promise<{ items: RemoteItem[]; next: string | null; total: number | null }>
  /** 取一篇写成 md 要的全部（详情、子笔记） */
  fetch(id: string, signal: AbortSignal): Promise<Doc>
  /** 文件名（不带 .md） */
  fileName(doc: Doc): string
  /** 修改时间（记进 notes[id].u） */
  updated(doc: Doc): string
  /** 要下的图（网址；照设置，不带原文时不下原文里的图） */
  images(doc: Doc, settings: SourceSettings): string[]
  render(doc: Doc, o: { path: string; images: ReadonlyMap<string, string>; settings: SourceSettings; now: Date }): string
}
