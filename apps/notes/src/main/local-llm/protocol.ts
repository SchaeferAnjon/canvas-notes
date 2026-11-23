/** 主进程和本地模型进程（worker.ts）之间的消息 */

export type ToWorker =
  | { t: 'load'; path: string; thinks: boolean }
  /** json：只许合法 JSON；schema：再按这个 JSON Schema（node-llama-cpp 支持的那一部分）约束字段、枚举、条数 */
  | { t: 'ask'; id: number; system: string; prompt: string; maxTokens: number; json: boolean; schema?: object }
  | { t: 'abort'; id: number }

/** 一问的用时：firstMs 到第一个字（读完提示），tokens 回答的 token 数，promptTokens 提示的 token 数 */
export interface AskStats {
  ms: number
  firstMs: number
  tokens: number
  promptTokens: number
}

export type FromWorker =
  /** steps：起 llama.cpp（含它自己试载预编译）、载模型、建上下文各用了几毫秒 */
  | { t: 'loaded'; ms: number; steps: { llama: number; model: number; context: number }; contextSize: number }
  | { t: 'loadError'; error: string }
  | { t: 'reply'; id: number; ok: true; text: string; stats: AskStats }
  | { t: 'reply'; id: number; ok: false; error: string; aborted: boolean }
