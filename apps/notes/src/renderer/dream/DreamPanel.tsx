import { Codicon, type CodiconName } from '@cn/design'
import { isAppFile } from '@cn/format'
import { AiIcon } from '../engine-logo'
import { ChangeBar, UndoButton } from '@cn/ai-chat/answer-bar'
import { t } from '../../shared/i18n'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { DreamGroup, DreamItem, DreamReport } from '../../shared/api'
import { baseName, type DiffEntry } from '../../shared/diff'
import { BULK, fileGroups, GROUP_SHOW, searchGroup } from '../../shared/dream-preview'
import { displayOrder, indexOf, progressOf } from '../../shared/dream-order'
import { titleOf } from '../../shared/layout'
import { isKey } from '../keys'
import './dream.css'
import type { DreamPreview } from './preview'
import { expectDreamChange } from './own-change'
import { NoteDoc } from '../note-doc'
import { actOn, openDream, setCur, stepDream, undoItem, useDreamNav } from './nav'
import { crumbOf, dreamIcon } from './DreamTab'
import { bodyEdits, dreamWhen, errText, GROUPS, pendingOf, takenSay } from './useDream'
import { actNames, Evidence, groupBy, JudgeLine, WikiLine } from './evidence'
import { EntryActs } from './entry-acts'
import { dreamDoes, type DreamSettings } from '../../shared/dream-settings'
import { GrowthSide } from '../growth/GrowthSide'
import { DreamReplay, onReplayRelease, replayHolds } from '../growth/DreamReplay'
import { loadGrowth, setGrowth, useGrowth } from '../growth/store'

const ICONS: Record<DreamGroup, CodiconName> = { attach: 'file-media', file: 'inbox', viz: 'graph', link: 'link', unsure: 'question', recheck: 'circle-slash', dup: 'copy', week: 'edit', alias: 'tag', entry: 'book' }

/**
 * 左栏「梦游报告」（task-m552v 照 demo proto.html 重做）：顶上进度（一条一格，看过灰、收下绿、丢掉淡，当前那格一圈）、摘要、按组列出；
 * 点一条中间开这一条的对照（像「历史」那样），它下面一张短小卡：第几条、改了几个文件、每个文件一行（点了中间换成那个文件）、收下 / 丢掉。
 * 收下 = 一次提交进 main（可撤回），丢掉 = 不进；做完 0.7 秒后往下走一条没处理的。焦点在这里时 J / K 换条、⌘↵ 收下、⌘⌫ 丢掉（命令表能改）
 */
export function DreamPanel(props: {
  report: DreamReport | null
  running: boolean
  onReport(r: DreamReport): void
  onClose(): void
  /** 报告里「确认这个库怎么分」：翻到设置 › 梦游那一节 */
  onOpenRoles(): void
  /** 挪老图那一条：中间栏开「梦游预览 · 挪老图」 */
  onPreviewImages(itemId: string): void
  onNotice(text: string): void
  /** 收下 / 丢掉在做（按钮先不能点） */
  acting: boolean
  /** 归类和改名的「在树里看」、收下一组、跟 AI 说 */
  pv: DreamPreview
  /** 设置 › 梦游：说它会做什么、什么时候自己梦游 */
  settings: DreamSettings
  /** 生长图（task-h7oy8）：中间开「生长」标签、在中间打开一篇 */
  onOpenGrowth(): void
  onOpenNote(path: string): void
}) {
  const { report, running, pv } = props
  const nav = useDreamNav()
  const cur = nav.cur
  const [busy, setBusy] = useState(false)
  const items = report?.items ?? []
  const left = pendingOf(report)
  /** 左栏看报告还是看生长（task-h7oy8 定 3：梦游报告顶上一个「生长」看法） */
  const side = useGrowth().side
  // 收下、丢掉、新梦游了一晚：生长图跟着重算（那晚的小图、每一晚的列表）
  useEffect(() => {
    if (report) loadGrowth()
  }, [report])

  // 现在看的那条滚进左栏（J / K 换条、收下后往下走一条时）
  // 报告第一次打开、顶上的前后对比小图在自己播时先不滚（小图会被滚出去），播完再滚
  useEffect(() => {
    if (cur && !replayHolds()) requestAnimationFrame(() => document.querySelector('.dream-panel .di.on')?.scrollIntoView({ block: 'nearest' }))
  }, [cur])
  useEffect(() => {
    const off = onReplayRelease(() => {
      document.querySelector('.dream-panel .di.on')?.scrollIntoView({ block: 'nearest' })
    })
    return off
  }, [])
  // 打开时亮着第一条没处理的
  useEffect(() => {
    if (!report) return
    if (!cur || !report.items.some((i) => i.id === cur)) setCur(displayOrder(report.items).find((i) => i.state === 'pending')?.id ?? report.items[0]?.id ?? null)
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

  async function dreamNow() {
    await act(() => window.cn.dreamNow())
  }

  /** 点一条：中间开它（挪老图那条开它自己的预览） */
  const open = (it: DreamItem) => (it.oldImages ? (setCur(it.id), props.onPreviewImages(it.id)) : openDream(it.id))

  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    const it = items.find((i) => i.id === cur)
    if (isKey(e, 'dream-next')) (e.preventDefault(), stepDream(1))
    else if (isKey(e, 'dream-prev')) (e.preventDefault(), stepDream(-1))
    else if (it && isKey(e, 'dream-take')) (e.preventDefault(), void actOn('take', it))
    else if (it && it.commit && isKey(e, 'dream-drop')) (e.preventDefault(), void actOn('drop', it))
  }

  let group: DreamGroup | null = null
  const does = dreamDoes(props.settings, 'zh')
  /** 这次真动了正文的几处（按真改动说，没动不提） */
  const edits = bodyEdits(items)
  /** 改完直接收下的那几条（报告顶上一键撤回） */
  const auto = report?.autoTaken ? items.filter((i) => i.taken === report.autoTaken) : []
  const order = displayOrder(items)
  const prog = progressOf(items, nav.seen)
  const detail = (it: DreamItem) => (
    <Detail item={it} index={indexOf(items, it.id)} total={items.length} base={report!.base} busy={busy || props.acting || pv.busy} file={nav.cur === it.id ? nav.file : null} onAsk={it.group === 'file' ? () => pv.ask([it.id], `「${it.title}」`) : undefined} />
  )
  return (
    <aside className="side dream-panel" aria-label="梦游报告" tabIndex={-1} onKeyDown={onKey}>
      <div className="rhead">
        <Codicon name="wand" size={16} />
        <b>梦游报告</b>
        {report && <span className="meta num">{dreamWhen(report)}</span>}
        <span className="sp" />
        <button className="iconbtn" aria-label="关上梦游报告" onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      <div className="dseg" role="tablist" aria-label={t('梦游报告看哪一样')}>
        <button role="tab" aria-selected={side === 'report'} className={side === 'report' ? 'on' : ''} data-testid="dream-seg-report" onClick={() => setGrowth({ side: 'report' })}>
          {t('报告')}
        </button>
        <button
          role="tab"
          aria-selected={side === 'growth'}
          className={side === 'growth' ? 'on' : ''}
          data-testid="dream-seg-growth"
          onClick={() => {
            setGrowth({ side: 'growth' })
            props.onOpenGrowth()
          }}
        >
          <Codicon name="graph-scatter" size={12} />
          {t('生长')}
        </button>
      </div>
      {side === 'growth' ? (
        <GrowthSide onOpenGrowth={props.onOpenGrowth} onOpenNote={props.onOpenNote} onShowReport={() => setGrowth({ side: 'report' })} />
      ) : (
      <>
      <div className="dlist">
        {!running && report && <DreamReplay report={report} onOpen={props.onOpenGrowth} />}
        {!running && report && items.length > 0 && (
          <div className="dprog" data-testid="dream-progress">
            <div className="row num">
              <b>{`${prog.total}条`}</b>
              {` · 看过${prog.seen} · 收下${prog.taken} · 丢掉${prog.dropped}`}
            </div>
            <div className="bar">
              {order.map((i, k) => (
                <button
                  key={i.id}
                  className={(i.state === 'taken' ? 'taken' : i.state === 'dropped' ? 'dropped' : nav.seen.has(i.id) ? 'seen' : '') + (i.id === cur ? ' cur' : '')}
                  aria-label={`第${k + 1}条 · ${i.title}`}
                  data-tip={`第${k + 1}条 · ${i.title.length > 16 ? i.title.slice(0, 16) + '…' : i.title}`}
                  data-side="below"
                  onClick={() => open(i)}
                />
              ))}
            </div>
          </div>
        )}
        {running && <div className="dsum">{`正在梦游${does ? `：${does}` : ''}。改动放在单独的分支上，跑完这里出新报告。`}</div>}
        {!running && !report && (
          <div className="dsum dempty">
            <p>{props.settings.auto ? `还没梦游过。Mac闲着超过${props.settings.idleMinutes}分钟时会自己整理一遍${does ? `：${does}` : ''}。` : '还没梦游过。自己梦游关着（设置 › 梦游），点「现在梦游」才整理。'}</p>
            <p>改动都放在单独的分支上，你点「收下」才进main，你写的正文一个字不动。</p>
            <button className="btn" disabled={busy} onClick={() => void dreamNow()}>
              <AiIcon job="dream" size={14} />
              现在梦游
            </button>
          </div>
        )}
        {!running && report && (
          <div className="dsum" data-testid="dream-summary">
            {items.length ? (
              <>
                {`${dreamWhen(report)}在`}
                <b>{report.branch}</b>
                {'分支上整理了'}
                <b>{`${items.length}处`}</b>
                {`，收下才合进${report.base}。`}
                {edits ? (
                  <span data-testid="dream-edits">
                    动了正文的只有：<b>{edits}</b>。
                  </span>
                ) : null}
              </>
            ) : (
              <>{`${dreamWhen(report)}梦游了一次，没什么要整理的。`}</>
            )}
            {auto.length > 0 && (
              <span className="dauto" data-testid="dream-auto">
                {`设置里选了改完直接收下：${auto.length}处已合进${report.base}`}
                <button className="btn btn-sm" disabled={busy || pv.busy} onClick={() => void pv.undo({ ids: auto.map((i) => i.id), taken: report.autoTaken! })}>
                  <Codicon name="discard" size={14} />
                  撤回这次收下
                </button>
              </span>
            )}
            {report.roles?.guess && (
              <span className="droles" data-testid="dream-roles-hint">
                {`这次照猜的分法整理：${report.roles.guessed.length}个文件夹的角色还没确认。`}
                <button className="btn btn-sm" onClick={props.onOpenRoles}>
                  <Codicon name="settings" size={14} />
                  确认这个库怎么分
                </button>
              </span>
            )}
            {report.judge && <JudgeLine s={report.judge} />}
            {report.wiki && <WikiLine s={report.wiki} />}
            {report.notes.map((n) => (
              <span key={n} className="dnote">
                {n}
              </span>
            ))}
            {report.closed && left === 0 && (
              <button className="btn btn-sm" disabled={busy} onClick={() => void dreamNow()}>
                <AiIcon job="dream" size={14} />
                再梦游一次
              </button>
            )}
          </div>
        )}
        {!running && items.some((i) => i.group === 'file') && <FileSection items={items.filter((i) => i.group === 'file')} {...stayOf(report)} cur={cur} onOpen={open} pv={pv} renderDetail={detail} />}
        {!running &&
          items.map((it) => {
            if (it.group === 'file') return null
            const head =
              it.group !== group ? (
                <div className="dg">
                  {GROUPS[it.group]}
                  <span>{`${items.filter((x) => x.group === it.group).length}条`}</span>
                  {groupBy(items.filter((x) => x.group === it.group)) && (
                    <em className="dg-by" data-testid="dream-group-by" title={items.find((x) => x.group === it.group && x.by)?.by}>
                      {groupBy(items.filter((x) => x.group === it.group))}
                    </em>
                  )}
                </div>
              ) : null
            group = it.group
            return (
              <Fragment key={it.id}>
                {head}
                <button className={'di' + (it.id === cur ? ' on' : '') + (it.state !== 'pending' ? ' ' + (it.state === 'taken' ? 'done' : 'drop') : '')} onClick={() => open(it)} data-testid="dream-item">
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
                {it.id === cur && detail(it)}
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
      </>
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

/**
 * 点开的那一条下面的小卡（demo .dcard）：「组 · 第 i 条，共 N 条 · 改了 2 个文件」、每个文件一行（名字：一句人话 / 在哪），点了中间换成那个文件；
 * 收下 / 丢掉（归类的多一个「跟AI说」）；处理完换成一条状态（已收下 · 提交号 · 撤回）。为什么、谁做的在中间的条目头上
 */
function Detail(props: { item: DreamItem; index: number; total: number; base: string; busy: boolean; file: string | null; onAsk?(): void }) {
  const { item } = props
  const [rows, setRows] = useState<DiffEntry[] | null>(null)
  // 展开时、里面的文件行读到以后变高时：整块滚进左栏，收下 / 丢掉不被底边截掉；那一条自己也一直看得见（用户 2026-11-22：别让按钮被底边截掉）
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let raf = 0
    // 用户在左栏里点了、滚了：之后变高不再替他滚（不在他手底下挪东西）
    let held = false
    const list = el.closest('.dlist')
    const hold = () => {
      held = true
      cancelAnimationFrame(raf)
    }
    list?.addEventListener('pointerdown', hold, true)
    list?.addEventListener('wheel', hold, { capture: true, passive: true })
    const show = () => {
      if (held || replayHolds()) return
      el.scrollIntoView({ block: 'nearest' })
      el.previousElementSibling?.scrollIntoView({ block: 'nearest' })
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(show)
    })
    ro.observe(el)
    const off = onReplayRelease(() => requestAnimationFrame(show))
    return () => {
      off()
      ro.disconnect()
      cancelAnimationFrame(raf)
      list?.removeEventListener('pointerdown', hold, true)
      list?.removeEventListener('wheel', hold, true)
    }
  }, [])
  useEffect(() => {
    setRows(null)
    if (!item.commit || item.oldImages) return
    let stale = false
    void window.cn.diffFiles({ kind: 'dream', id: item.id }).then(
      (d) => !stale && setRows(d.files),
      () => !stale && setRows([]),
    )
    return () => {
      stale = true
    }
  }, [item.id, item.commit, item.state, item.taken])
  const dup = !item.commit
  const n = rows?.length ?? item.files.length
  const shown = props.file ?? rows?.[0]?.path ?? null
  return (
    <div className="dd" data-testid="dream-detail" ref={box}>
      {/* 一段一段不折开，放不下只在「 · 」处换行（梦游对照复审：「改了1」和「个文件」被折开） */}
      <div className="pv-k">
        {[GROUPS[item.group], `第${props.index + 1}条，共${props.total}条`, dup ? '只是提醒' : `改了${n}个文件`].map((x, i) => (
          <Fragment key={i}>
            {i ? ' · ' : ''}
            <span>{x}</span>
          </Fragment>
        ))}
      </div>
      {item.oldImages && <OldImagesSummary info={item.oldImages} />}
      {/* 为什么在中间的条目头上（DESIGN.v3 2.5、2.7a），小卡不再写一遍；Wiki 链接的原话也在中间 */}
      {!item.wiki && <Evidence item={item} />}
      {dup && !item.oldImages && !item.entry && (
        <button className="dchg" data-testid="dream-change" onClick={() => openDream(item.id)}>
          <Codicon name="diff-single" size={14} />
          <span className="tx">
            <span>两篇并排看哪里一样</span>
          </span>
        </button>
      )}
      {rows?.map((f) => (
        <button key={f.path} className={'dchg' + (shown === f.path ? ' on' : '')} data-testid="dream-change" onClick={() => openDream(item.id, f.path)}>
          <Codicon name={dreamIcon(f.path)} size={14} />
          <span className="tx">
            <span>{`${f.kind === 'md' ? titleOf(f.now ?? f.path) : baseName(f.path)}：${f.summary}`}</span>
            <i className="p">{crumbOf(f.now ?? f.path, rows, item)}</i>
          </span>
        </button>
      ))}
      {item.entry && <EntryWhere item={item} file={props.file ?? null} />}
      {item.state === 'pending' && item.entry ? (
        <EntryActs item={item} busy={props.busy} className="pv-cb" testId="dream-panel-entry" />
      ) : item.state === 'pending' ? (
        item.commit ? (
          // 收不收那一套（task-eavzx）：跟 AI 说（梦游那一家的标志，左栏窄只留图标）……… 不要 · 收下，顺序和中间一样；中间已有实心的，这颗描边
          <ChangeBar
            className="pv-cb"
            testId="dream-panel-bar"
            lead={props.onAsk ? [{ label: t('跟 AI 说'), tip: t('跟 AI 说哪里不对，它照你说的重做这一条'), icon: <AiIcon job="dream" size={14} />, disabled: props.busy, onClick: props.onAsk }] : []}
            reject={{ label: actNames(item).drop, disabled: props.busy, onClick: () => void actOn('drop', item) }}
            accept={{ label: actNames(item).take, disabled: props.busy, onClick: () => void actOn('take', item) }}
          />
        ) : (
          <div className="pv-acts">
            <button className="btn btn-sm" disabled={props.busy} onClick={() => void actOn('take', item)}>
              <Codicon name="check" size={14} />
              知道了
            </button>
          </div>
        )
      ) : (
        <div className={'pv-state' + (item.state === 'dropped' ? ' drop' : '') + (item.state === 'taken' && item.taken ? ' has-commit' : '')} data-testid="dream-state">
          {item.state === 'taken' ? (
            item.taken ? (
              <>
                <Codicon name="pass-filled" size={14} />
                <span>已收下 ·</span>
                <code className="num">{item.taken.slice(0, 7)}</code>
              </>
            ) : item.commit ? (
              '已收下'
            ) : (
              '看过了，没改任何文件'
            )
          ) : (
            <span className="truncate">{`已丢掉，这条不会进${props.base}`}</span>
          )}
          {(item.state === 'dropped' || !!item.taken) && (
            <UndoButton className="pv-undo" label={t('撤回')} disabled={props.busy} onClick={() => void undoItem(item)} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 词条页建议：哪几篇提到它，一篇一行（同上面文件行的样子：图标、名字最多两行、下一行在哪个文件夹）；
 * 点了中间右边换成这篇（左边一直是第一篇），中间开着的两篇亮着（梦游对照复审：以前连成一段，长文件名按字母断成几行）
 */
function EntryWhere(props: { item: DreamItem; file: string | null }) {
  const { entry, files } = { entry: props.item.entry!, files: props.item.files }
  const right = props.file && props.file !== files[0] && files.includes(props.file) ? props.file : files[1]
  return (
    <div className="dentry" data-testid="dream-entry-notes">
      <span className="k">{t('提到它的{n}篇', { n: entry.count })}</span>
      {files.slice(0, 5).map((p, i) => (
        <button key={p} className={'dchg' + (i === 0 || p === right ? ' on' : '')} data-testid="dream-mention" onClick={() => openDream(props.item.id, i === 0 ? (right ?? undefined) : p)}>
          <Codicon name="file-text" size={14} />
          <span className="tx">
            <span>{titleOf(p)}</span>
            <i className="p">{crumbOf(p, [], props.item)}</i>
          </span>
        </button>
      ))}
      {entry.count > 5 && <span className="more">{t('等{n}篇', { n: entry.count })}</span>}
    </div>
  )
}

/** 归类和改名：按去处分小组；多了（导入几百条）就只列组、默认收起，组里只露最近几条加搜索 */
/**
 * 收件箱里留着不动的：以前的报告里可能有软件自己的文件（收件箱/.首页.json，那时还送给 AI 判），不列、不算条数（@cn/format 的 isAppFile）
 */
function stayOf(report: DreamReport | null | undefined): { stay: number; stayWhy: { path: string; why: string }[] } {
  const all = report?.stayWhy ?? []
  const stayWhy = all.filter((s) => !isAppFile(s.path))
  return { stay: Math.max(0, (report?.stay ?? 0) - (all.length - stayWhy.length)), stayWhy }
}

function FileSection(props: { items: DreamItem[]; stay: number; stayWhy: { path: string; why: string }[]; cur: string | null; onOpen(it: DreamItem): void; pv: DreamPreview; renderDetail(it: DreamItem): React.ReactNode }) {
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
      <button className={'di' + (it.id === props.cur ? ' on' : '') + (it.state !== 'pending' ? ' ' + (it.state === 'taken' ? 'done' : 'drop') : '')} onClick={() => props.onOpen(it)} data-testid="dream-item">
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
        {/* 以前叫「预览」（录屏第 1、7 条：以为是看收下后的样子）：左栏换成挪完以后的目录树，顶上一条「正在看梦游挪完的样子 · 回到报告」 */}
        <button className="btn btn-ghost btn-xs dg-pv" disabled={!pending.length && !pv.on} data-tip="左栏换成文件树，看挪完的样子" data-side="below" onClick={() => pv.setOn(!pv.on)}>
          <Codicon name="list-tree" size={12} />
          在树里看
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
                    <AiIcon job="dream" size={12} />
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
      {props.stayWhy.length > 0 && (
        <ul className="dstay-why" data-testid="dream-stay-why">
          {props.stayWhy.slice(0, 20).map((s) => (
            <li key={s.path}>
              <b>{titleOf(s.path)}</b>
              <span>{s.why || 'AI 拿不准放哪'}</span>
            </li>
          ))}
          {props.stayWhy.length > 20 && <li className="more">{`还有${props.stayWhy.length - 20}条留在收件箱`}</li>}
        </ul>
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

