/**
 * 出错兜底（task-pyb39「突然白屏」）：React 渲染里一抛错，没有 ErrorBoundary 时整棵树卸掉、窗口只剩红黄绿三个按钮。
 * - WindowGuard 包整个窗口：出错页说「笔记都在磁盘上」，能重新加载、用默认布局打开（清掉上次开着的标签和栏的摆法，库里文件不动）。
 * - PanelGuard 包每一块（中间每个标签、右栏五样、左栏、白板、PDF；编辑器部件另起的根经 root.tsx 的 guardedRoot 也包）：
 *   一块出错只那一块换成小号出错卡「这一块出错了 · 重新加载这一块」，别的照常能用、能存。
 * 接住的错误都报给主进程记进 main.log；测试模式下 window.cnTestCrash(area) 让那一块在渲染时抛错（report.ts）。
 */
import { Codicon } from '@cn/design'
import { Component, Fragment, type ReactNode, useState } from 'react'
import { Boom, clearLayout, reloadWindow, report } from './report'
import './crash.css'

interface Caught {
  error: Error
  componentStack: string
}

export class Catch extends Component<{ area: string; fallback(c: Caught, reset: () => void): ReactNode; children: ReactNode }, { caught: Caught | null }> {
  state: { caught: Caught | null } = { caught: null }

  static getDerivedStateFromError(error: unknown) {
    return { caught: { error: error instanceof Error ? error : new Error(String(error)), componentStack: '' } }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const e = error instanceof Error ? error : new Error(String(error))
    const componentStack = info.componentStack ?? ''
    this.setState({ caught: { error: e, componentStack } })
    report({ kind: 'render', area: this.props.area, message: `${e.name}: ${e.message}`, stack: e.stack, componentStack })
  }

  reset = () => this.setState({ caught: null })

  render() {
    return this.state.caught ? this.props.fallback(this.state.caught, this.reset) : this.props.children
  }
}

/** 拷出去、展开看的那段：哪一块 + 错误 + 堆栈 + 组件（组件只留前 12 层，够认出是哪个） */
function summary(area: string, c: Caught) {
  const stack = c.error.stack && c.error.stack.includes(c.error.message) ? c.error.stack : `${c.error.name}: ${c.error.message}\n${c.error.stack ?? ''}`
  const comps = c.componentStack.trim().split('\n').slice(0, 12).map((l) => l.trim()).join('\n')
  return [`出错的地方：${area}`, stack.trim(), comps ? `组件：\n${comps}` : ''].filter(Boolean).join('\n\n')
}

/** 「看原话 ›」（同 DESIGN「AI 出错」）：点开是等宽的原文，能选能拷 */
function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="crash-detail">
      <div className="crash-detail-row">
        <button className="crash-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '收起原话' : '看原话'}
          <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        {open && (
          <button className="crash-tg" onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
            <Codicon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
      {open && (
        <pre className="crash-raw" data-testid="crash-raw">
          {text}
        </pre>
      )}
    </div>
  )
}

function CrashPage({ caught }: { caught: Caught }) {
  return (
    <div className="crash-page" role="alert" data-testid="crash-page">
      <div className="crash-drag" />
      <div className="crash-box">
        <div className="crash-head">
          <Codicon name="error" size={16} className="crash-ic" />
          <h1>这一块出错了，你的笔记都在磁盘上，没丢</h1>
        </div>
        <p className="crash-sub">先试「重新加载」。还是这样，就「用默认布局打开」：只清掉上次开着的标签和各栏的摆法，库里的文件一个不动。</p>
        <div className="crash-acts">
          <button className="btn btn-sm btn-primary" onClick={reloadWindow}>
            <Codicon name="refresh" size={14} />
            重新加载
          </button>
          <button className="btn btn-sm" onClick={() => (clearLayout(), reloadWindow())}>
            <Codicon name="layout" size={14} />
            用默认布局打开
          </button>
        </div>
        <Detail text={summary('整个窗口', caught)} />
        <p className="crash-log">
          这次的错误记进了日志，
          <button className="crash-link" onClick={() => void window.cnCrash?.revealLogs()}>
            打开日志文件夹
          </button>
        </p>
      </div>
    </div>
  )
}

/** 包整个窗口 */
export function WindowGuard({ children }: { children: ReactNode }) {
  return (
    <Catch area="window" fallback={(c) => <CrashPage caught={c} />}>
      <Boom area="window" />
      {children}
    </Catch>
  )
}

/**
 * 包一块：shape 是出错卡占的位置（pane：中间栏的一个标签；side：左栏；fill：撑满所在的格子，右栏、白板、PDF；
 * inline：编辑器里的小部件、浮层，只一行字加「看原话」，不撑格子）。
 * 「重新加载这一块」把这一块整个重新挂一遍（里面的状态从头来，文件照样从磁盘读）。
 */
export function PanelGuard({ area, label, shape = 'fill', hidden, children }: { area: string; label: string; shape?: 'pane' | 'side' | 'fill' | 'inline'; hidden?: boolean; children: ReactNode }) {
  const [n, setN] = useState(0)
  return (
    <Catch
      area={area}
      fallback={(c, reset) => {
        const card = (
          <div className={shape === 'inline' ? 'crash-card crash-inline' : 'crash-card'} role="alert" data-testid="panel-crash" data-area={area}>
            <div className="crash-card-t">
              <Codicon name="error" size={12} className="crash-ic" />
              <span>这一块出错了</span>
              <span className="crash-dot">·</span>
              <button className="crash-link" onClick={() => (setN((x) => x + 1), reset())}>
                重新加载这一块
              </button>
            </div>
            {shape !== 'inline' && <p className="crash-card-sub">{`${label}没画出来，别的地方照常能用，笔记都在磁盘上。`}</p>}
            <Detail text={summary(label, c)} />
          </div>
        )
        if (shape === 'pane')
          return (
            <section className="pane crash-pane" hidden={hidden}>
              {card}
            </section>
          )
        if (shape === 'side')
          return hidden ? null : (
            <aside className="side crash-side" aria-label={label}>
              {card}
            </aside>
          )
        if (shape === 'inline') return card
        return <div className="crash-fill">{card}</div>
      }}
    >
      <Fragment key={n}>
        <Boom area={area} />
        {children}
      </Fragment>
    </Catch>
  )
}
