import { titleOf } from '../shared/layout'

/** 右键「重命名」后原地改名的输入框：回车或点别处改，esc 不改 */
export function RenameInput(props: { path: string; onDone(): void; onRename(path: string, name: string): void }) {
  const { path } = props
  return (
    <input
      className="si-rename"
      aria-label="新名字"
      autoFocus
      defaultValue={titleOf(path)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        props.onDone()
        const v = e.currentTarget.value.trim()
        if (v && v !== titleOf(path)) props.onRename(path, v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
        if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = titleOf(path)), e.currentTarget.blur())
      }}
    />
  )
}
