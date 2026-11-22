/**
 * 界面上写着的键不许写死（task-spsmf）：都从命令表取（renderer/keys.ts 的 keyFor、accelFor、withKeys 的 {k:id}，
 * 主进程的 menuKey，网页预加载的 pageKey）。这里扫一遍界面、主进程、预加载的源码，注释以外写着组合键的、
 * 右键菜单和菜单栏写死的加速键、提示上写死的 data-key、keys= 都算错；改了键这些地方才会跟着变。
 * 命令表本身、键的写法和认法（cmd-table、cmd-keys、keys.ts、page-keys.ts）不算。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../src')
const SKIP = new Set(['shared/cmd-table.ts', 'shared/cmd-keys.ts', 'renderer/keys.ts', 'preload/page-keys.ts'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : []
  })
}

/** 去掉注释（行注释、块注释，JSX 里大括号包着的块注释也是），字符串里的双斜杠不算（网址） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n')
}

/** 修饰键后面紧跟一个键（⌘N、⇧⌘E、⌘↵、⌥⌘\）：写给人看的组合键 */
const COMBO = /[⌃⌥⇧⌘]+(?:[A-Z0-9]|F\d|[,./;[\]\\=\-`+−↵⌫⌦⇥↑↓←→])/
/** 系统菜单的加速键写死 */
const ACCEL = /\baccel(?:erator)?:\s*['"`]/
/** 提示、按钮上写死的单个 F 键（F2） */
const FKEY = /\b(?:data-key|keys)=["']F\d/

describe('界面上写着的键都从命令表取', () => {
  it('界面、主进程、预加载里注释以外没有写死的组合键、加速键、data-key', () => {
    const bad: string[] = []
    for (const p of [...files(join(SRC, 'renderer')), ...files(join(SRC, 'main')), ...files(join(SRC, 'preload')), ...files(join(SRC, 'shared'))]) {
      const rel = relative(SRC, p)
      // 中文表、英文表（shared/i18n/）是命令表里那几句的原句和译文，源头已经查过
      if (SKIP.has(rel) || rel.startsWith('shared/i18n/')) continue
      stripComments(readFileSync(p, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          // 正则里的（认键的写法，不是写给人看的）
          if (/\/\^|\.test\(|new RegExp/.test(line)) return
          if (COMBO.test(line) || ACCEL.test(line) || FKEY.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
        })
    }
    expect(bad).toEqual([])
  })
})
