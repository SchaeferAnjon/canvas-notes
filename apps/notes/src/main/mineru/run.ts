/**
 * 后台跑 MinerU 解析 PDF：`mineru-kit parse <pdf> -o <临时>/middle.json -f middle_json --tier basic -v`。
 * 同一时间只跑一个（模型吃内存），多份排队；子进程 detached 起、自成一组，停的时候整组杀；
 * 超时 60 秒 + 每页 10 秒；只用本机模型（MINERU_MODEL_SOURCE=local），永远不加 --remote（PDF 不出这台电脑）。
 * 来自 ParaRead（同一作者，src/main/mineru.ts 的 MineruQueue），在此以 GPL-3.0-or-later 提供。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { killTree, lastLogLine, parseTqdm } from './proc'

export interface ParseJob {
  /** PDF 的内容指纹（同一份只排一次） */
  key: string
  /** PDF 的绝对路径 */
  pdf: string
  pages: number
  /** 原始结果存到哪（userData/reading/mineru/<指纹>.<版本>.basic.json） */
  out: string
}

export interface RunnerOptions {
  /** mineru-kit 的路径 */
  command(): string
  /** 临时目录放在哪 */
  tmpRoot: string
  /** 子进程的 HOME（MinerU 的模型在 ~/.mineru/models） */
  home: string
  timeoutMs?(pages: number): number
  onProgress(job: ParseJob, p: { status: 'queued' | 'running'; percent: number | null; stage: string }): void
  onDone(job: ParseJob): void
  onFailed(job: ParseJob, error: string): void
}

export const parseTimeout = (pages: number) => 60_000 + 10_000 * Math.max(1, pages)

export function parseArgs(pdf: string, out: string): string[] {
  return ['parse', pdf, '-o', out, '-f', 'middle_json', '--tier', 'basic', '-v']
}

export class MineruRunner {
  private queue: ParseJob[] = []
  private current: { job: ParseJob; child: ChildProcess } | null = null
  private stopped = false

  constructor(private o: RunnerOptions) {}

  enqueue(job: ParseJob): void {
    if (this.stopped || this.current?.job.key === job.key || this.queue.some((j) => j.key === job.key)) return
    this.queue.push(job)
    this.o.onProgress(job, { status: 'queued', percent: null, stage: '' })
    this.pump()
  }

  busy(key: string): boolean {
    return this.current?.job.key === key || this.queue.some((j) => j.key === key)
  }

  /** 退出软件时：不再回调，连 MinerU 起的子进程一起杀 */
  stopAll(): void {
    this.stopped = true
    this.queue = []
    if (this.current) killTree(this.current.child, 'SIGKILL')
  }

  private pump(): void {
    if (this.current || this.stopped) return
    const job = this.queue.shift()
    if (job) this.run(job)
  }

  private run(job: ParseJob): void {
    const cmd = this.o.command()
    mkdirSync(this.o.tmpRoot, { recursive: true })
    const tmp = mkdtempSync(join(this.o.tmpRoot, 'parse-'))
    const out = join(tmp, 'middle.json')
    const child = spawn(cmd, parseArgs(job.pdf, out), {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: this.o.home, PYTHONUNBUFFERED: '1', MINERU_MODEL_SOURCE: 'local' },
      detached: true,
    })
    this.current = { job, child }
    this.o.onProgress(job, { status: 'running', percent: null, stage: '' })
    let tail = ''
    let percent: number | null = null
    let stage = ''
    let timedOut = false
    let settled = false
    const ms = (this.o.timeoutMs ?? parseTimeout)(job.pages)
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child, 'SIGTERM')
      setTimeout(() => killTree(child, 'SIGKILL'), 3000).unref()
    }, ms)
    const onData = (b: Buffer) => {
      const s = b.toString('utf8')
      tail = (tail + s).slice(-4000)
      const p = parseTqdm(s)
      if (p) {
        percent = p.percent
        stage = p.stage
        this.o.onProgress(job, { status: 'running', percent, stage })
      }
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', onData)
    const done = (code: number | null, err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      this.current = null
      if (this.stopped) {
        rmSync(tmp, { recursive: true, force: true })
        return
      }
      let error: string | null = null
      if (err) error = `启动不了：${err.message}`
      else if (timedOut) error = `超时：${Math.round(ms / 1000)} 秒没解析完`
      else if (code !== 0) error = `退出码 ${code}：${lastLogLine(tail) || '没有输出'}`
      else if (!existsSync(out) || statSync(out).size === 0) error = '没写出结果'
      if (!error) {
        mkdirSync(dirname(job.out), { recursive: true })
        copyFileSync(out, job.out)
      }
      rmSync(tmp, { recursive: true, force: true })
      if (error) this.o.onFailed(job, error)
      else this.o.onDone(job)
      this.pump()
    }
    child.on('error', (e) => done(null, e))
    child.on('close', (code) => done(code))
  }
}
