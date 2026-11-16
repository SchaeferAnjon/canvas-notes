import { Codicon } from '@cn/design'
import { useState } from 'react'
import type { FrameStyle } from '../../shared/appearance'
import type { GitState } from '../../shared/api'
import { MenuItem, Popover } from './Shell'

const KIND: Record<string, string> = { '??': '新', A: '新', M: '改', D: '删', R: '移动' }
const kindOf = (code: string) => KIND[code] ?? KIND[code.trim()[0] ?? ''] ?? '改'

/** 后台在做的事（梦游、导入……）：A 每件一项，B 收成「后台 N 件」 */
export interface Job {
  id: string
  icon: 'wand' | 'cloud-download' | 'note'
  text: string
  onClick?(): void
}

/**
 * 底栏：管「后台在发生什么」。A 照 VS Code 写满；B 只留库、没提交、后台几件、新版本、本周提交，
 * 提交、同步、历史收进「没提交」的弹层。梦游预览时 dream/preview.tsx 把预览条放进 #pv-slot，别的项藏起来。
 */
export function StatusBar(props: {
  frame: FrameStyle
  vaultName: string
  git: GitState | null
  jobs: Job[]
  previewing: boolean
  onCommit(): Promise<void>
  onSync(): Promise<void>
  onHistory(): void
  onOpen(path: string): void
  onVault(e: React.MouseEvent<HTMLButtonElement>): void
  /** 检查更新：「● 重启更新到 x」 */
  update?: React.ReactNode
  /** A：底栏最右的 AI 入口 */
  ai?: React.ReactNode
  /** 提示（带撤回）：出在底栏正中，不压内容 */
  toast?: React.ReactNode
}) {
  const { git, frame } = props
  const [busy, setBusy] = useState<'commit' | 'sync' | null>(null)
  const [pop, setPop] = useState<{ kind: 'changes' | 'jobs'; el: HTMLElement } | null>(null)
  const changed = git?.changes.length ?? 0

  async function run(kind: 'commit' | 'sync', f: () => Promise<void>) {
    setBusy(kind)
    try {
      await f()
    } finally {
      setBusy(null)
    }
  }
  const commitBtn = (cls: string) => (
    <button className={cls} onClick={() => void run('commit', props.onCommit)} disabled={!changed || busy !== null} data-tip="现在提交" data-side="above">
      <Codicon name="git-commit" size={14} />
      {busy === 'commit' ? '正在提交' : '提交'}
    </button>
  )
  const syncBtn = (cls: string) => (
    <button className={cls} onClick={() => void run('sync', props.onSync)} disabled={busy !== null} data-tip="和远端同步" data-side="above">
      <Codicon name="sync" size={14} className={busy === 'sync' ? 'spin' : ''} />
      {busy === 'sync' ? '正在同步' : '同步'}
    </button>
  )

  return (
    <footer className={'status gitbar' + (props.previewing ? ' previewing' : '')}>
      <div id="pv-slot" className="pv-slot" />
      <button className="bi vault" onClick={props.onVault} data-tip="库：换库、在访达里显示" data-side="above">
        <Codicon name="library" size={14} />
        <b>{props.vaultName}</b>
        {frame === 'b' && git?.branch && <span className="br">· {git.branch}</span>}
      </button>
      {frame === 'a' && git?.branch && (
        <span className="bi">
          <Codicon name="git-branch" size={14} />
          {git.branch}
        </span>
      )}
      {git && (
        <button className="bi" data-testid="git-changed" onClick={(e) => setPop(pop?.kind === 'changes' ? null : { kind: 'changes', el: e.currentTarget })} disabled={frame === 'a' && !changed}>
          {/* 默认状态不挂标记（DESIGN.md）：都提交了只写字，有改动才出黄点 */}
          {changed > 0 && <i className="gdot warn" />}
          {changed ? <span className="num">{changed} 处没提交</span> : '都提交了'}
        </button>
      )}
      {frame === 'a' && commitBtn('bi')}
      {frame === 'a' && syncBtn('bi')}
      {frame === 'a' &&
        props.jobs.map((j) => (
          <button key={j.id} className="bi job" onClick={j.onClick}>
            <Codicon name="loading" size={14} className="spin" />
            {j.text}
          </button>
        ))}
      {frame === 'b' && props.jobs.length > 0 && (
        <button className="bi job" onClick={(e) => setPop(pop?.kind === 'jobs' ? null : { kind: 'jobs', el: e.currentTarget })}>
          <Codicon name="loading" size={14} className="spin" />
          后台 <span className="num">{props.jobs.length}</span> 件
        </button>
      )}
      <div className="st-toast">{props.toast}</div>
      {props.update}
      {git && (
        <span className="bi" data-testid="week-commits">
          本周 <span className="num">{git.weekCommits}</span> 次提交
        </span>
      )}
      {props.ai}

      {pop?.kind === 'changes' && git && (
        <Popover anchor={pop.el} label="没提交的改动" onClose={() => setPop(null)}>
          <div className="mh">{changed ? <>没提交的改动 · <span className="num">{changed} 个文件</span></> : '都提交了'}</div>
          {git.changes.map((c) => (
            <MenuItem key={c.path} icon="file-text" label={c.path} right={kindOf(c.code)} onClick={() => (setPop(null), props.onOpen(c.path))} />
          ))}
          <div className="btns">
            {frame === 'b' && commitBtn('btn btn-primary btn-sm')}
            {frame === 'b' && syncBtn('btn btn-sm')}
            <button className="btn btn-sm" onClick={() => (setPop(null), props.onHistory())}>
              <Codicon name="history" size={14} />
              历史
            </button>
          </div>
        </Popover>
      )}
      {pop?.kind === 'jobs' && (
        <Popover anchor={pop.el} label="后台在做的事" onClose={() => setPop(null)}>
          <div className="mh">后台在做的事</div>
          {props.jobs.map((j) => (
            <MenuItem key={j.id} icon={j.icon} label={j.text} onClick={() => (setPop(null), j.onClick?.())} />
          ))}
        </Popover>
      )}
    </footer>
  )
}
