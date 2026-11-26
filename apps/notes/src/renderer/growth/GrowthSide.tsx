/**
 * 左栏梦游报告里的「生长」（task-h7oy8，设计页 44 定 3「左栏『梦游报告』顶上一个『生长』看法；每晚的报告顶上放那晚的一张小图，点开是整张」）：
 * - GrowthSide：每一晚的列表（新的在上），点一晚中间的生长图停到那晚、下面展开那晚做了什么，点一篇在图上选中它；
 * 报告顶上那晚的小图换成了梦游前后对比动画（DreamReplay.tsx）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef } from 'react'
import type { GrowthNight } from '../../shared/growth'
import { t } from '../../shared/i18n'
import { dayText, weekText } from './dates'
import type { Model } from './model'
import { focusNight, loadGrowth, setGrowth, useGrowth } from './store'

/** 那晚每一样做了几条（短名字） */
const shortName = (g: string): string =>
  ({ link: t('补双链'), unsure: t('拿不准'), recheck: t('复查'), file: t('归类'), dup: t('可能重复'), viz: t('可视化'), week: t('小结'), attach: t('附件'), commit: t('提交'), log: t('整理') })[g] ?? g

export function nightSummary(m: Model, n: GrowthNight): string {
  const c = new Map<string, number>()
  for (const it of n.items) c.set(it.group, (c.get(it.group) ?? 0) + 1)
  const parts = [...c].map(([g, k]) => `${shortName(g)}${k}`)
  const lines = m.d.links.filter((l) => l.dream && l.day === n.day).length
  if (lines) parts.push(t('连了{n}条线', { n: lines }))
  return parts.join(' · ')
}

export function GrowthSide(props: { onOpenGrowth(): void; onOpenNote(path: string): void; onShowReport(): void }) {
  const g = useGrowth()
  const m = g.model
  useEffect(() => loadGrowth(), [])
  // 停在哪一晚（点出来的；拖时间轴、播放时不算）
  const cur = m && g.night !== null && g.night === (g.t ?? m.end) ? g.night : null
  const nights = useMemo(() => (m ? [...m.d.nights].reverse() : []), [m])
  const on = useRef<HTMLDivElement>(null)
  useEffect(() => {
    on.current?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  if (!m)
    return (
      <div className="gr-list">
        <div className="dsum" data-testid="growth-side-empty">
          {g.state.error ? t('生长图没算出来：{e}', { e: g.state.error }) : t('正在读库的历史…')}
        </div>
      </div>
    )
  const d = m.d
  const dreamLines = d.links.filter((l) => l.dream).length
  return (
    <div className="gr-list gr-side" data-testid="growth-side">
      <div className="dsum">
        {t('库里现在')}
        <b className="num">{d.notes.length.toLocaleString()}</b>
        {t('篇笔记、')}
        <b className="num">{d.links.length.toLocaleString()}</b>
        {t('条链接')}
        {dreamLines ? t('，{n}条是梦游和整理连的', { n: dreamLines.toLocaleString() }) : ''}
        {t('。点一晚，中间的图停到那天，那晚连的线加粗。')}
        <button className="btn btn-sm" onClick={props.onOpenGrowth}>
          <Codicon name="graph-scatter" size={14} />
          {t('看整张生长图')}
        </button>
      </div>
      <div className="dg">
        {t('每一晚')}
        <span>{t('{n}晚', { n: nights.length })}</span>
      </div>
      {!nights.length && <p className="gr-none">{t('还没有梦游过。梦游每晚连的线会用强调色画在图上，这里一晚一行。')}</p>}
      {nights.map((n) => {
        const active = cur === n.day
        return (
          <div key={n.day} ref={active ? on : undefined} className={'gr-night' + (active ? ' on' : '')}>
            <button
              className={'di' + (active ? ' on' : '')}
              data-testid="growth-night"
              onClick={() => {
                focusNight(n.day)
                props.onOpenGrowth()
              }}
            >
              <span className="ico">
                <Codicon name={n.src === 'dream' ? 'wand' : 'history'} size={14} />
              </span>
              <span className="tx">
                <b className="num">{`${dayText(n.day, d.today)} ${weekText(n.day)}`}</b>
                <span>{nightSummary(m, n) || t('这晚没动什么')}</span>
              </span>
              {n.report && <span className="st">{t('这份报告')}</span>}
            </button>
            {active && (
              <div className="gr-did" data-testid="growth-night-detail">
                <div className="k">{n.src === 'dream' ? t('这晚梦游做了什么') : t('这晚整理了{n}篇', { n: n.touched.length })}</div>
                {n.items.slice(0, 30).map((it, k) => (
                  <button
                    key={k}
                    className={'row' + (it.state !== 'taken' ? ' ' + it.state : '')}
                    disabled={!it.notes.length}
                    onClick={() => {
                      const p = d.notes[it.notes[0]!]!.path
                      setGrowth({ sel: p })
                      props.onOpenGrowth()
                    }}
                  >
                    <span className="nm">{it.title}</span>
                    {(it.sub || it.state !== 'taken') && <span className="sb">{[it.sub, it.state === 'pending' ? t('还没收下') : it.state === 'dropped' ? t('丢掉了') : ''].filter(Boolean).join(' · ')}</span>}
                  </button>
                ))}
                {n.items.length > 30 && <p className="more">{t('还有{n}条', { n: n.items.length - 30 })}</p>}
                {n.report && (
                  <button className="btn btn-sm" onClick={props.onShowReport}>
                    <Codicon name="wand" size={14} />
                    {t('看这晚的报告')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
