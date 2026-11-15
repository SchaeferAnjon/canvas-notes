import { Icon } from '@cn/design'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CommitInfo } from '../shared/api'
import { when } from './ListView'

/** 右栏「历史」：每次提交改了哪些文件 */
export function HistoryPanel(props: { version: number; onClose(): void; onOpen(path: string): void }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [openHash, setOpenHash] = useState<string | null>(null)

  useEffect(() => {
    void window.cn.history(100).then((c) => {
      setCommits(c)
      // 有新提交时展开最新那次
      setOpenHash(c[0]?.hash ?? null)
    })
  }, [props.version])

  return (
    <aside className="right" aria-label="历史">
      <div className="rhead">
        <b>历史</b>
        <span className="meta">每次提交改了哪些文件</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="关上历史" onClick={props.onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="rbody">
        {commits?.length === 0 && <p className="list-empty">还没有提交。</p>}
        {commits?.map((c, i) => (
          <div key={c.hash} className={'commit' + (openHash === c.hash ? ' open' : '')}>
            <button className="ch" onClick={() => setOpenHash(openHash === c.hash ? null : c.hash)}>
              <i className={'cdot' + (i === 0 ? ' head' : '')} />
              <span className="subj">{c.subject}</span>
              <span className="when">
                {when(Date.parse(c.date))} · <code>{c.hash.slice(0, 7)}</code>
              </span>
            </button>
            {openHash === c.hash && (
              <div className="files">
                {c.files.map((f) => (
                  <button key={f.path} className="fr" onClick={() => props.onOpen(f.path)}>
                    <span className="truncate">{f.path}</span>
                    <span className="num add">+{f.added}</span>
                    <span className="num del">−{f.removed}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
