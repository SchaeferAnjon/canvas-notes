// 没装命令行时要动手的 AI 对话交给软件自带的 OpenCode（MIT，task-587os 设计页第 6 节）：下载 npm 上 opencode 的 macOS 单文件版
// （opencode-darwin-arm64 / opencode-darwin-x64 包里的 bin/opencode），放到 apps/notes/resources/opencode/darwin-<架构>/opencode（不进 git），
// 打包时 extraResources 带进安装包的 Resources/opencode/。钉死版本和 npm 给的 sha512（换版本改这里，先跑一遍 engine-check 的自查）；
// 已经下好且校验对的不再下。软件里 main/agent/sources.ts 的 bundledOpencode 找它。
//   node apps/notes/scripts/fetch-opencode.mjs           这台 Mac 的架构
//   node apps/notes/scripts/fetch-opencode.mjs --all     arm64 和 x64 两份（发版）
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '1.19.3'
const PKG = {
  arm64: { name: 'opencode-darwin-arm64', integrity: 'sha512-NmDF28jD8W7m9a/k4mc3rajEWftDemGecrzBJItzTWwN0Eu5WFSEFBocvmmasUr4nh8ei9Zl1pwRvv66R4dN6A==' },
  x64: { name: 'opencode-darwin-x64', integrity: 'sha512-z9uxw1QZ+0CcweMQnrh8s/VXXr+UhqxwUh+vYEcwicETBOxwNSLFqFFE598s0ComYEoM1bXDul1e83AG7m143A==' },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'opencode')
const sri = (buf) => `sha512-${createHash('sha512').update(buf).digest('base64')}`

async function fetchOne(arch) {
  const p = PKG[arch]
  const out = join(root, `darwin-${arch}`, 'opencode')
  const stamp = out + '.version'
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8') === `${VERSION} ${p.integrity}`) {
    console.log(`OpenCode ${VERSION}（${arch}）在 ${out}`)
    return
  }
  const url = `https://registry.npmjs.org/${p.name}/-/${p.name}-${VERSION}.tgz`
  process.stdout.write(`下载 OpenCode ${VERSION}（${arch}）… `)
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`${url} 回了 ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sri(buf) !== p.integrity) throw new Error(`${p.name} ${VERSION} 的 sha512 不对：${sri(buf)}`)
  const tmp = mkdtempSync(join(tmpdir(), 'cn-opencode-'))
  try {
    writeFileSync(join(tmp, 'pkg.tgz'), buf)
    execFileSync('tar', ['-xzf', join(tmp, 'pkg.tgz'), '-C', tmp, 'package/bin/opencode'])
    mkdirSync(dirname(out), { recursive: true })
    renameSync(join(tmp, 'package/bin/opencode'), out)
    chmodSync(out, 0o755)
    writeFileSync(stamp, `${VERSION} ${p.integrity}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`好了：${out}`)
}

const archs = process.argv.includes('--all') ? ['arm64', 'x64'] : [process.arch === 'x64' ? 'x64' : 'arm64']
for (const a of archs) await fetchOne(a)
