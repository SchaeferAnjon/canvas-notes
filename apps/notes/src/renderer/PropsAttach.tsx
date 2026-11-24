/**
 * 「属性」弹层里这篇的附件（四件事第 2 条，小样 2a、2b）：属性下面一组「附件 40 张 · 86.4 MB」，最多列 5 张（缩略图、名字、在文中哪一节、大小），
 * 多了一行「全部 40 张 ›」，点开同一个弹层换成 4 列缩略图网格：搜名字、按文中先后 / 按大小 / 文中没用到。
 * 单击一张（一行）跳到文中用它的那一处（2026-11-23 用户「属性里点这张图 我希望能跳到文档里对应的位置」，attach-jump.ts）：
 * 用了几处一处一处跳，到最后一处再点回第一处；双击放大看图（用户「单击跳到位置 双击放大打开 这才对吧」）；文中没用到的单击也是看大图。
 * 右键在访达中显示、拷贝、删除（别的笔记没在用、文中也没用到的才能删）。
 */
import { Codicon } from '@cn/design'
import { imageRefs } from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type AttachItem, type NoteAttachments, sizeText } from '../shared/attach'
import { copy, menuAt } from './ctx/menu'
import './props-attach.css'
import { useT } from './i18n'
import { t as tNow } from '../shared/i18n'

const LIST = 5
const imgUrl = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const nameOf = (p: string) => p.split('/').pop()!

/** 读这篇的附件；文中的图变了（加了、删了一张）再读一次 */
export function useAttachments(path: string, text: string): [NoteAttachments | null, () => void] {
  const [a, setA] = useState<NoteAttachments | null>(null)
  const [seq, setSeq] = useState(0)
  const key = useMemo(() => (text.match(/!\[[^\]\n]*\]\([^)\n]+\)/g) ?? []).join('\n'), [text])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => void window.cnAttach.of(path, false).then((x) => alive && setA(x), () => alive && setA(null)), seq ? 0 : 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [path, key, seq])
  return [a, () => setSeq((s) => s + 1)]
}

function itemMenu(e: React.MouseEvent, i: AttachItem, reload: () => void) {
  void menuAt(e, [
    { label: tNow('在访达中显示'), run: () => window.cnMenu.reveal(i.path) },
    { copyImageAt: { x: e.clientX, y: e.clientY } },
    { label: tNow('拷贝路径'), run: () => copy(i.path) },
    '-',
    {
      label: tNow('移到废纸篓'),
      // 文中用到的删了链接就断了：只有没用到的能在这里删
      enabled: i.offset === null,
      run: async () => {
        await window.cn.trashFiles([i.path])
        reload()
      },
    },
  ])
}

/** 一张图在文中用到的每一处（照现在编辑器里的字算，没存的也算）；![[图.png]] 这种只认主进程找到的那一处 */
function placesOf(text: string, note: string, i: AttachItem): number[] {
  const at = imageRefs(text, note, true)
    .filter((r) => r.path === i.path)
    .map((r) => r.offset)
  return at.length ? at : i.offset === null ? [] : [i.offset]
}

/**
 * 单击一张：用到的跳到下一处（第一次点是第一处），没用到的看大图。
 * 双击：第一下照单击先跳（不等双击的延迟），第二下（detail 2）放大看图
 */
export function useAttachOpen(note: string, text: string, onJump: (offset: number) => void) {
  const next = useRef(new Map<string, number>())
  const [big, setBig] = useState<AttachItem | null>(null)
  const [at, setAt] = useState<{ path: string; k: number; n: number } | null>(null)
  const open = (e: React.MouseEvent, i: AttachItem) => {
    if (e.detail === 2) return setBig(i)
    if (e.detail > 2) return
    const places = placesOf(text, note, i)
    if (!places.length) return setBig(i)
    const k = (next.current.get(i.path) ?? 0) % places.length
    next.current.set(i.path, k + 1)
    setAt({ path: i.path, k, n: places.length })
    onJump(places[k]!)
  }
  /** 这张用了几处（网格角上写「2处」，跳过以后写「1/2」） */
  const count = (i: AttachItem) => {
    const n = placesOf(text, note, i).length
    if (n < 2) return null
    return at?.path === i.path && at.n === n ? `${at.k + 1}/${n}` : tNow('{n}处', { n, ctx: '附件用了几处' })
  }
  const viewer = big && <BigImage item={big} onClose={() => setBig(null)} />
  return { open, count, viewer }
}

/** 放大看图（双击、文中没用到的单击；文件树里双击一张图）：盖住窗口，点空白、按 Esc 收起（连点时后几下落在它上面不算）。sub 换掉最后那段「在哪一节」 */
export function BigImage(props: { item: Pick<AttachItem, 'path' | 'bytes'> & { where?: string | null }; sub?: string; onClose(): void }) {
  const t = useT()
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), props.onClose())
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [props])
  return createPortal(
    <div className="pa-big" role="dialog" aria-label={t('看大图')} onClick={(e) => e.detail < 2 && props.onClose()}>
      <img
        src={imgUrl(props.item.path)}
        alt={nameOf(props.item.path)}
        style={fit ?? { visibility: 'hidden' }}
        onLoad={(e) => {
          // 刚好放下：按图的长宽比撑到窗口 92% 宽、82% 高里最大（小截图也放大，同 ParaRead 的看大图）
          const i = e.currentTarget
          const k = Math.min((window.innerWidth * 0.92) / i.naturalWidth, (window.innerHeight * 0.82) / i.naturalHeight)
          setFit({ width: Math.round(i.naturalWidth * k), height: Math.round(i.naturalHeight * k) })
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <p>
        {nameOf(props.item.path)} · {sizeText(props.item.bytes)} · {props.sub ?? props.item.where ?? t('文中没用到')}
      </p>
    </div>,
    document.body,
  )
}

/** 属性下面那一组：最多 5 行 */
export function AttachList(props: { a: NoteAttachments; onAll(): void; onReveal(): void; reload(): void; open: ReturnType<typeof useAttachOpen> }) {
  const { a } = props
  const t = useT()
  if (!a.items.length) return null
  const unused = a.items.filter((i) => i.offset === null).length
  return (
    <section className="pa-sec" aria-label={t('附件')}>
      <div className="pa-hd">
        <b>{t('附件')}</b>
        <span className="num">
          {t('{n} 张 · {size}', { n: a.items.length, size: sizeText(a.bytes) })}
        </span>
        <span className="sp" />
        <button className="pa-ib" aria-label={t('在访达里打开附件文件夹')} data-tip={t('在访达里打开附件文件夹')} data-side="below" onClick={props.onReveal}>
          <Codicon name="folder-opened" size={16} />
        </button>
      </div>
      {a.items.slice(0, LIST).map((i) => (
        <button key={i.path} className="pa-row" title={i.path} onClick={(e) => props.open.open(e, i)} onContextMenu={(e) => itemMenu(e, i, props.reload)}>
          <img src={imgUrl(i.path)} alt="" />
          <span className="tx">
            <span className="n truncate">{nameOf(i.path)}</span>
            <span className="w truncate">{i.where ?? t('文中没用到')}</span>
          </span>
          <span className="sz num">{sizeText(i.bytes)}</span>
          <span className="rv">
            <Codicon name={i.offset === null ? 'zoom-in' : 'go-to-file'} size={14} />
            {i.offset === null ? t('看大图') : t('跳到文中')}
          </span>
        </button>
      ))}
      {a.items.length > LIST && (
        <div className="pa-more">
          <button onClick={props.onAll}>
            {t('全部 {n} 张', { n: a.items.length })}
            <Codicon name="chevron-right" size={12} />
          </button>
          <span>
            {unused ? t('还有 {n} 张 · {unused} 张文中没用到', { n: a.items.length - LIST, unused }) : t('还有 {n} 张', { n: a.items.length - LIST })}
          </span>
        </div>
      )}
    </section>
  )
}

type Order = 'text' | 'size' | 'unused'

/** 「全部 N 张」：同一个弹层换成 4 列缩略图网格 */
export function AttachGrid(props: { a: NoteAttachments; onBack(): void; onReveal(): void; reload(): void; open: ReturnType<typeof useAttachOpen> }) {
  const { a } = props
  const t = useT()
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<Order>('text')
  const unused = a.items.filter((i) => i.offset === null)
  const list = useMemo(() => {
    const w = q.trim().toLowerCase()
    let l = a.items.filter((i) => !w || nameOf(i.path).toLowerCase().includes(w))
    if (order === 'size') l = [...l].sort((x, y) => y.bytes - x.bytes)
    if (order === 'unused') l = l.filter((i) => i.offset === null)
    return l
  }, [a, q, order])
  return (
    <div className="pa-grid-pop">
      <div className="pa-hd">
        <button className="pa-ib" aria-label={t('回到属性')} onClick={props.onBack}>
          <Codicon name="arrow-left" size={16} />
        </button>
        <b>{t('附件')}</b>
        <span className="num">
          {t('{n} 张 · {size}', { n: a.items.length, size: sizeText(a.bytes) })}
        </span>
        <span className="sp" />
        <button className="pa-ib" aria-label={t('在访达里打开附件文件夹')} onClick={props.onReveal}>
          <Codicon name="folder-opened" size={16} />
        </button>
      </div>
      <label className="pa-find">
        <Codicon name="search" size={14} />
        <input aria-label={t('找名字')} placeholder={t('找名字')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      <div className="pa-tg" role="tablist" aria-label={t('怎么排')}>
        {(
          [
            ['text', t('按文中先后')],
            ['size', t('按大小')],
            ['unused', t('文中没用到 {n}', { n: unused.length })],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={order === k} className={order === k ? 'on' : ''} onClick={() => setOrder(k)}>
            {k === 'unused' && <Codicon name="warning" size={12} />}
            {label}
          </button>
        ))}
      </div>
      <div className="pa-grid" role="list" aria-label={t('全部附件')}>
        {list.map((i) => (
          <button
            key={i.path}
            role="listitem"
            className={'pa-cell' + (i.offset === null ? ' unused' : '')}
            title={`${i.path} · ${sizeText(i.bytes)}`}
            onClick={(e) => props.open.open(e, i)}
            onContextMenu={(e) => itemMenu(e, i, props.reload)}
          >
            <span className="pa-th">
              <img src={imgUrl(i.path)} alt="" />
              {props.open.count(i) && <span className="uses num">{props.open.count(i)}</span>}
            </span>
            <span className="n truncate">{i.offset === null ? t('没用到 · {name}', { name: nameOf(i.path) }) : nameOf(i.path)}</span>
          </button>
        ))}
        {!list.length && <p className="pa-none">{q ? t('没有名字里带「{q}」的', { q }) : t('没有文中没用到的图')}</p>}
      </div>
      <p className="pa-foot">{t('单击跳到文中那一处 · 双击放大 · 右键更多')}</p>
    </div>
  )
}
