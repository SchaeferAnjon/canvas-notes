/**
 * 数据库的名字（白板卡头、文档里的数据库块头、整页打开的块头共用）：双击原地改，回车确认、Esc 取消。
 * 改的是数据源那个文件夹（app().renameFolder），库里写着它的 file.inFolder 跟着换，引用不断。
 */
import { useState } from 'react'
import { useT } from '../i18n'
import { composing } from '../ime'

export function BaseName(props: { name: string; folder: string | null | undefined; onRename?(folder: string, name: string): void; tip?: string }) {
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const { name, folder } = props
  const canRename = !!props.onRename && !!folder
  if (renaming)
    return (
      <input
        className="base-rename"
        aria-label={t('数据库的新名字')}
        autoFocus
        defaultValue={name}
        onFocus={(e) => e.currentTarget.select()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setRenaming(false)
          const v = e.currentTarget.value.trim()
          if (v && v !== name && folder) props.onRename!(folder, v)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
          if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = name), e.currentTarget.blur())
        }}
      />
    )
  return (
    <b
      className="base-name"
      data-tip={canRename ? `${props.tip ? props.tip + ' · ' : ''}${t('双击改名')}` : props.tip}
      onDoubleClick={canRename ? (e) => (e.stopPropagation(), e.preventDefault(), setRenaming(true)) : undefined}
    >
      {name}
    </b>
  )
}
