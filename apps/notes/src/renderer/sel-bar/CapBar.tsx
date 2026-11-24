/**
 * PDF、HTML 上框好一块、选好一段的工具条里的按钮（task-26nz7）：照设置 › 选中小条的表画——条上那几颗（自己加的排在竖线前），
 * ⋯ 里收进去的那几颗、翻译设置…、加一颗…、小条设置…，最后 ×。样子照旧是 composer.css 的 .capbar（34 高）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import type { ReactNode } from 'react'
import { useT } from '../i18n'
import { AiIcon } from '../engine-logo'
import { type BarBtn, barView, useBar, useFresh } from './store'

export interface CapActs {
  explain(): void
  translate(): void
  quote(): void
  copy(): void
  cmd(id: string): void
  trSettings(): void
  add(): void
  settings(): void
}

function Ico({ icon }: { icon: string }) {
  if (icon === 'ai') return <AiIcon job="chat" size={14} />
  if (icon === 'tr') return <AiIcon job="translate" size={14} />
  return <Codicon name={icon as CodiconName} size={14} />
}

/** 一颗按下去做什么 */
function run(b: BarBtn, a: CapActs) {
  if (b.id === 'explain') return a.explain()
  if (b.id === 'translate') return a.translate()
  if (b.id === 'quote') return a.quote()
  if (b.id === 'copy') return a.copy()
  if (b.mine) return a.cmd(b.id)
}

/** 条上、⋯ 里的按钮；quote：选的是字（拷贝写「拷贝这段」），框的是图写「拷贝这块」 */
export function CapButtons(props: { place: 'pdf' | 'html'; quote: boolean; more: boolean; setMore(v: boolean): void; onCancel(): void; acts: CapActs; escKey: string | null; /** 这一处特有的几颗（PDF 选字时划线的颜色），排在通用那几颗后面、⋯ 前面 */ own?: ReactNode }) {
  const t = useT()
  const { bar, mine } = useBar()
  const fresh = useFresh()
  const v = barView(bar, mine, props.place)
  const label = (b: BarBtn) => (b.id === 'copy' ? (props.quote ? t('拷贝这段') : t('拷贝这块')) : b.label)
  const btn = (b: BarBtn) => (
    <button key={b.id} className={(b.id === 'explain' ? 'main' : '') + (fresh === b.id ? ' new' : '')} data-k={b.id} onClick={() => run(b, props.acts)}>
      <Ico icon={b.icon} />
      {label(b)}
      {b.key && (b.id !== 'copy' || props.quote) && <kbd>{b.key}</kbd>}
    </button>
  )
  const close = (f: () => void) => () => {
    props.setMore(false)
    f()
  }
  return (
    <>
      {v.main.map(btn)}
      {v.tail.length > 0 && <span className="sepv" />}
      {v.tail.map(btn)}
      <span className="sepv" />
      {props.own}
      <button className={'icon' + (props.more ? ' on' : '')} aria-label={t('更多')} aria-haspopup="menu" aria-expanded={props.more} onClick={() => props.setMore(!props.more)}>
        <Codicon name="ellipsis" size={14} />
      </button>
      <button className="icon" aria-label={t('取消')} data-tip={`${t('取消')} ${props.escKey ?? ''}`.trim()} data-side="below" onClick={props.onCancel}>
        <Codicon name="close" size={14} />
      </button>
      {props.more && (
        <div className="capmenu" role="menu" aria-label={props.quote ? t('这段还能做什么') : t('这块还能做什么')}>
          {v.more.map((b) => (
            <button key={b.id} role="menuitem" onClick={close(() => run(b, props.acts))}>
              <Ico icon={b.icon} />
              {label(b)}
              {b.key && (b.id !== 'copy' || props.quote) && <span className="r">{b.key}</span>}
            </button>
          ))}
          {v.more.length > 0 && <div className="ms" />}
          <button role="menuitem" onClick={close(props.acts.trSettings)}>
            <Codicon name="settings-gear" size={14} />
            {t('翻译设置…')}
          </button>
          <div className="ms" />
          <button role="menuitem" onClick={close(props.acts.add)}>
            <Codicon name="add" size={14} />
            {t('加一颗…')}
            <span className="r">{t('拿这段试')}</span>
          </button>
          <button role="menuitem" onClick={close(props.acts.settings)}>
            <Codicon name="list-selection" size={14} />
            {t('小条设置…')}
          </button>
        </div>
      )}
    </>
  )
}

/** 框着、选着时自己加的那颗的键（PDF、HTML 的键盘监听里用）：按的是哪颗的键 */
export function ownKeyHit(combo: string | null, place: 'pdf' | 'html', bar: Parameters<typeof barView>[0], mine: Parameters<typeof barView>[1]): string | null {
  if (!combo) return null
  const v = barView(bar, mine, place)
  return [...v.main, ...v.tail, ...v.more].find((b) => b.mine && b.key === combo)?.id ?? null
}
