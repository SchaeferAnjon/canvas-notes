/**
 * 一个文件夹的首页（设计稿 design-mindmap 方向 B 第 9 节）：封面 160 高、图标方块和宋体标题、组件网格。
 * 编辑时能拖、换宽、收起、删除、从组件库加、改「按条件列出」的条件；「⋯」里设为模板、恢复默认。
 * 页面只是看法：怎么改都不动文件夹里的文件。复用主页的 home.css。
 */
import { Codicon } from '@cn/design'
import { ActBtn, TabActs } from '../shell/TabActs'
import { useEffect, useMemo, useState } from 'react'
import type { DoubtItem } from '@cn/format'
import type { NoteFile } from '../../shared/api'
import { DEFAULT_HOME } from '../../shared/home'
import {
  addWidget,
  type Cond,
  COLORS,
  folderKind,
  type FolderHome,
  FWIDGETS,
  hideW,
  ICONS,
  KIND_LABEL,
  leadOf,
  moveW,
  type PropFile,
  removeWidget,
  resizeW,
  setWidget,
  showW,
  sizeOfW,
  wInfo,
} from '../../shared/folder-home'
import { coverImage } from '../covers'
import type { DreamPreview } from '../dream/preview'
import { CoverGallery } from '../HomeView'
import '../home.css'
import { openCapture } from '../mindmap/capture-store'
import { CondEditor, WidgetLibrary } from './dialogs'
import { folderIcon, widgetIcon } from './icons'
import './folder-home.css'
import { CaptureAction, CondBody, condResult, type WCtx, WidgetBody } from './widgets'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function FolderHomeView(props: {
  folder: string
  /** 刚新建的：直接进编辑，标题是能改的输入框 */
  fresh?: boolean
  notes: NoteFile[]
  pv: DreamPreview
  version: number
  onOpen(path: string): void
  onOpenAt(pdf: string, page: number): void
  onOpenDoubts(folder: string): void
  onOpenAll(): void
  /** 底部提示；undo 给了就带「撤回」 */
  onNotice(t: string, undo?: () => void): void
  /** 新建的空文件夹改了名 */
  onRenamed(folder: string): void
}) {
  const { folder, pv } = props
  const kind = folderKind(folder)!
  const title = folder.split('/').pop()!
  const [home, setHome] = useState<FolderHome | null>(null)
  const [files, setFiles] = useState<PropFile[]>([])
  const [doubts, setDoubts] = useState<DoubtItem[]>([])
  const [editing, setEditing] = useState(!!props.fresh)
  const [gallery, setGallery] = useState(false)
  /** 正在调封面位置：拖动时的临时位置 */
  const [adjustY, setAdjustY] = useState<number | null>(null)
  const [menu, setMenu] = useState<null | 'more' | 'icon' | 'tpl' | 'reset'>(null)
  const [lib, setLib] = useState(false)
  const [cond, setCond] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; before?: string | null } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    void window.cnFolder.get(folder).then((r) => setHome(r.home), (e) => props.onNotice(errText(e)))
  }, [folder])
  // 预览时：梦游要挪进这个文件夹的也列出来，标「新」（属性从收件箱那篇读）
  const incoming = useMemo(() => (pv.on ? pv.moves.filter((m) => m.to.startsWith(folder + '/')) : []), [pv.on, pv.moves, folder])
  useEffect(() => {
    let stale = false
    void (async () => {
      const own = await window.cnFolder.files(folder, 'folder')
      let extra: PropFile[] = []
      if (incoming.length) {
        const all = await window.cnFolder.files(folder, 'vault')
        extra = incoming.map((m) => ({ ...(all.find((f) => f.path === m.from) ?? { mtimeMs: Date.now(), props: {} }), path: m.to }))
      }
      if (!stale) setFiles([...extra, ...own])
    })().catch((e) => props.onNotice(errText(e)))
    return () => {
      stale = true
    }
  }, [folder, props.version, incoming])
  // 我的疑惑：PDF 那边按讲汇总的同一份
  useEffect(() => {
    if (kind !== 'course') return
    let stale = false
    window.cnReading.doubts(folder).then((v) => !stale && setDoubts(v.items), (e) => props.onNotice(errText(e)))
    return () => {
      stale = true
    }
  }, [folder, kind, props.version])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])

  if (!home) return <section className="pane" />
  const save = (h: FolderHome) => {
    setHome(h)
    void window.cnFolder.set(folder, h).catch((e) => props.onNotice(errText(e)))
  }
  const fresh = new Set(incoming.map((m) => m.to))
  const ctx = (id: string): WCtx => ({ folder, files, notes: props.notes, fresh, editing, onOpen: (p) => props.onOpen(pv.realPath(p)), onOpenAt: props.onOpenAt, onDoubts: () => props.onOpenDoubts(folder), doubts, onAll: props.onOpenAll, onCapture: () => openCapture({ course: title }), save, home, id })
  const inFolder = files.filter((f) => f.path.startsWith(folder + '/'))
  const lead = leadOf(kind, inFolder)
  const coverY = adjustY ?? home.coverY
  const IconC = folderIcon(home.icon)
  const tplName = kind === 'course' ? '课程模板' : kind === 'project' ? '项目模板' : null

  const add = (type: (typeof FWIDGETS)[number]['type'], c?: Cond) => {
    const r = addWidget(home, type, kind, c)
    save(r.home)
    setFlash(r.id)
  }

  return (
    <section className={'pane homev fhome home-' + home.style + (editing ? ' editing' : '') + (pv.on ? ' previewing' : '')} data-testid="folder-home" data-folder={folder}>
      <div className="body">
        <div className="hscroll" style={{ ['--cover-img' as string]: coverImage(home.cover), ['--cover-y' as string]: `${coverY}%` }}>
          <div
            className={'cover' + (adjustY !== null ? ' adjust' : '') + (gallery ? ' keep' : '')}
            data-testid="folder-cover"
            onPointerDown={(e) => {
              if (adjustY === null || (e.target as HTMLElement).closest('button')) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const startY = e.clientY
              const from = adjustY
              const h = e.currentTarget.offsetHeight
              const move = (ev: PointerEvent) => setAdjustY(Math.min(100, Math.max(0, Math.round(from - ((ev.clientY - startY) / h) * 100))))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            {adjustY !== null && <span className="hint">上下拖动图片，挑一个位置</span>}
            <div className="cacts">
              {adjustY === null ? (
                <>
                  <button className="cbtn" onClick={() => setGallery((v) => !v)} aria-expanded={gallery}>
                    <Codicon name="file-media" size={14} />
                    换封面
                  </button>
                  <button className="cbtn" onClick={() => (setGallery(false), setAdjustY(home.coverY))}>
                    <Codicon name="arrow-swap" size={14} />
                    调整位置
                  </button>
                </>
              ) : (
                <>
                  <button className="cbtn" onClick={() => setAdjustY(null)}>
                    取消
                  </button>
                  <button className="cbtn pri" onClick={() => (save({ ...home, coverY: adjustY }), setAdjustY(null))}>
                    保存位置
                  </button>
                </>
              )}
            </div>
            {gallery && <CoverGallery cfg={{ ...DEFAULT_HOME, cover: home.cover, coverY: home.coverY }} onPick={(c) => save({ ...home, cover: c.cover })} onNotice={props.onNotice} onClose={() => setGallery(false)} />}
          </div>
          <div className="hwrap">
            <div className="fh-title">
              <span className={'fh-ico' + (home.color ? ' colored' : '')} style={home.color ? { background: home.color } : undefined}>
                <Codicon name={IconC} size={26} />
              </span>
              <div className="fh-tx">
                {props.fresh ? (
                  <input
                    className="fh-name"
                    aria-label="文件夹名字"
                    defaultValue={title}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') (e.currentTarget.value = title), e.currentTarget.blur()
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim()
                      if (!name || name === title) return
                      window.cnFolder.rename(folder, name).then(props.onRenamed, (err) => {
                        props.onNotice(errText(err))
                        e.target.value = title
                      })
                    }}
                  />
                ) : (
                  <h2>{title}</h2>
                )}
                <p>{lead}</p>
              </div>
              <span className="sp" />
              <TabActs active>
              {editing ? (
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(false)}>
                  <Codicon name="check" size={14} />
                  完成
                </button>
              ) : (
                <ActBtn icon="edit" label="编辑首页" onClick={() => setEditing(true)} />
              )}
              <div className="fh-menu">
                <ActBtn icon="ellipsis" label="更多" aria-expanded={menu !== null} onClick={() => setMenu(menu ? null : 'more')} />
                {menu === 'more' && (
                  <div className="fh-pop menu" role="menu" aria-label="首页的更多">
                    {tplName && (
                      <button role="menuitem" onClick={() => setMenu('tpl')}>
                        <Codicon name="bookmark" size={14} />
                        设为{tplName}
                      </button>
                    )}
                    <button role="menuitem" onClick={() => setMenu('reset')}>
                      <Codicon name="discard" size={14} />
                      恢复默认
                    </button>
                    <button role="menuitem" onClick={() => (setMenu(null), setEditing(true))}>
                      <Codicon name="layout" size={14} />
                      编辑首页
                    </button>
                  </div>
                )}
                {(menu === 'tpl' || menu === 'reset') && (
                  <div className="fh-pop confirm" role="dialog" aria-label={menu === 'tpl' ? `设为${tplName}？` : `恢复成默认的${KIND_LABEL[kind]}首页？`}>
                    <h4>{menu === 'tpl' ? `设为${tplName}？` : `恢复成默认的${KIND_LABEL[kind]}首页？`}</h4>
                    <p>
                      {menu === 'tpl'
                        ? `以后新建的${KIND_LABEL[kind]}文件夹，首页都用这一页的组件、排法和外观。已有的不变。存在 ${kind === 'course' ? '课程' : '项目'}/.首页模板.json。`
                        : '组件、排法、外观回到默认的样子（有模板就用模板）。这只是一页看法：文件一个不动。'}
                    </p>
                    <div className="act">
                      <button className="btn btn-ghost btn-sm" onClick={() => setMenu(null)}>
                        取消
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          const which = menu
                          setMenu(null)
                          try {
                            if (which === 'tpl') {
                              await window.cnFolder.set(folder, home)
                              await window.cnFolder.setTemplate(folder)
                              props.onNotice(`设为${tplName}了 · 以后新建的${KIND_LABEL[kind]}用这个样子`)
                            } else {
                              const prev = home
                              setHome(await window.cnFolder.reset(folder))
                              props.onNotice('恢复成默认的样子了 · 文件一个没动', () => save(prev))
                            }
                          } catch (e) {
                            props.onNotice(errText(e))
                          }
                        }}
                      >
                        {menu === 'tpl' ? '设为模板' : '恢复默认'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </TabActs>
            </div>
            {editing && (
              <div className="fh-ebar" role="toolbar" aria-label="编辑首页">
                <span className="k">样式</span>
                <div className="seg">
                  <button className={home.style === 'a' ? 'on' : ''} onClick={() => save({ ...home, style: 'a' })}>
                    A 封面
                  </button>
                  <button className={home.style === 'b' ? 'on' : ''} onClick={() => save({ ...home, style: 'b' })}>
                    B 整页背景
                  </button>
                </div>
                <span className="bar" />
                <button className="btn btn-sm" onClick={() => (setMenu(null), setGallery(true), document.querySelector('.fhome .hscroll')?.scrollTo({ top: 0, behavior: 'smooth' }))}>
                  <Codicon name="file-media" size={14} />
                  换封面
                </button>
                <div className="fh-menu">
                  <button className="btn btn-sm" onClick={() => setMenu(menu === 'icon' ? null : 'icon')}>
                    <Codicon name="symbol-color" size={14} />
                    图标和颜色
                  </button>
                  {menu === 'icon' && (
                    <div className="fh-pop icons" role="dialog" aria-label="图标和颜色">
                      <div className="ig">
                        {ICONS.map((n) => (
                          <button key={n} className={home.icon === n ? 'on' : ''} aria-label={n} onClick={() => save({ ...home, icon: n })}>
                            <Codicon name={folderIcon(n)} size={16} />
                          </button>
                        ))}
                      </div>
                      <div className="cg">
                        {COLORS.map((c) => (
                          <button key={c} className={home.color === c ? 'on' : ''} aria-label={c} style={{ background: c }} onClick={() => save({ ...home, color: c })} />
                        ))}
                        <button className={'none' + (home.color ? '' : ' on')} aria-label="不要颜色" onClick={() => save({ ...home, color: null })}>
                          <Codicon name="circle-slash" size={12} />
                        </button>
                      </div>
                      <p>颜色只上图标方块和左栏的小方块，收着饱和度；不选就是灰的。不用首字母。</p>
                    </div>
                  )}
                </div>
                <span className="bar" />
                <button className="btn btn-sm" onClick={() => setLib(true)}>
                  <Codicon name="add" size={14} />
                  加组件
                </button>
                <span className="sp" />
                <span className="hint">设为模板、恢复默认在「完成」旁的「⋯」</span>
              </div>
            )}
            <div className="wgrid">
              {home.order.map((id) => {
                const w = home.widgets[id]!
                const info = wInfo(w.type)
                const size = sizeOfW(home, id)
                const total = w.cond ? condResult(ctx(id), w.cond).length : 0
                return (
                  <div key={id} data-widget={id} data-testid={`fw-${id}`} className={`wd s${size}${drag?.id === id ? ' dragging' : ''}${drag?.before === id ? ' drop-before' : ''}${flash === id ? ' flash' : ''}`}>
                    {editing && (
                      <>
                        <button
                          className="wgrip"
                          aria-label={`拖动${info.name}`}
                          onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), setDrag({ id }))}
                          onPointerMove={(e) => {
                            if (!drag) return
                            const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-widget]')?.dataset.widget
                            setDrag({ id: drag.id, before: over && over !== drag.id ? over : undefined })
                          }}
                          onPointerUp={() => {
                            if (drag?.before) save(moveW(home, drag.id, drag.before))
                            setDrag(null)
                          }}
                        >
                          <Codicon name="gripper" size={14} />
                        </button>
                        <div className="wedit">
                          {w.cond && (
                            <button onClick={() => setCond(id)} aria-label="条件" title="改条件">
                              <Codicon name="settings" size={12} />
                              <span className="lbl">条件</span>
                            </button>
                          )}
                          <button onClick={() => save(resizeW(home, id))} aria-label={size === 1 ? '变宽' : size === 2 ? '整行' : '变窄'} title={size === 1 ? '变宽' : size === 2 ? '整行' : '变窄'}>
                            <Codicon name={size === 4 ? 'screen-normal' : 'arrow-both'} size={12} />
                            <span className="lbl">{size === 1 ? '变宽' : size === 2 ? '整行' : '变窄'}</span>
                          </button>
                          <button onClick={() => save(hideW(home, id))} aria-label="收起" title="收起到下面的抽屉">
                            <Codicon name="screen-normal" size={12} />
                            <span className="lbl">收起</span>
                          </button>
                          <button
                            aria-label={`删掉${w.cond?.name ?? info.name}`}
                            title="删掉这个组件（文件不动）"
                            onClick={() => {
                              save(removeWidget(home, id))
                              props.onNotice(`删了「${w.cond?.name ?? info.name}」组件 · 文件一个没动`, () => save(home))
                            }}
                          >
                            <Codicon name="trash" size={12} />
                          </button>
                        </div>
                      </>
                    )}
                    <div className="wk">
                      <Codicon name={widgetIcon(w.type)} size={14} />
                      <span className="truncate">{w.type === 'list' ? w.cond!.name : info.name}</span>
                      {total > 0 && <span className="n num">{total}</span>}
                      <span className="sp" />
                      {w.type === 'notes' && !editing && <CaptureAction onCapture={() => openCapture({ course: title })} />}
                    </div>
                    <WidgetBody c={ctx(id)} w={w} />
                  </div>
                )
              })}
            </div>
            {editing && (
              <div className="tray">
                <div className="hd">收起来的组件，点一下放回首页</div>
                <div className="items">
                  {home.hidden.length === 0 && <span className="none">都在首页上了</span>}
                  {home.hidden.map((id) => (
                    <button key={id} className="ti" onClick={() => save(showW(home, id))}>
                      <Codicon name={widgetIcon(home.widgets[id]!.type)} size={14} />
                      {home.widgets[id]!.cond?.name ?? wInfo(home.widgets[id]!.type).name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {lib && <WidgetLibrary title={title} home={home} kind={kind} onAdd={add} onClose={() => setLib(false)} />}
      {cond && home.widgets[cond] && (
        <CondEditor
          initial={home.widgets[cond]!.cond!}
          found={(c) => condResult(ctx(cond), c).length}
          preview={(c) => (
            <div className="wd s2">
              <div className="wk">
                <Codicon name={widgetIcon(home.widgets[cond]!.type)} size={14} />
                <span className="truncate">{c.name}</span>
                <span className="n num">{condResult(ctx(cond), c).length}</span>
                <span className="sp" />
                {home.widgets[cond]!.type === 'notes' && kind === 'course' && <CaptureAction onCapture={() => undefined} />}
              </div>
              <CondBody c={ctx(cond)} cond={c} />
            </div>
          )}
          onCancel={() => setCond(null)}
          onSave={(c) => {
            save(setWidget(home, cond, { cond: c }))
            setFlash(cond)
            setCond(null)
          }}
        />
      )}
    </section>
  )
}
