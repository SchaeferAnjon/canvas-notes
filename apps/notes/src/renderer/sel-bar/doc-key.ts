/**
 * 文档里选着字时按了选中小条上哪颗的键（task-26nz7）：笔记编辑器的键表最先问它（note-keys.ts）。
 * 只认勾了「文档」、放在条上或 ⋯ 里的自己那几颗；键记在命令表里（自己的命令没有默认键）。
 * doc.ts 静态引：动态 import 会让打包多拆一个共用块，它的 CSS 排到 index.css 前面，样式先后翻了（见 note-doc-ref.ts）
 */
import type { EditorView } from '@codemirror/view'
import { comboOf } from '../../shared/cmd-keys'
import { docItems } from '../../shared/sel-bar'
import { localAiCmds, vaultAiCmds } from '../commands/store'
import { cmdConfig } from '../search/cmd-store'
import { runDocCmd } from './doc'

export function docKeyHit(e: KeyboardEvent): string | null {
  if (e.isComposing) return null
  const combo = comboOf(e)
  if (!combo) return null
  const cfg = cmdConfig()
  const mine = [...vaultAiCmds(cfg), ...localAiCmds()].map((c) => ({ id: c.id, name: c.name, where: c.where }))
  return docItems(cfg.bar, mine).find((it) => it.mine && cfg.keys[it.id] === combo)?.id ?? null
}

/** 编辑器里按键：选着字、按的是那几颗的键就跑它（返回 true 拦下这个键） */
export function docBarKey(view: EditorView, e: KeyboardEvent, path: () => string | null): boolean {
  if (view.state.selection.main.empty || view.state.readOnly) return false
  const id = docKeyHit(e)
  const p = path()
  if (!id || !p) return false
  void runDocCmd(view, id, p)
  return true
}
