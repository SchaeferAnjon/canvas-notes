/**
 * 找本机装的 AI 命令行。从 Finder 打开的 Mac 应用 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 找不到 Homebrew、npm、bun 装的命令，所以按常见的安装位置一个个找，子进程的 PATH 也补全。
 *
 * 找哪些目录参照了 Claudian（github.com/yishentu/claudian，MIT，版权 (c) 2025 Yishen Tu）的
 * src/core/process/env.ts 和 cliBinaryLocator.ts，许可声明见仓库根目录 THIRD_PARTY_NOTICES.md。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { EngineId } from '../../shared/agent'

export const COMMAND: Record<EngineId, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode' }

export const INSTALL_HINT: Record<EngineId, string> = {
  claude: '没找到 claude 命令。装 Claude Code：curl -fsSL https://claude.ai/install.sh | bash，再在终端里运行一次 claude 登录。',
  codex: '没找到 codex 命令。装 Codex：brew install codex 或 npm i -g @openai/codex，再运行一次 codex 登录。',
  gemini: '没找到 gemini 命令。装 Gemini CLI：brew install gemini-cli 或 npm i -g @google/gemini-cli，再运行一次 gemini 登录。',
  opencode: '没找到 opencode 命令。装 OpenCode：brew install opencode 或 curl -fsSL https://opencode.ai/install | bash。',
}

/** nvm 装的 node：最新的那个版本的 bin */
function nvmBins(home: string): string[] {
  const root = join(home, '.nvm/versions/node')
  try {
    return readdirSync(root)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => join(root, v, 'bin'))
  } catch {
    return []
  }
}

/** 按顺序找的目录：常见安装位置在前，再是继承来的 PATH */
export function searchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir()
  const dirs = [
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global/bin'),
    join(home, '.bun/bin'),
    join(home, '.volta/bin'),
    join(home, '.opencode/bin'),
    join(home, 'Library/pnpm'),
    join(home, '.yarn/bin'),
    join(home, '.cargo/bin'),
    ...(env.PNPM_HOME ? [env.PNPM_HOME] : []),
    ...nvmBins(home),
    ...(env.PATH ?? '').split(delimiter),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  return [...new Set(dirs.filter(Boolean))]
}

function isExecutable(p: string): boolean {
  try {
    const s = statSync(p)
    return s.isFile() && (s.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function findCli(id: EngineId, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of searchDirs(env)) {
    const p = join(dir, COMMAND[id])
    if (existsSync(p) && isExecutable(p)) return p
  }
  return null
}

/** 子进程用的环境：PATH 补全（gemini 这类 node 脚本要找得到 node） */
export function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: searchDirs().join(delimiter), ...extra }
}
