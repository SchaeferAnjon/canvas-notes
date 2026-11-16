import { Codicon, type CodiconName } from '@cn/design'
import { Fragment, useEffect, useState } from 'react'
import type { DreamDiffFile, DreamGroup, DreamItem, DreamReport } from '../../shared/api'
import { BULK, fileGroups, GROUP_SHOW, searchGroup } from '../../shared/dream-preview'
import { titleOf } from '../../shared/layout'
import './dream.css'
import type { DreamPreview } from './preview'
import { dreamWhen, errText, GROUPS, pendingOf } from './useDream'

const ICONS: Record<DreamGroup, CodiconName> = { file: 'inbox', viz: 'preview', link: 'link', dup: 'copy', week: 'edit' }

/** 右栏「梦游报告」：按组列出，点开一条看为什么、改了什么；收下 = cherry-pick 到当前分支，丢掉 = 跳过 */
export function DreamPanel(props: {
  report: DreamReport | null
  running: boolean
  onReport(r: DreamReport): void
  onClose(): void
  onOpen(path: string): void
  /** 梦游做的可视化：在中间栏预览梦游分支上的那份 */
  onPreviewHtml(path: string): void
  onNotice(text: string): void
  /** 归类和改名的预览、收下一组、跟 AI 说 */
  pv: DreamPreview
}) {
  const { report, running, pv } = props
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
    <aside className="side dream-panel" aria-label="梦游报告">
      <div className="rhead">
        <Codicon name="wand" size={16} />
        <b>梦游报告</b>
        {report && <span className="meta num">{dreamWhen(report)}</span>}
        <span className="sp" />
        <button className="iconbtn" aria-label="关上梦游报告" onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      <div className="dlist">
        {running && <div className="dsum">正在梦游：整理收件箱、补双链、找重复、写本周小结。改动放在单独的分支上，跑完这里出新报告。</div>}
        {!running && !report && (
          <div className="dsum dempty">
            <p>还没梦游过。Mac 闲着超过 15 分钟时会自己整理一遍：收件箱分类、补上双链、找出可能重复的、写本周小结。</p>
            <p>改动都放在单独的分支上，你点「收下」才进 main，你写的正文一个字不动。</p>
            <button className="btn" disabled={busy} onClick={() => void dreamNow()}>
              <Codicon name="wand" size={14} />
              现在梦游
            </button>
          </div>
        )}
        {!running && report && (
          <div className="dsum" data-testid="dream-summary">
            {items.length ? (
              <>
                {dreamWhen(report)} 整理了 <b>{items.length} 处</b>。都在 {report.branch} 分支上
                {items.some((i) => i.group === 'file') ? '，点「预览」看改好后的样子' : ''}，收下才合进 {report.base}，<b>你写的正文一个字没动</b>。
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
                <Codicon name="wand" size={14} />
                再梦游一次
              </button>
            )}
          </div>
        )}
        {!running && items.some((i) => i.group === 'file') && (
          <FileSection
            items={items.filter((i) => i.group === 'file')}
            stay={report?.stay ?? 0}
            cur={cur}
            onCur={setCur}
            pv={pv}
            renderDetail={(it) => (
              <Detail
                item={it}
                base={report!.base}
                index={fileGroups(items).flatMap((g) => g.items).indexOf(it)}
                total={items.filter((x) => x.group === 'file').length}
                busy={busy || pv.busy}
                onOpen={props.onOpen}
                onTake={() => void pv.take([it.id])}
                onDrop={() => void pv.drop([it.id])}
                onAsk={() => pv.ask([it.id], `「${it.title}」`)}
              />
            )}
          />
        )}
        {!running &&
          items.map((it, i) => {
            if (it.group === 'file') return null
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
                    <Codicon name={ICONS[it.group]} size={14} />
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
                    onPreviewHtml={props.onPreviewHtml}
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
            <Codicon name="check" size={14} />
            全部收下
          </button>
        </div>
      )}
    </aside>
  )
}

function Detail(props: { item: DreamItem; base: string; index: number; total: number; busy: boolean; onOpen(path: string): void; onPreviewHtml?(path: string): void; onTake(): void; onDrop(): void; onAsk?(): void }) {
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
      {item.move && (
        <div className="pv-move">
          <span>
            <i>挪到</i>
            {item.move.to.split('/').slice(0, -1).join('/')}/
          </span>
          {titleOf(item.move.from) !== titleOf(item.move.to) && (
            <span>
              <i>改名</i>
              <s>{titleOf(item.move.from)}</s> → {titleOf(item.move.to)}
            </span>
          )}
        </div>
      )}
      {item.group === 'viz' && item.state === 'pending' && props.onPreviewHtml && (
        <div className="dpair">
          <button className="btn btn-sm" onClick={() => props.onPreviewHtml!(item.files[0]!)}>
            <Codicon name="eye" size={14} />
            预览可视化
          </button>
        </div>
      )}
      {item.group === 'dup' && (
        <div className="dpair">
          {item.files.map((f) => (
            <button key={f} className="btn btn-sm" onClick={() => props.onOpen(f)}>
              <Codicon name="file-text" size={14} />
              <span className="truncate">{titleOf(f)}</span>
            </button>
          ))}
        </div>
      )}
      {!item.move && diff?.map((f) => (
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
          {/* 一屏一个主按钮：预览条上的「收下这 N 处」才是主按钮，报告里的都是次按钮 */}
          <button className="btn btn-sm" disabled={props.busy} onClick={props.onTake}>
            <Codicon name="check" size={14} />
            {item.commit ? '收下' : '知道了'}
          </button>
          {item.commit && (
            <button className="btn btn-sm" disabled={props.busy} onClick={props.onDrop}>
              <Codicon name="close" size={14} />
              丢掉
            </button>
          )}
          {props.onAsk && (
            <button className="btn btn-ghost btn-sm" disabled={props.busy} onClick={props.onAsk}>
              <Codicon name="sparkle" size={12} />
              跟 AI 说
            </button>
          )}
          {!props.onAsk && <span className="hint">{item.commit ? `收下 = 一次提交进 ${props.base}，可在历史里撤回` : '只是提醒，不改任何文件'}</span>}
        </div>
      ) : (
        <div className={'pv-state' + (item.state === 'dropped' ? ' drop' : '')}>
          {item.state === 'taken' ? (item.taken ? `已收下，合进 ${props.base} · ${item.taken.slice(0, 7)}` : item.commit ? '已收下' : '看过了，没改任何文件') : `已丢掉，这条改动不会进 ${props.base}`}
        </div>
      )}
    </div>
  )
}

/** 归类和改名：按去处分小组；多了（导入几百条）就只列组、默认收起，组里只露最近几条加搜索 */
function FileSection(props: { items: DreamItem[]; stay: number; cur: string | null; onCur(id: string): void; pv: DreamPreview; renderDetail(it: DreamItem): React.ReactNode }) {
  const { items, pv } = props
  const groups = fileGroups(items)
  const bulk = items.length > BULK
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const status = (it: DreamItem) =>
    pv.redoing?.ids.includes(it.id) && it.state === 'pending' ? (
      <span className="st">重做中…</span>
    ) : it.state === 'taken' ? (
      <span className="st ok">已收下</span>
    ) : it.state === 'dropped' ? (
      <span className="st">{it.move && it.move.to === it.move.from ? '留在收件箱' : '已丢掉'}</span>
    ) : it.redo ? (
      <span className="tag-acc">按你说的改了</span>
    ) : null
  const row = (it: DreamItem) => (
    <Fragment key={it.id}>
      <button className={'di' + (it.id === props.cur ? ' on' : '') + (it.state !== 'pending' ? ' ' + (it.state === 'taken' ? 'done' : 'drop') : '')} onClick={() => props.onCur(it.id)} data-testid="dream-item">
        <span className="ico">
          <Codicon name={it.title.endsWith('导图') ? 'type-hierarchy' : 'file-text'} size={14} />
        </span>
        <span className="tx">
          <b>{it.title}</b>
          <span>{it.sub}</span>
        </span>
        {status(it)}
      </button>
      {it.id === props.cur && props.renderDetail(it)}
    </Fragment>
  )
  const pending = items.filter((i) => i.state === 'pending')
  return (
    <section className="dfile-sec" aria-label="归类和改名">
      <div className="dg">
        归类和改名
        <span className="num">
          {items.length} 条{bulk ? ` · ${groups.length} 组` : ''}
        </span>
        <button className="btn btn-xs dg-pv" disabled={!pending.length && !pv.on} onClick={() => pv.setOn(!pv.on)}>
          <Codicon name={pv.on ? 'close' : 'eye'} size={12} />
          {pv.on ? '退出预览' : '预览'}
        </button>
      </div>
      {groups.map((g) =>
        bulk ? (
          <div key={g.folder} className={'dbulk' + (open === g.folder ? ' open' : '')} data-testid="dream-bulk">
            <div className="dbulk-h" role="button" tabIndex={0} aria-expanded={open === g.folder} onClick={() => (setOpen(open === g.folder ? null : g.folder), setQ(''))}>
              <span className="ico">
                <Codicon name={g.folder === '收件箱' ? 'inbox' : 'folder'} size={14} />
              </span>
              <span className="tx">
                <b>{g.folder}</b>
                <span className="num">
                  {g.items.length} 条挪进来 · 改了 {g.renamed} 个名字{g.pending.length < g.items.length ? ` · 还剩 ${g.pending.length} 条` : ''}
                </span>
              </span>
              {g.pending.length > 0 && (
                <button className="btn btn-xs" disabled={pv.busy} onClick={(e) => (e.stopPropagation(), void pv.take(g.pending.map((i) => i.id)))}>
                  <Codicon name="check" size={12} />
                  收下这组
                </button>
              )}
            </div>
            {open === g.folder && (
              <div className="dbulk-b">
                <label className="dsearch">
                  <Codicon name="search" size={12} />
                  <input aria-label="在这组里找" placeholder={`在这 ${g.items.length} 条里找名字或原名`} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                {!q && <div className="dbulk-k">先看其中 {Math.min(GROUP_SHOW, g.items.length)} 条</div>}
                {(q ? searchGroup(g.items, q).slice(0, 20) : g.items.slice(0, GROUP_SHOW)).map((it) => (
                  <div key={it.id} className={'dbulk-r' + (it.state !== 'pending' ? ' done' : '')}>
                    <Codicon name="file-text" size={14} />
                    <span className="truncate">{it.title}</span>
                    <span className="o truncate">原名 {titleOf(it.move!.from)}</span>
                  </div>
                ))}
                {!q && g.items.length > GROUP_SHOW && (
                  <p className="dbulk-more">
                    还有 {g.items.length - GROUP_SHOW} 条 · 用上面的搜索找，或预览时在左栏里看
                  </p>
                )}
                <div className="dbulk-act">
                  <button className="btn btn-ghost btn-xs" disabled={!g.pending.length} onClick={() => pv.ask(g.pending.map((i) => i.id), `这组（${g.folder}）`)}>
                    <Codicon name="sparkle" size={12} />
                    跟 AI 说这组哪里不对
                  </button>
                  <button className="btn btn-ghost btn-xs" disabled={!g.pending.length || pv.busy} onClick={() => void pv.drop(g.pending.map((i) => i.id))}>
                    <Codicon name="close" size={12} />
                    丢掉这组
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Fragment key={g.folder}>
            <div className="dsub">
              <Codicon name={g.folder === '收件箱' ? 'inbox' : 'folder'} size={12} />
              <span className="truncate">{g.folder}</span>
              <span className="num">{g.items.length} 条</span>
              {g.pending.length > 1 && (
                <button className="btn btn-ghost btn-xs" disabled={pv.busy} onClick={() => void pv.take(g.pending.map((i) => i.id))}>
                  收下这组
                </button>
              )}
            </div>
            {g.items.map(row)}
          </Fragment>
        ),
      )}
      {props.stay > 0 && (
        <div className="dstay">
          <span className="ico">
            <Codicon name="inbox" size={14} />
          </span>
          <span className="tx">
            <b>收件箱 · 拿不准的</b>
            <span className="num">{props.stay} 条留着不动，等你自己定</span>
          </span>
        </div>
      )}
    </section>
  )
}
