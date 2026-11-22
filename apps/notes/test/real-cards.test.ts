// 真 Claude Code 出一次卡（task-tz7y3）：照软件交给 AI 的同一份话（card-prompt.ts），在 ecp 两讲 8 问那份真实样子的 PDF 笔记上出卡，
// 逐张核对 ChatCards 的出卡规矩：问题离开那一页也看得懂、答案不超过 40 字、带一句原文摘句并且真是材料里原样的一句。
// 平时跳过；真跑：env -i HOME="$HOME" USER="$USER" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx vitest run apps/notes/test/real-cards.test.ts
// （Sonnet、Low，不读用户设置、不留会话记录；CN_CARDS_OUT=<文件> 把出的卡存下来给对照图用）
import { cardProblems, doubtItems, parseCardLines } from '@cn/format'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { L4, L4_PAGES, L4_SECTIONS, L5, L5_PAGES, L5_SECTIONS } from '../e2e/fixtures/anki'
import { CARD_SYSTEM, cardMaterial, cardPrompt } from '../src/main/reading/card-prompt'

const REAL = process.env.CN_REAL_AI === '1'

describe.skipIf(!REAL)('真 Claude Code 出卡', () => {
  it('ecp 两讲 8 问：一问一张，每张都守 ChatCards 的规矩', { timeout: 300_000 }, async () => {
    const items = [...L5_SECTIONS.flatMap((s) => doubtItems(L5, s, 5)), ...L4_SECTIONS.flatMap((s) => doubtItems(L4, s, 4))]
    const pageText = (pdf: string, page: number) => {
      const p = (pdf === L5 ? L5_PAGES : L4_PAGES)[page - 1]
      return p ? [p.title, ...p.lines].join('\n') : ''
    }
    const blocks = items.map((it, k) => cardMaterial(k + 1, it, { course: 'ecp', pageText: pageText(it.pdf, it.section.page) }))
    const prompt = cardPrompt(blocks)
    // 同软件里 Claude Code 只聊天那一路（engines.ts 的 claudeArgs）：换掉系统提示、不读用户设置、不给工具、答一次、不留会话
    const args = ['-p', '--output-format', 'text', '--model', 'sonnet', '--effort', 'low', '--system-prompt', CARD_SYSTEM, '--setting-sources=', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', '', '--max-turns', '1', '--no-session-persistence']
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE')))
    const t0 = Date.now()
    const text = await new Promise<string>((resolve, reject) => {
      const p = execFile('claude', args, { cwd: tmpdir(), env, timeout: 240_000, maxBuffer: 8 << 20 }, (err, out, errOut) => (err ? reject(new Error(`${err.message}\n${errOut}`)) : resolve(out)))
      p.stdin!.end(prompt)
    })
    const cards = parseCardLines(text)
    console.log(`真 Claude Code（Sonnet · Low）出了 ${cards.length} 张，${((Date.now() - t0) / 1000).toFixed(1)} 秒\n${text}`)
    expect(cards.map((c) => c.id)).toEqual(items.map((_, k) => String(k + 1)))
    const report = cards.map(({ id, card }) => {
      const it = items[Number(id) - 1]!
      const material = [it.answer ?? '', it.quote ?? '', pageText(it.pdf, it.section.page)].join('\n')
      return { id, question: it.section.doubts[0], card, problems: cardProblems(it.quote ? { ...card, quote: it.quote } : card, material) }
    })
    if (process.env.CN_CARDS_OUT) writeFileSync(process.env.CN_CARDS_OUT, JSON.stringify(report, null, 2))
    for (const r of report) console.log(`${r.id}. ${r.question} → ${r.card.q} ｜ ${r.card.a}${r.problems.length ? `\n   ✗ ${r.problems.join('；')}` : ''}`)
    expect(report.filter((r) => r.problems.length)).toEqual([])
  })
})
