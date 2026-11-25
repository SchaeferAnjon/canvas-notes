#!/usr/bin/env node
// 名字、许可证、仓库、网址只在 release/brand.json 写一处。这个脚本把它带到各个地方：
//   node scripts/brand.mjs           改了 brand.json 之后跑：生成 apps/notes/src/shared/brand.ts、apps/apple/Brand.xcconfig，改两个 package.json，
//                                    把 FILES 里每个文件中的旧值（release/brand.lock.json 记着上次写进去的值）换成新值
//   node scripts/brand.mjs --check   只检查：生成的文件和 package.json 跟 brand.json 一致，FILES 里没有旧值、都写着现在的名字
// electron-builder.cjs 和 scripts/release.mjs 直接读 brand.json，不用生成。
// 换许可证时只换得了许可证的名字：LICENSE 全文、官网「为什么是 GPL」那条问答、THIRD_PARTY_NOTICES 里的兼容说明要手改。
// 不跟着换的内部标识（换了会丢用户数据）：库里的 .canvas-notes/ 文件夹、设置目录 ~/Library/Application Support/canvas-notes、
// 包名 @cn/notes、MCP 服务名 canvas-notes。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.CN_BRAND_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (p) => path.join(ROOT, p)

/** 写着名字、仓库、网址、许可证的文件（THIRD_PARTY_NOTICES 不在里面：那里的许可证名是别人的） */
export const FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/DEVELOPMENT.md',
  'website/index.html',
  'website/hub-entry/README.md',
  'website/hub-entry/apps-hub.patch',
  'release/CHECKLIST.md',
  'apps/notes/src/renderer/index.html',
]
/** 会被替换的字段；ASCII 的值按整词换（GPL 不会换到 LGPL、AGPL 里面去） */
const KEYS = ['name', 'nameZh', 'artifact', 'appId', 'license', 'author', 'repo', 'site']

const read = (p) => JSON.parse(fs.readFileSync(at(p), 'utf8'))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pattern = (v) => new RegExp(/^[\x20-\x7e]+$/.test(v) ? `(?<![\\w])${esc(v)}(?![\\w])` : esc(v), 'g')

function brandTs(b) {
  const pick = Object.fromEntries(['name', 'nameZh', 'appId', 'license', 'author', 'year', 'repo', 'site'].map((k) => [k, b[k]]))
  return `/** 由 scripts/brand.mjs 从 release/brand.json 生成，别手改：改 brand.json 再跑 node scripts/brand.mjs */\nexport const BRAND = ${JSON.stringify(pick, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:')} as const\n`
}

/** iPhone / iPad 版（apps/apple/project.yml 引用它）：Bundle ID 和 Mac 版同一个（同一个产品的不同平台，照 Apple 规矩共用一个），显示名、签名团队，
 *  「用 GitHub 登录」的 OAuth App Client ID（不是秘密，设备登录不要 client secret；空着时连库那一屏只有贴令牌）。Info.plist 的 CNGitHubClientID 读它 */
function appleXcconfig(b) {
  return `// 由 scripts/brand.mjs 从 release/brand.json 生成，别手改：改 brand.json 再跑 node scripts/brand.mjs\nCN_APP_ID = ${b.appId}\nCN_DISPLAY_NAME = ${b.name}\nDEVELOPMENT_TEAM = ${b.signing.team}\nCN_GITHUB_CLIENT_ID = ${b.github?.oauthClientId ?? ''}\n`
}

/** 画布订阅（apps/feeds，2026-11-25 用户定名「画布订阅 · Canvas Feeds」）：名字、Bundle ID、链接写在 brand.json 的 feeds 里，许可证、作者、年份跟画布笔记 */
function feedsBrandTs(b) {
  const f = { ...b.feeds, license: b.license, author: b.author, year: b.year, notesScheme: 'canvas-notes' }
  return `/** 由 scripts/brand.mjs 从 release/brand.json 的 feeds 生成，别手改：改 brand.json 再跑 node scripts/brand.mjs */\nexport const BRAND = ${JSON.stringify(f, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:')} as const\n`
}

function packageEdits(b) {
  return [
    ['package.json', { license: b.license }],
    ['apps/notes/package.json', { productName: b.name, license: b.license, author: b.author }],
    ...(b.feeds && fs.existsSync(at('apps/feeds/package.json')) ? [['apps/feeds/package.json', { productName: b.feeds.name, license: b.license, author: b.author }]] : []),
  ]
}

export function run({ check }) {
  const b = read('release/brand.json')
  const lockPath = at('release/brand.lock.json')
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : Object.fromEntries(KEYS.map((k) => [k, b[k]]))
  const problems = []
  const changed = []
  const write = (p, text) => {
    if (fs.readFileSync(at(p), 'utf8') === text) return
    if (check) problems.push(`${p} 跟 brand.json 不一致`)
    else {
      fs.writeFileSync(at(p), text)
      changed.push(p)
    }
  }

  const ts = 'apps/notes/src/shared/brand.ts'
  if (!fs.existsSync(at(ts))) fs.writeFileSync(at(ts), '')
  write(ts, brandTs(b))
  // 画布笔记的公开仓库里没有 iPhone / iPad 版（release/public-exclude.txt），没有就不生成
  const xc = 'apps/apple/Brand.xcconfig'
  if (fs.existsSync(at('apps/apple/project.yml'))) {
    if (!fs.existsSync(at(xc))) fs.writeFileSync(at(xc), '')
    write(xc, appleXcconfig(b))
  }
  // 画布订阅：公开仓库里没有 apps/feeds 时不生成
  const fts = 'apps/feeds/src/shared/brand.ts'
  if (b.feeds && fs.existsSync(at('apps/feeds/package.json'))) {
    if (!fs.existsSync(at(fts))) fs.writeFileSync(at(fts), '')
    write(fts, feedsBrandTs(b))
  }
  for (const [p, fields] of packageEdits(b)) {
    const pkg = read(p)
    write(p, JSON.stringify({ ...pkg, ...fields }, null, 2) + '\n')
  }

  const swaps = KEYS.filter((k) => lock[k] && lock[k] !== b[k]).map((k) => [lock[k], b[k], k])
  for (const p of FILES) {
    // 开源仓库里没有总站补丁和待执行清单（release/public-exclude.txt），少了就跳过
    if (!fs.existsSync(at(p))) continue
    let text = fs.readFileSync(at(p), 'utf8')
    for (const [from, to, k] of swaps) {
      if (check && pattern(from).test(text)) problems.push(`${p} 里还是旧的 ${k}：${from}`)
      text = text.replace(pattern(from), to)
    }
    if (!check) write(p, text)
    if (!text.includes(b.name)) problems.push(`${p} 里没有写名字 ${b.name}`)
  }
  if (check && swaps.length) problems.push(`brand.json 改过还没同步（${swaps.map((s) => s[2]).join('、')}）：跑 node scripts/brand.mjs`)
  if (!check) fs.writeFileSync(lockPath, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, b[k]])), null, 2) + '\n')
  return { problems, changed }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const check = process.argv.includes('--check')
  const { problems, changed } = run({ check })
  if (problems.length) {
    console.error(problems.map((p) => `  ${p}`).join('\n'))
    process.exit(1)
  }
  console.log(check ? '名字、许可证、仓库、网址都和 release/brand.json 一致' : changed.length ? `改了：${changed.join('、')}` : '都已经是 brand.json 里的值')
}
