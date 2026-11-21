import { Codicon } from '@cn/design'
import { useKey } from '../keys'
import { toggleTopFold, useWebTop } from './top-fold'

/** 网页那一组的组头右边、把手左边的 ⌃（task-sta8n 方向 A）：网页栏顶上收成一行 / 展开；命令表里「收起 / 展开网页栏顶上」的键同它 */
export function WebFoldButton() {
  const { fold } = useWebTop()
  const key = useKey('web-top-fold')
  const name = fold ? '展开顶上' : '收起顶上'
  return (
    <button className="dbtn wfold" data-testid="web-fold" aria-label={name} aria-pressed={fold} data-tip={name} data-key={key ?? undefined} data-side="below" onClick={toggleTopFold}>
      <Codicon name={fold ? 'chevron-down' : 'chevron-up'} size={14} />
    </button>
  )
}
