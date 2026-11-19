import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * useEffect 写成 `() => 一句表达式` 时，表达式的值就是清理函数。React 只收 undefined 或函数，
 * 收到别的（比如 Electron 里 scrollIntoView 返回的 Promise、没加 void 的 .then()）重画时报
 * 「destroy_ is not a function」，整个 React 根被卸掉：插入菜单打字筛选时偶尔一片空就是这么来的。
 * TypeScript 的 DOM 声明写 scrollIntoView 返回 void，类型检查拦不住，这里扫一遍。
 */
const root = join(__dirname, '../src/renderer')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

describe('useEffect 不把非函数当清理函数交给 React', () => {
  it('一句表达式的 effect 里不调 scrollIntoView、不留没加 void 的 .then()', () => {
    const bad: string[] = []
    for (const f of files(root)) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*(?!\{)([^\n]*)/g)) {
        const expr = m[1]!
        if (/scrollIntoView\(/.test(expr) || (/\.then\(/.test(expr) && !/^void\b/.test(expr))) {
          bad.push(`${relative(root, f)}:${src.slice(0, m.index).split('\n').length}  ${m[0].trim()}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
