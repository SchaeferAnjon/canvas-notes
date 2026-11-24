/**
 * 上手卡里「装 Claude Code」那一条（task-587os，设计页第 3 节）：照官方的原生安装命令跑（不用 Node），输出一行行给界面看；
 * 登录跑 `claude auth login`，它打开浏览器、在 Anthropic 自己的页面登（条款不准第三方收集 Claude 账号凭据，软件里不放登录框），
 * 跑完再问 `claude auth status` 登没登好。
 * 测试实例（CN_E2E=1）不真装：CN_CC_FAKE=ok|fail 演装好、装不上（默认装好），登录直接算登好。
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { t } from '../../shared/i18n'
import { E2E } from '../test-mode'
import { cliEnv, findCli, runProc } from '@cn/ai-engines'

/** 官方原生安装命令（code.claude.com 的安装说明；装在 ~/.local/bin/claude，以后它自己更新） */
export const CC_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 装：每一行输出交给 onLine；装好返回 true，没装上抛一句（带最后一行原话） */
export async function installClaudeCode(onLine: (line: string) => void): Promise<void> {
  if (E2E) {
    const fail = process.env.CN_CC_FAKE === 'fail'
    for (const l of ['Downloading Claude Code 2.1.330 for darwin-arm64…', 'Verifying checksum…', ...(fail ? ['curl: (6) Could not resolve host: claude.ai'] : ['Installed to ~/.local/bin/claude', '✓ claude 2.1.330'])]) {
      onLine(l)
      await sleep(120)
    }
    if (fail) throw new Error(t('没装上：{line}', { line: 'curl: (6) Could not resolve host: claude.ai' }))
    return
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', CC_INSTALL], { cwd: homedir(), env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let last = ''
    let buf = ''
    const take = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n|\r/)
      buf = lines.pop() ?? ''
      for (const raw of lines) {
        // 去掉终端颜色
        const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
        if (!line) continue
        last = line
        onLine(line)
      }
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    // 下载要几十秒；10 分钟还没完就当卡住了
    const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000)
    child.on('error', (e) => (clearTimeout(timer), reject(new Error(t('没装上：{line}', { line: e.message })))))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(t('没装上：{line}', { line: last || `exit ${code}` })))
    })
  })
}

/** 登录：打开浏览器等用户在 Anthropic 的页面登好（最多 10 分钟），登好返回 true */
export async function loginClaudeCode(): Promise<boolean> {
  if (E2E) {
    await sleep(200)
    return true
  }
  const exe = findCli('claude')
  if (!exe) throw new Error(t('还没找到claude：先装好再登录'))
  const r = await runProc(exe, ['auth', 'login', '--claudeai'], { timeoutMs: 10 * 60_000 })
  if (r.error) throw new Error(r.error)
  return claudeLoggedIn()
}

/** `claude auth status --json` 说登好了没有 */
export async function claudeLoggedIn(): Promise<boolean> {
  if (E2E) return true
  const exe = findCli('claude')
  if (!exe) return false
  const r = await runProc(exe, ['auth', 'status', '--json'], { timeoutMs: 15_000 })
  try {
    const o = JSON.parse(r.stdout) as { loggedIn?: unknown }
    return o.loggedIn === true
  } catch {
    return r.code === 0
  }
}
