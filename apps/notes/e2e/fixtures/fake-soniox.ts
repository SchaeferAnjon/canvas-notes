/**
 * 本机的假 Soniox（单元测试、端到端测试用，CN_SONIOX_BASE 指过来）：上传文件、建转写、问状态、取结果、删，
 * 和真接口一样的路径和字段。听写结果是固定的几句中文（每 3 秒一句），带 language: zh。记下每个请求，测试看删没删。
 */
import { createServer, type Server } from 'node:http'

export const STT_LINES = ['可是在中国，赛百味一直是两头不讨好的生意。', '它的价格比麦当劳贵。', '味道又不如本地的快餐。', '那它为什么突然卖爆了？']

/** 英文的（端到端测试用它：听写出英文，再由假翻译翻成中文，画面上是双语） */
export const STT_LINES_EN = ['But in China, Subway has always been a lose-lose business.', 'It costs more than McDonald’s.', 'And it tastes worse than local fast food.', 'So why is it suddenly selling out?']

/** 一句拆成小段，和 Soniox 给的样子一样：中文一个字一段，英文一个词一段（带前导空格） */
export function sttTokens(lines = STT_LINES, language = 'zh'): { text: string; start_ms: number; end_ms: number; language: string }[] {
  const out: { text: string; start_ms: number; end_ms: number; language: string }[] = []
  lines.forEach((line, i) => {
    const parts = language === 'zh' ? [...line] : line.split(' ').map((w, j) => (j ? ' ' + w : w))
    parts.forEach((p, j) => {
      const start = i * 3000 + Math.round((j / parts.length) * 2600)
      out.push({ text: p, start_ms: start, end_ms: start + 100, language })
    })
  })
  return out
}

export interface FakeSoniox {
  server: Server
  base: string
  requests: { method: string; path: string; auth: string }[]
  /** 第几次问状态才说完成（默认第 2 次） */
  readyAfter: number
}

export async function startFakeSoniox(o: { key?: string; readyAfter?: number; english?: boolean } = {}): Promise<FakeSoniox> {
  const key = o.key ?? 'test-soniox-key'
  const state: FakeSoniox = { server: null as unknown as Server, base: '', requests: [], readyAfter: o.readyAfter ?? 2 }
  let polls = 0
  state.server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    state.requests.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? '' })
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${key}`) return json(401, { message: 'Invalid API key' })
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (req.method === 'POST' && path === '/v1/files') {
        const body = Buffer.concat(chunks).toString('latin1')
        if (!/name="file"/.test(body)) return json(400, { message: 'no file' })
        return json(201, { id: 'file-1', filename: 'audio.m4a', size: chunks.reduce((n, c) => n + c.length, 0), created_at: new Date().toISOString() })
      }
      if (req.method === 'POST' && path === '/v1/transcriptions') {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string; file_id?: string }
        if (b.model !== 'stt-async-v6' || b.file_id !== 'file-1') return json(400, { message: 'bad request' })
        return json(201, { id: 'tr-1', status: 'queued' })
      }
      if (req.method === 'GET' && path === '/v1/transcriptions/tr-1') return json(200, { id: 'tr-1', status: ++polls >= state.readyAfter ? 'completed' : 'processing' })
      if (req.method === 'GET' && path === '/v1/transcriptions/tr-1/transcript') return json(200, { id: 'tr-1', text: (o.english ? STT_LINES_EN : STT_LINES).join(' '), tokens: o.english ? sttTokens(STT_LINES_EN, 'en') : sttTokens() })
      if (req.method === 'DELETE' && (path === '/v1/transcriptions/tr-1' || path === '/v1/files/file-1')) {
        res.writeHead(204)
        return res.end()
      }
      json(404, { message: 'not found' })
    })
  })
  await new Promise<void>((r) => state.server.listen(0, '127.0.0.1', r))
  state.base = `http://127.0.0.1:${(state.server.address() as { port: number }).port}`
  return state
}
