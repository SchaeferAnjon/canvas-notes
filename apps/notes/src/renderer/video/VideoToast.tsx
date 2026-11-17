/** 记好以后中间栏底部那条：「记进了《…》 · 03:42 · 截了这一帧和前后 4 行 · 撤回」，约 6 秒后收起 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { centerNow, setToast, useSavedToast } from './store'
import { toastParts } from './toast-parts'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function VideoToast() {
  const t = useSavedToast()
  useEffect(() => {
    if (!t) return
    const timer = setTimeout(() => setToast(null), t.undone ? 3000 : 6000)
    return () => clearTimeout(timer)
  }, [t?.seq, t?.undone])
  // 按中间栏的宽决定：附带说明藏不藏、要不要换两行
  const el = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const host = el.current?.parentElement
    if (!host) return
    const ro = new ResizeObserver(() => setW(host.clientWidth))
    ro.observe(host)
    setW(host.clientWidth)
    return () => ro.disconnect()
  }, [!!t])
  if (!t) return null
  const parts = t.undone ? null : toastParts(t.text)
  const two = w > 0 && w < 400
  return (
    <div ref={el} className={'vtoast' + (two ? ' two' : '')} role="status" data-w={w}>
      <Codicon name="check" size={14} className="ok" />
      {parts ? (
        <span className="vt-text">
          <span className="vt-verb">{parts.verb}</span>
          <span className="vt-doc" title={parts.doc}>
            《<span className="vt-head">{parts.doc.slice(0, -2)}</span>
            {parts.doc.slice(-2)}》
          </span>
          {parts.rest.map((x, i) => (
            <span key={i} className={i === 0 ? 'vt-time' : 'vt-extra'} hidden={i > 0 && w > 0 && w < 520}>
              {' · '}
              {x}
            </span>
          ))}
        </span>
      ) : (
        <span className="truncate">{t.undone ? '撤回了，那一块和截图都拿掉了' : t.text}</span>
      )}
      {!t.undone && t.hash && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={async () => {
            try {
              await window.cnVideo.undo(t.hash!, t.mark)
              setToast({ ...t, undone: true })
              centerNow()?.refresh()
            } catch (e) {
              centerNow()?.notice(errText(e))
            }
          }}
        >
          <Codicon name="discard" size={13} />
          撤回
        </button>
      )}
    </div>
  )
}
