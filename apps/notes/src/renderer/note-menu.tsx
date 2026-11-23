import { composing } from './ime'
import { titleOf } from '../shared/layout'
import { app } from './ctx/actions'
import { useT } from './i18n'

/** 右键「重命名」后原地改名的输入框：回车或点别处改，esc 不改 */
export function RenameInput(props: { path: string; onDone(): void; onRename(path: string, name: string): void }) {
  const { path } = props
  const t = useT()
  return (
    <input
      className="si-rename"
      aria-label={t('新名字')}
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
        if (composing(e)) return
        if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
        if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = titleOf(path)), e.currentTarget.blur())
      }}
    />
  )
}

/** 文件夹原地改名（左栏课程列表、素材主题、目录树）：库里指向它的链接主进程一起改 */
export function FolderRename(props: { folder: string; onDone(): void }) {
  return <RenameInput path={props.folder} onDone={props.onDone} onRename={(f, name) => void app().renameFolder(f, name)} />
}
