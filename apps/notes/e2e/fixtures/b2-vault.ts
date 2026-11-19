/**
 * 2026-11-18 顶级分类、文件夹封面方案（B-左栏与文件夹 v2）小样里的那个库：八个分类（收件箱 | 课程 阅读 剪藏 | 周记 写作 项目 生活），
 * 课程下 ecpc、机器学习两门课，项目下冰岛旅行、搬家，最外层几篇不在分类里的。withTimes 把修改时间摊成小样里的「今天 10:34、昨天、周四…」。
 */
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { lecturePdf } from './pdf'

const board = (color: string, cards: [number, number, string][]) =>
  `---\ntype: board\ncolor: ${color}\n---\n` + cards.map(([x, y, t], i) => `<!-- card id=c${i} x=${x} y=${y} w=220 -->\n${t}\n`).join('\n')
const pdf = (title: string, pages: number) => lecturePdf(Array.from({ length: pages }, (_, i) => ({ title: i ? `${title} ${i + 1}` : title, lines: ['Spiking neurons fire when the membrane potential crosses a threshold.'] })))
const note = (title: string, body = '这一篇的正文。') => `# ${title}\n\n${body}\n`

export const B2_VAULT: Record<string, string | Buffer> = {
  '收件箱/周三组会要问的.md': note('周三组会要问的', '问一下数据集的划分。'),
  '收件箱/一个 App 的点子.md': note('一个 App 的点子'),
  '收件箱/Kindle 导出的标注.md': note('Kindle 导出的标注'),
  '收件箱/拍的白板 11月15日.md': note('拍的白板 11月15日'),
  '课程/ecpc/Lecture05.pdf': pdf('Lecture 05 Spiking neurons', 2),
  '课程/ecpc/Lecture05 笔记.md': '---\n进度: 2/2\n---\n# Lecture05 笔记\n\n第 1 页：为什么阈值决定放电。\n',
  '课程/ecpc/我的疑惑.md': note('我的疑惑'),
  '课程/机器学习/Lecture01.pdf': pdf('Lecture 01 Introduction', 3),
  '课程/机器学习/第1讲 笔记.md': note('第1讲 笔记'),
  '项目/冰岛旅行/冰岛十天环岛.md': board('#3F8A78', [[0, 0, '## 第 1 天'], [260, 0, '## 第 2 天'], [520, 0, '## 第 3 天']]),
  '项目/冰岛旅行/住哪.md': note('住哪', '维克镇小木屋，离黑沙滩十分钟。'),
  '项目/冰岛旅行/预算.md': note('预算', '机票 4,200，租车 6,800。'),
  '项目/冰岛旅行/Check road conditions.md': note('Check road conditions', 'road.is 每天更新封路信息。'),
  '项目/搬家/要买的.md': note('要买的'),
  '项目/搬家/看过的房子.md': note('看过的房子'),
  '阅读/趣说明朝276年/划线和想法.md': note('划线和想法'),
  '阅读/人类简史/读书笔记.md': note('读书笔记'),
  '阅读/长安的荔枝/划线和想法.md': note('划线和想法'),
  '剪藏/网页/Check road conditions in Iceland.md': '---\nsource: https://road.is\n---\n> Roads in the east are closed.\n',
  '剪藏/网页/Spiking neuron models.md': '---\nsource: https://example.org/snn\n---\n> Leaky integrate-and-fire.\n',
  '剪藏/视频/3Blue1Brown 神经网络.md': '---\nsource: https://www.youtube.com/watch?v=aircAruvnKk\n---\n> 神经网络是什么。\n',
  '剪藏/一段播客文字稿.md': note('一段播客文字稿'),
  '写作/游记/去冰岛之前要知道的十件事.md': note('去冰岛之前要知道的十件事', '冬天去冰岛，最要紧的是看天气和路况。'),
  '写作/游记/京都三日.md': note('京都三日'),
  '写作/书评/《长安的荔枝》读后.md': note('《长安的荔枝》读后'),
  '写作/投稿清单.md': note('投稿清单'),
  '周记/2026 第46周.md': note('2026 第46周'),
  '周记/2026 第45周.md': note('2026 第45周'),
  '周记/2026 第44周.md': note('2026 第44周'),
  '生活/健康/体检 2026.md': note('体检 2026'),
  '生活/理财/每月记账.md': note('每月记账'),
  '生活/菜谱.md': note('菜谱'),
  '视频里的疑惑.md': note('视频里的疑惑'),
  '未命名.md': note('未命名', ''),
  '未命名白板.md': board('#7D5BA6', []),
}

const DAY = 86400_000
/** 修改时间摊开（今天、昨天、这周、上个月），小样里那几行时间有东西对 */
export function withTimes(vault: string) {
  const now = Date.now()
  const at = (rel: string, daysAgo: number) => {
    const t = (now - daysAgo * DAY) / 1000
    utimesSync(join(vault, rel), t, t)
  }
  const ages: [string, number][] = [
    ['收件箱/周三组会要问的.md', 0],
    ['收件箱/一个 App 的点子.md', 1],
    ['收件箱/Kindle 导出的标注.md', 3],
    ['收件箱/拍的白板 11月15日.md', 5],
    ['课程/ecpc/Lecture05 笔记.md', 0],
    ['项目/冰岛旅行/住哪.md', 0],
    ['项目/冰岛旅行/预算.md', 2],
    ['写作/游记/去冰岛之前要知道的十件事.md', 1],
    ['写作/书评/《长安的荔枝》读后.md', 36],
    ['周记/2026 第46周.md', 2],
    ['生活/健康/体检 2026.md', 4],
  ]
  for (const [p, d] of ages) at(p, d)
}
