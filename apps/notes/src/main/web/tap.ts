/**
 * 读网页自己发出去的几种请求的回答（看视频、微信读书用）：
 * - YouTube 的 timedtext（自己拼地址取常拿到空的，见 design-video spec 7.1）、B 站播放器接口里的字幕列表（要签名）；
 * - 微信读书阅读页「划线」的请求（划完马上去取新的那一段）。
 * 用 webContents.debugger 的 Fetch 域在「响应」那一步停一下，读出内容就放行，网页照常拿到。
 * 只拦这几种地址，别的请求不经过这里。开发者工具开着时挂不上，就当拿不到。
 */
import type { WebContents } from 'electron'

const PATTERNS = ['*/api/timedtext*', '*api.bilibili.com/x/player/wbi/v2*', '*api.bilibili.com/x/player/v2*', '*/web/book/addBookmark*', '*/web/review/add*']

/** CDP 命令最多等这么久（刚建的网页有时不回话） */
const CMD_MS = 4000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} 没回应`)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

export interface Tapped {
  wc: WebContents
  url: string
  /** 请求发出去的内容（POST 的） */
  posted: string
  body: string
}

const listeners = new Set<(t: Tapped) => void>()

/** 拦到一个回答时叫 */
export function onTapped(fn: (t: Tapped) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const taps = new WeakMap<WebContents, Promise<boolean>>()

/** 给这个网页挂上（挂过就不再挂）；挂不上给 false */
export function tap(wc: WebContents): Promise<boolean> {
  const had = taps.get(wc)
  if (had) return had
  const p = (async () => {
    const d = wc.debugger
    try {
      if (!d.isAttached()) d.attach('1.3')
    } catch (e) {
      console.warn('[tap] 挂不上调试接口', (e as Error).message)
      return false
    }
    d.on('detach', () => taps.delete(wc))
    d.on('message', (_e, method, params: { requestId: string; request: { url: string; postData?: string }; responseStatusCode?: number }) => {
      if (method !== 'Fetch.requestPaused') return
      void (async () => {
        try {
          if ((params.responseStatusCode ?? 200) < 400) {
            const r = (await withTimeout(d.sendCommand('Fetch.getResponseBody', { requestId: params.requestId }), CMD_MS, '读回答')) as { body: string; base64Encoded: boolean }
            const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
            const t: Tapped = { wc, url: params.request.url, posted: params.request.postData ?? '', body }
            for (const f of listeners) {
              try {
                f(t)
              } catch (e) {
                console.warn('[tap] 没认出来', (e as Error).message)
              }
            }
          }
        } catch (e) {
          console.warn('[tap] 读不到', (e as Error).message)
        } finally {
          // 一定放行，不然网页卡住
          await d.sendCommand('Fetch.continueRequest', { requestId: params.requestId }).catch(() => undefined)
        }
      })()
    })
    try {
      await withTimeout(d.sendCommand('Fetch.enable', { patterns: PATTERNS.map((urlPattern) => ({ urlPattern, requestStage: 'Response' })) }), CMD_MS, '挂上')
      return true
    } catch (e) {
      console.warn('[tap] 挂不上', (e as Error).message)
      taps.delete(wc)
      try {
        d.detach()
      } catch {
        // 已经掉了
      }
      return false
    }
  })()
  taps.set(wc, p)
  return p
}
