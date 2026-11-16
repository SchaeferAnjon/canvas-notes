/** 记好以后中间栏底部那条：「记进了《…》 · 03:42 · 截了这一帧和前后 4 行 · 撤回」，约 6 秒后收起 */
import { Codicon } from '@cn/design'
import { useEffect } from 'react'
import { centerNow, setToast, useSavedToast } from './store'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function VideoToast() {
  const t = useSavedToast()
  useEffect(() => {
    if (!t) return
    const timer = setTimeout(() => setToast(null), t.undone ? 3000 : 6000)
    return () => clearTimeout(timer)
  }, [t?.seq, t?.undone])
  if (!t) return null
  return (
    <div className="vtoast" role="status">
      <Codicon name="check" size={14} className="ok" />
      <span className="truncate">{t.undone ? '撤回了，那一块和截图都拿掉了' : t.text}</span>
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
