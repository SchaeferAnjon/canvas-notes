/** 文件夹首页 .首页.json 里老的图标名（sigma、atom…）对到 Codicons；现在的图标和颜色在 .canvas-notes/左栏.json（files/look.tsx） */
import type { CodiconName } from '@cn/design'
import type { FWidget } from '../../shared/folder-home'

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
