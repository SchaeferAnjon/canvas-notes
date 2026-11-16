/**
 * 文件的属性：md 开头 frontmatter 里一行一个的 `键: 值`（类型、课程、第几讲、来源、日期……）。
 * 只认简单的一行键值；列表（links:）、多行的值不算属性，原样留着。
 * 改一个属性只动它那一行；没有 frontmatter 时新建一段。
 */

export interface Prop {
  key: string
  value: string
}

const FM = /^---\n([\s\S]*?\n)?---(?:\n|$)/
const LINE = /^([^\s:#\-][^:\n]*?):[ \t]*(.*?)[ \t]*$/

/** 软件自己用的键，不当属性给人看 */
export const HIDDEN_KEYS = new Set(['type', 'links', 'color', 'icon', 'created', 'updated', 'source', 'draft', 'AI填的', '白板样式', 'import-id'])

function unquote(v: string): string {
  const m = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v)
  return m ? m[1]!.replace(/\\"/g, '"') : v
}

/** 值里有 YAML 会读歪的东西就加引号 */
function quote(v: string): string {
  return /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|^$|\s$/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v
}

/** 全部一行键值，按文件里的顺序（含软件自己用的键） */
export function readProps(text: string): Prop[] {
  const m = FM.exec(text)
  if (!m) return []
  const out: Prop[] = []
  const lines = (m[1] ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = LINE.exec(lines[i]!)
    if (!l) continue
    // 值是空的、下一行缩进：是列表或多行，不算
    if (l[2] === '' && /^\s+\S/.test(lines[i + 1] ?? '')) continue
    out.push({ key: l[1]!, value: unquote(l[2]!) })
  }
  return out
}

export function prop(text: string, key: string): string | undefined {
  return readProps(text).find((p) => p.key === key)?.value
}

/** 设一个属性；value 是 undefined 时删掉。值没变时原文不变 */
export function setProp(text: string, key: string, value: string | undefined): string {
  if (!/^[^\s:#\-][^:\n]*$/.test(key)) throw new Error(`属性名不对：${key}`)
  const v = value === undefined ? undefined : value.replace(/\s*\n\s*/g, ' ').trim()
  const m = FM.exec(text)
  if (!m) {
    if (v === undefined) return text
    return `---\n${key}: ${quote(v)}\n---\n` + text
  }
  const body = m[1] ?? ''
  const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n')
  const i = lines.findIndex((l) => LINE.exec(l)?.[1] === key)
  if (i !== -1) {
    if (v !== undefined && unquote(LINE.exec(lines[i]!)![2]!) === v) return text
    if (v === undefined) lines.splice(i, 1)
    else lines[i] = `${key}: ${quote(v)}`
  } else {
    if (v === undefined) return text
    lines.push(`${key}: ${quote(v)}`)
  }
  const rest = text.slice(m[0].length)
  const close = m[0].endsWith('\n') ? '---\n' : '---'
  return `---\n${lines.map((l) => l + '\n').join('')}${close}` + rest
}

// ---------- AI 填的属性：记在 AI填的 这一行（逗号隔开），用户改过的就去掉 ----------

export const AI_KEY = 'AI填的'

export function aiFilled(text: string): string[] {
  return (prop(text, AI_KEY) ?? '')
    .split(/[,，]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 用户改了一个属性：设值，并且它不再算 AI 填的 */
export function setPropByUser(text: string, key: string, value: string | undefined): string {
  let out = setProp(text, key, value)
  const ai = aiFilled(out)
  if (ai.includes(key)) {
    const left = ai.filter((k) => k !== key)
    out = setProp(out, AI_KEY, left.length ? left.join(', ') : undefined)
  }
  return out
}
