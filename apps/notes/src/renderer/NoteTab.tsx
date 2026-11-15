import { Icon } from '@cn/design'
import { fmValue } from '@cn/format'
import { Code, FileText, LayoutGrid } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { BoardView } from './BoardView'
import { NoteDoc, type SaveState, type ViewMode } from './note-doc'

export interface NoteTabProps {
  path: string
  active: boolean
  /** 刚新建：标题直接进入改名 */
  fresh: boolean
  notes: NoteFile[]
  /** 右栏开着：白板缩到 0.8 */
  rightOpen: boolean
  /** 当前标签的编辑器，给剪藏和 AI 用 */
  onDoc(doc: NoteDoc | null): void
  /** 当前标签换了看法（剪藏工具条跟着变） */
  onMode(mode: ViewMode): void
  onOpenPath(path: string, fresh?: boolean): void
  onRenamed(newPath: string): void
  onSaved(): void
  onNotice(text: string): void
  onOpenLink(target: string): void
}

export function NoteTab(props: NoteTabProps) {
  const { path, active, fresh } = props
  const host = useRef<HTMLDivElement>(null)
  const doc = useRef<NoteDoc | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const [readOnly, setReadOnly] = useState(false)
  const [mode, setMode] = useState<ViewMode>('doc')
  const [text, setText] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(fresh)
  const cb = useRef(props)
  cb.current = props

  // 只在这个标签打开时建一次编辑器；改名不重建
  const firstPath = useRef(path)
  const wasFresh = useRef(fresh)
  useEffect(() => {
    let cancelled = false
    let d: NoteDoc | null = null
    let off = () => {}
    void window.cn.readNote(firstPath.current).then((note) => {
      if (cancelled) return
      setReadOnly(note.readOnly)
      d = new NoteDoc(host.current!, note, {
        onState: setState,
        onNotice: (t) => cb.current.onNotice(t),
        onSaved: () => cb.current.onSaved(),
        onOpenLink: (t) => cb.current.onOpenLink(t),
        onText: setText,
      })
      doc.current = d
      setText(note.text)
      if (fmValue(note.text, 'type') === 'board') setMode('board')
      if (!wasFresh.current) d.view.focus()
      off = window.cn.onNoteChanged((p, text) => {
        if (d && p === d.path) void d.applyRemote(text)
      })
    })
    return () => {
      cancelled = true
      off()
      const x = d
      if (x) void x.save().finally(() => x.destroy())
    }
  }, [])

  useEffect(() => {
    if (doc.current) doc.current.path = path
  }, [path])

  useEffect(() => {
    doc.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    if (active && !renaming && mode !== 'board') doc.current?.view.focus()
  }, [active, renaming, mode])

  useEffect(() => {
    if (active) cb.current.onDoc(doc.current)
  }, [active, text === null])

  useEffect(() => {
    if (active) cb.current.onMode(mode)
  }, [active, mode])

  async function rename(name: string) {
    setRenaming(false)
    if (!name.trim() || name.trim() === titleOf(path)) return
    try {
      // 第一行是「# 旧名」就跟着改成新名
      const d = doc.current
      const old = titleOf(path)
      if (d && d.text.startsWith(`# ${old}\n`)) d.setText(`# ${name.trim()}\n` + d.text.slice(old.length + 3))
      await NoteDoc.saveAll()
      const p = await window.cn.renameNote(path, name)
      cb.current.onRenamed(p)
      if (d && !d.readOnly) {
        d.view.focus()
        d.view.dispatch({ selection: { anchor: d.view.state.doc.length } })
      }
    } catch (e) {
      cb.current.onNotice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <section className="pane" hidden={!active} data-path={path}>
      <div className="tool">
        {renaming ? (
          <input
            className="title-input"
            aria-label="笔记名字"
            defaultValue={titleOf(path)}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => void rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              // 拦住这个键，不然焦点回到正文后回车会打进正文
              if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = titleOf(path)
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <h1 title="点一下改名" onClick={() => !readOnly && setRenaming(true)}>
            {titleOf(path)}
          </h1>
        )}
        <span className="meta">
          {mode === 'board' ? '白板' : '文档'} · {path}
          {readOnly && ' · 只读：文件里有软件读不懂的字节，为了不改坏它，不保存'}
        </span>
        <span className="sp" />
        <span className="meta" data-testid="save-state" data-state={state}>
          {state === 'saved' ? '' : state === 'saving' ? '正在保存' : '未保存'}
        </span>
        <div className="seg" role="tablist" aria-label="看法">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')} role="tab" aria-selected={mode === 'board'}>
            <Icon of={LayoutGrid} size={14} />
            白板
          </button>
          <button className={mode === 'doc' ? 'on' : ''} onClick={() => setMode('doc')} role="tab" aria-selected={mode === 'doc'}>
            <Icon of={FileText} size={14} />
            文档
          </button>
          <button
            className={mode === 'source' ? 'on' : ''}
            onClick={() => setMode('source')}
            role="tab"
            aria-selected={mode === 'source'}
          >
            <Icon of={Code} size={14} />
            源文件
          </button>
        </div>
      </div>
      <div className="body" hidden={mode === 'board'}>
        <div className={'doc ' + mode} ref={host} />
      </div>
      {mode === 'board' && text !== null && (
        <BoardView
          text={text}
          notePath={path}
          notes={props.notes}
          scale={props.rightOpen ? 0.8 : 1}
          readOnly={readOnly}
          onChange={(t) => doc.current?.setText(t)}
          onUndo={() => doc.current?.undo()}
          onRedo={() => doc.current?.redo()}
          onOpen={(p) => cb.current.onOpenPath(p)}
          onNotice={(t) => cb.current.onNotice(t)}
          onCreateSubBoard={async () => {
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
            const p = await window.cn.createBoard(dir, '未命名白板')
            cb.current.onOpenPath(p, true)
            return titleOf(p)
          }}
        />
      )}
    </section>
  )
}
