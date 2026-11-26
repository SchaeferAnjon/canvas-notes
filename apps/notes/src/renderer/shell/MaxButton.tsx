import { Codicon } from '@cn/design'
import { useKey } from '../keys'
import { useT } from '../i18n'
import './max.css'

/** 每一栏标签条最右那颗「占满 / 还原」（shell/max.ts）：中间每一格、右边每一组、浮窗各一颗；提示带 ⌃⌘\（命令表 fold-center，改了跟着变） */
export function MaxButton(p: { on: boolean; name: string; tid: string; className?: string; size?: number; onClick(): void }) {
  const t = useT()
  const key = useKey('fold-center')
  const label = p.on ? t('还原') : t('占满：{name}', { name: p.name })
  return (
    <button
      className={'maxbtn' + (p.className ? ' ' + p.className : '') + (p.on ? ' on' : '')}
      aria-label={label}
      aria-pressed={p.on}
      data-tip={label}
      data-key={key ?? undefined}
      data-side="below-left"
      data-testid={p.tid}
      data-layout-act=""
      onPointerDown={(e) => e.stopPropagation()}
      onClick={p.onClick}
    >
      <Codicon name={p.on ? 'screen-normal' : 'screen-full'} size={p.size ?? 14} />
    </button>
  )
}

/** 占满时顶上一条细提示：「网页 占满 · ⌃⌘\ 或 Esc 回去」，点它也回去 */
export function MaxHint(p: { name: string; onRestore(): void }) {
  const t = useT()
  const key = useKey('fold-center')
  return (
    <button className="max-hint" data-testid="max-hint" data-layout-act="" onClick={p.onRestore}>
      <Codicon name="screen-normal" size={12} />
      <span className="truncate">{key ? t('{name} 占满 · {key} 或 Esc 回去', { name: p.name, key }) : t('{name} 占满 · Esc 回去', { name: p.name })}</span>
    </button>
  )
}
