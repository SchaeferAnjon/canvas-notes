import { Icon } from '@cn/design'
import { GitBranch, GitCommitHorizontal, History, Library, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GitState } from '../shared/api'

const KIND: Record<string, string> = { '??': '新', A: '新', M: '改', D: '删', R: '移动' }
const kindOf = (code: string) => KIND[code] ?? KIND[code.trim()[0] ?? ''] ?? '改'

export function GitBar(props: {
  vaultName: string
  git: GitState | null
  historyOpen: boolean
  onCommit(): Promise<void>
  onSync(): Promise<void>
  onToggleHistory(): void
  onOpen(path: string): void
}) {
  const { git } = props
  const [busy, setBusy] = useState<'commit' | 'sync' | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  const pop = useRef<HTMLDivElement>(null)
  const changed = git?.changes.length ?? 0

  useEffect(() => {
    if (!showChanges) return
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) setShowChanges(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showChanges])

  async function run(kind: 'commit' | 'sync', f: () => Promise<void>) {
    setBusy(kind)
    try {
      await f()
    } finally {
      setBusy(null)
    }
  }

  return (
    <footer className="gitbar">
      <span className="bi">
        <Icon of={Library} size={14} />
        {props.vaultName}
      </span>
      {git?.branch && (
        <span className="bi">
          <Icon of={GitBranch} size={14} />
          {git.branch}
        </span>
      )}
      <i className="vsep" />
      {git && (
        <div className="chg-wrap" ref={pop}>
          <button className="bi" data-testid="git-changed" onClick={() => setShowChanges((v) => !v)} disabled={!changed}>
            <i className={'gdot ' + (changed ? 'warn' : 'ok')} />
            {changed ? <span className="num">{changed} 个文件改了，未提交</span> : '都提交了'}
          </button>
          {showChanges && changed > 0 && (
            <div className="chg" role="dialog" aria-label="没提交的改动">
              <div className="hd">
                没提交的改动 <span className="num">{changed} 个文件</span>
              </div>
              {git.changes.map((c) => (
                <button key={c.path} className="fr" onClick={() => (setShowChanges(false), props.onOpen(c.path))}>
                  <span className="truncate">{c.path}</span>
                  <span className="k">{kindOf(c.code)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="bi" onClick={() => void run('commit', props.onCommit)} disabled={!changed || busy !== null}>
        <Icon of={GitCommitHorizontal} size={14} />
        {busy === 'commit' ? '正在提交' : '提交'}
      </button>
      <button className="bi" onClick={() => void run('sync', props.onSync)} disabled={busy !== null}>
        <Icon of={RefreshCw} size={14} className={busy === 'sync' ? 'spin' : ''} />
        {busy === 'sync' ? '正在同步' : '同步'}
      </button>
      <button className={'bi' + (props.historyOpen ? ' on' : '')} onClick={props.onToggleHistory}>
        <Icon of={History} size={14} />
        历史
      </button>
      <span className="sp" />
      {git && (
        <span className="bi" data-testid="week-commits">
          本周 <span className="num">{git.weekCommits}</span> 次提交
        </span>
      )}
    </footer>
  )
}
