/**
 * 测试用的假回答（CN_AI_FAKE=1 的假命令行、单元测试和端到端测试里的假 OpenAI 兼容服务都用它）：提示第一行是「命令：xxx」。
 * 翻译段落：每段回一行 JSON，「译文：」加原文前 40 个字；这批带了术语表的，后面加「[特征值]」（测试按这个认术语有没有用上）。
 */
const TERM_LINE = /^术语照这个译：(.+)$/m

export const FAKE_GLOSSARY: [string, string, string][] = [
  ['eigenvalue', '特征值', ''],
  ['eigenvector', '特征向量', ''],
  ['characteristic equation', '特征方程', '不译「特性方程」'],
  ['null space', '零空间', '也叫核'],
  ['determinant', '行列式', ''],
]

export function fakeAnswer(prompt: string): string {
  const cmd = /^命令：(\S+)/.exec(prompt)?.[1]
  if (cmd === '翻译段落') {
    const items = JSON.parse(/^段落：\n([\s\S]*)$/m.exec(prompt)?.[1] ?? '[]') as { id: number; text: string }[]
    const terms = (TERM_LINE.exec(prompt)?.[1] ?? '')
      .split('；')
      .map((p) => p.split(' → '))
      .filter((p) => p.length === 2) as [string, string][]
    return (
      items
        .map((it) => {
          if (it.text === 'eigenvalue') return JSON.stringify({ id: it.id, text: '特征值' })
          const used = terms.filter(([src]) => it.text.toLowerCase().includes(src.toLowerCase())).map(([, dst]) => dst)
          return JSON.stringify({ id: it.id, text: `译文：${it.text.slice(0, 40)}${used.length ? ` [${used.join('、')}]` : ''}` })
        })
        .join('\n') + '\n'
    )
  }
  if (cmd === '起术语表') return FAKE_GLOSSARY.map(([s, d, n]) => JSON.stringify({ src: s, dst: d, note: n })).join('\n') + '\n'
  return '这是测试回答。'
}
