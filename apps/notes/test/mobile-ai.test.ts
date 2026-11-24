// iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：配对、签名、封包、局域网、拼给 AI 的话、二维码，和服务真起来一问一答（假的 AI）。
import { afterEach, describe, expect, test } from 'vitest'
import { randomBytes } from 'node:crypto'
import { ask, hello, pairWith, type Paired } from '../src/main/mobile-ai/client'
import { buildPrompt, checkAsk, EXPLAIN_Q, historyText, langLine, type MobileAsk, TRANSLATE_Q, VAULT_RULE } from '../src/main/mobile-ai/prompt'
import { vaultTools, VAULT_TOOLS } from '../src/main/mobile-ai/vault-tools'
import type { Vault } from '../src/main/vault'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  b64u,
  deviceSecretOf,
  type Frame,
  isLocalAddress,
  newKeyPair,
  open,
  pairedProof,
  pairKeyOf,
  pairLink,
  pairProof,
  parsePairLink,
  seal,
  sessionKeys,
  sharedSecret,
  signRequest,
  verifySignature,
} from '../src/main/mobile-ai/protocol'
import { encodeQr, qrSvgPath } from '../src/main/mobile-ai/qr'
import { type Device, type MobileServer, startMobileServer } from '../src/main/mobile-ai/server'

describe('配对和每一问的规矩', () => {
  test('两边算出同一个设备钥匙；配对码不对算出来的证明对不上', () => {
    const mac = newKeyPair()
    const pad = newKeyPair()
    const code = randomBytes(16)
    const a = sharedSecret(pad, mac.pub)
    const b = sharedSecret(mac, pad.pub)
    expect(a.equals(b)).toBe(true)
    const proof = pairProof(pairKeyOf(a, code), 'dev1', '一飞冲天')
    expect(pairProof(pairKeyOf(b, code), 'dev1', '一飞冲天').equals(proof)).toBe(true)
    expect(pairProof(pairKeyOf(b, randomBytes(16)), 'dev1', '一飞冲天').equals(proof)).toBe(false)
    // 名字被改了也对不上
    expect(pairProof(pairKeyOf(b, code), 'dev1', '别人').equals(proof)).toBe(false)
    expect(deviceSecretOf(a, code).equals(deviceSecretOf(b, code))).toBe(true)
    expect(pairedProof(deviceSecretOf(a, code), 'dev1').length).toBe(32)
  })

  test('签名：方法、路径、时间、nonce、请求体哪一样变了都对不上', () => {
    const keys = sessionKeys(randomBytes(32))
    const h = { device: 'd', time: 1000, nonce: b64u(randomBytes(12)) }
    const sig = signRequest(keys, 'POST', '/v1/ask', h, 'body')
    expect(verifySignature(keys, 'POST', '/v1/ask', h, 'body', sig)).toBe(true)
    expect(verifySignature(keys, 'POST', '/v1/ask', h, 'body2', sig)).toBe(false)
    expect(verifySignature(keys, 'GET', '/v1/ask', h, 'body', sig)).toBe(false)
    expect(verifySignature(keys, 'POST', '/v1/ask', { ...h, time: 1001 }, 'body', sig)).toBe(false)
    expect(verifySignature(sessionKeys(randomBytes(32)), 'POST', '/v1/ask', h, 'body', sig)).toBe(false)
  })

  test('封好的一段：钥匙、附带数据不对或被改过都打不开', () => {
    const k = randomBytes(32)
    const s = seal(k, '你好，Mac', 'n1')
    expect(open(k, s, 'n1')).toBe('你好，Mac')
    expect(() => open(k, s, 'n2')).toThrow()
    expect(() => open(randomBytes(32), s, 'n1')).toThrow()
    const raw = Buffer.from(s, 'base64url')
    raw[20] = raw[20]! ^ 1
    expect(() => open(k, raw.toString('base64url'), 'n1')).toThrow()
  })

  test('配对链接写进去读回来一样；缺东西、版本不对的不认', () => {
    const l = { v: 1, id: 'abcDEF123_-', key: b64u(randomBytes(32)), code: b64u(randomBytes(16)), name: 'Schaefer 的 MacBook Pro', port: 51234, addrs: ['192.168.1.23', '100.101.1.2'] }
    expect(parsePairLink(pairLink(l))).toEqual(l)
    expect(() => parsePairLink('https://example.com')).toThrow('这不是画布笔记的配对码')
    expect(() => parsePairLink(pairLink({ ...l, v: 2 }))).toThrow('版本对不上')
    expect(() => parsePairLink(pairLink({ ...l, code: 'abc' }))).toThrow('配对码不全')
  })

  test('只认这台 Mac、局域网和 Tailscale 的地址', () => {
    for (const a of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '172.31.255.1', '192.168.1.23', '169.254.10.1', '100.64.0.1', '100.127.255.254', '::1', '::ffff:192.168.0.8', 'fe80::1%en0', 'fd7a:115c:a1e0::1']) expect(isLocalAddress(a), a).toBe(true)
    for (const a of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '203.0.113.5', '2001:db8::1', '::ffff:8.8.8.8', undefined, '']) expect(isLocalAddress(a), String(a)).toBe(false)
  })
})

describe('拼给 AI 的话', () => {
  const pdf: MobileAsk['source'] = { kind: 'pdf', title: 'Linear transformations', path: '课程/线代/Linear transformations.pdf', page: 3, pages: 12, pageText: 'Grid lines stay straight.' }

  test('讲解一下：读 PDF 那一套问法，开头【语言】，选中的字和这一页的字都在', () => {
    const p = buildPrompt({ kind: 'explain', text: '', quote: 'Grid lines stay straight', source: pdf, lang: 'zh', device: 'iPad' })
    expect(p.appendSystem).toBe(true)
    expect(p.system).toContain('真讲明白')
    expect(p.system).toContain('只回答，不动手')
    expect(p.prompt.startsWith('【语言】默认用中文回答；用户用别的语言问，就用他问的那种语言答。')).toBe(true)
    expect(p.prompt).toContain('他现在在看第 3 页（共 12 页），PDF「Linear transformations」。这一页的文字：\n<page>\nGrid lines stay straight.\n</page>')
    expect(p.prompt).toContain(`他选中了这段字：「Grid lines stay straight」。\n他说：${EXPLAIN_Q}`)
    expect(p.prompt).toContain('他在iPad上问你。')
  })

  test('翻译 + 讲一讲的话和电脑版一字不差；没选字的讲解一下是问这一页', () => {
    expect(buildPrompt({ kind: 'translate', text: '', quote: 'x', source: pdf }).prompt).toContain(`他说：${TRANSLATE_Q}`)
    expect(TRANSLATE_Q).toBe('先把这块翻译成中文，再讲一讲')
    const page = buildPrompt({ kind: 'explain', text: '', source: pdf }).prompt
    expect(page).toContain('他问的是整页。\n他说：给我讲解一下这一页')
  })

  test('AI 对话：不附在命令行自己的系统提示后面，最后是「用户说：」；前面几轮、长期说明放最前面', () => {
    const p = buildPrompt({ kind: 'chat', text: '冰岛几月去好？', history: [{ role: 'user', text: '你好' }, { role: 'ai', text: '你好，想问什么？' }], note: '先说结论', lang: 'en' })
    expect(p.appendSystem).toBe(false)
    expect(p.system).toContain('只回答，不动手')
    expect(p.prompt.split('\n\n')[0]).toBe('之前聊过的（供参考）：\n用户：你好\nAI：你好，想问什么？')
    expect(p.prompt).toContain('【用户的长期说明】每一问都照这个来：\n先说结论\n')
    expect(p.prompt).toContain(langLine('en'))
    expect(p.prompt.endsWith('用户说：\n冰岛几月去好？')).toBe(true)
  })

  test('经 Mac 给了读库工具：AI 对话、选一段问的系统提示后面加读库的规矩；讲解、翻译、/ 命令和不给工具时一字不变（云端那份对照的样例不动）', () => {
    const chat: MobileAsk = { kind: 'chat', text: '我最近几个文档都是说什么的' }
    expect(buildPrompt(chat, { vault: true }).system).toBe(`${buildPrompt(chat).system}\n\n${VAULT_RULE}`)
    expect(buildPrompt(chat).system).not.toContain('list_recent')
    expect(buildPrompt(chat, { vault: true }).prompt).toBe(buildPrompt(chat).prompt)
    const ask1: MobileAsk = { kind: 'ask', text: '这段在哪篇还提到过', quote: 'x' }
    expect(buildPrompt(ask1, { vault: true }).system).toContain(VAULT_RULE)
    for (const a of [{ kind: 'explain', text: '', quote: 'x' }, { kind: 'translate', text: '', quote: 'x' }, { kind: 'cmd', text: '命令：总结' }] as MobileAsk[])
      expect(buildPrompt(a, { vault: true })).toEqual(buildPrompt(a))
    for (const t of VAULT_TOOLS) expect(VAULT_RULE).toContain(t)
  })

  test('前面聊过的只带最近 10 条、每条 600 字', () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? 'ai' : 'user') as 'user' | 'ai', text: `第${i}条` + 'x'.repeat(700) }))
    const h = historyText(turns)
    expect(h).not.toContain('第3条')
    expect(h).toContain('第4条')
    expect(h.split('\n')[1]!.length).toBe('用户：'.length + 600)
  })

  test('网页、笔记上选一段问', () => {
    const w = buildPrompt({ kind: 'ask', text: '这句是什么意思？', quote: 'read_csv', source: { kind: 'web', title: '2.2 数据预处理', url: 'https://zh.d2l.ai/x.html' } }).prompt
    expect(w).toContain('他在看网页「2.2 数据预处理」（https://zh.d2l.ai/x.html）。')
    expect(w).toContain('他选中了这段字：「read_csv」。\n他说：这句是什么意思？')
    const n = buildPrompt({ kind: 'explain', text: '', quote: '水位', source: { kind: 'note', title: '冰岛', path: '生活/冰岛.md' } }).prompt
    expect(n).toContain('他在看笔记「冰岛」（生活/冰岛.md）。')
  })

  test('收到的请求查一遍：不认的种类、太长、页码不对、不是网址都不收', () => {
    expect(checkAsk({ kind: 'chat', text: '你好' })).toEqual({ kind: 'chat', text: '你好' })
    expect(() => checkAsk({ kind: 'rm', text: 'x' })).toThrow()
    expect(() => checkAsk({ kind: 'chat', text: '   ' })).toThrow()
    expect(() => checkAsk({ kind: 'chat', text: 'x'.repeat(20_001) })).toThrow()
    expect(() => checkAsk({ kind: 'explain', text: '', source: { kind: 'pdf', title: 'a', path: 'a.pdf', page: 0, pages: 1 } })).toThrow()
    expect(() => checkAsk({ kind: 'explain', text: '', source: { kind: 'web', title: 'a', url: 'file:///etc/passwd' } })).toThrow()
    expect(() => checkAsk({ kind: 'chat', text: 'x', history: [{ role: 'system', text: 'x' }] })).toThrow()
  })

  test('第二块：Pencil 圈的一块带截图（只收 base64，太大不收），问法照读 PDF 框一块；/ 命令的话原样交给 AI，系统提示照电脑版 / 命令', () => {
    const pdf = { kind: 'pdf' as const, title: 'L', path: 'L.pdf', page: 3, pages: 9, pageText: '字' }
    const a = checkAsk({ kind: 'explain', text: '', source: pdf, image: 'iVBORw0KGgo=' })
    expect(a.image).toBe('iVBORw0KGgo=')
    expect(() => checkAsk({ kind: 'explain', text: '', image: 'not base64!' })).toThrow()
    expect(() => checkAsk({ kind: 'explain', text: '', image: 'A'.repeat(6_000_001) })).toThrow()
    const p = buildPrompt(a).prompt
    expect(p).toContain('他在这一页上框了一块，就是附上的图。\n他说：给我讲解一下')
    expect(buildPrompt({ kind: 'explain', text: '', source: pdf }).prompt).toContain('他问的是整页。\n他说：给我讲解一下这一页')
    const cmd = checkAsk({ kind: 'cmd', text: '命令：总结\n文件：a.md\n\n<note>\nx\n</note>', lang: 'en' })
    const b = buildPrompt(cmd)
    expect(b.prompt).toBe(cmd.text)
    expect(b.appendSystem).toBe(false)
    expect(b.system).toContain('默认用英文回答')
    expect(b.system).toContain('笔记内容在用户消息里，只根据这些内容回答')
    expect(() => checkAsk({ kind: 'cmd', text: '  ' })).toThrow()
    expect(checkAsk({ kind: 'cmd', text: 'x'.repeat(100_000) }).text.length).toBe(100_000)
  })
})

describe('二维码', () => {
  test('配对链接放得进去（一百多字是 9、10 版）；画出来是一格一个方块', () => {
    const link = pairLink({ v: 1, id: 'abcdef123456', key: b64u(randomBytes(32)), code: b64u(randomBytes(16)), name: 'Schaefer 的 MacBook Pro', port: 51234, addrs: ['192.168.1.23'] })
    const q = encodeQr(link)
    expect(q.version).toBeGreaterThanOrEqual(8)
    expect(q.version).toBeLessThanOrEqual(10)
    expect(q.size).toBe(q.version * 4 + 17)
    // 左上角定位块：外圈全黑、第二圈全白、中间 3×3 全黑
    const m = q.modules
    for (let i = 0; i < 7; i++) expect([m[0]![i], m[6]![i], m[i]![0], m[i]![6]]).toEqual([true, true, true, true])
    for (let i = 1; i < 6; i++) expect([m[1]![i], m[5]![i]]).toEqual([false, false])
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) expect(m[y]![x]).toBe(true)
    const svg = qrSvgPath(q)
    expect(svg.side).toBe(q.size + 8)
    expect(svg.d.match(/M/g)!.length).toBe(m.flat().filter(Boolean).length)
  })
})

describe('服务真起来：配对、在吗、问一问（假的 AI）', () => {
  let server: MobileServer | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  async function start(opts: { answer?: string[]; delay?: number; onAbort?: () => void } = {}) {
    const keys = newKeyPair()
    const devices: Device[] = []
    let code: { code: Buffer; expires: number } | null = { code: randomBytes(16), expires: Date.now() + 60_000 }
    const asked: MobileAsk[] = []
    server = await startMobileServer({
      identity: () => ({ id: 'mac-test-1', name: '测试 Mac', keys }),
      device: (id) => devices.find((d) => d.id === id),
      addDevice: (d) => devices.push(d),
      seen: () => undefined,
      code: () => code,
      codeUsed: () => (code = null),
      hello: () => ({ engine: 'claude', label: 'Claude Code · Opus 5.5', vault: true, note: '先说结论' }),
      meta: () => ({ engine: 'claude', label: 'Claude Code · Opus 5.5' }),
      async ask(q, onText, signal) {
        asked.push(q)
        for (const part of opts.answer ?? ['你好，', '这是', '回答。']) {
          await new Promise((r) => setTimeout(r, opts.delay ?? 5))
          if (signal.aborted) {
            opts.onAbort?.()
            throw new Error('停下了')
          }
          onText(part)
        }
      },
    })
    const base = `http://127.0.0.1:${server.port}`
    const link = { v: 1, id: 'mac-test-1', key: keys.pub, code: b64u(code!.code), name: '测试 Mac', port: server.port, addrs: [] }
    return { base, link, devices, asked, renew: () => (code = { code: randomBytes(16), expires: Date.now() + 60_000 }), expire: () => (code = { code: code!.code, expires: Date.now() - 1 }) }
  }

  test('扫码配对一次，之后「在吗」和问一问都认；回答一帧一帧来，第一帧是 meta', async () => {
    const s = await start()
    const p = await pairWith(s.link, s.base, '一飞冲天', 'iPad')
    expect(p.mac).toBe('mac-test-1')
    expect(s.devices.map((d) => [d.name, d.kind])).toEqual([['一飞冲天', 'iPad']])
    const h = await hello(p)
    expect(h).toMatchObject({ t: 'hello', mac: '测试 Mac', label: 'Claude Code · Opus 5.5', vault: true, note: '先说结论' })
    const frames = await ask(p, { kind: 'chat', text: '你好' })
    expect(frames.map((f) => f.t)).toEqual(['meta', 'text', 'text', 'text', 'done'])
    expect(frames[0]).toMatchObject({ mac: '测试 Mac', engine: 'claude', label: 'Claude Code · Opus 5.5' })
    expect(frames.filter((f): f is Extract<Frame, { t: 'text' }> => f.t === 'text').map((f) => f.d).join('')).toBe('你好，这是回答。')
    expect(s.asked).toEqual([{ kind: 'chat', text: '你好' }])
  })

  test('配对码用一次就作废；过期的、不对的配不上', async () => {
    const s = await start()
    await pairWith(s.link, s.base)
    await expect(pairWith(s.link, s.base)).rejects.toThrow('403')
    s.renew()
    await expect(pairWith({ ...s.link, code: b64u(randomBytes(16)) }, s.base)).rejects.toThrow('401')
    s.expire()
    await expect(pairWith(s.link, s.base)).rejects.toThrow('403')
  })

  test('没配对过的设备、签名不对、旧时间、用过的 nonce：一律 401，AI 一个字都不答', async () => {
    const s = await start()
    const p = await pairWith(s.link, s.base)
    const stranger: Paired = { ...p, device: 'nobody', secret: randomBytes(32) }
    await expect(ask(stranger, { kind: 'chat', text: '你好' })).rejects.toMatchObject({ status: 401 })
    await expect(ask({ ...p, secret: randomBytes(32) }, { kind: 'chat', text: '你好' })).rejects.toMatchObject({ status: 401 })
    await expect(hello(stranger)).rejects.toMatchObject({ status: 401 })
    await expect(ask(p, { kind: 'chat', text: '你好' }, undefined, { time: Date.now() - 10 * 60_000 })).rejects.toMatchObject({ status: 401 })
    const nonce = b64u(randomBytes(12))
    await ask(p, { kind: 'chat', text: '一次' }, undefined, { nonce })
    await expect(ask(p, { kind: 'chat', text: '两次' }, undefined, { nonce })).rejects.toMatchObject({ status: 401 })
    expect(s.asked.map((q) => q.text)).toEqual(['一次'])
  })

  test('meta 一帧先到（AI 还没开始吐字）；iPad 断开，这一问停下', async () => {
    let aborted = false
    const s = await start({ answer: Array.from({ length: 40 }, () => '字'), delay: 50, onAbort: () => (aborted = true) })
    const p = await pairWith(s.link, s.base)
    const t0 = Date.now()
    const ac = new AbortController()
    let metaAt = 0
    let texts = 0
    await ask(
      p,
      { kind: 'chat', text: '慢慢说' },
      (f, at) => {
        if (f.t === 'meta') metaAt = at - t0
        if (f.t === 'text' && ++texts === 3) ac.abort()
      },
      { signal: ac.signal },
    ).catch(() => undefined)
    expect(metaAt).toBeLessThan(500)
    await new Promise((r) => setTimeout(r, 300))
    expect(aborted).toBe(true)
  })
})

describe('手机交给 Mac 的 AI：读库工具（vault-tools.ts）', () => {
  const rpc = async (url: string, token: string, method: string, params: unknown = {}) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const json = res.status === 200 ? ((await res.json()) as { result?: Record<string, unknown>; error?: { message: string } }) : null
    return { status: res.status, body: json?.result ?? null, error: json?.error ?? null }
  }

  test('只有四样只读工具；list_recent 按修改时间列出库里真的笔记，read_note 读得到正文；答完令牌收回；库没开着照实说', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cn-mobile-tools-'))
    mkdirSync(join(root, '课程'))
    const now = Date.now() / 1000
    const put = (p: string, text: string, age: number) => {
      writeFileSync(join(root, p), text)
      utimesSync(join(root, p), now - age, now - age)
    }
    put('随手记.md', '# 随手记\n\n一段字。\n', 7200)
    put('课程/线性代数.md', '# 线性代数\n\n矩阵乘法。\n', 60)
    const files = [
      { path: '随手记.md', mtimeMs: (now - 7200) * 1000 },
      { path: '课程/线性代数.md', mtimeMs: (now - 60) * 1000 },
    ]
    let open = true
    const vault = { root, list: async () => files, texts: async () => new Map([['随手记.md', '# 随手记\n\n一段字。\n'], ['课程/线性代数.md', '# 线性代数\n\n矩阵乘法。\n']]) } as unknown as Vault
    const tools = vaultTools(() => (open ? vault : null), '0.0.0')
    try {
      const lent = await tools.lend()
      expect(lent.mcp.tools).toEqual([...VAULT_TOOLS])
      const listed = await rpc(lent.mcp.url, lent.mcp.token, 'tools/list')
      expect((listed.body!.tools as { name: string }[]).map((t) => t.name).sort()).toEqual([...VAULT_TOOLS].sort())
      const recent = await rpc(lent.mcp.url, lent.mcp.token, 'tools/call', { name: 'list_recent', arguments: { days: 7 } })
      const notes = (JSON.parse((recent.body!.content as { text: string }[])[0]!.text) as { notes: { title: string }[] }).notes
      expect(notes.map((n) => n.title)).toEqual(['线性代数', '随手记'])
      const read = await rpc(lent.mcp.url, lent.mcp.token, 'tools/call', { name: 'read_note', arguments: { path: '课程/线性代数.md' } })
      expect((recent.body!.isError as boolean | undefined) ?? false).toBe(false)
      expect((read.body!.content as { text: string }[])[0]!.text).toContain('矩阵乘法')
      // 改库的工具不在这条路上
      const write = await rpc(lent.mcp.url, lent.mcp.token, 'tools/call', { name: 'note_write', arguments: { path: '随手记.md', text: 'x' } })
      expect(write.error?.message ?? (write.body?.isError ? 'isError' : '')).toBeTruthy()
      open = false
      const closed = await rpc(lent.mcp.url, lent.mcp.token, 'tools/call', { name: 'list_recent', arguments: {} })
      expect(closed.body!.isError).toBe(true)
      expect((closed.body!.content as { text: string }[])[0]!.text).toMatch(/no vault is open/)
      lent.done()
      expect((await rpc(lent.mcp.url, lent.mcp.token, 'tools/list')).status).toBe(401)
    } finally {
      await tools.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
