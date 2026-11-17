/**
 * 梦游预览 · 挪老图（four-items 第 4 节图 4b）：中间栏一个标签，按笔记分组列出每张图从哪挪到哪、在文中哪一节，
 * 每组举一处链接改动；最上面三个数和搜索；前两组展开、其余收起，多了只露前几组（别把上万条全铺开）；
 * 「不挪的」单独一组写原因，没人用的右键能删。标签条右端「丢掉」「收下这一条」。
 */
import { Codicon } from '@cn/design'
import { Fragment, useMemo, useState } from 'react'
import type { DreamItem } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { copy, menuAt } from '../ctx/menu'
import { PageNote, TabActs } from '../shell/TabActs'

type Info = NonNullable<DreamItem['oldImages']>

/** 一次先列多少篇（多了按「还有 N 篇」再列） */
const PAGE = 8

const img = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const noMd = (p: string) => p.replace(/\.md$/i, '')

export function OldImagesTab(props: { item: DreamItem; active: boolean; busy: boolean; onTake(): void; onDrop(): void }) {
  const { item } = props
  const info = item.oldImages as Info
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string> | null>(null)
  const [shown, setShown] = useState(PAGE)
  const taken = item.state === 'taken'

  const groups = useMemo(() => {
    const by = new Map<string, Info['moves']>()
    for (const m of info.moves) by.set(m.note, [...(by.get(m.note) ?? []), m])
    const list = [...by].map(([note, moves]) => ({ note, moves, ex: info.examples.find((e) => e.note === note) }))
    const s = q.trim().toLowerCase()
    return s ? list.filter((g) => g.note.toLowerCase().includes(s) || g.moves.some((m) => m.from.toLowerCase().includes(s))) : list
  }, [info, q])
  const isOpen = (note: string, i: number) => (open ? open.has(note) : i < 2) || !!q.trim()
  const toggle = (note: string, i: number) =>
    setOpen((o) => {
      const n = new Set(o ?? groups.slice(0, 2).map((g) => g.note))
      if (isOpen(note, i)) n.delete(note)
      else n.add(note)
      return n
    })
  const shared = info.kept.filter((k) => k.why === 'shared').length
  const unused = info.kept.filter((k) => k.why === 'unused').length
  const held = info.kept.filter((k) => k.why !== 'shared' && k.why !== 'unused').length
  const links = info.examples.reduce((n, e) => n + e.count, 0)
  const rest = groups.slice(shown)

  return (
    <section className="pane oi" hidden={!props.active} data-testid="old-images">
      <TabActs active={props.active}>
        <PageNote>{taken ? '梦游 · 已收下' : item.state === 'dropped' ? '梦游 · 已丢掉' : '梦游 · 还没收下'}</PageNote>
        {item.state === 'pending' && (
          <>
            <button className="btn btn-sm btn-ghost" disabled={props.busy} onClick={props.onDrop}>
              <Codicon name="close" size={14} />
              丢掉
            </button>
            <button className="btn btn-sm btn-primary" disabled={props.busy} onClick={props.onTake}>
              <Codicon name="check" size={14} />
              收下这一条
            </button>
          </>
        )}
      </TabActs>
      <div className="oi-body">
        <h1>
          <Codicon name="wand" size={20} />{`挪${info.moves.length}张老图`}
        </h1>
        <p className="oi-sub">
          {`从「附件/」根目录挪进各篇自己的附件文件夹。图不改名、内容不变；${info.examples.length}篇笔记里${links}处链接跟着改，别的字不动。${taken ? '已经收下，在历史里能撤回。' : '收下 = 一次提交进main，可撤回。'}`}
        </p>
        <div className="oi-bar">
          <span className="oi-chip">
            <i className="ok" />
            <b className="num">{`${info.moves.length}张`}</b>挪走
          </span>
          {shared > 0 && (
            <span className="oi-chip">
              <i className="warn" />
              <b className="num">{`${shared}张`}</b>几篇都在用，留在原处
            </span>
          )}
          {unused > 0 && (
            <span className="oi-chip">
              <i />
              <b className="num">{`${unused}张`}</b>没有哪篇在用，不动
            </span>
          )}
          {held > 0 && (
            <span className="oi-chip">
              <i />
              <b className="num">{`${held}张`}</b>这次先不挪
            </span>
          )}
          <span className="sp" />
          <label className="oi-search">
            <Codicon name="search" size={14} />
            <input aria-label="找一张图或一篇笔记" placeholder="找一张图或一篇笔记" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {groups.slice(0, shown).map((g, i) => (
          <div key={g.note} className="oi-group" data-note={g.note}>
            <button className="oi-gh" aria-expanded={isOpen(g.note, i)} onClick={() => toggle(g.note, i)}>
              <Codicon name={isOpen(g.note, i) ? 'chevron-down' : 'chevron-right'} size={14} />
              <Codicon name="file-text" size={16} />
              <b>{noMd(g.note)}</b>
              <span className="meta">
                {`${g.moves.length}张 · 改${g.ex?.count ?? 0}处链接`}
              </span>
            </button>
            {isOpen(g.note, i) && (
              <>
                {g.moves.map((m) => {
                  const dir = m.to.slice(0, m.to.lastIndexOf('/'))
                  return (
                    <div key={m.from} className="oi-row" data-testid="old-image-move">
                      <img className="oi-thumb" src={img(taken ? m.to : m.from)} alt="" loading="lazy" />
                      <s className="oi-from">{m.from}</s>
                      <Codicon name="arrow-right" size={14} className="oi-arrow" />
                      <span className="oi-to">
                        附件/<em>{dir.slice('附件/'.length)}</em>/{m.to.split('/').pop()}
                      </span>
                      <span className="oi-sec truncate">{m.section}</span>
                    </div>
                  )
                })}
                {g.ex && (
                  <div className="oi-link">
                    <span className="meta">链接</span>
                    <code className="del">{g.ex.before}</code>
                    <span className="meta">→</span>
                    <code className="add">{g.ex.after}</code>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {rest.length > 0 && (
          <button className="oi-gh oi-more" onClick={() => setShown(shown + PAGE)}>
            <Codicon name="chevron-right" size={14} />
            {`还有${rest.length}篇 · ${rest.reduce((n, g) => n + g.moves.length, 0)}张`}
          </button>
        )}
        {info.kept.length > 0 && (
          <div className="oi-group oi-kept">
            <div className="oi-gh">
              <Codicon name="circle-slash" size={16} />
              <b>{`不挪的${info.kept.length}张`}</b>
            </div>
            {info.kept.map((k) => (
              <div
                key={k.path}
                className="oi-row"
                data-testid="old-image-kept"
                onContextMenu={(e) =>
                  void menuAt(e, [
                    { label: '在访达中显示', run: () => window.cnMenu.reveal(k.path) },
                    { label: '拷贝路径', run: () => copy(app().absPath(k.path)) },
                    k.why === 'unused' && '-',
                    k.why === 'unused' && { label: '移到废纸篓', run: () => app().trash(k.path) },
                  ])
                }
              >
                <img className="oi-thumb" src={img(k.path)} alt="" loading="lazy" />
                <span className="oi-kp">{k.path}</span>
                <span className="oi-why">
                  {k.why === 'shared' ? (
                    <>
                      {k.notes.map((n) => (
                        <Fragment key={n}>《{titleOf(n)}》</Fragment>
                      ))}
                      都在用，留在原处
                    </>
                  ) : k.why === 'unused' ? (
                    '没有哪篇在用：不动，要删在这里右键'
                  ) : k.why === 'inbox' ? (
                    `《${titleOf(k.notes[0]!)}》还在收件箱：等梦游归类以后再挪`
                  ) : (
                    `《${titleOf(k.notes[0]!)}》的附件文件夹里已有同名的图，留在原处`
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
