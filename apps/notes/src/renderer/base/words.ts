/**
 * 数据库界面上要翻的那几样（英文界面，task-zojmg 的规矩）：@cn/format 里的表（列的类型、看法、条件、计算、加一列的几组）
 * 写的是中文原句，画的时候 t(原句, { ctx: '数据库' })；筛选小标签、日期的「7天后」、组名「没填」在这里照 format 的写法拼成界面语言。
 * 只管给人看的字：写进文件的（视图名、列名、筛选写法）不经过这里。
 */
import { type BaseCond, type BaseFilter, colLabel, type FieldType, type FilterItem, isGroup, isRaw, isRelDay, opLabel, type RowGroup } from '@cn/format'
import { t } from '../../shared/i18n'

/** format 表里的一个名字（COL_TYPES、VIEW_TYPES、ADD_COLUMN、FILTER_OPS、DAY_CHOICES、SUMMARIES、ROLLUP_CALCS 的 label） */
export const fmt = (label: string) => t(label, { ctx: '数据库' })

/** 列名给人看：名字列写界面语言的「名字」，公式列去掉 formula. */
export const colText = (c: string) => (c === 'file.name' || c === 'file.basename' ? t('名字') : colLabel(c))

const REL = /^today\(\)(?: ([+-]) "(\d+)([dwMy])")?$/

/** 相对今天的日期给人看：今天、7天后、2周前…（同 format 的 dayLabel）；具体日子照写 */
export function dayWords(v: string): string {
  const m = REL.exec(v)
  if (!m) return v
  if (!m[1]) return t('今天')
  const n = m[2]!
  const after = m[1] === '+'
  if (m[3] === 'w') return after ? t('{n}周后', { n }) : t('{n}周前', { n })
  if (m[3] === 'M') return after ? t('{n}个月后', { n }) : t('{n}个月前', { n })
  if (m[3] === 'y') return after ? t('{n}年后', { n }) : t('{n}年前', { n })
  return after ? t('{n}天后', { n }) : t('{n}天前', { n })
}

/** 一条筛选的小标签（同 format 的 condText）：「状态 不是 学完」「日期 早于 7天后」「在读 否」 */
export function condWords(c: BaseCond, type: FieldType): string {
  const name = colText(c.prop)
  if (type === 'check' && c.op === '==') return c.value === 'true' ? t('{name} 是', { name }) : t('{name} 否', { name })
  if (c.op === 'days') return t('{name} 最近 {n} 天', { name, n: c.value })
  const op = fmt(opLabel(c.op, type))
  if (c.op === 'empty' || c.op === 'notempty') return `${name} ${op}`
  return `${name} ${op} ${isRelDay(c.value) ? dayWords(c.value) : c.value}`
}

/** 整个筛选的小标签（同 format 的 filterText）：「状态 不是 学完 且 （日期 早于 7天后 或 日期 为空）」 */
export function filterWords(f: BaseFilter, typeOf: (col: string) => FieldType): string {
  const join = (g: BaseFilter) => g.items.map(one).join(g.conj === 'or' ? ` ${t('或')} ` : ` ${t('且')} `)
  const one = (x: FilterItem): string => {
    if (isGroup(x)) return x.conj === 'not' ? t('不（{x}）', { x: join(x) }) : t('（{x}）', { x: join(x) })
    return isRaw(x) ? x.raw : condWords(x, typeOf(x.prop))
  }
  return f.conj === 'not' ? t('不（{x}）', { x: join(f) }) : join(f)
}

/** 组名给人看：没填的那一组、勾选列的「是 / 否」照界面语言，别的是笔记里写的值 */
export function groupWords(g: RowGroup, type: FieldType): string {
  if (g.key === '') return t('没填')
  if (g.period) {
    const { by, year: y, num } = g.period
    if (by === 'month') return g.period.thisYear ? t('{m}月', { m: num }) : t('{y}年{m}月', { y, m: num })
    return g.period.thisYear ? t('第{w}周', { w: num }) : t('{y}年第{w}周', { y, w: num })
  }
  if (type === 'check') return g.key === 'true' ? t('是', { ctx: '勾选' }) : t('否', { ctx: '勾选' })
  return g.label
}
