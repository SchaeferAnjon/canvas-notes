import type { NoteDoc } from './note-doc'

/**
 * 不引 note-doc 也拿得到 NoteDoc（block-select「移到别的笔记」用）：note-doc 载入时把自己放进来。
 * 静态引 note-doc 会绕一圈引回 block-select（note-doc → doc-editing → block-select），单元测试也会拖进整个编辑器；
 * 动态 import('./note-doc') 又让打包多拆出几个共用块，它们的 CSS 排在 index.css 前面，app.css 里同样具体的规则先后翻了（800164af 起）
 */
export const noteDocRef: { cls: typeof NoteDoc | null } = { cls: null }
