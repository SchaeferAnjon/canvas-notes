/**
 * PDF 精读增强（MinerU）的主进程这一半：找已有的一份、按用户的意思装一份、后台解析打开的 PDF、存结果。
 * - 找：第一次用到时找一次（find.ts 的顺序），找到能用的直接用、不提示；结果记在内存里，设置里改路径、装完后再找。
 * - 解析：界面打开 PDF、pdf.js 的块出来以后调 enhance；MinerU 的原样结果存 userData/reading/mineru/<指纹>.<版本>.basic.json，
 *   换成块存 userData/reading/text/<指纹>.m1.json（和 pdf.js 的 b2 并排，读的时候有 m1 用 m1），然后告诉界面换。
 * - 失败（找不到、版本不对、缺模型、退出码非 0、超时、JSON 坏）一律照常用 pdf.js 的块，界面工具条一行小字「增强识别没成功 · 重试」。
 * 测试：CN_E2E=1 时不碰本机的 MinerU，除非 CN_MINERU_HOME 指一个当「~」用的文件夹（里面放假的 mineru-kit）；
 * CN_MINERU_UV_URL 指本机的假 uv 下载；CN_MINERU_TIMEOUT_MS 换解析超时。
 */
import { app, type BrowserWindow, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { convertMiddle } from './convert'
import type { MineruFind, MineruInstallState, MineruJob, MineruStatus } from '../../shared/mineru'
import { mineruRawPath, mineruTextPath, pdfHash, type PdfTextCache, textCachePath } from '../pdf-text-cache'
import type { SettingsFile } from '../settings'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { findMineru, realFindEnv } from './find'
import { installPending, MineruInstaller } from './install'
import { MineruRunner, parseTimeout } from './run'

export interface MineruDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
  settings: SettingsFile
}

/** 当「~」用的文件夹：测试实例只认 CN_MINERU_HOME（没给就整个关掉，不碰本机真的 MinerU） */
export function mineruHome(): string | null {
  if (process.env.CN_MINERU_HOME) return process.env.CN_MINERU_HOME
  return E2E ? null : homedir()
}

const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p + '.tmp', JSON.stringify(v))
  renameSync(p + '.tmp', p)
}

export function setupMineru(deps: MineruDeps) {
  const userData = app.getPath('userData')
  const home = mineruHome()
  const dataDir = join(userData, 'mineru')
  const send = (ch: string, ...a: unknown[]) => deps.win()?.webContents.send(ch, ...a)

  let finding: Promise<MineruFind> | null = null
  let found: MineruFind | null = null
  let install: MineruInstallState = { phase: 'none', percent: 0, line: '', error: null }
  let installer: MineruInstaller | null = null
  const jobs = new Map<string, MineruJob>()

  const status = (): MineruStatus => ({ find: found, dismissed: deps.settings.read().mineruHint === false, install })
  const pushStatus = () => send('mineru:status', status())

  function find(fresh = false): Promise<MineruFind> {
    if (!home) return Promise.resolve((found = { state: 'off' }))
    if (finding && !fresh) return finding
    found = null
    const p = findMineru(realFindEnv({ home, own: deps.settings.read().mineruPath ?? null, shell: !process.env.CN_MINERU_HOME })).then((f) => {
      // 自己上次装到一半：哪怕 ~/.mineru-venv 里已经有了一半，也当没装，让用户接着装
      const r: MineruFind = f.state !== 'ready' && installPending(dataDir) ? { state: 'missing', resume: true } : f
      if (finding === p) {
        found = r
        pushStatus()
      }
      return r
    })
    finding = p
    return p
  }

  const pushJob = (j: MineruJob) => {
    jobs.set(j.hash, j)
    send('mineru:job', j)
  }

  const runner = new MineruRunner({
    command: () => (found?.state === 'ready' ? found.path : ''),
    tmpRoot: join(userData, 'mineru', 'tmp'),
    home: home ?? homedir(),
    timeoutMs: (pages) => Number(process.env.CN_MINERU_TIMEOUT_MS) || parseTimeout(pages),
    onProgress: (job, p) => pushJob({ pdf: jobs.get(job.key)?.pdf ?? '', hash: job.key, status: p.status, percent: p.percent, stage: p.stage }),
    onDone: (job) => {
      const pdf = jobs.get(job.key)?.pdf ?? ''
      try {
        convert(job.key, pdf, job.out, job.pages)
        pushJob({ pdf, hash: job.key, status: 'done', percent: 100, stage: '' })
      } catch (e) {
        pushJob({ pdf, hash: job.key, status: 'failed', percent: null, stage: '', error: `结果读不了：${(e as Error).message}` })
      }
    },
    onFailed: (job, error) => pushJob({ pdf: jobs.get(job.key)?.pdf ?? '', hash: job.key, status: 'failed', percent: null, stage: '', error }),
  })

  /** 原样结果换成块，存 m1 */
  function convert(hash: string, pdf: string, raw: string, pages: number) {
    const b2 = textCachePath(userData, hash)
    const sizes = existsSync(b2) ? (JSON.parse(readFileSync(b2, 'utf8')) as PdfTextCache).sizes : undefined
    const version = found?.state === 'ready' ? found.version : ''
    writeJson(mineruTextPath(userData, hash), convertMiddle(readFileSync(raw, 'utf8'), { pdf, pages, ...(sizes ? { sizes } : {}), version }))
  }

  ipcMain.handle('mineru:status', () => {
    void find()
    return status()
  })
  ipcMain.handle('mineru:refind', async () => {
    await find(true)
    return status()
  })
  ipcMain.handle('mineru:setPath', async (_e, path: unknown) => {
    if (path !== null && typeof path !== 'string') throw new Error('路径不对')
    const p = typeof path === 'string' ? path.trim() : ''
    deps.settings.patch({ mineruPath: p || undefined })
    await find(true)
    return status()
  })
  ipcMain.handle('mineru:dismiss', (_e, on: unknown) => {
    deps.settings.patch({ mineruHint: on === false ? undefined : false })
    pushStatus()
  })

  ipcMain.handle('mineru:install', async () => {
    if (!home) throw new Error('测试实例没有指定 CN_MINERU_HOME')
    const f = await find()
    // 只在哪都找不到（或自己上次没装完）时装：找到了别人装的那份，不升级、不改它
    if (f.state !== 'missing') throw new Error(f.state === 'ready' ? '已经有能用的 MinerU 了' : f.state === 'bad' ? `${f.reason}，不替它重装` : '现在不能装')
    if (installer) return
    installer = new MineruInstaller({ dir: dataDir, home, ...(process.env.CN_MINERU_UV_URL ? { uvUrl: process.env.CN_MINERU_UV_URL } : {}) }, (s) => {
      install = s
      pushStatus()
    })
    try {
      const cmd = await installer.start()
      if (cmd) {
        await find(true)
        // 装好了：开着的 PDF 接着用它识别（界面收到后对每个开着的 PDF 调 enhance）
        send('mineru:installed')
      }
    } catch (e) {
      console.error('装 MinerU 没成', e)
    } finally {
      installer = null
      pushStatus()
    }
  })
  ipcMain.handle('mineru:install:stop', () => installer?.stop())

  ipcMain.handle('mineru:enhance', async (_e, pdf: unknown, pages: unknown, fresh: unknown): Promise<MineruJob | null> => {
    const v = deps.vault()
    if (!v) throw new Error('还没有打开库')
    if (typeof pdf !== 'string' || !/\.pdf$/i.test(pdf)) throw new Error('不是 PDF')
    const n = Math.max(1, Math.min(5000, Math.floor(Number(pages) || 1)))
    const abs = v.abs(pdf)
    const hash = pdfHash(new Uint8Array(await readFile(abs)))
    const f = await find(fresh === true)
    if (fresh !== true) {
      const cur = jobs.get(hash)
      if (cur && cur.status !== 'failed') return cur
      if (existsSync(mineruTextPath(userData, hash))) return { pdf, hash, status: 'done', percent: 100, stage: '' }
    }
    if (f.state === 'bad') {
      const j: MineruJob = { pdf, hash, status: 'failed', percent: null, stage: '', error: f.reason }
      jobs.set(hash, j)
      return j
    }
    if (f.state !== 'ready') return null
    const raw = mineruRawPath(userData, hash, f.version)
    jobs.set(hash, { pdf, hash, status: 'queued', percent: null, stage: '' })
    // 这个版本解析过（只是映射换了）：不重跑
    if (fresh !== true && existsSync(raw)) {
      try {
        convert(hash, pdf, raw, n)
        const j: MineruJob = { pdf, hash, status: 'done', percent: 100, stage: '' }
        jobs.set(hash, j)
        return j
      } catch {
        // 原样结果坏了：重跑
      }
    }
    runner.enqueue({ key: hash, pdf: abs, pages: n, out: raw })
    return jobs.get(hash)!
  })

  // 退出：连 MinerU、uv 起的子进程一起杀
  app.on('will-quit', () => {
    runner.stopAll()
    installer?.stop()
  })
}
