// 安装包自带的 git（2026-11-26 用户选「带上」）：没装苹果命令行工具的 Mac 上，系统的 /usr/bin/git 只是个壳，
// 每调一次苹果就弹「安装命令行开发者工具」，软件又一直在调 git（0.5.13 朋友首开 CPU 占满就是这个）。
// 用 GitHub 给 Electron 软件打的 dugite-native（GitHub Desktop 用的同一份，只连系统自带的库：libcurl、zlib、iconv，
// https 证书走 macOS 自己的），从它官方 Release 下 macOS 版，按 sha256 核对，只留软件用得着的，放到
// apps/notes/resources/git/darwin-<架构>/（不进 git），打包时 extraResources 带进安装包的 Resources/git/。
// 去掉的：Git Credential Manager（.NET，约 130 MB）、git-lfs（画布笔记不调它）、服务器端和发邮件的程序、scalar、命令补全。
// git 按 GPL-2.0 授权，同目录放它的 COPYING（git 官方仓库同一个 tag 的，也按 sha256 核对）和 SOURCE.txt（源码在哪）。
// 换版本改 VERSION、BUILD、SHA256（Release 里每个包旁边的 .sha256）、COPYING_SHA256 四处。已经下好且对得上的不再下。
// 软件里 main/bundled-git.ts 找它，@cn/git 的 useBundledGit 用它。
//   node apps/notes/scripts/fetch-git.mjs           这台 Mac 的架构
//   node apps/notes/scripts/fetch-git.mjs --all     arm64 和 x64 两份（发版）
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '2.56.1'
const BUILD = '238326e'
const SHA256 = {
  arm64: 'a882ec6882416b57d212a22bac845ae27944f96cf73453a864f6a12c17863a79',
  x64: '3fdb0c2f102fe0273d64b5d5fb77315c19f2b4648a154593723cb9ed98f2bc7d',
}
const COPYING_URL = `https://raw.githubusercontent.com/git/git/v${VERSION}/COPYING`
const COPYING_SHA256 = '5b2198d1645f767585e8a88ac0499b04472164c0d2da22e75ecf97ef443ab32e'

/** libexec/git-core 里不要的（其余以 git 开头的、mergetools/ 都留着；内置命令的 git-<命令> 是指向 git 的链接，本地 file:// 同步要用 git-upload-pack 这类） */
const DROP = new Set(['git-lfs', 'git-daemon', 'git-http-backend', 'git-shell', 'git-imap-send', 'git-http-push', 'git-http-fetch'])
const dropped = (name) => DROP.has(name) || name.startsWith('git-credential-manager')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'git')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`${url} 回了 ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function fetchOne(arch) {
  const out = join(root, `darwin-${arch}`)
  const stamp = join(out, 'VERSION')
  const want = `dugite-native ${VERSION}-${BUILD} ${SHA256[arch]}\n`
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === want) {
    console.log(`git ${VERSION}（${arch}）在 ${out}`)
    return
  }
  const name = `dugite-native-v${VERSION}-${BUILD}-macOS-${arch}.tar.gz`
  const url = `https://github.com/desktop/dugite-native/releases/download/v${VERSION}/${name}`
  process.stdout.write(`下载 git ${VERSION}（${arch}）… `)
  const [buf, copying] = await Promise.all([get(url), get(COPYING_URL)])
  if (sha256(buf) !== SHA256[arch]) throw new Error(`${name} 的 sha256 不对：${sha256(buf)}`)
  if (sha256(copying) !== COPYING_SHA256) throw new Error(`git 的 COPYING 的 sha256 不对：${sha256(copying)}`)
  const tmp = mkdtempSync(join(tmpdir(), 'cn-git-'))
  try {
    writeFileSync(join(tmp, 'pkg.tgz'), buf)
    const x = join(tmp, 'x')
    mkdirSync(x)
    execFileSync('tar', ['-xzf', join(tmp, 'pkg.tgz'), '-C', x, 'libexec/git-core', 'share/git-core/templates'])
    const core = join(x, 'libexec', 'git-core')
    for (const n of readdirSync(core)) if (!(n.startsWith('git') || n === 'mergetools') || dropped(n)) rmSync(join(core, n), { recursive: true })
    // 留下的链接都要指向留下的文件（git-remote-https → git-remote-http、git-add → git）
    for (const n of readdirSync(core)) {
      const p = join(core, n)
      if (lstatSync(p).isSymbolicLink() && !existsSync(join(core, readlinkSync(p)))) throw new Error(`${n} 指向的 ${readlinkSync(p)} 被去掉了`)
    }
    const lipo = execFileSync('lipo', ['-archs', join(core, 'git')], { encoding: 'utf8' }).trim()
    if (lipo !== (arch === 'x64' ? 'x86_64' : 'arm64')) throw new Error(`${name} 里的 git 是 ${lipo} 的`)
    writeFileSync(join(x, 'COPYING'), copying)
    writeFileSync(
      join(x, 'SOURCE.txt'),
      `Git ${VERSION}, GPL-2.0 (see COPYING).\n` +
        `Binary from dugite-native v${VERSION} (${name}, sha256 ${SHA256[arch]}): https://github.com/desktop/dugite-native/releases/tag/v${VERSION}\n` +
        `Git source: https://github.com/git/git/tree/v${VERSION}  Build scripts: https://github.com/desktop/dugite-native/tree/v${VERSION}\n` +
        `Removed from the release: Git Credential Manager, git-lfs, scalar, ${[...DROP].filter((n) => n !== 'git-lfs').join(', ')}.\n`,
    )
    writeFileSync(join(x, 'VERSION'), want)
    rmSync(out, { recursive: true, force: true })
    mkdirSync(dirname(out), { recursive: true })
    renameSync(x, out)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`好了：${out}`)
}

const archs = process.argv.includes('--all') ? ['arm64', 'x64'] : [process.arch === 'x64' ? 'x64' : 'arm64']
for (const a of archs) await fetchOne(a)
