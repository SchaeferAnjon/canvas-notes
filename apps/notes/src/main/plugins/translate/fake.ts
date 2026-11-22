/**
 * 测试用的假回答（CN_AI_FAKE=1 的假命令行、单元测试和端到端测试里的假 OpenAI 兼容服务都用它）：提示第一行是「命令：xxx」。
 * 翻译段落：每段回一行 JSON，「译文：」加原文前 40 个字。
 */
export function fakeAnswer(prompt: string): string {
  const cmd = /^命令：(\S+)/.exec(prompt)?.[1]
  if (cmd === '翻译段落') {
    const items = JSON.parse(/^段落：\n([\s\S]*)$/m.exec(prompt)?.[1] ?? '[]') as { id: number; text: string }[]
    return (
      items
        .map((it) => {
          if (it.text === 'eigenvalue') return JSON.stringify({ id: it.id, text: '特征值' })
          return JSON.stringify({ id: it.id, text: `译文：${it.text.slice(0, 40)}` })
        })
        .join('\n') + '\n'
    )
  }
  return '这是测试回答。'
}
