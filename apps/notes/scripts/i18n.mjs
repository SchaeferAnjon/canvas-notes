#!/usr/bin/env node
// 界面文字的中文表（task-zojmg）：扫代码里 t() / tv() / tIn() 的原句和登记的数据表，写进 src/shared/i18n/zh.ts。
//   node apps/notes/scripts/i18n.mjs            加了、改了句子之后跑：重写 zh.ts（英文表 src/shared/i18n/en/ 手改）
//   node apps/notes/scripts/i18n.mjs --check    只检查 zh.ts 是不是最新的（单元测试也查）
//   node apps/notes/scripts/i18n.mjs --strays   抽完的文件（DONE）里还有没包 t() 的中文吗
//   node apps/notes/scripts/i18n.mjs --todo <文件…>  列出这几个文件里带中文的字（抽下一批时用）
//   node apps/notes/scripts/i18n.mjs --missing [renderer/settings …]  中文表里有、英文表还没有的（可按头一次出现的文件筛）
//
// 不算「漏抽」的中文：console 里的、正则、TS 类型里的、import、对象的键、kw（搜索用的别名，中英都认）、
// 这一行或上一行注释里写着「不翻」的（写进文件的格式、给 AI 的提示词、和磁盘上的名字比的）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(APP, 'src')
export const ZH_FILE = join(SRC, 'shared', 'i18n', 'zh.ts')

const HAN = /\p{Script=Han}/u
/** 句子里不该有的全角标点、中文：模板里挨着译好的字时就是在拼句子 */
const CJK_OR_WORD = /[\p{Script=Han}　-〿！-｠A-Za-z]/u
/** 取字的函数：t（界面语言）、tNow（组件里要「说的那一刻」的语言时，全局的 t 换个名字引进来）、tv（库语言）、tIn（指定语言，第二个参数是键） */
const CALLS = { t: 0, tNow: 0, tv: 0, tIn: 1 }

/**
 * 抽完的文件（按批加）：这些文件里中文只能在 t() 里，或者在标了「不翻」的地方。路径相对 apps/notes/src
 */
export const DONE = [
  // 第一批（task-zojmg）：底座、语言设置、速记小窗和菜单栏图标、检查更新、日期
  'main/lang.ts',
  'main/quick.ts',
  'preload/lang.ts',
  'renderer/i18n.ts',
  'renderer/quick/Quick.tsx',
  'shared/quick.ts',
  'shared/update.ts',
  'shared/when.ts',
  // 第一批：设置（settings/files.tsx 等 task-wniqx 合进来再抽）
  'renderer/Settings.tsx',
  'renderer/settings/advanced.tsx',
  'renderer/settings/editor.tsx',
  'renderer/settings/general.tsx',
  'renderer/settings/git.tsx',
  'renderer/settings/jump.ts',
  'renderer/settings/keys.tsx',
  'renderer/settings/pdf.tsx',
  'renderer/settings/privacy.tsx',
  'renderer/settings/ui.tsx',
  'renderer/settings/vault.tsx',
  'renderer/settings/web.tsx',
  'renderer/settings/lang.tsx',
  'renderer/settings-ai.tsx',
  'renderer/settings-dream.tsx',
  'renderer/settings-engines.tsx',
  'renderer/plugins/index.tsx',
  // 第一批：⌘K
  'renderer/Palette.tsx',
  'renderer/search/CmdForm.tsx',
  'renderer/search/PalMenus.tsx',
  'renderer/search/QuickOpen.tsx',
  'renderer/search/rows.ts',
  'renderer/search/cmd-layout.ts',
  'renderer/keys.ts',
  'shared/cmd-keys.ts',
  // 第一批：左栏、首页、底栏（目录树、图标栏、标题栏在 task-wniqx 改的 FileTree.tsx、App.tsx、Shell.tsx 里，合进来再抽）
  'renderer/Sidebar.tsx',
  'renderer/files/look.tsx',
  'renderer/files/move-pick.tsx',
  'renderer/files/type-filter.tsx',
  'renderer/HomeView.tsx',
  'renderer/update.tsx',
  'renderer/shell/StatusBar.tsx',
  'renderer/shell/StatusExtras.tsx',
]

/**
 * 数据表（别人正在改、这一批不动文件本身的；或者本来就是表）：表里的这些字在用的地方 t(变量) 翻，键从这里登记。
 * props：这些属性名的值；objects：这些常量整张对象的值；arrays：这些常量数组的元素；calls：[函数名, 第几个参数]；
 * within：只看这个函数里的（function 或 const 箭头函数）；all：范围里的中文字面量全算；ctx：这张表里的字都是「用在哪::原句」
 */
export const DATA = [
  { file: 'shared/settings-index.ts', props: ['name', 'desc', 'grp', 'label'], arrays: ['SETTINGS_SECTIONS'] },
  // 菜单栏（main/lang.ts 的 menuIn 照「菜单栏::原句」翻）
  { file: 'main/index.ts', within: 'buildMenu', props: ['label'], calls: [['cmd', 1]], ctx: '菜单栏' },
  // 命令表：命令名、说明、在哪能按、设置 › 快捷键的分段
  { file: 'shared/cmd-table.ts', props: ['hint'], calls: [['T', 1]], objects: ['AREA_NAME', 'SECTION_NAME'] },
  // ⌘K 的组名
  { file: 'shared/commands.ts', props: ['name'] },
  // 分类：说明和组名（文件夹名照磁盘上的，不翻）
  { file: 'shared/categories.ts', props: ['desc', 'group'] },
  // 十套主题的名字和一句说明
  { file: 'shared/appearance.ts', props: ['name', 'note'] },
  // 首页组件名、换大小、问候
  { file: 'shared/home.ts', props: ['name'] },
  { file: 'shared/home.ts', within: 'sizeAction', all: true },
  { file: 'shared/home.ts', within: 'greeting', all: true },
  // 设置 › 文档和白板的字体、行距、版心，网页的搜索引擎
  { file: 'shared/prefs.ts', props: ['name'] },
  // 文件夹的颜色名（换图标和颜色）、翻译引擎的状态（底栏「译 · …」）
  { file: 'shared/left.ts', objects: ['COLOR_NAMES'] },
  { file: 'shared/plugins/translate.ts', objects: ['STATE_TEXT'] },
  // 设置 › AI 每家那一行：自查出的问题影响哪
  { file: 'shared/engine-health.ts', objects: ['SCOPE_TEXT'] },
  // 设置 › 插件：权限名、三个内置插件的说明（双语翻译归 task-6cxtc，那边改完再登记）
  { file: 'shared/plugins.ts', objects: ['PERMISSION_LABEL'] },
  { file: 'shared/plugins/weread.ts', props: ['description'] },
  { file: 'shared/plugins/bookmarks.ts', props: ['description'] },
  { file: 'shared/plugins/adblock.ts', props: ['description'] },
  // 读PDF 的缩放名（PdfTab 还拼在中文句子里，设置页画的时候翻）
  { file: 'renderer/settings/pdf.tsx', within: 'PDF_ZOOMS', all: true },
  // 首页封面的名字、窗口背景的说法
  { file: 'renderer/covers.ts', props: ['name'] },
  { file: 'renderer/theme.ts', within: 'winBgName', all: true },
]

const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const ast = (code) => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })

function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return
  if (visit(node, parent, key) === false) return
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k.endsWith('Comments') || k === 'extra') continue
    const v = node[k]
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node, k)
    else if (v && typeof v.type === 'string') walk(v, visit, node, k)
  }
}

/** 静态的字（字面量，或者没有 ${} 的模板） */
function staticText(n) {
  if (!n) return null
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return null
}

function calleeName(n) {
  return n.callee?.type === 'Identifier' && n.callee.name in CALLS ? n.callee.name : null
}

/** t(key, { ctx: '…' }) 的 ctx */
function ctxOf(n, name) {
  const p = n.arguments[CALLS[name] + 1]
  if (p?.type !== 'ObjectExpression') return undefined
  const c = p.properties.find((x) => x.type === 'ObjectProperty' && (x.key.name ?? x.key.value) === 'ctx')
  return c ? (staticText(c.value) ?? undefined) : undefined
}

/** 注释里写着「不翻」的行（这一行和下一行都算） */
function skipLines(code) {
  const out = new Set()
  code.split('\n').forEach((l, i) => {
    if (/\/[/*].*不翻/.test(l)) (out.add(i + 1), out.add(i + 2))
  })
  return out
}

/** 一个文件：t() 的键、没包的中文、拼出来的句子 */
export function scanCode(code, file = '') {
  const keys = []
  const strays = []
  const concat = []
  const skip = skipLines(code)
  const inT = new Set()
  walk(ast(code).program, (n, parent, key) => {
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type.startsWith('TS') && n.type !== 'TSAsExpression' && n.type !== 'TSSatisfiesExpression' && n.type !== 'TSNonNullExpression') return false
    if (n.type === 'CallExpression') {
      const c = n.callee
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'console') return false
      const name = calleeName(n)
      if (name) {
        const arg = n.arguments[CALLS[name]]
        const text = staticText(arg)
        if (text !== null) {
          keys.push({ key: text, ctx: ctxOf(n, name), line: n.loc.start.line, file })
          inT.add(arg)
        }
        // 第二个参数里 ctx（用在哪）不是界面上的字；别的变量照常看（里面可能还有 t()，也可能有没包的中文）
        const p = n.arguments[CALLS[name] + 1]
        if (p?.type === 'ObjectExpression') for (const x of p.properties) if (x.type === 'ObjectProperty' && (x.key.name ?? x.key.value) === 'ctx') inT.add(x.value)
        // 拼句子：t() 和别的字用 + 连、或者放进带字的模板里
        if (parent?.type === 'BinaryExpression' && parent.operator === '+') {
          const other = parent.left === n ? parent.right : parent.left
          const s = other.type === 'StringLiteral' ? other.value : other.type === 'TemplateLiteral' ? other.quasis.map((q) => q.value.cooked).join('') : ''
          if (calleeName(other) || CJK_OR_WORD.test(s)) concat.push({ line: n.loc.start.line, file, why: '用 + 接在别的字上' })
        }
        if (parent?.type === 'TemplateLiteral' && parent.quasis.some((q) => CJK_OR_WORD.test(q.value.cooked ?? ''))) concat.push({ line: n.loc.start.line, file, why: '放在带字的模板里' })
      }
    }
    if (n.type === 'ObjectProperty' && n.key && (n.key.name ?? n.key.value) === 'kw') return false
    if (inT.has(n)) return false
    const line = n.loc?.start.line
    if (skip.has(line)) return
    const isKey = parent && key === 'key' && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty')
    if (isKey) return
    if (n.type === 'StringLiteral' && HAN.test(n.value)) strays.push({ line, file, text: n.value })
    else if (n.type === 'TemplateLiteral' && n.quasis.some((q) => HAN.test(q.value.cooked ?? ''))) strays.push({ line, file, text: n.quasis.map((q) => q.value.cooked).join('${…}') })
    else if (n.type === 'JSXText' && HAN.test(n.value)) strays.push({ line, file, text: n.value.trim() })
    else if (n.type === 'JSXAttribute' && n.value?.type === 'StringLiteral' && HAN.test(n.value.value) && !skip.has(n.value.loc.start.line)) {
      strays.push({ line, file, text: n.value.value })
      return false
    }
  })
  return { keys, strays, concat }
}

/** 数据表里登记的句子 */
export function scanData(rule) {
  const code = read(rule.file)
  const out = []
  const add = (n) => {
    const s = staticText(n)
    if (s !== null && HAN.test(s)) out.push({ key: s, ctx: rule.ctx, line: n.loc.start.line, file: rule.file })
  }
  const unwrap = (n) => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') ? unwrap(n.expression) : n)
  const visitRoot = (root) =>
    walk(root, (n) => {
      if (rule.all && (n.type === 'StringLiteral' || n.type === 'TemplateLiteral')) add(n)
      if (n.type === 'ObjectProperty' && rule.props?.includes(n.key.name ?? n.key.value)) add(n.value)
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') {
        const init = unwrap(n.init)
        if (rule.objects?.includes(n.id.name) && init?.type === 'ObjectExpression') for (const p of init.properties) if (p.type === 'ObjectProperty') add(unwrap(p.value))
        if (rule.arrays?.includes(n.id.name) && init?.type === 'ArrayExpression') for (const e of init.elements) add(unwrap(e))
      }
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier') for (const [fn, i] of rule.calls ?? []) if (n.callee.name === fn) add(n.arguments[i])
    })
  const program = ast(code).program
  if (!rule.within) visitRoot(program)
  else
    walk(program, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name === rule.within) return (visitRoot(n.body), false)
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === rule.within && n.init) return (visitRoot(n.init), false)
    })
  return out
}

function srcFiles(dir = SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'public' ? [] : srcFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') && p !== ZH_FILE && !p.includes(join('shared', 'i18n', 'en')) ? [p] : []
  })
}

/** 中文表：全部键（带用在哪的写成「用在哪::原句」），按头一次出现的文件分段 */
export function collect() {
  const seen = new Map()
  const push = (k) => {
    const id = k.ctx ? `${k.ctx}::${k.key}` : k.key
    if (!seen.has(id)) seen.set(id, k.file)
  }
  for (const f of srcFiles()) {
    const code = readFileSync(f, 'utf8')
    if (!/\b(t|tNow|tv|tIn)\(/.test(code)) continue
    for (const k of scanCode(code, relative(SRC, f)).keys) push(k)
  }
  for (const r of DATA) for (const k of scanData(r)) push(k)
  return seen
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

export function zhSource(seen = collect()) {
  const byFile = new Map()
  for (const [id, file] of seen) byFile.set(file, [...(byFile.get(file) ?? []), id])
  const files = [...byFile.keys()].sort()
  const body = files.map((f) => `  // ${f}\n` + byFile.get(f).map((id) => `  ${q(id)},`).join('\n')).join('\n')
  return `/**\n * 中文表：界面上每一句的原句（也是英文表的键），由 apps/notes/scripts/i18n.mjs 从代码里扫出来，别手改。\n * 加了、改了句子跑 node apps/notes/scripts/i18n.mjs，再在 en/ 里补英文。\n */\nexport const ZH: readonly string[] = [\n${body}\n]\n`
}

/** 抽完的文件里还没包的中文、拼出来的句子 */
export function doneProblems() {
  const strays = []
  const concat = []
  for (const f of DONE) {
    const r = scanCode(read(f), f)
    strays.push(...r.strays)
    concat.push(...r.concat)
  }
  return { strays, concat }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--check') {
    const now = readFileSync(ZH_FILE, 'utf8')
    if (now !== zhSource()) {
      console.error('zh.ts 不是最新的：跑 node apps/notes/scripts/i18n.mjs')
      process.exit(1)
    }
    console.log('zh.ts 是最新的')
  } else if (arg === '--strays') {
    const { strays, concat } = doneProblems()
    for (const s of strays) console.log(`${s.file}:${s.line}  ${s.text}`)
    for (const c of concat) console.log(`${c.file}:${c.line}  拼句子：${c.why}`)
    console.log(`${strays.length} 处没包，${concat.length} 处拼句子`)
  } else if (arg === '--missing') {
    // 英文表是 TS，node 读不了：用正则取出英文表里的键（键都写成单引号字符串或不带引号的中文）
    const enDir = join(SRC, 'shared', 'i18n', 'en')
    const have = new Set()
    for (const f of readdirSync(enDir)) {
      const code = readFileSync(join(enDir, f), 'utf8')
      walk(ast(code).program, (n, parent, key) => {
        if (parent?.type === 'ObjectProperty' && key === 'key') have.add(n.type === 'Identifier' ? n.name : n.value)
      })
    }
    const prefixes = process.argv.slice(3)
    let n = 0
    for (const [id, file] of collect()) {
      if (have.has(id) || (prefixes.length && !prefixes.some((p) => file.startsWith(p)))) continue
      console.log(`${file}  ${id}`)
      n++
    }
    console.log(`${n} 句还没有英文`)
  } else if (arg === '--todo') {
    for (const f of process.argv.slice(3)) {
      const rel = relative(SRC, join(process.cwd(), f))
      for (const s of scanCode(readFileSync(join(process.cwd(), f), 'utf8'), rel).strays) console.log(`${rel}:${s.line}  ${s.text}`)
    }
  } else {
    const seen = collect()
    writeFileSync(ZH_FILE, zhSource(seen))
    console.log(`zh.ts：${seen.size} 句`)
  }
}
