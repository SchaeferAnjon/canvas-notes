/**
 * 「记账代理」：软件所有的网都走本机一个代理，代理记下要连哪、一律回 502，不连真网站；本机（127.0.0.1、localhost）放行。
 * 再记每个网页的导航。数「用户没让它上网时有没有对外连」用（⌘K、开右栏、开设置……）。
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running } from './app'

/** 代理记到的每个请求的第一行（CONNECT fonts.googleapis.com:443 HTTP/1.1） */
export const proxyLog: string[] = []
let proxyPort = 0
async function accountingProxy(): Promise<number> {
  if (proxyPort) return proxyPort
  const srv = createServer((sock) => {
    sock.once('data', (b) => {
      proxyLog.push(b.toString('latin1').split('\r\n')[0] ?? '')
      sock.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
    sock.on('error', () => undefined)
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  srv.unref()
  proxyPort = (srv.address() as AddressInfo).port
  return proxyPort
}

/** 用户自己的东西（主目录、Chrome、iCloud、书签管家的同步文件夹）都换成临时的，不读真数据 */
export function tempHome(): Record<string, string> {
  const h = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  mkdirSync(join(h, 'chrome'), { recursive: true })
  return {
    HOME: h,
    CN_MINERU_HOME: h,
    CN_CHROME_ROOT: join(h, 'chrome'),
    CN_AIRDROP_DIR: join(h, 'Downloads'),
    CN_ICLOUD_CONTAINER: join(h, 'icloud'),
    CN_BOOKMARKKEEPER_DIR: join(h, 'bk'),
    CN_NOTES_DIR: join(h, 'notes'),
  }
}

/** 用记账代理启动：启动参数让 Chromium 从第一个请求起就全走代理，再给每个会话设一遍；另记每个网页的导航 */
export async function launchCounted(files: Record<string, string | Uint8Array>, env: Record<string, string> = {}, prepare?: (vault: string) => void): Promise<Running> {
  const port = await accountingProxy()
  process.env.CN_E2E_ARGS = `--proxy-server=127.0.0.1:${port} --proxy-bypass-list=<local>;127.0.0.1;localhost`
  const run = await launch(files, { CN_ADBLOCK_LISTS: 'http://127.0.0.1:9/none.txt', ...env }, prepare).finally(() => delete process.env.CN_E2E_ARGS)
  await run.app.evaluate(async ({ app, session, webContents }, port) => {
    const cfg = { proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: '<local>;127.0.0.1;localhost' }
    await session.defaultSession.setProxy(cfg)
    await session.fromPartition('persist:web').setProxy(cfg)
    const g = globalThis as unknown as { navs: string[] }
    g.navs = []
    const hook = (wc: Electron.WebContents) => wc.on('did-start-navigation', (d) => !/^(file|devtools|about|data|blob|chrome-extension|cn-[a-z]+):/.test(d.url) && g.navs.push(d.url))
    for (const wc of webContents.getAllWebContents()) hook(wc)
    app.on('web-contents-created', (_e, wc) => hook(wc))
  }, port)
  return run
}

/** 从 mark 起记到的对外请求和网页导航 */
export async function netSince(run: Running, mark: { proxy: number; nav: number }) {
  const navs = (await run.app.evaluate(() => (globalThis as unknown as { navs: string[] }).navs)) as string[]
  return [...proxyLog.slice(mark.proxy), ...navs.slice(mark.nav)]
}
export async function netMark(run: Running) {
  return { proxy: proxyLog.length, nav: ((await run.app.evaluate(() => (globalThis as unknown as { navs: string[] }).navs)) as string[]).length }
}

/** 打字和按键从主进程一口气送进窗口（真的输入事件，间隔压到 10ms 以内）；Down+40 是隔 40ms 再按 ↓ */
export async function burst(run: Running, word: string, keys: string[]) {
  await run.app.evaluate(
    async ({ BrowserWindow }, [w, ks]) => {
      const wc = BrowserWindow.getAllWindows()[0]!.webContents
      await wc.insertText(w as string)
      for (const k of ks as string[]) {
        const [code, wait] = k.split('+')
        if (wait) await new Promise((r) => setTimeout(r, Number(wait)))
        wc.sendInputEvent({ type: 'keyDown', keyCode: code! })
        if (code === 'Return') wc.sendInputEvent({ type: 'char', keyCode: 'Return' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: code! })
      }
    },
    [word, keys] as const,
  )
}
