import { solidPng } from './png'

const T = '又贵又难吃的赛百味，怎么突然卖爆了？ - IC实验室出品'
const U = 'https://www.youtube.com/watch?v=7CVYBBX_zxA'

/** 文档编辑器的样本：视频卡、时刻块、问答块、列表、剪藏引文、提示块、折叠块（录屏里用户那篇的样子） */
export const EDITOR_DOC = `# 未命名 3

赛百味

<!-- video video=youtube:7CVYBBX_zxA -->
![${T}](附件/c.png)
[${T}](${U})
IC实验室 · 08:55

<!-- moment video=youtube:7CVYBBX_zxA t=1.1 -->
![00:01](附件/c.png)
[▶ 00:01 · ${T}](${U}&t=1s)
> **00:01 又贵又难吃的赛百味，怎么突然卖爆了 / Why Subway suddenly sells**

<!-- moment-ask video=youtube:7CVYBBX_zxA t=6 -->
![00:06 框住的地方](附件/c.png)
[▶ 00:06 · ${T}](${U}&t=6s)
> **我的疑惑**：这一帧左边健康白人饭、右边重口味快餐摆在一起对比，我没看懂它想说什么，跟赛百味又有什么关系？

这一帧在讲快餐品牌的两难：左边是「健康白人饭」，鸡胸肉、西兰花，热量低，但字幕说了，有人骂它「味道寡淡，狗都不吃」；右边是重口味快餐，薯块上淋满番茄酱和芝士酱，好吃，但「热量过高」。

- IO：输入直接到输出，没有中间推理
- CoT：中间加入一条线性的推理链，一步接一步
- CoT-SC：跑多条独立的思维链，最后多数投票选答案
- ToT：每一步分出多个想法，评估后保留好的（绿）、剪掉差的（红）
- ToT 用 BFS/DFS 搜索思维树，可以前瞻和回溯，适合 24 点这类需要试错的问题

问的是「给我讲解一下」· 看了 00:03 这一帧

> 雷克雅未克是冰岛的首都和最大城市，位于冰岛西南部的法赫萨湾南岸。
—— [雷克雅未克 - 维基百科，自由的百科全书](https://zh.wikipedia.org/wiki/%E9%9B%B7%E5%85%8B%E9%9B%85%E6%9C%AA%E5%85%8B)

> [!question] 我的疑惑
> 为什么 GPU 跑矩阵乘法比 CPU 快这么多？

> [!success] 讲通的讲法（第 2 版）
> 矩阵乘法里每个格子都能单独算，GPU 有几千个小核同时算。

<details><summary>没讲通 · 第 1 版：用 CPU 和 GPU 跑矩阵乘法</summary>

旧讲法：CPU 是几个大厨，GPU 是一群学徒。

</details>

最后一段。
`

export const EDITOR_FILES = { '未命名 3.md': EDITOR_DOC, '附件/c.png': solidPng(320, 180, [90, 140, 120]) }
