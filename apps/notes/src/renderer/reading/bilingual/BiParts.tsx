/**
 * 网页阅读视图的双语工具条（吸在页面区顶上）：英文 → 中文 · 域名、译文进度、存成双语笔记。照 design/pdf spec 2.4。
 */
import { Codicon } from '@cn/design'

export function BiBar(props: { langs: string; status: string; busy: boolean; saved: string | null; saving: string | null; onSave(): void; onOpenSaved(path: string): void }) {
  return (
    <div className="bibar" role="toolbar" aria-label="双语工具条">
      <span className="tl">{props.langs}</span>
      <span className="sp" />
      <span className="tier num" data-testid="bi-status">
        {props.busy && <Codicon name="loading" size={12} className="spin" />}
        {props.status}
      </span>
      {props.saved ? (
        <button type="button" className="btn btn-sm" onClick={() => props.onOpenSaved(props.saved!)} title={props.saved}>
          <Codicon name="check" size={14} />
          已存成双语笔记
        </button>
      ) : (
        <button type="button" className="btn btn-sm" disabled={!!props.saving} onClick={props.onSave}>
          <Codicon name={props.saving ? 'loading' : 'edit'} size={14} className={props.saving ? 'spin' : undefined} />
          {props.saving ?? '存成双语笔记'}
        </button>
      )}
    </div>
  )
}
