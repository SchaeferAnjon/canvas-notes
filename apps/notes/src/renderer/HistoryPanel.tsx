import { Codicon } from '@cn/design'
import { copy, menuAt } from './ctx/menu'
import { app } from './ctx/actions'
import { useEffect, useState } from 'react'
import type { CommitInfo } from '../shared/api'
import type { DiffSource } from '../shared/diff'
import { titleOf } from '../shared/layout'
import { autoCommitLabel } from '../shared/appearance'
import { when } from '../shared/when'
import { fileIcon } from './Palette'

/**
 * 右栏「历史」：每次提交改了哪些文件（CN-46 / 48）。侧栏只列文件，自己不画 diff：
 * 单击一个文件 = 中间栏开对比标签（滚到这个文件）；双击 = 打开这篇（换掉当前标签，同文件树）；
 * 右键：打开 · 在新标签打开 · 看这一版 · 在访达中显示 · 拷贝路径（文件已经不在了，只有「看这一版」能用）。
 */
export function HistoryPanel(props: { version: number; onClose(): void; onOpenDiff(src: DiffSource, title: string): void; changes: { path: string }[]; autoMinutes: number; onCommit(): Promise<void> }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [committing, setCommitting] = useState(false)
  const [openHash, setOpenHash] = useState<string | null>(null)
  const [cur, setCur] = useState<string | null>(null)

  useEffect(() => {
    void window.cn.history(100).then((c) => {
      setCommits(c)
      // 有新提交时展开最新那次
      setOpenHash(c[0]?.hash ?? null)
    })
  }, [props.version])

  const short = (h: string) => h.slice(0, 7)
  const name = (p: string) => (/\.md$/i.test(p) ? titleOf(p) : p.split('/').pop()!)
  const diff = (c: CommitInfo, path: string) => {
    setCur(c.hash + ':' + path)
    props.onOpenDiff({ kind: 'commit', hash: c.hash, focus: path }, `${name(path)} · ${short(c.hash)}`)
  }
  const version = (c: CommitInfo, path: string) => props.onOpenDiff({ kind: 'version', hash: c.hash, path }, `${name(path)} · ${short(c.hash)}那一版`)

  return (
    <aside className="right" aria-label="历史">
      <div className="rhead">
        <Codicon name="history" size={16} className="ci" />
        <b>历史</b>
        <span className="meta">最近100次</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="关上历史" onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      <div className="rbody">
        {/* 刚打的字还没到自动提交的点：最上面一行说一声，点「现在提交」就进历史（列表只列提交） */}
        {props.changes.length > 0 && (
          <div className="hist-pending" data-testid="history-pending">
            {/* 点这一行：中间栏开对比标签，看上次提交以后改了什么（和点一次提交一样）；量词和底栏「N处没提交」一样用「处」 */}
            <button className="hp" onClick={() => props.onOpenDiff({ kind: 'working' }, '还没提交的改动')}>
              <i className="cdot" />
              <span className="subj">还没提交的改动</span>
              <span className="when">
                {props.changes.length === 1 ? name(props.changes[0]!.path) : `${props.changes.length}处`} · {props.autoMinutes ? `${autoCommitLabel(props.autoMinutes)}自动提交` : '不自动提交'}
              </span>
            </button>
            <button
              className="btn btn-xs"
              disabled={committing}
              onClick={async () => {
                setCommitting(true)
                try {
                  await props.onCommit()
                } finally {
                  setCommitting(false)
                }
              }}
            >
              <Codicon name="git-commit" size={12} />
              {committing ? '正在提交' : '现在提交'}
            </button>
          </div>
        )}
        {commits?.length === 0 && !props.changes.length && <p className="list-empty">还没有提交。</p>}
        {commits?.map((c, i) => (
          <div
            key={c.hash}
            className={'commit' + (openHash === c.hash ? ' open' : '')}
            onContextMenu={(e) =>
              void menuAt(e, [
                { label: '看这次改了什么', run: () => props.onOpenDiff({ kind: 'commit', hash: c.hash }, `${c.subject.slice(0, 24)} · ${short(c.hash)}`) },
                '-',
                { label: '拷贝提交号', run: () => copy(c.hash) },
                { label: '拷贝说明', run: () => copy(c.subject) },
              ])
            }
          >
            <button className="ch" onClick={() => setOpenHash(openHash === c.hash ? null : c.hash)}>
              <i className={'cdot' + (i === 0 ? ' head' : '')} />
              <span className="subj">{c.subject}</span>
              <span className="when">
                {when(Date.parse(c.date), { time: true })} · <code>{short(c.hash)}</code>
                {c.files.length > 1 ? ` · ${c.files.length}个文件` : ''}
              </span>
            </button>
            {openHash === c.hash && (
              <div className="files" role="list" aria-label="这次改的文件">
                {c.files.map((f) => {
                  const gone = f.exists === false
                  return (
                    <button
                      key={f.path}
                      role="listitem"
                      className={'fr' + (cur === c.hash + ':' + f.path ? ' on' : '') + (gone ? ' gone' : '')}
                      title={gone ? `${f.path}（现在已经不在原处了）` : f.path}
                      onClick={() => diff(c, f.path)}
                      onDoubleClick={() => (gone ? app().notice(`「${name(f.path)}」现在已经不在原处了（挪走或删了），右键「看这一版」`) : app().openHere(f.path))}
                      onContextMenu={(e) =>
                        void menuAt(e, [
                          { label: '打开', enabled: !gone, run: () => app().openHere(f.path) },
                          { label: '在新标签打开', enabled: !gone, run: () => app().openFile(f.path) },
                          { label: '看这一版', run: () => version(c, f.path) },
                          '-',
                          { label: '在访达中显示', enabled: !gone, run: () => window.cnMenu.reveal(f.path) },
                          { label: '拷贝路径', run: () => copy(app().absPath(f.path)) },
                        ])
                      }
                    >
                      <Codicon name={fileIcon(f.path)} size={14} />
                      <span className="truncate">{f.path}</span>
                      {f.added > 0 && <span className="num add">+{f.added}</span>}
                      {f.removed > 0 && <span className="num del">−{f.removed}</span>}
                    </button>
                  )
                })}
                <p className="fhint">单击看改动，双击打开，右键更多</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
