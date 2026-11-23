/**
 * 自动化、按钮列的 e2e 样本（task-i921u「当……就……」）：设计页拿来举例的一个记账数据库，十四笔十一月的账。
 * 只是测试用的库：软件不预置任何规则，也不做记账专门的东西。
 */

export const LEDGER_DOC_PATH = '生活/2026 记账.md'
export const LEDGER = '生活/账目'

export const LEDGER_BASE = `filters:
  and:
    - file.inFolder("${LEDGER}")
properties:
  分类:
    type: select
  收支:
    type: select
views:
  - type: table
    name: 全部
    order:
      - file.name
      - 日期
      - 金额
      - 分类
      - 收支`

export const LEDGER_DOC = `# 2026 记账\n\n每笔一条，月底看结余。分类不用自己填，记完它自己猜。\n\n\`\`\`base\n${LEDGER_BASE}\n\`\`\`\n`

const row = (日期: string, 金额: number, 分类: string, 收支: string) => `---\n日期: ${日期}\n金额: ${金额}\n分类: ${分类}\n收支: ${收支}\n---\n\n`

export const LEDGER_ROWS: Record<string, string> = Object.fromEntries(
  (
    [
      ['咖啡', '2026-11-21', 18, '餐饮', '支出'],
      ['外卖', '2026-11-20', 41, '餐饮', '支出'],
      ['打车', '2026-11-18', 46, '交通', '支出'],
      ['买书', '2026-11-16', 89, '学习', '支出'],
      ['稿费', '2026-11-15', 600, '副业', '收入'],
      ['聚餐', '2026-11-12', 168, '餐饮', '支出'],
      ['话费', '2026-11-10', 58, '日用', '支出'],
      ['电影', '2026-11-08', 70, '娱乐', '支出'],
      ['打印资料', '2026-11-06', 35, '报销', '支出'],
      ['工资', '2026-11-05', 8200, '工资', '收入'],
      ['地铁充值', '2026-11-04', 100, '交通', '支出'],
      ['午饭', '2026-11-03', 32, '餐饮', '支出'],
      ['超市', '2026-11-02', 286, '日用', '支出'],
      ['房租', '2026-11-01', 2600, '住房', '支出'],
    ] as const
  ).map(([n, d, a, c, k]) => [`${LEDGER}/${n}.md`, row(d, a, c, k)]),
)

export const TODO_DOC = '生活/待办.md'

export const LEDGER_FILES: Record<string, string> = { [LEDGER_DOC_PATH]: LEDGER_DOC, ...LEDGER_ROWS, [TODO_DOC]: '# 待办\n\n' }
