import { Codicon } from '@cn/design'
import { useState } from 'react'
import type { FrameStyle } from '../../shared/appearance'
import type { GitState, StrandedNote } from '../../shared/api'
import { when } from '../../shared/when'
import type { AiJob } from '../../shared/ai-logo'
import { AiIcon } from '../engine-logo'
import { MenuItem, Popover } from './Shell'

const KIND: Record<string, string> = { '??': '新', A: '新', M: '改', D: '删', R: '移动' }
const kindOf = (code: string) => KIND[code] ?? KIND[code.trim()[0] ?? ''] ?? '改'

/** 后台在做的事（梦游、导入……）：A 每件一项，B 收成「后台 N 件」 */
export interface Job {
  id: string
  icon: 'wand' | 'cloud-download' | 'note'
  /** AI 在做的（梦游、视频框一块问）：画跑它的那一家的标志 */
  ai?: AiJob
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
  /** 库的路径：悬停底栏库名时看到（换库在左图标栏最下面的库图标） */
  vaultPath: string
  /** 检查更新：「● 重启更新到 x」 */
  update?: React.ReactNode
  /** A：底栏最右的 AI 入口 */
  ai?: React.ReactNode
  /** A：右端「译 · Claude Code」（翻译用哪个 AI） */
  translate?: React.ReactNode
  /** A：右端通知铃（AI 入口左边） */
  bell?: React.ReactNode
  /** 提示（带撤回）：出在底栏正中，不压内容 */
  toast?: React.ReactNode
  /** 打开库时整理了一次（「我的疑惑」不再是文件、两篇笔记并成一篇）：左边一句带「撤回」和 ×，关掉之前一直在（原型 design/workspace/proto-a.html 底栏左边那句） */
  tidy?: { said: string; onUndo(): void; onClose(): void } | null
  /** 哪都写不进去、字只在内存里的那几篇（stash：设置目录里的备份）：有就不说「都提交了」，醒目地说出来 */
  unsaved?: StrandedNote[]
  /** 在访达里显示那份备份 */
  onRevealStash?(file: string): void
}) {
  const { git, frame } = props
  const [busy, setBusy] = useState<'commit' | 'sync' | null>(null)
  const [pop, setPop] = useState<{ kind: 'changes' | 'jobs'; el: HTMLElement } | null>(null)
  const changed = git?.changes.length ?? 0
  const unsaved = props.unsaved ?? []

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
      {/* 只显示，不能点：换库、导入在左图标栏最下面的库图标里（库入口只留一个） */}
      <span className="bi vault" data-tip={props.vaultPath.replace(/^\/Users\/[^/]+/, '~')} data-side="above">
        <Codicon name="library" size={14} />
        <b>{props.vaultName}</b>
        {frame === 'b' && git?.branch && <span className="br">· {git.branch}</span>}
      </span>
      {frame === 'a' && git?.branch && (
        <span className="bi">
          <Codicon name="git-branch" size={14} />
          {git.branch}
        </span>
      )}
      {git && (
        <button className={'bi' + (unsaved.length ? ' err' : '')} data-testid="git-changed" onClick={(e) => setPop(pop?.kind === 'changes' ? null : { kind: 'changes', el: e.currentTarget })} disabled={frame === 'a' && !changed && !unsaved.length}>
          {/* 默认状态不挂标记（DESIGN.md）：都提交了只写字，有改动才出黄点；有写不进去的篇先说它（字只在内存里，不能说都提交了） */}
          {(changed > 0 || unsaved.length > 0) && <i className={'gdot ' + (unsaved.length ? 'err' : 'warn')} />}
          {unsaved.length ? <span className="num err">{`${unsaved.length}篇写不进去，字只在内存里`}</span> : changed ? <span className="num">{`${changed}处没提交`}</span> : '都提交了'}
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
          <span className="num">{`后台${props.jobs.length}件`}</span>
        </button>
      )}
      {props.tidy && (
        <span className="bi tidy-msg" data-testid="tidy-msg">
          <Codicon name="check" size={14} />
          <span className="truncate" data-tip={`整理好了：${props.tidy.said}`} data-side="above">{`整理好了：${props.tidy.said}`}</span>
          <button className="lnk" onClick={props.tidy.onUndo}>
            撤回
          </button>
          <button className="x" aria-label="关掉这一句" onClick={props.tidy.onClose}>
            <Codicon name="close" size={12} />
          </button>
        </span>
      )}
      <div className="st-toast">{props.toast}</div>
      {props.translate}
      {props.update}
      {git && (
        <span className="bi" data-testid="week-commits">
          <span className="num">{`本周${git.weekCommits}次提交`}</span>
        </span>
      )}
      {props.bell}
      {props.ai}

      {pop?.kind === 'changes' && git && (
        <Popover anchor={pop.el} label="没提交的改动" onClose={() => setPop(null)}>
          {unsaved.length > 0 && <div className="mh">写不进去 · 字只在内存里，先别退出</div>}
          {unsaved.map((u) => {
            return (
              <MenuItem
                key={'u' + u.path}
                className="unsaved"
                icon="warning"
                label={u.path}
                right={u.stash ? '有备份' : '没备份'}
                title={`${u.path} · ${u.stash ? `字备份在 ${u.stash}，点了在访达里显示` : '备份也没写进去'}`}
                onClick={() => (setPop(null), u.stash ? props.onRevealStash?.(u.stash) : props.onOpen(u.path))}
              />
            )
          })}
          <div className="mh">{changed ? <>没提交的改动 · <span className="num">{`${changed}个文件`}</span></> : unsaved.length ? '别的都提交了' : '都提交了'}</div>
          {changed > 0 && git.autoCommitError && (
            <div className="mwarn" role="status" data-testid="autocommit-error">
              <Codicon name="warning" size={12} className="ic" />
              <span>
                {`自动提交没成功（${when(git.autoCommitError.at, { time: true })}）：`}
                {git.autoCommitError.text}
              </span>
            </div>
          )}
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
            <MenuItem key={j.id} icon={j.icon} glyph={j.ai && <AiIcon job={j.ai} size={16} fallback={j.icon} />} label={j.text} onClick={() => (setPop(null), j.onClick?.())} />
          ))}
        </Popover>
      )}
    </footer>
  )
}
