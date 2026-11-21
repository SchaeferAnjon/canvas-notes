/**
 * 「属性」弹层里这篇的附件（四件事第 2 条，小样 2a、2b）：属性下面一组「附件 40 张 · 86.4 MB」，最多列 5 张（缩略图、名字、在文中哪一节、大小），
 * 点一行在访达中显示；多了一行「全部 40 张 ›」，点开同一个弹层换成 4 列缩略图网格：搜名字、按文中先后 / 按大小 / 文中没用到，
 * 点一张在访达中显示、双击跳到文中那一处、右键拷贝或删除（别的笔记没在用、文中也没用到的才能删）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import { type AttachItem, type NoteAttachments, sizeText } from '../shared/attach'
import { copy, menuAt } from './ctx/menu'
import './props-attach.css'

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
    { label: '在访达中显示', run: () => window.cnMenu.reveal(i.path) },
    { copyImageAt: { x: e.clientX, y: e.clientY } },
    { label: '拷贝路径', run: () => copy(i.path) },
    '-',
    {
      label: '移到废纸篓',
      // 文中用到的删了链接就断了：只有没用到的能在这里删
      enabled: i.offset === null,
      run: async () => {
        await window.cn.trashFiles([i.path])
        reload()
      },
    },
  ])
}

/** 属性下面那一组：最多 5 行 */
export function AttachList(props: { a: NoteAttachments; onAll(): void; onReveal(): void; reload(): void }) {
  const { a } = props
  if (!a.items.length) return null
  const unused = a.items.filter((i) => i.offset === null).length
  return (
    <section className="pa-sec" aria-label="附件">
      <div className="pa-hd">
        <b>附件</b>
        <span className="num">
          {`${a.items.length}张 · ${sizeText(a.bytes)}`}
        </span>
        <span className="sp" />
        <button className="pa-ib" aria-label="在访达里打开附件文件夹" data-tip="在访达里打开附件文件夹" data-side="below" onClick={props.onReveal}>
          <Codicon name="folder-opened" size={16} />
        </button>
      </div>
      {a.items.slice(0, LIST).map((i) => (
        <button key={i.path} className="pa-row" title={i.path} onClick={() => window.cnMenu.reveal(i.path)} onContextMenu={(e) => itemMenu(e, i, props.reload)}>
          <img src={imgUrl(i.path)} alt="" />
          <span className="tx">
            <span className="n truncate">{nameOf(i.path)}</span>
            <span className="w truncate">{i.where ?? '文中没用到'}</span>
          </span>
          <span className="sz num">{sizeText(i.bytes)}</span>
          <span className="rv">
            <Codicon name="go-to-file" size={14} />
            在访达中显示
          </span>
        </button>
      ))}
      {a.items.length > LIST && (
        <div className="pa-more">
          <button onClick={props.onAll}>
            {`全部${a.items.length}张`}
            <Codicon name="chevron-right" size={12} />
          </button>
          <span>
            {`还有${a.items.length - LIST}张${unused ? ` · ${unused}张文中没用到` : ''}`}
          </span>
        </div>
      )}
    </section>
  )
}

type Order = 'text' | 'size' | 'unused'

/** 「全部 N 张」：同一个弹层换成 4 列缩略图网格 */
export function AttachGrid(props: { a: NoteAttachments; onBack(): void; onReveal(): void; onJump(offset: number): void; reload(): void }) {
  const { a } = props
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
        <button className="pa-ib" aria-label="回到属性" onClick={props.onBack}>
          <Codicon name="arrow-left" size={16} />
        </button>
        <b>附件</b>
        <span className="num">
          {`${a.items.length}张 · ${sizeText(a.bytes)}`}
        </span>
        <span className="sp" />
        <button className="pa-ib" aria-label="在访达里打开附件文件夹" onClick={props.onReveal}>
          <Codicon name="folder-opened" size={16} />
        </button>
      </div>
      <label className="pa-find">
        <Codicon name="search" size={14} />
        <input aria-label="找名字" placeholder="找名字" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      <div className="pa-tg" role="tablist" aria-label="怎么排">
        {(
          [
            ['text', '按文中先后'],
            ['size', '按大小'],
            ['unused', `文中没用到${unused.length}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={order === k} className={order === k ? 'on' : ''} onClick={() => setOrder(k)}>
            {k === 'unused' && <Codicon name="warning" size={12} />}
            {label}
          </button>
        ))}
      </div>
      <div className="pa-grid" role="list" aria-label="全部附件">
        {list.map((i) => (
          <button
            key={i.path}
            role="listitem"
            className={'pa-cell' + (i.offset === null ? ' unused' : '')}
            title={`${i.path} · ${sizeText(i.bytes)}`}
            onClick={() => window.cnMenu.reveal(i.path)}
            onDoubleClick={() => i.offset !== null && props.onJump(i.offset)}
            onContextMenu={(e) => itemMenu(e, i, props.reload)}
          >
            <img src={imgUrl(i.path)} alt="" />
            <span className="n truncate">{i.offset === null ? `没用到 · ${nameOf(i.path)}` : nameOf(i.path)}</span>
          </button>
        ))}
        {!list.length && <p className="pa-none">{q ? `没有名字里带「${q}」的` : '没有文中没用到的图'}</p>}
      </div>
      <p className="pa-foot">点一张在访达中显示 · 双击跳到文中那一处 · 右键拷贝、删除</p>
    </div>
  )
}
