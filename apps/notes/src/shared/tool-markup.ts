/**
 * 模型偶尔把一次工具调用写成了普通文字（task-ne7cw：Opus 在回答前面吐出一段 `<invoke name="Bash"><parameter …>…</invoke>`，
 * 是 stream-json 里 text_delta 本来就有的字，不是我们解析错）。回答显示时把成段、成对的这类标记去掉：
 * function_calls、function_results、invoke name=、parameter name=（可带「xx:」前缀）。代码块、行内代码里的照原样；
 * 没收尾的不动，只有还在答时末尾那段刚开头的先不显示（不然答着答着闪出半截再消失）。
 * 只管显示：对话记录里存的、「存成命令」读的、复制的还是原文。
 */

const NS = '(?:[A-Za-z_]+:)?'
const BLOCK = new RegExp(`[ \\t]*(?:<(${NS}(?:function_calls|function_results))>[\\s\\S]*?</\\1>|<(${NS}invoke)\\s+name="[^"\\n]*">[\\s\\S]*?</\\2>|<(${NS}parameter)\\s+name="[^"\\n]*">[\\s\\S]*?</\\3>)[ \\t]*\\n?`, 'g')
/** 末尾刚开头还没收尾的一段（只在还在答时藏） */
const OPEN = new RegExp(`<${NS}(?:function_calls>|function_results>|invoke\\s+name="|parameter\\s+name=")`, 'g')
const OPENERS = ['<function_calls>', '<function_results>', '<invoke name="', '<parameter name="']
const FENCE = /^\s*(```|~~~)/

/** 一段不在代码块里的字：去掉成对的标记；live 时末尾那段没收尾的也藏 */
function clean(seg: string, live: boolean): string {
  // 行内代码的范围：标记从这里面开始的不算
  const code: [number, number][] = []
  for (const m of seg.matchAll(/(`+)[^`\n]*?\1/g)) code.push([m.index, m.index + m[0].length])
  const inCode = (i: number) => code.some(([a, b]) => i >= a && i < b)
  let out = seg.replace(BLOCK, (all, _a, _b, _c, at: number) => {
    const start = at + all.length - all.trimStart().length
    return inCode(start) ? all : '\n'
  })
  if (live) {
    let cut = -1
    for (const m of out.matchAll(OPEN)) if (!inCode(m.index)) cut = cut < 0 ? m.index : cut
    if (cut < 0) {
      // 开头那个标记只来了一半：「<inv」「<invoke na」「<x:functio」
      const at = out.lastIndexOf('<')
      const half = at < 0 ? '' : out.slice(at).replace(/^<[A-Za-z_]+:/, '<').replace(/\s+/g, ' ')
      if (half.length > 1 && !inCode(at) && OPENERS.some((o) => o.startsWith(half))) cut = at
    }
    if (cut >= 0) out = out.slice(0, cut)
  }
  return out
}

export function hideToolMarkup(text: string, live = false): string {
  if (!text.includes('<')) return text
  const lines = text.split('\n')
  const parts: { code: boolean; text: string }[] = []
  let buf: string[] = []
  const flush = (code: boolean) => {
    if (buf.length) parts.push({ code, text: buf.join('\n') })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]!)
    if (!f) {
      buf.push(lines[i]!)
      continue
    }
    flush(false)
    // 代码块：到同样的围栏为止（没收尾就到最后），和 md-render 一样数
    buf.push(lines[i]!)
    while (++i < lines.length) {
      buf.push(lines[i]!)
      if (lines[i]!.trim().startsWith(f[1]!)) break
    }
    flush(true)
  }
  flush(false)
  let changed = false
  const out = parts.map((p) => {
    if (p.code) return p.text
    const c = clean(p.text, live && p === parts[parts.length - 1])
    if (c === p.text) return c
    changed = true
    return c.replace(/\n{3,}/g, '\n\n')
  })
  if (!changed) return text
  return out.join('\n').trim()
}
