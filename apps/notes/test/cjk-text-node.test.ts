/**
 * 防回归：界面上挨着的中文和数字、西文要在同一个文本节点里（DESIGN.md 字体那条）。
 * JSX 里写成 `{n}篇`、`第{n}页` 会拆成两个文本节点。屏幕像素和一个节点时相同，但单字 Range 量法跨节点会量出 0（见 e2e/cjk-gap.ts）；
 * 统一写成 {`${n}篇`} 作为保险。这里扫 renderer 的全部 .tsx：JSX 文字的头一个字是中文、前面紧挨一个 {表达式}，
 * 或者末一个字是中文、后面紧挨一个 {表达式}，就算违规。
 * 不算的：表达式本身是元素（`{x && <span>…</span>}`，那是元素边界，不是两个文本节点）；
 * 字面量表达式挨着中文的那一头不是数字、西文（`{' '}`、`{'，'}`）。
 * 文字照 JSX 的规矩先去掉带换行的首尾空白（`个节点⏎{x}` 渲染出来也是挨着的）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', 'src', 'renderer')
const HAN = /\p{Script=Han}/u
const ALNUM = /[0-9A-Za-z]/

type Node = { type: string; start: number; end: number; loc: { start: { line: number } }; [k: string]: unknown }

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

/** JSX 文字渲染出来的样子（照 Babel 的 cleanJSXElementLiteralChild：带换行的首尾空白去掉，行与行之间一个空格） */
function jsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/)
  let last = 0
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) last = i
  })
  let out = ''
  lines.forEach((raw, i) => {
    let l = raw.replace(/\t/g, ' ')
    if (i !== 0) l = l.replace(/^ +/, '')
    if (i !== lines.length - 1) l = l.replace(/ +$/, '')
    if (l) out += i === last ? l : l + ' '
  })
  return out
}

/** 白名单：只出元素的函数，挨着中文的是元素边界不是数字（folder-home/dialogs.tsx 的 seg 出一排分段按钮） */
const ELEMENT_FNS = new Set(['seg'])

/**
 * 表达式挨着中文那一头可能出的字：'' 是什么字都不出或者出的是元素（元素边界不归这条管），
 * null 是值看不出来（变量、函数），按会出数字算。
 */
function edges(e: Node, side: 'first' | 'last'): (string | null)[] {
  const pick = (s: string) => [side === 'first' ? s.slice(0, 1) : s.slice(-1)]
  switch (e.type) {
    case 'JSXElement':
    case 'JSXFragment':
    case 'NullLiteral':
      return ['']
    case 'StringLiteral':
      return pick(e.value as string)
    case 'TemplateLiteral': {
      const qs = e.quasis as { value: { cooked: string } }[]
      const q = side === 'first' ? qs[0]! : qs[qs.length - 1]!
      return q.value.cooked ? pick(q.value.cooked) : [null]
    }
    case 'ParenthesizedExpression':
      return edges(e.expression as Node, side)
    case 'LogicalExpression':
      return e.operator === '&&' ? ['', ...edges(e.right as Node, side)] : [null]
    case 'ConditionalExpression':
      return [...edges(e.consequent as Node, side), ...edges(e.alternate as Node, side)]
    case 'CallExpression': {
      const callee = e.callee as Node
      // xs.map((x) => <i />)
      if (callee.type === 'MemberExpression' && (callee.property as Node & { name?: string }).name === 'map') {
        const fn = (e.arguments as Node[])[0]
        if (fn && fn.type === 'ArrowFunctionExpression') {
          const body = fn.body as Node
          return body.type === 'BlockStatement' ? [null] : edges(body, side)
        }
      }
      if (callee.type === 'Identifier' && ELEMENT_FNS.has(callee.name as string)) return ['']
      return [null]
    }
    default:
      return [null]
  }
}

/** 这个表达式挨着中文的那一头可能出数字、西文 */
function mayTouch(c: Node | undefined, side: 'first' | 'last'): c is Node {
  if (!c || c.type !== 'JSXExpressionContainer') return false
  const e = c.expression as Node
  if (e.type === 'JSXEmptyExpression') return false
  return edges(e, side).some((ch) => ch === null || ALNUM.test(ch))
}

function findSplits(file: string, src: string): string[] {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Node
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
      const ch = n.children as Node[]
      ch.forEach((c, i) => {
        if (c.type !== 'JSXText') return
        const t = jsxText(c.value as string)
        if (!t) return
        const prev = ch[i - 1]
        const next = ch[i + 1]
        const before = HAN.test(t[0]!) && mayTouch(prev, 'last')
        const after = HAN.test(t[t.length - 1]!) && mayTouch(next, 'first')
        if (!before && !after) return
        const from = before ? prev!.start : c.start
        const to = after ? next!.end : c.end
        const snippet = src.slice(from, to).replace(/\s+/g, ' ').trim()
        out.push(`${file}:${c.loc.start.line}  ${snippet}`)
      })
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'loc') continue
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object') visit(v)
    }
  }
  visit(ast)
  return out
}

describe('中文和数字、西文在同一个文本节点里（text-autospace 才起作用）', () => {
  it('扫得出 {n}篇、第{n}页、个节点⏎{x}，放过 {`${n}篇`}、元素和标点', () => {
    const bad = (s: string) => findSplits('x.tsx', `const a = ${s}`).length
    expect(bad('<b>{n}篇</b>')).toBe(1)
    expect(bad('<b>第{n}页</b>')).toBe(2)
    expect(bad('<b>{a}张 · {b}</b>')).toBe(1)
    expect(bad('<b>\n  认出{n}个节点\n  {x ? <i /> : "，都核对过了"}\n</b>')).toBe(2)
    expect(bad('<b>{`${n}篇`}</b>')).toBe(0)
    expect(bad('<b>{`第${n}页`} · {name}</b>')).toBe(0)
    expect(bad('<b>讲法{v && <span>第2版</span>}</b>')).toBe(0)
    expect(bad("<b>记在本机{' '}<i /></b>")).toBe(0)
    expect(bad("<b>记在本机{'v2'}</b>")).toBe(1)
    expect(bad("<b>{x ? '查着…' : `${n}张不删。`}勾不勾</b>")).toBe(0)
    expect(bad("<b>{x ? '查着…' : `共${n}`}张</b>")).toBe(1)
    expect(bad("<b>{x ? '查着…' : 'v2'}张</b>")).toBe(1)
    expect(bad('<b>少{xs.map((l) => <i key={l} />)}多</b>')).toBe(0)
    expect(bad('<b>少{xs.map((l) => l)}多</b>')).toBe(2)
    expect(bad('<b>条件{seg(a, b)}</b>')).toBe(0)
  })

  it('renderer 里一处都没有', () => {
    const found = tsxFiles(ROOT).flatMap((f) => findSplits(relative(ROOT, f), readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })
})
