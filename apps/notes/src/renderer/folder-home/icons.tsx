/** 文件夹首页的图标：首页的图标方块、左栏「文件夹」、标签上都用同一个；选了颜色就是那个颜色底的小方块配白图标 */
import { Codicon, type CodiconName } from '@cn/design'
import type { FolderEntry, FWidget } from '../../shared/folder-home'

const BY_KEY: Record<string, CodiconName> = {
  sigma: 'symbol-numeric',
  atom: 'circuit-board',
  'flask-conical': 'beaker',
  'graduation-cap': 'mortar-board',
  'book-open': 'book',
  code: 'code',
  briefcase: 'briefcase',
  'pen-line': 'edit',
  coffee: 'coffee',
  leaf: 'heart',
  music: 'music',
  globe: 'globe',
}
export const folderIcon = (name: string) => BY_KEY[name] ?? 'folder'

/** 每种组件头上的小图标（组件库、抽屉里也用） */
const WIDGET: Record<FWidget, CodiconName> = {
  slides: 'book',
  review: 'layers',
  exam: 'flag',
  notes: 'file-text',
  doubts: 'question',
  viz: 'file-code',
  cal: 'calendar',
  todo: 'checklist',
  links: 'link',
  board: 'layout',
  text: 'list-flat',
  recent: 'history',
  progress: 'graph',
  calendar: 'calendar',
  drafts: 'edit',
  clips: 'book',
  list: 'list-filter',
}
export const widgetIcon = (t: FWidget) => WIDGET[t]

/** 左栏和标签上的小记号：16 方块圆角 4、白图标 11（有颜色时），不然就是那个线条图标 */
export function FolderMark(props: { f: Pick<FolderEntry, 'icon' | 'color'>; size?: number }) {
  const size = props.size ?? 16
  if (props.f.color)
    return (
      <i className="fmark" style={{ background: props.f.color, width: size, height: size }}>
        <Codicon name={folderIcon(props.f.icon)} size={Math.round(size * 0.7)} />
      </i>
    )
  return <Codicon name={folderIcon(props.f.icon)} size={size} />
}
