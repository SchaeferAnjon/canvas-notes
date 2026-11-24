import { FAMILY_ICONS } from '@cn/family/icons'
import { ParaReadTag } from './ParaReadWidget'
import { composing } from '../ime'
/**
 * 一个文件夹的首页（设计稿 design-mindmap 方向 B 第 9 节；2026-11-18 起每个文件夹一个样子，方案 v2「文件夹封面」方向 A）：
 * 顶上 150 高的横幅封面（图或自己颜色的渐变，悬停「换封面」「调整位置」），64 的图标方块压在横幅下沿，宋体 28 名字、
 * 一行「种类 · 篇数 · 改于」；自带的分类多一行「放什么：」（点一下就能改）；下面组件网格和「里面有什么」。
 * 编辑时能拖、换宽、收起、删除、从组件库加、改「按条件列出」的条件；「⋯」里设为模板、恢复默认。
 * 页面只是看法：怎么改都不动文件夹里的文件。复用主页的 home.css。
 */
import { Codicon } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import { ActBtn, TabActs } from '../shell/TabActs'
import { useEffect, useMemo, useState } from 'react'
import type { AnkiReview } from '../../shared/reading'
import { app } from '../ctx/actions'
import { openCards, showAsked, useCardsView } from '../reading/cards-store'
import type { NoteFile } from '../../shared/api'
import { categoryOf, isChildOf } from '../../shared/categories'
import { fileName, fixedFolder } from '../../shared/files'
import { MovePicker } from '../files/move-pick'
import {
  addWidget,
  type Cond,
  folderLead,
  type FolderHome,
  FWIDGETS,
  hideW,
  homeKindOf,
  KIND_LABEL,
  moveW,
  type PropFile,
  removeWidget,
  resizeW,
  setWidget,
  showW,
  sizeOfW,
  templateFileOf,
  wInfo,
} from '../../shared/folder-home'
import type { DreamPreview } from '../dream/preview'
import '../home.css'
import { openCapture } from '../mindmap/capture-store'
import { CondEditor, WidgetLibrary } from './dialogs'
import { widgetIcon } from './icons'
import { FolderContent } from './FolderContent'
import { useLeft } from '../files/left-store'
import { folderLook } from '../files/left-store'
import { setDesc, useDesc } from '../files/category-store'
import { AnyCodicon, LookPicker } from '../files/look'
import { useVaultFiles } from '../files/store'
import { coverIsImage, folderCoverCss, FolderCoverGallery, ownColor } from './cover'
import { FOLDER_COLORS, presetsOn } from '../../shared/left'
import './folder-home.css'
import { CaptureAction, CondBody, condResult, SlidesResume, type WCtx, WidgetBody } from './widgets'
import { TodoOpen } from '../todo/TodoCard'
import { isTodoNote } from '../../shared/todo'
import { usePrefs } from '../settings-store'
import { useT } from '../i18n'
import { list } from '../../shared/i18n'

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
  onOpenAll(): void
  /** 子文件夹卡片：开它的首页 */
  onOpenFolder(folder: string): void
  /** 底部提示；undo 给了就带「撤回」 */
  onNotice(t: string, undo?: () => void): void
  /** 标题上改名（新建时、双击标题时）：返回新文件夹，没改成是 null（原因 App 在底栏说了） */
  onRename(name: string): Promise<string | null>
}) {
  const { folder, pv } = props
  const t = useT()
  const kind = homeKindOf(folder)!
  const title = folder.split('/').pop()!
  /** 自带的顶级分类：多一行「放什么」，不改名；关掉预设的分类时（task-wniqx）当普通文件夹，不写「分类」和「放什么」 */
  const presets = presetsOn(useLeft())
  const cat = presets ? categoryOf(folder) : undefined
  const look = folderLook(folder)
  const descOf = useDesc()
  const { files: vaultFiles } = useVaultFiles()
  /** 「课程」下面有几门课（名字下面那一行写「2门课」） */
  const courses = useMemo(() => (kind === 'courses' ? vaultFiles.filter((f) => f.kind === 'dir' && isChildOf(f.path, '课程')).length : 0), [kind, vaultFiles])
  const [lookAt, setLookAt] = useState<HTMLElement | null>(null)
  /** 正在改「放什么」 */
  const [descEdit, setDescEdit] = useState(false)
  const [home, setHome] = useState<FolderHome | null>(null)
  const [files, setFiles] = useState<PropFile[]>([])
  const [editing, setEditing] = useState(!!props.fresh)
  /** 标题是改名输入框：刚新建时、双击标题后 */
  const [naming, setNaming] = useState(!!props.fresh)
  const fixed = fixedFolder(folder)
  const [gallery, setGallery] = useState(false)
  /** 正在调封面位置：拖动时的临时位置 */
  const [adjustY, setAdjustY] = useState<number | null>(null)
  const [menu, setMenu] = useState<null | 'more' | 'icon' | 'tpl' | 'reset'>(null)
  const [lib, setLib] = useState(false)
  const [cond, setCond] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; before?: string | null } | null>(null)
  /** 卡里一份右键「移到…」弹的小弹层（task-r00en）：挪哪一份、贴着谁 */
  const [mover, setMover] = useState<{ path: string; anchor: HTMLElement } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  /** 从访达拖着文件经过这一页（课件进度卡亮起来，CN-2） */
  const [dropOver, setDropOver] = useState(false)
  /** 刚拖进来的课件，标「新」 */
  const [justIn, setJustIn] = useState<Set<string>>(new Set())

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
  // 读PDF时问过的（各篇笔记里的每一问，送过没有）、今天要复习（task-tz7y3）
  const asked = useCardsView(kind === 'course' ? { kind: 'folder', folder } : null)
  const [review, setReview] = useState<AnkiReview | null>(null)
  useEffect(() => {
    if (kind !== 'course') return
    let stale = false
    window.cnReading.ankiReview(folder).then((r) => !stale && setReview(r), (e) => props.onNotice(errText(e)))
    return () => {
      stale = true
    }
  }, [folder, kind, asked])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(timer)
  }, [flash])

  /** 名字叫「待办」的笔记显示不显示（设置 › 文件，task-pd1d1）：头上那行的篇数跟着 */
  const showTodo = usePrefs((s) => s.files.showTodo)
  if (!home) return <section className="pane" />
  const save = (h: FolderHome) => {
    setHome(h)
    void window.cnFolder.set(folder, h).catch((e) => props.onNotice(errText(e)))
  }
  const fresh = new Set([...incoming.map((m) => m.to), ...justIn])
  /** 换封面：存好后底部「封面换好了 · 撤回」 */
  const pickCover = (cover: FolderHome['cover']) => {
    const prev = home
    save({ ...home, cover })
    setGallery(false)
    props.onNotice(t('封面换好了'), () => save(prev))
  }
  // 课件进度卡在这页上才收拖进来的 PDF
  const slidesId = kind === 'course' ? home.order.find((id) => home.widgets[id]!.type === 'slides') : undefined
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files')
  const dropProps = slidesId
    ? {
        onDragOver(e: React.DragEvent) {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropOver(true)
        },
        onDragLeave(e: React.DragEvent) {
          if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) setDropOver(false)
        },
        async onDrop(e: React.DragEvent) {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDropOver(false)
          const paths = [...e.dataTransfer.files].map((f) => window.cnFolder.pathOf(f)).filter(Boolean)
          try {
            const r = await window.cnFolder.importPdfs(folder, paths)
            const names = (l: string[]) => list(l.map((p) => p.split('/').pop()!))
            const had = r.already.length ? (r.already.length > 1 || r.added.length ? t('{folder}里已经有「{names}」了', { folder: title, names: names(r.already) }) : t('{folder}里已经有这份了', { folder: title })) : ''
            if (!r.added.length) return props.onNotice(had || t('课件进度只收PDF'))
            setJustIn((s) => new Set([...s, ...r.added]))
            setFlash(slidesId)
            const skipped = r.skipped.length ? t('{n}个不是PDF，没收', { n: r.skipped.length }) : ''
            props.onNotice([t('拷进了{folder}：{names}', { folder: title, names: names(r.added) }), had, skipped].filter(Boolean).join(' · '), () => {
              void window.cnFolder.unimportPdfs(r.added).catch((err) => props.onNotice(errText(err)))
            })
          } catch (err) {
            props.onNotice(errText(err))
          }
        },
      }
    : {}
  const ctx = (id: string): WCtx => ({ folder, files, notes: props.notes, fresh, editing, onOpen: (p) => props.onOpen(pv.realPath(p)), onOpenAt: props.onOpenAt, asked: asked?.items ?? [], review, onAsked: (pdf) => (app().openWithNote(pdf), showAsked(pdf)), onCards: () => openCards({ kind: 'folder', folder }), onOpenAnki: () => void window.cnReading.openAnki().catch((e) => props.onNotice(errText(e))), onAll: props.onOpenAll, onCapture: () => openCapture({ course: title }), movable: !editing && !pv.on, onMoveTo: (p, anchor) => setMover({ path: pv.realPath(p), anchor }), save, reload: () => void window.cnFolder.get(folder).then((r) => setHome(r.home)), home, id })
  const inFolder = files.filter((f) => f.path.startsWith(folder + '/'))
  // 「N篇」和下面「里面有什么」、文件树数得一样：名字叫「待办」的笔记不显示时也不算（task-pd1d1）
  const lead = folderLead(folder, showTodo ? inFolder : inFolder.filter((f) => !isTodoNote(f.path)), { courses, presets })
  const coverY = adjustY ?? home.coverY
  const tplName = kind === 'course' ? t('课程模板', { ctx: '设为模板' }) : kind === 'project' ? t('项目模板', { ctx: '设为模板' }) : null
  /** 「恢复成默认的课程首页？」里的种类（说的是这一类，不是磁盘上的文件夹名） */
  const kindLabel = t(KIND_LABEL[kind], { ctx: '文件夹种类' })
  /** 「放什么」：没改过的是分类表里的那句，跟界面语言；自己改过的照原样 */
  const descShown = cat ? (descOf(cat.name) === cat.desc ? t(cat.desc) : descOf(cat.name)) : undefined

  const add = (type: (typeof FWIDGETS)[number]['type'], c?: Cond) => {
    const r = addWidget(home, type, kind, c)
    save(r.home)
    setFlash(r.id)
  }

  return (
    <section className={'pane homev fhome home-' + home.style + (editing ? ' editing' : '') + (pv.on ? ' previewing' : '')} data-testid="folder-home" data-folder={folder} {...dropProps}>
      <div className="body">
        <div className="hscroll" style={{ ['--cover-img' as string]: folderCoverCss(home.cover, folder), ['--cover-y' as string]: `${coverY}%` }}>
          <div
            className={'cover fh-bn' + (adjustY !== null ? ' adjust' : '') + (gallery ? ' keep' : '')}
            data-testid="folder-cover"
            onPointerDown={(e) => {
              if (adjustY === null || (e.target as HTMLElement).closest('button')) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const startY = e.clientY
              const from = adjustY
              const h = e.currentTarget.offsetHeight
              // 松手没送到页面：停在最后的位置（还要点「好了」才存；trackDrag，task-0nz63）
              trackDrag<PointerEvent>(e, { move: (ev) => setAdjustY(Math.min(100, Math.max(0, Math.round(from - ((ev.clientY - startY) / h) * 100)))) })
            }}
            onKeyDown={(e) => e.key === 'Escape' && adjustY !== null && setAdjustY(null)}
          >
            {adjustY !== null && (
              <span className="hint">
                <Codicon name="move" size={14} />
                {t('上下拖动图片')}
              </span>
            )}
            <div className="cacts">
              {adjustY === null ? (
                <>
                  <span className="cpick">
                    <button className="cbtn" data-cover-pick onClick={() => setGallery((v) => !v)} aria-expanded={gallery}>
                      <Codicon name="file-media" size={14} />
                      {t('换封面')}
                    </button>
                    {gallery && <FolderCoverGallery cover={home.cover} onPick={pickCover} onNotice={props.onNotice} onClose={() => setGallery(false)} />}
                  </span>
                  {coverIsImage(home.cover) && (
                    <button className="cbtn" onClick={() => (setGallery(false), setAdjustY(home.coverY))}>
                      <Codicon name="move" size={14} />
                      {t('调整位置')}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="cbtn pri"
                    onClick={() => {
                      save({ ...home, coverY: adjustY })
                      setAdjustY(null)
                      // 不翻：.首页.json 是磁盘上的文件名
                      props.onNotice(t('位置存好了：写在这个文件夹的「{file}」里', { file: '.首页.json' }))
                    }}
                  >
                    {t('存好')}
                  </button>
                  <button className="cbtn" autoFocus onClick={() => setAdjustY(null)}>
                    {t('取消')}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="hwrap">
            <div className="fh-title">
              <span className="fh-ico" data-testid="folder-badge" data-icon={look.icon} style={{ color: look.color ?? FOLDER_COLORS[ownColor(folder)] }}>
                <AnyCodicon name={look.icon} size={28} />
              </span>
              <div className="fh-tx">
                {naming && !fixed ? (
                  <input
                    className="fh-name"
                    aria-label={t('文件夹名字')}
                    defaultValue={title}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (composing(e)) return
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') (e.currentTarget.value = title), e.currentTarget.blur()
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim()
                      const input = e.currentTarget
                      if (!name || name === title) return setNaming(false)
                      void props.onRename(name).then((f) => (f ? setNaming(false) : ((input.value = title), input.focus())))
                    }}
                  />
                ) : (
                  <h2
                    data-tip={t('双击改名')}
                    data-side="below"
                    onDoubleClick={() =>
                      fixed ? props.onNotice(cat ? t('「{name}」是软件自带的分类，不改名；封面、图标、颜色都能换', { name: title }) : t('「{name}」是软件自带的文件夹，不改名', { name: title })) : setNaming(true)
                    }
                  >
                    {title}
                  </h2>
                )}
                <p data-testid="folder-lead">{lead}</p>
              </div>
              <span className="sp" />
              <TabActs active>
              {editing ? (
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(false)}>
                  <Codicon name="check" size={14} />
                  {t('完成')}
                </button>
              ) : (
                <ActBtn icon="edit" label={t('编辑首页', { ctx: '文件夹首页' })} text onClick={() => setEditing(true)} />
              )}
              <div className="fh-menu">
                <ActBtn icon="ellipsis" label={t('更多')} aria-expanded={menu !== null} onClick={() => setMenu(menu ? null : 'more')} />
                {menu === 'more' && (
                  <div className="fh-pop menu" role="menu" aria-label={t('首页的更多')}>
                    {tplName && (
                      <button role="menuitem" onClick={() => setMenu('tpl')}>
                        <Codicon name="bookmark" size={14} />
                        {t('设为{name}', { name: tplName })}
                      </button>
                    )}
                    <button role="menuitem" onClick={() => setMenu('reset')}>
                      <Codicon name="discard" size={14} />
                      {t('恢复默认')}
                    </button>
                    <button role="menuitem" onClick={() => (setMenu(null), setEditing(true))}>
                      <Codicon name="layout" size={14} />
                      {t('编辑首页', { ctx: '文件夹首页' })}
                    </button>
                  </div>
                )}
                {(menu === 'tpl' || menu === 'reset') && (
                  <div className="fh-pop confirm" role="dialog" aria-label={menu === 'tpl' ? t('设为{name}？', { name: tplName }) : t('恢复成默认的{kind}首页？', { kind: kindLabel })}>
                    <h4>{menu === 'tpl' ? t('设为{name}？', { name: tplName }) : t('恢复成默认的{kind}首页？', { kind: kindLabel })}</h4>
                    <p>
                      {menu === 'tpl'
                        ? t('以后新建的{kind}文件夹，首页都用这一页的组件、排法和外观。已有的不变。存在{path}。', { kind: kindLabel, path: templateFileOf(kind) })
                        : t('组件、排法、外观回到默认的样子（有模板就用模板）。这只是一页看法：文件一个不动。')}
                    </p>
                    <div className="act">
                      <button className="btn btn-ghost btn-sm" onClick={() => setMenu(null)}>
                        {t('取消')}
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
                              props.onNotice(t('设为{name}了 · 以后新建的{kind}用这个样子', { name: tplName, kind: kindLabel }))
                            } else {
                              const prev = home
                              setHome(await window.cnFolder.reset(folder))
                              props.onNotice(t('恢复成默认的样子了 · 文件一个没动'), () => save(prev))
                            }
                          } catch (e) {
                            props.onNotice(errText(e))
                          }
                        }}
                      >
                        {menu === 'tpl' ? t('设为模板') : t('恢复默认')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </TabActs>
            </div>
            {cat && (
              <div className="fh-desc" data-testid="cat-desc">
                <span className="q">{t('放什么：')}</span>
                {descEdit ? (
                  <input
                    aria-label={t('这一类放什么')}
                    defaultValue={descShown}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      // 输入法还在组字：回车、Esc 交给输入法（CN-115）
                      if (composing(e)) return
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') ((e.currentTarget.value = descShown!), e.currentTarget.blur())
                    }}
                    onBlur={(e) => {
                      const text = e.currentTarget.value.trim()
                      setDescEdit(false)
                      if (!text || text === descShown) return
                      void setDesc(cat.name, text).then(
                        // 不翻：.canvas-notes/分类.json 是磁盘上的文件名
                        () => props.onNotice(t('写进了库里的「{file}」：梦游归类、「移到…」菜单都按这句排', { file: '.canvas-notes/分类.json' })),
                        (err) => props.onNotice(errText(err)),
                      )
                    }}
                  />
                ) : (
                  <span className="ed" role="button" tabIndex={0} aria-label={t('这一类放什么：{desc}（点一下改）', { desc: descShown })} onClick={() => setDescEdit(true)} onKeyDown={(e) => e.key === 'Enter' && setDescEdit(true)}>
                    {descShown}
                    <Codicon name="edit" size={12} className="pen" />
                  </span>
                )}
              </div>
            )}
            {editing && (
              <div className="fh-ebar" role="toolbar" aria-label={t('编辑首页', { ctx: '文件夹首页' })}>
                {(
                  <>
                    <span className="k">{t('样式')}</span>
                    <div className="seg">
                      <button className={home.style === 'a' ? 'on' : ''} onClick={() => save({ ...home, style: 'a' })}>
                        {t('A封面')}
                      </button>
                      <button className={home.style === 'b' ? 'on' : ''} onClick={() => save({ ...home, style: 'b' })}>
                        {t('B整页背景')}
                      </button>
                    </div>
                    <span className="bar" />
                    <button className="btn btn-sm" onClick={() => (setMenu(null), setGallery(true), document.querySelector('.fhome .hscroll')?.scrollTo({ top: 0, behavior: 'smooth' }))}>
                      <Codicon name="file-media" size={14} />
                      {t('换封面')}
                    </button>
                  </>
                )}
                <button className="btn btn-sm" onClick={(e) => setLookAt(lookAt ? null : e.currentTarget)}>
                  <Codicon name="symbol-color" size={14} />
                  {t('图标和颜色')}
                </button>
                {lookAt && <LookPicker folder={folder} anchor={lookAt} onClose={() => setLookAt(null)} />}
                <span className="bar" />
                <button className="btn btn-sm" onClick={() => setLib(true)}>
                  <Codicon name="add" size={14} />
                  {t('加组件')}
                </button>
                <span className="sp" />
                <span className="hint">{t('设为模板、恢复默认在「完成」旁的「⋯」')}</span>
              </div>
            )}
            {home.order.length > 0 && (
            <div className="wgrid">
              {home.order.map((id) => {
                const w = home.widgets[id]!
                const info = wInfo(w.type)
                const size = sizeOfW(home, id)
                const total = w.cond ? condResult(ctx(id), w.cond).length : 0
                // 按条件列出（草稿、这个月写完的…）没找到东西：平时不占一整块写「没有符合条件的文件」，编辑首页时照常画、能改条件
                if ((w.type === 'list' || w.type === 'drafts') && !total && !editing) return null
                return (
                  <div key={id} data-widget={id} data-testid={`fw-${id}`} className={`wd s${size}${drag?.id === id ? ' dragging' : ''}${drag?.before === id ? ' drop-before' : ''}${flash === id ? ' flash' : ''}${dropOver && id === slidesId ? ' drop-hot' : ''}`}>
                    {dropOver && id === slidesId && (
                      <div className="fw-dropover" data-testid="slides-drop">
                        <b>{t('松手收进{name}', { name: title })}</b>
                        <span>{t('拷一份进这门课的文件夹，访达里的原文件不动')}</span>
                      </div>
                    )}
                    {editing && (
                      <>
                        <button
                          className="wgrip"
                          aria-label={t('拖动{name}', { name: t(info.name) })}
                          onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId)
                            setDrag({ id })
                            let before: string | undefined
                            // 松手没送到页面（窗口外松手、失焦）：当没拖过，组件不挪（trackDrag，task-0nz63）
                            trackDrag<PointerEvent>(e, {
                              move: (ev) => {
                                const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-widget]')?.dataset.widget
                                before = over && over !== id ? over : undefined
                                setDrag(before ? { id, before } : { id })
                              },
                              end: (how) => {
                                if (how === 'up' && before) save(moveW(home, id, before))
                                setDrag(null)
                              },
                            })
                          }}
                        >
                          <Codicon name="gripper" size={14} />
                        </button>
                        <div className="wedit">
                          {w.cond && (
                            <button onClick={() => setCond(id)} aria-label={t('条件', { ctx: '按条件列出' })} title={t('改条件')}>
                              <Codicon name="settings" size={12} />
                              <span className="lbl">{t('条件', { ctx: '按条件列出' })}</span>
                            </button>
                          )}
                          <button onClick={() => save(resizeW(home, id))} aria-label={size === 1 ? t('变宽') : size === 2 ? t('整行') : t('变窄')} title={size === 1 ? t('变宽') : size === 2 ? t('整行') : t('变窄')}>
                            <Codicon name={size === 4 ? 'screen-normal' : 'arrow-both'} size={12} />
                            <span className="lbl">{size === 1 ? t('变宽') : size === 2 ? t('整行') : t('变窄')}</span>
                          </button>
                          <button onClick={() => save(hideW(home, id))} aria-label={t('收起')} title={t('收起到下面的抽屉')}>
                            <Codicon name="screen-normal" size={12} />
                            <span className="lbl">{t('收起')}</span>
                          </button>
                          <button
                            aria-label={t('删掉{name}', { name: t(w.cond?.name ?? info.name) })}
                            title={t('删掉这个组件（文件不动）')}
                            onClick={() => {
                              save(removeWidget(home, id))
                              props.onNotice(t('删了「{name}」组件 · 文件一个没动', { name: t(w.cond?.name ?? info.name) }), () => save(home))
                            }}
                          >
                            <Codicon name="trash" size={12} />
                          </button>
                        </div>
                      </>
                    )}
                    <div className="wk">
                      {/* ParaRead 组件头上是它的真图标（偏好「不用首字母图标」），和 MeetCaption 组件一样 */}
                      {w.type === 'pararead' ? <img className="wk-app" src={FAMILY_ICONS.pararead} alt="" width={16} height={16} /> : <Codicon name={widgetIcon(w.type)} size={14} />}
                      {/* 条件的名字存在 .首页.json 里：还是默认的那几个时翻，自己起的照原样（t 找不到就原样） */}
                      <span className="truncate">{t(w.type === 'list' ? w.cond!.name : info.name)}</span>
                      <span className="sp" />
                      {total > 0 && <span className="n num">{total}</span>}
                      {w.type === 'courses' && courses > 0 && <span className="n num">{t('{n}门', { n: courses })}</span>}
                      {w.type === 'doubts' && !!asked?.items.length && <span className="n num">{t('{n}问', { n: asked.items.length })}</span>}
                      {w.type === 'notes' && !editing && <CaptureAction onCapture={() => openCapture({ course: title })} />}
                      {w.type === 'slides' && !editing && <SlidesResume c={ctx(id)} />}
                      {w.type === 'todo' && !editing && <TodoOpen folder={folder} />}
                      {w.type === 'pararead' && <ParaReadTag folder={folder} view={w.view ?? 'bilingual'} onView={(v) => save(setWidget(home, id, { view: v }))} />}
                    </div>
                    <WidgetBody c={ctx(id)} w={w} />
                  </div>
                )
              })}
            </div>
            )}
            {editing && (
              <div className="tray">
                <div className="hd">{t('收起来的组件，点一下放回首页')}</div>
                <div className="items">
                  {home.hidden.length === 0 && <span className="none">{t('都在首页上了')}</span>}
                  {home.hidden.map((id) => (
                    <button key={id} className="ti" onClick={() => save(showW(home, id))}>
                      <Codicon name={widgetIcon(home.widgets[id]!.type)} size={14} />
                      {t(home.widgets[id]!.cond?.name ?? wInfo(home.widgets[id]!.type).name)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!editing && <FolderContent folder={folder} notes={props.notes} onOpen={props.onOpen} onOpenFolder={props.onOpenFolder} movable={!pv.on} onMoveTo={(p, anchor) => setMover({ path: p, anchor })} />}
          </div>
        </div>
      </div>
      {mover && <MovePicker paths={[mover.path]} what={fileName(mover.path).replace(/\.md$/i, '')} dirs={[]} anchor={mover.anchor} onPick={(f) => void app().moveItem(mover.path, f)} onClose={() => setMover(null)} />}
      {lib && <WidgetLibrary title={title} home={home} kind={kind} onAdd={add} onClose={() => setLib(false)} />}
      {cond && home.widgets[cond] && (
        <CondEditor
          initial={home.widgets[cond]!.cond!}
          found={(c) => condResult(ctx(cond), c).length}
          preview={(c) => (
            <div className="wd s2">
              <div className="wk">
                <Codicon name={widgetIcon(home.widgets[cond]!.type)} size={14} />
                <span className="truncate">{t(c.name)}</span>
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
