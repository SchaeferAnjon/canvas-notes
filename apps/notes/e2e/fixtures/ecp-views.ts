/**
 * 数据库第三批第 2 块（task-i921u）的样本：设计页那一块（packages/format/test/base-samples.ts 的 ECP_BASE），
 * 三篇文档各把看板、日历、画廊挪到第一个视图（第 3 块的视图标签条来之前，打开就是这种看法）。
 */
import { ECP_BASE } from '../../../../packages/format/test/base-samples'

/** 把名叫 name 的那个视图挪到最前面（块里其余一字不动），第 3 块的视图标签条来之前，打开就是这种看法 */
export function viewFirst(base: string, name: string): string {
  const at = base.indexOf('\nviews:\n')
  const head = base.slice(0, at + '\nviews:\n'.length)
  const views = base.slice(head.length).split(/\n(?=  - type: )/)
  const i = views.findIndex((v) => v.includes(`\n    name: ${name}`))
  const [v] = views.splice(i, 1)
  return head + [v, ...views].join('\n')
}

const doc = (title: string, base: string) => `# ${title}\n\n这学期每周两讲，期末前留一周复习。\n\n\`\`\`base\n${base}\n\`\`\`\n\n## 备注\n\n第7讲的日期还没排。\n`
export const DOCS: Record<string, string> = {
  '课程/ecp/ecp 看板.md': doc('ecp 看板', viewFirst(ECP_BASE, '看板')),
  '课程/ecp/ecp 日历.md': doc('ecp 日历', viewFirst(ECP_BASE, '日历')),
  '课程/ecp/ecp 画廊.md': doc('ecp 画廊', viewFirst(ECP_BASE, '画廊')),
}
