/**
 * 读 PDF 那一套记进笔记的一问（2026-11-24 新写法，@cn/format 的 ai-note.ts）用到的几样纯函数：回答原文、材料、问话。
 * 问题是发出去的原话、回答是 AI 的原文，不让 AI 改写。单元测试直接跑（reading-section.test.ts）。
 */
import { type AskMat, type AskSection, cleanQuestion, confusedAsk, confusedOf, demoteHeadings, plainQ, webSrc } from '@cn/format'
import { fragmentUrl } from '../../shared/web-link'
import type { Material } from '../../shared/materials'
import { withoutVizMark } from '../../shared/reading'

/** 回答原文写进笔记的样子：去掉可视化、配图那两行标记，标题降到 ### 以下（不把笔记的这一段切开） */
export const answerMd = (text: string) => demoteHeadings(withoutVizMark(text).text.trim())

/** 材料（输入框里那一排）写进笔记：引用的字原样，图换成拷进库里的那张 */
export function matsOf(mats: Material[] | undefined, matPath: (name: string) => string): AskMat[] | undefined {
  if (!mats?.length) return undefined
  // 拷不进库的图（pasted/ 里已经没有了）不写
  // 网页上引的：来源写成回到那一段的链接（「6.2.1 互相关运算 · 动手学深度学习 ↩」，点了右栏网页翻回那一段）
  const out = mats.flatMap((m): AskMat[] =>
    m.kind === 'quote'
      ? [{ kind: 'quote', text: m.text, ...(m.url && /^https?:/i.test(m.url) ? { src: `${m.src} ↩`, href: webSrc('', '', fragmentUrl(m.url, m.text)).href } : { src: m.src }) }]
      : matPath(m.name)
        ? [{ kind: 'image', path: matPath(m.name), src: m.src }]
        : [],
  )
  return out.length ? out : undefined
}

/**
 * 记进笔记的问话：「看不懂」那一段（ParaRead 划的）点「问 AI」发出去的那句（confusedAsk），写回「看不懂：原文」
 * （那一段的第一问就是它，同 keepConfused 的意思；原文和身份注释留在旧那段里，不再写一份）；别的原样（去掉身份注释）
 */
export function questionOf(text: string, old?: AskSection | null): string {
  const first = old?.qas?.[0]
  const c = first ? confusedOf(first.q) : null
  if (first && c && text.trim() === confusedAsk(c.text)) return plainQ(first.q)
  return cleanQuestion(text)
}
