/**
 * 翻译用的本机 AI 命令行：在不在、登录没有（不真的问 AI，只看命令和登录凭据），问一次（不给工具）。
 * 和 AI 浮窗用同一套接法（agent/engines.ts），但各起各的进程，工作目录是插件自己的文件夹（没有库里的 CLAUDE.md 掺进来）。
 * CN_AI_FAKE=1 时是假的：CN_TR_FAKE_CLI 定每个命令行的状态（claude=ok,codex=login,…，没写的算能用），
 * CN_TR_FAKE_FAIL 让某个命令行回一句错（claude=Not logged in · Please run /login;codex=…）。
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliId as EngineId } from '../../../shared/ai-sources'
import { findCli } from '../../agent/cli'
import { claudeEngine, codexEngine, type Engine, geminiEngine, opencodeEngine } from '../../agent/engines'
import type { CliBackend } from '../host'
import { fakeAnswer } from './fake'

/** 翻译用的快模型（只有 Claude Code 认；CN_FAST_MODEL 能换） */
export const FAST_MODEL = process.env.CN_FAST_MODEL || 'haiku'

const nonEmptyFile = (p: string) => {
  try {
    return statSync(p).size > 2
  } catch {
    return false
  }
}

/** 登录凭据在不在（各家命令行自己存的地方；只看有没有，不读内容里的密钥） */
export function loggedIn(id: EngineId, env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.HOME || homedir()
  switch (id) {
    case 'claude': {
      if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN || env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) return true
      if (nonEmptyFile(join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.credentials.json'))) return true
      // macOS 上登录凭据在钥匙串里：只问「有没有这一项」，不读密码，不会弹框
      if (process.platform !== 'darwin') return false
      try {
        execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'ignore', timeout: 3000 })
        return true
      } catch {
        return false
      }
    }
    case 'codex':
      return !!env.OPENAI_API_KEY || nonEmptyFile(join(env.CODEX_HOME || join(home, '.codex'), 'auth.json'))
    case 'gemini': {
      if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_USE_VERTEXAI || env.GOOGLE_CLOUD_PROJECT) return true
      const dir = join(home, '.gemini')
      if (existsSync(join(dir, 'oauth_creds.json'))) return true
      try {
        const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { security?: { auth?: { selectedType?: string } }; selectedAuthType?: string }
        return !!(s.security?.auth?.selectedType || s.selectedAuthType)
      } catch {
        return false
      }
    }
    case 'opencode':
      // OpenCode 不登录也有自带的免费模型能用；真不能用时问一次就知道，自动模式会换下一个
      return true
  }
}

/** 真的命令行 */
export function realCli(cwd: string): CliBackend {
  const engines = new Map<EngineId, Engine>()
  const engine = (id: EngineId) => {
    let e = engines.get(id)
    if (!e) {
      e = id === 'claude' ? claudeEngine() : id === 'codex' ? codexEngine() : id === 'gemini' ? geminiEngine() : opencodeEngine()
      engines.set(id, e)
    }
    return e
  }
  return {
    state: (id) => (!findCli(id) ? 'missing' : loggedIn(id) ? 'ok' : 'login'),
    async ask(id, system, prompt, signal, onText, pick) {
      // 新装的软件里插件文件夹还没建（state.json 头一次存设置时才建）：工作目录不在，命令行起不来（spawn ENOENT），会被当成「没装」
      mkdirSync(cwd, { recursive: true })
      const model = pick?.model || (id === 'claude' ? FAST_MODEL : undefined)
      const r = await engine(id).run({ prompt, system, cwd, signal, onText, ...(model ? { model } : {}), ...(pick?.effort ? { effort: pick.effort } : {}) })
      return r.text
    },
  }
}

function parseMap(s: string | undefined, sep: RegExp): Map<string, string> {
  const m = new Map<string, string>()
  for (const part of (s ?? '').split(sep)) {
    const i = part.indexOf('=')
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  return m
}

/**
 * 假的命令行（CN_AI_FAKE=1）：按提示给固定的回答，一行一行吐，和真模型一样。
 * CN_TR_FAKE_SKIP=字:次数：原文里有这几个字的段前几次不回（演 AI 漏段，不写次数是一直不回）；CN_TR_FAKE_HANG：这一批里有这几个字就一直不回话、也不理会停下（演命令行卡死）
 */
export function fakeCli(env: NodeJS.ProcessEnv = process.env): CliBackend {
  const skipped = new Map<string, number>()
  return {
    state(id) {
      const s = parseMap(env.CN_TR_FAKE_CLI, /,/).get(id)
      return s === 'login' || s === 'missing' ? s : 'ok'
    },
    async ask(id, _system, prompt, signal, onText, pick) {
      await new Promise((r) => setTimeout(r, Number(env.CN_AI_FAKE_DELAY_MS) || 300))
      if (env.CN_TR_FAKE_HANG && prompt.includes(env.CN_TR_FAKE_HANG)) await new Promise<never>(() => {})
      if (env.CN_TR_FAKE_PICK_LOG && pick) appendFileSync(env.CN_TR_FAKE_PICK_LOG, JSON.stringify({ id, ...pick }) + '\n')
      if (signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
      const fail = parseMap(env.CN_TR_FAKE_FAIL, /;/).get(id)
      if (fail) throw new Error(fail)
      let out = fakeAnswer(prompt)
      const [skip, times] = (env.CN_TR_FAKE_SKIP ?? '').split(':')
      if (skip && prompt.includes(skip) && (skipped.get(skip) ?? 0) < (Number(times) || Infinity)) {
        skipped.set(skip, (skipped.get(skip) ?? 0) + 1)
        out = out.split('\n').filter((l) => !l.includes(`译文：${skip}`)).join('\n')
      }
      for (const line of out.split(/(?<=\n)/)) onText(line)
      return out
    },
  }
}
