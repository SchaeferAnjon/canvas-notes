/**
 * 梦游 Wiki 化的真库评测（task-h7oy8，设计页 24-梦游底层 W.2）：在库的拷贝上跑软件里同一份 wikiLinks（找候选 → AI 判 → 核对 → 写进去），
 * 向量那一路用 bge-m3 给整个拷贝建的搜索索引（和软件同一个 Indexer），AI 走本机 Claude Code 命令行（环境里有 ANTHROPIC_API_KEY 就走 API 额度）。
 * 只读你的库：先自己拷一份、git init 好，CN_REAL_VAULT 指到拷贝。结果写进 CN_WIKI_OUT：links.json（每处链接：哪篇哪句、链到哪一级、理由）、
 * cost.json（问了几次、花了多少）、ledger.json（判过的，重跑不再问）。人看过的对错写在 review.json（{"<A>|<字>": "对" | "错" | "两可"}），score 一步算对错数。
 *   CN_REAL_VAULT=<拷贝> CN_WIKI_OUT=<目录> CN_BGE_DIR=<放 bge-m3-q8_0.gguf 的目录> CN_WIKI_STEP=index  npx vitest run --config apps/notes/eval/vitest.config.mts dream-wiki
 *   ……CN_WIKI_STEP=run CN_WIKI_A=<A 的路径前缀，逗号隔开> [CN_JUDGE=claude:sonnet:medium]
 *   ……CN_WIKI_STEP=score
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { decodeNote } from '@cn/format'
import { it } from 'vitest'
import type { DreamItem } from '../../src/shared/api'
import { DEFAULT_DREAM } from '../../src/shared/dream-settings'
import { judgeLine } from '../../src/main/dream-judge'
import { stripShared } from '../../src/main/dream-links'
import { wikiLinks } from '../../src/main/dream-wiki'
import { bgeEmbedder } from '../../src/main/search/bge'
import { Indexer } from '../../src/main/search/indexer'
import { readPdfText } from '../../src/main/search/pdf-read'

const VAULT = process.env.CN_REAL_VAULT ?? ''
const OUT = process.env.CN_WIKI_OUT ?? ''
const STEP = process.env.CN_WIKI_STEP ?? 'score'

function mdFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n.startsWith('.') || n === 'node_modules') continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) mdFiles(p, out)
    else if (n.toLowerCase().endsWith('.md')) out.push(relative(VAULT, p))
  }
  return out
}

async function indexer() {
  const bge = await bgeEmbedder(process.env.CN_BGE_DIR!)
  let last = 0
  const ix = new Indexer({
    root: VAULT,
    userData: join(OUT, 'ud'),
    indexDir: join(OUT, 'ud', 'search'),
    embedder: bge,
    readPdf: readPdfText,
    onStatus: (s) => {
      if (Date.now() - last > 15_000) {
        last = Date.now()
        console.log(`[索引] ${s.phase} ${s.done}/${s.total}`)
      }
    },
  })
  await ix.scan()
  return ix
}

/** 问 AI：Claude Code 命令行，不给工具、只问一次；记下花了多少 */
function claude(model: string, effort: string, system: string, prompt: string): Promise<{ text: string; cost: number; ms: number }> {
  return new Promise((res, rej) => {
    const t = Date.now()
    const args = ['-p', '--output-format', 'json', '--model', model, '--system-prompt', system, '--setting-sources=', '--strict-mcp-config', '--tools', '', '--max-turns', '1', '--no-session-persistence', '--effort', effort]
    const c = spawn('claude', args, { cwd: OUT, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => c.kill(), 600_000)
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out)
        res({ text: j.result ?? '', cost: j.total_cost_usd ?? 0, ms: Date.now() - t })
      } catch {
        rej(new Error(`claude 退出 ${code}：${err.slice(0, 300)}${out.slice(0, 300)}`))
      }
    })
    c.stdin.end(prompt)
  })
}

it('dream-wiki', { timeout: 6 * 3600_000 }, async () => {
  if (!VAULT || !OUT) throw new Error('要 CN_REAL_VAULT（库的拷贝，git init 过）和 CN_WIKI_OUT')
  mkdirSync(OUT, { recursive: true })
  if (STEP === 'probe') {
    // 看一句话在全库最像的几段和分数（量向量那一路的线）：CN_WIKI_Q=句子1|句子2
    const ix = await indexer()
    const qs = (process.env.CN_WIKI_Q ?? '').split('|').filter(Boolean)
    const hits = await ix.passages(qs, 8)
    qs.forEach((q, i) => console.log(`[${q}]\n` + hits[i]!.map((h) => `  ${h.score.toFixed(3)} ${h.path} ｜ ${h.text.replace(/\s+/g, ' ').slice(0, 60)}`).join('\n')))
    ix.close()
    return
  }
  if (STEP === 'index') {
    const t = Date.now()
    const ix = await indexer()
    console.log(`[索引] 建完 ${((Date.now() - t) / 60000).toFixed(1)} 分钟，模型 ${ix.model}`)
    ix.close()
    return
  }
  if (STEP === 'run') {
    mkdirSync(join(OUT, 'prompts'), { recursive: true })
    const ix = await indexer()
    const files = mdFiles(VAULT)
    const texts = new Map(files.map((p) => [p, decodeNote(readFileSync(join(VAULT, p))).text]))
    const prefixes = (process.env.CN_WIKI_A ?? '').split(',').filter(Boolean)
    const loose = files.filter((p) => prefixes.some((x) => p.startsWith(x))).sort()
    const [, model = 'sonnet', effort = 'medium'] = (process.env.CN_JUDGE ?? 'claude:sonnet:medium').split(':')
    const asks: { a: string; cost: number; ms: number }[] = []
    const items: DreamItem[] = []
    const notes: string[] = []
    const t = Date.now()
    const { stats } = await wikiLinks({
      wt: VAULT,
      texts,
      stripped: stripShared(texts),
      loose,
      set: { ...DEFAULT_DREAM, linkMax: 1000, nightCap: 1000 },
      ask: async (system, prompt) => {
        const a = /^下面是笔记 A《(.*?)》/.exec(prompt)?.[1] ?? ''
        const r = await claude(model, effort, system, prompt)
        asks.push({ a, cost: r.cost, ms: r.ms })
        writeFileSync(join(OUT, 'prompts', `${a}.txt`), prompt + '\n\n=====回答=====\n' + r.text)
        console.log(`[问] 《${a}》 ${(r.ms / 1000).toFixed(0)} 秒 $${r.cost.toFixed(3)}`)
        return r.text
      },
      by: `Claude Code · ${model} · ${effort}`,
      line: judgeLine({ engine: 'claude', model }),
      ledgerFile: join(OUT, 'ledger.json'),
      now: new Date(),
      parallel: 4,
      vec: async (qs, k) => ({ model: ix.model!, hits: await ix.passages(qs, k) }),
      commit: async (message) => {
        execFileSync('git', ['-C', VAULT, 'commit', '-q', '-m', message])
        return execFileSync('git', ['-C', VAULT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      },
      add: (group, it) => {
        const item = { id: String(items.length + 1), group, state: 'pending', ...it } as DreamItem
        items.push(item)
        return item
      },
      notes,
    })
    ix.close()
    const links = items
      .filter((i) => i.wiki)
      .flatMap((i) => i.wiki!.links.map((l) => ({ a: i.files[0], group: i.group, clause: i.judged?.a.quote, words: l.words, to: l.path, level: l.level, anchor: l.anchor, confidence: l.confidence, why: l.why })))
    writeFileSync(join(OUT, 'links.json'), JSON.stringify({ stats, notes, links, entries: items.filter((i) => i.entry).map((i) => i.entry), aliases: items.filter((i) => i.alias).map((i) => i.alias) }, null, 1))
    const cost = asks.reduce((s, x) => s + x.cost, 0)
    writeFileSync(join(OUT, 'cost.json'), JSON.stringify({ asked: asks.length, cost, msMedian: asks.map((x) => x.ms).sort((a, b) => a - b)[asks.length >> 1] ?? 0, minutes: (Date.now() - t) / 60000, asks }, null, 1))
    console.log(`[完] ${loose.length} 篇 A，问 ${asks.length} 次，$${cost.toFixed(2)}；链 ${stats.link} 处（拿不准 ${stats.unsure}），作废 ${stats.voided}；${notes.join('；')}`)
    return
  }
  // score：人看过的对错
  const { links } = JSON.parse(readFileSync(join(OUT, 'links.json'), 'utf8')) as { links: { a: string; words: string; level: string; group: string }[] }
  const review = existsSync(join(OUT, 'review.json')) ? (JSON.parse(readFileSync(join(OUT, 'review.json'), 'utf8')) as Record<string, string>) : {}
  const by = (g: string) => links.filter((l) => l.group === g)
  for (const g of ['link', 'unsure']) {
    const ls = by(g)
    const n = (v: string) => ls.filter((l) => review[`${l.a}|${l.words}`] === v).length
    console.log(`${g}：${ls.length} 处，对 ${n('对')}、错 ${n('错')}、两可 ${n('两可')}、没看 ${ls.length - n('对') - n('错') - n('两可')}；整篇 ${ls.filter((l) => l.level === 'note').length}、这一节 ${ls.filter((l) => l.level === 'heading').length}、这一段 ${ls.filter((l) => l.level === 'block').length}`)
  }
})
