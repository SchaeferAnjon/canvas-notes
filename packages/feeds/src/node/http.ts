/**
 * 联网：条件请求（If-None-Match / If-Modified-Since）、超时、自己跟跳转（记下永久跳转换地址）、大小上限、
 * 对每个站点客气（同一站点最多 2 个同时、两次开始之间至少隔 hostGapMs，全局最多 8 个同时）。
 * 只用 global fetch（Node 18+、Electron 主进程都有），测试换成本机服务器。
 */

export interface GetOptions {
  etag?: string | null
  lastModified?: string | null
  accept?: string
  /** 默认 maxBytes */
  maxBytes?: number
}

export interface HttpResult {
  status: number
  /** 最后落到的地址（跟完跳转） */
  url: string
  /** 一路都是永久跳转（301 / 308）时：新地址（订阅地址跟着换） */
  movedTo?: string
  headers: Headers
  body: Uint8Array
  notModified: boolean
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly headers?: Headers,
  ) {
    super(message)
  }
}

export interface HttpOptions {
  fetch?: typeof fetch
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
  perHost?: number
  hostGapMs?: number
  maxConcurrent?: number
  maxRedirects?: number
}

const ACCEPT_FEED = 'application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.7, */*;q=0.5'

class Gate {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private readonly max: number) {}
  async enter() {
    if (this.active < this.max) {
      this.active++
      return
    }
    await new Promise<void>((r) => this.queue.push(r))
  }
  leave() {
    const next = this.queue.shift()
    if (next) next()
    else this.active--
  }
}

export class Http {
  private readonly fetch: typeof fetch
  private readonly opts: Required<Omit<HttpOptions, 'fetch'>>
  private readonly global: Gate
  /** 每个站点：同时几个的闸，和「上一次真正开始后过了 hostGapMs」才放下一个的接力 */
  private readonly hosts = new Map<string, { gate: Gate; slot: Promise<void> }>()

  constructor(o: HttpOptions = {}) {
    this.fetch = o.fetch ?? globalThis.fetch
    this.opts = {
      userAgent: o.userAgent ?? 'CanvasFeeds/0.1 (RSS reader)',
      timeoutMs: o.timeoutMs ?? 20_000,
      maxBytes: o.maxBytes ?? 10 * 1024 * 1024,
      perHost: o.perHost ?? 2,
      hostGapMs: o.hostGapMs ?? 500,
      maxConcurrent: o.maxConcurrent ?? 8,
      maxRedirects: o.maxRedirects ?? 5,
    }
    this.global = new Gate(this.opts.maxConcurrent)
  }

  /** 排到这个站点、等够间隔，再跑 f */
  private async polite<T>(url: string, f: () => Promise<T>): Promise<T> {
    let host: string
    try {
      host = new URL(url).host
    } catch {
      throw new HttpError('地址不对')
    }
    let h = this.hosts.get(host)
    if (!h) this.hosts.set(host, (h = { gate: new Gate(this.opts.perHost), slot: Promise.resolve() }))
    await h.gate.enter()
    try {
      const prev = h.slot
      let release!: () => void
      h.slot = new Promise<void>((r) => (release = r))
      await prev
      // 从这一次真正开始算起，hostGapMs 以后才放下一个
      if (this.opts.hostGapMs > 0) setTimeout(release, this.opts.hostGapMs).unref()
      else release()
      await this.global.enter()
      try {
        return await f()
      } finally {
        this.global.leave()
      }
    } finally {
      h.gate.leave()
    }
  }

  async get(url: string, o: GetOptions = {}): Promise<HttpResult> {
    let cur = url
    let permanent = true
    for (let hop = 0; ; hop++) {
      const res = await this.polite(cur, () => this.once(cur, o))
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get('location')
        if (!loc) throw new HttpError(`跳转没给地址（HTTP ${res.status}）`, res.status, res.headers)
        if (hop >= this.opts.maxRedirects) throw new HttpError('跳转太多次', res.status, res.headers)
        if (res.status !== 301 && res.status !== 308) permanent = false
        cur = new URL(loc, cur).href
        if (!/^https?:/.test(cur)) throw new HttpError('跳到了不是网页的地址', res.status)
        continue
      }
      const moved = hop > 0 && permanent && cur !== url ? cur : undefined
      if (res.status === 304) return { status: 304, url: cur, headers: res.headers, body: new Uint8Array(), notModified: true, ...(moved ? { movedTo: moved } : {}) }
      if (res.status < 200 || res.status >= 300) throw new HttpError(`HTTP ${res.status}`, res.status, res.headers)
      return { status: res.status, url: cur, headers: res.headers, body: res.body, notModified: false, ...(moved ? { movedTo: moved } : {}) }
    }
  }

  private async once(url: string, o: GetOptions): Promise<{ status: number; headers: Headers; body: Uint8Array }> {
    const headers: Record<string, string> = { 'user-agent': this.opts.userAgent, accept: o.accept ?? ACCEPT_FEED, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }
    if (o.etag) headers['if-none-match'] = o.etag
    if (o.lastModified) headers['if-modified-since'] = o.lastModified
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs)
    try {
      const res = await this.fetch(url, { headers, redirect: 'manual', signal: ac.signal })
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => undefined)
        return { status: res.status, headers: res.headers, body: new Uint8Array() }
      }
      const max = o.maxBytes ?? this.opts.maxBytes
      const len = Number(res.headers.get('content-length') ?? 0)
      if (len > max) {
        await res.body?.cancel().catch(() => undefined)
        throw new HttpError(`太大了（超过 ${Math.round(max / 1024 / 1024)} MB）`, res.status)
      }
      const chunks: Uint8Array[] = []
      let size = 0
      if (res.body) {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > max) {
            await reader.cancel().catch(() => undefined)
            throw new HttpError(`太大了（超过 ${Math.round(max / 1024 / 1024)} MB）`, res.status)
          }
          chunks.push(value)
        }
      }
      const body = new Uint8Array(size)
      let off = 0
      for (const c of chunks) {
        body.set(c, off)
        off += c.byteLength
      }
      return { status: res.status, headers: res.headers, body }
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(netReason(e, ac.signal.aborted, this.opts.timeoutMs))
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 网络错误 → 给人看的中文 */
function netReason(e: unknown, aborted: boolean, timeoutMs: number): string {
  if (aborted) return `超时（${Math.round(timeoutMs / 1000)} 秒没抓完）`
  const code = ((e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code ?? '') as string
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '找不到这个网站（域名解析不了）'
  if (code === 'ECONNREFUSED') return '网站拒绝连接'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return '连接被断开'
  if (/CERT|SSL|TLS/i.test(code)) return '网站的证书不对'
  return `连不上（${code || (e as Error)?.message || '网络错误'}）`
}
