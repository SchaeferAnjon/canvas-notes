#!/usr/bin/env node
// 开源仓库的第一个提交：把 HEAD 的文件（git archive，只有提交过的）导出到一个新文件夹，去掉 release/public-exclude.txt 里的路径，
// 再扫一遍有没有密钥、邮箱、本机路径、AI 工具签名。照 MeetCaption：公开仓库只有一个初始提交，完整历史留在私有仓库。
//   node scripts/public-export.mjs <新文件夹>      导出并检查（文件夹要不存在或是空的）
//   node scripts/public-export.mjs --check <文件夹>  只检查一个已有的导出
// 不建仓库、不推送：之后的命令在 release/CHECKLIST.md。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** public-exclude.txt：前缀匹配，! 开头的是例外（保留） */
export function excluder(text) {
  const rules = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const drop = rules.filter((r) => !r.startsWith('!'))
  const keep = rules.filter((r) => r.startsWith('!')).map((r) => r.slice(1))
  return (rel) => drop.some((d) => rel === d || rel.startsWith(d.endsWith('/') ? d : d + '/')) && !keep.some((k) => rel === k || rel.startsWith(k))
}

/** 不该出现在公开仓库里的东西；每条是 [说明, 正则, 不查的文件]（锁文件里是依赖包作者公开的邮箱） */
export const LEAKS = [
  ['API 密钥', /\b(sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|gho_\w{20,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|xox[baprs]-[\w-]{10,}|sk_live_\w+|whsec_\w+)/],
  ['私钥', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // 一两个字母的用户名（/Users/me/、/Users/a/）是测试里编的路径
  ['本机用户目录', /\/Users\/(?!runner\b)(?![a-z]{1,2}\/)[a-z][\w-]*\//],
  ['邮箱', /(?<![\w.+-])(?!git@)[\w.+-]+@(?!example\.com|users\.noreply\.github\.com|anthropic\.com\b)[\w-]+\.(com|net|org|cn|io|me|de)\b/, /^pnpm-lock\.yaml$/],
  ['AI 工具签名', /Co-Authored-By: Claude|Generated with \[Claude Code\]/],
]
const TEXT = /\.(md|ts|tsx|js|mjs|cjs|json|yml|yaml|html|css|txt|plist|svg|py)$|^[^.]+$/

/** 一个文件里 import 的东西（同画布今日导出脚本的写法）：相对路径和包名 */
function importsOf(code) {
  const out = []
  const re = /(?:^|[^\w.])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)/g
  for (let m; (m = re.exec(code)); ) out.push(m[1] ?? m[2])
  return out
}

function resolveRel(dir, from, spec) {
  const base = path.join(path.dirname(path.join(dir, from)), spec.replace(/\?.*$/, ''))
  for (const ext of ['', '.ts', '.tsx', '.mjs', '.js', '.json', '/index.ts', '/index.tsx']) {
    const p = base + ext
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(dir, p)
  }
  return null
}

/** 一个软件（start 是相对 dir 的文件夹）要的共用包的文件夹：package.json 里 workspace: 的，连同这些包自己 workspace: 的。
 *  三份公开导出（这里、画布今日、ParaRead）都拿它核对导出里带全了没有 */
export function workspaceDeps(dir, start) {
  const byName = new Map()
  for (const d of fs.readdirSync(path.join(dir, 'packages'))) {
    const f = path.join(dir, 'packages', d, 'package.json')
    if (fs.existsSync(f)) byName.set(JSON.parse(fs.readFileSync(f, 'utf8')).name, `packages/${d}`)
  }
  const found = new Set()
  const queue = [start]
  while (queue.length) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, queue.shift(), 'package.json'), 'utf8'))
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      if (!String(v).startsWith('workspace:')) continue
      const d = byName.get(name)
      if (!d) throw new Error(`${start} 要的 ${name} 在 packages/ 下找不到`)
      if (!found.has(d)) found.add(d), queue.push(d)
    }
  }
  return [...found].sort()
}

/** rules 默认是上面的 LEAKS；画布今日的导出（apps/today/scripts/public-export.mjs）另加几条 */
export function scan(dir, rules = LEAKS) {
  const found = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const rel = path.relative(dir, p)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (e.name !== '.git' && e.name !== 'node_modules') walk(p)
        continue
      }
      if (!TEXT.test(e.name) || rel === 'scripts/public-export.mjs') continue
      const lines = fs.readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const [what, re, skip] of rules) if (!skip?.test(rel) && re.test(line)) found.push(`${rel}:${i + 1} ${what}：${line.trim().slice(0, 120)}`)
      })
    }
  }
  walk(dir)
  return found
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const checkOnly = args[0] === '--check'
  const dest = path.resolve(checkOnly ? args[1] : args[0] || '')
  if (!args.length || (checkOnly && !args[1])) {
    console.error('用法：node scripts/public-export.mjs <新文件夹>  或  --check <文件夹>')
    process.exit(2)
  }
  if (!checkOnly) {
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
      console.error(`${dest} 不是空的`)
      process.exit(1)
    }
    fs.mkdirSync(dest, { recursive: true })
    const tar = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: ROOT, maxBuffer: 1 << 30 })
    execFileSync('tar', ['-x', '-C', dest], { input: tar })
    const out = excluder(fs.readFileSync(path.join(ROOT, 'release/public-exclude.txt'), 'utf8'))
    const missing = workspaceDeps(dest, 'apps/notes').filter((d) => out(d + '/package.json'))
    if (missing.length) throw new Error(`画布笔记要的共用包被 release/public-exclude.txt 排除了：${missing.join('、')}`)
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    // 画布笔记 import 了排除掉的画布今日的几份源码（日历用它的提醒事项小助手和排时间，task-kzr3n）：照画布今日借画布笔记文件的做法，
    // 顺着 import 找出来原样留着（路径不变），apps/today/package.json 现生成、只写这几份 import 的包
    const kept = (f) => !out(f) || borrowed.has(f)
    const borrowed = new Set()
    const bare = new Set()
    const queue = files.filter((f) => !out(f) && /\.(ts|tsx|mjs|js|cjs)$/.test(f))
    const seen = new Set(queue)
    while (queue.length) {
      const f = queue.shift()
      for (const spec of importsOf(fs.readFileSync(path.join(dest, f), 'utf8'))) {
        if (!spec.startsWith('.')) {
          if (borrowed.has(f) && !spec.startsWith('node:')) bare.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'))
          continue
        }
        const rel = resolveRel(dest, f, spec)
        if (!rel || kept(rel)) continue
        if (!rel.startsWith('apps/today/src/')) throw new Error(`${f} import 了不公开的 ${rel}`)
        borrowed.add(rel)
        if (!seen.has(rel)) {
          seen.add(rel)
          queue.push(rel)
        }
      }
    }
    let dropped = 0
    for (const f of files) {
      if (!out(f) || borrowed.has(f)) continue
      fs.rmSync(path.join(dest, f), { force: true })
      dropped++
    }
    // 删空了的文件夹
    const prune = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name))
      if (d !== dest && !fs.readdirSync(d).length) fs.rmdirSync(d)
    }
    prune(dest)
    // 排除掉的软件（画布今日、iPhone / iPad 版）：根目录 package.json 的 typecheck 不再编它们，锁文件去掉它们用的包（版本不变）
    const rootPkg = path.join(dest, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(rootPkg, 'utf8'))
    pkg.scripts.typecheck = pkg.scripts.typecheck
      .split(' && ')
      .filter((c) => !/^tsc -p /.test(c) || fs.existsSync(path.join(dest, c.slice('tsc -p '.length), 'tsconfig.json')))
      .join(' && ')
    fs.writeFileSync(rootPkg, JSON.stringify(pkg, null, 2) + '\n')
    if (borrowed.size) {
      const todayPkg = JSON.parse(execFileSync('git', ['show', 'HEAD:apps/today/package.json'], { cwd: ROOT, encoding: 'utf8' }))
      const spec = (n) => todayPkg.dependencies?.[n] ?? todayPkg.devDependencies?.[n] ?? (() => { throw new Error(`画布今日的 package.json 里没有 ${n}`) })()
      const brand = JSON.parse(fs.readFileSync(path.join(dest, 'release/brand.json'), 'utf8'))
      fs.writeFileSync(
        path.join(dest, 'apps/today/package.json'),
        JSON.stringify({ name: '@cn/today-borrowed', private: true, description: `${brand.name} 借用的 Canvas Today 文件，路径和 SchaeferAnjon/canvas-today 里一样`, license: brand.license, dependencies: Object.fromEntries([...bare].sort().map((n) => [n, spec(n)])) }, null, 2) + '\n',
      )
      fs.writeFileSync(
        path.join(dest, 'apps/today/README.md'),
        ['# 借用的 Canvas Today 文件', '', '画布笔记的日历用画布今日的提醒事项小助手读系统日历、用它的规矩排空着的时间，下面这些文件原样拷自 [SchaeferAnjon/canvas-today](https://github.com/SchaeferAnjon/canvas-today) 的同一路径（导出时顺着 import 自动找出来的）。要改请去那边改，这里在下一次导出时会被换掉。', '', ...[...borrowed].sort().map((f) => `- \`${f}\``), ''].join('\n'),
      )
      console.log(`借用画布今日的 ${borrowed.size} 个文件：${[...borrowed].sort().join('、')}`)
    }
    console.log('pnpm install --lockfile-only：去掉锁文件里排除掉的软件用的包…')
    execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: dest, stdio: 'inherit', timeout: 600_000 })
    console.log(`导出 ${files.length - dropped} 个文件到 ${dest}（去掉 ${dropped} 个，见 release/public-exclude.txt）`)
  }
  const found = scan(dest)
  if (found.length) {
    console.error(`有 ${found.length} 处不该公开的：\n${found.map((f) => '  ' + f).join('\n')}`)
    process.exit(1)
  }
  console.log('没扫到密钥、私人邮箱、本机路径和 AI 工具签名')
}
