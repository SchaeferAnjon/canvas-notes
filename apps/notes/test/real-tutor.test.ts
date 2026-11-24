// CN-89 真跑一次本机的 Claude Code（要联网、花一点额度）：和读 PDF 同一组参数（附加系统提示、读用户设置、关掉 hooks、只接我们的 MCP、不给工具、留会话），
// 换成 --model haiku --effort low，问一句「只回一个字：好」，看参数都被接受、答得出来。跑完删掉这次留下的会话记录。
// CN_REAL_TUTOR=1 npx vitest run apps/notes/test/real-tutor.test.ts
// 在 Claude Code 的终端里跑时去掉父会话的 CLAUDE_* 环境变量（像从访达打开的软件一样）：
// env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_TUTOR=1 npx vitest run apps/notes/test/real-tutor.test.ts
// 2026-11-18 跑过一次（claude 2.1.323）：参数都接受，2.0 秒答「好」
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEngine, findCli } from '@cn/ai-engines'
import { TUTOR_SYSTEM } from '../src/main/reading/prompts'

describe.skipIf(!process.env.CN_REAL_TUTOR)('真的问一次 Claude Code（读 PDF 那组参数）', () => {
  it('参数都被接受，答「好」', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cn-tutor-'))
    const exe = findCli('claude')!
    const run = { prompt: '只回一个字：好', system: TUTOR_SYSTEM, appendSystem: true, keepSession: true, model: 'haiku', effort: 'low' }
    console.log('命令：', exe, JSON.stringify(claudeArgs(run)))
    const t = Date.now()
    const deltas: string[] = []
    const r = await claudeEngine().run({ ...run, cwd, signal: AbortSignal.timeout(120_000), onText: (d) => deltas.push(d) })
    console.log(`答了 ${((Date.now() - t) / 1000).toFixed(1)} 秒，会话 ${r.session}，回答：${JSON.stringify(r.text)}（${deltas.length} 段）`)
    expect(r.text).toContain('好')
    expect(r.session).toBeTruthy()
    // 这次留下的会话记录删掉：~/.claude/projects 下按临时目录起名的那个文件夹（里面只有这次的会话和空的 memory）整个是这次建的
    const projects = join(homedir(), '.claude/projects')
    for (const d of readdirSync(projects)) {
      if (!existsSync(join(projects, d, `${r.session}.jsonl`))) continue
      expect(d).toContain('cn-tutor-')
      rmSync(join(projects, d), { recursive: true })
    }
    rmSync(cwd, { recursive: true, force: true })
  }, 180_000)
})
