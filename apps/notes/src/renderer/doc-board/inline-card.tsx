/**
 * 白板上就地改一张卡（DESIGN.v3 6.6）：双击文字卡、工具板放下的空卡、双击空白处出的空卡，都在卡里用和文档同一套所见即所得改，
 * 打 / 出和文档同一个插入菜单（偏好「白板卡别挂位置行」：空白卡片里也能打 /）。
 * 点别处、Esc、⌘↵ 都存下（Esc、⌘↵ 收起时焦点回到白板）；空卡一个字没写就收起，文件里什么都不多。
 * 关标签、关窗口时先存回去（onDraft 登记）。
 */
import type { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { UnitEditor } from './unit-editor'

/** 空卡的灰字：和文档文末那一行一个说法，看得出能打 / */
export const EMPTY_HINT = '输入 / 插入块，或者直接写'

/** 点在这些地方不算「点别处」：卡自己、插入菜单（挂在 body 上）、数据库的小浮层 */
const INSIDE = '.ed-pop, .base-pop, .base-full'

export function InlineCard(props: {
  text: string
  notePath: string
  /** 收起时：v 是现在的字；null 是空卡一个字没写（不写进文件）。closing：关标签、退出时存回去的（提示说在底栏） */
  onDone(v: string | null, closing?: boolean): void
  onNotice(t: string): void
  /** 登记「把卡里的字存回去」（关标签、退出时叫） */
  onDraft?(flush: (() => void) | null): void
  label?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const value = useRef(props.text)
  const done = useRef(false)
  const live = useRef(props)
  live.current = props
  const finish = (closing = false) => {
    if (done.current) return
    done.current = true
    const v = value.current
    // 一个字没写（空卡、只剩待办的「- [ ] 」）：交回 null
    live.current.onDone(v.trim() === '' || /^[-*]\s\[\s\]$/.test(v.trim()) ? null : v, closing)
  }
  const back = () => box.current?.closest<HTMLElement>('.board')?.focus({ preventScroll: true })
  // 点别处存下（不用失焦算：插入菜单里「AI 写一段」的输入框会把焦点拿走，那不算离开）
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || box.current?.contains(t) || t.closest?.(INSIDE)) return
      finish()
    }
    document.addEventListener('mousedown', down, true)
    live.current.onDraft?.(() => finish(true))
    return () => {
      document.removeEventListener('mousedown', down, true)
      live.current.onDraft?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keys = useRef([
    {
      key: 'Escape',
      run: (v: EditorView) => {
        if (v.composing) return false
        finish()
        back()
        return true
      },
    },
    {
      key: 'Mod-Enter',
      run: (v: EditorView) => {
        if (v.composing) return false
        finish()
        back()
        return true
      },
    },
  ]).current
  return (
    <div
      ref={box}
      className="card-edit"
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // ⌘W 交给软件关标签（关之前先存）；别的键都留在卡里（白板的退格删卡、⌘Z 撤回白板这些不接）
        if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') return
        e.stopPropagation()
      }}
    >
      <UnitEditor text={props.text} notePath={props.notePath} label={props.label ?? '卡片内容'} keys={keys} className="card-ed" placeholder={EMPTY_HINT} onChange={(t) => (value.current = t)} onNotice={props.onNotice} />
    </div>
  )
}
