/**
 * 「最近删掉的」（task-5yp97 做的整页，task-iq2ow 用户看图说「放到左栏的左下方」后拆成两半）：
 * 列表在左栏（左边图标栏底部那一格「最近删掉的」，TrashPanel）：一行一篇（名字 · 原来在「…」· 什么时候删的；指着右边出「看一看」「放回」两颗圆钮，名字照旧在）；
 * 点一条，中间开「最近删掉的」标签看删掉前的样子（只能看），头上一条「「名字」删掉前的样子 · 周四 21:05 删的 · 只能看，不能改」+「复制全文」「放回「文件夹」」。
 * 放回、撤回由 App 做（一次提交、底栏撤回，同历史里的「放回」）。数据从 Git 历史读（main/trash-recent.ts）。
 * 「没人用的附件」（2026-11-23 附件跟着笔记走）：以前删笔记时没跟着走的附件，左栏列表上面一行「没人用的附件 · N个」，
 * 点它中间按原来属于哪篇分组、带缩略图，「全部移到废纸篓」或一组一组移（一次提交、底栏撤回）；不自动删。数据 main/orphan-attach.ts。
 * 同一次删的一组附件（attachOf）在列表里是一行「「冰岛」的附件 · N个」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { TrashItem, TrashPreview } from '../shared/api'
import { type OrphanGroup, sizeText } from '../shared/attach'
import { fileName, folderOfPath } from '../shared/files'
import { titleOf } from '../shared/layout'
import { when } from '../shared/when'
import { copy } from './ctx/menu'
import { Markdown } from './md-render'
import { fileIcon } from './Palette'
import { ViewHead } from './shell/Shell'
import { folderLabel } from './vault-name'
import './trash-page.css'
import { rich, useT } from './i18n'
import { t } from '../shared/i18n'

/** 列表上的名字：md 去掉扩展名，别的照文件名 */
const nameOf = (p: string) => (/\.md$/i.test(p) ? titleOf(p) : fileName(p))
/** 一行的名字：同一次删的一组附件写「「冰岛」的附件」 */
const rowName = (it: TrashItem) => (it.attachOf ? t('「{name}」的附件', { name: titleOf(it.attachOf) }) : nameOf(it.path))
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i
const imgUrl = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
/** 原来在哪：文件夹一层层用「 / 」隔开，最外层写库名 */
const whereOf = (p: string) => folderLabel(folderOfPath(p)).split('/').join(' / ')
/** 开头一行「# 标题」：中间照文档的样子画成大标题 */
const docTitle = (md: string) => /^\s*#[ \t]+([^\n]*)/.exec(md)?.[1]?.trim() || null
/** 刚删的：还没提交的，或一分钟内提交的（删笔记当场就提交了） */
const justNow = (it: TrashItem, now: number) => it.commit === null || now - it.at < 60_000
/** 什么时候删的：刚删的写「刚才」；今天的写「今天 09:12」，别的只写哪天（同「最近」） */
const whenOf = (it: TrashItem, now: number) => (justNow(it, now) ? t('刚才') : it.at >= new Date(new Date(now).toDateString()).getTime() ? when(it.at, { now, time: true }) : when(it.at, { now }))
const same = (a: Picked, b: Picked) => !!a && !!b && (a === 'orphans' || b === 'orphans' ? a === b : a.path === b.path && a.commit === b.commit)

/** 点了哪一条：删掉的一条，或「没人用的附件」那一行 */
type Picked = TrashItem | 'orphans' | null

// ---------- 左栏和中间共用：点了哪一条、列表要不要重读、没人用的附件 ----------
let picked: Picked = null
let orphans: OrphanGroup[] | null = null
let orphanSeq = 0
/** 放回了一篇就加一：左栏列表重读 */
let changed = 0
const subs = new Set<() => void>()
const sub = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb))
const emit = () => subs.forEach((f) => f())
/** 选一条（中间看它删掉前的样子）；'orphans' 是看没人用的附件；null 是不看哪一条 */
export function pickTrash(it: Picked) {
  picked = it
  emit()
}
const usePicked = () => useSyncExternalStore(sub, () => picked)
const useOrphans = () => useSyncExternalStore(sub, () => orphans)
/** 重查没人用的附件（全库读一遍，后台跑；后发的盖先发的） */
function loadOrphans() {
  const seq = ++orphanSeq
  void window.cnAttach.orphans().then((g) => {
    if (seq !== orphanSeq) return
    orphans = g
    // 都移完了：中间回到「点一条看它」（左栏那一行也没了）
    if (!g.length && picked === 'orphans') picked = null
    emit()
  })
}
/** 这些没人用的附件移到废纸篓（App 的 trashOrphans：一次提交、底栏撤回），移了就重查 */
async function trashSome(paths: string[], onTrash: (paths: string[]) => Promise<boolean>) {
  if (await onTrash(paths)) loadOrphans()
}
const orphanPaths = (gs: OrphanGroup[]) => gs.flatMap((g) => g.items.map((i) => i.path))
const useChanged = () => useSyncExternalStore(sub, () => changed)
/** 放回（App 的 restoreFromTrash：一次提交、底栏撤回）；放回了的正选着就不看了，左栏重读 */
async function restoreOne(it: TrashItem, onRestore: (it: TrashItem) => Promise<boolean>) {
  if (!(await onRestore(it))) return
  if (same(picked, it)) picked = null
  changed++
  emit()
}

/** 左栏里原来在哪个文件夹：放不下时从中间截（前面几层先省略，最后一层留着），括号照样合上 */
function WhereName(p: { path: string }) {
  const segs = whereOf(p.path).split(' / ')
  const last = segs.pop()!
  return (
    <span className="wn">
      {!!segs.length && <span className="wh">{segs.join(' / ') + ' / '}</span>}
      <span className="wl">{last}</span>
    </span>
  )
}

/** 左栏「最近删掉的」：标题、一句说明、30 天里删掉的一行一篇，底下一句「到了 30 天…」 */
export function TrashPanel(props: {
  /** 库里的文件变了（删了、放回了、撤回了）就重读 */
  version: unknown
  /** 放回：一次提交、底栏撤回（App 的 restoreFromTrash）；放回了返回 true */
  onRestore(it: TrashItem): Promise<boolean>
  /** 点一条、「看一看」：中间开「最近删掉的」看它（'orphans'：没人用的附件） */
  onPick(it: TrashItem | 'orphans'): void
  /** 没人用的附件移到废纸篓（App 的 trashOrphans）；移了返回 true */
  onTrashOrphans(paths: string[]): Promise<boolean>
}) {
  const t = useT()
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const seq = useChanged()
  const cur = usePicked()
  const groups = useOrphans()
  const now = Date.now()
  useEffect(() => {
    let live = true
    void window.cn.trashRecent().then((l) => live && setItems(l))
    loadOrphans()
    return () => {
      live = false
    }
  }, [props.version, seq])
  // 篇数：同一次删的一组附件不算一篇（角标同，files/store.ts useTrashCount）
  const n = items?.filter((i) => !i.attachOf).length ?? 0
  const sets = items?.filter((i) => i.attachOf).length ?? 0
  const orphanN = groups?.reduce((k, g) => k + g.items.length, 0) ?? 0
  return (
    <aside className="side trash-side" aria-label={t('最近删掉的')} data-testid="trash-panel">
      <ViewHead title={t('最近删掉的')} />
      <div className="del-body">
        <p className="del-sub">
          {items && !n && !sets
            ? t('30天里没有删掉的。更早删掉的去「历史」里找。')
            : items && sets
              ? t('30天里删掉的{n}篇、{m}组附件。放回去还在原来的文件夹；更早删掉的去「历史」里找。', { n, m: sets })
              : items
                ? t('30天里删掉的{n}篇。放回去还在原来的文件夹；更早删掉的去「历史」里找。', { n })
                : ''}
        </p>
        {orphanN > 0 && (
          <div className={'del-row del-orph' + (cur === 'orphans' ? ' on' : '')} role="button" tabIndex={0} data-testid="orphan-row" aria-label={t('没人用的附件{n}个', { n: orphanN })} onClick={() => props.onPick('orphans')} onKeyDown={(e) => e.key === 'Enter' && props.onPick('orphans')}>
            <span className="ic">
              <Codicon name="file-media" size={16} />
            </span>
            <span className="tx">
              <span className="l1">
                <span className="nm">{t('没人用的附件')}</span>
                <span className="imgs num">{t('{n}个', { n: orphanN, ctx: '附件' })}</span>
              </span>
              <span className="l2">
                <span className="where">{t('删笔记时留下的，没有哪篇在用')}</span>
              </span>
            </span>
            <span className="acts">
              <button
                type="button"
                className="del-btn"
                aria-label={t('全部移到废纸篓')}
                data-tip={t('全部移到废纸篓')}
                data-side="below"
                onClick={(e) => {
                  e.stopPropagation()
                  void trashSome(orphanPaths(groups!), props.onTrashOrphans)
                }}
              >
                <Codicon name="trash" size={14} />
              </button>
            </span>
          </div>
        )}
        <div className="del-rows" role="list" aria-label={t('最近删掉的')}>
          {items?.map((it) => (
            <div key={`${it.commit ?? 'now'}:${it.path}`} role="listitem" className={'del-row' + (same(cur, it) ? ' on' : '')} title={it.path} onClick={() => props.onPick(it)}>
              <span className="ic">{it.board ? <i className="sw" style={{ background: it.board }} /> : <Codicon name={fileIcon(it.path, false)} size={16} />}</span>
              <span className="tx">
                <span className="l1">
                  <span className="nm">{rowName(it)}</span>
                  {!!it.with?.length && <span className="imgs num">{it.attachOf ? t('{n}个', { n: it.with.length + 1, ctx: '附件' }) : t('和{n}张图', { n: it.with.length })}</span>}
                </span>
                <span className="l2">
                  <span className="where">{rich(t('原来在「{where}」'), { where: <WhereName path={it.attachOf ?? it.path} /> })}</span>
                  <span className="when num">{whenOf(it, now)}</span>
                </span>
              </span>
              <span className="acts">
                <button
                  type="button"
                  className="del-btn"
                  aria-label={t('看一看')}
                  data-tip={t('看一看')}
                  data-side="below"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onPick(it)
                  }}
                >
                  <Codicon name="eye" size={14} />
                </button>
                <button
                  type="button"
                  className="del-btn"
                  aria-label={t('放回')}
                  data-tip={t('放回')}
                  data-side="below"
                  onClick={(e) => {
                    e.stopPropagation()
                    void restoreOne(it, props.onRestore)
                  }}
                >
                  <Codicon name="discard" size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
        {!!n && <p className="del-foot">{t('到了30天自己从这里拿掉，文件还在Git历史里。')}</p>}
      </div>
    </aside>
  )
}

/** 中间的「最近删掉的」标签：左栏点的那一条删掉前的样子；还没点哪一条时一句话 */
export function TrashPage(props: {
  /** 放回：一次提交、底栏撤回（App 的 restoreFromTrash）；放回了返回 true */
  onRestore(it: TrashItem): Promise<boolean>
  /** 没人用的附件移到废纸篓（App 的 trashOrphans）；移了返回 true */
  onTrashOrphans(paths: string[]): Promise<boolean>
}) {
  const t = useT()
  const cur = usePicked()
  const now = Date.now()
  return (
    <section className="pane trashp" data-testid="trash-page">
      <div className="body tr-body">
        <div className="tr-prev">
          {cur === 'orphans' ? <Orphans onTrash={props.onTrashOrphans} /> : cur ? <Preview key={`${cur.commit ?? 'now'}:${cur.path}`} it={cur} now={now} onRestore={() => void restoreOne(cur, props.onRestore)} /> : <p className="tr-none">{t('在左栏「最近删掉的」里点一条，看它删掉前的样子')}</p>}
        </div>
      </div>
    </section>
  )
}

/** 没人用的附件：按原来属于哪篇分组，每组一排缩略图；「全部移到废纸篓」、一组一组移 */
function Orphans(p: { onTrash(paths: string[]): Promise<boolean> }) {
  const t = useT()
  const groups = useOrphans()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!groups) loadOrphans()
  }, [groups])
  const go = async (paths: string[]) => {
    setBusy(true)
    try {
      await trashSome(paths, p.onTrash)
    } finally {
      setBusy(false)
    }
  }
  if (!groups) return null
  const n = groups.reduce((k, g) => k + g.items.length, 0)
  if (!n) return <p className="tr-none">{t('在左栏「最近删掉的」里点一条，看它删掉前的样子')}</p>
  const bytes = groups.reduce((k, g) => k + g.items.reduce((b, i) => b + i.bytes, 0), 0)
  return (
    <div className="tr-pv" role="region" aria-label={t('没人用的附件')} data-testid="orphans">
      <div className="tr-bar">
        <Codicon name="file-media" size={14} />
        <span className="t">
          {t('没人用的附件{n}个', { n })}
          <span className="nw">{` · ${sizeText(bytes)}`}</span>
          <span className="nw">{' · '}{t('删笔记时没跟着走的，库里没有哪篇在用')}</span>
        </span>
        <button type="button" className="tr-btn solid" disabled={busy} onClick={() => void go(orphanPaths(groups))}>
          <Codicon name="trash" size={14} />
          {t('全部移到废纸篓')}
        </button>
      </div>
      <p className="or-sub">{t('移到废纸篓是一次提交，底栏能撤回，这里也能放回。不点不会删。')}</p>
      {groups.map((g) => {
        const name = g.note ? titleOf(g.note) : g.dir.split('/').pop()!
        return (
          <section key={g.dir} className="or-grp" aria-label={name}>
            <div className="or-head">
              <span className="or-tx">
                <span className="or-name">{name}</span>
                <span className="or-meta">
                  {g.note ? rich(t('那篇已经删了 · 原来在「{where}」'), { where: whereOf(g.note) }) : rich(t('认不出原来属于哪篇 · 在「{where}」'), { where: g.dir.split('/').join(' / ') })}
                  <span className="nw">{' · '}</span>
                  <span className="nw num">{t('{n}个', { n: g.items.length, ctx: '附件' })}</span>
                </span>
              </span>
              <button type="button" className="tr-btn" disabled={busy} onClick={() => void go(g.items.map((i) => i.path))}>
                {t('移到废纸篓', { ctx: '没人用的附件' })}
              </button>
            </div>
            <div className="or-grid">
              {g.items.map((i) => (
                <span key={i.path} className="or-cell" title={`${fileName(i.path)} · ${sizeText(i.bytes)}`}>
                  {IMAGE.test(i.path) ? (
                    <img src={imgUrl(i.path)} alt={fileName(i.path)} loading="lazy" draggable={false} />
                  ) : (
                    <span className="or-file">
                      <Codicon name={fileIcon(i.path, false)} size={20} />
                      <span className="or-fn">{fileName(i.path)}</span>
                    </span>
                  )}
                </span>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** 删掉前的样子（只能看）。md 照文档的样子排；图片画出来；别的写多大 */
function Preview(p: { it: TrashItem; now: number; onRestore(): void }) {
  const t = useT()
  const [pv, setPv] = useState<TrashPreview | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    window.cn.trashPreview(p.it.path, p.it.commit).then(
      (x) => live && setPv(x),
      (e: Error) => live && setPv({ error: String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }),
    )
    return () => {
      live = false
    }
  }, [p.it.path, p.it.commit])
  const name = rowName(p.it)
  const at = justNow(p.it, p.now) ? t('刚才删的') : t('{when}删的', { when: when(p.it.at, { now: p.now, time: true }) })
  const md = pv && 'text' in pv && pv.text !== undefined ? pv.text.replace(/^---\n[\s\S]*?\n---\n?/, '') : null
  const where = useMemo(() => folderLabel(folderOfPath(p.it.path)).split('/').pop(), [p.it.path])
  return (
    <div className="tr-pv" role="region" aria-label={t('删掉前的样子')}>
      <div className="tr-bar">
        <Codicon name="history" size={14} />
        <span className="t">
          {t('「{name}」删掉前的样子', { name })}
          <span className="nw">{` · ${at}`}</span>
          <span className="nw">{' · '}{t('只能看，不能改')}</span>
        </span>
        {md !== null && (
          <button type="button" className="tr-btn" onClick={() => void copy(md)}>
            {t('复制全文')}
          </button>
        )}
        <button type="button" className="tr-btn solid" onClick={p.onRestore}>
          {t('放回「{where}」', { where })}
        </button>
      </div>
      {!pv ? null : 'error' in pv ? (
        <p className="tr-none">{pv.error}</p>
      ) : md !== null ? (
        <div className="tr-doc">
          <h2 className="tr-title">{docTitle(md) ?? name}</h2>
          <div className="md">
            <Markdown text={docTitle(md) === null ? md : md.replace(/^\s*#[ \t]+[^\n]*\n?/, '')} math />
          </div>
        </div>
      ) : pv.image ? (
        <img className="tr-img" src={pv.image} alt={name} />
      ) : (
        <p className="tr-none">{t('{kind} · {size}，放回以后能打开看', { kind: /\.pdf$/i.test(p.it.path) ? 'PDF' : /\.html?$/i.test(p.it.path) ? 'HTML' : t('文件', { ctx: '最近删掉的' }), size: sizeText(pv.bytes) })}</p>
      )}
    </div>
  )
}
