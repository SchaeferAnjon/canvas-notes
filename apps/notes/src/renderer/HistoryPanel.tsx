import { Codicon } from '@cn/design'
import { copy, menuAt } from './ctx/menu'
import { useEffect, useState } from 'react'
import type { CommitInfo, DreamDiffFile } from '../shared/api'
import { when } from './ListView'

/** 一次最多画这么多行，大文件（整页剪藏几百行）不卡 */
const MAX_LINES = 300

/** 右栏「历史」：每次提交改了哪些文件；点文件在下面展开这次改了什么 */
export function HistoryPanel(props: { version: number; onClose(): void; onOpen(path: string): void }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [openHash, setOpenHash] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)

  useEffect(() => {
    void window.cn.history(100).then((c) => {
      setCommits(c)
      // 有新提交时展开最新那次
      setOpenHash(c[0]?.hash ?? null)
      setOpenFile(null)
    })
  }, [props.version])

  return (
    <aside className="right" aria-label="历史">
      <div className="rhead">
        <b>历史</b>
        <span className="meta">每次提交改了哪些文件，点文件看改了什么</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="关上历史" onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      <div className="rbody">
        {commits?.length === 0 && <p className="list-empty">还没有提交。</p>}
        {commits?.map((c, i) => (
          <div
            key={c.hash}
            className={'commit' + (openHash === c.hash ? ' open' : '')}
            onContextMenu={(e) =>
              void menuAt(e, [
                { label: '拷贝提交号', run: () => copy(c.hash) },
                { label: '拷贝说明', run: () => copy(c.subject) },
              ])
            }
          >
            <button className="ch" onClick={() => (setOpenHash(openHash === c.hash ? null : c.hash), setOpenFile(null))}>
              <i className={'cdot' + (i === 0 ? ' head' : '')} />
              <span className="subj">{c.subject}</span>
              <span className="when">
                {when(Date.parse(c.date))} · <code>{c.hash.slice(0, 7)}</code>
              </span>
            </button>
            {openHash === c.hash && (
              <div className="files">
                {c.files.map((f) => {
                  const on = openFile === f.path
                  return (
                    <div key={f.path}>
                      <button className={'fr' + (on ? ' on' : '')} aria-expanded={on} onClick={() => setOpenFile(on ? null : f.path)}>
                        <span className="truncate">{f.path}</span>
                        <span className="num add">+{f.added}</span>
                        <span className="num del">−{f.removed}</span>
                      </button>
                      {on && <FileDiff hash={c.hash} path={f.path} onOpen={props.onOpen} />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

function FileDiff(props: { hash: string; path: string; onOpen(path: string): void }) {
  const [res, setRes] = useState<{ diff: DreamDiffFile | null; exists: boolean } | { error: string } | null>(null)
  useEffect(() => {
    let stale = false
    window.cn.commitFileDiff(props.hash, props.path).then(
      (r) => !stale && setRes(r),
      (e: unknown) => !stale && setRes({ error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      stale = true
    }
  }, [props.hash, props.path])

  if (!res) return <div className="hdiff meta">读取中…</div>
  if ('error' in res) return <div className="hdiff meta">读不出这次改动：{res.error}</div>
  const lines = res.diff?.lines ?? []
  return (
    <div className="hdiff" data-testid="history-diff">
      <div className="hd-acts">
        {res.exists ? (
          <button className="btn btn-sm" onClick={() => props.onOpen(props.path)}>
            <Codicon name="file-text" size={14} />
            打开这篇
          </button>
        ) : (
          <span className="meta">这篇现在已经不在原处了（挪走或删了）</span>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="meta">这次没有文字上的改动</div>
      ) : (
        <div className="dl">
          {lines.slice(0, MAX_LINES).map((l, i) => (
            <div key={i} className={l.k}>
              {l.t || ' '}
            </div>
          ))}
          {lines.length > MAX_LINES && <div className="gap">还有 {lines.length - MAX_LINES} 行没显示</div>}
        </div>
      )}
    </div>
  )
}
