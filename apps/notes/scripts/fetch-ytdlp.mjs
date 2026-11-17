// 没字幕的视频生成字幕（CN-69）要下载音频：内置 yt-dlp（Unlicense，公有领域，和 GPL 一起发没问题）的 macOS 单文件版，
// 下载到 apps/notes/resources/bin/yt-dlp（不进 git），打包时 extraResources 带进安装包的 Resources/bin/。
// 钉死版本和 sha256（官方 Release 的 SHA2-256SUMS 里那一行）；换版本改这里两行。已经下好且校验对的不再下。
//   node apps/notes/scripts/fetch-ytdlp.mjs
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const VERSION = '2026.10.26'
const SHA256 = '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin', 'yt-dlp')

const sha256 = (p) =>
  new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })

if (existsSync(out) && (await sha256(out)) === SHA256) {
  console.log(`yt-dlp ${VERSION} 在 ${out}`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp_macos`
  process.stdout.write(`下载 yt-dlp ${VERSION} … `)
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`${url} 回了 ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out + '.part'))
  const got = await sha256(out + '.part')
  if (got !== SHA256) {
    rmSync(out + '.part')
    throw new Error(`yt-dlp 的 sha256 不对：${got}`)
  }
  renameSync(out + '.part', out)
  chmodSync(out, 0o755)
  console.log(`好了：${out}`)
}
