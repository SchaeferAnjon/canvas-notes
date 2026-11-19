/**
 * 造一个大库：默认 7000 篇，像用了几年的 Obsidian 库（用户那个有 6965 个文件）。
 * 文件夹好几层、长短不一、有双链和 frontmatter；修改时间摊在最近三年里，大部分是很久没动过的。
 * 测性能和「左栏只放活着的」用。同一个 seed 造出来的一模一样。
 *
 * 命令行：node apps/notes/e2e/fixtures/big-vault.ts <文件夹> [篇数]
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DAY = 86400_000

export interface BigVaultStats {
  total: number
  /** 最近 7 天改过的「我写的」文档（不算白板） */
  worksThisWeek: number
  boards: number
  inbox: number
  clips: number
  /** 超过 90 天没改的 */
  olderThan90: number
}

const WORDS = '今天 想到 一个 问题 为什么 我们 总是 先 规划 再 动手 其实 随手 记下来 更 重要 冰岛 自驾 极光 预报 读书 笔记 产品 设计 卡片 白板 收件箱 整理 素材 引用 文章 写作 习惯 时间 管理 工具 软件 记忆 复习 灵感 项目 周报 会议 记录 学习 编程 函数 测试 数据 模型'.split(' ')
const FOLDERS = ['日记/2024', '日记/2025', '日记/2026', '读书', '读书/小说', '项目/canvas', '项目/旧项目', '工作/会议', '工作/周报', '学习/编程', '学习/语言', '旅行', '想法', '']
const TOPICS = ['AI 与工具', '旅行', '设计', '写作', '读书摘抄', '编程', '健康', '投资', '摄影', '音乐', '电影', '历史']

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function makeBigVault(root: string, count = 7000, now = Date.now(), seed = 7): BigVaultStats {
  const r = rng(seed)
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]!
  const para = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join('')
  const stats: BigVaultStats = { total: 0, worksThisWeek: 0, boards: 0, inbox: 0, clips: 0, olderThan90: 0 }
  const titles: string[] = []
  const put = (rel: string, text: string, ageDays: number) => {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
    const t = (now - ageDays * DAY) / 1000
    utimesSync(p, t, t)
    stats.total++
    if (ageDays > 90) stats.olderThan90++
  }
  /** 多数很久没动，少数最近动过：最近 7 天约 0.5%，7–90 天约 6%，其余摊在 90 天到 3 年 */
  const age = () => {
    const x = r()
    if (x < 0.005) return r() * 6.5
    if (x < 0.065) return 8 + r() * 80
    return 92 + r() * 1000
  }

  const boards = 40
  const inbox = 34
  const clips = 400
  const works = count - boards - inbox - clips
  for (let i = 0; i < works; i++) {
    const folder = pick(FOLDERS)
    const title = `${para(2)} ${i}`
    titles.push(title)
    const big = r() < 0.01
    const paras = big ? 120 : 1 + Math.floor(r() * 14)
    const body = Array.from({ length: paras }, () => para(30 + Math.floor(r() * 90)) + (r() < 0.3 ? ` [[${pick(titles)}]]` : '')).join('\n\n')
    const fm = r() < 0.4 ? `---\ntags: [${pick(WORDS)}, ${pick(WORDS)}]\n${r() < 0.02 ? 'draft: true\n' : ''}---\n` : ''
    const a = age()
    if (a < 7) stats.worksThisWeek++
    put(`${folder ? folder + '/' : ''}${title}.md`, `${fm}# ${title}\n\n${body}\n`, a)
  }
  for (let i = 0; i < boards; i++) {
    const cards = Array.from({ length: 8 + Math.floor(r() * 30) }, (_, k) => `<!-- card id=c${k} x=${(k % 6) * 300} y=${Math.floor(k / 6) * 220} w=280 -->\n${para(12)}\n`).join('\n')
    stats.boards++
    put(`白板/${para(2)}白板 ${i}.md`, `---\ntype: board\ncolor: #4A7FA7\n---\n${cards}`, i < 6 ? r() * 30 : age())
  }
  for (let i = 0; i < inbox; i++) {
    stats.inbox++
    put(`收件箱/${para(3)} ${i}.md`, `---\ncreated: 2026-10-${String(1 + (i % 28)).padStart(2, '0')} 10:00\n---\n${para(30)}\n`, r() * 40)
  }
  for (let i = 0; i < clips; i++) {
    stats.clips++
    put(`剪藏/${pick(TOPICS)}/${para(3)} ${i}.md`, `---\ncreated: 2025-05-01 09:00\nsource: https://example.com/a/${i}\n---\n> ${para(40)}\n—— [来源 ${i}](https://example.com/a/${i})\n`, age())
  }
  return stats
}

// 命令行直接跑：node big-vault.ts <文件夹> [篇数]
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('big-vault.ts') && process.argv[2]) {
  const stats = makeBigVault(process.argv[2], Number(process.argv[3]) || 7000)
  console.log(JSON.stringify(stats))
}
