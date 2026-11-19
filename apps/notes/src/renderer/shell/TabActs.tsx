import { Codicon, type CodiconName } from '@cn/design'
import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

/**
 * 每一页自己的动作（属性、白板 / 文档、页码、问这一页、更多……）放在标签条右端（spec 第 3 节），
 * 页面里不再有标题行。页面照常渲染自己的按钮，经 portal 挂进标签条右端的 #tab-acts；只有当前标签挂。
 */
export const ActsSlot = createContext<HTMLElement | null>(null)

export function TabActs(props: { active: boolean; children: React.ReactNode }) {
  const el = useContext(ActsSlot)
  return props.active && el ? createPortal(props.children, el) : null
}

/**
 * 标签条右端一句灰字的页面说明（「收件箱 · 今晚梦游时归类、起名」这类）：最宽 220，放不下省略号；
 * 被省略时悬停用软件自己的提示看全句（鼠标移上来那一刻量，挂上 data-tip 给 Tooltips）
 * 中间窄于 640 时整句藏起来（.center.narrow .pnote），把位置让给标签
 */
export function PageNote(props: { children: React.ReactNode; tip?: string; /** 比别的页面说明重要（「原文件写不进去，字在这里」）：--t2 */ strong?: boolean }) {
  return (
    <span
      className={'txt pnote' + (props.strong ? ' t2' : '')}
      data-testid="page-note"
      data-side="below"
      onMouseOver={(e) => {
        const el = e.currentTarget
        if (props.tip) el.dataset.tip = props.tip
        else if (el.scrollWidth > el.clientWidth) el.dataset.tip = el.textContent ?? ''
        else delete el.dataset.tip
      }}
    >
      {props.children}
    </span>
  )
}

/** 标签条右端的一颗图标按钮；B 风格下 label 也写出来（.lb，A 里藏起来） */
export function ActBtn(props: {
  icon: CodiconName
  label: string
  keys?: string
  on?: boolean
  text?: boolean
  disabled?: boolean
  onClick(e: React.MouseEvent<HTMLButtonElement>): void
  className?: string
  'aria-expanded'?: boolean
}) {
  return (
    <button
      className={'ab-act' + (props.text ? ' wt' : '') + (props.on ? ' on' : '') + (props.className ? ' ' + props.className : '')}
      aria-label={props.label}
      aria-pressed={props.on}
      aria-expanded={props['aria-expanded']}
      data-tip={props.label}
      data-key={props.keys}
      data-side="below"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Codicon name={props.icon} size={16} />
      {props.text && <span className="lb">{props.label}</span>}
    </button>
  )
}

/** 笔记标签的改名：双击标签、F2、面包屑最后一节、「更多 › 改名」都走这里；NoteTab 按标签 id 登记自己的改名 */
export const noteRenamers = new Map<string, (name: string) => Promise<void>>()

/** 笔记标签关掉前：标题改过还没跟上就先按标题改名（关标签也算离开标题），回来现在的路径；NoteTab 按标签 id 登记 */
export const noteLeavers = new Map<string, () => Promise<string>>()
