// r172 A6、A7：各家命令行的安装、修复命令照官方装法（装在家目录、不用 sudo）；主进程看过命令行以后加的记号认成「装了运行不了」「没登录」
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { aiErrorCode, aiErrorView, BROKEN, NOT_LOGGED_IN } from '../src/shared/ai-errors'

vi.mock('../src/main/test-mode', () => ({ E2E: false }))
const { installPlan, INSTALL_SCRIPT } = await import('../src/main/agent/cli-install')

let home: string
const env = { HOME: process.env.HOME, CN_CLI_HOME_ONLY: process.env.CN_CLI_HOME_ONLY }
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'cn-cli-install-')))
  process.env.HOME = home
  process.env.CN_CLI_HOME_ONLY = '1'
})
afterEach(() => {
  process.env.HOME = env.HOME
  if (env.CN_CLI_HOME_ONLY === undefined) delete process.env.CN_CLI_HOME_ONLY
  else process.env.CN_CLI_HOME_ONLY = env.CN_CLI_HOME_ONLY
  rmSync(home, { recursive: true, force: true })
})

function exe(p: string) {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, '#!/bin/sh\n')
  chmodSync(p, 0o755)
}

it('没装：Claude Code、Codex、OpenCode 跑各自官方的安装脚本（2026-11-25 官方文档），都不带 sudo', () => {
  expect(installPlan('claude')).toEqual({ cmd: '/bin/bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], text: 'curl -fsSL https://claude.ai/install.sh | bash' })
  expect(installPlan('codex')).toMatchObject({ text: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' })
  expect(installPlan('opencode')).toMatchObject({ text: 'curl -fsSL https://opencode.ai/install | bash' })
  for (const line of Object.values(INSTALL_SCRIPT)) expect(line).not.toMatch(/sudo/)
})

it('Gemini CLI：有 npm 装到 ~/.local；没 npm 有 brew 用 brew；都没有说先装 Node.js', () => {
  expect(installPlan('gemini')).toEqual({ none: 'Gemini CLI要先有Node.js：到 nodejs.org 装好Node.js，再点「安装」' })
  exe(join(home, '.local/bin/brew'))
  expect(installPlan('gemini')).toEqual({ cmd: join(home, '.local/bin/brew'), args: ['install', 'gemini-cli'], text: 'brew install gemini-cli' })
  exe(join(home, '.local/bin/npm'))
  expect(installPlan('gemini')).toEqual({ cmd: join(home, '.local/bin/npm'), args: ['install', '-g', '--prefix', join(home, '.local'), '@google/gemini-cli@latest'], text: 'npm install -g --prefix ~/.local @google/gemini-cli@latest' })
})

it('修复照它现在的装法：Homebrew 装的 brew reinstall（formula、cask），npm 装的用同一个前缀的 npm 再装最新的，别的跑官方脚本', () => {
  // Homebrew formula：/opt/homebrew/bin/gemini → ../Cellar/gemini-cli/…
  const cellar = join(home, 'brew/Cellar/gemini-cli/0.64.0/bin/gemini')
  exe(cellar)
  mkdirSync(join(home, 'brew/bin'), { recursive: true })
  symlinkSync(cellar, join(home, 'brew/bin/gemini'))
  expect(installPlan('gemini', join(home, 'brew/bin/gemini'))).toMatchObject({ args: ['reinstall', 'gemini-cli'], text: 'brew reinstall gemini-cli' })
  // Homebrew cask
  const cask = join(home, 'brew/Caskroom/codex/0.163.0/codex')
  exe(cask)
  expect(installPlan('codex', cask)).toMatchObject({ args: ['reinstall', '--cask', 'codex'], text: 'brew reinstall --cask codex' })
  // npm 全局：<前缀>/lib/node_modules/@openai/codex/bin/codex.js，用 <前缀>/bin/npm
  const npmBin = join(home, 'node/lib/node_modules/@openai/codex/bin/codex.js')
  exe(npmBin)
  exe(join(home, 'node/bin/npm'))
  expect(installPlan('codex', npmBin)).toEqual({ cmd: join(home, 'node/bin/npm'), args: ['install', '-g', '--prefix', join(home, 'node'), '@openai/codex@latest'], text: 'npm install -g @openai/codex@latest' })
  // 原生安装的（~/.local/bin/claude）：官方脚本
  exe(join(home, '.local/bin/claude'))
  expect(installPlan('claude', join(home, '.local/bin/claude'))).toMatchObject({ text: 'curl -fsSL https://claude.ai/install.sh | bash' })
})

it('主进程看过命令行以后的记号：「【运行不了】」认成装了运行不了（去设置点修复，原话留着），「【没登录】」认成没登录', () => {
  const broken = `${BROKEN}Claude Code运行不了：dyld[1]: Library not loaded\nClaude Code 退出了（134）`
  expect(aiErrorCode(broken)).toBe('broken')
  const v = aiErrorView(broken, { id: 'claude', label: 'Claude Code' })
  expect(v).toMatchObject({ code: 'broken', title: 'Claude Code装了但运行不了：去 设置 › AI点「修复」重新装一遍', acts: ['settings', 'switch'] })
  expect(v.raw).toBe('Claude Code运行不了：dyld[1]: Library not loaded\nClaude Code 退出了（134）')
  const out = `${NOT_LOGGED_IN}Claude Code 没有回答。确认这台 Mac 上的 Claude Code 已经登录（终端里运行 claude）。`
  expect(aiErrorCode(out)).toBe('not-logged-in')
  expect(aiErrorView(out, { id: 'claude', label: 'Claude Code' }).raw).not.toContain(NOT_LOGGED_IN)
  // 没记号的「没有回答」照旧是中途退出
  expect(aiErrorCode('Claude Code 没有回答。确认这台 Mac 上的 Claude Code 已经登录（终端里运行 claude）。')).toBe('exited')
})
