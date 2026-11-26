/**
 * 让 iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：设置 › AI「iPhone 和 iPad」那一节的开关（默认关），开着时：
 * - 在局域网里开一个小服务（server.ts）、用 Bonjour 报一声（advertise.ts）；
 * - 设置里显示一个二维码（一次性配对码，十分钟作废），iPad 扫一次就配好；
 * - 配好的设备来问，交给 AI 对话用的那一家（Claude Code / Codex……，和右栏 AI 同一处：agent/index.ts 的 engine、chatPick、chatRun），
 *   边答边传回去。AI 对话、选一段问时给读库的四样只读工具（vault-tools.ts：最近改过的、搜、读一篇、待办；Codex 的进程和右栏共用、
 *   MCP 是进程级的，不给），不改文件、不跑命令；不需要窗口开着（窗口关了软件还在跑就行）。
 * - 手机全能模式（2026-11-24）：AI 对话这一问按全能模式答时（手机头上切的，不切跟右栏的全能模式开关），走右栏 AI 同一套
 *   （agent/index.ts 的 runPhoneTurn：读写文件、跑命令、上网、我们的工具，这一轮改的提交一次，手机上能撤回）；
 *   要点头的那几下（danger.ts）在手机上问。只给配对过的、在局域网或本机地址的、设置里没关掉全能模式的设备，引擎是本机命令行（四家）时。
 * 主进程在 index.ts 里注册一行：registerMobileAi({ win, vault })。
 */
import { app, type BrowserWindow, ipcMain, Notification, safeStorage } from 'electron'
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { MobileAiState, MobileAiWant } from '../../shared/mobile-ai'
import { logLine } from '../crash-log'
import { t } from '../../shared/i18n'
import * as git from '@cn/git'
import { chatLabel, chatPick, chatRun, engine, omniOn, runPhoneTurn } from '../agent'
import { AgentStore } from '../agent/store'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { type Advert, advertise } from './advertise'
import { askMode, fullNo, YES } from './danger'
import { buildPrompt, formulasLine, foundLine, historyText, imagesLine, mentionsLine, where } from './prompt'
import { b64u, CODE_TTL_MS, isLocalAddress, pairLink, PROTO_VERSION } from './protocol'
import { LABELS } from '@cn/ai-engines'
import { isCli } from '@cn/ai-engines/shared'
import { encodeQr, qrSvgPath } from './qr'
import { type MobileServer, startMobileServer } from './server'
import { MobileStore } from './store'
import { vaultTools } from './vault-tools'

export interface MobileAiDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

/** 记进 main.log（每次来问按哪种答、为什么只读），也打到控制台 */
const log = (s: string) => {
  console.log(`[手机 AI] ${s}`)
  logLine('phone-ai', s)
}

/** 手机请 Mac 打开全能模式：两分钟没人点当没问 */
const WANT_MS = 2 * 60_000

/** 「系统设置 › 通用 › 关于本机」里的名字（「Schaefer 的 MacBook Pro」）；测试用 CN_MAC_NAME 定死 */
function computerName(): string {
  if (process.env.CN_MAC_NAME) return process.env.CN_MAC_NAME
  try {
    return execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim() || hostname()
  } catch {
    return hostname().replace(/\.local$/, '')
  }
}

/** 这台 Mac 现在的局域网地址（IPv4，最多三个）：写进二维码，Bonjour 找不到时 iPad 直接连 */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isLocalAddress(a.address)) out.push(a.address)
  return out.slice(0, 3)
}

export function registerMobileAi(deps: MobileAiDeps) {
  const store = new MobileStore(
    E2E ? null : join(app.getPath('userData'), 'mobile-ai', 'state.json'),
    E2E
      ? null
      : {
          encrypt: (s) => {
            if (!safeStorage.isEncryptionAvailable()) throw new Error('这台 Mac 的钥匙串现在用不了，配对的钥匙没存')
            return safeStorage.encryptString(s)
          },
          decrypt: (b) => safeStorage.decryptString(b),
        },
  )
  /** 设置 › AI「给AI的长期说明」：Mac 这一路每一问都带上（和右栏 AI 一样），也告诉 iPad，云端那一路照样带 */
  const aiSettings = new AgentStore(join(app.getPath('userData'), 'ai'))
  const macName = computerName()
  // 测试实例默认不在局域网里报（CN_MOBILE_AI_BONJOUR=1 才报），免得测试的服务出现在别的设备上
  const bonjour = !E2E || process.env.CN_MOBILE_AI_BONJOUR === '1'
  let server: MobileServer | null = null
  let advert: Advert | null = null
  let code: { code: Buffer; expires: number } | null = null
  let error: string | null = null
  const tools = vaultTools(deps.vault, app.getVersion())
  /** 手机全能模式这几台设备改出来的提交（撤回只认它们；软件重开过就不认了，到 Mac 上撤回） */
  const phoneCommits = new Map<string, Set<string>>()
  /** 正在等手机点头的那几步（Mac 右栏显示） */
  let waiting: { device: string; kind: string; label: string }[] = []
  /** 手机请这台 Mac 打开全能模式、还没人点的（Mac 窗口底下一句「iPad「…」想打开全能模式 · 不要 · 允许」） */
  let wants: (MobileAiWant & { timer: NodeJS.Timeout })[] = []
  const wantsView = (): MobileAiWant[] => wants.map(({ timer: _t, ...w }) => w)
  const pushWants = () => deps.win()?.webContents.send('mobileAi:wants', wantsView())
  const dropWant = (id: string) => {
    const w = wants.find((x) => x.id === id)
    if (!w) return
    clearTimeout(w.timer)
    wants = wants.filter((x) => x.id !== id)
    pushWants()
  }

  const view = (): MobileAiState => {
    const me = store.identity()
    const pair =
      store.enabled() && server && code
        ? (() => {
            const link = pairLink({ v: PROTO_VERSION, id: me.id, key: me.keys.pub, code: b64u(code.code), name: macName, port: server.port, addrs: lanAddresses() })
            return { link, qr: qrSvgPath(encodeQr(link)), expires: code.expires }
          })()
        : null
    return {
      on: store.enabled(),
      error,
      macName,
      pair,
      devices: store.devices().map((d) => ({ id: d.id, name: d.name, kind: d.kind, pairedAt: d.pairedAt, lastSeen: d.lastSeen ?? null, full: !d.noFull })),
      port: server?.port ?? null,
    }
  }
  const push = () => deps.win()?.webContents.send('mobileAi:changed', view())
  const newCode = () => {
    code = { code: randomBytes(16), expires: Date.now() + CODE_TTL_MS }
  }

  async function start() {
    if (server) return
    try {
      server = await startMobileServer(
        {
          identity: () => ({ ...store.identity(), name: macName }),
          device: (id) => store.device(id),
          addDevice: (d) => {
            store.add(d)
            push()
          },
          seen: (id, at) => {
            const first = !store.device(id)?.lastSeen
            store.seen(id, at)
            if (first) push()
          },
          code: () => code,
          codeUsed: () => {
            code = null
          },
          hello: (dev, addr) => {
            const p = chatPick()
            const no = fullNo({ addr, ...(dev.noFull ? { noFull: true } : {}), vault: !!deps.vault(), engine: p.engine })
            return { engine: p.engine, label: chatLabel(), vault: !!deps.vault(), note: aiSettings.prompt().trim(), omni: omniOn(), full: !dev.noFull, no }
          },
          wantFull: (dev, why) => {
            const p = chatPick()
            const still = why === 'device' ? !!dev.noFull : !isCli(p.engine)
            if (!still) return 'already'
            dropWant(dev.id)
            const w: MobileAiWant = { id: dev.id, device: dev.name, kind: dev.kind, why, engine: LABELS[p.engine], at: Date.now() }
            wants = [...wants, { ...w, timer: setTimeout(() => dropWant(dev.id), WANT_MS) }]
            pushWants()
            const who = dev.name === dev.kind ? dev.kind : `${dev.kind}「${dev.name}」`
            // 窗口不在前面时系统通知也说一声（点了把窗口叫到前面，底下那一句里点「允许」）；测试实例只记下来，不弹
            const win = deps.win()
            const title = t('{device}想打开全能模式', { device: who })
            const body = why === 'device' ? t('在画布笔记里点「允许」才开') : t('AI 对话现在用的是 {engine}，全能模式要这台 Mac 上的命令行', { engine: LABELS[p.engine] })
            if (E2E) (globalThis as unknown as { cnScreen?: string[] }).cnScreen?.push(`系统通知：${title}：${body}`)
            else if (!win?.isFocused() && Notification.isSupported()) {
              const n = new Notification({ title, body })
              n.on('click', () => {
                const w2 = deps.win()
                if (w2) {
                  if (w2.isMinimized()) w2.restore()
                  w2.show()
                  w2.focus()
                }
              })
              n.show()
            }
            return 'asked'
          },
          meta: (q, dev, addr) => {
            const p = chatPick()
            const m = askMode({ kind: q.kind, ...(q.mode ? { mode: q.mode } : {}), omni: omniOn(), addr, deviceKind: dev.kind, ...(dev.noFull ? { noFull: true } : {}), vault: !!deps.vault(), engine: p.engine, engineLabel: LABELS[p.engine] })
            return { engine: p.engine, label: chatLabel(), ...m }
          },
          async undo(dev, commit) {
            const v = deps.vault()
            if (!v) throw new Error('Mac 上没开库')
            const mine = phoneCommits.get(dev.id)
            if (!mine?.has(commit)) throw new Error('这一次不是这台设备在这次开着的画布笔记里改的：到 Mac 上撤回')
            const head = await git.revert(v.root, commit)
            mine.delete(commit)
            deps.win()?.webContents.send('files:changed')
            return head
          },
          waiting: (list) => {
            waiting = list
            deps.win()?.webContents.send('mobileAi:waiting', waiting)
          },
          async ask(q, onText, signal, io) {
            // 圈的那一块截图、贴进来的图、原文公式那几块的截图（按这个先后，话里说的第几张照它）：各存成这一问自己的临时文件（Codex 要文件路径），答完删掉
            const images = [...(q.image ? [q.image] : []), ...(q.images ?? []), ...(q.formulas ?? []).map((f) => f.image)].map((data) => {
              const path = join(app.getPath('temp'), `cn-mobile-ai-${randomBytes(6).toString('hex')}.png`)
              writeFileSync(path, Buffer.from(data, 'base64'), { mode: 0o600 })
              return { mime: 'image/png' as const, data, path }
            })
            if (io.mode === 'full') {
              const r = await runPhoneTurn({
                text: q.text,
                history: historyText(q.history),
                where: [foundLine(q) ?? where(q.source), mentionsLine(q), imagesLine(q), formulasLine(q)].filter(Boolean).join('\n'),
                device: q.device ?? io.device.kind,
                signal,
                onText,
                onStep: io.step,
                confirm: (st) => io.confirm({ id: st.id, label: st.label, ...(st.code ? { code: st.code } : {}), yes: YES[st.kind] }),
                ...(images.length ? { images } : {}),
              }).finally(() => {
                for (const i of images) rmSync(i.path, { force: true })
              })
              const files = Object.entries(r.kinds).map(([path, kind]) => ({ path, kind }))
              if (r.commit) {
                const set = phoneCommits.get(io.device.id) ?? new Set<string>()
                set.add(r.commit.hash)
                phoneCommits.set(io.device.id, set)
              }
              if (files.length) io.changed({ commit: r.commit?.hash ?? null, files, ...(r.failed ? { failed: r.failed.failed } : {}) })
              if (r.error && !signal.aborted) throw new Error(r.error)
              return
            }
            const p = chatPick()
            // 读库工具：AI 对话、选一段问，库开着，引擎不是 Codex（它的 app-server 和右栏共用一个进程，MCP 换了要重起进程，会断右栏正在答的）
            const lent = (q.kind === 'chat' || q.kind === 'ask') && deps.vault() && p.engine !== 'codex' ? await tools.lend() : null
            const built = buildPrompt({ ...q, note: aiSettings.prompt().trim() }, { vault: !!lent })
            try {
              await engine(p.engine).run({
                prompt: built.prompt,
                system: built.system,
                appendSystem: built.appendSystem,
                cwd: deps.vault()?.root ?? app.getPath('home'),
                signal,
                onText,
                ...chatRun(p.engine, {}),
                ...(lent ? { mcp: lent.mcp } : {}),
                ...(images.length ? { images } : {}),
              })
            } finally {
              lent?.done()
              for (const i of images) rmSync(i.path, { force: true })
            }
          },
          log,
        },
        store.lastPort() ?? 0,
      )
      store.setPort(server.port)
      if (bonjour) advert = advertise(macName, server.port, { id: store.identity().id, v: String(PROTO_VERSION) })
      error = null
      log(`在 ${server.port} 端口听着${bonjour ? '，Bonjour 报了' : ''}`)
    } catch (e) {
      error = `开不起来：${String((e as Error).message ?? e)}`
      server = null
    }
  }

  async function stop() {
    advert?.stop()
    advert = null
    code = null
    const s = server
    server = null
    await Promise.all([s?.close(), tools.close()])
  }

  ipcMain.handle('mobileAi:state', () => view())
  ipcMain.handle('mobileAi:set', async (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('参数不对')
    store.setEnabled(on)
    if (on) {
      await start()
      newCode()
    } else await stop()
    return view()
  })
  ipcMain.handle('mobileAi:code', () => {
    if (store.enabled() && server) newCode()
    return view()
  })
  ipcMain.handle('mobileAi:full', (_e, id: unknown, on: unknown) => {
    if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('参数不对')
    store.setFull(id, on)
    // 在设置里直接打开了：那一句不用再问
    if (on && wants.some((w) => w.id === id && w.why === 'device')) dropWant(id)
    return view()
  })
  ipcMain.handle('mobileAi:wants', () => wantsView())
  /** 「iPad 想打开全能模式」那一句点了「允许」/「不要」：允许就打开这台的开关（AI 对话选的不是命令行那一种只是收起，换哪家在设置里换） */
  ipcMain.handle('mobileAi:grant', (_e, id: unknown, ok: unknown) => {
    if (typeof id !== 'string' || typeof ok !== 'boolean') throw new Error('参数不对')
    const w = wants.find((x) => x.id === id)
    dropWant(id)
    if (ok && w?.why === 'device') store.setFull(id, true)
    log(`${w ? (w.device === w.kind ? w.kind : `${w.kind}「${w.device}」`) : id}想打开全能模式：Mac 上点了${ok ? '允许' : '不要'}`)
    push()
    return view()
  })
  ipcMain.handle('mobileAi:waiting', () => waiting)
  ipcMain.handle('mobileAi:unpair', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数不对')
    store.remove(id)
    dropWant(id)
    return view()
  })
  // 上次开着：软件一起来就接着听（配好的设备随时能问；二维码等打开设置再换新的）
  if (store.enabled()) void start()
  app.on('will-quit', () => void stop())
}
