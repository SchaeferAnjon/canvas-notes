/**
 * 出卡交给 AI 的话（task-tz7y3）。不碰 Electron：主进程的 cards.ts、单元测试、真 AI 出卡的测试都用这一份。
 *
 * 出卡规矩照用户自己的 ChatCards（~/Documents/Projects/anki-learn 的 Core/Sources/AnkiLearnCore/CardMaker.swift 的 systemPrompt）：
 * 一张卡一个点、问题离开原文也看得懂、答案尽量不超过 40 字、带一句原文出处。ANKI_LEARN_RULES 是那边「卡片的写法」里一字不差的原话，
 * READING_RULES 是读 PDF 问过的才有的补充。两边保持一致：test/cards.test.ts 在这台 Mac 上有 anki-learn 时逐条核对原话还在那边，
 * 那边改了一个字，这边的测试就不过，照着改这一份。
 * 一问一张（不像 ChatCards 从整段材料里挑值得记的）；AI 一行回一张 JSON，改好一张界面就显示一张。
 */
import type { DoubtItem } from '@cn/format'

/** anki-learn CardMaker.swift systemPrompt「卡片的写法」里的原话，一字不差 */
export const ANKI_LEARN_RULES = [
  '一张卡只问一个点。问题要离开材料也能看懂：写出具体的工具、语言、场景的名字，不写「这个项目」「上面那个」。',
  '答案尽量短：一句话或一条命令，最好不超过 40 个字；要展开的放进 more：最多 3 条，一行一条，每条一句。',
  'quote：从材料里原样摘一句支撑这张卡的话，不超过 80 个字，方便回去找出处。',
  '用材料的语言写（材料主要是中文就写中文；命令、代码、专有名词保留原文）。',
]

/** 读 PDF 问过的才有的几条：问的原话离开那一页常常看不懂，照他问的点改写；摘句只从回答和 PDF 上的字里摘；不要编 */
export const READING_RULES = [
  '他问的原话常常离开那一页就看不懂（「给我讲解一下这三条公式」）：照他问的那个点、照回答里讲清楚的内容改写成一个能单独看懂的问题，写出具体的概念、模型、公式的名字，不写「这三条公式」「这张图」「这里」「它」；实在看不出问的是什么，照这一轮的小标题问。',
  '他一下问了好几样（「这三条公式」「这几步」）：问题只问一句，问它们合起来在做什么；答案一句话说总的，每一样各写一条放进 more；长公式也放进 more，不写在答案里。',
  '答案写好数一下字数，超过 40 个字就删短，删掉的放进 more。',
  'quote 只从「AI 当时的回答」和「这一页 PDF 上的字」里原样摘，一字不改；旁支那一问直接用他在回答里选中问的那一句。',
  '只写材料里讲清楚了的，不要编；公式用 LaTeX 写在 $…$ 里。',
]

export const CARD_SYSTEM = `你帮人把他读 PDF 课件时问过的问题做成 Anki 记忆卡片：每一问做一张，用 JSON 输出。

材料：每一问给你它在哪（课程、PDF、第几页、这一轮的小标题和一句小结）、他问的原话（旁支还有他在回答里选中问的那一句）、AI 当时的回答原文，有的还有这一页 PDF 上的字。

卡片的写法：
${[...ANKI_LEARN_RULES, ...READING_RULES].map((r) => `- ${r}`).join('\n')}

只输出 JSON，一问一行，按给你的顺序，不要代码块，不要别的字：
{"id":"编号","q":"问题","a":"答案","more":"补充说明，一行一条，没有就空字符串","quote":"原文摘句"}`

/** 一问的材料（交给 AI 的话里的一块）；回答、PDF 上的字太长截掉 */
export function cardMaterial(n: number, it: DoubtItem, o: { course: string; pageText?: string }): string {
  const s = it.section
  const stem = (it.pdf.split('/').pop() ?? it.pdf).replace(/\.[^.]+$/, '')
  const lines = [
    `【第 ${n} 问】编号：${n}`,
    `课程：${o.course || '（没有）'}　PDF：${stem}　第 ${s.page} 页　这一轮：${s.title}`,
    ...(s.recap ? [`这一轮的小结：${s.recap}`] : []),
    `他问的原话：${(s.doubts[0] ?? s.title).replace(/\s+/g, ' ')}`,
    ...(it.quote ? [`（旁支）他在回答里选中问的那一句：${it.quote}`] : []),
    'AI 当时的回答：',
    (it.answer ?? [s.good, ...s.points].join('\n')).trim().slice(0, 4000),
  ]
  if (o.pageText?.trim()) lines.push('这一页 PDF 上的字：', o.pageText.trim().slice(0, 2000))
  return lines.join('\n')
}

export const cardPrompt = (blocks: string[]) => `下面是他问过的 ${blocks.length} 问，每一问做一张卡。\n\n${blocks.join('\n\n')}`
