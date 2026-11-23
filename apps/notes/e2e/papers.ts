/**
 * 「读过的论文」那张表（task-cle3x）：8 列（标题、作者、年份、状态、标签、评分、读完日期、链接）、16 篇公开的体系结构论文，
 * 另有空表、120 条的「很多行」。对照截图（cle3x-table-shots）和格子焦点的测试（cle3x-grid-focus）用同一份。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 16 篇公开论文（标题、作者、年份是真的） */
export const PAPERS: [string, string, number, string, string[], number | '', string, string][] = [
  ['Algorithms for Scalable Synchronization', 'Mellor-Crummey, Scott', 1991, '读完', ['锁', '同步'], 5, '2026-04-20', 'https://doi.org/10.1145/103727.103729'],
  ['Efficient Synchronization Let Them Eat QOLB', 'Kägi, Burger, Goodman', 1997, '读完', ['锁', '缓存一致性'], 4, '2026-04-22', 'https://doi.org/10.1145/264107.264166'],
  ['GLocks for Highly-Contended Locks', 'Abellán, Fernández, Acacio', 2011, '读完', ['锁', '片上网络'], 4, '2026-04-24', 'https://doi.org/10.1109/TPDS.2010.158'],
  ['NUMA An Overview', 'Lameter', 2013, '读完', ['NUMA'], 3, '2026-04-18', 'https://queue.acm.org/detail.cfm?id=2513149'],
  ['MAGIC Memristor-Aided Logic', 'Kvatinsky et al.', 2014, '读完', ['存内计算'], 4, '2026-05-10', 'https://doi.org/10.1109/TCSII.2014.2357292'],
  ['SIMPLER MAGIC', 'Ben-Hur et al.', 2020, '在读', ['存内计算', '综合'], '', '', 'https://doi.org/10.1109/TCAD.2019.2931188'],
  ['A Primer on Memory Consistency and Cache Coherence', 'Sorin, Hill, Wood', 2011, '在读', ['缓存一致性', '一致性模型'], '', '', 'https://doi.org/10.2200/S00346ED1V01Y201104CAC016'],
  ['Shared Memory Consistency Models A Tutorial', 'Adve, Gharachorloo', 1996, '读完', ['一致性模型'], 5, '2026-05-02', 'https://doi.org/10.1109/2.546611'],
  ['How to Make a Multiprocessor Computer', 'Lamport', 1979, '读完', ['一致性模型'], 5, '2026-04-30', 'https://doi.org/10.1109/TC.1979.1675439'],
  ['Transactional Memory', 'Herlihy, Moss', 1993, '待读', ['锁', '事务内存'], '', '', 'https://doi.org/10.1145/165123.165164'],
  ['Roofline', 'Williams, Waterman, Patterson', 2009, '读完', ['性能模型'], 4, '2026-03-15', 'https://doi.org/10.1145/1498765.1498785'],
  ['NVIDIA Tesla Unified Graphics and Computing', 'Lindholm et al.', 2008, '在读', ['GPU'], '', '', 'https://doi.org/10.1109/MM.2008.31'],
  ['Ambit In-Memory Bulk Bitwise Operations', 'Seshadri et al.', 2017, '待读', ['存内计算', 'DRAM'], '', '', 'https://doi.org/10.1145/3123939.3124544'],
  ['PIM-Enabled Instructions', 'Ahn et al.', 2015, '待读', ['存内计算'], '', '', 'https://doi.org/10.1145/2749469.2750385'],
  ['Memory Coherence in Shared Virtual Memory', 'Li, Hudak', 1989, '待读', ['缓存一致性', '分布式'], '', '', 'https://doi.org/10.1145/75104.75105'],
  ['Spectre Attacks', 'Kocher et al.', 2019, '待读', ['安全'], '', '', 'https://doi.org/10.1109/SP.2019.00002'],
]

export const note = (p: (typeof PAPERS)[number]) => {
  const [, 作者, 年份, 状态, 标签, 评分, 读完日期, 链接] = p
  return (
    `---\n作者: ${作者}\n年份: ${年份}\n状态: ${状态}\n标签: [${标签.join(', ')}]\n` +
    (评分 === '' ? '' : `评分: ${评分}\n`) +
    (读完日期 ? `读完日期: ${读完日期}\n` : '') +
    `链接: ${链接}\n---\n\n## 要点\n\n读的时候记在这里。\n`
  )
}

export const base = (folder: string, extra = '') => `filters:
  and:
    - file.inFolder("${folder}")
properties:
  状态:
    type: select
  标签:
    type: multi
  评分:
    type: number
  读完日期:
    type: date
  链接:
    type: url
views:
  - type: table
    name: 全部
    order:
      - file.name
      - 作者
      - 年份
      - 状态
      - 标签
      - 评分
      - 读完日期
      - 链接${extra}
  - type: kanban
    name: 看板
    groupBy:
      property: 状态
      direction: ASC
  - type: calendar
    name: 日历
    date: 读完日期
  - type: cards
    name: 画廊
    image: none`

export const doc = (title: string, b: string) => `# ${title}\n\n这学期读的体系结构论文，读完打分。\n\n\`\`\`base\n${b}\n\`\`\`\n\n读完的写一段要点。\n`

export const FILES: Record<string, string> = {
  '论文/读过的论文.md': doc('读过的论文', base('论文/读过的')),
  '论文/空表.md': doc('空表', base('论文/空的')),
  '论文/空的/.keep': '',
  '论文/很多行.md': doc('很多行', base('论文/很多')),
}
for (const p of PAPERS) FILES[`论文/读过的/${p[0]}.md`] = note(p)
for (let i = 0; i < 120; i++) {
  const p = PAPERS[i % PAPERS.length]!
  FILES[`论文/很多/${String(i + 1).padStart(3, '0')} ${p[0]}.md`] = note(p)
}

export const skin = (dark: boolean) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: dark ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

