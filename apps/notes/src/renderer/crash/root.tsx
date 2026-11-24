/**
 * React 根出错时记进 main.log，带组件栈（0.5.10 用户那台「Minified React error #185」只记了预加载第几行，查不到是哪个组件）。
 * - rootErrors(area)：createRoot 的 onUncaughtError / onCaughtError / onRecoverableError，错误、堆栈、组件栈都报给主进程。
 *   我们自己的边界（Guard.tsx 的 Catch）接住的已经由它报过（带哪一块），这里不重复记。
 * - guardedRoot(el, area)：编辑器部件、浮层各自另起的根用它：带上面这些，外面再包一层小出错卡
 *   「这一块出错了 · 重新加载这一块」，一块出错不整棵树卸掉、别的地方照常能点。
 */
import { createRoot, type ErrorInfo, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import type { RendererReport } from '../../shared/crash'
import { Catch, PanelGuard } from './Guard'
import { report } from './report'

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

function send(kind: RendererReport['kind'], area: string, error: unknown, componentStack?: string) {
  const e = asError(error)
  // React 自己包的错误（并发渲染失败后同步重来）真正的原因在 cause 里
  const cause = e.cause instanceof Error ? `\n原因：${e.cause.name}: ${e.cause.message}\n${e.cause.stack ?? ''}` : ''
  // 不再 console.error：主进程会把控制台的错误再记一遍，同一个错误记两行
  report({ kind, area, message: `${e.name}: ${e.message}`, stack: `${e.stack ?? ''}${cause}`, componentStack })
}

export function rootErrors(area: string) {
  return {
    onUncaughtError: (error: unknown, info: { componentStack?: string }) => send('uncaught', area, error, info.componentStack),
    onCaughtError: (error: unknown, info: { componentStack?: string; errorBoundary?: unknown }) => {
      if (info.errorBoundary instanceof Catch) return
      send('caught', area, error, info.componentStack)
    },
    onRecoverableError: (error: unknown, info: ErrorInfo) => send('recoverable', area, error, info.componentStack),
  }
}

/** 另起一个 React 根：出错记日志带组件栈，里面画的东西外面包一层出错卡（原话里「出错的地方」写 area） */
export function guardedRoot(el: Element | DocumentFragment, area: string): Root {
  const root = createRoot(el, rootErrors(area))
  return {
    render: (node: ReactNode) =>
      root.render(
        <PanelGuard area={area} label={area} shape="inline">
          {node}
        </PanelGuard>,
      ),
    unmount: () => root.unmount(),
  }
}
