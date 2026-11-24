/**
 * iPhone / iPad 经这台 Mac 问 AI 时给 AI 的读库工具（手机交给 Mac 的 AI）：只读的四样，和对外接口（src/mcp/tools.ts）同一份定义和代码：
 * list_recent 最近改过的、search_notes 按字找、read_note 读整篇或某一节、list_tasks 待办。不改文件、不跑命令。
 *
 * 以前这一路一个工具都不给（claude -p --tools '' --max-turns 1）：问「最近几个文档说什么」，AI 说一句「我先看看」就完了，追问才说读不到库。
 *
 * 自己一个本机 MCP 服务（agent/mcp-server.ts，只听 127.0.0.1、令牌），和右栏 AI 那条分开：右栏的工具要窗口、改得动库，这一路不要。
 * 每一问发一个令牌、答完收回。
 */
import type { McpServer, ToolSpec } from '../agent/mcp-server'
import { startMcpServer } from '../agent/mcp-server'
import { type NoteSource } from '../../mcp/notes'
import { runTool, TOOL_DEFS } from '../../mcp/tools'
import type { Vault } from '../vault'

export const VAULT_TOOLS = ['list_recent', 'search_notes', 'read_note', 'list_tasks'] as const

const SPECS: ToolSpec[] = TOOL_DEFS.filter((t) => (VAULT_TOOLS as readonly string[]).includes(t.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))

const source = (v: Vault): NoteSource => ({
  root: v.root,
  files: async () => (await v.list()).map((f) => ({ path: f.path, mtimeMs: f.mtimeMs })),
  texts: () => v.texts(),
})

export interface VaultTools {
  /** 起好（第一次用时才起）的服务和这一问的令牌；用完 done() 收回 */
  lend(): Promise<{ mcp: { url: string; token: string; tools: string[] }; done(): void }>
  close(): Promise<void>
}

export function vaultTools(vault: () => Vault | null, version: string): VaultTools {
  let server: Promise<McpServer> | null = null
  const ensure = () =>
    (server ??= startMcpServer(
      {
        tools: () => SPECS,
        async call(name, args) {
          if (!(VAULT_TOOLS as readonly string[]).includes(name)) return { text: `No tool named ${name}`, isError: true }
          const v = vault()
          const out = await runTool(name, args, {
            src: v ? source(v) : null,
            appRunning: true,
            vaults: () => [],
            meaning: async () => ({ off: 'meaning search is not available when the question comes from iPhone or iPad' }),
          })
          return { text: out.text, ...(out.isError ? { isError: true } : {}) }
        },
      },
      { name: 'canvas-notes-mobile', version },
    ))
  return {
    async lend() {
      const s = await ensure()
      const token = s.issue()
      return { mcp: { url: s.url, token, tools: [...VAULT_TOOLS] }, done: () => s.revoke(token) }
    },
    async close() {
      const s = server
      server = null
      await (await s)?.close()
    },
  }
}
