/** 白板和文档联动（task-vcov6）的样本库：冰岛十天环岛（type: board）、住宿数据库、收件箱两条、周记里嵌白板和一节 */
import { expect, type Page } from '@playwright/test'
import { pane, tabOn } from '../app'

export const TRAVEL = `---
type: board
---
# 冰岛十天环岛

## 出发前

- [x] 订机票
- [ ] 租四驱车
- [ ] 买防水外套

11 月白天只有 6 个小时左右，每天开车别超过 4 小时，天黑前到住处。

> 冰岛的天气五分钟一变。出门前看一眼 vedur.is，风速过了每秒 20 米就别上路。
—— [《在冰岛开车》 · 第二章 天气](https://example.com/drive)

## 住哪

南岸在维克住两晚，东边霍芬一晚，北边米湖两晚，最后回雷克雅未克住三晚。

## 路线

第 1 天雷克雅未克 → 黄金圈；第 2 天塞里雅兰瀑布 → 维克；第 4 天杰古沙龙冰河湖。

[[冰岛照片墙]]
`

const STAY = (name: string, city: string, nights: number, st: string) => `---\n城市: ${city}\n晚数: ${nights}\n状态: ${st}\n---\n`

export const FILES: Record<string, string> = {
  '项目/冰岛十天环岛.md': TRAVEL,
  '项目/冰岛照片墙.md': '---\ntype: board\ncolor: "#5d8fb0"\n---\n# 冰岛照片墙\n',
  '项目/住宿/Reykjavík 公寓.md': STAY('Reykjavík 公寓', '雷克雅未克', 3, '已订'),
  '项目/住宿/Vík Cottages.md': STAY('Vík Cottages', '维克', 2, '已订'),
  '项目/住宿/Hotel Höfn.md': STAY('Hotel Höfn', '霍芬', 1, '待订'),
  '项目/住宿/Mývatn 小屋.md': STAY('Mývatn 小屋', '米湖', 2, '待订'),
  '项目/住宿/Kirkjufell 民宿.md': STAY('Kirkjufell 民宿', '斯奈山', 1, '考虑'),
  '项目/住宿.md': '# 住宿\n\n```base\nfilters:\n  and:\n    - file.inFolder("项目/住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 城市\n      - 晚数\n      - 状态\n```\n',
  '收件箱/Geography of Iceland.md': '---\ncreated: 2026-11-21 10:12\nsource: https://en.wikipedia.org/wiki/Geography_of_Iceland\n---\n# Geography of Iceland\n\n冰岛位于北大西洋和北冰洋交汇处，面积约 10.3 万平方公里，一成多的国土被冰川覆盖，海岸线约 4970 公里。\n',
  '收件箱/蓝湖温泉要提前两周订.md': '蓝湖温泉要提前两周订，周末更紧。\n',
  '周记/2026-W47.md': '# 2026-W47\n\n这周把冰岛的行程定下来了，住的还差两晚没订。\n\n## 冰岛\n\n![[冰岛十天环岛]]\n\n![[冰岛十天环岛#出发前]]\n\n下周：问一下租车要不要加沙尘险。\n',
}

export const board = (page: Page) => pane(page).getByTestId('doc-board')
export const col = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true })

/** ⌘O 按名字跳过去（白板默认白板看法） */
export async function openBoard(page: Page, title: string) {
  await page.keyboard.press('Meta+o')
  const quick = page.getByRole('dialog', { name: '按名字跳到' })
  await quick.getByRole('textbox', { name: '按名字跳到文件' }).fill(title)
  await quick.getByRole('option').filter({ hasText: title }).first().click()
  await expect(tabOn(page)).toHaveText(title)
}

