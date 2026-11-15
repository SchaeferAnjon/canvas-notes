/** AI 浮窗和主进程之间来回传的东西（引擎、流式事件、对话记录、当前看的是什么） */

import type { CommitInfo } from './api'

export type EngineId = 'claude' | 'codex' | 'gemini' | 'opencode'

export interface EngineInfo {
  id: EngineId
  label: string
  /** 找到的命令行路径；没找到是 null */
  path: string | null
  /** 没找到时说一句怎么装 */
  hint?: string
}

/** AI 这一轮能看到、能动手的地方：当前标签和右栏网页 */
export interface AgentContext {
  tab: {
    type: 'home' | 'inbox' | 'topic' | 'note' | 'none'
    title: string
    path?: string
    /** note 标签现在是白板、文档还是源文件 */
    mode?: 'board' | 'doc' | 'source'
    /** 这篇是白板（frontmatter 里 type: board） */
    board?: boolean
  }
  web: { open: boolean; url: string | null }
  /** 文档里选中的字（截短） */
  selection?: string
  /** @ 点名的笔记 */
  mentions?: string[]
}

export type AiEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; label: string; status: 'run' | 'ok' | 'err'; detail?: string }

export interface ToolStep {
  id: string
  label: string
  status: 'run' | 'ok' | 'err'
  detail?: string
}

export interface TurnRequest {
  /** 界面给的编号，流式事件按它对上 */
  id: number
  engine: EngineId
  text: string
  context: AgentContext
}

export interface TurnResult {
  text: string
  /** 这一轮 AI 改了文件：一次提交 */
  commit: CommitInfo | null
  /** 每个文件是新建还是修改 */
  kinds: Record<string, string>
  /** 中途出错或停下（已经改了的照样提交了） */
  error?: string
}

/** 存在软件设置目录里的一条消息（不进库） */
export interface StoredMsg {
  id: number
  role: 'user' | 'ai'
  text?: string
  engine?: EngineId
  read?: string
  error?: string
  done?: string
  steps?: ToolStep[]
  change?: { commit: CommitInfo; kinds: Record<string, string>; reverted?: CommitInfo }
  moves?: { path: string; topic: string }[]
  /** /找重复 的结果：两篇的路径、相似度（0 到 1）、为什么 */
  dups?: { a: string; b: string; score: number; why: string }[]
  /** /现在梦游 跑完：整理了几条、分几组（消息里有「打开梦游报告」按钮） */
  dream?: { items: number; groups: number }
  draft?: { path: string; words: number; head: string }
}

/** 主进程请界面做的事（只有界面拿得到的东西：编辑器、标签、右栏） */
export type BridgeOp = 'saveAll' | 'context' | 'openWeb' | 'measure' | 'docRead' | 'docInsert' | 'docReplace'
