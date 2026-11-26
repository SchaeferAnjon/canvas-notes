import { Codicon } from '@cn/design'
import { useLayoutEffect, useRef, useState } from 'react'
import { useDismiss } from '@cn/design/dismiss'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'

/**
 * 底栏提示被截短时点它：上面弹一块看全文（能选中）、能拷贝（拖进只读文件：EACCES 的路径被截掉了，用户 0.5.11）。
 * 底栏是 overflow: hidden，所以挂到 body 上、按提示条的位置摆；esc、点外面关
 */
export function NoticeFull(props: { text: string; anchor: HTMLElement; onClose(): void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const r = props.anchor.getBoundingClientRect()
    const w = Math.min(520, window.innerWidth - 24)
    setPos({ left: Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12)), bottom: window.innerHeight - r.top + 6 })
  }, [props.anchor])
  // 点外面（网页里也算）、Esc、窗口失焦关（公共的 useDismiss）
  useDismiss(true, [ref, props.anchor], () => props.onClose())
  if (!pos) return null
  return createPortal(
    <div ref={ref} className="toast-full" data-testid="toast-full" role="dialog" style={{ left: pos.left, bottom: pos.bottom }}>
      <div className="tf-text" data-testid="toast-full-text">{props.text}</div>
      <div className="tf-acts">
        <button className="btn btn-ghost btn-sm" data-testid="toast-copy" onClick={() => void navigator.clipboard.writeText(props.text).then(() => setCopied(true))}>
          <Codicon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? t('已拷贝') : t('拷贝')}
        </button>
        <button className="btn btn-ghost btn-sm" aria-label={t('关闭')} onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
