import type { CnMcpApi } from '../../shared/mcp'

declare global {
  interface Window {
    /** 设置 › 对外接口（main/mcp-ext.ts） */
    cnMcp: CnMcpApi
  }
}
