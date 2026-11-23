// 梦游补双链的真库评测（task-h7oy8）。只读你的库，样本、标注、AI 回答、分数都写进本机的 out 目录，不进仓库。
//   pnpm eval:dream-real <库路径> sample  [--embed <ONNX 模型目录或向量接口地址>] [--n 150] [--dev 30] [--seed 7] [--exclude <前一批的 queries.json>]
//   pnpm eval:dream-real <库路径> label   [--label-engine claude:opus:high]
//   pnpm eval:dream-real <库路径> judge   --judge claude:haiku:low,claude:sonnet:medium,openai:<模型>@http://127.0.0.1:20111#nothink [--split dev|test|all] [--limit N]
//   pnpm eval:dream-real <库路径> score   [--judge …] [--split test] [--version v1]
//   pnpm eval:dream-real <库路径> show    [--split q012]   看一题原样发给 AI 的提示词
// 共同的：--out <目录>（默认 ~/Library/Application Support/canvas-notes/dream-eval/<库的指纹>/）
// 找候选的向量默认用软件自带的 multilingual-e5-small；梦游方案定的 bge-m3 用 --embed 指到 Xenova/bge-m3 下好的目录
// （hf download Xenova/bge-m3 onnx/model_quantized.onnx tokenizer.json tokenizer_config.json config.json）。
// 判法走 Claude Code 命令行时，环境里有 ANTHROPIC_API_KEY 就走 API 额度，没有就走订阅；本机模型给 OpenAI 兼容接口的地址。
// 人核过的标注写在 out 目录的 review.json：{"<题号>|<候选路径>": {"label": "link" | "maybe" | "no", "note": "为什么"}}，label 一步会合进 labels.json。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const args = process.argv.slice(2)
const vault = args.find((a) => !a.startsWith('--'))
if (!vault) {
  console.error('用法：pnpm eval:dream-real <库路径> [sample|label|judge|score] [选项]')
  process.exit(2)
}
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const step = pos[1] ?? 'score'
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const root = realpathSync(resolve(vault))
const fp = createHash('sha1').update(root).digest('hex').slice(0, 12)
const out = resolve(opt('out') ?? join(homedir(), 'Library/Application Support/canvas-notes/dream-eval', fp))
const env = {
  ...process.env,
  CN_REAL_VAULT: root,
  CN_REAL_OUT: out,
  CN_REAL_STEP: step,
  CN_EMBED_DIR: /^https?:/.test(opt('embed') ?? '') ? opt('embed') : resolve(opt('embed') ?? join(repo, 'apps/notes/resources/models/multilingual-e5-small')),
}
for (const [flag, key] of [
  ['n', 'CN_REAL_N'],
  ['dev', 'CN_REAL_DEV'],
  ['seed', 'CN_REAL_SEED'],
  ['judge', 'CN_JUDGE'],
  ['label-engine', 'CN_LABEL_ENGINE'],
  ['split', 'CN_REAL_SPLIT'],
  ['version', 'CN_JUDGE_VERSION'],
  ['exclude', 'CN_REAL_EXCLUDE'],
  ['limit', 'CN_REAL_LIMIT'],
]) {
  const v = opt(flag)
  if (v) env[key] = v
}
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'apps/notes/eval/vitest.config.mts', '--silent=false', 'dream-real'], { cwd: repo, env, stdio: 'inherit' })
process.exit(r.status ?? 1)
