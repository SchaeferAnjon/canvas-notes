import type { EditorView } from '@codemirror/view'

/**
 * 不引 mindmap/place 也拿得到「拍导图插进这一篇」（/ 菜单用）：place.ts 载入时把自己放进来（软件里 App 静态引它，一开就有）。
 * 静态引会把 note-doc 拖进只读 / 菜单那张表的单元测试；动态 import('./mindmap/place') 让打包多拆出一个共用块（note-doc），
 * 它的 CSS 排在 index.css 前面（e2e/css-order.spec.ts），同 note-doc-ref.ts 的办法
 */
export const placeRef: { captureIntoView: ((view: EditorView) => boolean) | null } = { captureIntoView: null }
