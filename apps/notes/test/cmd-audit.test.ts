// AI 命令独立审核（task-nnss4，/private/tmp/canvas-notes-audit/notes.md）查出的文档、白板、周记、书摘这一类问题：每条先红后绿
import { describe, expect, it } from 'vitest'
import * as R from '../src/shared/cmd-run'
import { type Proposal, proposalDiff } from '../src/renderer/commands/proposals'
import { translatePrompt } from '../src/renderer/ai-commands'

/** 审核里那篇「第2讲 预备知识」（截图转成文字以后，张量那节里有一个代码块） */
const LECTURE = `---
tags: [机器学习, 预备知识]
---
# 第2讲 预备知识

> 这一讲对应 d2l 第 2 章。

## 张量

张量就是多维数组：一个轴是向量，两个轴是矩阵。PyTorch 里的张量和 NumPy 的 ndarray 很像，但能放到 GPU 上，还支持自动微分。

\`\`\`python
x = torch.arange(12)
x.shape   # torch.Size([12])
X = x.reshape(3, 4)
\`\`\`

## 广播

两个张量形状不同、但能扩展成一样时，按元素运算前会自动扩展。比如 (3,1) 加 (1,2) 得到 (3,2)。
后面接着的一句：广播最容易出错的地方是维度对不上时不报错。

## 自动微分

backward 只能对标量调用；要对向量求导，先把它加起来变成一个数。这和梯度下降里用的梯度是同一个东西。detach 会把一个张量从计算图里拿出来。

## 线性回归回顾

见第 1 讲：线性回归用均方误差当损失函数。
`

/** 审核里截断的那一版：停在代码块里，后面三节没了 */
const CUT = LECTURE.slice(0, LECTURE.indexOf('X = x.reshape(3, 4)') + 'X = x.reshape(3, 4)'.length) + '\n'

describe('自己存的命令：正文里有代码块也整篇读回（task-1l29q）', () => {
  const body = LECTURE.replace(/^---\n[\s\S]*?\n---\n/, '')
  it('```markdown 包着的整篇里有 ```python：读到最外层的收尾，后面几节都在', () => {
    expect(R.docOut('```markdown\n' + body + '```')).toBe(body)
    expect(R.docOut('改好了：\n\n```markdown\n' + body + '```\n\n以上。')).toBe(body)
    // 外层照提示用四个反引号
    expect(R.docOut('````markdown\n' + body + '````')).toBe(body)
    // 正文里的代码块没写语言名
    const bare = '# A\n\n```\n输出\n```\n\n## B\n\n后面\n'
    expect(R.docOut('```markdown\n' + bare + '```')).toBe(bare)
    // 整篇后面 AI 又多给了一段带语言名的代码：不算进整篇
    expect(R.docOut('```markdown\n' + body + '```\n\n比如：\n\n```python\ny = 2\n```')).toBe(body)
  })
  it('没写完就停了（外层没收尾）：不当成整篇', () => {
    expect(R.docOut('```markdown\n# A\n\n```python\nx = 1\n```\n\n## B\n\n后面')).toBeNull()
    // 没包代码块、整段像一篇笔记的照旧用整段（正文里有代码块也一样）
    expect(R.docOut('# A\n\n```python\nx = 1\n```\n')).toBe('# A\n\n```python\nx = 1\n```\n')
  })
  it('提示里叫 AI 外层用四个反引号，正文里的代码块照常', () => {
    const p = R.ownPrompt({ name: 'x', instruction: '1. a', title: 't', path: 't.md', text: '# t', write: 'inplace', images: 0, source: 'doc' })
    expect(p).toContain('````markdown')
  })
  it('少了整节：标题没了、正文的字也不在了才算；改了名字、并进别处、本来就空的标题不算', () => {
    expect(R.goneSections(LECTURE, CUT)).toEqual(['广播', '自动微分', '线性回归回顾'])
    expect(R.goneSections(LECTURE, LECTURE)).toEqual([])
    // 改了名字，字还在
    const renamed = LECTURE.replace('## 广播', '## 广播机制').replace('## 自动微分', '## 求导')
    expect(R.goneSections(LECTURE, renamed)).toEqual([])
    // 并进上一节（标题删了，字还在）
    expect(R.goneSections(LECTURE, LECTURE.replace('\n## 线性回归回顾\n', '\n'))).toEqual([])
    // 本来就空着的标题删了
    const empty = '# a\n\n## 1.3.1.2 分类\n\n## 回归\n\n回归是预测一个连续的数，比如房价、气温。\n'
    expect(R.goneSections(empty, empty.replace('## 1.3.1.2 分类\n\n', ''))).toEqual([])
    // 代码块里的 # 不是标题
    const code = '# a\n\n## 例子\n\n```python\n# tensor([1, 2])\nprint(x)\n```\n\n这一段讲的是怎么打印一个张量的值和形状。\n'
    expect(R.goneSections(code, '# a\n')).toEqual(['例子'])
  })
  it('命令里明说要删整节才不提醒；只说删空标题的照样提醒', () => {
    expect(R.saysDelete('1. 图片里的内容写成文字\n2. 删掉没有内容的空小标题\n3. 用第一人称')).toBe(false)
    expect(R.saysDelete('1. 删掉「参考资料」那一节')).toBe(true)
    expect(R.saysDelete('1. 只留和考试有关的部分')).toBe(true)
  })
  it('先给你看：文件条那句人话写删了几节、哪几节；命令没说要删时标红', () => {
    const p: Proposal = {
      id: 'p1',
      name: '整理成通顺笔记',
      title: '第2讲 预备知识',
      place: { key: 'file:课程/第2讲 预备知识.md', label: '第2讲 预备知识' },
      files: [{ path: '课程/第2讲 预备知识.md', before: LECTURE, after: CUT }],
      warn: { lost: ['广播', '自动微分', '线性回归回顾'] },
      take: async () => {},
      drop: () => {},
    }
    const f = proposalDiff(p).files[0]!
    expect(f.summary).toBe('删了3节：广播、自动微分、线性回归回顾')
    expect(f.warn).toBe(true)
    const calm = proposalDiff({ ...p, warn: undefined }).files[0]!
    expect(calm.summary).toBe('删了3节：广播、自动微分、线性回归回顾')
    expect(calm.warn).toBeFalsy()
    expect(proposalDiff({ ...p, files: [{ ...p.files[0]!, after: LECTURE.replace('张量就是', '张量是') }] }).files[0]!.summary).toBe('')
    // 周记并进那一篇：文件条写调用的给的那句（设计复审）
    expect(proposalDiff({ ...p, warn: undefined, files: [{ path: '周记/2026-W47 周记.md', before: '# a\n', after: '# a\n\n- b\n', note: '并进这周那一篇' }] }).files[0]!.summary).toBe('并进这周那一篇')
  })
})

describe('截图转成文字：转过的认出来跳过（task-t41et）', () => {
  it('图下面紧跟着的是以前「截图转成文字」加进去的行：算转过', () => {
    const doc = '# 笔记\n\n![](a.png)\n\n| 写法 | 意思 |\n| --- | --- |\n| x | 标量 |\n\n![](b.png)\n\n我自己写的话。\n\n![](c.png)\n'
    const images = R.docImages(doc, '笔记.md', () => null)
    expect(R.ocrDone(doc, images, new Set(['| 写法 | 意思 |', '| --- | --- |', '| x | 标量 |']))).toEqual([true, false, false])
    // 头一行太常见（代码围栏）：还要第二行也对得上
    const fence = '![](a.png)\n\n```python\nmine = 1\n```\n'
    expect(R.ocrDone(fence, R.docImages(fence, 'n.md', () => null), new Set(['```python', 'x = 1']))).toEqual([false])
    expect(R.ocrDone(fence, R.docImages(fence, 'n.md', () => null), new Set(['```python', 'mine = 1']))).toEqual([true])
    // 引用里的图：前缀去掉再比
    const quote = '> ![](a.png)\n>\n> 图上的字\n'
    expect(R.ocrDone(quote, R.docImages(quote, 'n.md', () => null), new Set(['图上的字']))).toEqual([true])
  })
  it('AI 认出的字图下面本来就有：不再加一遍；下一张图下面的不算', () => {
    const doc = '![](a.png)\n\n图上的字：广播机制让形状不同的张量也能按元素运算\n'
    const [im] = R.docImages(doc, 'n.md', () => null)
    expect(R.alreadyBelow(doc, im!, '图上的字：广播机制让形状不同的张量也能按元素运算')).toBe(true)
    expect(R.alreadyBelow(doc, im!, '完全不同的一段字，讲的是梯度下降的学习率')).toBe(false)
    const two = '![](a.png)\n\n![](b.png)\n\n图上的字：广播机制让形状不同的张量也能按元素运算\n'
    expect(R.alreadyBelow(two, R.docImages(two, 'n.md', () => null)[0]!, '图上的字：广播机制让形状不同的张量也能按元素运算')).toBe(false)
  })
})

describe('自测题、复习提纲再跑：认出已有那一节（task-idmm6）', () => {
  const QUIZ = '# 梯度下降\n\n正文\n\n## 自测题\n\n1. 旧题一\n\n<details><summary>答案</summary>\n\n旧答案\n\n</details>\n\n## 附：参考\n\n链接\n'
  it('自测题再出：接在原来那一节最后，编号接着往下，原文一字不动', () => {
    const r = R.addQuiz(QUIZ, [{ q: '新题', a: '新答' }])
    expect(r.from).toBe(2)
    expect(r.text).toBe(QUIZ.replace('</details>\n\n## 附', '</details>\n\n2. 新题\n\n<details><summary>答案</summary>\n\n新答\n\n</details>\n\n## 附'))
    expect(R.onlyAdded(QUIZ, r.text)).toBe(true)
    // 还没有这一节：照旧在末尾加
    expect(R.addQuiz('# a\n\n正文\n', [{ q: 'q', a: 'a' }])).toEqual({ text: '# a\n\n正文\n\n## 自测题\n\n1. q\n\n<details><summary>答案</summary>\n\na\n\n</details>\n', from: 1 })
  })
  it('出题时列出已有的题，叫 AI 别重复', () => {
    expect(R.existingQuiz(QUIZ)).toEqual(['旧题一'])
    const p = R.quizPrompt({ path: 'a.md', title: 'a', text: QUIZ, asked: R.existingQuiz(QUIZ) })
    expect(p).toContain('- 旧题一')
    expect(p).toContain('不和它们重复')
  })
  it('复习提纲再收：换掉原来那一节，别的一字不动；没有这一节是 null', () => {
    const note = '# L5 笔记\n\n我的总结。\n\n## 复习提纲\n\n- [第 3 页](L5.pdf#page=3)：旧的\n\n## 第 3 页 · 分层\n\n问答原文\n'
    expect(R.replaceSection(note, '复习提纲', '## 复习提纲\n\n- 新的')).toBe('# L5 笔记\n\n我的总结。\n\n## 复习提纲\n\n- 新的\n\n## 第 3 页 · 分层\n\n问答原文\n')
    expect(R.replaceSection('# L5 笔记\n\n## 复习提纲\n\n- 旧\n', '复习提纲', '## 复习提纲\n\n- 新')).toBe('# L5 笔记\n\n## 复习提纲\n\n- 新\n')
    expect(R.replaceSection('# a\n', '复习提纲', '## 复习提纲\n\n- 新')).toBeNull()
  })
})

describe('空笔记、空白板先不问 AI（task-ev29m、task-nphy3）', () => {
  it('正文有几个字：属性、标题、注释、图不算', () => {
    expect(R.bodyChars('')).toBe(0)
    expect(R.bodyChars('# 只有标题\n')).toBe(0)
    expect(R.bodyChars('---\ntype: board\n---\n')).toBe(0)
    expect(R.bodyChars('# 菜谱\n\n![](a.png)\n<!-- card id=a1 -->\n- 番茄炒蛋\n')).toBe(4)
  })
})

describe('翻译不带属性（task-n1ffi）', () => {
  it('整篇交给 AI 时去掉属性和藏着的位置行', () => {
    const p = translatePrompt('---\nsource: https://zhuanlan.zhihu.com/p/62019734\n---\n# 冰岛自驾攻略\n\n<!-- card id=a1 x=1 y=2 -->\n> 冬天白天只有五六个小时\n')
    expect(p).not.toContain('source:')
    expect(p).not.toContain('<!--')
    expect(p).toContain('<text>\n# 冰岛自驾攻略\n\n> 冬天白天只有五六个小时\n</text>')
  })
})

describe('书摘按主题分节：挨着的几条划线各算一条（task-ftdc9）', () => {
  const Q = ['接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征。', '朱高煦突然伸出一脚，把朱瞻基勾倒在地。', '莫名其妙地吃了个狗啃泥，再好脾气的人也得发飙。', '永乐皇帝朱棣去世以后，他的大儿子朱高炽当了皇帝。', '朱高炽在位不到一年就去世了，但他减轻赋税、平反冤狱。', '仁宣之治，是明朝最太平的十年。', '于谦站出来说：「言南迁者，可斩也！」']
  /** 审核里那本书：第 3 章第二、三条挨着，第 4 章两条挨着、都没写想法 */
  const BOOK = ['---', '类型: 书摘', 'bookId: 3300064831', '---', '# 趣说明朝276年', '', '## 3 作死小能手朱高煦', '', `> ${Q[0]}`, '', '微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。', '', `> ${Q[1]}`, '', `> ${Q[2]}`, '', '我的评价：皇帝可以输道理，不能输面子。', '', '## 4 来自亲爹的愤怒', '', `> ${Q[3]}`, '', `> ${Q[4]}`, '', '## 5 仁宣之治', '', `> ${Q[5]}`, '', '## 7 土木堡', '', `> ${Q[6]}`, '', '我的评价：于谦是真正的狠人。', '', '## 书评', '', '轻松好读，适合当明史入门。', ''].join('\n')
  it('七条划线就是七组，想法、评价跟着它上面那一条', () => {
    const d = R.digestOf(BOOK)!
    expect(d.groups).toHaveLength(7)
    expect(d.groups[2]!.text).toBe(`> ${Q[2]}\n\n我的评价：皇帝可以输道理，不能输面子。`)
    expect(d.groups[1]!.text).toBe(`> ${Q[1]}`)
  })
  it('怎么分节（挨着的放进同一节也一样）都核得过：只挪了顺序', () => {
    const d = R.digestOf(BOOK)!
    for (const themes of [
      [{ theme: '全部', items: [1, 2, 3, 4, 5, 6, 7] }],
      [
        { theme: '叔侄', items: [1, 2, 3] },
        { theme: '父子', items: [4, 5, 6] },
        { theme: '土木堡', items: [7] },
      ],
      [
        { theme: '甲', items: [2, 6, 4] },
        { theme: '乙', items: [5, 1] },
      ],
    ]) {
      const out = R.applyThemes(d, themes)
      expect(R.sameGroups(BOOK, out)).toBe(true)
    }
  })
})

describe('写这周的周记（task-f4kf7、task-iztii）', () => {
  const W = { week: '2026-W47', from: '2026-11-16', to: '2026-11-22', notes: [{ path: '课程/a.md', title: 'a', excerpt: '张量' }] }
  it('这周新划的线、写的想法（书摘这周以前就有的不算）', () => {
    const was = '# 书\n\n## 第一章\n\n> 旧的一条\n'
    const now = '# 书\n\n## 第一章\n\n> 旧的一条\n\n> 仁宣之治，是明朝最太平的十年。\n\n我的评价：难得太平。\n'
    expect(R.newHighlights(was, now)).toEqual(['「仁宣之治，是明朝最太平的十年。」我的评价：难得太平。'])
    expect(R.newHighlights('', '# 书\n\n## 一\n\n> 第一条\n')).toEqual(['「第一条」'])
  })
  it('PDF 笔记里这周新问的问题和小结', () => {
    const sec = (n: number, q: string, a: string, recap: string) => `## 第 ${n} 页 · x\n[第 ${n} 页](L5.pdf#page=${n}) · 20:21 <!-- cn:thread=L5-p${n}-1 -->\n\n> [!question] ${q}\n\n${a}\n\n> [!recap] ${recap}\n`
    const was = `# L5 笔记\n\n${sec(3, '为什么分层？', '分层让每层只管接口。', '分层让每层能单独换')}`
    const now = `${was}\n${sec(7, '屋顶线模型的拐点怎么算？', '拐点 = 峰值算力 ÷ 带宽。', '拐点是峰值算力除以带宽')}`
    expect(R.newQuestions(was, now, 'L5 笔记.md')).toEqual(['问：屋顶线模型的拐点怎么算？（小结：拐点是峰值算力除以带宽）'])
  })
  it('交给 AI 的有这周读到的原话，并叫它别写没根据的话', () => {
    const p = R.weekPrompt({ ...W, books: [{ title: '趣说明朝276年', kind: 'book', items: ['「仁宣之治，是明朝最太平的十年。」'] }, { title: 'Lecture05.pdf', kind: 'pdf', items: ['问：屋顶线模型的拐点怎么算？（小结：拐点是峰值算力除以带宽）'] }] })
    expect(p).toContain('「仁宣之治，是明朝最太平的十年。」')
    expect(p).toContain('屋顶线模型的拐点怎么算？')
    expect(p).toContain('不要写「笔记里没记」')
  })
  const HAD = '---\n类型: 周记\n日期: 2026-11-22\n---\n# 2026-W47 周记\n\n## 这周做了什么\n\n- 改了 [[a]]\n\n## 读了什么\n\n- 读了一些\n\n## 下周想做什么\n\n- 接着做\n'
  it('同一周已经有周记：提示里带上它，叫 AI 只写新的', () => {
    const p = R.weekPrompt({ ...W, books: [] }, HAD)
    expect(p).toContain('<week>\n' + HAD.trimEnd() + '\n</week>')
    expect(p).toContain('只写它里面还没写到的新事')
  })
  it('新的事并进同名那一节，原来的字一字不动；没有的节加在末尾；都写到了就不变', () => {
    const merged = R.mergeWeek(HAD, '## 这周做了什么\n\n- 改了 [[a]]\n- 改了 [[b]]\n\n## 读了什么\n\n- 读了一些\n\n## 想法\n\n- 冰岛要早点订\n')
    expect(merged).toBe(HAD.replace('- 改了 [[a]]\n', '- 改了 [[a]]\n- 改了 [[b]]\n') + '\n## 想法\n\n- 冰岛要早点订\n')
    expect(R.onlyAdded(HAD, merged)).toBe(true)
    expect(R.mergeWeek(HAD, '没有要加的')).toBe(HAD)
    expect(R.mergeWeek(HAD, '## 这周做了什么\n\n- 改了 [[a]]\n')).toBe(HAD)
  })
})
