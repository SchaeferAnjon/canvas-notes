/**
 * 没字幕的视频生成字幕（CN-69 方向 A）：内置的 yt-dlp 只下音频 → Soniox 异步听写 → 断句成一条字幕轨（存成 WebVTT）。
 * 翻译不在这里：生成的轨交给现在的字幕流程（双语翻译插件、同一套引擎、缓存、术语表）。
 * 不依赖 Electron：下载器路径、密钥、Soniox 地址都由调用方给，单元测试用假的 yt-dlp 和假的 Soniox 跑。
 *
 * Soniox 异步接口（截至 2026-11-17 文档 https://docs.soniox.com/api-reference/stt/transcriptions/create_transcription ）：
 *   POST /v1/files（multipart，字段 file）→ id；POST /v1/transcriptions { model, file_id } → id；
 *   GET /v1/transcriptions/{id} 等 status 变 completed / error；GET /v1/transcriptions/{id}/transcript → tokens；
 *   完了 DELETE 转写和文件。认证 Authorization: Bearer <SONIOX_API_KEY>。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Cue } from '../../shared/video'
import { dbg } from './log'

export const SONIOX_MODEL = 'stt-async-v6'
export const SONIOX_BASE = 'https://api.soniox.com'

/** Soniox 给的一小段（英文多是半个词带前导空格，中文一个字） */
export interface SttToken {
  text: string
  start_ms: number
  end_ms: number
  language?: string
}

// ---------------------------------------------------------------- 断句

const END = /[。！？!?…]$|[.;；](?:["'”’)）]*)$/
const SOFT = /[，,、：:]$/
const CJK = /[぀-ヿ㐀-鿿가-힯]/

/** 一句的长度：中日韩一个字算一个，西文按字母算一半 */
const width = (s: string) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0)

/**
 * 听写的小段 → 一句一句的字幕：句号问号断；停顿超过 0.8 秒断；太长（约 32 个汉字 / 64 个字母）在逗号处断，
 * 再长就硬断。每句的开始是第一段的开始，结束是最后一段的结束。
 */
export function tokensToCues(tokens: SttToken[], opts: { gapMs?: number; max?: number } = {}): Cue[] {
  const gap = opts.gapMs ?? 800
  const max = opts.max ?? 32
  const out: Cue[] = []
  let text = ''
  let start = 0
  let end = 0
  const flush = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t) out.push({ start: start / 1000, end: end / 1000, text: t })
    text = ''
  }
  for (const tok of tokens) {
    if (!tok.text || tok.text === '<end>') continue
    // 停顿太久、太长了就断，但只在词和词之间断（英文的半个词不拆开，真 Soniox 给过「reall」停一下「y」）
    const boundary = /^\s/.test(tok.text) || CJK.test(tok.text[0]!) || CJK.test(text.slice(-1))
    if (text && boundary && (tok.start_ms - end > gap || width(text.trim()) >= max * 1.5)) flush()
    if (!text) start = tok.start_ms
    text += tok.text
    end = tok.end_ms
    const t = text.trim()
    if (END.test(t) || (width(t) >= max * 0.6 && SOFT.test(t))) flush()
  }
  flush()
  return out
}

/** 这段话主要是什么语言（Soniox 每段带 language）；没有就是 null */
export function mainLanguage(tokens: SttToken[]): string | null {
  const n = new Map<string, number>()
  for (const t of tokens) if (t.language) n.set(t.language, (n.get(t.language) ?? 0) + t.text.length)
  let best: string | null = null
  for (const [k, v] of n) if (!best || v > n.get(best)!) best = k
  return best
}

// ---------------------------------------------------------------- WebVTT

const ts = (sec: number) => {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

/** 存进库的字幕：WebVTT，开头一行 NOTE 记语言和是谁听写的（换台 Mac 不用再花钱听写） */
export function cuesToVtt(cues: Cue[], meta: { lang: string; source: string }): string {
  const body = cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text.replace(/\n/g, ' ')}`).join('\n\n')
  return `WEBVTT\n\nNOTE lang=${meta.lang} source=${meta.source}\n\n${body}\n`
}

export function parseVtt(text: string): { lang: string | null; cues: Cue[] } {
  const lang = /^NOTE lang=(\S+)/m.exec(text)?.[1] ?? null
  const sec = (s: string) => {
    const m = /^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/.exec(s.trim())
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, '0').slice(0, 3)) / 1000 : NaN
  }
  const cues: Cue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i === -1) continue
    const [a, b] = lines[i]!.split('-->')
    const start = sec(a!)
    const end = sec(b!.trim().split(/\s+/)[0]!)
    const t = lines
      .slice(i + 1)
      .join(' ')
      .trim()
    if (t && Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: t })
  }
  return { lang, cues }
}

/** 生成的字幕存在库里哪：.canvas-notes/字幕/<站>-<视频号>.vtt（跟着 Git 走） */
export const sttPath = (v: { site: string; id: string; p?: number }) => `.canvas-notes/字幕/${v.site}-${v.id}${v.p && v.p > 1 ? `-p${v.p}` : ''}.vtt`

// ---------------------------------------------------------------- 下载音频（yt-dlp）

/** 找 yt-dlp：CN_YTDLP（测试用的假的）→ 包里带的 → 常见安装位置 */
export function findYtDlp(bundled: string | null): string | null {
  const env = process.env.CN_YTDLP
  if (env) return env
  for (const p of [bundled, '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) if (p && existsSync(p)) return p
  return null
}

/**
 * 只下音频（m4a，不要 ffmpeg）到 dir，返回文件路径。cookies：B 站要登录时，右栏网页的登录写成的 cookies.txt。
 * 停下（signal）就杀掉 yt-dlp。
 * --http-chunk-size：分段下，每次请求都带 Range。B 站把音频随机分到几家 CDN，其中 upos-sz-mirrorcosov（腾讯 EdgeOne）
 * 对不带 Range 的请求一律回 HTTP 567，yt-dlp 默认整段下不带 Range，分到它就下不下来（2026-11-17 实测：同一地址不带 Range 567、带了 206）。
 */
export function downloadAudio(o: { url: string; dir: string; bin: string; cookies?: string; signal: AbortSignal; timeoutMs?: number }): Promise<string> {
  const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-progress', '--no-warnings', '--http-chunk-size', '10M', '-o', join(o.dir, 'audio.%(ext)s'), ...(o.cookies ? ['--cookies', o.cookies] : []), o.url]
  return new Promise((resolve, reject) => {
    execFile(o.bin, args, { signal: o.signal, timeout: o.timeoutMs ?? 10 * 60_000, maxBuffer: 16 * 1024 * 1024 }, async (err, _out, stderr) => {
      if (err) {
        if ((err as Error).name === 'AbortError') return reject(Object.assign(new Error('停下了'), { name: 'AbortError' }))
        const why = String(stderr).split('\n').find((l) => /ERROR/.test(l)) ?? (err as Error).message
        return reject(new Error(`音频没下载下来：${why.replace(/^ERROR:\s*/, '').slice(0, 200)}`))
      }
      try {
        const f = (await readdir(o.dir)).find((n) => n.startsWith('audio.') && !n.endsWith('.part'))
        if (!f) return reject(new Error('音频没下载下来：yt-dlp 没留下文件'))
        resolve(join(o.dir, f))
      } catch (e) {
        reject(e)
      }
    })
  })
}

// ---------------------------------------------------------------- Soniox 听写

export interface SonioxOptions {
  key: string
  base?: string
  signal: AbortSignal
  /** 等转写时多久问一次（毫秒） */
  pollMs?: number
  /** 一共最多等多久 */
  timeoutMs?: number
}

async function api<T>(o: SonioxOptions, method: string, path: string, body?: BodyInit, json = true): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${o.base ?? SONIOX_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${o.key}`, ...(body && json ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.any([o.signal, AbortSignal.timeout(120_000)]),
    })
  } catch (e) {
    // 用户点了停下：照原样往外抛。别的（连不上、超时）是网络问题：带上「连不上 Soniox」，界面说清是网络（stt-errors.ts）
    if (o.signal.aborted) throw e
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    const code = cause?.code ?? cause?.message
    throw new Error(`连不上 Soniox：${(e as Error).message}${code ? ` (${code})` : ''}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const msg = (() => {
      try {
        const j = JSON.parse(text) as { message?: string; error_message?: string }
        return j.message ?? j.error_message ?? text
      } catch {
        return text
      }
    })()
    if (res.status === 401) throw new Error('Soniox 密钥不对：到设置 › AI 里重新填')
    if (res.status === 402) throw new Error('Soniox 账户余额不够了')
    throw new Error(`Soniox 出错（${res.status}）：${msg.slice(0, 200)}`)
  }
  return (method === 'DELETE' ? null : await res.json()) as T
}

/** 上传 → 建转写 → 等完成 → 取结果；不管成没成，最后都删掉云端的文件和转写 */
export async function sonioxTranscribe(file: string, o: SonioxOptions): Promise<SttToken[]> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)]), file.split('/').pop()!)
  const up = await api<{ id: string }>(o, 'POST', '/v1/files', form, false)
  dbg('stt Soniox 上传好了')
  let tid: string | null = null
  try {
    const tr = await api<{ id: string }>(o, 'POST', '/v1/transcriptions', JSON.stringify({ model: SONIOX_MODEL, file_id: up.id, enable_language_identification: true }))
    tid = tr.id
    dbg('stt Soniox 开始听写')
    const deadline = Date.now() + (o.timeoutMs ?? 30 * 60_000)
    for (;;) {
      const st = await api<{ status: string; error_message?: string }>(o, 'GET', `/v1/transcriptions/${tid}`)
      if (st.status === 'completed') break
      if (st.status === 'error') throw new Error(`Soniox 没听写成：${st.error_message ?? '没说原因'}`)
      if (Date.now() > deadline) throw new Error('Soniox 半小时还没听写完，停下了')
      await new Promise<void>((r, j) => {
        const t = setTimeout(r, o.pollMs ?? 1500)
        o.signal.addEventListener('abort', () => (clearTimeout(t), j(Object.assign(new Error('停下了'), { name: 'AbortError' }))), { once: true })
      })
    }
    const out = await api<{ tokens?: SttToken[] }>(o, 'GET', `/v1/transcriptions/${tid}/transcript`)
    return out.tokens ?? []
  } finally {
    // 云端不留东西；删不掉不影响这次的结果
    const clean = { ...o, signal: AbortSignal.timeout(15_000) }
    if (tid) await api(clean, 'DELETE', `/v1/transcriptions/${tid}`).catch((e) => console.warn('[stt] 转写没删掉', (e as Error).message))
    await api(clean, 'DELETE', `/v1/files/${up.id}`).catch((e) => console.warn('[stt] 上传的音频没删掉', (e as Error).message))
  }
}
