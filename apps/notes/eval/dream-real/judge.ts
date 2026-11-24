/**
 * 问 AI：两条路和软件里一样。
 * - claude：本机 Claude Code 命令行（-p，不给工具，一次一问），--model / --effort 可换；环境里有 ANTHROPIC_API_KEY 就走 API 额度，没有就走订阅。
 * - codex：本机 Codex 命令行（codex exec，只读、不留会话），-m / reasoning effort 可换，系统提示走 developer_instructions；走登录的订阅。
 * - openai：本机模型的 OpenAI 兼容接口（mlx_lm.server、Ollama、LM Studio 都是这个），给地址和模型名。
 * 每次问的结果按「判法 + 系统提示 + 提示词」的指纹缓存进 out 目录，没改提示词重跑不再花额度。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Engine {
  name: string
  kind: 'claude' | 'codex' | 'openai'
  model: string
  effort?: string
  url?: string
  /** openai：给 chat_template_kwargs（比如 {"enable_thinking": false}） */
  template?: Record<string, unknown>
  /** 同时问几个 */
  parallel: number
}

export interface Answer {
  text: string
  ms: number
  inTokens: number
  outTokens: number
  cacheRead: number
  cacheWrite: number
  /** 折成 API 价（美元）；本机模型是 0 */
  cost: number
  error?: string
  model?: string
}

export function parseEngine(spec: string): Engine {
  // claude:haiku:low 、 claude:sonnet:high 、 openai:<模型名>@http://127.0.0.1:20111 、可加 #nothink
  const [head, flag] = spec.split('#')
  if (head!.startsWith('claude:')) {
    const [, model, effort] = head!.split(':')
    return { name: spec.replace(/[:#@/]/g, '-'), kind: 'claude', model: model!, effort: effort || undefined, parallel: 6 }
  }
  if (head!.startsWith('codex:')) {
    const [, model, effort] = head!.split(':')
    return { name: spec.replace(/[:#@/.]/g, '-'), kind: 'codex', model: model!, effort: effort || undefined, parallel: 4 }
  }
  if (head!.startsWith('openai:')) {
    const [model, url] = head!.slice('openai:'.length).split('@')
    return {
      name: `local-${model!.split('/').pop()}${flag ? `-${flag}` : ''}`,
      kind: 'openai',
      model: model!,
      url: url ?? 'http://127.0.0.1:20111',
      template: flag === 'nothink' ? { enable_thinking: false } : undefined,
      parallel: 1,
    }
  }
  throw new Error(`认不得的判法：${spec}（claude:<模型>:<effort>、codex:<模型>:<effort> 或 openai:<模型>@<地址>）`)
}

function claudeAsk(e: Engine, system: string, prompt: string, cwd: string): Promise<Answer> {
  return new Promise((res) => {
    const t = Date.now()
    const args = ['-p', '--output-format', 'json', '--model', e.model, '--system-prompt', system, '--setting-sources=', '--strict-mcp-config', '--tools', '', '--max-turns', '1', '--no-session-persistence']
    if (e.effort) args.push('--effort', e.effort)
    const c = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => c.kill(), 600_000)
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - t
      try {
        const j = JSON.parse(out)
        const u = j.usage ?? {}
        res({
          text: j.result ?? '',
          ms,
          inTokens: u.input_tokens ?? 0,
          outTokens: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cost: j.total_cost_usd ?? 0,
          error: j.is_error ? String(j.result ?? 'is_error') : undefined,
          model: Object.keys(j.modelUsage ?? {})[0],
        })
      } catch {
        res({ text: '', ms, inTokens: 0, outTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0, error: `claude 退出 ${code}：${err.slice(0, 300)}${out.slice(0, 300)}` })
      }
    })
    c.stdin.end(prompt)
  })
}

/** codex exec --json：最后一条 agent_message 是回答，turn.completed 带用量（Codex 自己的系统提示约 3 万 token 也算在输入里） */
function codexAsk(e: Engine, system: string, prompt: string, cwd: string): Promise<Answer> {
  return new Promise((res) => {
    const t = Date.now()
    const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '-s', 'read-only', '-m', e.model, '-c', `developer_instructions=${JSON.stringify(system)}`]
    if (e.effort) args.push('-c', `model_reasoning_effort="${e.effort}"`)
    args.push('-')
    const c = spawn('codex', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => c.kill(), 600_000)
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => {
      clearTimeout(timer)
      let text = ''
      let usage: Record<string, number> = {}
      for (const line of out.split('\n')) {
        if (!line.trim()) continue
        try {
          const j = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: Record<string, number> }
          if (j.type === 'item.completed' && j.item?.type === 'agent_message') text = j.item.text ?? ''
          if (j.type === 'turn.completed') usage = j.usage ?? {}
        } catch {
          // 不是 JSON 的行（警告）不管
        }
      }
      res({
        text,
        ms: Date.now() - t,
        inTokens: (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0),
        outTokens: usage.output_tokens ?? 0,
        cacheRead: usage.cached_input_tokens ?? 0,
        cacheWrite: 0,
        cost: 0,
        error: text ? undefined : `codex 退出 ${code}：${err.slice(-300)}`,
        model: e.model,
      })
    })
    c.stdin.end(prompt)
  })
}

async function openaiAsk(e: Engine, system: string, prompt: string): Promise<Answer> {
  const t = Date.now()
  try {
    const r = await fetch(`${e.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: e.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 6000,
        ...(e.template ? { chat_template_kwargs: e.template } : {}),
      }),
      signal: AbortSignal.timeout(900_000),
    })
    const j = (await r.json()) as { choices?: { message?: { content?: string; reasoning?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: unknown }
    const text = j.choices?.[0]?.message?.content ?? ''
    return {
      text: text.replace(/<think>[\s\S]*?<\/think>/g, ''),
      ms: Date.now() - t,
      inTokens: j.usage?.prompt_tokens ?? 0,
      outTokens: j.usage?.completion_tokens ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      error: r.ok ? undefined : `HTTP ${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`,
      model: e.model,
    }
  } catch (err) {
    return { text: '', ms: Date.now() - t, inTokens: 0, outTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0, error: String((err as Error).message) }
  }
}

export interface Job<T> {
  key: string
  system: string
  prompt: string
  meta: T
}

/** 按缓存问一批；同一个指纹问过的直接拿回来。失败的不进缓存，下次重跑会再问 */
export async function askAll<T>(e: Engine, jobs: Job<T>[], out: string, log: (s: string) => void): Promise<{ job: Job<T>; ans: Answer; cached: boolean }[]> {
  mkdirSync(join(out, 'cache'), { recursive: true })
  const empty = join(out, 'empty')
  mkdirSync(empty, { recursive: true })
  const file = join(out, 'cache', `${e.name}.jsonl`)
  const cache = new Map<string, Answer>()
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split('\n'))
      if (line.trim()) {
        const x = JSON.parse(line) as { h: string; a: Answer }
        cache.set(x.h, x.a)
      }
  const fp = (j: Job<T>) => createHash('sha1').update(`${e.kind}|${e.model}|${e.effort ?? ''}|${JSON.stringify(e.template ?? {})}|${j.system}|${j.prompt}`).digest('hex')
  const results: { job: Job<T>; ans: Answer; cached: boolean }[] = new Array(jobs.length)
  let next = 0
  let done = 0
  const t0 = Date.now()
  await Promise.all(
    Array.from({ length: e.parallel }, async () => {
      while (next < jobs.length) {
        const i = next++
        const j = jobs[i]!
        const h = fp(j)
        const hit = cache.get(h)
        if (hit) {
          results[i] = { job: j, ans: hit, cached: true }
          continue
        }
        const one = () => (e.kind === 'claude' ? claudeAsk(e, j.system, j.prompt, empty) : e.kind === 'codex' ? codexAsk(e, j.system, j.prompt, empty) : openaiAsk(e, j.system, j.prompt))
        let ans = await one()
        if (ans.error) {
          log(`  ${j.key} 出错，再问一次：${ans.error.slice(0, 160)}`)
          ans = await one()
        }
        if (!ans.error) {
          cache.set(h, ans)
          appendFileSync(file, JSON.stringify({ h, key: j.key, a: ans }) + '\n')
        }
        results[i] = { job: j, ans, cached: false }
        if (++done % 10 === 0) log(`  ${e.name}：问了 ${done} 次，${Math.round((Date.now() - t0) / 1000)} 秒`)
      }
    }),
  )
  return results
}
