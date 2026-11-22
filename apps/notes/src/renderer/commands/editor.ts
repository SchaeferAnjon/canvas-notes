/**
 * 打开「存成命令」那张表（commands/SaveCmd.tsx 的 CmdEditorHost 接着）：从对话存（chat）、⌘K 从头写一条（new）、
 * 改自己的（edit）、复制一份自带的再改（copy）。放在这里，AI 对话、⌘K、/ 菜单都能开它，不用互相引用。
 */
import type { EngineId } from '../../shared/agent'
import type { AiCmd, Builtin } from '../../shared/ai-cmds'
import type { DistillCommit } from '../../shared/distill'

interface Base {
  /** 谁来做：「Claude Code · Opus 5.5 · High」（影响卡那一格） */
  who: string
  engine: EngineId
  /** 提炼规矩问 AI 时用的（输入框底行选的） */
  pick: { engine: EngineId; model?: string; effort?: string }
}

export type CmdEditorInit =
  | (Base & {
      kind: 'chat'
      place: { key: string; label: string }
      path: string
      title: string
      /** 这几轮用户说的话 */
      asks: string[]
      commits: DistillCommit[]
      /** 这段对话里 AI 第一次改这一篇的那次提交（改之前就是它前面那一版） */
      firstHash: string
      rounds: number
      /** 举例的那一篇（就是这段对话改的这一篇）和文件夹 */
      example: { title: string; folder: string }
      /** 「再改一次」：已经存过的那一条（名字和设置照它） */
      edit?: AiCmd
    })
  | (Base & { kind: 'new'; example?: { title: string; folder: string } })
  | (Base & { kind: 'edit'; cmd: AiCmd; example?: { title: string; folder: string } })
  | (Base & { kind: 'copy'; builtin: Builtin; example?: { title: string; folder: string } })

const subs = new Set<(i: CmdEditorInit) => void>()

export function openCmdEditor(init: CmdEditorInit) {
  for (const s of subs) s(init)
}

/** CmdEditorHost 挂上时接着 */
export function onCmdEditor(f: (i: CmdEditorInit) => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
