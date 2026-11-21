/**
 * 设置方向 A 的几块积木（原型 proto-a.html）：页头、一组一张细线表、一行（左边名字和说明、右边 220 一列）、
 * 220 宽的下拉和分段、键位按钮；改了马上存，底下提示条一句说会怎样、带「撤回」（SaidContext）。
 * 每一行带 data-row（同 shared/settings-index.ts 的 id），搜索回车、从用的地方跳过来时翻到它、闪 1.6 秒。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { withKeys } from '../keys'
import { createContext, useContext, type ReactNode } from 'react'
import { type SettingsPageInfo, settingsItem } from '../../shared/settings-index'
import { AiIcon } from '../engine-logo'

/** 页头：图标、名字、一句这页管什么 */
export function PageHead({ page }: { page: SettingsPageInfo }) {
  return (
    <div className="sa-head" data-testid="settings-head">
      <span className="pi">{page.id === 'ai' ? <AiIcon job="chat" size={18} /> : <Codicon name={page.icon as CodiconName} size={18} />}</span>
      <div>
        <h2>{page.name}</h2>
        <p>{page.desc}</p>
      </div>
    </div>
  )
}

/** 一组：组名 + 一张细线表 */
export function Group(props: { title: string; children: ReactNode; label?: string }) {
  return (
    <>
      <div className="sa-grph">{props.title}</div>
      <div className="sa-card" role="group" aria-label={props.label ?? props.title}>
        {props.children}
      </div>
    </>
  )
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
  const it = settingsItem(props.id)
  const label = props.label ?? it?.label
  // 说明里提到键写成 {k:id}（shared/settings-index.ts），照现在的键写
  const desc = props.desc !== undefined ? props.desc : it?.desc && withKeys(it.desc)
  return (
    <div className={'sa-row' + (props.full ? ' full' : '') + (props.info ? ' info' : '') + (props.dim ? ' dim' : '')} data-row={props.id}>
      <div className="sa-txt">
        <div className="sa-lb">{label}</div>
        {desc ? <div className="sa-ds">{desc}</div> : null}
      </div>
      {!props.info && <div className="sa-cc">{props.children}</div>}
      {props.more && <div className="sa-more">{props.more}</div>}
    </div>
  )
}

/** 220 宽的下拉：选项是 [值, 写给人看的字] */
export function Sel<T extends string | number>(props: { label: string; value: T; options: readonly (readonly [T, string, boolean?])[]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <select
      className="sa-sel"
      aria-label={props.label}
      value={String(props.value)}
      disabled={props.disabled}
      onChange={(e) => {
        const o = props.options.find(([v]) => String(v) === e.currentTarget.value)
        if (o) props.onChange(o[0])
      }}
    >
      {props.options.map(([v, text, off]) => (
        <option key={String(v)} value={String(v)} disabled={off}>
          {text}
        </option>
      ))}
    </select>
  )
}

/** 220 宽的分段（两三样里挑一样，比如「文档 / 白板」） */
export function Seg<T extends string>(props: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }) {
  return (
    <div className="sa-seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={props.value === v} className={props.value === v ? 'on' : ''} onClick={() => props.value !== v && props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** 说明里的小链接（「排顺序 ›」「去Git和同步 ›」） */
export function Lnk(props: { children: ReactNode; onClick(): void; label?: string }) {
  return (
    <button type="button" className="sa-lnk" aria-label={props.label} onClick={props.onClick}>
      {props.children}
      <Codicon name="chevron-right" size={12} />
    </button>
  )
}

/** 设置里改了一项之后，底下提示条说的话：已存 · 会怎样，带「撤回」；别的事（存好了、导入了）只说一句 */
export interface Said {
  /** 改了一项：hint 是这次改了会怎样，undo 撤回成原来的值 */
  saved(hint: string, undo?: () => void): void
  /** 只说一句（不带撤回） */
  say(text: string): void
}
export const SaidContext = createContext<Said>({ saved: () => undefined, say: () => undefined })
export const useSaid = () => useContext(SaidContext)

/** 「开了 / 关了 / 改成」的默认说法 */
export function hintFor(label: string, v: boolean | string): string {
  return typeof v === 'boolean' ? `「${label}」${v ? '开了' : '关了'}` : `「${label}」改成「${v}」`
}
