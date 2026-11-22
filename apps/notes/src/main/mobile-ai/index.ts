/**
 * 让 iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：设置 › AI「iPhone 和 iPad」那一节的开关（默认关），开着时：
 * - 在局域网里开一个小服务（server.ts）、用 Bonjour 报一声（advertise.ts）；
 * - 设置里显示一个二维码（一次性配对码，十分钟作废），iPad 扫一次就配好；
 * - 配好的设备来问，交给 AI 对话用的那一家（Claude Code / Codex……，和右栏 AI 同一处：agent/index.ts 的 engine、chatPick、chatRun），
 *   边答边传回去。这一路只回答、不给工具，不动这台 Mac 上的文件；不需要窗口开着（窗口关了软件还在跑就行）。
 * 主进程在 index.ts 里注册一行：registerMobileAi({ win, vault })。
 */
import { app, type BrowserWindow, ipcMain, safeStorage } from 'electron'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { MobileAiState } from '../../shared/mobile-ai'
import { chatLabel, chatPick, chatRun, engine } from '../agent'
import { AgentStore } from '../agent/store'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { type Advert, advertise } from './advertise'
import { buildPrompt } from './prompt'
import { b64u, CODE_TTL_MS, isLocalAddress, pairLink, PROTO_VERSION } from './protocol'
import { encodeQr, qrSvgPath } from './qr'
import { type MobileServer, startMobileServer } from './server'
import { MobileStore } from './store'

export interface MobileAiDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

const log = (s: string) => console.log(`[手机 AI] ${s}`)

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
      devices: store.devices().map((d) => ({ id: d.id, name: d.name, kind: d.kind, pairedAt: d.pairedAt, lastSeen: d.lastSeen ?? null })),
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
          hello: () => {
            const p = chatPick()
            return { engine: p.engine, label: chatLabel(), vault: !!deps.vault(), note: aiSettings.prompt().trim() }
          },
          meta: () => ({ engine: chatPick().engine, label: chatLabel() }),
          async ask(q, onText, signal) {
            const p = chatPick()
            const built = buildPrompt({ ...q, note: aiSettings.prompt().trim() })
            await engine(p.engine).run({
              prompt: built.prompt,
              system: built.system,
              appendSystem: built.appendSystem,
              cwd: deps.vault()?.root ?? app.getPath('home'),
              signal,
              onText,
              ...chatRun(p.engine, {}),
            })
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
    await s?.close()
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
  ipcMain.handle('mobileAi:unpair', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数不对')
    store.remove(id)
    return view()
  })
  // 上次开着：软件一起来就接着听（配好的设备随时能问；二维码等打开设置再换新的）
  if (store.enabled()) void start()
  app.on('will-quit', () => void stop())
}
