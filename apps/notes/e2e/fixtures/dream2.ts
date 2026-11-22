/**
 * 梦游重新设计（task-m552v）用的样本库，照录屏里那份库的样子造：
 * - 课程里一份 PDF 和它的读 PDF 笔记（新写法，四页；今天在第 2 页问了两问 → 梦游做一个可视化，嵌在第 2 页那段末尾，后面还有两页）；
 * - 收件箱里一篇从视频剪来的「极光」（带来源、两张图、四十多行字幕；和「极光预报」讲同一件事 → 补双链补在它末尾；
 *   剪藏/旅行/ 里已经有一篇同名的 → 归类挪过去改叫「极光 2」，标题、图片地址跟着改，别的笔记里的 [[极光]] 跟着换）；
 * - 收件箱里「冰洞」（只挪不改名）、「巴黎自由行全景指南」（挪动，也和剪藏里一篇可能重复）、一句拿不准的；
 * - 剪藏/ 里剪下来的几篇，一篇自己写的作品。
 * 假 AI（CN_AI_FAKE=1）梦游一次出 8 条：归类和改名 3、可视化 1、补上的双链 1、可能重复 1、本周小结 1（再加拿不准的 1 条留着）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { newReadingNote, renderSection, type AskSection, withDerived } from '@cn/format'
import { LECTURE } from './pdf'
import { solidPng } from './png'

export const COURSE = '课程/study project 2'
export const PDF = `${COURSE}/YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC.pdf`
export const NOTE = `${COURSE}/YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 笔记.md`
export const AURORA = '收件箱/极光.md'
export const AURORA_OLD = '剪藏/旅行/极光.md'
export const TRIP = '剪藏/旅行/冰岛行程.md'

const sec = (page: number, title: string, qs: string[], time: string): AskSection =>
  withDerived({
    id: `.canvas-notes/对话/YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC-p${page}-1.md`,
    file: PDF,
    page,
    title,
    time,
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas: qs.map((q, i) => ({ q, a: `第 ${page} 页第 ${i + 1} 问的回答：${'这一段讲得很细，'.repeat(6)}最后落到一个例子上。`, sides: [] })),
    recap: `第 ${page} 页的小结：讲清楚了这一页在做什么。`,
  })

/** 读 PDF 的笔记：第 1、2、3、4 页各一段，第 2 页问了两问（梦游挑它做可视化） */
export const NOTE_MD =
  newReadingNote(PDF, new Date(2026, 10, 21)) +
  [
    sec(1, '这篇在做什么', ['为什么是这五个信号，不加脑电？'], '09:52'),
    sec(2, '两条贡献与数据预处理', ['“动态时空流”里的“时”和“空”各指什么？', '还是不懂，换个方式讲'], '10:20'),
    sec(3, '每一步的数据形状', ['为什么卷积后正好是 61？'], '10:41'),
    sec(4, '结果', ['去掉 GAT 掉几个点？'], '11:02'),
  ]
    .map((s) => '\n' + renderSection(s, NOTE))
    .join('')

const subs = Array.from({ length: 40 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'} 第 ${i + 1} 句字幕：冰岛的冬天很长，${['黑沙滩', '冰川湖', '间歇泉', '维克小镇'][i % 4]}在雪里。`)

/** 收件箱里从视频剪来的一篇：带来源、两张图（相对地址，挪了要跟着改）、四十句字幕；中间一句和「极光预报」讲同一件事 */
export const AURORA_MD = `---
source: https://www.youtube.com/watch?v=aurora
created: 2026-11-21 22:40
---
# 极光

视频 · youtube.com · 剪于 11-21 22:40

![封面 · 28:39](../附件/视频/极光/封面.png)

## 记下的时刻

- 01:06 · 云量低于三成、KP 指数到 3 以上就值得出门，维克附近光污染少

![01:06 的画面](../附件/视频/极光/0106.png)

## 字幕原文

${subs.join('\n\n')}
`

export const DREAM2_VAULT: Record<string, string | Uint8Array> = {
  [PDF]: LECTURE,
  '所思所想.md': '# 所思所想\n\nSeek wealth, not money or status.\n',
  '极光预报.md': '# 极光预报\n\n每天下午看冰岛气象局的云量图，云量低于三成、KP 指数到 3 以上就开车去黑沙滩等。\n',
  [AURORA]: AURORA_MD,
  '附件/视频/极光/封面.png': solidPng(320, 180, [40, 70, 110]),
  '附件/视频/极光/0106.png': solidPng(320, 180, [90, 60, 120]),
  [AURORA_OLD]: '---\nsource: https://www.youtube.com/watch?v=old\n---\n# 极光\n\n去年剪的一段：极光要等天晴。\n',
  [TRIP]: '---\nsource: https://example.com/trip\n---\n# 冰岛行程\n\n## 记下的时刻\n\n- 01:06 · [[极光]]\n- 03:40 · 黑沙滩\n',
  '收件箱/冰洞.md': '---\ncreated: 2026-11-14 21:10\n---\n冰洞只在冬天开放，必须跟导游进去，提前两周订。\n',
  '收件箱/巴黎自由行全景指南.md':
    '# 巴黎自由行全景指南\n\n第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。\n第二天去卢浮宫，留一整天。\n',
  '收件箱/一句没头没尾的话.md': '---\ncreated: 2026-11-20 08:00\n---\n那个东西明天再说。\n',
  '剪藏/巴黎/巴黎深度漫游指南.md':
    '---\nsource: https://example.com/paris\n---\n# 巴黎深度漫游指南（上）\n\n第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。\n晚上去圣日耳曼的小酒馆吃饭。\n',
}

const commit = (vault: string, m: string) => {
  execFileSync('git', ['-C', vault, 'add', '-A'])
  execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', m])
}

/**
 * 今天在第 2 页问过（记笔记的那次提交），梦游才挑它做可视化；launch 的 prepare 里调。
 * 样本先提交一次，笔记单独一次「笔记：… 第 2 页 · …」，最后留一篇自己写的给 launch 那次提交
 */
export function prepareDream2(vault: string) {
  commit(vault, '样本')
  const abs = join(vault, NOTE)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, NOTE_MD)
  commit(vault, '笔记：YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 第 2 页 · 两条贡献与数据预处理')
  mkdirSync(join(vault, '写作'), { recursive: true })
  writeFileSync(join(vault, '写作/草稿.md'), '# 草稿\n\n还没想好写什么。\n')
}
