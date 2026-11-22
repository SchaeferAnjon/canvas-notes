/**
 * 「最近删掉的」用的样本库（task-iq2ow）：B2 那个库，历史里 30 天内删过三篇（一篇白板），图标栏那一格写 3。
 * trashHistory 在 launch 的 prepare 里调：先把要删的提交进去、再一篇篇按日子删掉，最后摊开修改时间。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { B2_VAULT, withTimes } from './b2-vault'

export const TRASH_VAULT = B2_VAULT

export const PLAN = '# 旧的读书计划\n\n今年想读完的书：\n\n1. 《巴菲特传》，每周两章，周日写一段读后感。\n2. 《杀死一只知更鸟》，配着电影一起看。\n'
const GONE: [string, string, number][] = [
  ['项目/冰岛旅行/冰岛行程 第一版.md', '---\ntype: board\ncolor: "#C9853A"\n---\n# 冰岛行程 第一版\n\n## 第一天\n\n雷克雅未克。\n', 6],
  ['写作/旧的读书计划.md', PLAN, 3],
  ['收件箱/随手记 11月18日.md', '# 随手记 11月18日\n\n买咖啡豆。\n', 1],
]

const DAY = 86400_000

export function trashHistory(vault: string) {
  const now = Date.now()
  const git = (args: string[], at?: number) =>
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString() } : {}) },
    })
  for (const [p, text] of GONE) {
    mkdirSync(dirname(join(vault, p)), { recursive: true })
    writeFileSync(join(vault, p), text)
  }
  git(['add', ...GONE.map(([p]) => p)])
  git(['commit', '-q', '-m', '建好'], now - 20 * DAY)
  for (const [p, , days] of GONE) {
    git(['rm', '-q', p])
    git(['commit', '-q', '-m', `删除 ${p}`], now - days * DAY)
  }
  withTimes(vault)
}
