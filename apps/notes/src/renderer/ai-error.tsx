import { Codicon } from '@cn/design'
import { useState } from 'react'
import { aiErrorView } from '../shared/ai-errors'

/** 去设置 › AI（App 听这个事件开设置；各处不用一层层传回调） */
export const openAiSettings = () => window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: 'ai' }))

/**
 * AI 没答出来（CN-75）：前面一个红色 error 小图标 + 一行中文说明，下面能点的下一步，
 * 英文原话（带 Request ID 那些）收在「看原话 ›」里，点开才看到，等宽、能拷。
 */
export function AiError(props: { raw: string; engine?: { id?: string; label?: string }; onRetry?(): void; onRephrase?(): void }) {
  const v = aiErrorView(props.raw, props.engine)
  const [open, setOpen] = useState(false)
  const acts = v.acts.filter((a) => (a === 'retry' ? props.onRetry : a === 'rephrase' ? props.onRephrase : true))
  return (
    <div className="aierr" data-testid="ai-error" data-code={v.code}>
      <div className="t">
        <Codicon name="error" size={12} className="ic" />
        <span>{v.title}</span>
      </div>
      {acts.length > 0 && (
        <div className="acts">
          {acts.includes('retry') && (
            <button className="btn btn-xs" onClick={props.onRetry}>
              <Codicon name="refresh" size={12} />
              再问一次
            </button>
          )}
          {acts.includes('rephrase') && (
            <button className="btn btn-xs" onClick={props.onRephrase}>
              <Codicon name="edit" size={12} />
              换个问法
            </button>
          )}
          {acts.includes('settings') && (
            <button className="btn btn-xs" onClick={openAiSettings}>
              <Codicon name="settings-gear" size={12} />
              去设置 › AI
            </button>
          )}
        </div>
      )}
      {v.raw && (
        <>
          <button className="raw-tg" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? '收起原话' : '看原话'}
            <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
          {open && <pre className="raw">{v.raw}</pre>}
        </>
      )}
    </div>
  )
}
