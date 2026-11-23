import { describe, expect, it } from 'vitest'
import { insertBlockAt } from '../src/renderer/insert-flash'

const apply2 = (doc: string, pos: number, text: string) => {
  const r = insertBlockAt(doc, pos, text, false)
  return doc.slice(0, r.from) + r.insert + doc.slice(r.to)
}

const apply = (doc: string, pos: number, text: string) => {
  const r = insertBlockAt(doc, pos, text)
  const out = doc.slice(0, r.from) + r.insert + doc.slice(r.to)
  return { out, r, at: out.slice(r.cursor) }
}

describe('插进文档（剪进文档、AI 回答、记下这一刻）：插在光标所在段后面，光标落在下面新的空段落', () => {
  it('段落中间：引文和上下两段各隔一个空行，中间多一个空段落放光标', () => {
    const doc = '# 标题\n\n财富是靠专长。\n\n最后一段。\n'
    const { out, r } = apply(doc, doc.indexOf('专长'), '> 引文\n—— [来源](https://a.cn)')
    expect(out).toBe('# 标题\n\n财富是靠专长。\n\n> 引文\n—— [来源](https://a.cn)\n\n\n最后一段。\n')
    expect(out.slice(r.range.from, r.range.to)).toBe('> 引文\n—— [来源](https://a.cn)')
    // 光标那一行是空行，上一行是空行（不会接到引文后面成为懒续行）：一串空行第一行是缝，光标在后面那个空块里（gap-lines.ts，task-axoxy）
    const lines = out.split('\n')
    const n = out.slice(0, r.cursor).split('\n').length - 1
    expect([lines[n - 1], lines[n], lines[n + 1]]).toEqual(['', '', '最后一段。'])
  })

  it('在最后一段：文件结尾补一个空段落，光标在文件末尾', () => {
    const { out, r } = apply('只有一段\n', 2, '> 引文')
    expect(out).toBe('只有一段\n\n> 引文\n\n')
    expect(r.cursor).toBe(out.length)
  })

  it('光标在两段之间的空行上：不粘到上一段', () => {
    const doc = 'a\n\nb'
    const { out } = apply(doc, 2, 'T')
    expect(out).toBe('a\n\nT\n\n\nb')
  })

  it('连着插两次（微信读书一次插几条划线）：一条接一条，中间只隔一个空行', () => {
    const one = apply('a\n\nb\n', 0, 'T1')
    const two = apply(one.out, one.r.cursor, 'T2')
    expect(two.out).toBe('a\n\nT1\n\nT2\n\n\nb\n')
  })

  it('后台插的（para: false）：不补空段落，光标在插入的末尾；连着插一条接一条', () => {
    const doc = '# 随笔\n\n第一段。\n\n第二段。\n'
    const r = insertBlockAt(doc, doc.indexOf('第一段') + 2, 'AI 写的一段', false)
    const out = doc.slice(0, r.from) + r.insert + doc.slice(r.to)
    expect(out).toBe('# 随笔\n\n第一段。\n\nAI 写的一段\n\n第二段。\n')
    expect(out.slice(0, r.cursor).endsWith('AI 写的一段')).toBe(true)
    const r2 = insertBlockAt(out, r.cursor, '又一段', false)
    expect(out.slice(0, r2.from) + r2.insert + out.slice(r2.to)).toBe('# 随笔\n\n第一段。\n\nAI 写的一段\n\n又一段\n\n第二段。\n')
    expect(apply2('末尾一段\n', 0, '划线')).toBe('末尾一段\n\n划线\n')
  })

  it('空文档', () => {
    expect(apply('', 0, 'T').out).toBe('T\n\n')
  })
})
