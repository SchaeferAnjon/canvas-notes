/**
 * 对外接口（task-av5t8）：界面、主进程（main/mcp-ext.ts）、小程序（mcp/stdio.ts）都用的名字和形状。
 * preload 暴露成 window.cnMcp，界面 renderer/settings/mcp.tsx。
 */

/** 每家一把钥匙。claude-desktop、other 这一批只「拷贝配置」；pararead、meetcaption 接上时写一份接法给它们读 */
export const MCP_CLIENTS = ['claude-code', 'claude-desktop', 'codex', 'pararead', 'meetcaption', 'other'] as const
export type McpClientId = (typeof MCP_CLIENTS)[number]

/** 给到哪一档：第一批只有只读（写入、动作在下一批） */
export type McpLevel = 'read'

/** 各家的名字（专有名，不翻） */
export const MCP_CLIENT_NAMES: Record<McpClientId, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  codex: 'Codex',
  pararead: 'ParaRead',
  meetcaption: 'MeetCaption',
  other: 'Other',
}

/** 配置里登记的名字（各家的 MCP 设置里叫这个） */
export const MCP_SERVER_NAME = 'canvas-notes'

export const MCP_TOOL_NAMES = ['search_notes', 'read_note', 'list_recent', 'list_tasks', 'list_vaults', 'open_note'] as const
export type McpToolName = (typeof MCP_TOOL_NAMES)[number]

/** 调用记录的一行（userData/mcp-calls/<年-月>.jsonl） */
export interface McpCall {
  at: number
  /** 按钥匙认的哪家；钥匙不对是 null */
  client: McpClientId | null
  tool: string
  /** 参数（长的截短，记录里看得懂就行） */
  args: Record<string, unknown>
  ok: boolean
  /** 回了多少字 */
  chars: number
  /** 回了几条（搜到几篇、几条待办、几节） */
  n?: number
  /** 读的那篇的标题、打开到第几行 */
  title?: string
  line?: number
  /** 没做成的原因（回给 AI 的那句） */
  error?: string
  /** 画布笔记没开着，小程序直接读的文件 */
  offline?: boolean
}

/** 起小程序的那一段（写进各家配置） */
export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpRow {
  id: McpClientId
  /** 有没有钥匙（装上 / 拷过配置 / 接上过） */
  keyed: boolean
  /** 各家配置里登记着、钥匙对得上（Claude Code、Codex、Claude 桌面版看配置文件；ParaRead、MeetCaption 看接法文件） */
  installed: boolean
  /** 这台 Mac 上有没有这家（命令行找得到、App 装着）；other 一直是 true */
  found: boolean
  /** 装着的版本（家族软件） */
  version?: string
  /** 配置文件在哪（界面上说一句写到了哪） */
  configPath?: string
  /** 最近 7 天：上次用、调了几次 */
  lastUsed: number | null
  calls7: number
}

export interface McpView {
  on: boolean
  rows: McpRow[]
  /** 最近 7 天一共几次、几次没成 */
  calls7: number
  failed7: number
}

export interface McpCallsQuery {
  days: number
  client?: McpClientId | null
}

export interface CnMcpApi {
  get(): Promise<McpView>
  setOn(on: boolean): Promise<McpView>
  /** Claude Code、Codex：发一把钥匙写进它的配置；ParaRead、MeetCaption：写接法文件 */
  install(id: McpClientId): Promise<McpView>
  /** 作废钥匙、从配置里拿掉 */
  remove(id: McpClientId): Promise<McpView>
  /** 拷贝配置（没有钥匙先发一把）：回拷进剪贴板的那段 */
  copyConfig(id: McpClientId): Promise<string>
  /** 拷一段字（自动化的深链）；测试模式里只记下来 */
  copyText(text: string): Promise<void>
  /** 再看一下装没装（命令行、App） */
  recheck(): Promise<McpView>
  calls(q: McpCallsQuery): Promise<McpCall[]>
  /** 外面调了一次（软件开着时）：设置页的次数、记录跟着变 */
  onCalled(f: (c: McpCall) => void): () => void
}
