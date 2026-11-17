import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type FileEntry, fileName, folderOfPath, matchFiles, progressDone } from '../../shared/files'
import { fileIcon } from '../Palette'
import { recentFiles, useVaultFiles } from '../files/store'

/** PDF 问到哪：问完一个勾，问了一些「5/10」，没开始什么都不写 */
export function Progress(props: { p: FileEntry['progress'] }) {
  const p = props.p
  if (!p || p.asked <= 0) return null
  if (progressDone(p)) return <Codicon name="check" size={12} className="done" aria-label="问完了" />
  return (
    <span className="num">
      {p.asked}/{p.pages}
    </span>
  )
}

/**
 * ⌘O 按名字跳（像 Obsidian 的 Quick Switcher）：和 ⌘F 同一个外壳。
 * 空着时列最近打开的；输入就按名字筛（字都出现就算），md、PDF、HTML、文件夹都在里面；PDF 右边是问到哪。
 */
/** onOpenFolder 不给时不列文件夹 */
export function QuickOpen(props: { onOpen(path: string): void; onOpenFolder?(path: string): void; onClose(): void }) {
  const all = useVaultFiles().files
  // 文件夹只列有首页的（课程/<课>、项目/<项目>、生活、写作），点了开首页
  const files = useMemo(() => all.filter((f) => f.kind !== 'dir' || !!props.onOpenFolder), [all, props.onOpenFolder])
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const { items, more } = useMemo(() => {
    const t = q.trim()
    if (!t) {
      const byPath = new Map(files.map((f) => [f.path, f]))
      const recent = recentFiles().flatMap((p) => byPath.get(p) ?? [])
      // 还没打开过几个：用最近改过的补上
      const fill = files.filter((f) => f.kind !== 'dir' && !recent.includes(f)).sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { items: [...recent, ...fill].slice(0, 10), more: 0 }
    }
    return matchFiles(files, t)
  }, [files, q])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  function pick(f: FileEntry | undefined) {
    if (!f) return
    props.onClose()
    if (f.kind === 'dir') props.onOpenFolder?.(f.path)
    else props.onOpen(f.path)
  }

  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="pal" role="dialog" aria-label="按名字跳到" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in">
          <Codicon name="go-to-file" size={18} />
          <input
            autoFocus
            aria-label="按名字跳到文件"
            placeholder="按名字跳到…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(items.length - 1, i + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), pick(items[idx]))
              else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {!q.trim() && items.length > 0 && <div className="pal-g">最近打开</div>}
          {q.trim() && !items.length && <div className="pal-none">没有叫「{q.trim()}」的文件</div>}
          {items.map((f, i) => (
            <button key={f.path} className={'pal-row sr' + (i === idx ? ' on' : '')} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => pick(f)}>
              <Codicon name={f.kind === 'dir' ? 'folder' : fileIcon(f.path)} size={16} className="i" />
              <span className="nm">{fileName(f.path)}</span>
              <span className="lc">{f.kind === 'dir' ? (folderOfPath(f.path) ? `${folderOfPath(f.path)} · 首页` : '首页') : folderOfPath(f.path)}</span>
              <span className="rt">
                <Progress p={f.progress} />
              </span>
            </button>
          ))}
          {more > 0 && <div className="pal-none more">{`还有${more}个，多打几个字`}</div>}
        </div>
        <div className="pal-foot">↑↓ 选择 · ↵ 打开 · esc 关闭</div>
      </div>
    </div>
  )
}
