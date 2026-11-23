/**
 * iPhone / iPad 的 UI 测试用的「假 Mac」（task-wwqf0）：跑的是真的服务（server.ts）、真的 Bonjour 登记（advertise.ts），
 * 只有 AI 是假的（照着问的话一小段一小段吐固定的字）。不碰 Electron，apps/apple/scripts/fake-mac-ai.mjs 打包了跑。
 * 测试从旁边的控制端口摆布它：
 *   GET  /link          一个新的配对链接（新的配对码）
 *   POST /offline       关掉服务、撤掉 Bonjour（演 Mac 睡着了）    POST /online  再开（同一个端口）
 *   POST /slow?ms=6000  回第一帧前等这么久（演 Mac 在、但两秒没回话） POST /fast  不等
 *   GET  /asked         收到过的问题（JSON）
 * 环境变量：CN_FAKE_MAC_NAME（Bonjour 和配对里的名字）、CN_FAKE_MAC_PORT、CN_FAKE_MAC_CONTROL（控制端口）；起好后打印一行 READY <端口> <控制端口>
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { fakeCmdAnswer } from '../../shared/cmd-run'
import { advertise, type Advert } from './advertise'
import type { MobileAsk } from './prompt'
import { b64u, newKeyPair, pairLink, PROTO_VERSION } from './protocol'
import { type Device, type MobileServer, startMobileServer } from './server'

const name = process.env.CN_FAKE_MAC_NAME || `CN-e2e-${process.pid}`
const id = b64u(randomBytes(9))
const keys = newKeyPair()
const devices: Device[] = []
const asked: MobileAsk[] = []
let code: { code: Buffer; expires: number } | null = null
let delay = 0
let server: MobileServer | null = null
let advert: Advert | null = null
let port = Number(process.env.CN_FAKE_MAC_PORT || 0)

/**
 * 假 AI 的回答：说清是 Mac 上的假 AI、问的是什么，讲解里带页码和选中的字；圈的一块（带图）写「框住的这块（带图 N KB）」；
 * / 命令照电脑版测试用的固定回答（shared/cmd-run.ts 的 fakeCmdAnswer，自测题、补双链、每页讲什么都是能读的 JSON）
 */
function answer(q: MobileAsk): string {
  const where = q.source?.kind === 'pdf' ? `第 ${q.source.page} 页` : ''
  if (q.kind === 'cmd') {
    const cmd = /^命令：(\S+)/.exec(q.text)?.[1] ?? ''
    return fakeCmdAnswer(q.text) ?? (cmd === '总结' ? 'Mac 上的假 AI 总结：第一句。第二句。第三句。' : cmd === '翻译' ? 'Mac 上的假 AI 译文：Grid lines stay straight.' : `Mac 上的假 AI 跑了「${cmd}」。`)
  }
  if (q.kind === 'chat') return `Mac 上的假 AI 回答：${q.text.slice(0, 20)}。\n\n- 第一点\n- 第二点`
  const what = q.image ? `框住的这块（带图 ${Math.round((q.image.length * 3) / 4 / 1024)} KB）` : `「${(q.quote ?? '').slice(0, 24)}」`
  return `Mac 上的假 AI ${q.kind === 'translate' ? '翻译并讲解' : '讲解'}${where}${what}。\n\n这一段说的是：网格线还是直线。`
}

async function up() {
  server = await startMobileServer(
    {
      identity: () => ({ id, name, keys }),
      device: (d) => devices.find((x) => x.id === d),
      addDevice: (d) => devices.push(d),
      seen: () => undefined,
      code: () => code,
      codeUsed: () => (code = null),
      hello: () => ({ engine: 'claude', label: '假 AI · Opus 5.5', vault: true, note: '' }),
      meta: () => ({ engine: 'claude', label: '假 AI · Opus 5.5' }),
      beforeMeta: () => new Promise((r) => setTimeout(r, delay)),
      async ask(q, onText, signal) {
        asked.push(q)
        for (const part of answer(q).match(/.{1,6}/gsu) ?? []) {
          if (signal.aborted) throw new Error('停下了')
          onText(part)
          await new Promise((r) => setTimeout(r, 30))
        }
      },
    },
    port,
  )
  port = server.port
  advert = advertise(name, port, { id, v: String(PROTO_VERSION) })
}

async function down() {
  advert?.stop()
  advert = null
  await server?.close()
  server = null
}

const control = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const ok = (body: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  void (async () => {
    if (url.pathname === '/link') {
      code = { code: randomBytes(16), expires: Date.now() + 10 * 60_000 }
      return ok({ link: pairLink({ v: PROTO_VERSION, id, key: keys.pub, code: b64u(code.code), name, port, addrs: ['127.0.0.1'] }) })
    }
    if (url.pathname === '/offline') return (await down(), ok({ offline: true }))
    if (url.pathname === '/online') return (server || (await up()), ok({ online: true }))
    if (url.pathname === '/slow') return ((delay = Number(url.searchParams.get('ms') ?? 6000)), ok({ delay }))
    if (url.pathname === '/fast') return ((delay = 0), ok({ delay }))
    if (url.pathname === '/asked') return ok(asked)
    res.writeHead(404)
    res.end()
  })()
})

await up()
control.listen(Number(process.env.CN_FAKE_MAC_CONTROL || 0), '127.0.0.1', () => {
  const c = control.address()
  console.log(`READY ${port} ${typeof c === 'object' && c ? c.port : 0} ${name}`)
})
const quit = () => void down().then(() => process.exit(0))
process.on('SIGTERM', quit)
process.on('SIGINT', quit)
