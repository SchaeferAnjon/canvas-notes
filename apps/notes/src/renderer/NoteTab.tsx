import { Codicon } from '@cn/design'
import { fmValue, isMindmap } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { BoardView } from './BoardView'
import { PropsButton } from './mindmap/PropsButton'
import { NoteDoc, type SaveState, type ViewMode } from './note-doc'
import { ActBtn, noteRenamers, PageNote, TabActs } from './shell/TabActs'

export interface NoteTabProps {
  /** 标签 id：标签上改名时按它找到这一篇的改名 */
  tabId: string
  path: string
  active: boolean
  /** 刚新建：先不抢焦点，标签上在改名 */
  fresh: boolean
  /** 标签上正在改名：编辑器先不抢焦点 */
  renaming: boolean
  /** 标签条右端「更多」：改名、置顶、移到废纸篓（系统菜单） */
  onMenu(e: React.MouseEvent): void
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
  // 白板一打开就是白板样式：左栏的列表已经知道它是白板，不等读完文件（不然先闪一下文档，读完又跳回白板，
  // 这中间点的「文档」也会被盖掉）
  const [mode, setMode] = useState<ViewMode>(() => (props.notes.find((n) => n.path === path)?.board ? 'board' : 'doc'))
  /** 用户自己点过看法：读完文件后不再按 frontmatter 改 */
  const picked = useRef(false)
  const [text, setText] = useState<string | null>(null)
  const renaming = props.renaming
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
      if (fmValue(note.text, 'type') === 'board' && !picked.current) setMode('board')
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

  useEffect(() => {
    noteRenamers.set(props.tabId, rename)
    return () => void noteRenamers.delete(props.tabId)
  })

  async function rename(name: string) {
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
      <TabActs active={active}>
        <span className="txt" hidden={state === 'saved'} data-testid="save-state" data-state={state}>
          {state === 'saving' ? '正在保存' : state === 'saved' ? '' : '未保存'}
        </span>
        {readOnly && (
          <span className="txt warn" data-testid="page-note" title="文件里有软件读不懂的字节，为了不改坏它，不保存">
            只读
          </span>
        )}
        {!readOnly && text !== null && isMindmap(text) && path.startsWith('收件箱/') && (
          <PageNote>
            收件箱 · 今晚梦游时归类、起名
          </PageNote>
        )}
        {text !== null && <PropsButton text={text} notes={props.notes} readOnly={readOnly} onChange={(t) => doc.current?.setText(t)} />}
        <div className="seg" role="tablist" aria-label="看法">
          {(
            [
              ['board', 'layout', '白板'],
              ['doc', 'file-text', '文档'],
              ['source', 'code', '源文件'],
            ] as const
          ).map(([m, icon, name]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => ((picked.current = true), setMode(m))} role="tab" aria-selected={mode === m} aria-label={name} data-tip={name} data-side="below">
              <Codicon name={icon} size={14} />
              <span className="lb">{name}</span>
            </button>
          ))}
        </div>
        <ActBtn icon="ellipsis" label="更多" onClick={(e) => props.onMenu(e)} />
      </TabActs>
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
