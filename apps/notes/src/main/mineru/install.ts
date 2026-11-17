/**
 * 在软件里装 MinerU（PDF 精读增强）：用户在 PDF 工具条下面那行提示里点「安装」才装。四步：
 *   1. 下载 uv（一个可执行文件，管 Python 和包），放在画布笔记的数据目录 mineru/
 *   2. uv 建一个带 Python 3.12 的环境：~/.mineru-venv（和 ParaRead 共用；Python 解释器放 ~/.mineru/python）
 *   3. 装 mineru（带 PyTorch，下载约 1.3 GB；uv 的缓存放数据目录，装完删）
 *   4. 下载识别模型（basic 档，放在 MinerU 默认的 ~/.mineru/models）
 * 中途退出下次接着来（uv、模型下载都能续）；只在哪都找不到 MinerU 时才装，不碰别人装的那份。
 * 来自 ParaRead（同一作者，src/main/mineruInstall.ts），在此以 GPL-3.0-or-later 提供。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { MineruInstallState } from '../../shared/mineru'
import { dirKb, killTree, lastLogLine, venvExe } from './proc'

/** 装哪个版本（找已有的时候认 4.0.12 ≤ v < 5） */
export const INSTALL_VERSION = '4.2.3'
const PYTHON = '3.12'

// 各步在总进度里占的位置
const SPAN: Record<'uv' | 'python' | 'packages' | 'models', [number, number]> = { uv: [0, 3], python: [3, 8], packages: [8, 60], models: [60, 100] }

export interface InstallPaths {
  /** 画布笔记数据目录里的 mineru/：uv、缓存、装到一半的记号 */
  dir: string
  /** 当「~」用的文件夹：venv 装到 ~/.mineru-venv，Python 放 ~/.mineru/python，模型在 ~/.mineru/models */
  home: string
  /** uv 的下载地址（测试指到本机） */
  uvUrl?: string
}

export const venvOf = (home: string) => join(home, '.mineru-venv')
export const commandOf = (home: string) => venvExe(venvOf(home), 'mineru-kit')
/** 上次开始装、没装完：再点「安装」接着来 */
export const installPending = (dir: string) => existsSync(join(dir, 'installing'))

/** 下载不下来时界面上那句（没网、连不上） */
export const NO_NET = '下载不下来：检查网络后点「重试」'

/** 装的时候出的错换成一句人话：网络不通的（uv、模型下载报的英文）都说检查网络；别的照原话 */
export function installError(raw: string): string {
  if (/fetch failed|Failed to fetch|failed to download|dns error|Could not resolve|Connection (refused|reset|timed out)|Network is unreachable|operation timed out|error sending request|tcp connect error/i.test(raw)) return NO_NET
  return raw
}

export class MineruInstaller {
  state: MineruInstallState = { phase: 'none', percent: 0, line: '', error: null }
  private child: ChildProcess | null = null
  private abort: AbortController | null = null
  private running = false
  private stopped = false

  constructor(
    private p: InstallPaths,
    private onState: (s: MineruInstallState) => void,
  ) {}

  private set(patch: Partial<MineruInstallState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  private step(phase: keyof typeof SPAN, frac: number, line?: string): void {
    const [a, b] = SPAN[phase]
    // 进度只往前走（同一步里接着跑下一个命令时 frac 从 0 算起，不让进度条往回跳）
    const pct = Math.max(this.state.percent, Math.round(a + (b - a) * Math.min(1, Math.max(0, frac))))
    this.set({ phase, percent: pct, ...(line === undefined ? {} : { line }) })
  }

  stop(): void {
    this.stopped = true
    this.abort?.abort()
    if (this.child) killTree(this.child)
  }

  /** 装完返回 mineru-kit 的路径；停下了返回 null；出错抛出（状态里也有） */
  async start(): Promise<string | null> {
    if (this.running) return null
    this.running = true
    this.stopped = false
    const { dir, home } = this.p
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'installing'), String(Date.now()))
    this.set({ phase: 'uv', percent: 0, line: '下载安装工具 uv', error: null })
    try {
      const uv = await this.getUv()
      const cache = join(dir, 'cache')
      const env = { ...process.env, HOME: home, UV_CACHE_DIR: cache, UV_PYTHON_INSTALL_DIR: join(home, '.mineru', 'python'), PYTHONUNBUFFERED: '1', MINERU_MODEL_SOURCE: 'local' }
      const venv = venvOf(home)
      this.step('python', 0, '准备 Python 环境')
      if (!existsSync(venvExe(venv, 'python'))) await this.run(uv, ['venv', '--python', PYTHON, venv], env, 'python')
      this.step('packages', 0, '下载MinerU和PyTorch（约1.3 GB）')
      // uv 和模型下载的输出里没有总进度：按下载目录长到多大来算（包先进 uv 的缓存，约 1.3 GB；模型约 850 MB）
      await this.run(uv, ['pip', 'install', '--python', venvExe(venv, 'python'), `mineru==${INSTALL_VERSION}`], env, 'packages', { dir: cache, expectKb: 1_300_000 })
      this.step('models', 0, '下载识别模型（约 850 MB）')
      const cmd = commandOf(home)
      await this.run(cmd, ['models', 'download', '--tier', 'basic'], env, 'models', { dir: join(home, '.mineru', 'models'), expectKb: 850_000 })
      await this.run(cmd, ['models', 'verify', '--tier', 'basic'], env, 'models')
      writeFileSync(join(dir, 'installed.json'), JSON.stringify({ version: INSTALL_VERSION, at: Date.now(), command: cmd }))
      rmSync(join(dir, 'installing'), { force: true })
      rmSync(cache, { recursive: true, force: true })
      this.set({ phase: 'done', percent: 100, line: '', error: null })
      return cmd
    } catch (e) {
      const stopped = this.stopped
      this.set({ phase: stopped ? 'none' : 'failed', error: stopped ? null : installError((e as Error).message), ...(stopped ? { percent: 0, line: '' } : {}) })
      if (stopped) return null
      throw e
    } finally {
      this.running = false
      this.child = null
      this.abort = null
    }
  }

  // uv：官方发布的单个可执行文件（tar.gz 里一层文件夹），用系统自带的 tar 解。已经装了 uv 的也用自己这份，版本一致
  private async getUv(): Promise<string> {
    const bin = join(this.p.dir, 'uv')
    if (existsSync(bin)) return bin
    const name = `uv-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
    const url = this.p.uvUrl ?? `https://github.com/astral-sh/uv/releases/latest/download/${name}.tar.gz`
    this.step('uv', 0, '下载安装工具 uv')
    this.abort = new AbortController()
    const timer = setTimeout(() => this.abort?.abort(), 120_000)
    try {
      const res = await fetch(url, { signal: this.abort.signal, redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`下载 uv 失败：HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      const tgz = join(this.p.dir, 'uv.tar.gz')
      let got = 0
      const body = Readable.fromWeb(res.body as never)
      body.on('data', (b: Buffer) => {
        got += b.length
        if (total) this.step('uv', got / total)
      })
      await pipeline(body, createWriteStream(tgz))
      await this.run('/usr/bin/tar', ['-xzf', tgz, '-C', this.p.dir, '--strip-components', '1', `${name}/uv`], process.env, 'uv')
      rmSync(tgz, { force: true })
    } catch (e) {
      if (this.stopped) throw new Error('已停下')
      // 没网、连不上、两分钟没下完：fetch 只说 fetch failed / This operation was aborted
      if (e instanceof TypeError || (e as Error).name === 'AbortError') throw new Error(NO_NET)
      throw e
    } finally {
      clearTimeout(timer)
    }
    if (!existsSync(bin)) throw new Error('uv 解压后没找到可执行文件')
    return bin
  }

  // 跑一步：输出的最后一行给界面看；进度行里有百分比就用它，否则按下载目录多大算
  private run(cmd: string, args: string[], env: NodeJS.ProcessEnv, phase: keyof typeof SPAN, watch?: { dir: string; expectKb: number }): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('已停下'))
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: this.p.dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      this.child = child
      let tail = ''
      let frac = 0
      const timer = watch
        ? setInterval(() => {
            void dirKb(watch.dir).then((kb) => {
              frac = Math.max(frac, Math.min(0.98, kb / watch.expectKb))
              if (this.child === child) this.step(phase, frac)
            })
          }, Number(process.env.CN_MINERU_WATCH_MS) || 3000)
        : null
      const onData = (b: Buffer): void => {
        tail = (tail + b.toString()).slice(-4000)
        const line = lastLogLine(b.toString()) || lastLogLine(tail)
        const pct = /(\d{1,3})%\|/.exec(line)
        if (pct) frac = Math.max(frac, Number(pct[1]) / 100)
        this.step(phase, frac, line.slice(0, 160))
      }
      child.stdout!.on('data', onData)
      child.stderr!.on('data', onData)
      child.on('error', (e) => {
        if (timer) clearInterval(timer)
        reject(new Error(`${basename(cmd)}：${e.message}`))
      })
      child.on('close', (code, sig) => {
        if (timer) clearInterval(timer)
        if (code === 0) return resolve()
        const last = tail.split(/[\r\n]/).map((x) => x.trim()).filter(Boolean).slice(-3).join(' · ')
        reject(new Error(sig || this.stopped ? '已停下' : `${basename(cmd)} ${args[0]} 退出码 ${code}：${last.slice(0, 300)}`))
      })
    })
  }
}

/** 画布笔记自己装过的版本（没装过是 null） */
export function installedByUs(dir: string): { version: string; command: string } | null {
  const f = join(dir, 'installed.json')
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { version: string; command: string }) : null
}
