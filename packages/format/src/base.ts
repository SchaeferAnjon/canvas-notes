/**
 * 数据库（CN-19 A）：文档里一个 ```base 代码块，写法和 Obsidian Bases 一致（Obsidian 里也能显示）。
 * 数据是一个文件夹里的 md，每条一篇，属性在 frontmatter（HANDOFF 第 4 节）；代码块里只写数据源、列、筛选、排序。
 *
 *   ```base
 *   filters:
 *     and:
 *       - file.inFolder("读书/书单")
 *       - 状态 == "在读"
 *       - 评分 >= 8
 *   views:
 *     - type: table
 *       name: 表格
 *       order:
 *         - file.name
 *         - 作者
 *       sort:
 *         - property: 评分
 *           direction: DESC
 *   ```
 *
 * 表头上改筛选（全部 / 任一满足 = and / or）、排序、隐藏列（从 order 里拿掉），只改 filters、order、sort 那几行，别的原样。
 * 只认这里用到的一小块 YAML（缩进的键值、列表、带引号的字符串）；认不出的筛选原样留在文件里，不改、不丢。
 */
import { readProps } from './props'

type Y = string | Y[] | { [k: string]: Y }

/** 极小的 YAML：缩进的映射和列表、标量（去引号） */
export function parseYamlLite(src: string): Y {
  const lines = src
    .split('\n')
    .map((l) => l.replace(/\s+#.*$/, '').replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
  let i = 0
  const indent = (l: string) => l.length - l.trimStart().length
  const scalar = (v: string): string => {
    const t = v.trim()
    const d = /^"(.*)"$/.exec(t)
    if (d) return d[1]!.replace(/\\"/g, '"')
    const q = /^'(.*)'$/.exec(t)
    return q ? q[1]!.replace(/''/g, "'") : t
  }
  function block(level: number): Y {
    if (i >= lines.length) return ''
    if (lines[i]!.trimStart().startsWith('- ') || lines[i]!.trim() === '-') {
      const out: Y[] = []
      while (i < lines.length && indent(lines[i]!) === level && /^-(\s|$)/.test(lines[i]!.trimStart())) {
        const rest = lines[i]!.trimStart().slice(1).trimStart()
        if (rest === '') {
          i++
          out.push(i < lines.length && indent(lines[i]!) > level ? block(indent(lines[i]!)) : '')
        } else if (/^[^"'\s!][^:"]*:(\s|$)/.test(rest)) {
          // 「- key: value」开头的映射：后面和 key 对齐的键都归它
          const inner = level + (lines[i]!.trimStart().length - rest.length)
          lines[i] = ' '.repeat(inner) + rest
          out.push(block(inner))
        } else {
          out.push(scalar(rest))
          i++
        }
      }
      return out
    }
    const out: { [k: string]: Y } = {}
    while (i < lines.length && indent(lines[i]!) === level) {
      const m = /^([^:]+):(?:\s+(.*))?$/.exec(lines[i]!.trim())
      if (!m) {
        i++
        continue
      }
      const key = scalar(m[1]!)
      i++
      if (m[2] !== undefined && m[2] !== '') out[key] = scalar(m[2])
      else if (i < lines.length && indent(lines[i]!) > level) out[key] = block(indent(lines[i]!))
      else if (i < lines.length && indent(lines[i]!) === level && /^-(\s|$)/.test(lines[i]!.trimStart())) out[key] = block(level)
      else out[key] = ''
    }
    return out
  }
  return block(lines.length ? indent(lines[0]!) : 0)
}

/**
 * 一条筛选（写法同 Obsidian Bases 的 filters 表达式）：
 *   状态 == "在读" · 状态 != "放弃" · 评分 >= 8 · 读完 < "2026-11-01" · 作者.contains("明") · 读完.isEmpty() · !读完.isEmpty()
 *   最近 N 天：读完 >= today() - "7d"
 * 列名有空格或怪字符时写成 note["列 名"]；笔记名是 file.name。
 */
export type BaseOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'empty' | 'days'

export interface BaseCond {
  prop: string
  op: BaseOp
  value: string
}

export type ColType = 'text' | 'number' | 'date' | 'check' | 'select'

/** 每种列能选的条件（表头的筛选面板用），value：要不要填值 */
export const BASE_OPS: Record<ColType, { op: BaseOp; label: string; value: boolean }[]> = {
  text: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'contains', label: '包含', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  select: [
    { op: '==', label: '是', value: true },
    { op: '!=', label: '不是', value: true },
    { op: 'contains', label: '包含', value: true },
    { op: 'empty', label: '为空', value: false },
  ],
  number: [
    { op: '==', label: '=', value: true },
    { op: '!=', label: '≠', value: true },
    { op: '>', label: '>', value: true },
    { op: '>=', label: '≥', value: true },
    { op: '<', label: '<', value: true },
    { op: '<=', label: '≤', value: true },
  ],
  date: [
    { op: '<', label: '早于', value: true },
    { op: '>', label: '晚于', value: true },
    { op: 'days', label: '最近 N 天', value: true },
  ],
  check: [{ op: '==', label: '是', value: true }],
}

/** 筛选小标签上的写法：「状态 是 在读」「评分 ≥ 8」「读完 最近 7 天」 */
export function condLabel(c: BaseCond, type: ColType): string {
  const name = c.prop === 'file.name' ? '名字' : c.prop
  if (type === 'check') return `${name} ${c.value === 'true' ? '是' : '否'}`
  if (c.op === 'days') return `${name} 最近 ${c.value} 天`
  if (c.op === 'empty') return `${name} 为空`
  const label = (BASE_OPS[type].find((o) => o.op === c.op) ?? BASE_OPS.text.find((o) => o.op === c.op) ?? { label: c.op }).label
  return `${name} ${label} ${c.value}`
}

export interface BaseSpec {
  /** 数据源文件夹（库里的相对路径）；没写就是 null */
  folder: string | null
  /** 这几条是「全部满足」（and）还是「任一满足」（or） */
  match: 'and' | 'or'
  conds: BaseCond[]
  /** 认不出的筛选：原样留着，写回时不丢；筛行时不算（软件读不懂） */
  extra: string[]
  /** 筛选写成了嵌套的组合（and 里套 or 之类）：表头上不改，去源文件改 */
  filtersLocked: boolean
  /** 视图名 */
  view: string
  /** 列：file.name 是笔记名，其余是属性名；隐藏的列就是这里没有的 */
  columns: string[]
  sort: { prop: string; desc: boolean }[]
}

const asList = (y: Y | undefined): Y[] => (Array.isArray(y) ? y : y === undefined || y === '' ? [] : [y])
const asMap = (y: Y | undefined): { [k: string]: Y } => (y && typeof y === 'object' && !Array.isArray(y) ? y : {})

const PROP = String.raw`(?:note\[\s*"([^"]+)"\s*\]|(?:note\.)?(file\.name|[^\s=!<>.()"'\[\]]+))`
const LIT = String.raw`(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'()]+))`
const CMP = new RegExp(String.raw`^${PROP}\s*(==|!=|>=|<=|>|<)\s*${LIT}$`)
const DAYS = new RegExp(String.raw`^${PROP}\s*>=\s*(?:today|now)\(\)\s*-\s*["'](\d+)\s*d(?:ays?)?["']$`)
const CALL = new RegExp(String.raw`^(!?)${PROP}\.(contains|isEmpty)\(\s*(?:${LIT})?\s*\)$`)

const unescape = (s: string) => s.replace(/\\(["\\])/g, '$1')

/** 一条筛选表达式 → 条件；认不出（比如「不包含」「不为空」这种带 ! 的、别的函数）返回 null，原样留着 */
export function parseCond(expr: string): BaseCond | null {
  const t = expr.trim()
  const d = DAYS.exec(t)
  if (d) return { prop: d[1] ?? d[2]!, op: 'days', value: d[3]! }
  const c = CMP.exec(t)
  if (c) return { prop: c[1] ?? c[2]!, op: c[3] as BaseOp, value: unescape(c[4] ?? c[5] ?? c[6] ?? '') }
  const f = CALL.exec(t)
  if (f && !f[1]) {
    const prop = f[2] ?? f[3]!
    if (f[4] === 'isEmpty') return { prop, op: 'empty', value: '' }
    return { prop, op: 'contains', value: unescape(f[5] ?? f[6] ?? f[7] ?? '') }
  }
  return null
}

const propExpr = (p: string) => (p === 'file.name' || /^[^\s=!<>.()"'[\]]+$/.test(p) ? p : `note["${p.replace(/"/g, '')}"]`)
const quoted = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
/** 数字、true / false 不加引号（frontmatter 里它们是数字和勾选），别的加 */
const literal = (v: string) => (/^(-?\d+(\.\d+)?|true|false)$/.test(v) ? v : quoted(v))

/** 条件 → 筛选表达式（写回代码块用） */
export function condExpr(c: BaseCond): string {
  const p = propExpr(c.prop)
  if (c.op === 'contains') return `${p}.contains(${quoted(c.value)})`
  if (c.op === 'empty') return `${p}.isEmpty()`
  if (c.op === 'days') return `${p} >= today() - "${Math.max(1, Math.round(Number(c.value) || 7))}d"`
  return `${p} ${c.op} ${literal(c.value)}`
}

export function parseBase(src: string): BaseSpec {
  const y = asMap(parseYamlLite(src))
  const f = y.filters
  const fm = asMap(f)
  const keys = Object.keys(fm)
  let match: 'and' | 'or' = keys.length === 1 && keys[0] === 'or' ? 'or' : 'and'
  let list: Y[] = typeof f === 'string' ? [f] : Array.isArray(f) ? f : asList(fm[match])
  // 「任一」又有数据源文件夹时是 and: [inFolder, { or: [...] }]（文件夹始终要满足）
  const orMaps = match === 'and' ? list.filter((x) => Object.keys(asMap(x)).length === 1 && Array.isArray(asMap(x).or)) : []
  if (orMaps.length === 1 && list.filter((x) => typeof x === 'string').every((x) => /^file\.inFolder\(/.test((x as string).trim()))) {
    match = 'or'
    list = [...list.filter((x) => typeof x === 'string'), ...asList(asMap(orMaps[0]).or)]
  }
  // 只认一层 and / or；里面再套组合、或者 and、or 都写了的，表头上不改
  const filtersLocked = keys.length > 1 || (keys.length === 1 && keys[0] !== 'and' && keys[0] !== 'or') || list.some((x) => typeof x !== 'string')
  let folder: string | null = null
  const conds: BaseCond[] = []
  const extra: string[] = []
  for (const r of filtersLocked ? asList(fm.and) : list) {
    if (typeof r !== 'string') continue
    const inF = /^file\.inFolder\(\s*["'](.*)["']\s*\)$/.exec(r.trim())
    if (inF) {
      folder = inF[1]!.replace(/\/+$/, '')
      continue
    }
    if (filtersLocked) continue
    const c = parseCond(r)
    if (c) conds.push(c)
    else extra.push(r.trim())
  }
  const v = asMap(asList(y.views)[0])
  const columns = asList(v.order).filter((c): c is string => typeof c === 'string')
  const sort = asList(v.sort)
    .map(asMap)
    .filter((s) => typeof s.property === 'string')
    .map((s) => ({ prop: (s.property as string).replace(/^note\./, ''), desc: String(s.direction ?? '').toUpperCase() === 'DESC' }))
  return { folder, match, conds, extra, filtersLocked, view: typeof v.name === 'string' && v.name ? v.name : '表格', columns: columns.length ? columns : ['file.name'], sort }
}

/** 新建一个数据库代码块的 YAML */
/** 一篇 md 里嵌的数据库用哪几个文件夹当数据源（```base 代码块里的 file.inFolder("…")）：那里的 md 是数据库的条目 */
export function baseFoldersIn(text: string): string[] {
  if (!text.includes('```base')) return []
  const out = new Set<string>()
  for (const b of text.matchAll(/^```base[^\n]*\n([\s\S]*?)^```/gm)) for (const m of b[1]!.matchAll(/file\.inFolder\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]!)
  return [...out]
}

export function baseYaml(folder: string, columns: string[]): string {
  return ['filters:', '  and:', `    - file.inFolder("${folder}")`, 'views:', '  - type: table', '    name: 表格', '    order:', ...columns.map((c) => `      - ${c}`)].join('\n')
}

const indentOf = (l: string) => l.length - l.trimStart().length

/** 换掉 start 行开头的一段（到下一个缩进不比它深的行为止） */
function spliceBlock(lines: string[], start: number, block: string[]): string[] {
  const ind = indentOf(lines[start]!)
  let end = start + 1
  while (end < lines.length && (lines[end]!.trim() === '' || indentOf(lines[end]!) > ind)) end++
  return [...lines.slice(0, start), ...block, ...lines.slice(end)]
}

/** 视图里的一个键（order、sort）：只换这几行，别的原样；没有就加在最后 */
function setViewKey(src: string, key: string, body: string[]): string {
  const lines = src.split('\n')
  const views = lines.findIndex((l) => /^views:\s*$/.test(l))
  const re = new RegExp(String.raw`^\s+${key}:\s*$`)
  const start = views === -1 ? -1 : lines.findIndex((l, i) => i > views && re.test(l))
  if (start === -1) return src.replace(/\n*$/, '') + '\n' + [`    ${key}:`, ...body.map((b) => '    ' + b)].join('\n')
  const ind = ' '.repeat(indentOf(lines[start]!))
  return spliceBlock(lines, start, [`${ind}${key}:`, ...body.map((b) => ind + b)]).join('\n')
}

/** 排序：按这一列升序 / 降序（只换 sort 那几行） */
export function setBaseSort(src: string, prop: string, desc: boolean): string {
  return setViewKey(src, 'sort', [`  - property: ${prop}`, `    direction: ${desc ? 'DESC' : 'ASC'}`])
}

/** 列：显示哪几列、什么顺序（隐藏一列就是从这里拿掉，Obsidian 也这么存） */
export function setBaseOrder(src: string, columns: string[]): string {
  return setViewKey(src, 'order', columns.map((c) => `  - ${c}`))
}

/** YAML 列表里的一行：以 ! 开头、带「: 」「 #」的用单引号包起来 */
const yamlItem = (s: string) => (/^[!&*?|>'"%@`{[]|: | #/.test(s) ? `'${s.replace(/'/g, "''")}'` : s)

/**
 * 筛选：「全部 / 任一」+ 这几条，只换 filters 那一段，认不出的原样留着。
 * 数据源文件夹始终要满足：任一（or）时写成 and: [inFolder, { or: [...] }]，读回来也认。
 */
export function setBaseFilters(src: string, match: 'and' | 'or', conds: BaseCond[]): string {
  const spec = parseBase(src)
  if (spec.filtersLocked) throw new Error('这个数据库的筛选写了嵌套的组合条件，去源文件里改')
  const folder = spec.folder !== null ? [`file.inFolder("${spec.folder}")`] : []
  const items = [...conds.map(condExpr), ...spec.extra]
  let block: string[]
  if (match === 'or' && items.length > 1) {
    block = folder.length
      ? ['filters:', '  and:', ...folder.map((i) => `    - ${yamlItem(i)}`), '    - or:', ...items.map((i) => `        - ${yamlItem(i)}`)]
      : ['filters:', '  or:', ...items.map((i) => `    - ${yamlItem(i)}`)]
  } else {
    const all = [...folder, ...items]
    block = all.length ? ['filters:', '  and:', ...all.map((i) => `    - ${yamlItem(i)}`)] : []
  }
  const lines = src.split('\n')
  const start = lines.findIndex((l) => /^filters:/.test(l))
  if (start === -1) return [...block, ...lines].join('\n')
  return spliceBlock(lines, start, block).join('\n')
}

/** 列的类型：看这一列的值都长什么样 */
export function colType(values: string[]): ColType {
  const v = values.filter((x) => x.trim() !== '')
  if (!v.length) return 'text'
  if (v.every((x) => /^(true|false)$/i.test(x))) return 'check'
  if (v.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return 'number'
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}/.test(x))) return 'date'
  if (new Set(v).size <= Math.max(3, v.length / 2) && v.every((x) => x.length <= 12)) return 'select'
  return 'text'
}

export interface BaseRow {
  path: string
  name: string
  props: Record<string, string>
}

const num = (s: string) => (s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : null)

/** 比两个值：都是数字按数字比，否则按字（日期 2026-11-02 这种按字比就对） */
function compare(a: string, b: string): number {
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null) return na - nb
  return a.localeCompare(b, 'zh')
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 一行满不满足一条（today：测试时给定今天） */
export function condHolds(c: BaseCond, v: string, today = new Date()): boolean {
  switch (c.op) {
    case '==':
      return compare(v, c.value) === 0 && (v === c.value || num(v) !== null)
    case '!=':
      return !(compare(v, c.value) === 0 && (v === c.value || num(v) !== null))
    case '>':
      return v !== '' && compare(v, c.value) > 0
    case '>=':
      return v !== '' && compare(v, c.value) >= 0
    case '<':
      return v !== '' && compare(v, c.value) < 0
    case '<=':
      return v !== '' && compare(v, c.value) <= 0
    case 'contains':
      return v.toLowerCase().includes(c.value.toLowerCase())
    case 'empty':
      return v.trim() === ''
    case 'days': {
      const since = new Date(today)
      since.setDate(since.getDate() - (Number(c.value) || 7))
      return v !== '' && v.slice(0, 10) >= localDate(since)
    }
  }
}

/** 文件夹里的笔记 → 表格的行：按筛选留下、按排序排好（纯函数）；hidden：筛掉了几条 */
export function baseRows(spec: BaseSpec, notes: { path: string; text: string }[], today = new Date()): BaseRow[] & { hidden?: number } {
  const inFolder = (p: string) => spec.folder !== null && p.startsWith(spec.folder + '/') && /\.md$/i.test(p)
  const val = (r: BaseRow, p: string) => (p === 'file.name' ? r.name : (r.props[p] ?? ''))
  const all = notes
    .filter((n) => inFolder(n.path))
    .map((n) => ({ path: n.path, name: n.path.split('/').pop()!.replace(/\.md$/i, ''), props: Object.fromEntries(readProps(n.text).map((p) => [p.key, p.value])) }))
  const ok = (r: BaseRow) => {
    if (!spec.conds.length) return true
    const hits = spec.conds.map((c) => condHolds(c, val(r, c.prop), today))
    return spec.match === 'or' ? hits.some(Boolean) : hits.every(Boolean)
  }
  const rows: BaseRow[] & { hidden?: number } = all.filter(ok).sort((a, b) => {
    for (const s of spec.sort) {
      const d = compare(val(a, s.prop), val(b, s.prop))
      if (d) return s.desc ? -d : d
    }
    return a.name.localeCompare(b.name, 'zh')
  })
  rows.hidden = all.length - rows.length
  return rows
}
