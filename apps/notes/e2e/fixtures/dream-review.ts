/**
 * 梦游对照复审（2026-11-24）用的样本：
 * - 一条「可以建的词条页」《动手学深度学习》：库里三篇提到它，前两篇内容完全不同（一篇读论文的笔记、文件名很长没有空格；一篇读书笔记），
 *   中间应该是两篇整篇并排、提到它的段淡底，不按字比；
 * - 一条「补上的双链」：真提交在 dream/11-24 分支上，改了一篇有标题、粗体、列表的笔记（标题里、粗体那段里加了双链，删了一段），
 *   合一时删掉的那几行要画成文档样子；
 * - main 上还有一次自己改的提交（历史里点开，文档看法合一，删掉的标题、粗体也是文档样子）。
 * 报告不跑梦游，直接写进测试实例的 user-data/dream/<库的键>.json。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PAPER = '课程/study project 2/YitingWei_2026_J52_SAGE_stress_workload_JBHI_reading_notes_v3_final.md'
export const BOOK = '课程/学习笔记：动手学深度学习.md'
export const LIST = '读书/深度学习入门书单.md'
export const CNN = '课程/卷积神经网络.md'

const paper = `# SAGE：用可穿戴信号估计压力和工作负荷

> 论文：Yiting Wei 等，JBHI 2026。读的是第 2 版预印本。

## 这篇想解决什么

医护人员连着值班时，压力和工作负荷很难自己说清楚。作者用手环采的心率变异、皮电和加速度，想在不打扰人的情况下估计出这两样。

## 方法

模型分两段：先用一个小的时空图网络把三路信号对齐成同一条时间线，再用 Bi-LSTM 看前后十分钟的变化。时空图那一块我照着《动手学深度学习》第 9 章的写法自己推了一遍，图上的边就是传感器之间的相关。

- 采样：每 4 秒一个窗口，前后重叠一半
- 标签：每小时一次 NASA-TLX 自评
- 训练：留一人交叉验证，一共 41 人

## 结果

压力三分类的准确率 0.78，比只用心率的基线高 9 个点。工作负荷的回归误差还是偏大，作者说是自评太稀。

## 我的疑问

自评一小时一次，中间的标签是插值出来的，模型学到的可能是插值的形状。下次组会问一下能不能换成事件标注。
`

const book = `# 学习笔记：动手学深度学习

> 跟着《动手学深度学习》第二版一章一章读，代码在 Colab 里跑。

## 第 3 章 · 线性回归

线性回归是最简单的监督学习：给每个样本一个真实标签，模型输出一个数，**损失函数**用平方误差。梯度下降一步一步把损失往下推。

## 第 6 章 · 卷积

卷积层用同一个小核在整张图上滑，参数少、平移不变。**池化**再把特征图缩小一半，后面的层看得更远。

- 填充：边上补零，输出和输入一样大
- 步幅：核一次挪几格
- 多通道：每个输出通道一组核

## 第 9 章 · 循环神经网络

序列模型要记住前面看过的东西。书里从最朴素的 RNN 讲到 GRU 和 LSTM，门控就是决定哪些旧信息留下、哪些忘掉。

> [!note] 说穿
> 梯度在很长的序列里会越乘越小，LSTM 的门让它有一条不被反复乘的路。

## 读到哪了

《动手学深度学习》这本书现在读到第 10 章注意力，下周把 Transformer 那节的代码跑通。
`

/** 梦游补了双链以后的那一版：标题里、粗体那段里加了双链，「读到哪了」那一段删了 */
const bookLinked = book
  .replace('## 第 6 章 · 卷积', '## 第 6 章 · [[卷积神经网络|卷积]]')
  .replace('卷积层用同一个小核在整张图上滑，参数少、平移不变。**池化**再把特征图缩小一半，后面的层看得更远。', '[[卷积神经网络|卷积层]]用同一个小核在整张图上滑，参数少、平移不变。**池化**再把特征图缩小一半，后面的层看得更远。')
  .replace('## 读到哪了\n\n《动手学深度学习》这本书现在读到第 10 章注意力，下周把 Transformer 那节的代码跑通。\n', '')

const list = `# 深度学习入门书单

1. 《动手学深度学习》：有代码，适合边读边跑
2. 《深度学习》（花书）：推导全，当工具书查
3. 《神经网络与深度学习》：中文写得清楚
`

const cnn = `# 卷积神经网络

用同一个小核在图上滑动提取特征的网络。
`

/** main 上自己改过的那一版（历史里点开看）：标题改了、粗体那句删了 */
const listEdited = `# 深度学习入门书单（2026 版）

1. 《动手学深度学习》：有代码，适合边读边跑
3. 《神经网络与深度学习》：中文写得清楚
`

export const REVIEW_VAULT: Record<string, string> = {
  [PAPER]: paper,
  [BOOK]: book,
  [LIST]: list,
  [CNN]: cnn,
}

/** launch 的 prepare 里调：main 上先提交样本、再自己改一次书单；dream/11-24 分支上提交补双链那一条；写梦游报告 */
export function prepareReview(vault: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim()
  git('add', '-A')
  git('commit', '-q', '-m', '样本')
  writeFileSync(join(vault, LIST), listEdited)
  git('commit', '-q', '-am', '书单换成 2026 版')
  git('checkout', '-q', '-b', 'dream/11-24')
  writeFileSync(join(vault, BOOK), bookLinked)
  git('commit', '-q', '-am', '梦游：补上的双链 · 学习笔记：动手学深度学习')
  const commit = git('rev-parse', 'HEAD')
  git('checkout', '-q', 'main')
  // launch 接着还要提交一次：给它一篇新的
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
        id: 'link-1',
        group: 'link',
        title: '学习笔记：动手学深度学习 → 卷积神经网络',
        sub: '补了2处双链，删了1段',
        why: '「卷积」一节讲的就是《卷积神经网络》那篇的内容，标题和第一句链过去；最后一段「读到哪了」是读书进度，不是笔记内容，删掉',
        commit,
        files: [BOOK],
        state: 'pending',
      },
      {
        id: 'entry-1',
        group: 'entry',
        title: '《动手学深度学习》',
        sub: '库里3篇提到，还没有讲它的一篇',
        why: '点「建词条页」才建：开头两三句导语（每句挂出处），下面嵌进讲它的那几段，原文改了这里跟着变。不建也没关系，提到它的那几篇不改',
        commit: null,
        files: [PAPER, BOOK, LIST],
        state: 'pending',
        entry: { name: '《动手学深度学习》', count: 3, notes: [PAPER, BOOK, LIST] },
      },
    ],
  }
  mkdirSync(join(userData, 'dream'), { recursive: true })
  for (const p of new Set([vault, realpathSync(vault)])) {
    const key = createHash('sha1').update(p).digest('hex').slice(0, 16)
    writeFileSync(join(userData, 'dream', key + '.json'), JSON.stringify(report, null, 2))
  }
}
