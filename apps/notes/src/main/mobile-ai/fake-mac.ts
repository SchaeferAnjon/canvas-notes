/**
 * iPhone / iPad 的 UI 测试用的「假 Mac」（task-wwqf0）：跑的是真的服务（server.ts）、真的 Bonjour 登记（advertise.ts），
 * 只有 AI 是假的（照着问的话一小段一小段吐固定的字）。不碰 Electron，apps/apple/scripts/fake-mac-ai.mjs 打包了跑。
 * 测试从旁边的控制端口摆布它：
 *   GET  /link          一个新的配对链接（新的配对码）
 *   POST /offline       关掉服务、撤掉 Bonjour（演 Mac 睡着了）    POST /online  再开（同一个端口）
 *   POST /slow?ms=6000  回第一帧前等这么久（演 Mac 在、但两秒没回话） POST /fast  不等
 *   POST /answer-ms?ms=400  每一小段字之间等多久（默认 30；演答得慢，几段对话同时在答）
 *   GET  /asked         收到过的问题（JSON）
 *   GET  /confirms      手机全能模式：手机点过的头（[{ label, ok }]，两分钟没回的记 ok: false、timeout: true）
 *   GET  /undone        撤回过的提交号                            POST /nofull  这台设备当成在 Mac 设置里关了全能模式   POST /full  再打开
 *   POST /omni?on=1     Mac 右栏的全能模式开关（hello 里报给手机，手机不切时跟它；默认关，以前的测试照旧按只读答）
 *   POST /confirm-ms?ms=1500  等手机点头最多等多久（默认 CN_FAKE_CONFIRM_MS 或两分钟）
 * 手机全能模式的假 AI：AI 对话里按全能模式问时，「删掉「甲.md」」先报一步、在手机上等点头（可以：删了、报改了哪些文件；不要：没删），
 * 「在「甲.md」末尾加上「…」」报一步改、改了哪些文件；别的照常答，开头写「（全能模式）」。等点头最多 CN_FAKE_CONFIRM_MS 毫秒（默认两分钟）
 * 环境变量：CN_FAKE_MAC_NAME（Bonjour 和配对里的名字）、CN_FAKE_MAC_PORT、CN_FAKE_MAC_CONTROL（控制端口）；起好后打印一行 READY <端口> <控制端口>
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { fakeCmdAnswer } from '../../shared/cmd-run'
import { advertise, type Advert } from './advertise'
import type { MobileAsk } from './prompt'
import { b64u, newKeyPair, pairLink, PROTO_VERSION } from './protocol'
import { type AskIO, type Device, type MobileServer, startMobileServer } from './server'

const name = process.env.CN_FAKE_MAC_NAME || `CN-e2e-${process.pid}`
const id = b64u(randomBytes(9))
const keys = newKeyPair()
const devices: Device[] = []
const asked: MobileAsk[] = []
let code: { code: Buffer; expires: number } | null = null
let delay = 0
let answerMs = 30
let omni = false
let confirmMs = Number(process.env.CN_FAKE_CONFIRM_MS || 120_000)
let noFull = false
let commits = 0
const confirms: { label: string; ok: boolean }[] = []
const undone: string[] = []
let server: MobileServer | null = null
let advert: Advert | null = null
let port = Number(process.env.CN_FAKE_MAC_PORT || 0)

/**
 * 假 AI 的回答：说清是 Mac 上的假 AI、问的是什么，讲解里带页码和选中的字；圈的一块（带图）写「框住的这块（带图 N KB）」；带了公式截图的末尾写收到几张、哪几块；
 * / 命令照电脑版测试用的固定回答（shared/cmd-run.ts 的 fakeCmdAnswer，自测题、补双链、每页讲什么都是能读的 JSON）
 */
function answer(q: MobileAsk): string {
  // 带了原文公式的截图（读 PDF 的 AI 看得到公式）：回答末尾说收到几张、是哪几块
  const f = q.formulas?.length ? `\n\n收到公式截图 ${q.formulas.length} 张：${q.formulas.map((x) => x.what).join('；')}` : ''
  // 贴了图：说收到几张、这一问看的是第几页（贴截图问定的页）
  const g = q.images?.length ? `\n\n收到贴图 ${q.images.length} 张${q.found ? `（${q.found}${q.found !== 'none' && q.source?.kind === 'pdf' ? ` 第 ${q.source.page} 页` : ''}）` : ''}` : ''
  // @ 点名了文档：说收到哪几篇、带了正文的那几篇
  const m = q.mentions?.length ? `\n\n收到点名：${q.mentions.map((x) => `${x.title}${x.text ? '（带正文）' : ''}`).join('、')}` : ''
  return answerText(q) + m + g + f
}

function answerText(q: MobileAsk): string {
  const where = q.source?.kind === 'pdf' ? `第 ${q.source.page} 页` : ''
  if (q.kind === 'cmd') {
    const cmd = /^命令：(\S+)/.exec(q.text)?.[1] ?? ''
    return fakeCmdAnswer(q.text) ?? (cmd === '总结' ? 'Mac 上的假 AI 总结：第一句。第二句。第三句。' : cmd === '翻译' ? 'Mac 上的假 AI 译文：Grid lines stay straight.' : `Mac 上的假 AI 跑了「${cmd}」。`)
  }
  // 问的是前置知识（话里有「前置」）：照真 AI 那样回答末尾单独一行〔前置知识〕，手机上不该露出来
  if (q.kind === 'chat' && q.text.includes('前置')) return `Mac 上的假 AI 回答：${q.text.slice(0, 20)}。\n\n大 O 只看增长得最快的那一项。\n\n〔前置知识〕`
  if (q.kind === 'chat') return `Mac 上的假 AI 回答：${q.text.slice(0, 20)}。\n\n- 第一点\n- 第二点`
  const what = q.image ? `框住的这块（带图 ${Math.round((q.image.length * 3) / 4 / 1024)} KB）` : `「${(q.quote ?? '').slice(0, 24)}」`
  return `Mac 上的假 AI ${q.kind === 'translate' ? '翻译并讲解' : '讲解'}${where}${what}。\n\n这一段说的是：网格线还是直线。`
}

const sayOut = async (text: string, onText: (d: string) => void, signal: AbortSignal) => {
  for (const part of text.match(/.{1,6}/gsu) ?? []) {
    if (signal.aborted) throw new Error('停下了')
    onText(part)
    await new Promise((r) => setTimeout(r, answerMs))
  }
}

/** 手机全能模式的假 AI（见开头） */
async function fullAnswer(q: MobileAsk, onText: (d: string) => void, signal: AbortSignal, io: AskIO) {
  const [a, b] = [...q.text.matchAll(/「([^」]*)」/g)].map((m) => m[1]!)
  const hash = () => `${'abcdef0123'.repeat(4)}`.slice(0, 36) + String(++commits).padStart(4, '0')
  const title = (p: string) => `《${p.replace(/\.md$/, '').split('/').pop()}》`
  if (/^删掉「/.test(q.text) && a) {
    io.step({ id: 's1', label: `删掉${title(a)}`, status: 'run' })
    const ok = await io.confirm({ id: 's1', label: `等你点头：删掉${title(a)}`, yes: '可以，删除' })
    confirms.push({ label: `删掉${title(a)}`, ok })
    if (!ok) {
      io.step({ id: 's1', label: `删掉${title(a)}`, status: 'err', detail: '没点头' })
      return sayOut(`没删${title(a)}：你没点头。`, onText, signal)
    }
    io.step({ id: 's1', label: `删掉${title(a)}（在废纸篓里能找回）`, status: 'ok' })
    await sayOut(`删好了${title(a)}。`, onText, signal)
    io.changed({ commit: hash(), files: [{ path: a, kind: '删' }] })
    return
  }
  if (/^在「[^」]*」末尾加上「/.test(q.text) && a) {
    io.step({ id: 'e1', label: `改${title(a)}`, status: 'run' })
    await new Promise((r) => setTimeout(r, 200))
    io.step({ id: 'e1', label: `改${title(a)}`, status: 'ok' })
    await sayOut(`在${title(a)}末尾加上了「${b ?? ''}」。`, onText, signal)
    io.changed({ commit: hash(), files: [{ path: a, kind: '改' }] })
    return
  }
  await sayOut(`（全能模式）Mac 上的假 AI 回答：${q.text.slice(0, 20)}。`, onText, signal)
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
      hello: () => ({ engine: 'claude', label: '假 AI · Opus 5.5', vault: true, note: '', omni, full: !noFull }),
      meta: (q) => {
        const want = q.kind === 'chat' && (q.mode ?? (omni ? 'full' : 'read')) === 'full'
        if (!want) return { engine: 'claude', label: '假 AI · Opus 5.5', mode: 'read' }
        return noFull ? { engine: 'claude', label: '假 AI · Opus 5.5', mode: 'read', why: '这台设备在 Mac 的设置 › AI 里关了全能模式，这次只读' } : { engine: 'claude', label: '假 AI · Opus 5.5', mode: 'full' }
      },
      get confirmMs() {
        return confirmMs
      },
      beforeMeta: () => new Promise((r) => setTimeout(r, delay)),
      async undo(_dev, commit) {
        undone.push(commit)
        return `ffff${String(undone.length).padStart(36, '0')}`
      },
      async ask(q, onText, signal, io) {
        asked.push(q)
        if (io.mode === 'full') return fullAnswer(q, onText, signal, io)
        for (const part of answer(q).match(/.{1,6}/gsu) ?? []) {
          if (signal.aborted) throw new Error('停下了')
          onText(part)
          await new Promise((r) => setTimeout(r, answerMs))
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
    if (url.pathname === '/answer-ms') return ((answerMs = Number(url.searchParams.get('ms') ?? 30)), ok({ answerMs }))
    if (url.pathname === '/asked') return ok(asked)
    if (url.pathname === '/confirms') return ok(confirms)
    if (url.pathname === '/undone') return ok(undone)
    if (url.pathname === '/nofull') return ((noFull = true), ok({ noFull }))
    if (url.pathname === '/full') return ((noFull = false), ok({ noFull }))
    if (url.pathname === '/omni') return ((omni = url.searchParams.get('on') !== '0'), ok({ omni }))
    if (url.pathname === '/confirm-ms') return ((confirmMs = Number(url.searchParams.get('ms') ?? 120_000)), ok({ confirmMs }))
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
