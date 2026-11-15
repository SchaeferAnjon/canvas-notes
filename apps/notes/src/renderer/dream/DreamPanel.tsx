import { Icon } from '@cn/design'
import type { LucideIcon } from 'lucide-react'
import { Check, Copy, FileText, Inbox, Link2, Moon, PenLine, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import type { DreamDiffFile, DreamGroup, DreamItem, DreamReport } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import './dream.css'
import { dreamWhen, errText, GROUPS, pendingOf } from './useDream'

const ICONS: Record<DreamGroup, LucideIcon> = { inbox: Inbox, link: Link2, dup: Copy, week: PenLine }

/** 右栏「梦游报告」：按组列出，点开一条看为什么、改了什么；收下 = cherry-pick 到当前分支，丢掉 = 跳过 */
export function DreamPanel(props: {
  report: DreamReport | null
  running: boolean
  onReport(r: DreamReport): void
  onClose(): void
  onOpen(path: string): void
  onNotice(text: string): void
}) {
  const { report, running } = props
  const [cur, setCur] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const items = report?.items ?? []
  const left = pendingOf(report)

  // 打开时选中第一条没处理的
  useEffect(() => {
    if (!report) return
    if (!cur || !report.items.some((i) => i.id === cur)) setCur(report.items.find((i) => i.state === 'pending')?.id ?? report.items[0]?.id ?? null)
  }, [report, cur])

  async function act(f: () => Promise<DreamReport>, after?: (r: DreamReport) => void) {
    setBusy(true)
    try {
      const r = await f()
      props.onReport(r)
      after?.(r)
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const next = (r: DreamReport) => setCur(r.items.find((i) => i.state === 'pending')?.id ?? cur)

  async function dreamNow() {
    await act(() => window.cn.dreamNow())
  }

  let group: DreamGroup | null = null
  return (
    <aside className="right dream-panel" aria-label="梦游报告">
      <div className="rhead">
        <Icon of={Moon} size={16} />
        <b>梦游报告</b>
        {report && <span className="meta num">{dreamWhen(report)}</span>}
        <span className="sp" />
        <button className="iconbtn" aria-label="关上梦游报告" onClick={props.onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="dlist">
        {running && <div className="dsum">正在梦游：整理收件箱、补双链、找重复、写本周小结。改动放在单独的分支上，跑完这里出新报告。</div>}
        {!running && !report && (
          <div className="dsum dempty">
            <p>还没梦游过。Mac 闲着超过 15 分钟时会自己整理一遍：收件箱分类、补上双链、找出可能重复的、写本周小结。</p>
            <p>改动都放在单独的分支上，你点「收下」才进 main，你写的正文一个字不动。</p>
            <button className="btn" disabled={busy} onClick={() => void dreamNow()}>
              <Icon of={Moon} size={14} />
              现在梦游
            </button>
          </div>
        )}
        {!running && report && (
          <div className="dsum" data-testid="dream-summary">
            {items.length ? (
              <>
                {dreamWhen(report)} 整理了 <b>{items.length} 处</b>。都在 {report.branch} 分支上，收下才合进 {report.base}，<b>你写的正文一个字没动</b>。
              </>
            ) : (
              <>{dreamWhen(report)} 梦游了一次，没什么要整理的。</>
            )}
            {report.notes.map((n) => (
              <span key={n} className="dnote">
                {n}
              </span>
            ))}
            {report.closed && left === 0 && (
              <button className="btn btn-sm" disabled={busy} onClick={() => void dreamNow()}>
                <Icon of={Moon} size={14} />
                再梦游一次
              </button>
            )}
          </div>
        )}
        {!running &&
          items.map((it, i) => {
            const head =
              it.group !== group ? (
                <div className="dg">
                  {GROUPS[it.group]}
                  <span>{items.filter((x) => x.group === it.group).length} 条</span>
                </div>
              ) : null
            group = it.group
            return (
              <Fragment key={it.id}>
                {head}
                <button className={'di' + (it.id === cur ? ' on' : '') + (it.state !== 'pending' ? ' ' + (it.state === 'taken' ? 'done' : 'drop') : '')} onClick={() => setCur(it.id)} data-testid="dream-item">
                  <span className="ico">
                    <Icon of={ICONS[it.group]} size={14} />
                  </span>
                  <span className="tx">
                    <b>{it.title}</b>
                    <span>{it.sub}</span>
                  </span>
                  <span className="st">{it.state === 'taken' ? (it.commit ? '已收下' : '看过了') : it.state === 'dropped' ? '已丢掉' : ''}</span>
                </button>
                {it.id === cur && (
                  <Detail
                    item={it}
                    base={report!.base}
                    index={i}
                    total={items.length}
                    busy={busy}
                    onOpen={props.onOpen}
                    onTake={() => void act(() => window.cn.dreamTake(it.id), next)}
                    onDrop={() => void act(() => window.cn.dreamDrop(it.id), next)}
                  />
                )}
              </Fragment>
            )
          })}
      </div>
      {report && items.length > 0 && !running && (
        <div className="dfoot">
          <span className="s" data-testid="dream-left">
            {left ? `还剩 ${left} 条 · ${report.closed ? '只是提醒，不改文件' : `改动在 ${report.branch} 分支`}` : `都看完了，收下的已合进 ${report.base}`}
          </span>
          <button
            className="btn"
            disabled={busy || !left}
            onClick={() =>
              void act(
                () => window.cn.dreamTakeAll(),
                (r) => props.onNotice(`剩下的都收下了，${r.branch} 已合进 ${r.base}`),
              )
            }
          >
            <Icon of={Check} size={14} />
            全部收下
          </button>
        </div>
      )}
    </aside>
  )
}

function Detail(props: { item: DreamItem; base: string; index: number; total: number; busy: boolean; onOpen(path: string): void; onTake(): void; onDrop(): void }) {
  const { item } = props
  const [diff, setDiff] = useState<DreamDiffFile[] | null>(null)
  useEffect(() => {
    setDiff(null)
    if (!item.commit) return
    let stale = false
    void window.cn.dreamDiff(item.id).then(
      (d) => !stale && setDiff(d),
      () => !stale && setDiff([]),
    )
    return () => {
      stale = true
    }
  }, [item.id, item.commit])

  return (
    <div className="dd" data-testid="dream-detail">
      <div className="pv-k">
        {GROUPS[item.group]} · 第 {props.index + 1} 条，共 {props.total} 条
      </div>
      <div className="pv-why">{item.why}</div>
      {item.group === 'dup' && (
        <div className="dpair">
          {item.files.map((f) => (
            <button key={f} className="btn btn-sm" onClick={() => props.onOpen(f)}>
              <Icon of={FileText} size={14} />
              <span className="truncate">{titleOf(f)}</span>
            </button>
          ))}
        </div>
      )}
      {diff?.map((f) => (
        <div key={f.path} className="dfile">
          <div className="dfn">
            <span className="truncate">{f.from ? `${f.from} → ${f.path}` : f.path}</span>
            <span className="k">{f.status === 'new' ? '新' : f.status === 'moved' ? '移动' : f.status === 'deleted' ? '删' : '改'}</span>
          </div>
          <div className="dl">
            {f.lines.map((l, i) => (
              <div key={i} className={l.k}>
                {l.t || ' '}
              </div>
            ))}
          </div>
        </div>
      ))}
      {item.state === 'pending' ? (
        <div className="pv-acts">
          <button className="btn btn-primary" disabled={props.busy} onClick={props.onTake}>
            <Icon of={Check} size={14} />
            {item.commit ? '收下' : '知道了'}
          </button>
          {item.commit && (
            <button className="btn" disabled={props.busy} onClick={props.onDrop}>
              <Icon of={X} size={14} />
              丢掉
            </button>
          )}
          <span className="hint">{item.commit ? `收下 = 一次提交进 ${props.base}，可在历史里撤回` : '只是提醒，不改任何文件'}</span>
        </div>
      ) : (
        <div className={'pv-state' + (item.state === 'dropped' ? ' drop' : '')}>
          {item.state === 'taken' ? (item.taken ? `已收下，合进 ${props.base} · ${item.taken.slice(0, 7)}` : item.commit ? '已收下' : '看过了，没改任何文件') : `已丢掉，这条改动不会进 ${props.base}`}
        </div>
      )}
    </div>
  )
}
