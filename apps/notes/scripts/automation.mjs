#!/usr/bin/env node
// 从命令行跑一条自动化规则（task-i921u）：发深链 canvas-notes://automation/run?name=<规则名>[&where=<数据库那篇>]，
// 画布笔记开着就跑，没开着先打开（macOS 的 open -g，不抢前台）。
//   node apps/notes/scripts/automation.mjs run 周记
//   node apps/notes/scripts/automation.mjs run 交报销单 --where "2026 记账"
//   node apps/notes/scripts/automation.mjs run 周记 --print     只打出深链，不发
import { execFileSync } from 'node:child_process'

export function automationUrl(name, where) {
  const q = new URLSearchParams({ name })
  if (where) q.set('where', where)
  return `canvas-notes://automation/run?${q.toString().replace(/\+/g, '%20')}`
}

const [cmd, name, ...rest] = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd !== 'run' || !name) {
    console.error('用法：automation.mjs run <规则名> [--where <数据库那篇的名字或路径>] [--print]')
    process.exit(2)
  }
  const at = rest.indexOf('--where')
  const url = automationUrl(name, at === -1 ? undefined : rest[at + 1])
  if (rest.includes('--print')) console.log(url)
  else execFileSync('open', ['-g', url], { stdio: 'inherit', timeout: 15_000 })
}
