/**
 * 生长图的样本库（task-h7oy8 起用，梦游和生长图动效 2026-11-25 抽出来共用）：按日子一次次提交——2025-03-01 第一篇、3 到 4 月 HPDC 课一讲一讲加、
 * 6 月几篇剪藏、9 月 1 日一次导入 35 篇（老的，时间要估）、10 月 2 日夜里梦游补了两条双链，最后一篇还没提交。都是编的，不是谁的真库。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const commitAt = (vault: string, when: string, msg: string) => {
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
}
export const put = (vault: string, p: string, text: string) => {
  mkdirSync(dirname(join(vault, p)), { recursive: true })
  writeFileSync(join(vault, p), text)
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function prepareHistory(vault: string) {
  put(vault, '写作/开始.md', '# 开始\n\n今天开始用画布笔记。\n')
  commitAt(vault, '2025-03-01T10:00:00', '新建')
  put(vault, '课程/HPDC/Amdahl定律.md', '# Amdahl定律\n\n加速比的上限由串行的那一部分决定。\n')
  commitAt(vault, '2025-03-08T10:00:00', 'Amdahl')
  for (let i = 1; i <= 20; i++) {
    put(vault, `课程/HPDC/第${i}讲.md`, `# 第${i}讲\n\n${i > 1 ? `接着 [[第${i - 1}讲]]。` : '第一讲。'}${i % 5 === 0 ? '这一讲用到 [[Amdahl定律]]。' : ''}\n`)
    commitAt(vault, `${ymd(2025, i <= 10 ? 3 : 4, i <= 10 ? 10 + i : i - 8)}T10:00:00`, `第${i}讲`)
  }
  for (let i = 1; i <= 5; i++) put(vault, `剪藏/并行/剪藏${i}.md`, `---\nsource: https://example.com/${i}\n---\n# 剪藏${i}\n\n讲并行计算的第 ${i} 篇。\n`)
  commitAt(vault, '2025-06-12T21:00:00', '剪藏')
  // 一次导入 35 篇：前 20 篇写了创建日期（2023 年），后 15 篇没写，只能看修改时间（2024-05-10），画空心
  for (let i = 1; i <= 35; i++) {
    const p = `导入/旧库/旧笔记${i}.md`
    put(vault, p, `${i <= 20 ? `---\ncreated: ${ymd(2023, 1 + (i % 12), 3)}\n---\n` : ''}# 旧笔记${i}\n\n${i > 1 ? `见 [[旧笔记${i - 1}]]` : ''}\n`)
    if (i > 20) utimesSync(join(vault, p), new Date('2024-05-10T12:00:00'), new Date('2024-05-10T12:00:00'))
  }
  commitAt(vault, '2025-09-01T09:00:00', '从 Obsidian 导入 35 篇')
  // 10 月 2 日夜里梦游：补两条双链
  put(vault, '剪藏/并行/剪藏1.md', '---\nsource: https://example.com/1\n---\n# 剪藏1\n\n讲并行计算的第 1 篇。\n\n相关：[[Amdahl定律]]\n')
  commitAt(vault, '2025-10-02T02:30:00', '梦游：「剪藏1」补上 [[Amdahl定律]]')
  put(vault, '剪藏/并行/剪藏2.md', '---\nsource: https://example.com/2\n---\n# 剪藏2\n\n讲并行计算的第 2 篇。\n\n相关：[[第5讲]]\n')
  commitAt(vault, '2025-10-02T02:31:00', '梦游：「剪藏2」补上 [[第5讲]]')
  // 还没提交的一篇（launch 最后那次提交带上它）
  put(vault, '收件箱/新的一篇.md', '# 新的一篇\n\n记一下 [[开始]]。\n')
}
export const TOTAL = 1 + 1 + 20 + 5 + 35 + 1

/**
 * 合成库（量帧率用）：n 篇分在 8 个顶层文件夹，每篇连 1 到 3 篇（多半连同一个文件夹里早的），分 24 次提交摊在两年里。
 * 返回 prepare 函数；库里一共 n + 1 篇（launch 那次提交另带一篇空的）
 */
export function prepareSynth(n: number) {
  return (vault: string) => {
    let seed = 7
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    const tops = ['项目', '阅读', '生活', '课程', '剪藏', '周记', '写作', '收件箱']
    const path = (i: number) => `${tops[i % tops.length]}/组${Math.floor(i / 40) % 5}/笔记${i}.md`
    const per = Math.ceil(n / 24)
    for (let c = 0; c < 24 && c * per < n; c++) {
      for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) {
        const k = i === 0 ? 0 : 1 + Math.floor(rnd() * 2.2)
        const to: string[] = []
        for (let j = 0; j < k; j++) {
          const same = rnd() < 0.85
          const t = same ? Math.max(0, i - tops.length * (1 + Math.floor(Math.pow(rnd(), 1.8) * Math.max(1, i / tops.length)))) : Math.floor(rnd() * i)
          if (t !== i) to.push(`笔记${t}`)
        }
        put(vault, path(i), `# 笔记${i}\n\n第 ${i} 篇。\n\n${to.map((x) => `讲到 [[${x}]]。`).join('\n')}\n`)
      }
      const d = new Date(Date.UTC(2024, 10, 25) + c * 30 * 86_400_000)
      commitAt(vault, d.toISOString().slice(0, 19), `第 ${c + 1} 批`)
    }
    put(vault, '收件箱/最后一篇.md', '# 最后一篇\n')
  }
}
