/**
 * 本地模型进程（Electron utilityProcess）：node-llama-cpp 载入 GGUF，用 Metal 跑，一次答一问。
 * 主进程、界面不卡；退出、闲久了主进程直接结束这个进程，内存就还回去。
 * 报错原话交回主进程，由主进程换成人话。
 */
import type { Llama, LlamaContext, LlamaGrammar, LlamaModel } from 'node-llama-cpp'
import type { FromWorker, ToWorker } from './protocol'
// 要赶在 node-llama-cpp 载入以前（见 asar-access.ts）
import './asar-access'

const port = process.parentPort
const post = (m: FromWorker) => port.postMessage(m)

let llama: Llama | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let json: LlamaGrammar | null = null
/** 按 JSON Schema 做的语法，同一个 schema 只做一次 */
const schemas = new Map<string, LlamaGrammar>()
let thinks = false
let loading: Promise<void> | null = null
let loadErr: string | null = null
const running = new Map<number, AbortController>()
/** 一次只答一问（一个上下文、一条序列），后来的排队 */
let queue: Promise<unknown> = Promise.resolve()

async function load(m: Extract<ToWorker, { t: 'load' }>) {
  const t0 = Date.now()
  // node-llama-cpp 只出 ESM：这里用 import() 载入（包原样放在 node_modules 里，不打进 bundle）
  const { getLlama, LlamaLogLevel } = await import('node-llama-cpp')
  // build: 'never'：没有预编译的平台不在用户机器上编译（包里只带 Mac arm64 Metal 那份）
  // getLlama 第一次会起一个子进程试一下预编译能不能载（node-llama-cpp 自己做的），机器忙时这一步最慢
  llama = await getLlama({ gpu: 'auto', build: 'never', logLevel: LlamaLogLevel.error, progressLogs: false })
  const t1 = Date.now()
  model = await llama.loadModel({ modelPath: m.path })
  const t2 = Date.now()
  // 一问是一篇笔记加 5 个候选，8k 够；内存紧时 node-llama-cpp 自己往小里调，最小 2k
  context = await model.createContext({ contextSize: { min: 2048, max: 8192 }, sequences: 1 })
  json = await llama.getGrammarFor('json')
  thinks = m.thinks
  post({ t: 'loaded', ms: Date.now() - t0, steps: { llama: t1 - t0, model: t2 - t1, context: Date.now() - t2 }, contextSize: context.contextSize })
}

async function ask(m: Extract<ToWorker, { t: 'ask' }>, ac: AbortController) {
  const { LlamaChatSession } = await import('node-llama-cpp')
  if (!model || !context) throw new Error('model not loaded')
  let grammar: LlamaGrammar | undefined
  if (m.schema) {
    const key = JSON.stringify(m.schema)
    grammar = schemas.get(key)
    if (!grammar) {
      grammar = await llama!.createGrammarForJsonSchema(m.schema as Parameters<Llama['createGrammarForJsonSchema']>[0])
      schemas.set(key, grammar)
    }
  } else if (m.json) grammar = json!
  const promptTokens = model.tokenize(m.system).length + model.tokenize(m.prompt).length
  if (promptTokens + m.maxTokens > context.contextSize) throw new Error(`too long: ${promptTokens} tokens, context ${context.contextSize}`)
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: m.system, autoDisposeSequence: true })
  const t0 = Date.now()
  let first = 0
  try {
    const text = await session.prompt(m.prompt, {
      grammar,
      maxTokens: m.maxTokens,
      // 0：每次挑最可能的那个字，同样的问回同样的话
      temperature: 0,
      signal: ac.signal,
      // 混合思考的小模型：不想，直接回
      budgets: thinks ? { thoughtTokens: 0 } : undefined,
      onTextChunk: () => {
        if (!first) first = Date.now()
      },
    })
    return { text, stats: { ms: Date.now() - t0, firstMs: (first || Date.now()) - t0, tokens: model.tokenize(text).length, promptTokens } }
  } finally {
    session.dispose()
  }
}

port.on('message', (e) => {
  const m = e.data as ToWorker
  if (m.t === 'load') {
    loadErr = null
    loading = load(m).catch((err) => {
      loadErr = String((err as Error).message ?? err)
      post({ t: 'loadError', error: loadErr })
    })
    return
  }
  if (m.t === 'abort') {
    running.get(m.id)?.abort()
    return
  }
  const ac = new AbortController()
  running.set(m.id, ac)
  queue = queue.then(async () => {
    try {
      await loading
      if (loadErr) throw new Error(loadErr)
      if (ac.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      const r = await ask(m, ac)
      post({ t: 'reply', id: m.id, ok: true, ...r })
    } catch (err) {
      post({ t: 'reply', id: m.id, ok: false, error: String((err as Error).message ?? err), aborted: ac.signal.aborted })
    } finally {
      running.delete(m.id)
    }
  })
})
