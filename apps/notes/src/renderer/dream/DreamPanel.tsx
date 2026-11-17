import { Codicon, type CodiconName } from '@cn/design'
import { engineOfLabel } from '../../shared/ai-features'
import { EngineLogo } from '../engine-logo'
import { Fragment, useEffect, useState } from 'react'
import type { DreamGroup, DreamItem, DreamReport } from '../../shared/api'
import { baseName, type DiffEntry, type DiffSource } from '../../shared/diff'
import { fileIcon } from '../Palette'
import { BULK, fileGroups, GROUP_SHOW, searchGroup } from '../../shared/dream-preview'
import { titleOf } from '../../shared/layout'
import './dream.css'
import type { DreamPreview } from './preview'
import { expectDreamChange } from './own-change'
import { NoteDoc } from '../note-doc'
import { dreamWhen, errText, GROUPS, pendingOf, takenSay } from './useDream'

const ICONS: Record<DreamGroup, CodiconName> = { attach: 'file-media', file: 'inbox', viz: 'preview', link: 'link', dup: 'copy', week: 'edit' }

/** 右栏「梦游报告」：按组列出，点开一条看为什么、改了什么；收下 = cherry-pick 到当前分支，丢掉 = 跳过 */
export function DreamPanel(props: {
  report: DreamReport | null
  running: boolean
  onReport(r: DreamReport): void
  onClose(): void
  onOpen(path: string): void
  /** 梦游做的可视化：在中间栏预览梦游分支上的那份 */
  onPreviewHtml(path: string): void
  /** 点一处改动：中间栏开对比标签（左列 main 上的、右列梦游改后的） */
  onOpenDiff(src: DiffSource, title: string): void
  /** 挪老图那一条的「预览」：中间栏开「梦游预览 · 挪老图」 */
  onPreviewImages(itemId: string): void
  onNotice(text: string): void
  /** 收下 / 丢掉一条：和预览标签里的「收下这一条」走同一条路（提示条写收下了什么，带撤回）；做完给新报告 */
  onTake(item: DreamItem): Promise<DreamReport | null>
  onDrop(item: DreamItem): Promise<DreamReport | null>
  /** 上面两件在做（按钮先不能点） */
  acting: boolean
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
            <p>还没梦游过。Mac闲着超过15分钟时会自己整理一遍：收件箱分类、补上双链、找出可能重复的、写本周小结。</p>
            <p>改动都放在单独的分支上，你点「收下」才进main，你写的正文一个字不动。</p>
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
                {`${dreamWhen(report)}整理了`}<b>{`${items.length}处`}</b>{`。都在${report.branch}分支上${items.some((i) => i.group === 'file') ? '，点「预览」看改好后的样子' : ''}，收下才合进${report.base}，`}<b>你写的正文一个字没动</b>。
              </>
            ) : (
              <>{`${dreamWhen(report)}梦游了一次，没什么要整理的。`}</>
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
                onOpenDiff={props.onOpenDiff}
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
                  <span>{`${items.filter((x) => x.group === it.group).length}条`}</span>
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
                    <Stuck item={it} />
                  </span>
                  <span className="st">{it.state === 'taken' ? (it.commit ? '已收下' : '看过了') : it.state === 'dropped' ? '已丢掉' : ''}</span>
                </button>
                {it.id === cur && (
                  <Detail
                    item={it}
                    base={report!.base}
                    index={i}
                    total={items.length}
                    busy={busy || props.acting}
                    onOpen={props.onOpen}
                    onOpenDiff={props.onOpenDiff}
                    onPreviewHtml={props.onPreviewHtml}
                    onPreviewImages={props.onPreviewImages}
                    onTake={() => void props.onTake(it).then((r) => r && next(r))}
                    onDrop={() => void props.onDrop(it).then((r) => r && next(r))}
                  />
                )}
              </Fragment>
            )
          })}
      </div>
      {report && items.length > 0 && !running && (
        <div className="dfoot">
          <span className="s" data-testid="dream-left">
            {left ? `还剩${left}条 · ${report.closed ? '只是提醒，不改文件' : `改动在${report.branch}分支`}` : `都看完了，收下的已合进${report.base}`}
          </span>
          <button
            className="btn"
            disabled={busy || props.acting || !left}
            onClick={() => {
              const ids = items.filter((i) => i.state === 'pending').map((i) => i.id)
              void act(
                // 编辑器里刚打、还没自动保存的字先存盘，和梦游的改动一起合（不然收下后那次保存把梦游改的当成「外面改了」）
                async () => (expectDreamChange(items.filter((i) => i.state === 'pending')), await NoteDoc.saveAll(), window.cn.dreamTakeAll()),
                (r) => props.onNotice(takenSay(ids, r) ?? `剩下的都收下了，${r.branch}已合进${r.base}`),
              )
            }}
          >
            <Codicon name="check" size={14} />
            全部收下
          </button>
        </div>
      )}
    </aside>
  )
}

/** 上次收下时合不上、留着没收的那条：红点 + 为什么（「没收下：你后来删了这篇」） */
function Stuck(props: { item: DreamItem }) {
  const { item } = props
  if (item.state !== 'pending' || !item.conflict) return null
  return (
    <span className="dconf" data-testid="dream-conflict">
      <i className="gdot err" />
      {`没收下：${item.conflict}`}
    </span>
  )
}

function Detail(props: {
  item: DreamItem
  base: string
  index: number
  total: number
  busy: boolean
  onOpen(path: string): void
  onOpenDiff(src: DiffSource, title: string): void
  onPreviewHtml?(path: string): void
  onPreviewImages?(itemId: string): void
  onTake(): void
  onDrop(): void
  onAsk?(): void
}) {
  const { item } = props
  // 每处改动一行人话（梦游动手时记下的；旧报告没记的按 diff 拼），点了中间开对比；侧栏不再铺源码（CN-63 / 55）
  const [rows, setRows] = useState<DiffEntry[] | null>(null)
  useEffect(() => {
    setRows(null)
    if (!item.commit || item.move || item.oldImages) return
    let stale = false
    void window.cn.diffFiles({ kind: 'dream', id: item.id }).then(
      (d) => !stale && setRows(d.files),
      () => !stale && setRows([]),
    )
    return () => {
      stale = true
    }
  }, [item.id, item.commit, item.move])
  const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')

  return (
    <div className="dd" data-testid="dream-detail">
      <div className="pv-k">
        {`${GROUPS[item.group]} · 第${props.index + 1}条，共${props.total}条`}
      </div>
      <div className="pv-why">{item.why}</div>
      {item.by && (
        <div className="pv-by" data-testid="dream-by">
          {engineOfLabel(item.by) && <EngineLogo id={engineOfLabel(item.by)!} size={12} />}
          {`${item.by}做的`}
        </div>
      )}
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
      {item.oldImages && <OldImagesSummary info={item.oldImages} />}
      {item.group === 'dup' && (
        <button className="dchg" data-testid="dream-change" onClick={() => props.onOpenDiff({ kind: 'pair', a: item.files[0]!, b: item.files[1]! }, `${titleOf(item.files[0]!)} ↔ ${titleOf(item.files[1]!)}`)}>
          <Codicon name="git-compare" size={14} />
          <span className="tx">两篇并排看哪里一样</span>
        </button>
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
      {rows?.map((f) => (
        <button
          key={f.path}
          className="dchg"
          data-testid="dream-change"
          onClick={() => props.onOpenDiff({ kind: 'dream', id: item.id, focus: f.path }, `${baseName(f.path).replace(/\.md$/i, '')} · 梦游改的`)}
        >
          <Codicon name={fileIcon(f.path)} size={14} />
          <span className="tx">
            <span>{f.kind === 'md' && f.status !== 'new' ? `${titleOf(f.path)}：${f.summary}` : f.summary}</span>
            {(f.status === 'new' || f.status === 'moved') && <span className="p">{dir(f.path) || '库的最外层'}</span>}
          </span>
        </button>
      ))}
      {item.state === 'pending' ? (
        <div className="pv-acts">
          {/* 一屏一个主按钮：预览条上的「收下这 N 处」才是主按钮，报告里的都是次按钮 */}
          {item.oldImages && props.onPreviewImages && (
            <button className="btn btn-sm" onClick={() => props.onPreviewImages!(item.id)}>
              <Codicon name="eye" size={14} />
              预览
            </button>
          )}
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
              跟AI说
            </button>
          )}
          {!props.onAsk && <span className="hint">{item.commit ? `收下 = 一次提交进${props.base}，可在历史里撤回` : '只是提醒，不改任何文件'}</span>}
        </div>
      ) : (
        <div className={'pv-state' + (item.state === 'dropped' ? ' drop' : '') + (item.state === 'taken' && item.taken ? ' has-commit' : '')}>
          {item.state === 'taken' ? (
            item.taken ? (
              // 一行：宽时「已收下，合进main · 提交号」；窄时短写成「已收下 · 提交号」，「合进main」放进悬停提示，提交号整个露着（第 4 轮美学）
              <>
                <span className="long truncate">{`已收下，合进${props.base} ·`}</span>
                <span className="short" data-tip={`已收下，合进${props.base}`}>
                  已收下 ·
                </span>
                <code className="num">{item.taken.slice(0, 7)}</code>
              </>
            ) : item.commit ? (
              '已收下'
            ) : (
              '看过了，没改任何文件'
            )
          ) : (
            `已丢掉，这条改动不会进${props.base}`
          )}
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
          <Stuck item={it} />
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
          {`${items.length}条${bulk ? ` · ${groups.length}组` : ''}`}
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
                  {`${g.items.length}条挪进来 · 改了${g.renamed}个名字${g.pending.length < g.items.length ? ` · 还剩${g.pending.length}条` : ''}`}
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
                  <input aria-label="在这组里找" placeholder={`在这${g.items.length}条里找名字或原名`} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                {!q && <div className="dbulk-k">{`先看其中${Math.min(GROUP_SHOW, g.items.length)}条`}</div>}
                {(q ? searchGroup(g.items, q).slice(0, 20) : g.items.slice(0, GROUP_SHOW)).map((it) => (
                  <div key={it.id} className={'dbulk-r' + (it.state !== 'pending' ? ' done' : '')}>
                    <Codicon name="file-text" size={14} />
                    <span className="truncate">{it.title}</span>
                    <span className="o truncate">原名 {titleOf(it.move!.from)}</span>
                  </div>
                ))}
                {!q && g.items.length > GROUP_SHOW && (
                  <p className="dbulk-more">
                    {`还有${g.items.length - GROUP_SHOW}条 · 用上面的搜索找，或预览时在左栏里看`}
                  </p>
                )}
                <div className="dbulk-act">
                  <button className="btn btn-ghost btn-xs" disabled={!g.pending.length} onClick={() => pv.ask(g.pending.map((i) => i.id), `这组（${g.folder}）`)}>
                    <Codicon name="sparkle" size={12} />
                    跟AI说这组哪里不对
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
              <span className="num">{`${g.items.length}条`}</span>
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
            <span className="num">{`${props.stay}条留着不动，等你自己定`}</span>
          </span>
        </div>
      )}
    </section>
  )
}

/** 挪老图那一条：两行例子（从哪挪到哪）、还有几张、改几篇几处链接；不挪的一句 */
function OldImagesSummary({ info }: { info: NonNullable<DreamItem['oldImages']> }) {
  const links = info.examples.reduce((n, e) => n + e.count, 0)
  const shared = info.kept.filter((k) => k.why === 'shared').length
  const unused = info.kept.filter((k) => k.why === 'unused').length
  const other = info.kept.length - shared - unused
  const why = [shared && `${shared}张几篇都在用`, unused && `${unused}张没有哪篇在用`, other && `${other}张这次先不挪（预览里写了原因）`].filter(Boolean).join('，')
  return (
    <>
      <div className="dimg" data-testid="old-images-summary">
        {info.moves.slice(0, 2).map((m) => (
          <Fragment key={m.from}>
            <span>{m.from}</span>
            <span className="to">→ {m.to.slice(0, m.to.lastIndexOf('/') + 1)}</span>
          </Fragment>
        ))}
        <span className="more">
          {`${info.moves.length > 2 ? `还有${info.moves.length - 2}张 · ` : ''}共改${info.examples.length}篇${links}处链接`}
        </span>
      </div>
      {info.kept.length > 0 && (
        <p className="dkeep">
          {`${info.kept.length}张不挪：${why}。`}
        </p>
      )}
    </>
  )
}

