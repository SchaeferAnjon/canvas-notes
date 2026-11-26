// 各家引擎危险步骤检查（2026-11-25）：Codex、Gemini、OpenCode 全能模式下每一步也过 stepDanger（step-gate.ts，和 Claude Code 同一道）。
// 假协议进程（packages/ai-engines/test/fixtures 的 fake-codex.mjs、fake-acp.mjs）照真命令行录的审批请求（fixtures/gate）一步一步做，
// 批了才在临时库里真跑命令、写文件、推到临时的远端：安全的直接过、rm / git push / 写库外先问，点「不要」不做、点「可以」才做；
// Mac 桌面不给 confirm 照旧不问。库外的路径是家目录下一个不存在的文件夹（问了、没点头就不会建出来）
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { acpEngine, codexEngine, type Engine, geminiArgs, opencodeConfig } from '@cn/ai-engines'
import { stepGate } from '../src/main/agent/step-gate'
import type { DangerKind } from '../src/main/mobile-ai/danger'

const FIX = join(__dirname, '..', '..', '..', 'packages', 'ai-engines', 'test', 'fixtures')
const opened: Engine[] = []
const made: string[] = []
afterAll(() => {
  for (const e of opened) e.dispose?.()
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
function vault() {
  const dir = mkdtempSync(join(tmpdir(), 'cn-gates-vault-'))
  const remote = mkdtempSync(join(tmpdir(), 'cn-gates-remote-'))
  made.push(dir, remote)
  git(remote, 'init', '-q', '--bare')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'remote', 'add', 'origin', remote)
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  writeFileSync(join(dir, 'junk.txt'), 'junk\n')
  git(dir, 'add', '.')
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a')
  return { dir, pushed: () => git(remote, 'log', '--oneline', '--all').trim() !== '' }
}
/** 库外：家目录下一个不存在的文件夹（stepDanger 不把临时文件夹算库外） */
const outside = () => join(homedir(), `cn-gates-outside-${randomBytes(4).toString('hex')}`)

type Engine3 = 'codex' | 'gemini' | 'opencode'
function engineOf(id: Engine3): Engine {
  const e =
    id === 'codex'
      ? codexEngine(process.execPath, [join(FIX, 'fake-codex.mjs')])
      : acpEngine({
          id,
          command: process.execPath,
          args: (cwd, mode) => [join(FIX, 'fake-acp.mjs'), ...(id === 'gemini' ? geminiArgs(mode, '/tmp/p.toml') : ['acp', '--cwd', cwd])],
          env: (mode): Record<string, string> => (id === 'opencode' ? { OPENCODE_CONFIG_CONTENT: opencodeConfig(mode) } : {}),
          loginHint: '去登录',
        })
  opened.push(e)
  return e
}
const SAMPLE: Record<Engine3, string> = { codex: 'codex-0.163.0.json', gemini: 'gemini-0.64.0.json', opencode: 'opencode-1.19.3.json' }

/** 跑一问：answer 不给就是 Mac 桌面（不给 confirm）；给了就是手机全能模式 / 画布今日，每一次点头照 answer 答 */
async function turn(id: Engine3, v: ReturnType<typeof vault>, out: string, answer?: (kind: DangerKind) => boolean) {
  const asks: { id: string; label: string; kind: DangerKind }[] = []
  const env = id === 'codex' ? { FAKE_CODEX_GATE: join(FIX, 'gate', SAMPLE[id]) } : { FAKE_ACP_GATE: join(FIX, 'gate', SAMPLE[id]) }
  Object.assign(process.env, env, { FAKE_GATE_OUT: out })
  try {
    const beforeTool = answer
      ? stepGate(v.dir, 7, async (s) => {
          asks.push({ id: s.id, label: s.label, kind: s.kind })
          return answer(s.kind)
        }, () => '用户没同意')
      : undefined
    const r = await engineOf(id).run({ prompt: '做', system: '系统', cwd: v.dir, mcp: { url: 'http://127.0.0.1:1/mcp', token: 't', tools: [] }, omni: true, ...(beforeTool ? { beforeTool } : {}), signal: new AbortController().signal, onText: () => undefined })
    return { text: r.text, asks: asks.map((a) => ({ ...a, label: a.label.split(out).join('库外').split(v.dir).join('库') })) }
  } finally {
    for (const k of [...Object.keys(env), 'FAKE_GATE_OUT']) delete process.env[k]
  }
}

/** 各家要问的那几下（stepDanger 的说法，和 Claude Code 一样） */
const ASKED: Record<Engine3, string[]> = {
  codex: ['delete 等你点头：删：rm junk.txt', 'push 等你点头：推送：git push origin main'],
  // 长的那一句截到 48 个字（stepDanger 的 cut），整行命令在步骤行的代码那一段
  gemini: ['delete 等你点头：删：rm junk.txt', 'push 等你点头：推送：git push origin main', expect.stringMatching(/^outside 等你点头：跑：cd .+ && …$/)],
  opencode: ['delete 等你点头：删：rm junk.txt', 'push 等你点头：推送：git push origin main', expect.stringMatching(/^outside 等你点头：改库外的文件 ~\/cn-gates-outside-\w+\/x\.txt$/), expect.stringMatching(/^outside 等你点头：跑：cp a\.txt \/Users\/.+…$/)],
}

describe.each(['codex', 'gemini', 'opencode'] as const)('%s 全能模式的每一步过 stepDanger', (id) => {
  it('点「不要」：ls、库里写文件直接过不问；rm、git push、改库外先问，都没做', async () => {
    const v = vault()
    const out = outside()
    const r = await turn(id, v, out, () => false)
    expect(r.asks.map((a) => `${a.kind} ${a.label}`)).toEqual(ASKED[id])
    // 问的那一行和步骤行同一个 id（「这一轮-这一步」）
    expect(r.asks[0]!.id).toMatch(/^7-./)
    expect(r.text).toMatch(/ls -1 做了/)
    expect(r.text).toMatch(/rm junk\.txt 没做/)
    expect(existsSync(join(v.dir, 'junk.txt'))).toBe(true)
    expect(existsSync(join(v.dir, 'note.md'))).toBe(true)
    expect(readFileSync(join(v.dir, 'a.txt'), 'utf8')).toBe('b\n')
    expect(v.pushed()).toBe(false)
    expect(existsSync(out)).toBe(false)
  })

  it('点「可以」（删、推送）：真删了、真推上去了；库外那几下点「不要」，没建出来', async () => {
    const v = vault()
    const out = outside()
    const r = await turn(id, v, out, (kind) => kind !== 'outside')
    expect(r.asks).toHaveLength(ASKED[id].length)
    expect(existsSync(join(v.dir, 'junk.txt'))).toBe(false)
    expect(v.pushed()).toBe(true)
    expect(existsSync(out)).toBe(false)
  })

  it('Mac 桌面（不给 confirm）：照旧一步都不问，照做', async () => {
    const v = vault()
    const out = mkdtempSync(join(tmpdir(), 'cn-gates-out-'))
    made.push(out)
    const r = await turn(id, v, out)
    expect(r.asks).toEqual([])
    expect(r.text).not.toMatch(/没做/)
    expect(existsSync(join(v.dir, 'junk.txt'))).toBe(false)
    expect(v.pushed()).toBe(true)
  })
})
