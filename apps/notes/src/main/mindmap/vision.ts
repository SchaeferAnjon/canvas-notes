/**
 * 让 Claude Code 看一张照片：claude -p --input-format stream-json，用户消息里放一张 base64 的图和一段话。
 * 不给任何工具、答一次、不留会话记录（参数和 / 命令的一次性问答一样，见 @cn/ai-engines 的 engines.ts 里的 claudeArgs）。
 */
import { spawn } from 'node:child_process'
import { CLAUDE_MODEL, claudeArgs, cliEnv } from '@cn/ai-engines'

export interface VisionRun {
  exe: string
  /** 测试时给假的 claude（node 脚本）用 */
  prefix?: string[]
  cwd: string
  system: string
  prompt: string
  image: { mime: string; base64: string }
  model?: string
  /** 想多久（Claude Code 的 --effort）；不给是命令行自己的默认 */
  effort?: string
  signal: AbortSignal
  timeoutMs?: number
  /** 边答边给字（视频框一块问的问框里就地长出来） */
  onText?(delta: string): void
}

/** 认导图默认用的模型：手写字要看得准，用浮窗同一个（CN_MAP_MODEL 能换） */
export const MAP_MODEL = process.env.CN_MAP_MODEL || CLAUDE_MODEL

export function visionMessage(prompt: string, image: VisionRun['image']): string {
  return (
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
          { type: 'text', text: prompt },
        ],
      },
    }) + '\n'
  )
}

const aborted = () => Object.assign(new Error('停下了'), { name: 'AbortError' })

export function askWithImage(r: VisionRun): Promise<string> {
  if (r.signal.aborted) return Promise.reject(aborted())
  const args = [...(r.prefix ?? []), ...claudeArgs({ system: r.system, model: r.model ?? MAP_MODEL, ...(r.effort ? { effort: r.effort } : {}) }), '--input-format', 'stream-json']
  return new Promise((resolve, reject) => {
    const child = spawn(r.exe, args, { cwd: r.cwd, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let stderr = ''
    let result: string | null = null
    let error: string | null = null
    let settled = false
    let timedOut = false
    const stop = () => child.kill('SIGTERM')
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, r.timeoutMs ?? 180_000)
    r.signal.addEventListener('abort', stop)
    const finish = (f: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      r.signal.removeEventListener('abort', stop)
      f()
    }
    const onLine = (line: string) => {
      if (!line.trim()) return
      let m: { type?: string; subtype?: string; is_error?: boolean; result?: string; event?: { type?: string; delta?: { type?: string; text?: string } } }
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      const d = m.type === 'stream_event' ? m.event?.delta : undefined
      if (m.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text) r.onText?.(d.text)
      if (m.type !== 'result') return
      if (m.subtype === 'success' && !m.is_error) result = m.result ?? ''
      else error = (m.subtype === 'success' ? m.result : m.subtype) || '不知道为什么'
    }
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
    child.on('error', (e) => finish(() => reject(new Error(`claude 启动不了：${e.message}`))))
    child.on('close', (code) =>
      finish(() => {
        onLine(buf)
        if (r.signal.aborted) return reject(aborted())
        if (timedOut) return reject(new Error('AI 认了三分钟还没认完，停下了。照片太大或网络慢，再试一次'))
        const why = stderr.trim().split('\n').slice(-3).join(' ')
        if (error) return reject(new Error(`Claude Code 没认完：${error}${why ? `（${why}）` : ''}`))
        if (result === null) return reject(new Error(code ? `Claude Code 退出了（${code}）${why ? `：${why}` : ''}` : 'Claude Code 没有回答。确认这台 Mac 上的 Claude Code 已经登录（终端里运行 claude）。'))
        resolve(result)
      }),
    )
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(visionMessage(r.prompt, r.image))
  })
}
