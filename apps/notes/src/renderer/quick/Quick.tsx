import { Codicon } from '@cn/design'
import { defaultKeysOf } from '../../shared/cmd-table'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { QuickApi, QuickContext } from '../../shared/quick'
import { applySkin, installThemeCss } from '../skin'

declare global {
  interface Window {
    quick: QuickApi
  }
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** 全局速记小窗：一个输入框，回车进收件箱 */
export function Quick() {
  const [ctx, setCtx] = useState<QuickContext>({ trusted: false, hint: false })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const card = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.quick.onContext((c) => {
        if (c.skin) {
          installThemeCss(c.skin.css ?? '')
          applySkin(c.skin.info)
        }
        setCtx(c)
        setText('')
        setError(null)
        setSaving(false)
        requestAnimationFrame(() => box.current?.focus())
      }),
    [],
  )

  // 输入框跟着字变高，窗口跟着卡片变高
  useLayoutEffect(() => {
    const t = box.current
    if (t) {
      t.style.height = '0px'
      t.style.height = Math.min(220, t.scrollHeight) + 'px'
      t.style.overflowY = t.scrollHeight > 220 ? 'auto' : 'hidden'
    }
    if (card.current) void window.quick.resize(card.current.offsetHeight + 40)
  }, [text, ctx, error])

  async function save() {
    if (saving || (!text.trim() && !ctx.selection?.trim())) return
    setSaving(true)
    try {
      await window.quick.save(text)
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSaving(false)
    }
  }

  return (
    <div className="qk" ref={card} role="dialog" aria-label="速记">
      <div className="qk-k">
        <Codicon name="inbox" size={14} />
        速记 · 回车进收件箱
      </div>
      <textarea
        ref={box}
        className="qk-in"
        aria-label="速记内容"
        placeholder={ctx.selection ? '想说点什么就写在这里，也可以直接回车' : '想到什么，写下来'}
        value={text}
        rows={1}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            void window.quick.close()
          }
        }}
      />
      {ctx.selection && (
        <div className="qk-sel" data-testid="quick-selection">
          <div className="q">{ctx.selection}</div>
          <div className="src">
            <Codicon name="globe" size={12} />
            <span className="truncate">{ctx.url ? `${ctx.title || host(ctx.url)} · ${host(ctx.url)}` : `来自${ctx.app ?? '前台软件'}`}</span>
          </div>
        </div>
      )}
      {!ctx.trusted && ctx.hint && (
        <div className="qk-hint" data-testid="quick-hint">
          <Codicon name="workspace-trusted" size={14} />
          <span>{`允许「辅助功能」后，按 ${ctx.key ?? defaultKeysOf('quick-note')[0]} 时选中的字和来源会一起带上来`}</span>
          <button className="btn btn-sm" onClick={() => void window.quick.allow()}>
            去允许
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void window.quick.noHint()}>
            不用了
          </button>
        </div>
      )}
      {error && (
        <div className="qk-err" role="alert">
          {error}
        </div>
      )}
      <div className="qk-foot">
        <span>
          <kbd>↵</kbd> 存进收件箱
        </span>
        <span>
          <kbd>{defaultKeysOf('newline')[0]}</kbd> 换行
        </span>
        <span>
          <kbd>esc</kbd> 取消
        </span>
      </div>
    </div>
  )
}
