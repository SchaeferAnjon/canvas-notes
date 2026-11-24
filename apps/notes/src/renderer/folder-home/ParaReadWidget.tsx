/**
 * 文件夹 / 课程首页的「ParaRead」组件（ParaRead 联动，设计 20-pararead联动「ParaRead 组件放进画布笔记」，2026-11-23 用户定另放一张）：
 * 和 MeetCaption 组件同一套样子（首页现有的组件卡、一颗实心主按钮、行高 30 的列表、同样的「没装」写法）。
 * - 装了：最近在读的那篇放最上面（读到哪、哪一节、读了多久、还有几处看不懂），「继续读」用 ParaRead 打开、翻到读到的那页
 *   （深链 pararead://open，带着这个文件夹，ParaRead 里「在画布笔记里继续」回到这个首页）；下面这个文件夹里每份 PDF 一行，「读」「笔记」。
 * - 没装：「这台 Mac 上没装 ParaRead」+ 家族名单里那一句，「下载 ParaRead」打开官网，点了变成「等你装好 · 装好了，再看一下」；
 *   PDF 照样列，「读」用画布笔记自己打开，右边写画布笔记的「问到 28 / 43 页」。
 * 数从库里来：读到哪是两个软件共用的 .canvas-notes/读到哪.json，看不懂是配对笔记里还没问过、没写「看懂了」的那几处；文件一变（ParaRead 写了）重读。
 */
import { Codicon } from '@cn/design'
import { notePathFor, readAtLabel, readMinutes, readPct } from '@cn/format'
import { useCallback, useEffect, useState } from 'react'
import type { FolderReads } from '../../shared/reading'
import { titleOf } from '../../shared/layout'
import { recheckFamily, useFamily } from '../family-store'
import { useLang, useT } from '../i18n'
import type { WCtx } from './widgets'
import { ipcOn } from '../crash/ipc'

export type Item = FolderReads['items'][number]

type T = ReturnType<typeof useT>

/** 一份 PDF 右边的数：装了写读到哪和看不懂；没装写画布笔记的「问到第几页」（组件和「全部 N 份」列表页一样） */
export function readRight(t: T, installed: boolean, x: Item): string {
  if (!installed) return x.asked ? t('问到 {at} 页', { at: x.asked.replace('/', ' / ') }) : t('没问过')
  const pct = x.read ? readPct(x.read) : undefined
  const parts = [x.read ? (pct !== undefined ? `${pct}%` : t('第{page}页', { page: x.read.page })) : x.readLabel ? x.readLabel.split(' · ')[0]! : t('没读过')]
  if (x.confused) parts.push(t('看不懂 {n}', { n: x.confused }))
  return parts.join(' · ')
}

/** 「读」：装了用 ParaRead 打开、翻到读到的那页（带着这个文件夹，回得来）；没装用画布笔记打开 */
export function readPdf(x: Item, o: { installed: boolean; view: PrView; folder: string; onOpenAt(pdf: string, page: number): void; onError(e: string): void }) {
  if (o.installed) void window.cnFamily.readInParaRead(x.pdf, { ...(x.read ? { page: x.read.page } : {}), back: o.folder, view: o.view }).catch((e: unknown) => o.onError(String((e as Error).message ?? e)))
  else o.onOpenAt(x.pdf, x.read?.page ?? 1)
}

/** 最近读的在前，没读过的按名字排在后面 */
export const order = (a: Item, b: Item) => (b.read?.at ?? 0) - (a.read?.at ?? 0) || a.pdf.localeCompare(b.pdf, 'zh-CN', { numeric: true })

/** 看法：ParaRead 里用保版面双语对照（默认）还是原文 */
export type PrView = 'bilingual' | 'original'
const other = (v: PrView): PrView => (v === 'bilingual' ? 'original' : 'bilingual')

export function ParaReadBody(props: { c: WCtx; view: PrView }) {
  const { c } = props
  const t = useT()
  const lang = useLang()
  const fam = useFamily()
  const [data, setData] = useState<FolderReads | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const load = useCallback(
    () =>
      void window.cnReading.folderReads(c.folder).then(
        (d) => (setData(d), setError(null)),
        (e: unknown) => setError(String((e as Error).message ?? e)),
      ),
    [c.folder],
  )
  // 文件一变（这边、ParaRead 写了笔记、读到哪）重读；不轮询 ParaRead
  useEffect(() => {
    load()
    const offA = ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(load)
    const offB = ipcOn(window.cn.onNoteChanged, 'cn.onNoteChanged')(load)
    return () => (offA(), offB())
  }, [load])
  const installed = !!fam?.installed.pararead
  // 点过「下载」、装好了：回到装了的样子
  useEffect(() => {
    if (installed) setWaiting(false)
  }, [installed])

  if (error) return <p className="fw-empty">{error}</p>
  if (!data || !fam) return null
  const items = [...data.items].sort(order)
  const now = items.find((x) => x.read)
  const read = (x: Item, view: PrView = props.view) => readPdf(x, { installed, view, folder: c.folder, onOpenAt: c.onOpenAt, onError: setError })
  const app = fam.list.apps.find((a) => a.id === 'pararead')
  const one = app ? (lang === 'en' ? (app.one.en ?? app.one.zh) : app.one.zh) : ''

  const right = (x: Item) => readRight(t, installed, x)

  return (
    <div className="prw" data-testid="pararead-widget">
      {installed ? (
        now ? (
          <>
            <div className="prw-now">
              {t('在读')} <b className="truncate">{titleOf(now.pdf).replace(/\.pdf$/i, '')}</b>
              {readPct(now.read!) !== undefined && <span>{` · ${t('读到 {pct}%', { pct: readPct(now.read!)! })}`}</span>}
            </div>
            <div className="prw-sub">
              {now.read!.section && <span>{now.read!.section}</span>}
              {!now.read!.section && readPct(now.read!) === undefined && <span>{readAtLabel(now.read!)}</span>}
              {readMinutes(now.read!) > 0 && <span>{t('读了 {n} 分钟', { n: readMinutes(now.read!) })}</span>}
              {now.confused > 0 && (
                <span className="cf">
                  <i />
                  {t('还有 {n} 处看不懂', { n: now.confused })}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="prw-now">{t('这个文件夹里的PDF还没在ParaRead里读过')}</div>
        )
      ) : (
        <>
          <div className="prw-now">
            <b>{t('这台 Mac 上没装 ParaRead')}</b>
          </div>
          <p className="prw-say">{`${one}${t('装了以后在这里一键对照读这几份，接着上次读到的地方。')}`}</p>
        </>
      )}
      <div className="prw-acts">
        {installed ? (
          items.length > 0 && (
            <>
              <button className="prw-go" data-testid="pararead-continue" onClick={() => read(now ?? items[0]!)}>
                {now ? t('继续读') : t('在ParaRead里读')}
              </button>
              {/* 只换这一次；这个文件夹默认用哪种在头上小标签里改 */}
              <button className="prw-alt" data-testid="pararead-alt" onClick={() => read(now ?? items[0]!, other(props.view))}>
                {props.view === 'bilingual' ? t('换成原文看') : t('换成对照看')}
                <Codicon name="chevron-down" size={12} />
              </button>
            </>
          )
        ) : waiting ? (
          <span className="prw-wait">
            {t('等你装好')} ·{' '}
            <button className="lnk" onClick={() => void recheckFamily()}>
              {t('装好了，再看一下')}
            </button>
          </span>
        ) : (
          <button className="prw-dl" data-testid="pararead-download" onClick={() => (setWaiting(true), void window.cnFamily.download('pararead'))}>
            {t('下载 ParaRead')}
          </button>
        )}
      </div>
      <div className="prw-hd">{installed ? t('这个文件夹里的 PDF · {n} 份', { n: items.length }) : t('这个文件夹里的 PDF（在画布笔记里照样能读）')}</div>
      {items.length === 0 && <p className="fw-empty">{t('这个文件夹里还没有PDF。')}</p>}
      {items.slice(0, 6).map((x) => (
        <div key={x.pdf} className="fw-row prw-row" data-testid="pararead-row">
          <Codicon name="file-pdf" size={14} />
          <button className="nm truncate" title={x.pdf} onClick={() => read(x)}>
            {titleOf(x.pdf).replace(/\.pdf$/i, '')}
          </button>
          <span className="r num">{right(x)}</span>
          <button className="lnk" onClick={() => read(x)}>
            {t('读', { ctx: 'ParaRead组件' })}
          </button>
          <button className="lnk" disabled={!x.note} title={x.note ? undefined : t('还没有笔记')} onClick={() => c.onOpen(notePathFor(x.pdf))}>
            {t('笔记', { ctx: 'ParaRead组件' })}
          </button>
        </div>
      ))}
      {items.length > 6 && (
        <button className="fw-more" onClick={c.onAll}>
          {t('全部{n}份 · 打开列表看', { n: items.length })}
        </button>
      )}
    </div>
  )
}

/** 组件头一行右边的小标签：这个文件夹 · 默认看法（装了才写看法）（和 MeetCaption 组件写「ecp · 课堂」同一个位置）；点了换这个文件夹默认用哪种看法 */
export function ParaReadTag(p: { folder: string; view: PrView; onView(v: PrView): void }) {
  const t = useT()
  const fam = useFamily()
  // 没装：看法没得选，只写文件夹（照定稿）
  if (!fam?.installed.pararead) return <span className="prw-tag truncate">{p.folder.split('/').pop()}</span>
  return (
    <button className="prw-tag truncate" data-testid="pararead-view" data-tip={t('点一下改这个文件夹在ParaRead里默认用哪种看法')} onClick={() => p.onView(other(p.view))}>
      {`${p.folder.split('/').pop()} · ${p.view === 'bilingual' ? t('对照', { ctx: 'ParaRead看法' }) : t('原文', { ctx: 'ParaRead看法' })}`}
    </button>
  )
}
