/**
 * 内置插件的主进程入口：把插件表接到 ipc 上。main/index.ts 只调 setupPlugins。
 * 加一个内置插件：在 PLUGINS 里加一行（主进程这半），界面那半加到 renderer/plugins/index.ts。
 */
import { app, type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { askFast } from '../ai'
import { fastEngine } from '../agent'
import type { Vault } from '../vault'
import { isOurWebview, ourWebviews } from '../web'
import { adblockPlugin } from './adblock'
import { bookmarksPlugin } from './bookmarks'
import { fakeCli, realCli } from './translate/cli'
import { type CallContext, type MainPlugin, PluginRegistry } from './host'
import { translatePlugin } from './translate'
import { wereadPlugin } from './weread'
import { atomicWriteSync } from '@cn/atomic'

const PLUGINS: MainPlugin<never>[] = [translatePlugin as MainPlugin<never>, bookmarksPlugin as MainPlugin<never>, wereadPlugin as MainPlugin<never>, adblockPlugin as MainPlugin<never>]

export function setupPlugins(d: { window(): BrowserWindow | null; vault(): Vault | null }) {
  const dir = join(app.getPath('userData'), 'plugins')
  const file = join(dir, 'state.json')
  const sendApp = (channel: string, ...args: unknown[]) => d.window()?.webContents.send(channel, ...args)
  const quits: (() => void)[] = []
  app.on('will-quit', () => quits.forEach((f) => f()))

  const registry = new PluginRegistry(
    {
      dir,
      vault: d.vault,
      ai: askFast,
      aiLabel: () => fastEngine().label,
      // 插件问命令行时的工作目录是插件自己的文件夹，没有库里的 CLAUDE.md 掺进来
      cli: process.env.CN_AI_FAKE === '1' ? fakeCli() : realCli(dir),
      sendApp,
      filesChanged: () => sendApp('files:changed'),
      onQuit: (fn) => quits.push(fn),
    },
    {
      read() {
        try {
          return JSON.parse(readFileSync(file, 'utf8'))
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
          throw e
        }
      },
      write(s) {
        mkdirSync(dir, { recursive: true })
        atomicWriteSync(file, JSON.stringify(s, null, 2))
      },
    },
  )
  for (const p of PLUGINS) registry.add(p)

  /** 谁在调：只认主窗口和我们窗口里的网页 */
  function who(e: IpcMainInvokeEvent): CallContext {
    const win = d.window()
    if (win && e.sender.id === win.webContents.id) return { from: 'app', sender: e.sender }
    if (isOurWebview(e.sender)) return { from: 'page', sender: e.sender }
    throw new Error('不认识的调用方')
  }
  const appOnly = (e: IpcMainInvokeEvent) => {
    if (who(e).from !== 'app') throw new Error('网页里不能改插件')
  }
  /** 开关、设置变了：界面和每个网页都知道一下 */
  function changed() {
    sendApp('plugins:changed', registry.list())
    const state = registry.pageState()
    for (const wc of ourWebviews()) wc.send('plugins:page-state', state)
  }

  ipcMain.handle('plugins:list', (e) => (appOnly(e), registry.list()))
  ipcMain.handle('plugins:page-state', (e) => (who(e), registry.pageState()))
  ipcMain.handle('plugins:enable', (e, id: unknown, on: unknown) => {
    appOnly(e)
    if (typeof id !== 'string' || typeof on !== 'boolean') throw new Error('参数不对')
    const list = registry.setEnabled(id, on)
    changed()
    return list
  })
  ipcMain.handle('plugins:settings', (e, id: unknown, patch: unknown) => {
    appOnly(e)
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('参数不对')
    const list = registry.setSettings(id, patch as Record<string, unknown>)
    changed()
    return list
  })
  ipcMain.handle('plugins:call', (e, id: unknown, method: unknown, args: unknown) => {
    if (typeof id !== 'string' || typeof method !== 'string' || !Array.isArray(args)) throw new Error('参数不对')
    return registry.call(who(e), id, method, args)
  })
}
