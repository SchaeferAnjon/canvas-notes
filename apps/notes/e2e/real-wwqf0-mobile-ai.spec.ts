// 真 AI 走一遍「iPad 问 Mac」（task-wwqf0）：软件里真点开开关，照 iPad 的做法配对，问一句 AI 对话、PDF 上选一段讲解一下，
// Mac 交给本机真的命令行答，一帧一帧传回来。要联网、花一点额度，平时跳过：
//   ANTHROPIC_API_KEY=… CN_REAL_AI=1 npx playwright test e2e/real-wwqf0-mobile-ai.spec.ts            Claude Code（Sonnet、Low）
//   CN_REAL_AI=1 CN_REAL_ENGINE=codex npx playwright test e2e/real-wwqf0-mobile-ai.spec.ts             Codex（Low）
// Key 运行时从外面给（dispatch env），不写进仓库、不打印。这一路不留 Claude Code 的会话记录（--no-session-persistence）；
// Codex 只删这次 ~/.codex/sessions 里写着这个临时库的那几个会话文件。
import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ask, pairWith } from '../src/main/mobile-ai/client'
import { type Frame, parsePairLink } from '../src/main/mobile-ai/protocol'
import { launch, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(5 * 60_000)

const ENGINE = process.env.CN_REAL_ENGINE === 'codex' ? 'codex' : 'claude'

function forgetCodex(run: Running, since: number) {
  const root = join(homedir(), '.codex', 'sessions')
  const stamp = dirname(run.vault).split('/').pop()!
  const gone: string[] = []
  const walk = (d: string) => {
    if (!existsSync(d)) return
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.mtimeMs >= since && f.endsWith('.jsonl') && readFileSync(p, 'utf8').includes(stamp)) {
        rmSync(p)
        gone.push(f)
      }
    }
  }
  walk(root)
  console.log(`删掉了这次的 Codex 会话记录：${gone.length} 个`)
}

const textOf = (frames: Frame[]) =>
  frames
    .filter((f): f is Extract<Frame, { t: 'text' }> => f.t === 'text')
    .map((f) => f.d)
    .join('')

test('真 AI：iPad 配对以后问 Mac，Mac 用本机的命令行答，一帧一帧传回；讲解一下带着那一页和选中的字', async () => {
  const since = Date.now()
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_AI_MODEL: 'sonnet', CN_MAC_NAME: '测试 Mac' })
  const { page } = run
  try {
    await page.evaluate((engine) => {
      const pick = engine === 'codex' ? { engine: 'codex' as const, effort: 'low' } : { engine: 'claude' as const, model: 'sonnet', effort: 'low' }
      return window.cn.aiSetPrefs({ default: pick, features: { chat: pick } })
    }, ENGINE)
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const group = page.getByRole('dialog', { name: '设置' }).getByRole('group', { name: 'iPhone 和 iPad' })
    await group.getByRole('switch', { name: '让iPhone / iPad用这台Mac的AI' }).click()
    const link = parsePairLink((await group.getByRole('img', { name: '配对二维码' }).getAttribute('data-link'))!)
    const pad = await pairWith(link, `http://127.0.0.1:${link.port}`, 'iPad', 'iPad')

    const t0 = Date.now()
    let firstText = 0
    const chat = await ask(pad, { kind: 'chat', text: '用一句话说：线性变换是什么？', device: 'iPad' }, (f, at) => {
      if (f.t === 'text' && !firstText) firstText = at - t0
    })
    console.log(`AI 对话：meta ${JSON.stringify(chat[0])}，第一段字 ${firstText} 毫秒，一共 ${chat.length} 帧`)
    expect(chat[0]).toMatchObject({ t: 'meta', mac: '测试 Mac', engine: ENGINE })
    expect(chat.at(-1)).toMatchObject({ t: 'done' })
    expect(textOf(chat).length).toBeGreaterThan(5)
    console.log(`回答：${textOf(chat).slice(0, 200)}`)

    const ex = await ask(pad, {
      kind: 'explain',
      text: '',
      quote: 'Grid lines stay straight, parallel and evenly spaced, and the origin stays fixed.',
      source: { kind: 'pdf', title: 'Linear transformations', path: '课程/线代/Linear transformations.pdf', page: 3, pages: 5, pageText: 'A transformation T from R^n to R^m is linear if it preserves the two operations of a vector space. Grid lines stay straight, parallel and evenly spaced, and the origin stays fixed.' },
      device: 'iPad',
    })
    expect(ex.at(-1)).toMatchObject({ t: 'done' })
    const answer = textOf(ex)
    console.log(`讲解一下：${answer.slice(0, 300)}`)
    expect(answer).toMatch(/[一-鿿]/)
    expect(answer.length).toBeGreaterThan(40)
  } finally {
    await run.close()
    if (ENGINE === 'codex') forgetCodex(run, since)
  }
})
