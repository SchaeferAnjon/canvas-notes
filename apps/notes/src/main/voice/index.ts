/**
 * 语音输入的主进程这一半（费曼学习第 2 节，task-yvabi）：界面录音、转成 16 kHz PCM 一段段送过来，
 * 这里开 Soniox 实时听写（soniox-rt.ts）转送，收到的字发回界面（voice:event）。
 * 密钥用设置 › 网页 › 视频那一行的「听写（Soniox）密钥」（main/video/stt.ts 的 sonioxKey），不另填。
 * 麦克风权限：第一次用时系统问一次（systemPreferences.askForMediaAccess），拒绝过就告诉界面去系统设置里开。
 * 测试（CN_E2E）：不问系统权限（Chromium 的假麦克风）；CN_SONIOX_RT_URL 换成本机假服务；
 * CN_E2E_MIC=denied 假装系统里没给麦克风权限。
 */
import { type BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell, systemPreferences, type WebContents } from 'electron'
import type { DictEvent, DictStart } from '../../shared/voice-api'
import { E2E } from '../test-mode'
import { sonioxKey } from '../video/stt'
import { SonioxStream } from './soniox-rt'

async function micAllowed(): Promise<boolean> {
  if (E2E) return process.env.CN_E2E_MIC !== 'denied'
  if (process.platform !== 'darwin') return true
  const st = systemPreferences.getMediaAccessStatus('microphone')
  if (st === 'granted') return true
  if (st === 'denied' || st === 'restricted') return false
  return systemPreferences.askForMediaAccess('microphone')
}

export function setupVoice(d: { win(): BrowserWindow | null }) {
  const streams = new Map<number, { s: SonioxStream; wc: WebContents }>()
  let next = 1
  const fromApp = (e: IpcMainInvokeEvent | IpcMainEvent) => e.sender.id === d.win()?.webContents.id
  const appOnly = (e: IpcMainInvokeEvent) => {
    if (!fromApp(e)) throw new Error('只有软件界面能调')
  }
  const watched = new WeakSet<WebContents>()
  const send = (wc: WebContents, ev: DictEvent) => {
    if (!wc.isDestroyed()) wc.send('voice:event', ev)
  }

  ipcMain.handle('voice:start', async (e, opts: unknown): Promise<DictStart> => {
    appOnly(e)
    // 界面给的词：只要字符串，最多 50 个、每个 60 字
    const raw = (opts as { terms?: unknown } | undefined)?.terms
    const terms = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 50).map((x) => x.trim().slice(0, 60)) : []
    const key = sonioxKey()
    if (!key) return { ok: false, code: 'no-key' }
    if (!(await micAllowed())) return { ok: false, code: 'mic-denied' }
    const id = next++
    const wc = e.sender
    const s = new SonioxStream(
      { url: process.env.CN_SONIOX_RT_URL || undefined, key, terms },
      {
        text: (final, interim) => send(wc, { id, kind: 'text', final, interim }),
        error: (code, detail) => {
          streams.delete(id)
          console.warn('[语音输入] 听写停了', code, detail)
          send(wc, { id, kind: 'error', code, detail })
        },
      },
    )
    streams.set(id, { s, wc })
    // 界面关了（关窗口）就断开，不留着连
    if (!watched.has(wc)) {
      watched.add(wc)
      wc.once('destroyed', () => {
        for (const [k, x] of streams) if (x.wc === wc) (x.s.cancel(), streams.delete(k))
      })
    }
    return { ok: true, id }
  })

  ipcMain.on('voice:audio', (e, id: unknown, pcm: unknown) => {
    if (!fromApp(e) || typeof id !== 'number' || !(pcm instanceof ArrayBuffer || pcm instanceof Uint8Array)) return
    streams.get(id)?.s.send(pcm instanceof Uint8Array ? (pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer) : pcm)
  })

  ipcMain.handle('voice:stop', async (e, id: unknown) => {
    appOnly(e)
    const x = typeof id === 'number' ? streams.get(id) : undefined
    if (!x) return
    await x.s.finish()
    if (streams.delete(id as number)) send(x.wc, { id: id as number, kind: 'end' })
  })

  ipcMain.on('voice:cancel', (e, id: unknown) => {
    if (!fromApp(e) || typeof id !== 'number') return
    streams.get(id)?.s.cancel()
    streams.delete(id)
  })

  ipcMain.handle('voice:mic-settings', (e) => {
    appOnly(e)
    return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  })
}
