/** 右栏「相关」的样本库（task-h7oy8）：照设计页 44 用的 HPDC《05-Amdahl定律》那一组，提到它的、梦游连的、判过像的都有 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const T = '课程/HPDC/05-Amdahl定律.md'
export const AMDAHL = [
  '# 05-Amdahl定律',
  '',
  '程序里不能并行的那一部分，决定了加速比的天花板。',
  '',
  '## 2. Amdahl 定律公式',
  '',
  '加速比 a = 1/(s + p/N)，N 趋于无穷时 a 趋于 1/s。',
  '',
  'Gustafson 的反驳在下一篇：问题跟着 N 变大时，加速比接近 N。',
  '',
  '## 3. 数值表',
  '',
  '| s | 上限 |',
  '|---|---|',
  '| 1% | 100 |',
  '',
  '串行占 1% 时最多快 100 倍。 ^tab1',
  '',
].join('\n')
export const GUS = '课程/HPDC/术语表/Gustafson-Law（古斯塔夫森定律）.md'
export const SPEED = '课程/HPDC/术语表/Speedup（加速比）.md'
export const GPU = '课程/GPU/Amdahls-Law.md'
export const GPU_MD = "# Amdahl's Law\n\n它告诉我们专注于减少串行部分：数据传输、内核启动开销和同步点。\n\n相关：[[05-Amdahl定律]]\n"

export const FILES: Record<string, string> = {
  [T]: AMDAHL,
  '课程/HPDC/参考书/10-Amdahl定律（H&P视角）.md': '# 10-Amdahl定律（H&P视角）\n\nH&P 从「只优化一部分」讲同一条定律：[[05-Amdahl定律]] 和 06-Gustafson定律 从 HPC 的角度讨论了这两个定律。\n',
  '课程/HPDC/练习/02-Amdahl-Webserver.md': '# 02-Amdahl-Webserver\n\n这题拿 [[05-Amdahl定律#2. Amdahl 定律公式|Amdahl 定律（最对口的原子）]] 算三个子问。\n',
  '课程/HPDC/术语表/Amdahl-Law.md': '# Amdahl-Law\n\n一句话：上限 = 1/s。详细推导和数值表见 [[05-Amdahl定律#^tab1|数值表那一段]]。\n',
  '课程/HPDC/术语表/HPC.md': '# HPC\n\n高性能计算的根本限制：\n\n![[05-Amdahl定律]]\n',
  '课程/HPDC/04-Moore定律.md': '# 04-Moore定律\n\n晶体管每两年翻一倍。\n\n下一篇：[[05-Amdahl定律]]\n',
  '课程/HPDC/00-Hub.md': '# 00-Hub\n\n- [[04-Moore定律]]\n- [[05-Amdahl定律]]\n- [[02-线性亚线性超线性缩放]]\n',
  [GPU]: GPU_MD,
  '课程/HPDC/02-线性亚线性超线性缩放.md': '# 02-线性亚线性超线性缩放\n\n理想情况 400 包/小时，现实是亚线性 320 包/小时。\n\n相关：[[05-Amdahl定律]]\n',
  [GUS]: '# Gustafson-Law（古斯塔夫森定律）\n\n问题规模随 N 同比例扩大时，加速比约等于 N，突破 Amdahl 悲观结论。\n',
  [SPEED]: '# Speedup（加速比）\n\n加速比 a = t_ser/t_par：串行时间除以并行时间，理想值是 N。\n',
  '课程/HPDC/MCC/03-Partial-Product.md': '# 03-Partial-Product\n\n部分积压缩用 Wallace 树。\n',
}
for (let i = 1; i <= 14; i++) FILES[`生活/随手 ${i}.md`] = `# 随手 ${i}\n\n今天第 ${i} 件小事：买菜、散步、读了一会儿书。\n`

export const key = (root: string) => createHash('sha1').update(root).digest('hex').slice(0, 16)
export const NIGHT = new Date('2026-11-22T23:30:00').getTime()

/** 梦游跑过一晚留下的：报告里 GPU 那篇的补双链收下了；判断进度里判过三对（两对相关、一对无关） */
export function dreamState(vault: string) {
  const ud = join(dirname(vault), 'user-data', 'dream')
  mkdirSync(ud, { recursive: true })
  const report = {
    branch: 'dream/11-22',
    base: 'main',
    baseCommit: '',
    started: NIGHT,
    finished: NIGHT + 600_000,
    trigger: 'idle',
    notes: [],
    closed: true,
    items: [
      {
        id: 'k1',
        group: 'link',
        title: "Amdahl's Law",
        sub: '↔ [[05-Amdahl定律]]',
        why: '两门课讲同一条定律；那篇多讲了 GPU 上的串行瓶颈。只在这篇末尾加一行，「05-Amdahl定律」那篇不改',
        commit: null,
        files: [GPU],
        state: 'taken',
        judged: { level: 'same-topic', confidence: 0.9, a: { path: GPU, quote: '它告诉我们专注于减少串行部分：数据传输、内核启动开销和同步点。' }, b: { path: T, quote: '程序里不能并行的那一部分，决定了加速比的天花板。' } },
      },
    ],
  }
  writeFileSync(join(ud, key(vault) + '.json'), JSON.stringify(report))
  const pair = (b: string, level: string, confidence: number, why: string, quoteA: string, quoteB: string) => ({ a: T, b, level, confidence, why, quoteA, quoteB, at: NIGHT })
  const ledger = {
    version: 1,
    pairs: {
      p1: pair(GUS, 'same-topic', 0.86, '和这篇对着讲的另一条定律：问题跟着 N 变大时，加速比接近 N', 'Gustafson 的反驳在下一篇：问题跟着 N 变大时，加速比接近 N。', '问题规模随 N 同比例扩大时，加速比约等于 N，突破 Amdahl 悲观结论。'),
      p2: pair(SPEED, 'same-topic', 0.7, '这篇的公式算的就是加速比；那篇给了定义', '加速比 a = 1/(s + p/N)，N 趋于无穷时 a 趋于 1/s。', '加速比 a = t_ser/t_par：串行时间除以并行时间，理想值是 N。'),
      p3: pair('课程/HPDC/MCC/03-Partial-Product.md', 'unrelated', 0.9, '无关', '', ''),
    },
    done: {},
    nights: {},
    rejected: [],
    kept: [],
  }
  writeFileSync(join(ud, key(vault) + '.ledger.json'), JSON.stringify(ledger))
}
