/**
 * Get笔记 的适配（同步来源第一家）：只读调开放接口 https://openapi.biji.com（请求头 Authorization: <API Key>、X-Client-ID）。
 * 列表 GET /open/api/v1/resource/note/list?since_id=<游标>（一页 20 篇，新的在前），详情 GET /open/api/v1/resource/note/detail?id=<id>。
 * 子笔记不在列表里（is_child_note 都是 false），从详情的 children_ids 再取。知识库、订阅博主、直播先不拉（用户定）。
 * 测试：CN_GETNOTE_API 换成本机的假 Get笔记（e2e/fixtures/fake-getnote.ts），CN_GETNOTE_GAP_MS 换取详情之间歇多久。
 */
import { GETNOTE_DELETED, GETNOTE_ID, GETNOTE_IDS, GETNOTE_NEWER, type GnNote, gnFileName, gnImages, gnItem, gnMarkdown, gnNoteOf, looseJson } from '@cn/format'
import { catName } from '../../shared/categories'
import { vaultLang } from '../../shared/i18n/vault'
import { SourceError, type SyncAdapter } from './adapter'

export interface GetnoteKey {
  key: string
  client: string
}

export interface GetnoteDoc {
  note: GnNote
  children: GnNote[]
}

const MEMBER = 'https://www.biji.com/checkout?product_alias=6AydVpYeKl'
export const GETNOTE_OPENAPI = 'https://www.biji.com/openapi'
const base = () => process.env.CN_GETNOTE_API || 'https://openapi.biji.com'
const gap = () => Number(process.env.CN_GETNOTE_GAP_MS ?? 300)
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, no) => {
    if (signal.aborted) return no(new Error('停下了'))
    const t = setTimeout(ok, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), no(new Error('停下了'))), { once: true })
  })

/** 一次请求：20 秒没回算连不上；那边说的错误换成人话 */
export async function getnoteApi(k: GetnoteKey, path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(base() + path, { headers: { Authorization: k.key, 'X-Client-ID': k.client, Accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  } catch (e) {
    if (signal.aborted) throw new Error('停下了')
    throw new SourceError('net', `连不上 Get笔记：${(e as Error).name === 'TimeoutError' ? '20 秒没回' : '看看网络'}`)
  }
  const text = await res.text()
  let j: { success?: boolean; data?: unknown; error?: { code?: number; reason?: string; message?: string } | null } = {}
  try {
    j = looseJson(text) as typeof j
  } catch {
    if (!res.ok) throw new SourceError('net', `Get笔记 这会儿出错了（${res.status}），过一会儿再拉`)
    throw new SourceError('other', 'Get笔记 回来的不是笔记，过一会儿再拉')
  }
  const err = j.error
  if (res.ok && j.success !== false && !err) return (j.data ?? {}) as Record<string, unknown>
  const code = err?.code ?? 0
  const reason = err?.reason ?? ''
  if (res.status === 401 || code === 10001 || code === 10004 || reason === 'unauthorized') throw new SourceError('auth', 'Get笔记 不认这个 Key：在 Get笔记 开放平台看看 API Key 和 Client ID 有没有抄全，是不是建在同一个应用里', GETNOTE_OPENAPI)
  if (code === 10201 || reason === 'not_member') throw new SourceError('member', 'Get笔记 的开放接口要会员：开通以后再连', MEMBER)
  if (res.status === 429 || code === 42900) {
    if (reason === 'quota_day') throw new SourceError('quota', 'Get笔记 今天的读取次数用完了，明天再拉')
    if (reason === 'quota_month') throw new SourceError('quota', 'Get笔记 这个月的读取次数用完了')
    throw new SourceError('busy', 'Get笔记 说拉得太快了，过一会儿再拉')
  }
  if (res.status === 403) throw new SourceError('perm', 'Get笔记 说这个应用没有「读笔记」的权限：在开放平台给它勾上 note.content.read', GETNOTE_OPENAPI)
  throw new SourceError('other', `Get笔记 这会儿出错了${err?.message ? `：${err.message}` : `（${res.status}）`}，过一会儿再拉`)
}

export function getnoteAdapter(key: () => GetnoteKey | null): SyncAdapter<GetnoteDoc> {
  const need = () => {
    const k = key()
    if (!k) throw new SourceError('nokey', '这台 Mac 还没填 Get笔记 的 Key')
    return k
  }
  const detail = async (id: string, signal: AbortSignal) => gnNoteOf(await getnoteApi(need(), `/open/api/v1/resource/note/detail?id=${encodeURIComponent(id)}`, signal))
  return {
    id: 'getnote',
    name: 'Get笔记',
    idProp: GETNOTE_ID,
    idsProp: GETNOTE_IDS,
    deletedProp: GETNOTE_DELETED,
    newerProp: GETNOTE_NEWER,
    // 不翻：磁盘上的文件夹名
    defaultFolder: () => `${catName('剪藏')}/${vaultLang() === 'en' ? 'Get Notes' : 'Get笔记'}`,
    async page(cursor, signal) {
      const d = await getnoteApi(need(), `/open/api/v1/resource/note/list?since_id=${encodeURIComponent(cursor ?? '0')}`, signal)
      const notes = Array.isArray(d.notes) ? d.notes : []
      const next = d.has_more && d.next_cursor !== undefined && d.next_cursor !== null ? String(d.next_cursor) : null
      return { items: notes.map((n) => gnItem(gnNoteOf(n))), next: next && next !== cursor ? next : null, total: typeof d.total === 'number' ? d.total : null }
    },
    async fetch(id, signal) {
      await sleep(gap(), signal)
      const note = await detail(id, signal)
      const children: GnNote[] = []
      for (const c of note.children_ids) {
        await sleep(gap(), signal)
        children.push(await detail(c, signal))
      }
      return { note, children }
    },
    fileName: (d) => gnFileName(d.note),
    updated: (d) => d.note.updated_at,
    images: (d, s) => gnImages(d.note, d.children, s.original),
    render: (d, o) => gnMarkdown(d.note, d.children, { path: o.path, images: o.settings.images ? o.images : new Map(), transcript: o.settings.transcript, original: o.settings.original, now: o.now }),
  }
}
