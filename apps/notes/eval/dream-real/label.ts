/**
 * 标注：每题让裁判（默认 Opus · high）看更长的原文，不告诉它哪篇本来链着，逐篇判「该连 / 两可 / 不该连」。
 * 裁判和库里原来的链接对不上的、裁判说两可的、没链着却判该连的，都要人逐条核（review.json），核过的以人为准。
 */
import { jsonArrayIn } from '../../src/shared/dream-judge'

export const LABEL_SYSTEM = '你是笔记库整理的审稿人，给「两篇笔记该不该互相链接」做标准答案。只根据原文判断，不编造。只输出 JSON。'

export type Label = 'link' | 'maybe' | 'no'

export function labelPrompt(a: { title: string; text: string }, bs: { title: string; text: string }[]): string {
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
  return `下面是一篇笔记 A 和 ${bs.length} 篇别的笔记 B。对每篇 B 判断：一个注重准确的整理助手该不该在 A 末尾自动加一行「相关：[[B]]」。

该连：两篇讲同一个具体的主题、概念、人物、事件、项目或工具，读 A 的人会想立刻跳到 B（B 是 A 里一个重要概念的专门笔记也算；体裁不同不影响）。
不该连：只同属一个大领域、同一门课或同一本书的不同章节、同一个来源；只是都用了常见词；只是体裁一样；或者讲的根本不是一回事。
两可：确实介于两者之间，有人会连、有人不会连。不要拿「两可」躲避判断，能定就定。
两篇基本是同一份东西（转载、翻译、摘要）的，判该连，并在理由里写「同一内容」。

只输出一个 JSON 代码块，每篇 B 一项：
\`\`\`json
[{"b": 1, "label": "该连" | "两可" | "不该连", "reason": "一句中文，说出共同的那个东西，或者为什么不是一回事"}]
\`\`\`

=== A ===
标题：${a.title}
正文：
${clip(a.text, 4000)}

${bs.map((b, i) => `=== B${i + 1} ===\n标题：${b.title}\n正文：\n${clip(b.text, 2500)}`).join('\n\n')}`
}

export function parseLabels(reply: string, n: number): { index: number; label: Label; reason: string }[] {
  const arr = jsonArrayIn(reply)
  if (!arr) return []
  const map: Record<string, Label> = { 该连: 'link', 两可: 'maybe', 不该连: 'no' }
  return arr
    .map((x, i) => {
      const o = x as Record<string, unknown>
      const index = typeof o.b === 'number' ? o.b - 1 : i
      const label = map[String(o.label)]
      return label && index >= 0 && index < n ? { index, label, reason: String(o.reason ?? '') } : null
    })
    .filter((x): x is { index: number; label: Label; reason: string } => x !== null)
}
