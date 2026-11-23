/**
 * 设置方向 A 的几块积木（原型 proto-a.html）：页头、一组一张细线表、一行（左边名字和说明、右边 220 一列）、
 * 220 宽的下拉和分段、键位按钮；改了马上存，底下提示条一句说会怎样、带「撤回」（SaidContext）。
 * 框架（组、一行、下拉、分段、开关、提示条）在 @cn/design/settings，画布今日也用；这里只把画布笔记自己的说法接上：
 * 一行的名字、说明照 shared/settings-index.ts 的 id 拿（文字只写一处），页头照那一页的信息画（AI 页画 AI 的标志）。
 * 每一行带 data-row（同 settings-index 的 id），搜索回车、从用的地方跳过来时翻到它、闪 1.6 秒。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { PageHead as BasePageHead, Row as BaseRow } from '@cn/design/settings'
import { withKeys } from '../keys'
import type { ReactNode } from 'react'
import { type SettingsPageInfo, settingsItem } from '../../shared/settings-index'
import { AiIcon } from '../engine-logo'
import { t as tNow } from '../../shared/i18n'
import { useT } from '../i18n'

export { Group, Lnk, type Said, SaidContext, Seg, Sel, useSaid } from '@cn/design/settings'

/** 页头：图标、名字、一句这页管什么 */
export function PageHead({ page }: { page: SettingsPageInfo }) {
  const t = useT()
  return <BasePageHead icon={page.id === 'ai' ? <AiIcon job="chat" size={18} /> : <Codicon name={page.icon as CodiconName} size={18} />} title={t(page.name)} desc={t(page.desc)} />
}

/**
 * 一行。id 对上 settings-index 的一项，名字、说明不给就用那里的（文字只写一处）；
 * full：要长输入框的一行，框在说明下面整行宽；info：只有字，没有控件
 */
export function Row(props: {
  id: string
  label?: ReactNode
  desc?: ReactNode
  children?: ReactNode
  full?: boolean
  info?: boolean
  dim?: boolean
  /** 整行宽、跟在说明下面的一句（撞键提示、地址还没保存……） */
  more?: ReactNode
}) {
  const t = useT()
  const it = settingsItem(props.id)
  // label={null}：这一行不写名字（组名已经说了，比如「最近跑的」），不回落到索引里的名字
  const label = props.label !== undefined ? props.label : it?.label && t(it.label)
  // 说明里提到键写成 {k:id}（shared/settings-index.ts），先翻再照现在的键写
  const desc = props.desc !== undefined ? props.desc : it?.desc && withKeys(t(it.desc))
  return <BaseRow {...props} label={label} desc={desc} />
}

/** 「开了 / 关了 / 改成」的默认说法 */
export function hintFor(label: string, v: boolean | string): string {
  if (typeof v !== 'boolean') return tNow('「{label}」改成「{value}」', { label, value: v })
  return v ? tNow('「{label}」开了', { label }) : tNow('「{label}」关了', { label })
}
