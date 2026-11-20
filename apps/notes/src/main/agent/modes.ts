/**
 * 全能模式（2026-11-19 用户要的，默认开，AI 输入框下面一键切换，AI 对话和读 PDF 共用）怎么告诉 AI。
 * 系统提示在一个会话里定死（Claude Code 接着聊时一直用会话第一次的，--system-prompt-snapshot；Gemini、OpenCode 只在会话第一段话前面），
 * 开关随时会换：系统提示里两种都写（MODES_RULE），现在是哪种写在每条消息开头（modeLine）
 */
import type { EngineId } from '../../shared/agent'
import { LABELS } from './engines'

export const MODES_RULE = `两种模式，用户在 AI 输入框下面一键切换；现在是哪种写在每条消息开头的【模式】里，以它为准（和上一条可能不一样）：
- 全能模式开着：和用户在终端里用你这个命令行一样能干：读写这台 Mac 上的任何文件、跑命令、上网搜和读网页、开子 Agent，不用先问。
- 全能模式关着：只能在库里动手，用 canvas 这组工具；库里的文件能读；看不了库外的文件、跑不了命令、不能自己上网搜（要看网页用 web_* 在右栏打开）。
做不了的事直接说做不了、为什么；是因为全能模式关着的（看库外的文件夹、跑命令、上网搜……），请用户在 AI 输入框下面打开「全能模式」再说一次。权限只由这个开关决定：不要建议用户去改 Claude Code、Codex 这些命令行的权限或设置文件，软件不看那些。`

/** 每条消息开头的【模式】：现在开没开全能模式、能做什么 */
export function modeLine(omni: boolean, engine: EngineId, root: string): string {
  return omni
    ? `【模式】全能模式开着：和在终端里用 ${LABELS[engine]} 一样，能读写这台 Mac 上的文件、跑命令、上网、开子 Agent，不用先问；工作目录是库（${root}）。`
    : '【模式】全能模式关着：只在库里动手（canvas 这组工具：新建、改写、改名、挪动、删笔记，建文件夹，白板、文档、右栏网页）；看库外的文件、跑命令、上网搜都做不了，用户要这些就请他在 AI 输入框下面打开「全能模式」，不要建议改命令行的权限设置。'
}
