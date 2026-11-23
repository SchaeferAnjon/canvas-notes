/**
 * 表底合计（task-i921u「通用合计」，原型 automations/proto.html「表底算什么」「按月合计」「按分类占比」）：
 * 表底一格点开选算法（只管当前视图，写进 summaries，底部能撤回）、表底一格的样子「求和 25,200」、组头的小计和占比条。
 * 算法和怎么算在 packages/format 的 base-sums.ts；这里只管名字（包 t()）、数怎么写、菜单。
 */
import { Codicon } from '@cn/design'
import { type BaseCtx, type BaseRec, calcName, isSummaryId, type Summary, SUMMARY_MENU, type SummaryId, type SumKind, summaryOf } from '@cn/format'
import { t, uiLang } from '../../shared/i18n'
import { FloatPop, type PopAnchor } from '../pop-place'
import { dayText } from './cols'
import { fmt } from './words'
import './sums.css'

/** 菜单里的名字（照原型，名字在 format 的 CALC_LABEL）；日期列的 Range 叫「跨了几天」 */
export const calcLabel = (id: string, kind: SumKind): string => (isSummaryId(id) ? fmt(calcName(id, kind)) : id)

/** 表底一格前面那个小字（原型「条数 32条」「求和 25,200」） */
export function calcShort(id: string, kind: SumKind): string {
  if (!isSummaryId(id)) return id
  const S: Record<SummaryId, string> = {
    Count: t('条数', { ctx: '表底' }),
    Filled: t('有值', { ctx: '表底' }),
    Empty: t('空着', { ctx: '表底' }),
    Unique: t('不同', { ctx: '表底' }),
    PercentFilled: t('有值', { ctx: '表底' }),
    PercentEmpty: t('空着', { ctx: '表底' }),
    Sum: t('求和', { ctx: '表底' }),
    SumShare: t('求和', { ctx: '表底' }),
    Average: t('平均', { ctx: '表底' }),
    Median: t('中位', { ctx: '表底' }),
    Min: t('最小', { ctx: '表底' }),
    Max: t('最大', { ctx: '表底' }),
    Range: kind === 'date' ? t('跨了', { ctx: '表底' }) : t('范围', { ctx: '表底' }),
    Earliest: t('最早', { ctx: '表底' }),
    Latest: t('最晚', { ctx: '表底' }),
    Checked: t('勾了', { ctx: '表底' }),
    Unchecked: t('没勾', { ctx: '表底' }),
    PercentChecked: t('勾了', { ctx: '表底' }),
  }
  return S[id]
}

/** 算出来的数怎么写：条数「32条」、占几成「88%」、数「25,200」（千分位跟界面语言）、日期「11月10日」、天数「78天」 */
export function sumText(s: Summary): string {
  switch (s.kind) {
    case 'count':
      return t('{n}条', { n: s.num ?? 0 })
    case 'percent':
      return s.text
    case 'number':
      return s.num === null ? '' : s.num.toLocaleString(uiLang() === 'en' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 })
    case 'date':
      return dayText(s.text)
    case 'days':
      return t('{n}天', { n: s.num ?? 0 })
    case 'none':
      return ''
  }
}

/** 点表底一格出的菜单：「「支出」算什么 · 这个视图」、不算、按列的种类分几段（每样后面是现在这几条算出来的数）、最下面一句说明 */
export function SumMenu(props: { at: PopAnchor; col: string; label: string; kind: SumKind; cur: string | null; ctx: BaseCtx; rows: BaseRec[]; onPick(id: string | null): void }) {
  const { kind, cur } = props
  const name = t('「{col}」算什么 · 这个视图', { col: props.label })
  return (
    <FloatPop at={props.at} className="base-pop base-vmenu base-summenu" role="menu" aria-label={name} /* 不翻：data-part 给 e2e 和样式认 */ data-part="表底算什么">
      <div className="mlab">{name}</div>
      <button type="button" role="menuitemradio" aria-checked={!cur} className="mi" onClick={() => props.onPick(null)}>
        <span>{t('不算')}</span>
        {!cur && <Codicon name="check" size={14} className="ok" />}
      </button>
      {SUMMARY_MENU[kind].map((group, g) => (
        <div key={g} role="group">
          <div className="msep" />
          {group.map((id) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={cur === id} className="mi" onClick={() => props.onPick(id)}>
              <span>{calcLabel(id, kind)}</span>
              {cur === id ? <Codicon name="check" size={14} className="ok" /> : <span className="d2">{sumText(summaryOf(props.ctx, props.rows, props.col, id, kind))}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="hint2">{t('分组时每组按同一种算法出小计')}</div>
    </FloatPop>
  )
}

/** 组头的占比条（原型 .share：150 × 6 的灰条，后面「73%」）：这一组在「求和，组里画占比」那一列上占全部几成 */
export function ShareBar(props: { share: number; col: string }) {
  const p = Math.round(props.share * 100)
  return (
    <span className="base-share" /* 不翻：data-part 给 e2e 和样式认 */ data-part="占比条" aria-label={t('占「{col}」的 {p}%', { col: props.col, p })}>
      <span className="tr">
        <b style={{ width: `${p}%` }} />
      </span>
      {p}%
    </span>
  )
}
