/**
 * 自动化写成给人看的话（右栏卡片、编辑、设置 › 自动化共用）。句子本身是 @cn/format 的 ruleSentence / whenLabel / stepLabel 拼的，
 * 这里只把「当」「如果」「就」加粗、待办和通知里的 {{名字}} 画成小灰块，不另写一套说法。
 */
import { type AutoRule, type AutoStep, type FieldType, stepLabel, whenLabel } from '@cn/format'
import { Fragment, type ReactNode } from 'react'
import { t } from '../../shared/i18n'
import { when } from '../../shared/when'
import { filterWords } from './words'

// 不翻：写进文件的、e2e 认的
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 模板里的 {{名字}} 画成小灰块 */
export function withVars(text: string): ReactNode {
  return text.split(/(\{\{[^}]+\}\})/).map((p, i) => {
    const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(p)
    return m ? (
      <span key={i} className="au-var">
        {m[1]}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    )
  })
}

/** 一步给人看：stepLabel 的那一句，待办、通知的字换成带小灰块的原文 */
export function StepText(props: { step: AutoStep }) {
  const s = props.step
  const label = stepLabel(s)
  if (s.do !== 'todo' && s.do !== 'notify') return <>{label}</>
  const i = label.indexOf('「')
  return (
    <>
      {label.slice(0, i + 1)}
      {withVars(s.text)}」
    </>
  )
}

/** 一条规则写成一句（同 ruleSentence）：当 … · 如果 … · 就 …，再 …；plain 不加粗 */
export function RuleSentence(props: { rule: AutoRule; typeOf: (col: string) => FieldType; plain?: boolean }) {
  const { rule } = props
  const B = (x: string) => (props.plain ? <>{x}</> : <b>{x}</b>)
  // 「当」「就」后面那一串是 format 的 whenLabel / stepLabel（同 ruleSentence）
  return (
    <>
      {B(t('当'))} {rule.when.length ? rule.when.map(whenLabel).join(t('，或') + ' ') : t('还没选')}
      {rule.if && rule.if.items.length > 0 && (
        <>
          {' · '}
          {B(t('如果'))} {filterWords(rule.if, props.typeOf)}
        </>
      )}
      {' · '}
      {B(t('就'))}{' '}
      {rule.do.length
        ? rule.do.map((s, i) => (
            <Fragment key={i}>
              {i > 0 && t('，再') + ' '}
              <StepText step={s} />
            </Fragment>
          ))
        : t('还没加')}
    </>
  )
}

/** 记录、卡片上的时候（记录里是本地时间 2026-11-21T08:40:00）：照全软件同一种写法「今天 14:07」「周四 09:12」「11月21日 08:40」 */
export function atText(iso: string): string {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? iso : when(ms, { time: true })
}

/** 有 AI 那一步：卡片、设置那一行画引擎标志，不然画闪电 */
export const hasAi = (steps: AutoStep[]) => steps.some((s) => s.do === 'ai')
