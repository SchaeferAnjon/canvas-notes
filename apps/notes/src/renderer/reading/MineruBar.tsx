/**
 * PDF 精读增强（MinerU）在 PDF 标签上露面的两处（偏好「用到PDF再提示装MinerU」）：
 * - MineruBar：哪都找不到 MinerU 时，PDF 工具条下面一行提示（不弹框）：能做什么、下载和占盘多大、许可证、「安装」「不再提示」；
 *   点了安装这一行变成进度（哪一步、百分比、停下），没装成写原因和「重试」。找到了能用的就什么都不出。
 * - MineruTool：标签条右端一行小字：后台识别时「增强识别 · 认版面 40%」，没成功时「增强识别没成功 · 重试」（悬停看原因）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { MINERU_DISK, MINERU_DOWNLOAD, MINERU_LICENSE_URL, type MineruJob, type MineruStatus, stageName } from '../../shared/mineru'

let cur: MineruStatus | null = null
const subs = new Set<(s: MineruStatus) => void>()
let wired = false
function wire() {
  if (wired) return
  wired = true
  window.cnMineru.onStatus((s) => {
    cur = s
    for (const f of subs) f(s)
  })
}

export function useMineruStatus(): MineruStatus | null {
  const [s, setS] = useState<MineruStatus | null>(cur)
  useEffect(() => {
    wire()
    subs.add(setS)
    void window.cnMineru.status().then((x) => {
      // 主进程推来的更新可能比这次回答先到：只在还没有时用它
      if (!cur || x.find) {
        cur = x
        for (const f of subs) f(x)
      }
    })
    return () => void subs.delete(setS)
  }, [])
  return s
}

/** 装的四步各写什么（下面跟着那一步命令的最后一行输出） */
const STEP = { uv: '下载安装工具uv', python: '准备Python环境', packages: '下载MinerU和PyTorch（约1.3 GB）', models: '下载识别模型（约850 MB）' }

const installing = (s: MineruStatus) => ['uv', 'python', 'packages', 'models'].includes(s.install.phase)

export function MineruBar({ status }: { status: MineruStatus | null }) {
  if (!status) return null
  const { find, install } = status
  if (installing(status)) {
    return (
      <div className="mubar busy" role="status" aria-label="PDF 精读增强" data-testid="mineru-bar" data-state="installing">
        <Codicon name="loading" size={14} className="spin ic" />
        <b>正在装PDF精读增强</b>
        <span className="step">{STEP[install.phase as keyof typeof STEP]}</span>
        <span className="ln out truncate" title={install.line}>
          {install.line}
        </span>
        <span className="sp" />
        <span className="pct num">{install.percent}%</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void window.cnMineru.stopInstall()}>
          停下
        </button>
        <i className="bar" style={{ width: `${install.percent}%` }} />
      </div>
    )
  }
  if (find?.state !== 'missing' || status.dismissed) return null
  const failed = install.phase === 'failed'
  return (
    <div className={'mubar' + (failed ? ' err' : '')} role="note" aria-label="PDF 精读增强" data-testid="mineru-bar" data-state={failed ? 'failed' : 'hint'}>
      <Codicon name={failed ? 'warning' : 'sparkle'} size={14} className="ic" />
      {failed ? (
        <span className="ln truncate" title={install.error ?? ''}>
          <b>PDF精读增强没装成</b>
          {/* 原因句自己带冒号（「下载不下来：检查网络后点「重试」」）：这里用逗号接，一句一个冒号 */}
          {install.error ? `，${install.error}` : ''}
        </span>
      ) : (
        <>
          <span className="ln truncate" title={`表格、公式、双栏和配图认得更准 · 下载${MINERU_DOWNLOAD}，占盘${MINERU_DISK}`}>
            <b>{find.resume ? 'PDF精读增强上次没装完' : '装上PDF精读增强'}</b>
            ，表格、公式、双栏和配图认得更准
          </span>
          <span className="size num">
            {`下载${MINERU_DOWNLOAD} · 占盘${MINERU_DISK}`}
          </span>
          <a className="lic" href={MINERU_LICENSE_URL} onClick={(e) => (e.preventDefault(), void window.cnMenu.openExternal(MINERU_LICENSE_URL))}>
            MinerU许可证
          </a>
        </>
      )}
      <span className="sp" />
      <button type="button" className="btn btn-sm btn-primary" title={`下载${MINERU_DOWNLOAD}，占盘${MINERU_DISK}`} onClick={() => void window.cnMineru.install()}>
        <Codicon name={failed ? 'refresh' : 'cloud-download'} size={14} />
        {failed ? '重试' : find.resume ? '接着装' : '安装'}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void window.cnMineru.dismiss()}>
        不再提示
      </button>
    </div>
  )
}

/** 标签条右端的一行小字（没有要说的返回 null） */
export function MineruTool({ job, onRetry }: { job: MineruJob | null; onRetry(): void }) {
  if (!job || job.status === 'done') return null
  if (job.status === 'failed')
    return (
      <span className="txt mutool err" data-testid="mineru-tool" data-state="failed" data-tip={job.error ? `原因：${job.error} · 先照常用PDF自带的文字` : undefined} data-side="below">
        增强识别没成功 ·{' '}
        <button type="button" className="lnk" onClick={onRetry}>
          重试
        </button>
      </span>
    )
  return (
    <span className="txt mutool" data-testid="mineru-tool" data-state={job.status} data-tip="PDF精读增强在后台认表格、公式和图，认完自动换上" data-side="below">
      <Codicon name="loading" size={12} className="spin" />
      <span className="mt truncate">{`增强识别${job.status === 'queued' ? ' · 排队' : job.stage ? ` · ${stageName(job.stage)}` : '…'}`}</span>
      {job.status === 'running' && job.stage && job.percent !== null && <span className="num mp">{job.percent}%</span>}
    </span>
  )
}
