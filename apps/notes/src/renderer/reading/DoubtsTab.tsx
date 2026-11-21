/**
 * 我的疑惑（中间栏标签，spec 1.12）：一门课问过的地方，按讲收起，正在读的那讲展开；每讲最多 5 条，多的「还有 N 条」；
 * 搜索时所有讲展开只列命中的。每条：我框的图、问题、讲通的讲法一行、页码（点了回 PDF）、送过 Anki 的写「✓ 已送」。
 * 右上「送进 Anki · N 张」（这一屏唯一的主按钮）。看视频时框一块问的（文档里的问答块）排在最后一组「看视频时问的」，点一条开那篇文档。
 * 2026-11-20 起没有「我的疑惑.md」：这一页直接读各篇笔记和文档。
 */
import { Codicon } from '@cn/design'
import { type DoubtGroup, groupDoubts, questionOf } from '@cn/format'
import { useEffect, useMemo, useState } from 'react'
import type { DoubtsView } from '../../shared/reading'
import { AnkiDialog } from './AnkiDialog'
import './reading.css'

type Item = DoubtsView['items'][number]
const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const PER_GROUP = 5

export function DoubtsTab(props: { folder: string; active: boolean; current: string | null; onOpenPdf(pdf: string, page: number, rect?: [number, number, number, number]): void; onOpenDoc(path: string): void; onNotice(t: string): void }) {
  const [view, setView] = useState<DoubtsView | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'unsent'>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [full, setFull] = useState<Set<string>>(new Set())
  const [row, setRow] = useState<string | null>(null)
  const [anki, setAnki] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)

  const load = () => void window.cnReading.doubts(props.folder).then(setView, (e) => props.onNotice(String((e as Error).message)))
  useEffect(() => {
    if (!props.active) return
    load()
    return window.cn.onFilesChanged(load)
  }, [props.folder, props.active])

  const groups = useMemo(() => groupDoubts(view?.items ?? []) as (DoubtGroup & { items: Item[] })[], [view])
  // 正在读的那讲默认展开（没有就是最后一讲）
  useEffect(() => {
    if (!groups.length) return
    const cur = groups.find((g) => g.key === props.current) ?? groups[groups.length - 1]!
    setOpen((s) => (s.size ? s : new Set([cur.key])))
  }, [groups.length, props.current])

  if (!props.active) return null
  const t = q.trim().toLowerCase()
  const match = (it: Item) => (only === 'all' || !it.sent) && (!t || [questionOf(it.section), it.section.good, ...it.section.doubts, `第 ${it.section.page} 页`].join('\n').toLowerCase().includes(t))
  const unsent = (view?.items ?? []).filter((i) => !i.sent)
  // 看视频时问的不送 Anki：「还没送Anki」时不列
  const videos = only === 'all' ? (view?.videos ?? []).filter((x) => !t || [x.question, x.answer, x.title, x.time].join('\n').toLowerCase().includes(t)) : []
  const total = (view?.items.length ?? 0) + (view?.videos.length ?? 0)

  return (
    <section className="pane doubts" data-testid="doubts">
      <div className="dq-wrap">
        <div className="dq-head">
          <h1>我的疑惑</h1>
          <span className="sp" />
          <button className="btn btn-primary" disabled={!unsent.length} onClick={() => setAnki(true)}>
            <Codicon name="send" size={14} />
            {`送进Anki · ${unsent.length}张`}
          </button>
        </div>
        <p className="dq-sub">
          {view?.course || '这个文件夹'} · <span className="num">{total}</span>条 · 按讲收起，正在读的那讲展开；考前搜一下或一讲一讲看
        </p>
        <div className="dq-tools">
          <label className="dq-find">
            <Codicon name="search" size={14} />
            <input placeholder="搜疑惑、讲法、页码" aria-label="搜疑惑" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="seg" role="tablist" aria-label="筛选">
            <button className={only === 'all' ? 'on' : ''} role="tab" aria-selected={only === 'all'} onClick={() => setOnly('all')}>
              全部
            </button>
            <button className={only === 'unsent' ? 'on' : ''} role="tab" aria-selected={only === 'unsent'} onClick={() => setOnly('unsent')}>
              还没送Anki
            </button>
          </div>
        </div>
        {view && !total && <div className="dq-empty">还没有疑惑。读PDF时框一块问AI，问过的地方都会汇到这里。</div>}
        {groups.map((g) => {
          const hits = g.items.filter(match)
          if ((t || only === 'unsent') && !hits.length) return null
          const isOpen = !!t || open.has(g.key)
          const shown = t || full.has(g.key) ? hits : hits.slice(0, PER_GROUP)
          const latest = [...g.items].sort((a, b) => (b.section.time ?? '').localeCompare(a.section.time ?? ''))[0]
          return (
            <div key={g.key} className="dq-group" data-testid="doubt-group">
              <button
                className="dq-gh"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(g.key)) n.delete(g.key)
                    else n.add(g.key)
                    return n
                  })
                }
              >
                <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                <b>{g.title}</b>
                <span className="num">{hits.length}</span>
                {!isOpen && latest && <span className="latest truncate">最近：{questionOf(latest.section)}</span>}
              </button>
              {isOpen &&
                shown.map((it) => (
                  <div key={it.id} className={'dq-row' + (row === it.id ? ' open' : '')} data-testid="doubt-row">
                    <button className="dq-line" onClick={() => setRow(row === it.id ? null : it.id)}>
                      <span className="dq-shot">{it.section.crop ? <img src={vaultImg(it.section.crop)} alt="" /> : <Codicon name="book" size={16} />}</span>
                      <span className="dq-tx">
                        <b>{questionOf(it.section)}</b>
                        <span className="truncate">{it.section.good.replace(/\s+/g, ' ')}</span>
                      </span>
                      {it.sent && (
                        <span className="dq-sent">
                          <Codicon name="check" size={11} />
                          已送
                        </span>
                      )}
                    </button>
                    <button className="pgc" title="回到 PDF 这一页" onClick={() => props.onOpenPdf(it.pdf, it.section.page, it.section.rect)}>
                      <Codicon name="book" size={12} />{`第${it.section.page}页`}
                    </button>
                    {row === it.id && (
                      <div className="dq-full">
                        {it.section.doubts.length > 1 && (
                          <ul className="dq-doubts">
                            {it.section.doubts.slice(1).map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        )}
                        <p>{it.section.good}</p>
                        {it.section.points.length > 0 && (
                          <ul className="dq-pts">
                            {it.section.points.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              {isOpen && !t && !full.has(g.key) && hits.length > PER_GROUP && (
                <button className="dq-more" onClick={() => setFull((s) => new Set(s).add(g.key))}>
                  {`还有${hits.length - PER_GROUP}条 · 展开这一讲`}
                </button>
              )}
            </div>
          )
        })}
        {videos.length > 0 && (
          <div className="dq-group" data-testid="doubt-group">
            <button className="dq-gh" aria-expanded={!!t || videoOpen} onClick={() => setVideoOpen((o) => !o)}>
              <Codicon name={t || videoOpen ? 'chevron-down' : 'chevron-right'} size={12} />
              <b>看视频时问的</b>
              <span className="num">{videos.length}</span>
              {!t && !videoOpen && <span className="latest truncate">最近：{videos[videos.length - 1]!.question}</span>}
            </button>
            {(t || videoOpen) &&
              videos.map((x) => (
                <div key={`${x.doc}:${x.line}`} className="dq-row" data-testid="doubt-video">
                  <button className="dq-line" title={`记在《${x.doc.split('/').pop()!.replace(/\.md$/i, '')}》`} onClick={() => props.onOpenDoc(x.doc)}>
                    <span className="dq-shot">
                      <Codicon name="device-camera-video" size={16} />
                    </span>
                    <span className="dq-tx">
                      <b>{x.question}</b>
                      <span className="truncate">{x.answer}</span>
                    </span>
                  </button>
                  <button className="pgc" title={`开《${x.doc.split('/').pop()!.replace(/\.md$/i, '')}》，问答块在里面`} onClick={() => props.onOpenDoc(x.doc)}>
                    <Codicon name="device-camera-video" size={12} />
                    {x.time}
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
      {anki && view && (
        <AnkiDialog
          view={view}
          items={unsent}
          onClose={() => setAnki(false)}
          onSent={(text) => {
            setAnki(false)
            props.onNotice(text)
            load()
          }}
        />
      )}
    </section>
  )
}
