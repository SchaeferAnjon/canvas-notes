import { Icon } from '@cn/design'
import type { LucideIcon } from 'lucide-react'
import { FileText, Globe, LayoutGrid, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile, SearchHit } from '../shared/api'
import { titleOf } from '../shared/layout'
import { decodeUrl, toUrl } from './url'

export interface PaletteCommand {
  name: string
  hint?: string
  icon: LucideIcon
  keys?: string
  run(): void
}

type Row =
  | { kind: 'cmd'; cmd: PaletteCommand }
  | { kind: 'note'; path: string; snippet?: string; board: boolean }
  | { kind: 'url'; url: string }

/** ⌘K：搜笔记全文、打开网址、跑命令，一个框都能做 */
export function Palette(props: { notes: NoteFile[]; commands: PaletteCommand[]; onOpen(path: string): void; onUrl(url: string): void; onClose(): void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = q.trim()
    if (!t) return setHits([])
    let stale = false
    const timer = setTimeout(() => void window.cn.search(t).then((h) => !stale && setHits(h)), 80)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [q])

  const rows = useMemo<Row[]>(() => {
    const t = q.trim().toLowerCase()
    const isBoard = (p: string) => !!props.notes.find((n) => n.path === p)?.board
    if (!t) {
      const recent = [...props.notes].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5)
      return [
        ...recent.map((n) => ({ kind: 'note' as const, path: n.path, board: !!n.board })),
        ...props.commands.map((cmd) => ({ kind: 'cmd' as const, cmd })),
      ]
    }
    const out: Row[] = []
    const looksUrl = /^(https?:\/\/|[\w-]+(\.[\w-]+)+(\/|$))/i.test(t)
    if (looksUrl) out.push({ kind: 'url', url: toUrl(q) })
    out.push(...hits.map((h) => ({ kind: 'note' as const, path: h.path, snippet: h.snippet, board: isBoard(h.path) })))
    out.push(...props.commands.filter((c) => c.name.toLowerCase().includes(t)).map((cmd) => ({ kind: 'cmd' as const, cmd })))
    if (!looksUrl) out.push({ kind: 'url', url: toUrl(q) })
    return out
  }, [q, hits, props.notes, props.commands])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  function pick(r: Row | undefined) {
    if (!r) return
    props.onClose()
    if (r.kind === 'cmd') r.cmd.run()
    else if (r.kind === 'note') props.onOpen(r.path)
    else props.onUrl(r.url)
  }

  let lastGroup = ''
  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="pal" role="dialog" aria-label="搜索和命令" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in">
          <Icon of={Search} size={16} />
          <input
            autoFocus
            aria-label="搜索笔记、输入网址或命令"
            placeholder="搜笔记、打网址，或者输入要做的事"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(rows.length - 1, i + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), pick(rows[idx]))
              else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {q.trim() && hits.length === 0 && rows.every((r) => r.kind !== 'note') && <div className="pal-none">没有笔记里有「{q.trim()}」</div>}
          {rows.map((r, i) => {
            const group = r.kind === 'cmd' ? '命令' : r.kind === 'note' ? (q.trim() ? '笔记' : '最近打开') : '网页'
            const head = group !== lastGroup ? <div className="pal-g">{group}</div> : null
            lastGroup = group
            return (
              <div key={i}>
                {head}
                <button className={'pal-row' + (i === idx ? ' on' : '')} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)} role="option" aria-selected={i === idx}>
                  {r.kind === 'cmd' ? (
                    <>
                      <span className="ib">
                        <Icon of={r.cmd.icon} size={14} />
                      </span>
                      <span className="tx">
                        <b>{r.cmd.name}</b>
                        {r.cmd.hint && <span>{r.cmd.hint}</span>}
                      </span>
                      {r.cmd.keys && <kbd>{r.cmd.keys}</kbd>}
                    </>
                  ) : r.kind === 'note' ? (
                    <>
                      <span className="ib">
                        <Icon of={r.board ? LayoutGrid : FileText} size={14} />
                      </span>
                      <span className="tx">
                        <b>{titleOf(r.path)}</b>
                        <span>{r.snippet || r.path}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="ib">
                        <Icon of={Globe} size={14} />
                      </span>
                      <span className="tx">
                        <b>在右栏网页里打开</b>
                        <span>{decodeUrl(r.url)}</span>
                      </span>
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
        <div className="pal-foot">↑↓ 选择 · ↵ 打开 · esc 关闭</div>
      </div>
    </div>
  )
}

