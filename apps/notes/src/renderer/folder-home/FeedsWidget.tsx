/**
 * 文件夹首页的「画布订阅」组件（画布订阅第二批，设计页 135「文件夹首页『订阅』组件：文件夹绑一个订阅分组，首页列这组的新文章」）：
 * 和 ParaRead、MeetCaption 组件同一套样子（.prw：一颗实心主按钮、行高 30 的列表、同样的「没装」写法）。
 * - 读到了：组件头一行右边的小标签写绑的是哪一组（FeedsTag，和 MeetCaption、ParaRead 组件的小标签同一个位置），点一下换下一组
 *   （存在 .首页.json 这个组件的 feedsGroup 里，没选是「全部」），
 *   下面这一组最新几篇（没读的标一个点），点一篇在画布订阅里打开；「打开画布订阅」。
 * - 读不到（没装、没打开过）：一句话 +「打开画布订阅」。
 * 数从画布订阅写的 widget.json 来（main/feeds-widget.ts）；窗口回到前面时重读。
 */
import { useCallback, useEffect, useState } from 'react'
import type { FeedsWidgetData } from '../../shared/feeds-widget'
import { useLang, useT } from '../i18n'
import type { WCtx } from './widgets'

const agoText = (t: ReturnType<typeof useT>, ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  if (m < 60) return t('{n}分钟前', { n: Math.max(1, m) })
  const h = Math.round(m / 60)
  if (h < 24) return t('{n}小时前', { n: h })
  return t('{n}天前', { n: Math.round(h / 24) })
}

/** 组件头一行右边的小标签：这个文件夹绑的订阅分组；点一下换下一组（同 McTag 点一下换模式） */
export function FeedsTag({ group, onGroup }: { group: string | undefined; onGroup(id: string): void }) {
  const t = useT()
  const [data, setData] = useState<FeedsWidgetData | null>(null)
  // 和组件一样：窗口回到前面时重读（画布订阅那边可能刚写了）
  useEffect(() => {
    const load = () => void window.cnFeeds.widget().then(setData, () => setData(null))
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [group])
  if (!data?.groups.length) return null
  const k = Math.max(0, data.groups.findIndex((x) => x.id === group))
  const g = data.groups[k]!
  return (
    <button className="prw-tag truncate" data-testid="feeds-group" data-tip={t('点一下换这个文件夹绑的订阅分组')} onClick={() => onGroup(data.groups[(k + 1) % data.groups.length]!.id)}>
      {`${t('订阅')} · ${g.id === 'all' ? t('全部') : g.name}`}
    </button>
  )
}

export function FeedsBody({ c: _c, group }: { c: WCtx; group: string | undefined; onGroup?(id: string): void }) {
  const t = useT()
  useLang()
  const [data, setData] = useState<FeedsWidgetData | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      void window.cnFeeds.widget().then(
        (d) => (setData(d), setError(null)),
        (e: unknown) => setError(String((e as Error).message ?? e)),
      ),
    [],
  )
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  if (error) return <p className="fw-empty">{error}</p>
  if (data === undefined) return null
  if (!data)
    return (
      <div className="prw" data-testid="feeds-widget">
        <div className="prw-now">
          <b>{t('还没读到画布订阅')}</b>
        </div>
        <p className="prw-say">{t('画布订阅是这一家的 RSS 阅读器：装好、打开过一次以后，这里列你绑的那一组订阅的新文章。')}</p>
        <div className="prw-acts">
          <button className="prw-go" onClick={() => void window.cnFeeds.openApp()}>
            {t('打开画布订阅')}
          </button>
        </div>
      </div>
    )
  const g = data.groups.find((x) => x.id === group) ?? data.groups[0]
  const now = Date.now()
  return (
    <div className="prw" data-testid="feeds-widget">
      <div className="prw-now">{g && g.unread > 0 ? t('{n} 篇没读', { n: g.unread }) : t('都读过了')}</div>
      <div className="prw-acts">
        <button className="prw-go" onClick={() => void window.cnFeeds.openApp()}>
          {t('打开画布订阅')}
        </button>
      </div>
      <div className="prw-hd">{t('新文章')}</div>
      {!g?.articles.length && <p className="fw-empty">{t('这一组还没有文章。')}</p>}
      {g?.articles.slice(0, 6).map((a) => (
        <div key={a.id} className={'fw-row prw-row fdw-row' + (a.read ? ' rd' : '')} data-testid="feeds-row">
          <i className="fdw-dot" aria-label={a.read ? undefined : t('未读')} />
          <button className="nm truncate" title={a.title} onClick={() => void window.cnFeeds.open(a.id)}>
            {a.title}
          </button>
          <span className="r num truncate">
            {a.feed} · {agoText(t, a.publishedAt, now)}
          </span>
        </div>
      ))}
    </div>
  )
}
