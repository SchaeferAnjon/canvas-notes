/**
 * 主进程发来的事件（window.cn*.onXxx 的回调）里抛错时记进 main.log，带界面这边的堆栈和是哪个事件。
 * 0.5.10 那台「Minified React error #185」只记了一行「…/out/preload/index.js:725」（ai:event 的回调）：
 * 错误从界面回调抛回预加载，过 contextBridge 时只留下 message，堆栈没了，所以要在界面这边接。
 * 用法：onAiEvent 那种订阅写成 ipcOn(window.cn.onAiEvent, 'cn.onAiEvent')(cb)。报一条再照样抛出去，行为不变。
 */
import { report } from './report'

type Fn = (...a: unknown[]) => unknown

const wrap = (area: string, cb: Fn): Fn =>
  function (this: unknown, ...a) {
    try {
      return cb.apply(this, a)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      report({ kind: 'ipc', area, message: `${e.name}: ${e.message}`, stack: e.stack })
      throw err
    }
  }

export function ipcOn<F>(on: F, area: string): F {
  const f = on as unknown as Fn
  return ((...args: unknown[]) => f(...args.map((x) => (typeof x === 'function' ? wrap(area, x as Fn) : x)))) as unknown as F
}
