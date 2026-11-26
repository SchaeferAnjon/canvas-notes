import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CliBackend } from '../src/main/plugins/host'
import { askApi, PROVIDERS } from '../src/main/plugins/translate/api'
import { fakeCli } from '../src/main/plugins/translate/cli'
import { classify, TranslateError } from '../src/main/plugins/translate/errors'
import { cleanKey, KeyStore } from '@cn/ai-engines'
import { EngineRouter, noneReason } from '../src/main/plugins/translate/router'
import { batches, TranslateService } from '../src/main/plugins/translate/service'
import { buildPrompt, TranslationCache, Translator } from '../src/main/plugins/translate/translator'
import { DEFAULT_TRANSLATE, errorTitle, normalizeTranslate, type TranslateSettings, type TrErrorCode } from '../src/shared/plugins/translate'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-tr-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// ---------------------------------------------------------------- 假的 OpenAI 兼容服务（不用真的 Key）

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void
let server: Server
let base: string
let handler: Handler = () => undefined
const seen: { auth?: string; body: Record<string, unknown> }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') })
      handler(req, body, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

/** 照 DeepSeek 的流式格式回：data: {chunk}，最后 data: [DONE] */
function stream(res: ServerResponse, parts: string[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })}\n\n`)
  for (const p of parts) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  res.end('data: [DONE]\n\n')
}
const env = () => ({ CN_TR_API_BASE_DEEPSEEK: base, CN_TR_API_BASE_ZHIPU: base })

describe('没翻成的原因：原话认成 11 种', () => {
  const cases: [string, number | undefined, TrErrorCode][] = [
    ['没找到 claude 命令。装 Claude Code：…', undefined, 'not-installed'],
    ['Claude Code 没答完：Invalid API key · Please run /login', undefined, 'not-logged-in'],
    ['Gemini 还没登录：在终端里运行一次 gemini', undefined, 'not-logged-in'],
    ['There\'s an issue with the selected model (claude-haiku). unrecognized_model', undefined, 'bad-model'],
    ['DeepSeek 回了 401：Authentication Fails', 401, 'bad-key'],
    ['DeepSeek 回了 402：Insufficient Balance', 402, 'no-balance'],
    ['智谱 GLM 回了 429：余额不足或无可用资源包,请充值。（1113）', 429, 'no-balance'],
    ['DeepSeek 回了 429：Rate Limit Reached', 429, 'rate-limit'],
    ['fetch failed（ENOTFOUND）', undefined, 'network'],
    ['Codex 等了 60 秒没回应', undefined, 'timeout'],
    ['Claude Code 退出了（1）', undefined, 'exited'],
    ['AI 回的格式不对，漏了 3 段', undefined, 'bad-output'],
    ['Something odd happened. More text here.', undefined, 'other'],
  ]
  it.each(cases)('%s → %s', (raw, status, code) => {
    expect(classify(raw, 'claude', status).code).toBe(code)
  })

  it('汇总那句', () => {
    expect(errorTitle({ code: 'not-logged-in', engine: 'claude', raw: '' })).toBe('Claude Code还没登录')
    expect(errorTitle({ code: 'bad-model', engine: 'claude', raw: '' })).toBe('Claude Code用不了Haiku这个模型')
    expect(errorTitle({ code: 'bad-key', engine: 'deepseek', raw: '' })).toBe('DeepSeek的Key不对')
    expect(errorTitle({ code: 'rate-limit', engine: 'deepseek', raw: '' })).toBe('问得太快，DeepSeek让等一会儿')
    expect(errorTitle({ code: 'timeout', engine: 'codex', raw: 'Codex 等了 60 秒没回应' })).toBe('Codex 60秒没回应')
    expect(errorTitle({ code: 'bad-output', raw: 'AI 回的格式不对，漏了 3 段（已经自动重问过一次）' })).toBe('AI回的格式不对，漏了 3 段')
    expect(errorTitle({ code: 'other', raw: 'A'.repeat(80) })).toBe('A'.repeat(60) + '…')
    expect(errorTitle({ code: 'none', raw: '' })).toBe('现在没有能翻的')
  })
})

describe('API：OpenAI 兼容的流式 chat/completions', () => {
  beforeEach(() => (seen.length = 0))

  it('照 DeepSeek 的格式发：Bearer Key、deepseek-flash、stream、不要思考过程；边收边给', async () => {
    handler = (_req, _b, res) => stream(res, ['{"id":1,"text":"特', '征值"}\n'])
    const got: string[] = []
    const out = await askApi(PROVIDERS.deepseek, 'sk-test-1234', 'sys', 'hi', new AbortController().signal, (d) => got.push(d), 5000, env())
    expect(out).toBe('{"id":1,"text":"特征值"}\n')
    expect(got).toEqual(['{"id":1,"text":"特', '征值"}\n'])
    expect(seen[0]!.auth).toBe('Bearer sk-test-1234')
    expect(seen[0]!.body).toMatchObject({ model: 'deepseek-flash', stream: true, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] })
  })

  it('401 Key 不对、402 余额不够、429 太快、智谱 1113 余额不够', async () => {
    const codeOf = async (status: number, body: string, p = PROVIDERS.deepseek) => {
      handler = (_req, _b, res) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(body)
      }
      try {
        await askApi(p, 'sk-xxxxxxxx', 's', 'p', new AbortController().signal, () => undefined, 5000, env())
        return 'ok'
      } catch (e) {
        expect(e).toBeInstanceOf(TranslateError)
        return (e as TranslateError).info.code
      }
    }
    expect(await codeOf(401, '{"error":{"message":"Authentication Fails"}}')).toBe('bad-key')
    expect(await codeOf(402, '{"error":{"message":"Insufficient Balance"}}')).toBe('no-balance')
    expect(await codeOf(429, '{"error":{"message":"Rate Limit Reached"}}')).toBe('rate-limit')
    expect(await codeOf(429, '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}', PROVIDERS.zhipu)).toBe('no-balance')
  })

  it('连不上是 network；一个字都不来到点了是 timeout', async () => {
    await expect(askApi(PROVIDERS.deepseek, 'sk-xxxxxxxx', 's', 'p', new AbortController().signal, () => undefined, 5000, { CN_TR_API_BASE_DEEPSEEK: 'http://127.0.0.1:9' })).rejects.toMatchObject({
      info: { code: 'network', engine: 'deepseek' },
    })
    handler = () => undefined // 不回
    await expect(askApi(PROVIDERS.deepseek, 'sk-xxxxxxxx', 's', 'p', new AbortController().signal, () => undefined, 300, env())).rejects.toMatchObject({
      info: { code: 'timeout', raw: 'DeepSeek 等了 0 秒没回应' },
    })
  })
})

describe('Key：加密存、只露最后 4 位、用时才解开', () => {
  const cipher = (log: string[]) => ({
    encrypt: (s: string) => Buffer.from([...s].reverse().join('') + '#enc'),
    decrypt: (b: Buffer) => (log.push('decrypt'), [...b.toString().replace(/#enc$/, '')].reverse().join('')),
  })

  it('文件里没有明文；重开读回来；看尾巴不解密', () => {
    const file = join(root, 'keys.json')
    const log: string[] = []
    const k = new KeyStore(file, cipher(log))
    k.set('deepseek', 'sk-abcdefgh1234a3f9')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-abcdefgh1234a3f9')
    const again = new KeyStore(file, cipher(log))
    expect(again.tail('deepseek')).toBe('a3f9')
    expect(log).toEqual([])
    expect(again.get('deepseek')).toBe('sk-abcdefgh1234a3f9')
    expect(log).toEqual(['decrypt'])
    again.delete('deepseek')
    expect(new KeyStore(file, cipher(log)).has('deepseek')).toBe(false)
  })

  it('只放内存时不写文件；粘贴的 Key 去空白、去引号，不像 Key 的不收', () => {
    const k = new KeyStore(null, null)
    k.set('zhipu', 'abc.defghijk')
    expect(k.get('zhipu')).toBe('abc.defghijk')
    expect(cleanKey('  "sk-12345678"\n')).toBe('sk-12345678')
    expect(cleanKey('Bearer sk-12345678')).toBe('sk-12345678')
    expect(() => cleanKey('sk 123 456 789')).toThrow(/不像一个 API Key/)
    expect(() => cleanKey('short')).toThrow()
  })
})

describe('翻译用什么：自动按顺序换、指定一个就只用它', () => {
  function setup(o: { cli?: Record<string, 'ok' | 'login' | 'missing'>; fail?: Record<string, string>; keys?: Record<string, string>; settings?: Partial<TranslateSettings> }) {
    const calls: string[] = []
    const cli: CliBackend = {
      state: (id) => o.cli?.[id] ?? 'missing',
      async ask(id, _s, prompt) {
        calls.push(id)
        if (o.fail?.[id]) throw new Error(o.fail[id])
        return `${id}:${prompt.length}`
      },
    }
    const keys = new KeyStore(null, null)
    for (const [id, k] of Object.entries(o.keys ?? {})) keys.set(id, k)
    // 这一组测「按顺序」：默认（2026-11-25 起是只用 Claude Code · Opus）之外明着给 auto
    const settings: TranslateSettings = { ...DEFAULT_TRANSLATE, engineMode: 'auto', ...o.settings }
    const r = new EngineRouter({ cli, keys, settings: () => settings, env: env() })
    return { r, calls, settings }
  }

  it('自动：没装、没登录的跳过，用第一个能用的', async () => {
    const { r, calls } = setup({ cli: { claude: 'missing', codex: 'login', gemini: 'ok' } })
    expect(r.current()).toBe('gemini')
    expect((await r.ask('s', 'p', new AbortController().signal, () => undefined)).engine).toBe('gemini')
    expect(calls).toEqual(['gemini'])
    expect(r.label('claude')).toBe('Claude Code · Haiku')
    expect(r.label('deepseek')).toBe('DeepSeek API')
  })

  it('自动：问的时候发现没登录，换下一个不打扰人，后面的批也跳过它；按翻译按钮重新查时再给它一次机会', async () => {
    const { r, calls } = setup({ cli: { claude: 'ok', codex: 'ok' }, fail: { claude: 'Invalid API key · Please run /login' } })
    expect((await r.ask('s', 'p', new AbortController().signal, () => undefined)).engine).toBe('codex')
    expect(r.state('claude')).toBe('login')
    await r.ask('s', 'p', new AbortController().signal, () => undefined)
    expect(calls).toEqual(['claude', 'codex', 'codex'])
    r.preflight()
    expect(r.state('claude')).toBe('ok')
  })

  it('自动：网络断、退出这类不换，直接报', async () => {
    const { r } = setup({ cli: { claude: 'ok', codex: 'ok' }, fail: { claude: 'Claude Code 退出了（1）' } })
    await expect(r.ask('s', 'p', new AbortController().signal, () => undefined)).rejects.toMatchObject({ info: { code: 'exited', engine: 'claude' } })
  })

  it('自动：唯一能用的也不行，报它的原因；一个都没有是 none，说清各自怎么了', async () => {
    const one = setup({ cli: { claude: 'ok' }, fail: { claude: 'not logged in' } })
    await expect(one.r.ask('s', 'p', new AbortController().signal, () => undefined)).rejects.toMatchObject({ info: { code: 'not-logged-in', engine: 'claude' } })
    const none = setup({ cli: { gemini: 'login' } })
    const pre = none.r.preflight()
    expect(pre).toMatchObject({ ok: false, error: { code: 'none' } })
    expect(!pre.ok && pre.error.raw).toBe('Claude Code、Codex、OpenCode没装，Gemini没登录，API都没填Key')
    expect(noneReason([{ id: 'deepseek', name: 'DeepSeek', kind: 'api', state: 'badkey' }])).toBe('DeepSeek Key不对')
  })

  it('指定一个：它不行就直接报，不换别的', async () => {
    const { r, calls } = setup({ cli: { claude: 'ok', codex: 'login' }, settings: { engineMode: 'pick', pick: 'codex' } })
    expect(r.current()).toBeNull()
    expect(r.preflight()).toMatchObject({ ok: false, error: { code: 'not-logged-in', engine: 'codex' } })
    await expect(r.ask('s', 'p', new AbortController().signal, () => undefined)).rejects.toMatchObject({ info: { code: 'not-logged-in' } })
    expect(calls).toEqual([])
    const k = setup({ settings: { engineMode: 'pick', pick: 'deepseek' } })
    expect(k.r.preflight()).toMatchObject({ ok: false, error: { code: 'no-key', engine: 'deepseek' } })
  })

  it('命令行都没有时用 DeepSeek API；Key 不对记下来，自动模式换下一个（智谱）', async () => {
    seen.length = 0
    handler = (req, _b, res) => {
      if (req.headers.authorization === 'Bearer sk-bad-00000') {
        res.writeHead(401)
        return res.end('{"error":{"message":"Authentication Fails"}}')
      }
      stream(res, ['ok'])
    }
    const { r } = setup({ keys: { deepseek: 'sk-bad-00000', zhipu: 'zp.good-1111' } })
    expect(r.statuses().find((e) => e.id === 'deepseek')).toMatchObject({ state: 'ok', keyTail: '0000' })
    const out = await r.ask('s', 'p', new AbortController().signal, () => undefined)
    expect(out).toEqual({ text: 'ok', engine: 'zhipu' })
    expect(r.state('deepseek')).toBe('badkey')
    expect(seen.map((s) => s.body.model)).toEqual(['deepseek-flash', 'glm-5.3-flash'])
    // 按翻译按钮重新查：API 的「Key 不对」留着，换了 Key 才清
    r.preflight()
    expect(r.state('deepseek')).toBe('badkey')
    r.forget('deepseek')
    expect(r.state('deepseek')).toBe('ok')
  })

  it('命令行一分钟（测试里缩短）一个字都不吐：报「等了 N 秒没回应」', async () => {
    const cli: CliBackend = { state: () => 'ok', ask: (_id, _s, _p, signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('停下了')))) }
    const r = new EngineRouter({ cli, keys: new KeyStore(null, null), settings: () => ({ ...DEFAULT_TRANSLATE, engineMode: 'pick', pick: 'codex' }), idleMs: 200 })
    await expect(r.ask('s', 'p', new AbortController().signal, () => undefined)).rejects.toMatchObject({ info: { code: 'timeout', engine: 'codex', raw: 'Codex 等了 0 秒没回应' } })
  })

  it('同一个 API 同时问的次数有上限（智谱 2）', async () => {
    let running = 0
    let peak = 0
    handler = (_req, _b, res) => {
      running++
      peak = Math.max(peak, running)
      setTimeout(() => {
        running--
        stream(res, ['x'])
      }, 40)
    }
    const { r } = setup({ keys: { zhipu: 'zp.good-1111' }, settings: { engineMode: 'pick', pick: 'zhipu' } })
    await Promise.all(Array.from({ length: 6 }, () => r.ask('s', 'p', new AbortController().signal, () => undefined)))
    expect(peak).toBe(2)
  })

  it('假命令行（端到端测试用）：状态和出错都按环境变量', async () => {
    const f = fakeCli({ CN_TR_FAKE_CLI: 'claude=login,codex=missing', CN_TR_FAKE_FAIL: 'gemini=boom', CN_AI_FAKE_DELAY_MS: '1' })
    expect([f.state('claude'), f.state('codex'), f.state('gemini')]).toEqual(['login', 'missing', 'ok'])
    await expect(f.ask('gemini', 's', '命令：翻译段落', new AbortController().signal, () => undefined)).rejects.toThrow('boom')
    const out = await f.ask('opencode', 's', buildPrompt([{ id: 1, text: 'The eigenvalue is 3.' }], 'zh-CN'), new AbortController().signal, () => undefined)
    expect(JSON.parse(out.trim())).toEqual({ id: 1, text: '译文：The eigenvalue is 3.' })
  })
})

describe('设置', () => {
  it('新加的几项有默认值；顺序去重、补全', () => {
    expect(normalizeTranslate(undefined)).toEqual(DEFAULT_TRANSLATE)
    // r172：默认只用 Claude Code · Opus 5.5 · High（用户定）
    expect(DEFAULT_TRANSLATE).toMatchObject({ style: 'plain', clipWithTranslation: false, engineMode: 'pick', pick: 'claude', pickModel: 'claude-opus-5-5', pickEffort: 'high', engineOrder: ['claude', 'codex', 'gemini', 'opencode', 'deepseek', 'zhipu'] })
    const s = normalizeTranslate({ style: 'blur', clipWithTranslation: true, engineMode: 'pick', pick: 'zhipu', engineOrder: ['deepseek', 'deepseek', 'xx', 'claude'] })
    expect(s).toMatchObject({ style: 'blur', clipWithTranslation: true, engineMode: 'pick', pick: 'zhipu' })
    expect(s.engineOrder).toEqual(['deepseek', 'claude', 'codex', 'gemini', 'opencode', 'zhipu'])
    expect(normalizeTranslate({ style: 'italic', clipWithTranslation: 'yes', pick: 'gpt' })).toMatchObject({ style: 'plain', clipWithTranslation: false, pick: 'claude' })
  })

  it('旧设置停在旧默认（按顺序、没选模型）的换成 Claude Code · Opus 5.5 · High；选过别家的照旧；新存的再选按顺序就是按顺序', () => {
    const old = { target: 'en', engineMode: 'auto', pick: 'claude', engineOrder: ['claude', 'codex', 'gemini', 'opencode', 'deepseek', 'zhipu'] }
    expect(normalizeTranslate(old)).toMatchObject({ target: 'en', engineMode: 'pick', pick: 'claude', pickModel: 'claude-opus-5-5', pickEffort: 'high', engineV: 2 })
    expect(normalizeTranslate({ engineMode: 'pick', pick: 'codex', pickModel: 'gpt-6.1-terra' })).toMatchObject({ engineMode: 'pick', pick: 'codex', pickModel: 'gpt-6.1-terra' })
    // 存回去带 engineV 2：之后在设置里选按顺序，读出来还是按顺序
    const saved = normalizeTranslate({ ...normalizeTranslate(old), engineMode: 'auto' })
    expect(normalizeTranslate(JSON.parse(JSON.stringify(saved)))).toMatchObject({ engineMode: 'auto' })
  })
})

describe('不带术语表（2026-11-22 拿掉了，task-6cxtc）', () => {
  it('翻译的提示不带「术语照这个译」；缓存只按目标语言和原文：库里有 术语表.md 也一样', async () => {
    const prompts: string[] = []
    const t = new Translator(async (_s, prompt) => {
      prompts.push(prompt)
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number; text: string }[]
      return items.map((i) => JSON.stringify({ id: i.id, text: `译${prompts.length}` })).join('\n')
    }, new TranslationCache(null))
    const items = [
      { id: 1, text: 'The eigenvalue is 3.' },
      { id: 2, text: 'Plain sentence.' },
    ]
    await t.translate(items, 'zh-CN', () => undefined, new AbortController().signal)
    expect(prompts[0]).not.toContain('术语')
    const got: [number, string | null][] = []
    await t.translate(items, 'zh-CN', (id, text) => got.push([id, text]), new AbortController().signal)
    expect(prompts).toHaveLength(1)
    expect(got).toEqual([
      [1, '译1'],
      [2, '译1'],
    ])
    expect(buildPrompt(items, 'zh-CN')).not.toContain('术语')
  })

  it('重新翻译（fresh）不读缓存，翻好的换掉缓存里的旧译文', async () => {
    let n = 0
    const t = new Translator(async (_s, prompt) => {
      n++
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number; text: string }[]
      return items.map((i) => JSON.stringify({ id: i.id, text: `译${n}` })).join('\n')
    }, new TranslationCache(null))
    const items = [{ id: 1, text: 'Rotate the plane.' }]
    const got: (string | null)[] = []
    const on = (_id: number, text: string | null) => got.push(text)
    await t.translate(items, 'zh-CN', on, new AbortController().signal)
    await t.translate(items, 'zh-CN', on, new AbortController().signal)
    await t.translate(items, 'zh-CN', on, new AbortController().signal, true)
    await t.translate(items, 'zh-CN', on, new AbortController().signal)
    expect(got).toEqual(['译1', '译1', '译2', '译2'])
  })
})

describe('给网页阅读视图、右键翻译用的接口：一串块进、一块块译文出', () => {
  it('切批：最多 12 块、1200 字；按顺序', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ text: 'x'.repeat(i === 3 ? 2000 : 10) }))
    const b = batches(list)
    expect(b.map((x) => x.length)).toEqual([3, 1, 12, 12, 2])
  })

  it('AI 回了空的译文（一句拆在两行字幕里，它把整句译文放进一行、另一行留空）：当漏了，单独再问一次；空的不进缓存，缓存里旧的空译文也不用', async () => {
    const prompts: string[] = []
    const cache = new TranslationCache(null)
    // 0.4.6 存下的空译文
    cache.set('zh-CN', 'stale empty', '')
    const t = new Translator(async (_s, prompt) => {
      prompts.push(prompt)
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number; text: string }[]
      // 头一次：第二段留空；单独问时好好翻
      return items.map((i) => JSON.stringify({ id: i.id, text: items.length > 1 && i.id === 2 ? '' : `译：${i.text}` })).join('\n')
    }, cache)
    const got: [number, string | null][] = []
    await t.translate(
      [
        { id: 1, text: 'their Cloud accounts' },
        { id: 2, text: 'have been banned.' },
        { id: 3, text: 'stale empty' },
      ],
      'zh-CN',
      (id, text) => got.push([id, text]),
      new AbortController().signal,
    )
    expect(got.sort()).toEqual([
      [1, '译：their Cloud accounts'],
      [2, '译：have been banned.'],
      [3, '译：stale empty'],
    ])
    expect(prompts).toHaveLength(2)
    expect(cache.get('zh-CN', 'have been banned.')).toBe('译：have been banned.')
    // 一直回空的：两次以后报没翻成，空的不进缓存（下次重试照样去问）
    const empty = new Translator(async (_s, prompt) => (JSON.parse(prompt.split('\n').pop()!) as { id: number }[]).map((i) => JSON.stringify({ id: i.id, text: ' ' })).join('\n'), new TranslationCache(null))
    const res: unknown[] = []
    await empty.translate([{ id: 1, text: 'x y' }], 'zh-CN', (id, text, error) => res.push([id, text, error?.code]), new AbortController().signal)
    expect(res).toEqual([[1, null, 'bad-output']])
    expect(empty.cache.get('zh-CN', 'x y')).toBeUndefined()
  })

  it('字符串编号原样回；空块不翻；库里有术语表也不带进提示；停下就不再回', async () => {
    const prompts: string[] = []
    const tr = new Translator(async (_s, prompt) => {
      prompts.push(prompt)
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number; text: string }[]
      return items.map((i) => JSON.stringify({ id: i.id, text: `译：${i.text}` })).join('\n')
    }, new TranslationCache(null))
    mkdirSync(join(root, '课程/线代'), { recursive: true })
    writeFileSync(join(root, '课程/线代/术语表.md'), '# 术语表\n\n| 原文 | 译法 | 备注 |\n| --- | --- | --- |\n| trace | 迹 |  |\n')
    const keys = new KeyStore(null, null)
    const router = new EngineRouter({ cli: { state: () => 'missing', ask: async () => '' }, keys, settings: () => DEFAULT_TRANSLATE })
    const svc = new TranslateService(tr, router, () => 'zh-CN')
    const got: unknown[] = []
    await svc.translateBlocks(
      [
        { id: 'p1-a', text: 'The trace of A' },
        { id: 'p1-b', text: '  ' },
        { id: 'p2-a', text: 'Second' },
      ],
      {},
      (r) => got.push(r),
      new AbortController().signal,
    )
    expect(got).toEqual([
      { id: 'p1-a', text: '译：The trace of A' },
      { id: 'p2-a', text: '译：Second' },
    ])
    expect(prompts[0]).not.toContain('术语')
    const ac = new AbortController()
    ac.abort()
    const none: unknown[] = []
    await svc.translateBlocks([{ id: 'z', text: 'new one' }], {}, (r) => none.push(r), ac.signal)
    expect(none).toEqual([])
    await expect(svc.translateBlocks([], { target: '' }, () => undefined, new AbortController().signal)).rejects.toThrow('目标语言不对')
  })
})
