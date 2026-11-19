/**
 * 文档切到白板的两篇样稿（照 doc-to-board 方向 A 小样里的「Lecture05 笔记」「冰岛十天环岛」）：
 * 富内容都有（PDF 页、公式、问过 AI 带框的截图、数据库、书摘、网页引文、整页剪藏、嵌入的笔记、HTML 链接、白板链接、视频和时刻），
 * 连同它们指向的文件（PDF、截图、数据库的每一条、剪藏、白板）一起放进临时库。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lecturePdf } from './pdf'
import { solidPng } from './png'

const COVERS = join(__dirname, '../../src/renderer/assets/covers')
const cover = (name: string) => readFileSync(join(COVERS, name + '.jpg'))

export const LECTURE_NOTE = `# Lecture05 笔记

ECP 第 5 讲：从计算栈看为什么要专用加速器。课件 [[Lecture05.pdf]]，43 页，问到第 12 页。

> [!note] 这讲的主线
> 通用 CPU 什么都能算，可每次运算的电大多花在取指令、搬数据上；
> 加速器把这两样省掉，所以又快又省。

## 这一讲讲什么

计算栈从上到下九层：应用、算法、语言、操作系统、指令集、微架构、电路、器件、物理。**越往下改，越快越省，也越不通用。**

| 方案 | 能做的事 | 每次运算的电 |
|---|---|---|
| 通用 CPU | 什么都行 | 最多 |
| GPU | 大批同样的运算 | 少一些 |
| FPGA | 能改线路 | 居中 |
| 专用加速器 | 只做一件事 | 最少 |
| TPU | 矩阵乘法 | 很少 |

![[Lecture05.pdf#page=3]]

***

课上老师说：别背九层的名字，记住「往下走 = 用通用换效率」。

## 第 3 页 · 计算栈为什么分成九层
[第 3 页](Lecture05.pdf#page=3) · 10:20

![我框的](../../附件/Lecture05/p3-1.png)

> [!question] 我的疑惑
> 为什么偏偏是九层？微架构和指令集到底差在哪

> [!success] 讲通的讲法（第 2 版）
> 把它想成盖楼：指令集是「图纸上的房间」，微架构是「这栋楼实际怎么砌」。同一张图纸能砌出好几栋楼，所以两层要分开。层数不是定死的，九层只是这门课的分法。

- 指令集 = 软件看得到的约定
- 微架构 = 同一约定的不同实现
- 层数是讲法，不是标准

<details><summary>没讲通 · 第 1 版：用 CPU 和 GPU 跑矩阵乘法类比工厂车间</summary>

原来的讲法：CPU 像一个大厨，GPU 像一屋子学徒。

</details>

[完整对话 · 2 轮](../../.canvas-notes/对话/Lecture05-p3-1.md)

## 第 5 页 · 矩阵乘法在 GPU 上为什么快
[第 5 页](Lecture05.pdf#page=5&rect=0.46,0.2,0.5,0.6) · 10:34

![我框的](../../附件/Lecture05/p5-1.png)

> [!question] 我的疑惑
> GPU 的核更慢，为什么整体反而快

> [!success] 讲通的讲法
> 矩阵乘法能拆成成千上万个互不相干的小乘法。CPU 是 4 个大厨轮流做，GPU 是几千个学徒同时做；每个学徒慢一点，但一起上就快得多。

[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture05-p5-1.md)

## 第 12 页 · 搬一次数据比算一次还费电？
[第 12 页](Lecture05.pdf#page=12) · 11:02

> [!question] 我的疑惑
> DRAM 读一次真的是加法的几千倍？

> [!success] 讲通的讲法
> 对，量级就是这样：加一次约 0.1 皮焦，从内存条读一次约 640 皮焦。所以加速器拼命把数据留在芯片上的小内存里，少跑远路。

[完整对话 · 3 轮](../../.canvas-notes/对话/Lecture05-p12-1.md)

## 用代码验证

拿 numpy 算一次 2048 × 2048 的矩阵乘法，CPU、GPU 各跑一遍：

\`\`\`python
import numpy as np, cupy as cp, time

n = 2048
a = np.random.rand(n, n).astype(np.float32)
b = np.random.rand(n, n).astype(np.float32)

t = time.perf_counter(); a @ b
print("CPU", time.perf_counter() - t)

ga, gb = cp.asarray(a), cp.asarray(b)
t = time.perf_counter(); ga @ gb
cp.cuda.Device().synchronize()
print("GPU", time.perf_counter() - t)
# 我的 Mac：CPU 0.21 s，GPU 机房 0.004 s
\`\`\`

$$
I = \\frac{\\text{运算次数}}{\\text{搬运的字节数}}
$$

$$
P = \\min(\\pi,\\ \\beta \\cdot I)
$$

> [!ai] AI 讲解 · Claude Code · Opus 5.5
> Roofline 图横轴是运算强度 I，纵轴是能跑到的速度。I 小的程序（向量加法）撞在左边斜线上，卡在内存带宽；矩阵乘法的 I 随 n 变大，能爬到右边平台、吃满算力。所以「大矩阵上 GPU 才划算」。

## 我还没懂的

- [x] 九层里「微架构」和「指令集」怎么分
- [ ] 为什么 SRAM 比 DRAM 省电
- [ ] Roofline 的拐点怎么算
- [ ] 作业 2 第 3 题

<details><summary>课上的推导（没记全）</summary>

老师在黑板上从 P = min(π, β·I) 推到拐点 I* = π ⁄ β，中间两步没抄下来，回头对着录像补。

</details>

![[我的疑惑]]

[[Lecture05 可视化|加速器为何又快又省 · 拖动看车间]]
`

export const TRAVEL_NOTE = `# 冰岛十天环岛

二月底出发，十天，冬天走一号公路。主要看三样：**极光、冰洞、黑沙滩**。

![朋友去年三月在维克拍的](../附件/冰岛十天环岛/aurora.jpg)

## 出发前

还没订完的：

- [x] 机票（2 月 24 日到）
- [x] 雷克雅未克两晚
- [ ] 四驱车，带防滑钉胎
- [ ] 蓝冰洞向导
- [ ] 驾照翻译件

> [!quote] [《在冰岛开车》 · 第二章 天气](weread://book/3300041234)
> 在冰岛，天气不是闲聊的话题，是第二天的行程表。
>
> 我的评价：所以每天只排一个主景点，剩下的时间留给天气。

> Check road conditions and weather warnings every morning before you drive. Roads close often in winter.
> —— [Driving in winter](https://safetravel.is/driving-in-iceland)

> 冰洞每年的形状都不一样，去年的照片不能当今年的地图。
—— [《在冰岛开车》 · 第五章 冰洞](https://weread.qq.com/web/reader/3300041234k5)

## 住哪

[[冰岛自驾]]

\`\`\`base
filters:
  and:
    - file.inFolder("写作/冰岛十天环岛/住宿")
views:
  - type: table
    name: 表格
    order:
      - 日期
      - 地方
      - 状态
    sort:
      - property: 日期
        direction: ASC
\`\`\`

维克那晚要是封路，就退掉，改住塞里雅兰瀑布附近。

## 路线

第一天：落地凯夫拉维克，取车，先去黄金圈，晚上住雷克雅未克。

![黄金瀑布](../附件/冰岛十天环岛/gullfoss.jpg)

![黑沙滩](../附件/冰岛十天环岛/black-beach.jpg)

![维克](../附件/冰岛十天环岛/vik.jpg)

![蓝冰洞](../附件/冰岛十天环岛/ice-cave.jpg)

![冰河湖](../附件/冰岛十天环岛/icebergs.jpg)

![草帽山](../附件/冰岛十天环岛/kirkjufell.jpg)

<!-- video video=youtube:Xr2u9Qm1kLc -->
![Iceland Ring Road in Winter](../附件/视频/youtube-Xr2u9Qm1kLc/cover.jpg)
[Iceland Ring Road in Winter: 10 Days, Every Stop](https://www.youtube.com/watch?v=Xr2u9Qm1kLc)
Nomad Notes · 18:24

<!-- moment video=youtube:Xr2u9Qm1kLc t=222 -->
![03:42](../附件/视频/youtube-Xr2u9Qm1kLc/222.jpg)
[▶ 03:42 · Iceland Ring Road in Winter](https://www.youtube.com/watch?v=Xr2u9Qm1kLc&t=222s)
> **03:42 Never turn your back on the waves at Reynisfjara. / 在黑沙滩，永远别背对海浪。**

![[去冰岛之前要知道的十件事]]

## 预算

| 项目 | 欧元 |
|---|--:|
| 机票 | 620 |
| 四驱车 10 天 | 980 |
| 住宿 9 晚 | 1,150 |
| 冰洞团 | 160 |
| 合计 | 2,910 |

汇率按 1 欧元 = 150 克朗算；油钱另算，大概 300。
`

/** 住宿数据库的 8 条（每条一篇 md，属性在开头） */
const STAYS: [string, string, string][] = [
  ['2-24', '雷克雅未克', '订了'],
  ['2-26', '维克', '订了'],
  ['2-27', '霍芬', '没订'],
  ['2-28', '埃伊尔斯塔济', '没订'],
  ['3-1', '米湖', '订了'],
  ['3-2', '阿克雷里', '没订'],
  ['3-3', '斯奈山半岛', '没订'],
  ['3-4', '雷克雅未克机场', '订了'],
]

/** 课件：12 页，第 3、5、12 页是问过 AI 的那几页 */
export const LECTURE05_PDF = lecturePdf(
  Array.from({ length: 12 }, (_, i) => {
    const n = i + 1
    const title = { 3: 'The Computation Stack', 5: 'Matrix multiply: CPU vs GPU', 12: 'Moving data costs more than computing' }[n] ?? `Lecture 05 - page ${n}`
    return { title, lines: ['Application, Algorithm, Language, Operating system', 'ISA, Microarchitecture, Circuits, Devices, Physics'], ...(n === 3 ? { image: { x: 330, y: 360, w: 220, h: 200 } } : {}) }
  }),
)

export function docBoardVault(): Record<string, string | Buffer> {
  return {
    '课程/ecp/Lecture05 笔记.md': LECTURE_NOTE,
    '课程/ecp/Lecture05.pdf': LECTURE05_PDF,
    '课程/ecp/我的疑惑.md': '# 我的疑惑\n\necp · 6 条。为什么对称矩阵一定能对角化？Roofline 的拐点怎么算？SRAM 为什么省电……\n\n## 第 5 讲\n\n- 为什么 SRAM 比 DRAM 省电\n',
    '课程/ecp/Lecture05 可视化.html': '<!doctype html><html><head><meta charset="utf-8"><title>加速器为何又快又省 · 拖动看车间</title><meta name="类型" content="可视化"></head><body><h1>拖动看车间</h1></body></html>',
    '附件/Lecture05/p3-1.png': solidPng(320, 180, [200, 210, 225]),
    '附件/Lecture05/p5-1.png': solidPng(320, 180, [215, 230, 210]),
    '写作/冰岛十天环岛.md': TRAVEL_NOTE,
    ...Object.fromEntries(['aurora', 'gullfoss', 'black-beach', 'vik', 'ice-cave', 'icebergs', 'kirkjufell'].map((n) => [`附件/冰岛十天环岛/${n}.jpg`, cover(n)])),
    '附件/视频/youtube-Xr2u9Qm1kLc/cover.jpg': cover('myvatn'),
    '附件/视频/youtube-Xr2u9Qm1kLc/222.jpg': cover('black-beach'),
    ...Object.fromEntries(STAYS.map(([d, place, st]) => [`写作/冰岛十天环岛/住宿/${place}.md`, `---\n日期: ${d}\n地方: ${place}\n状态: ${st}\n---\n`])),
    '素材/旅行/去冰岛之前要知道的十件事.md':
      '---\ncreated: 2026-11-12 21:40\nsource: https://zhuanlan.zhihu.com/p/62019734\n---\n# 去冰岛之前要知道的十件事\n\n—— [去冰岛之前要知道的十件事](https://zhuanlan.zhihu.com/p/62019734)\n\n![](../../附件/冰岛十天环岛/icebergs.jpg)\n\n冬天白天只有五六个小时；加油站多数要密码卡；超市周日关门早；路边停车拍照最危险……\n\n1. 冬天白天很短，行程别排太满。\n',
    '收件箱/记得换钱.md': '# 记得换钱\n\n到了先在机场换一点克朗，停车场多数只收卡。\n',
    '写作/冰岛自驾.md': '---\ntype: board\ncolor: #4A7FA7\n---\n# 冰岛自驾\n\n<!-- card id=a1 x=80 y=80 w=260 -->\n订四驱车\n\n<!-- card id=a2 x=380 y=80 w=260 -->\n看极光\n',
  }
}
