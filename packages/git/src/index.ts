/**
 * 调系统 git 命令（SSH、钥匙串直接能用）。每个调用都有超时；git 报错原样抛出。
 */
import { execFile } from 'node:child_process'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export interface GitOptions {
  timeoutMs?: number
}

/**
 * 从访达、程序坞打开的软件只拿到 /usr/bin:/bin 这样的 PATH，Homebrew 装的 git-lfs 这类 git 钩子要用的程序找不到
 * （用户全局 core.hooksPath 里有 Git LFS 的 post-checkout 钩子时，git worktree 会直接失败）。补上常见安装位置，排在继承来的后面。
 */
export function gitPath(path = process.env.PATH ?? ''): string {
  const dirs = [...path.split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  return [...new Set(dirs.filter(Boolean))].join(':')
}

export function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, timeout: opts.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PATH: gitPath(), GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(`git ${args[0]} 失败：${stderr.trim() || err.message}`, args, stderr))
        else resolve(stdout)
      },
    )
  })
}

export async function isRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch (e) {
    if (e instanceof GitError) return false
    throw e
  }
}

export async function init(dir: string): Promise<void> {
  await git(dir, ['init', '-b', 'main'])
}

/** 当前分支；还没有提交时也能拿到名字 */
export async function currentBranch(dir: string): Promise<string> {
  return (await git(dir, ['symbolic-ref', '--short', 'HEAD'])).trim()
}

export interface FileStatus {
  path: string
  /** 两个字母的状态，同 git status --porcelain：' M'、'??'、'A ' 等 */
  code: string
}

export async function status(dir: string): Promise<FileStatus[]> {
  // 不抢 index.lock：界面随时在查状态，抢了锁会让同时进行的提交、撤回失败
  const out = await git(dir, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const items: FileStatus[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (!p) continue
    const code = p.slice(0, 2)
    items.push({ path: p.slice(3), code })
    if (code[0] === 'R' || code[0] === 'C') i++ // 改名时下一段是旧路径
  }
  return items
}

/** 把所有改动提交成一次；没有改动时返回 null */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ['add', '-A'])
  if ((await status(dir)).length === 0) return null
  await git(dir, ['commit', '-q', '-m', message])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

export interface Commit {
  hash: string
  date: string
  subject: string
  files: { path: string; added: number; removed: number }[]
}

export async function log(dir: string, limit = 50): Promise<Commit[]> {
  let out: string
  try {
    out = await git(dir, ['log', `-n${limit}`, '--format=%x1e%H%x1f%aI%x1f%s', '--numstat', '-z'])
  } catch (e) {
    // 还没有任何提交
    if (e instanceof GitError && /does not have any commits|bad default revision/.test(e.stderr)) return []
    throw e
  }
  const commits: Commit[] = []
  for (const rec of out.split('\x1e')) {
    if (!rec.trim()) continue
    // 用了 -z 之后头一行以 \0 结尾
    const nl = rec.search(/[\0\n]/)
    const head = nl === -1 ? rec : rec.slice(0, nl)
    const [hash, date, subject] = head.split('\x1f') as [string, string, string]
    const files: Commit['files'] = []
    const rest = nl === -1 ? '' : rec.slice(nl + 1)
    for (const entry of rest.split('\0')) {
      const m = entry.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (m) files.push({ path: m[3]!, added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) })
    }
    commits.push({ hash, date, subject, files })
  }
  return commits
}

export async function hasRemote(dir: string): Promise<boolean> {
  return (await git(dir, ['remote'])).trim() !== ''
}

/** 第一个远程仓库的名字和地址；没有远程时是 null */
export async function remote(dir: string): Promise<{ name: string; url: string } | null> {
  const name = (await git(dir, ['remote'])).trim().split('\n')[0]
  if (!name) return null
  return { name, url: (await git(dir, ['remote', 'get-url', name])).trim() }
}

/** 设远程仓库地址：已有就改第一个，没有就加一个叫 origin 的。只改本机配置，不联网 */
export async function setRemote(dir: string, url: string): Promise<void> {
  const u = url.trim()
  if (!u || /\s/.test(u) || u.startsWith('-')) throw new Error('远程地址不对')
  const cur = await remote(dir)
  if (cur) await git(dir, ['remote', 'set-url', cur.name, u])
  else await git(dir, ['remote', 'add', 'origin', u])
}

/** 提交说明：「更新 3 个文件：所思所想、旅行、收件箱/2026-11-15 1403」 */
export function describeChanges(files: FileStatus[]): string {
  const names = files.map((f) => f.path.replace(/\.md$/i, ''))
  const shown = names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '')
  const allNew = files.every((f) => f.code === '??' || f.code[0] === 'A')
  return `${allNew ? '新增' : '更新'} ${files.length} 个文件：${shown}`
}

/** 从 since 起的提交数 */
export async function countCommitsSince(dir: string, since: Date): Promise<number> {
  try {
    return Number((await git(dir, ['rev-list', '--count', `--since=${since.toISOString()}`, 'HEAD'])).trim())
  } catch (e) {
    if (e instanceof GitError && /unknown revision|ambiguous argument 'HEAD'/.test(e.stderr)) return 0
    throw e
  }
}

export type SyncResult =
  | { kind: 'no-remote' }
  /** 远程和本地改了同一处，已经退回同步前的样子 */
  | { kind: 'conflict'; message: string }
  | { kind: 'ok'; committed: string | null; pulled: number; pushed: boolean }

/**
 * 同步：先把本地改动提交，再 pull --rebase，再 push。
 * rebase 冲突时 abort，库回到同步前，交给用户处理。
 */
export async function sync(dir: string, opts: GitOptions = {}): Promise<SyncResult> {
  if (!(await hasRemote(dir))) return { kind: 'no-remote' }
  const timeoutMs = opts.timeoutMs ?? 60_000
  const st = await status(dir)
  const committed = st.length ? await commitAll(dir, describeChanges(st)) : null
  const branch = await currentBranch(dir)
  const remote = (await git(dir, ['remote'])).trim().split('\n')[0]!
  const before = await revParse(dir, 'HEAD')

  await git(dir, ['fetch', remote], { timeoutMs })
  const remoteRef = `${remote}/${branch}`
  const remoteHead = await revParse(dir, remoteRef)
  let pulled = 0
  if (remoteHead) {
    pulled = Number((await git(dir, ['rev-list', '--count', `HEAD..${remoteRef}`])).trim())
    if (pulled > 0) {
      try {
        await git(dir, ['rebase', remoteRef], { timeoutMs })
      } catch (e) {
        if (!(e instanceof GitError)) throw e
        await git(dir, ['rebase', '--abort']).catch(() => undefined)
        return { kind: 'conflict', message: e.message }
      }
    }
  }
  const ahead = remoteHead ? Number((await git(dir, ['rev-list', '--count', `${remoteRef}..HEAD`])).trim()) : before ? 1 : 0
  if (ahead > 0) await git(dir, ['push', '-u', remote, `HEAD:${branch}`], { timeoutMs })
  return { kind: 'ok', committed, pulled, pushed: ahead > 0 }
}

async function revParse(dir: string, ref: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--verify', '--quiet', ref])).trim() || null
  } catch (e) {
    if (e instanceof GitError) return null
    throw e
  }
}

/** 只提交这几个路径（新建、修改、删除都算）；返回提交号，没有改动返回 null */
export async function commitPaths(dir: string, paths: string[], message: string): Promise<string | null> {
  if (!paths.length) return null
  await git(dir, ['add', '-A', '--', ...paths])
  const staged = (await git(dir, ['diff', '--cached', '--name-only', '-z', '--', ...paths])).split('\0').filter(Boolean)
  if (!staged.length) return null
  await git(dir, ['commit', '-q', '-m', message, '--', ...paths])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

/** 撤回一次提交：再做一次反向提交，返回新的提交号 */
export async function revert(dir: string, hash: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('提交号不对')
  try {
    await git(dir, ['revert', '--no-edit', hash])
  } catch (e) {
    if (e instanceof GitError) {
      await git(dir, ['revert', '--abort']).catch(() => undefined)
      throw new Error('撤回不了：那之后这几处又被改过了，需要手动处理。')
    }
    throw e
  }
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

/** since 以来每次提交的时间（毫秒）和改了哪些文件，新的在前 */
export async function commitsSince(dir: string, since: Date): Promise<{ t: number; files: string[] }[]> {
  let out: string
  try {
    out = await git(dir, ['log', `--since=${since.toISOString()}`, '--format=%x1e%at', '--name-only'])
  } catch (e) {
    if (e instanceof GitError && /does not have any commits|bad default revision/.test(e.stderr)) return []
    throw e
  }
  return out
    .split('\x1e')
    .filter((r) => r.trim())
    .map((r) => {
      const [t, ...files] = r.trim().split('\n')
      return { t: Number(t) * 1000, files: files.filter(Boolean) }
    })
}
