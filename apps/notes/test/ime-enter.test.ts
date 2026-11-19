import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CN-115：输入法还在组字时按回车，拼音串（「e'c'p」）被当成了文件夹名。
 * renderer 里每个输入框（<input>、<textarea>）的 onKeyDown 只要处理了 Enter，就得先问输入法是不是还在组字
 * （renderer/ime.ts 的 composing，或者直接看 isComposing / keyCode 229）。新加的输入框忘了问，这里就失败。
 */
const root = join(__dirname, '../src/renderer')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : []
  })
}

/** 一个 onKeyDown={…} 的整段（括号配平） */
function handlers(src: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = []
  for (let i = src.indexOf('onKeyDown={'); i !== -1; i = src.indexOf('onKeyDown={', i + 1)) {
    let j = i + 'onKeyDown={'.length
    let depth = 1
    while (depth && j < src.length) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    out.push({ at: i, body: src.slice(i, j) })
  }
  return out
}

/** onKeyDown 挂在哪个标签上（往前找最近的「<标签名」） */
function tagOf(src: string, at: number): string {
  const m = [...src.slice(0, at).matchAll(/<([a-zA-Z][\w.]*)/g)].pop()
  return m?.[1] ?? ''
}

describe('输入框处理回车前先问输入法（CN-115）', () => {
  it('renderer 里每个处理了 Enter 的 <input>、<textarea> 都先看 composing / isComposing', () => {
    const bad: string[] = []
    for (const f of files(root)) {
      const src = readFileSync(f, 'utf8')
      for (const h of handlers(src)) {
        const tag = tagOf(src, h.at)
        if (tag !== 'input' && tag !== 'textarea') continue
        if (!/['"]Enter['"]/.test(h.body)) continue
        if (/composing\(|isComposing|keyCode === 229/.test(h.body)) continue
        bad.push(`${relative(root, f)}:${src.slice(0, h.at).split('\n').length}`)
      }
    }
    expect(bad).toEqual([])
  })
})
