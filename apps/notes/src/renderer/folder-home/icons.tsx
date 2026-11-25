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

/** 每种组件头上的小图标（组件库、抽屉里也用；CN-103 加组件小样里的那一套） */
const WIDGET: Record<FWidget, CodiconName> = {
  courses: 'folder-library',
  slides: 'book',
  review: 'layers',
  exam: 'flag',
  notes: 'note',
  doubts: 'comment',
  feynman: 'mortar-board',
  viz: 'graph',
  cal: 'calendar',
  todo: 'checklist',
  links: 'link',
  board: 'layout',
  text: 'list-flat',
  recent: 'history',
  progress: 'graph-line',
  calendar: 'calendar',
  drafts: 'edit',
  clips: 'quote',
  list: 'filter',
  pararead: 'book',
  meetcaption: 'mic',
  feeds: 'rss',
}
export const widgetIcon = (t: FWidget) => WIDGET[t]
