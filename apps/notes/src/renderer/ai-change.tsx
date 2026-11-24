/**
 * AI 这一轮的改动卡（DESIGN.md「AI 改动预览」）：改了几个文件 +a −b · 提交号 · 撤回；读 PDF 的回答下面也用它（没有「在历史里看」时不放那颗）。
 * 改名、挪动的一篇只占一行「旧名 → 新名」（Git 没认出改名时旧路径那行不单列，加减行数也不写：那是整篇删了又加的数）。
 * 每个文件行点了就地展开这次的改动（改动卡展开，照 Orca 的样子、画法用历史那套 TextDiff）：行号、改的行淡绿淡红、没改的折起，
 * 新建的整篇绿、删掉的整篇红；限高能滚，再点收起；展开时行右边「打开这篇」「拷贝」。只改了一个文件时默认展开（限高里露前十几行）。
 */
import { Codicon } from '@cn/design'
import { UndoButton } from '@cn/ai-chat/answer-bar'
import { useEffect, useMemo, useState } from 'react'
import type { StoredMsg } from '../shared/agent'
import type { CommitInfo } from '../shared/api'
import type { DiffEntry, DiffResult } from '../shared/diff'
import { t } from '../shared/i18n'
import { Images, TextDiff } from './diff/DiffTab'

type Change = NonNullable<StoredMsg['change']>

/** 存下来的小标是中文身份（新 / 改 / 改名 / 移动 / 删），画的时候翻 */
function kindLabel(k: string): string {
  // 不翻：存下来的身份，和它比
  if (k === '新') return t('新', { ctx: '改动卡' })
  // 不翻：存下来的身份，和它比
  if (k === '改') return t('改', { ctx: '改动卡' })
  // 不翻：存下来的身份，和它比
  if (k === '改名') return t('改名', { ctx: '改动卡' })
  // 不翻：存下来的身份，和它比
  if (k === '移动') return t('移动', { ctx: '改动卡' })
  // 不翻：存下来的身份，和它比
  if (k === '删') return t('删', { ctx: '改动卡' })
  return k
}

export function ChangeBlock({ change, onRevert, onHistory, onOpen }: { change: Change; onRevert(): void; onHistory?(): void; onOpen?(path: string): void }) {
  const c: CommitInfo = change.commit
  const moved = change.moved ?? {}
  const olds = new Set(Object.values(moved))
  const listed = new Set(c.files.map((f) => f.path))
  const files = c.files.filter((f) => !olds.has(f.path))
  // Git 自己认出了改名（旧路径不在单子上）：加减行数是真的改了几行；没认出时那是整篇删了又加，不写
  const counts = (p: string) => !moved[p] || !listed.has(moved[p]!)
  const added = files.reduce((n, f) => n + (counts(f.path) ? f.added : 0), 0)
  const removed = files.reduce((n, f) => n + (counts(f.path) ? f.removed : 0), 0)
  // 只改了一个文件：默认展开（撤回了的不展开）
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(files.length === 1 && !change.reverted ? [files[0]!.path] : []))
  // 这次提交改了什么：第一次展开时读一次，之后都用这一份
  const [res, setRes] = useState<DiffResult | { error: string } | null>(null)
  const want = open.size > 0
  useEffect(() => {
    if (!want || res) return
    let stale = false
    window.cn.diffFiles({ kind: 'commit', hash: c.hash }).then(
      (r) => !stale && setRes(r),
      (e: unknown) => !stale && setRes({ error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }),
    )
    return () => {
      stale = true
    }
  }, [want, res, c.hash])
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  return (
    <div className={'aichg' + (change.reverted ? ' reverted' : '')} data-testid="ai-change">
      <div className="hd">
        <Codicon name="git-commit" size={14} />
        {change.reverted ? t('已撤回') : t('改了{n}个文件', { n: files.length })}
        {!change.reverted && (added > 0 || removed > 0) && (
          <span className="tot">
            {added > 0 && <span className="add">+{added}</span>}
            {removed > 0 && <span className="del">−{removed}</span>}
          </span>
        )}
        <code>{(change.reverted ?? c).hash.slice(0, 7)}</code>
        <span className="sp" />
        {/* 撤回：各处同一颗（无边框、discard 图标，task-eavzx） */}
        {!change.reverted && <UndoButton label={t('撤回')} onClick={onRevert} />}
      </div>
      {files.map((f) => {
        const from = moved[f.path]
        const on = open.has(f.path)
        const entry = res && !('error' in res) ? res.files.find((e) => e.path === f.path) : undefined
        return (
          <div key={f.path} className={'fi' + (on ? ' on' : '')}>
            <div className={'fr' + (from ? ' renamed' : '')}>
              <button className="frb" aria-expanded={on} aria-label={on ? t('收起改动：{path}', { path: f.path }) : t('展开改动：{path}', { path: f.path })} onClick={() => toggle(f.path)}>
                <Codicon name={on ? 'chevron-down' : 'chevron-right'} size={14} className="tw" />
                {from ? (
                  <span className="truncate" title={`${from} → ${f.path}`}>
                    <span className="was">{from}</span>
                    <Codicon name="arrow-right" size={12} className="to" />
                    {f.path}
                  </span>
                ) : (
                  <FilePath path={f.path} />
                )}
                {/* 不翻：没记小标时照加减行数认的身份 */}
                <span className="k">{kindLabel(change.kinds[f.path] ?? (f.removed === 0 && f.added > 0 ? '新' : '改'))}</span>
                {counts(f.path) && <span className="num add">+{f.added}</span>}
                {counts(f.path) && <span className="num del">−{f.removed}</span>}
              </button>
            </div>
            {on && <FileDiff res={res} entry={entry} onOpen={onOpen} />}
          </div>
        )
      })}
      <div className="ft">
        {change.reverted ? t('又做了一次反向提交，文件回到了AI改之前') : change.only ? t('自动提交收进去的') : t('已提交到main')}
        {onHistory && (
          <button className="lnk" onClick={onHistory}>
            {t('在历史里看')}
          </button>
        )}
      </div>
    </div>
  )
}

/** 展开的那块顶上一条右端两颗：打开这篇（现在库里的；挪走、删了灰掉）· 拷贝（这次改完的全文；删掉的拷删之前的），拷了 1.5 秒换成对勾 */
function FileActs({ f, onOpen }: { f: DiffEntry; onOpen?(path: string): void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  const text = f.kind === 'md' || f.kind === 'text' || f.kind === 'html' ? (f.after ?? f.before) : null
  return (
    <span className="acts">
      {onOpen && (
        <button className="ib" aria-label={t('打开这篇')} data-tip={f.exists ? t('打开这篇') : t('这篇现在已经不在原处了（挪走或删了）')} disabled={!f.exists} onClick={() => onOpen(f.path)}>
          <Codicon name="go-to-file" size={14} />
        </button>
      )}
      {text !== null && (
        <button className="ib" aria-label={t('拷贝')} data-tip={copied ? t('已拷贝') : t('拷贝这一版全文')} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          <Codicon name={copied ? 'check' : 'copy'} size={14} />
        </button>
      )}
    </span>
  )
}

/**
 * 一个文件这次的改动：和文件行连成一块淡底。顶上一条左边一句人话（新文件 · 3行、改了 2 处…），右端「打开这篇」「拷贝」；
 * 下面限高能滚。新建的当成从空白加上来的（整篇绿），删掉的当成删到空白（整篇红），合一一列、源码样子；挪了没改的写「内容没变」
 */
function FileDiff({ res, entry, onOpen }: { res: DiffResult | { error: string } | null; entry: DiffEntry | undefined; onOpen?(path: string): void }) {
  const f = useMemo<DiffEntry | undefined>(() => {
    if (!entry) return undefined
    if (entry.before === null && entry.after !== null && entry.kind !== 'image') return { ...entry, before: '' }
    if (entry.after === null && entry.before !== null && entry.kind !== 'image') return { ...entry, after: '' }
    return entry
  }, [entry])
  if (!res) return <div className="fx-msg">{t('读取中…')}</div>
  if ('error' in res) return <div className="fx-msg">{t('读不出这次改动：{err}', { err: res.error })}</div>
  if (!f) return <div className="fx-msg">{t('这次提交里读不到这个文件的改动')}</div>
  const same = f.before !== null && f.before === f.after
  return (
    <div className={'fx' + (entry!.status === 'new' ? ' is-new' : '')} data-testid="ai-change-diff">
      <div className="fx-bar">
        <span className="truncate">{same ? t('内容没变') : f.summary}</span>
        <FileActs f={entry!} onOpen={onOpen} />
      </div>
      {f.kind === 'binary' ? (
        <div className="fx-msg">{t('这种文件在这里看不了，打开看')}</div>
      ) : same ? null : (
        <div className="fx-scroll">{f.kind === 'image' ? <Images f={f} res={res} /> : <TextDiff f={f} res={res} look="source" layout="unified" />}</div>
      )}
    </div>
  )
}

/**
 * 一条库内路径：文件夹 --t3 在前、放不下先省略这一截，文件名 --t1 尽量整个露着（DESIGN.md「AI 改动预览」每个文件一行写文件名）；
 * 悬停看整条。改动块的文件行、写成文章草稿卡的路径行用
 */
export function FilePath({ path, code }: { path: string; code?: boolean }) {
  const at = path.lastIndexOf('/')
  const Tag = code ? 'code' : 'span'
  return (
    <Tag className="fpath" title={path}>
      {at > 0 && <span className="dir">{path.slice(0, at + 1)}</span>}
      <span className="fn">{path.slice(at + 1)}</span>
    </Tag>
  )
}
