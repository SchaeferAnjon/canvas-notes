#!/usr/bin/env node
// 发一个新版本到 GitHub Release（照 MeetCaption 的 scripts/release.mjs）。名字、仓库、签名证书读 release/brand.json。
//   1. 改 apps/notes/package.json 的 version，提交，打 tag v<版本>
//   2. node scripts/release.mjs：本机打 Mac 的 dmg + zip（arm64 和 x64），用钥匙串里的 Developer ID 签名、hardened runtime，
//      核对签名、团队，放在 apps/notes/release/<版本>/，记下核对过的文件和 SHA-256。要求工作区干净、HEAD 上有 v<版本>。
//      默认不公证（2026-11-15 用户定，和 MeetCaption 一样）：用户第一次打开时在访达里右键「打开」，README 和官网写了怎么做
//      --notarize：再用钥匙串里 notarytool 的 profile 公证（app 由 electron-builder 公证并钉上票据，dmg 另外公证、钉票据）
//      --try：本机试打包，不管工作区干不干净、有没有 tag（这样的包不能 --publish）
//      --arch=arm64：只打一种架构
//   3. 发布说明写在 apps/notes/release/<版本>/notes.md（release/ 不进 git），看过没问题：
//      node scripts/release.mjs --publish：推送 tag 后，上传第 2 步核对过的那一份，建 Release（不是草稿）
// 要公证时凭据不进仓库：先跑一次 xcrun notarytool store-credentials <profile> --apple-id <开发者账号> --team-id <团队>，
// profile 名默认 canvas-notes-notary，用环境变量 CN_NOTARY_PROFILE 换。
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(ROOT, 'apps/notes')
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'release/brand.json'), 'utf8'))
const { team } = brand.signing
const args = process.argv.slice(2)
const publish = args.includes('--publish')
const notarize = args.includes('--notarize')
const trial = args.includes('--try')
const archArg = args.find((a) => a.startsWith('--arch='))?.slice(7)
const ARCHS = archArg ? archArg.split(',') : ['arm64', 'x64']
const profile = process.env[brand.signing.notaryProfileEnv] || brand.signing.notaryProfileDefault
const { version } = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'))
const tag = `v${version}`
const out = path.join(APP_DIR, 'release', version)
const notes = path.join(out, 'notes.md')
const checked = path.join(out, 'checked.json')

// stdio: 'inherit' 时 execFileSync 返回 null
const run = (cmd, argv, opts = {}) => (execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', ...opts }) ?? '').trim()
const fail = (msg) => {
  console.error(`没发：${msg}`)
  process.exit(1)
}
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

for (const a of ARCHS) if (!['arm64', 'x64'].includes(a)) fail(`不认识的架构 ${a}`)
for (const a of args) if (!['--publish', '--notarize', '--try'].includes(a) && !a.startsWith('--arch=')) fail(`不认识的参数 ${a}（--no-notarize 已经不用了：默认就不公证，本机试打包用 --try）`)
const head = run('git', ['rev-parse', 'HEAD'])

if (publish) {
  // 代码和 tag 对得上：tag 已经推上去、指着 HEAD，GitHub 上还没有这个 Release；只上传第 2 步核对过的那一份
  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`, `refs/tags/${tag}`])
  if (!remoteTag) fail(`GitHub 上还没有 ${tag}：先 git push origin ${tag}`)
  const tagCommit = remoteTag.split('\n').find((l) => l.endsWith('^{}'))?.split(/\s/)[0] ?? remoteTag.split(/\s/)[0]
  if (tagCommit !== head) fail(`${tag} 指的是 ${tagCommit.slice(0, 7)}，本机 HEAD 是 ${head.slice(0, 7)}`)
  if (spawnSync('gh', ['release', 'view', tag, '--repo', brand.repo]).status === 0) fail(`GitHub 上已经有 ${tag} 的 Release`)
  const prev = fs.existsSync(checked) ? JSON.parse(fs.readFileSync(checked, 'utf8')) : null
  if (prev?.head !== head) fail(`${out} 不是这个提交核对过的：先跑 node scripts/release.mjs`)
  if (prev.trial) fail('核对过的那一份是试打包（--try 打的）：去掉 --try 重打')
  if (!fs.existsSync(notes)) fail(`还没写发布说明：${notes}`)
  const files = prev.files.map((f) => path.join(out, f))
  for (const f of files) if (!fs.existsSync(f)) fail(`核对过的文件不见了：${f}`)
  run('gh', ['release', 'create', tag, '--repo', brand.repo, '--verify-tag', '--title', `${brand.name} ${version}`, '--notes-file', notes, ...files], { stdio: 'inherit' })
  console.log(`已发布 ${tag}：https://github.com/${brand.repo}/releases/tag/${tag}`)
  process.exit(0)
}

// 正式打包要在干净的、打了 tag 的提交上；试打包（--try）不管这些
if (!trial) {
  if (run('git', ['status', '--porcelain'])) fail('工作区有没提交的改动')
  const tagged = spawnSync('git', ['rev-parse', `${tag}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  if (tagged !== head) fail(`HEAD 上没有 ${tag}：先 git tag ${tag}`)
}
if (notarize) {
  if (spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', profile], { stdio: 'ignore' }).status !== 0)
    fail(`钥匙串里没有能用的 notarytool profile「${profile}」：先 xcrun notarytool store-credentials ${profile} --apple-id <开发者账号> --team-id ${team}`)
}

// 写好的发布说明留着，其余重新来
const keptNotes = fs.existsSync(notes) ? fs.readFileSync(notes) : null
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
if (keptNotes) fs.writeFileSync(notes, keptNotes)

console.log('构建…')
run('npx', ['electron-vite', 'build'], { cwd: APP_DIR, stdio: 'inherit' })
// 签不上 Developer ID 时 electron-builder 默认只打一条警告、照样出包：强制签名，签不上就失败
console.log(`打 Mac 包（Developer ID 签名${notarize ? '、公证' : '，不公证'}，${ARCHS.join(' + ')}，dmg + zip）…`)
const mac = spawnSync(
  'npx',
  ['electron-builder', '--mac', ...ARCHS.map((a) => `--${a}`), '--config', 'electron-builder.cjs', '--publish', 'never', '-c.forceCodeSigning=true'],
  {
    cwd: APP_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      CN_RELEASE: '1',
      CN_NOTARIZE: notarize ? '1' : '0',
      CN_RELEASE_OUT: path.join(out, 'mac'),
      ...(notarize ? { APPLE_KEYCHAIN_PROFILE: profile } : {}),
    },
  },
)
if (mac.status !== 0) fail('Mac 包没打成')

// 每个架构的 .app：Developer ID、团队对、hardened runtime、带上 entitlements，公证过的要有票据
const report = []
for (const arch of ARCHS) {
  const dir = path.join(out, 'mac', arch === 'x64' ? 'mac' : `mac-${arch}`)
  const app = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.app'))
  if (!app) fail(`没找到 ${arch} 的 .app（${dir}）`)
  const p = path.join(dir, app)
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', p], { encoding: 'utf8' })
  if (verify.status !== 0) fail(`${arch} 的签名校验没过：\n${verify.stderr}`)
  const info = spawnSync('codesign', ['-dvv', p], { encoding: 'utf8' }).stderr
  if (!/Authority=Developer ID Application:/.test(info) || !info.includes(`TeamIdentifier=${team}`)) fail(`${arch} 不是团队 ${team} 的 Developer ID 签的`)
  if (!/flags=0x10000\(runtime\)/.test(info)) fail(`${arch} 没开 hardened runtime`)
  const ent = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', p], { encoding: 'utf8' }).stdout
  if (!ent.includes('com.apple.security.cs.allow-jit')) fail(`${arch} 的 entitlements 没带上`)
  if (notarize && spawnSync('xcrun', ['stapler', 'validate', p]).status !== 0) fail(`${arch} 的 .app 没钉上公证票据`)
  const spctl = spawnSync('spctl', ['-a', '-vv', '-t', 'exec', p], { encoding: 'utf8' })
  report.push(`${arch}: ${info.match(/Authority=Developer ID Application:[^\n]*/)[0]}，hardened runtime，Gatekeeper：${(spctl.stderr || spctl.stdout).trim().split('\n').slice(1).join(' ') || spctl.status}`)
  if (notarize && spctl.status !== 0) fail(`${arch} 过不了 Gatekeeper：${spctl.stderr}`)
}

const files = []
const need = (re, label) => {
  const dir = path.join(out, 'mac')
  const hit = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f))
  if (hit.length < ARCHS.length) fail(`少了${label}（${dir}）`)
  files.push(...hit)
  return hit
}
const archRe = `(${ARCHS.join('|')})`
const dmgs = need(new RegExp(`^${brand.artifact}-${version}-mac-${archRe}\\.dmg$`), ' dmg')
need(new RegExp(`^${brand.artifact}-${version}-mac-${archRe}\\.zip$`), ' zip')

// dmg 本身也公证、钉票据：下载后双击打开时 Gatekeeper 不再联网查
if (notarize) {
  for (const d of dmgs) {
    console.log(`公证 ${path.basename(d)}…`)
    run('xcrun', ['notarytool', 'submit', d, '--keychain-profile', profile, '--wait'], { stdio: 'inherit' })
    run('xcrun', ['stapler', 'staple', d], { stdio: 'inherit' })
  }
}

// 不带版本号的拷贝：README 和官网链到 releases/latest/download/<文件名>，点一下就开始下载
for (const f of dmgs) {
  const stable = path.join(out, path.basename(f).replace(`-${version}`, ''))
  fs.copyFileSync(f, stable)
  files.push(stable)
}
const sums = files.map((f) => `${sha256(f)}  ${path.basename(f)}`)
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
files.push(path.join(out, 'SHA256SUMS.txt'))
fs.writeFileSync(checked, JSON.stringify({ head, version, notarized: notarize, trial, archs: ARCHS, files: files.map((f) => path.relative(out, f)), report }, null, 1))

console.log(`\n${report.join('\n')}`)
console.log(`\n${tag} 要上传的文件（${out}）：`)
for (const f of files) console.log(`  ${path.relative(out, f)}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`)
console.log(
  trial
    ? `\n试打包（--try）${notarize ? '' : '，没公证'}：这一份只能本机试，不能 --publish`
    : `\n核对过了${notarize ? '' : '（没公证）'}，还没上传。发布说明写在 ${notes}，推送 tag 后：node scripts/release.mjs --publish`,
)
