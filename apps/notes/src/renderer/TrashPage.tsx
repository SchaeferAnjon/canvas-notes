/**
 * 中间的「最近删掉的」整页（task-5yp97，用户看了 06-文件管理 的 2-30天 图选「只列 30 天」；目录树最底下那一行点开）。
 * 左边一列：标题、一句说明、30 天里删掉的一行一篇（名字 · 原来在「…」· 什么时候删的；指着出「看一看」「放回」），底下一句「到了 30 天…」；
 * 右边：点一条看删掉前的样子（只能看），头上一条「「名字」删掉前的样子 · 周四 21:05 删的 · 只能看，不能改」+「复制全文」「放回「文件夹」」。
 * 放回、撤回由 App 做（一次提交、底栏撤回，同历史里的「放回」）。数据从 Git 历史读（main/trash-recent.ts）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import type { TrashItem, TrashPreview } from '../shared/api'
import { sizeText } from '../shared/attach'
import { fileName, folderOfPath } from '../shared/files'
import { titleOf } from '../shared/layout'
import { when } from '../shared/when'
import { copy } from './ctx/menu'
import { Markdown } from './md-render'
import { fileIcon } from './Palette'
import { folderLabel } from './vault-name'
import './trash-page.css'

/** 列表上的名字：md 去掉扩展名，别的照文件名 */
const nameOf = (p: string) => (/\.md$/i.test(p) ? titleOf(p) : fileName(p))
/** 原来在哪：文件夹一层层用「 / 」隔开，最外层写库名 */
const whereOf = (p: string) => folderLabel(folderOfPath(p)).split('/').join(' / ')
/** 开头一行「# 标题」：右边照文档的样子画成大标题 */
const docTitle = (md: string) => /^\s*#[ \t]+([^\n]*)/.exec(md)?.[1]?.trim() || null
/** 什么时候删的：还没提交的写「刚才」；今天的写「今天 09:12」，别的只写哪天（同「最近」） */
const whenOf = (it: TrashItem, now: number) => (it.commit === null ? '刚才' : it.at >= new Date(new Date(now).toDateString()).getTime() ? when(it.at, { now, time: true }) : when(it.at, { now }))

export function TrashPage(props: {
  /** 库里的文件变了（删了、放回了、撤回了）就重读 */
  version: unknown
  active: boolean
  /** 放回：一次提交、底栏撤回（App 的 restoreFromTrash）；放回了返回 true */
  onRestore(it: TrashItem): Promise<boolean>
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [sel, setSel] = useState<TrashItem | null>(null)
  const [seq, setSeq] = useState(0)
  const now = Date.now()
  useEffect(() => {
    let live = true
    void window.cn.trashRecent().then((l) => live && setItems(l))
    return () => {
      live = false
    }
  }, [props.version, seq])
  // 选着的那篇放回了（列表里没了）：右边清空
  const cur = sel && items?.find((x) => x.path === sel.path && x.commit === sel.commit) ? sel : null
  const restore = async (it: TrashItem) => {
    if (await props.onRestore(it)) setSeq((n) => n + 1)
  }
  const n = items?.length ?? 0

  return (
    <section className="pane trashp" data-testid="trash-page">
      <div className="body tr-body">
        <div className="tr-list">
          <h1 className="tr-h">最近删掉的</h1>
          <p className="tr-sub">{items && !n ? '30天里没有删掉的。更早删掉的去「历史」里找。' : `30天里删掉的${n}篇。放回去还在原来的文件夹；更早删掉的去「历史」里找。`}</p>
          <div className="tr-rows" role="list" aria-label="最近删掉的">
            {items?.map((it) => {
              const on = cur?.path === it.path && cur.commit === it.commit
              return (
                <div key={`${it.commit ?? 'now'}:${it.path}`} role="listitem" className={'tr-row' + (on ? ' on' : '')} title={it.path} onClick={() => setSel(it)}>
                  <span className="ic">{it.board ? <i className="sw" style={{ background: it.board }} /> : <Codicon name={fileIcon(it.path, false)} size={16} />}</span>
                  <span className="nm">{nameOf(it.path)}</span>
                  {!!it.with?.length && <span className="imgs num">{`和${it.with.length}张图`}</span>}
                  <span className="where">{`原来在「${whereOf(it.path)}」`}</span>
                  <span className="when num">{whenOf(it, now)}</span>
                  <span className="acts">
                    <button
                      type="button"
                      className="tr-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSel(it)
                      }}
                    >
                      <Codicon name="eye" size={12} />
                      看一看
                    </button>
                    <button
                      type="button"
                      className="tr-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        void restore(it)
                      }}
                    >
                      <Codicon name="discard" size={12} />
                      放回
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
          {!!n && <p className="tr-foot">到了30天自己从这里拿掉，文件还在Git历史里。</p>}
        </div>
        <div className="tr-prev">{cur ? <Preview key={`${cur.commit ?? 'now'}:${cur.path}`} it={cur} now={now} onRestore={() => void restore(cur)} /> : <p className="tr-none">{n ? '点一条，看它删掉前的样子' : ''}</p>}</div>
      </div>
    </section>
  )
}

/** 右边：删掉前的样子（只能看）。md 照文档的样子排；图片画出来；别的写多大 */
function Preview(p: { it: TrashItem; now: number; onRestore(): void }) {
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
  const name = nameOf(p.it.path)
  const at = p.it.commit === null ? '刚才删的' : `${when(p.it.at, { now: p.now, time: true })}删的`
  const md = pv && 'text' in pv && pv.text !== undefined ? pv.text.replace(/^---\n[\s\S]*?\n---\n?/, '') : null
  const where = useMemo(() => folderLabel(folderOfPath(p.it.path)).split('/').pop(), [p.it.path])
  return (
    <div className="tr-pv" role="region" aria-label="删掉前的样子">
      <div className="tr-bar">
        <Codicon name="history" size={14} />
        <span className="t">
          {`「${name}」删掉前的样子`}
          <span className="nw">{` · ${at}`}</span>
          <span className="nw"> · 只能看，不能改</span>
        </span>
        {md !== null && (
          <button type="button" className="tr-btn" onClick={() => void copy(md)}>
            复制全文
          </button>
        )}
        <button type="button" className="tr-btn solid" onClick={p.onRestore}>
          {`放回「${where}」`}
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
        <p className="tr-none">{`${/\.pdf$/i.test(p.it.path) ? 'PDF' : /\.html?$/i.test(p.it.path) ? 'HTML' : '文件'} · ${sizeText(pv.bytes)}，放回以后能打开看`}</p>
      )}
    </div>
  )
}
