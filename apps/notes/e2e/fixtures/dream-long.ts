/**
 * 梦游对照滚动卡（梦游对比滚动）用的样本，照用户截图那一条的规模造：一篇三千多行的长笔记《学习笔记：动手学深度学习》，
 * 有标题、列表、粗体、引用、提示块、长段落（会折行），梦游分支上那次提交改了 36 处（标题 1 处，改字、加段、删段 35 处）。
 * 用户截图里那一条是「可以建的词条页」，那是只是提醒的条目、本来就不该按字比（梦游对照复审改成两篇整篇并排），
 * 这里换成一条真有提交的改动（本周小结），对照还是同样规模的两版长文。
 * 报告不跑梦游，直接写进测试实例的 user-data/dream/<库的键>.json（梦游那边的读法，dream-main.ts reportFile）；
 * 那次提交在 prepare 里真提交到 dream/11-24 分支上。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LONG_B = '课程/study project 2/学习笔记：动手学深度学习.md'
export const LONG_CHANGES = 36

const words = ['监督学习', '训练集', '标签', '损失函数', '梯度下降', '过拟合', '正则化', '卷积', '注意力', '序列模型', 'Bi-LSTM', 'GAT', '时空图', '批量归一化', '学习率']
const para = (i: number) =>
  `${words[i % words.length]}这一段讲第 ${i} 个要点：给模型的数据集里每个样本都带着真实标签，很多重要任务都能归结为根据已有数据估计某个未知事物的概率；` +
  `**${words[(i + 3) % words.length]}**和\`${words[(i + 7) % words.length]}\`放在一起看，才知道为什么要这么做，换个例子再想一遍就通了。`

/** 一篇长笔记：sections 节，每节一个标题、四段字、一个列表、一段引用，隔几节一个提示块 */
function longDoc(title: string, sections: number): string[] {
  const out = [`# ${title}`, '']
  for (let s = 0; s < sections; s++) {
    out.push(`## 第 ${s + 1} 节 · ${words[s % words.length]}`, '')
    for (let k = 0; k < 4; k++) out.push(para(s * 10 + k), '')
    out.push(`- ${words[s % words.length]}：先从大量样本里选一部分`, `- 把训练集交给监督学习算法，得到一个训练好的模型`, `- 把没见过的新样本输入模型，输出就是对标签的预测`, '')
    out.push(`> 第 ${s + 1} 节的小结：讲清楚了这一节在做什么。`, '')
    if (s % 5 === 0) out.push('> [!note] 说穿', `> 第 ${s + 1} 节最容易卡的一步是「${words[(s + 2) % words.length]}」。`, '')
  }
  return out
}

/** 左边那篇（改前）和右边那篇（收下后）：右边改了 36 处（标题，再轮着改字、加一段、删一段 35 处） */
export function longPair(sections = 160): { a: string; b: string } {
  const a = longDoc('YitingWei_2026_J52_SAGE_stress_workload_JBHI 笔记', sections)
  const b = [...a]
  b[0] = '# 学习笔记：动手学深度学习'
  // 从后往前改，前面的行号不动
  const step = Math.floor(sections / LONG_CHANGES)
  for (let n = LONG_CHANGES - 2; n >= 0; n--) {
    const s = n * step + 1
    const at = b.indexOf(`## 第 ${s} 节 · ${words[(s - 1) % words.length]}`)
    const p = at + 2
    if (n % 3 === 0) b[p] = b[p]!.replace('这一段讲', '这一段改成讲').replace('换个例子', '换两个例子')
    else if (n % 3 === 1) b.splice(p, 0, `新加的一段：第 ${s} 节补上${words[n % words.length]}的直观解释，从一个具体的例子说起，把公式里每一项对上图里的一块。`, '')
    else b.splice(p, 2)
  }
  return { a: a.join('\n') + '\n', b: b.join('\n') + '\n' }
}

const LONG = longPair()
/** main 上：那篇是改前的样子 */
export const LONG_VAULT: Record<string, string> = {
  [LONG_B]: LONG.a,
}

/**
 * launch 的 prepare 里调：main 上提交改前那版，dream/11-24 分支上提交改后那版（梦游那一条的提交），回到 main；
 * 测试实例 user-data 下写一份梦游报告，一条就是这次改动
 */
export function prepareLong(vault: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim()
  git('add', '-A')
  git('commit', '-q', '-m', '改前')
  git('checkout', '-q', '-b', 'dream/11-24')
  writeFileSync(join(vault, LONG_B), LONG.b)
  git('commit', '-q', '-am', '梦游：学习笔记：动手学深度学习 改了 36 处')
  const commit = git('rev-parse', 'HEAD')
  git('checkout', '-q', 'main')
  // launch 接着还要提交一次「样本」：给它一篇新的
  writeFileSync(join(vault, '所思所想.md'), '# 所思所想\n\nSeek wealth, not money or status.\n')
  const userData = join(dirname(vault), 'user-data')
  const now = Date.now()
  const report = {
    branch: 'dream/11-24',
    base: 'main',
    baseCommit: '',
    started: now - 60_000,
    finished: now,
    trigger: 'manual',
    notes: [],
    closed: false,
    items: [
      {
        id: 'week-1',
        group: 'week',
        title: '《学习笔记：动手学深度学习》',
        sub: '改了36处',
        why: '这周读的几节补上直观解释，改掉两处说法',
        commit,
        files: [LONG_B],
        state: 'pending',
      },
    ],
  }
  mkdirSync(join(userData, 'dream'), { recursive: true })
  // 库的键是库路径的 sha1（/var 和 /private/var 两种写法都写一份，软件按哪种认都找得到）
  for (const p of new Set([vault, realpathSync(vault)])) {
    const key = createHash('sha1').update(p).digest('hex').slice(0, 16)
    writeFileSync(join(userData, 'dream', key + '.json'), JSON.stringify(report, null, 2))
  }
}
