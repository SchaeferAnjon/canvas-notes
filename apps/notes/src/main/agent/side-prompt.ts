/**
 * 旁支里问一句时交给 AI 的话（task-4edsc，AI 对话、文档里 AI 讲解块的旁支；读 PDF 的在 reading/prompts.ts 的 sidePrompt）。
 * 第一问说清他在哪选的、选的哪一句（对话里的再说那一轮他问的原话）；接着问只说接着这条旁支、问的还是哪一句。
 * 最后一行「用户说：」后面是他的原话（和 AI 对话的话同一个收尾）。
 */
export function sideTurnPrompt(o: { first: boolean; quote: string; ask?: string; where?: string; question: string }): string {
  if (!o.first) return `（接着这条旁支问，问的还是「${o.quote}」这句。）\n用户说：\n${o.question}`
  const head = o.where
    ? `（这是一条旁支：他在${o.where}里选中了一句另问；那段讲解在前面。）`
    : `（这是一条旁支：他在你前面的一个回答里选中了一句另问，问完回到主对话，主对话照旧。）${o.ask ? `\n那一轮他问的是：${o.ask}` : ''}`
  return `${head}\n他选中的那句：「${o.quote}」\n用户说：\n${o.question}`
}
