import { Icon } from '@cn/design'
import { Globe, History, Moon } from 'lucide-react'

type Right = 'web' | 'history' | 'dream'

const ITEMS: { id: Right; label: string; icon: typeof Globe }[] = [
  { id: 'web', label: '网页', icon: Globe },
  { id: 'dream', label: '梦游', icon: Moon },
  { id: 'history', label: '历史', icon: History },
]

/** 窗口最右边的竖条（方向 A）：网页、梦游、历史。点一下开右栏，再点同一个收起，点另一个换页 */
export function Rail(props: { right: Right | null; dreamDot: boolean; onToggle(r: Right): void }) {
  return (
    <nav className="rail" aria-label="右栏">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={'rb' + (props.right === it.id ? ' on' : '')}
          aria-pressed={props.right === it.id}
          title={props.right === it.id ? `收起${it.label}` : `在右栏打开${it.label}`}
          onClick={() => props.onToggle(it.id)}
        >
          <Icon of={it.icon} size={18} />
          {it.label}
          {it.id === 'dream' && props.dreamDot && <i className="dot" data-testid="dream-dot" />}
        </button>
      ))}
    </nav>
  )
}
