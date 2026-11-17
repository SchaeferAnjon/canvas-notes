/**
 * 左栏重组（2026-11-17）的测试库：写作（游记、书评、专栏、一块白板）、课程/ecp（两份课件）、
 * 素材/冰岛旅行（三个子文件夹、两块白板、两份 PDF、七篇摘录）、极光摄影、书摘、项目、生活、收件箱、最外层一块白板。
 * withTimes 把修改时间摊开：今天、这周、十月、九月，左栏「最近」的几组都有东西。
 */
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { ICELAND } from './board'
import { lecturePdf } from './pdf'

const board = (color: string, cards: [number, number, string][]) =>
  `---\ntype: board\ncolor: ${color}\n---\n` + cards.map(([x, y, t], i) => `<!-- card id=c${i} x=${x} y=${y} w=220 -->\n${t}\n`).join('\n')

const pdf = (title: string, pages: number) =>
  lecturePdf(Array.from({ length: pages }, (_, i) => ({ title: i ? `${title} ${i + 1}` : title, lines: ['Road conditions change fast in winter.', 'Check road.is before you leave.'] })))

const ICE = '素材/冰岛旅行'
export const LEFT_VAULT: Record<string, string | Buffer> = {
  '写作/游记/去冰岛之前要知道的十件事.md': '# 去冰岛之前要知道的十件事\n\n冬天去冰岛，最要紧的是看天气和路况。\n',
  '写作/游记/一个人的东京.md': '# 一个人的东京\n\n清晨的筑地已经搬走了，但丰洲的金枪鱼拍卖还在。\n',
  '写作/游记/京都三日.md': '# 京都三日\n\n第一天走哲学之道，第二天岚山，第三天伏见稻荷。\n',
  '写作/游记/冬天的赫尔辛基.md': '# 冬天的赫尔辛基\n\n下午三点天就黑了，桑拿房里却很热闹。\n',
  '写作/书评/人类简史.md': '# 人类简史\n\n认知革命那一章写得最好。\n',
  '写作/书评/长安的荔枝.md': '# 长安的荔枝\n\n一个小吏的五千里荔枝路。\n',
  '写作/书评/明朝那些事儿.md': '# 明朝那些事儿\n\n把历史写成了连载小说。\n',
  '写作/专栏/每月一城.md': '# 每月一城\n\n这个月写雷克雅未克。\n',
  '写作/专栏/慢慢走.md': '# 慢慢走\n\n走路是最好的看城市的方式。\n',
  '写作/写作计划.md': board('#B8743A', [[0, 0, '## 十一月'], [260, 0, '## 十二月'], [520, 0, '## 想写的'], [0, 220, '冰岛'], [260, 220, '书评']]),
  '写作/投稿清单.md': '# 投稿清单\n\n《旅行家》12 月截稿 · 《读库》开放投稿 · 公众号每周一篇\n',
  '写作/写作习惯.md': '# 写作习惯\n\n每天早上 45 分钟，先写再改；周日整理一周的素材。\n',
  '课程/ecp/Lecture05.pdf': pdf('Lecture 05', 5),
  '课程/ecp/Lecture05 笔记.md': '---\n进度: 5/5\n---\n# Lecture05 笔记\n\n第 3 页：为什么特征值决定稳定性。\n',
  '课程/ecp/Lecture06.pdf': pdf('Lecture 06', 4),
  [`${ICE}/住宿/维克镇小木屋.md`]: '# 维克镇小木屋\n\n离黑沙滩十分钟。\n',
  [`${ICE}/住宿/雷克雅未克青旅.md`]: '# 雷克雅未克青旅\n\n在老城区，走路去哈尔格林姆斯教堂。\n',
  [`${ICE}/住宿/蓝湖酒店.md`]: '# 蓝湖酒店\n\n贵，但是早餐好。\n',
  [`${ICE}/路线/一号公路东段.md`]: '# 一号公路东段\n\n冬天常封路，出门前看 road.is。\n',
  [`${ICE}/路线/斯奈山半岛.md`]: '# 斯奈山半岛\n\n草帽山在半岛北边。\n',
  [`${ICE}/美食/热狗摊.md`]: '# 热狗摊\n\nBæjarins Beztu，要全套酱。\n',
  [`${ICE}/美食/龙虾汤.md`]: '# 龙虾汤\n\n斯托克塞里那家最出名。\n',
  [`${ICE}/冰岛十天环岛.md`]: ICELAND.replace('color: #4A7FA7', 'color: #3F8A78'),
  [`${ICE}/预算.md`]: board('#B8743A', [[0, 0, '机票 4,200'], [260, 0, '租车 6,800'], [0, 200, '住宿'], [260, 200, '吃饭']]),
  [`${ICE}/冰岛自驾指南.pdf`]: pdf('Iceland Road Guide', 6),
  [`${ICE}/冰岛自驾指南 笔记.md`]: '---\n进度: 3/6\n---\n# 冰岛自驾指南 笔记\n\n第 3 页讲冬天的路况。\n',
  [`${ICE}/Lonely Planet 冰岛.pdf`]: pdf('Lonely Planet Iceland', 3),
  [`${ICE}/一、最佳旅游季节.md`]: '# 一、最佳旅游季节\n\n> 夏季白昼长，适合自驾环岛；冬季看极光，路况差。\n',
  [`${ICE}/蓝湖温泉要提前订.md`]: '# 蓝湖温泉要提前订\n\n官网提前两周订票，周末上午最挤。\n',
  [`${ICE}/一号公路冬季路况.md`]: '# 一号公路冬季路况\n\nroad.is 每天更新封路信息。\n',
  [`${ICE}/冰岛物价参考.md`]: '# 冰岛物价参考\n\n一碗汤大概 2,500 克朗。\n',
  [`${ICE}/黄金圈一日路线.md`]: '# 黄金圈一日路线\n\n辛格维利尔、间歇泉、黄金瀑布。\n',
  [`${ICE}/极光预报怎么看.md`]: '# 极光预报怎么看\n\n云量图上绿色越少越好。\n',
  '素材/极光摄影/三脚架怎么选.md': '# 三脚架怎么选\n\n碳纤维的轻，但贵。\n',
  '素材/书摘/人类简史摘录.md': '# 人类简史摘录\n\n> 我们没有驯化小麦，是小麦驯化了我们。\n',
  '项目/canvas/计划.md': '# 计划\n\n这周把左栏做完。\n',
  '生活/日记.md': '# 日记\n\n今天下雪了。\n',
  '收件箱/冰岛旅游 2.md': '# 冰岛旅游 2\n\n十天环岛，二月底出发，冬天开一号公路。\n',
  '未命名白板.md': board('#8A5DB0', []),
}

const DAY = 86400_000
/** 修改时间摊开（几天前）：没写到的放在 40 天前 */
const AGE: Record<string, number> = {
  '收件箱/冰岛旅游 2.md': 0.003,
  '课程/ecp/Lecture05 笔记.md': 0.006,
  '未命名白板.md': 0.009,
  [`${ICE}/预算.md`]: 2,
  [`${ICE}/一、最佳旅游季节.md`]: 3,
  [`${ICE}/冰岛十天环岛.md`]: 4,
  '写作/游记/去冰岛之前要知道的十件事.md': 1,
  '写作/写作计划.md': 5,
  '生活/日记.md': 60,
  '项目/canvas/计划.md': 70,
}

export function withTimes(vault: string, now = Date.now()) {
  for (const p of Object.keys(LEFT_VAULT)) {
    const t = (now - (AGE[p] ?? 40) * DAY) / 1000
    utimesSync(join(vault, p), t, t)
  }
}
