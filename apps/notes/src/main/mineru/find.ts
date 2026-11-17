/**
 * 找一份已经装好的 MinerU（mineru-kit）：找到能用的直接用、不提示；只读，不升级、不改别人装的那份。
 * 顺序：① 画布笔记设置里填的路径 ② ParaRead 设置里的 mineruPath ③ ~/.mineru-venv ④ ParaRead 自己装的那份
 * ⑤ 登录 shell 的 PATH（`command -v mineru-kit`）。每个候选要过两关：`--version` 在 4.0.12 ≤ v < 5，`models verify --tier basic` 通过。
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MineruFind } from '../../shared/mineru'

export interface FindEnv {
  /** 当「~」用的文件夹（测试里指到临时目录） */
  home: string
  /** 画布笔记设置里填的路径 */
  own?: string | null
  /** 第 ⑤ 步问登录 shell（测试里关掉） */
  shell: boolean
  /** 跑一个命令：退出码和输出（stdout + stderr）；超时算失败 */
  run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; timedOut?: boolean }>
  exists(p: string): boolean
  readText(p: string): string | null
}

/** 本机要的最低版本（4.0.12 实测过 middle_json 2.0 的格式），5 以后格式可能变 */
export const MIN_VERSION = '4.0.12'
export const BELOW_VERSION = '5'

/** 「MinerU version: 4.0.12」→ 4.0.12 */
export function parseVersion(out: string): string | null {
  const m = /MinerU[^\d\n]*(\d+\.\d+(?:\.\d+)?)/i.exec(out) ?? /(\d+\.\d+\.\d+)/.exec(out)
  return m ? m[1]! : null
}

const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** 4.0.12 ≤ v < 5 */
export const versionOk = (v: string) => cmp(v, MIN_VERSION) >= 0 && cmp(v, BELOW_VERSION) < 0

/** 第 ① 到 ④ 个候选（不管在不在） */
export function candidates(env: Pick<FindEnv, 'home' | 'own' | 'readText'>): { path: string; from: string }[] {
  const out: { path: string; from: string }[] = []
  if (env.own) out.push({ path: env.own, from: '设置里填的路径' })
  const pr = join(env.home, 'Library', 'Application Support', 'ParaRead')
  const raw = env.readText(join(pr, 'settings.json'))
  if (raw) {
    try {
      const p = (JSON.parse(raw) as { mineruPath?: unknown }).mineruPath
      if (typeof p === 'string' && p.trim()) out.push({ path: p.trim().replace(/^~(?=\/)/, env.home), from: 'ParaRead 设置里的路径' })
    } catch {
      // ParaRead 的设置文件坏了不影响找别处
    }
  }
  out.push({ path: join(env.home, '.mineru-venv', 'bin', 'mineru-kit'), from: '~/.mineru-venv' })
  out.push({ path: join(pr, 'mineru', 'venv', 'bin', 'mineru-kit'), from: 'ParaRead 装的那份' })
  // 同一个文件只试一次
  return out.filter((c, i) => out.findIndex((d) => d.path === c.path) === i)
}

/** 一个候选能不能用：能用给版本，不能用给原因 */
export async function check(env: FindEnv, path: string): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  const v = await env.run(path, ['--version'], 30_000)
  const version = parseVersion(v.out)
  if (v.code !== 0 || !version) return { ok: false, reason: `跑不起来（${v.timedOut ? '30 秒没反应' : v.code === null ? '启动不了' : v.code === 0 ? '没说版本' : `退出码 ${v.code}`}）` }
  if (!versionOk(version)) return { ok: false, reason: `版本是 ${version}，要 ${MIN_VERSION} 以上、${BELOW_VERSION} 以下` }
  const m = await env.run(path, ['models', 'verify', '--tier', 'basic'], 60_000)
  if (m.code !== 0) return { ok: false, reason: '缺识别模型（models verify 没过）' }
  return { ok: true, version }
}

/** 按顺序找；都不能用时：有找到过的报第一个的原因，一个都没有就是没装 */
export async function findMineru(env: FindEnv): Promise<MineruFind> {
  const list = candidates(env).filter((c) => env.exists(c.path))
  if (env.shell) {
    const r = await env.run('/bin/zsh', ['-lc', 'command -v mineru-kit'], 10_000)
    const p = r.code === 0 ? r.out.trim().split('\n').pop()?.trim() : ''
    if (p && p.startsWith('/') && !list.some((c) => c.path === p) && env.exists(p)) list.push({ path: p, from: 'PATH 里的 mineru-kit' })
  }
  let bad: MineruFind | null = null
  for (const c of list) {
    const r = await check(env, c.path)
    if (r.ok) return { state: 'ready', path: c.path, version: r.version, from: c.from }
    bad ??= { state: 'bad', path: c.path, reason: `${c.from}的 MinerU ${r.reason}` }
  }
  return bad ?? { state: 'missing' }
}

/** 真的环境：execFile 带超时，读文件不在就 null */
export function realFindEnv(o: { home: string; own?: string | null; shell: boolean }): FindEnv {
  return {
    ...o,
    exists: existsSync,
    readText: (p) => {
      try {
        return readFileSync(p, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    run: (cmd, args, timeoutMs) =>
      new Promise((res) =>
        execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL', env: { ...process.env, HOME: o.home, MINERU_MODEL_SOURCE: 'local', PYTHONUNBUFFERED: '1' }, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          const e = err as (Error & { code?: unknown; killed?: boolean }) | null
          res({ code: !e ? 0 : typeof e.code === 'number' ? e.code : null, out: `${stdout}\n${stderr}`, ...(e?.killed ? { timedOut: true } : {}) })
        }),
      ),
  }
}
