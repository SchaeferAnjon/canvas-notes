// 把用户自己的开源插件 BookmarkKeeper（MIT，github.com/SchaeferAnjon/bookmark）的网页部分拷进 resources/bookmarkkeeper/，
// 随包带上：别的电脑上没装这个插件、也没有它的源码时，新网页标签照样能显示它的新标签页。
// 只拷新标签页、整理书签、设置页要的文件，不拷后台脚本、弹窗和 Mac App。拷来的文件一个字不改。
//
//   node apps/notes/scripts/vendor-bookmarkkeeper.mjs [插件源码目录]
//
// 不给目录时用环境变量 BOOKMARKKEEPER_SRC，再没有用 ~/Documents/Projects/bookmark。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(process.argv[2] || process.env.BOOKMARKKEEPER_SRC || join(homedir(), 'Documents/Projects/bookmark'))
const dest = join(here, '../resources/bookmarkkeeper')
const PARTS = ['manifest.json', 'LICENSE', 'newtab', 'shared', 'manager', 'options', 'icons']

if (!existsSync(join(src, 'manifest.json'))) {
  console.error(`没找到 BookmarkKeeper 的源码：${src}`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'))
if (!String(manifest.name).includes('BookmarkKeeper')) {
  console.error(`${src} 不是 BookmarkKeeper（manifest 的名字是 ${manifest.name}）`)
  process.exit(1)
}

let commit = ''
try {
  commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 }).trim()
  if (execFileSync('git', ['-C', src, 'status', '--porcelain', '--', ...PARTS], { encoding: 'utf8', timeout: 10_000 }).trim()) commit += '（有没提交的改动）'
} catch {
  // 不是 git 仓库（比如下载的 zip）：只记版本号
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const p of PARTS) cpSync(join(src, p), join(dest, p), { recursive: true })
writeFileSync(join(dest, 'SOURCE.json'), JSON.stringify({ version: manifest.version, commit, from: 'https://github.com/SchaeferAnjon/bookmark' }, null, 2) + '\n')
console.log(`拷好了 BookmarkKeeper ${manifest.version}${commit ? ` (${commit.slice(0, 7)})` : ''} → ${dest}`)
