/**
 * 本机的假 Get笔记 开放接口（同步来源的单元测试、端到端测试用，不碰用户真的账号），照 openapi.biji.com 回来的样子：
 * - GET /open/api/v1/resource/note/list?since_id=<游标>：一页 PAGE 篇、新的在前，has_more、next_cursor、total；
 * - GET /open/api/v1/resource/note/detail?id=<id>：data.note，多 web_page、audio、attachments、children_ids；
 * - 认请求头 Authorization 和 X-Client-ID，不对回 401 / code 10004「未授权」（真接口就是这样回的）；member 时回 10201 not_member，quota 时回 429 quota_day；
 * - id 是 19 位的大整数，回的 JSON 里照真的写成裸数字；正文里夹着没转义的换行（真接口说明里写了会这样）；
 * - /img/<名字>.png：正文和图片笔记里的图（真的是 umiwi.com 带 Expires 的临时地址）。
 * 数据是编的，样子照真的。notes 可以随时改（加一篇、改一篇、删一篇）。
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const GN_KEY = 'gk_live_testkey000001'
export const GN_CLIENT = 'cli_testclient0001'
export const PAGE = 20

/** 1×1 的 PNG */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export interface FakeNote {
  id: string
  title: string
  content: string
  note_type: string
  created_at: string
  updated_at: string
  tags?: { name: string; type: string }[]
  /** 链接笔记：原文网址、原文 */
  url?: string
  page?: string
  /** 录音：逐句转写、时长（毫秒） */
  said?: string
  ms?: number
  /** 图片笔记的图（/img/ 下面的名字） */
  pics?: string[]
  /** 子笔记（不出现在列表里） */
  children?: FakeNote[]
}

export interface FakeGetnote {
  server: Server
  base: string
  notes: FakeNote[]
  mode: 'ok' | 'member' | 'quota'
  /** 每个请求的路径（不含 Key） */
  requests: string[]
}

/** 照真接口的样子写 JSON：id 写成裸的大整数，正文里的换行不转义 */
function raw(o: unknown): string {
  const text = JSON.stringify(o, (k, v) => (k === 'content' && typeof v === 'string' ? `\u0000${Buffer.from(v).toString('base64')}\u0000` : v))
  return text
    .replace(/"id":"(\d{16,})"/g, '"id":$1')
    .replace(/"next_cursor":"(\d+)"/g, '"next_cursor":$1')
    .replace(/"\\u0000([A-Za-z0-9+/=]*)\\u0000"/g, (_m, b64: string) => {
      const s = Buffer.from(b64, 'base64').toString()
      // 换行不转义，别的照 JSON
      return JSON.stringify(s).replace(/\\n/g, '\n')
    })
}

const asItem = (n: FakeNote, base: string, detail: boolean): Record<string, unknown> => ({
  id: n.id,
  note_id: n.id,
  note_url: `https://www.biji.com/note/${n.id}`,
  title: n.title,
  content: n.content.replace(/\{IMG:([\w-]+)\}/g, (_m, name: string) => `${base}/img/${name}.png?Expires=1795884145&OSSAccessKeyId=x`),
  note_type: n.note_type,
  source: 'app',
  tags: n.tags ?? [{ id: '1', name: n.note_type === 'link' ? 'AI链接笔记' : '录音笔记', type: 'system' }],
  children_count: n.children?.length ?? 0,
  is_child_note: false,
  created_at: n.created_at,
  updated_at: n.updated_at,
  ...(detail
    ? {
        children_ids: (n.children ?? []).map((c) => c.id),
        attachments: [
          ...(n.url ? [{ type: 'link', url: n.url, title: n.title }] : []),
          ...(n.ms ? [{ type: 'audio', url: `${base}/audio/${n.id}.mp3?Expires=1`, duration: n.ms }] : []),
          ...(n.pics ?? []).map((p) => ({ type: 'image', url: `${base}/img/${p}.png?Expires=1795884145` })),
        ],
        ...(n.url ? { web_page: { url: n.url, content: (n.page ?? '').replace(/\{IMG:([\w-]+)\}/g, (_m, name: string) => `${base}/img/${name}.png?Expires=1798053965`) } } : {}),
        ...(n.said !== undefined ? { audio: { original: n.said } } : {}),
      }
    : {}),
})

export async function startFakeGetnote(notes: FakeNote[]): Promise<FakeGetnote> {
  const f: FakeGetnote = { server: null as unknown as Server, base: '', notes, mode: 'ok', requests: [] }
  const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(raw(body))
  }
  f.server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    f.requests.push(u.pathname + u.search)
    if (u.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    if (req.headers.authorization !== GN_KEY || req.headers['x-client-id'] !== GN_CLIENT) return send(res, 401, { success: false, data: null, error: { code: 10004, message: '未授权', reason: 'unauthorized', retryable: false } })
    if (f.mode === 'member') return send(res, 200, { success: false, data: null, error: { code: 10201, message: '非会员', reason: 'not_member' } })
    if (f.mode === 'quota') return send(res, 429, { success: false, data: null, error: { code: 42900, message: 'rate limited', reason: 'quota_day' } })
    const sorted = [...f.notes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (u.pathname === '/open/api/v1/resource/note/list') {
      const since = u.searchParams.get('since_id') ?? '0'
      const from = since === '0' ? 0 : sorted.findIndex((n) => n.id === since) + 1
      const page = sorted.slice(from, from + PAGE)
      const more = from + PAGE < sorted.length
      return send(res, 200, { success: true, data: { notes: page.map((n) => asItem(n, f.base, false)), has_more: more, next_cursor: more ? page[page.length - 1]!.id : 0, total: sorted.length }, error: null })
    }
    if (u.pathname === '/open/api/v1/resource/note/detail') {
      const id = u.searchParams.get('id')
      const all = f.notes.flatMap((n) => [n, ...(n.children ?? [])])
      const n = all.find((x) => x.id === id)
      if (!n) return send(res, 200, { success: false, data: null, error: { code: 20001, message: '笔记不存在' } })
      return send(res, 200, { success: true, data: { note: asItem(n, f.base, true) }, error: null })
    }
    send(res, 404, { success: false, error: { code: 10000, message: '没有这个接口' } })
  })
  await new Promise<void>((ok) => f.server.listen(0, '127.0.0.1', ok))
  f.base = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`
  return f
}

/** 一篇样本的 id（19 位，像真的） */
export const gid = (n: number) => String(1927000000000000000n + BigInt(n))

/** 一套样本：链接（带图、假时间链接、表格不空行、微信长网址）、课堂录音（转写、时长）、空录音、图片笔记、带子笔记的文字、更早的几篇 */
export function sampleNotes(): FakeNote[] {
  return [
    {
      id: gid(30),
      title: '旧 Kindle 越狱：装上读书插件',
      content: '### 一台闲置的 Kindle\n\n![]({IMG:mindmap})\n\n[00:02:08](https://getnotes.seek:128) 说到越狱\n对比如下：\n| 项 | 值 |\n| --- | --- |\n| 屏幕 | 墨水屏 |',
      note_type: 'link',
      created_at: '2026-11-01 19:09:53',
      updated_at: '2026-11-01 19:09:53',
      tags: [
        { name: 'AI链接笔记', type: 'system' },
        { name: 'Kindle 越狱', type: 'ai' },
      ],
      url: 'https://mp.weixin.qq.com/s?__biz=MzA5&mid=2448525734&idx=1&sn=863f&chksm=84fa&pass_ticket=abc&sessionid=1&devicetype=iOS&scene=21#rd',
      page: '手上的这台 Kindle 是2016年买的\n\n![越狱后.jpg]({IMG:orig})\n\n后来转用读书',
    },
    { id: gid(29), title: '鼠标垫', content: '### 📑 智能总结\n- **时长**：0 秒', note_type: 'meeting', created_at: '2026-10-28 00:21:13', updated_at: '2026-10-28 00:21:13', said: '', ms: 0 },
    { id: gid(28), title: '对人骨的疑问', content: '### 📑 智能总结\n- **时长**：7 分钟 51 秒\n- 标本观察', note_type: 'class_audio', created_at: '2026-10-01 17:02:53', updated_at: '2026-10-01 17:02:53', said: '🟣 说话人2 [00:00:34]\n哦。\n\n🟣 说话人2 [00:02:08]\n这是真的人骨头吗？', ms: 471000 },
    { id: gid(27), title: '多 Agent 配置指南', content: '多 Agent 配置\n要点', note_type: 'img_text', created_at: '2026-09-20 08:00:00', updated_at: '2026-09-20 08:00:00', pics: ['shot1', 'shot2'] },
    {
      id: gid(26),
      title: '金融学习记录',
      content: '先说结论：地基齐了。',
      note_type: 'plain_text',
      created_at: '2026-09-10 09:00:00',
      updated_at: '2026-09-10 09:00:00',
      children: [{ id: gid(126), title: '', content: '补一句：组合与因子投资', note_type: 'plain_text', created_at: '2026-09-11 10:00:00', updated_at: '2026-09-11 10:00:00' }],
    },
    // 库里已有的（样本库里有这两篇）和更早的、库里没有的
    { id: gid(20), title: '库里已有的一篇', content: '老的', note_type: 'link', created_at: '2026-09-07 10:00:00', updated_at: '2026-09-07 10:00:00', url: 'https://example.com/a' },
    { id: gid(19), title: '挪走改名的那篇', content: '老的 2', note_type: 'link', created_at: '2026-08-01 10:00:00', updated_at: '2026-08-01 10:00:00', url: 'https://example.com/b' },
    { id: gid(10), title: '更早的一篇', content: '更早', note_type: 'link', created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00', url: 'https://example.com/c' },
    { id: gid(9), title: '', content: '没有标题的随手记\n第二行', note_type: 'plain_text', created_at: '2026-06-01 10:00:00', updated_at: '2026-06-01 10:00:00' },
    ...OLD.map((o, i) => ({ id: gid(100 + i), title: o.title, content: '早就拉进库的', note_type: 'link', created_at: `2026-05-0${i + 1} 10:00:00`, updated_at: `2026-05-0${i + 1} 10:00:00`, url: `https://example.com/old${i}` })),
  ]
}

/** 早就在库里的几篇（库里的 Getnotes 下面放着，子文件夹是以前分好的） */
const OLD = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ title: `早就有的 ${i}`, folder: i < 4 ? 'AI-Tech' : 'Life' }))

/** 样本库里已有的两篇（一篇在 Getnotes 下面，一篇被挪进课程、改了名） */
export const VAULT_HAS: Record<string, string> = {
  '40-Clippings/Getnotes/AI-Tech/库里已有的一篇.md': `---\ntitle: "库里已有的一篇"\nnote_type: link\ngetnote_id: ${gid(20)}\ncreated: 2026-09-07 10:00:00\nupdated: 2026-09-07 10:00:00\n---\n# 🔗 库里已有的一篇\n\n老的\n`,
  '30-Courses/某课/录音/我改过名.md': `---\ntitle: "挪走改名的那篇"\nnote_type: link\ngetnote_id: ${gid(19)}\ncreated: 2026-08-01 10:00:00\nupdated: 2026-08-01 10:00:00\n---\n# 我改过名\n\n老的 2\n`,
  '40-Clippings/Getnotes/Life/合并的.md': `---\ntitle: "合并的"\nnote_type: merged\ngetnote_ids: [${gid(5)}, ${gid(6)}]\n---\n# 合并的\n`,
  ...Object.fromEntries(OLD.map((o, i) => [`40-Clippings/Getnotes/${o.folder}/${o.title}.md`, `---\ntitle: "${o.title}"\nnote_type: link\ngetnote_id: ${gid(100 + i)}\ncreated: 2026-05-0${i + 1} 10:00:00\nupdated: 2026-05-0${i + 1} 10:00:00\n---\n# 🔗 ${o.title}\n\n早就拉进库的\n`])),
}
