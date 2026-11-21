import { Codicon, type CodiconName } from '@cn/design'
import { DreamSettingsPage } from './settings-dream'
import { AiIcon } from './engine-logo'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { VaultInfo } from '../shared/api'
import { activeSkin, allSkins, type AppSettings, pickSkin, type SettingsPatch, setFollowSystem, type SkinInfo, SKINS, type WinBg } from '../shared/appearance'
import { searchSettings, SETTINGS_PAGES, SETTINGS_SECTIONS, type SettingsItem, type SettingsPageId } from '../shared/settings-index'
import { COVER_GRADIENTS, COVER_PHOTOS, hideWidget, showWidget, WIDGETS, type Cover } from '../shared/home'
import { COVERS, coverImage, WINBG_THUMBS } from './covers'
import { homeWinBg, reloadUserThemes, userSkinInfos, useUserThemes, winBgName } from './theme'
import { saveHome, useHomeConfig } from './home-store'
import { PluginsSettings } from './plugins'
import { PageHead, type Said, SaidContext } from './settings/ui'
import { composing } from './ime'
import { AiSettingsPage } from './settings-ai'
import { GeneralPage } from './settings/general'
import { EditorPage } from './settings/editor'
import { FilesPage } from './settings/files'
import { PdfPage } from './settings/pdf'
import { WebPage } from './settings/web'
import { VaultPage } from './settings/vault'
import { GitPage } from './settings/git'
import { PrivacyPage } from './settings/privacy'
import { KeysPage } from './settings/keys'
import { AdvancedPage } from './settings/advanced'
import './settings.css'
import './settings/settings-a.css'

/** 设置的 15 页（方向 A，shared/settings-index.ts） */
export type SettingsPage = SettingsPageId

type Patch = SettingsPatch

/** 设置每一页要用的东西（App 给的） */
export interface SettingsProps {
  settings: AppSettings
  systemDark: boolean
  onChange(p: Patch): Promise<AppSettings>
  vault: VaultInfo
  onSwitchVault(): void
  onSync(): Promise<void>
  onNotice(t: string): void
  onGitChanged(): void
  onClose(): void
  /** 新版本下好了：「一般」分页上一颗小点 */
  updateReady: boolean
  onInstallUpdate(): Promise<void>
  onOpenUrl(url: string): void
  /** 梦游页的「看报告」：左栏开梦游报告（弹窗先关上） */
  onOpenDream(): void
  /** 设置里点了「去那里」的链接（网页「⋯ › 插件」、读PDF的笔记、视频条）：关上设置，在用的地方打开 */
  onGoPlace(place: 'web-extensions' | 'pdf-note' | 'video-subs'): void
  /** 翻到另一页的某一行、闪一下（「排顺序 ›」「去AI页换 ›」「去Git和同步 ›」、搜索回车） */
  onGoRow(row: string): void
}

/** 设置：B 里是居中弹窗，A 里是中间的一个标签（⌘, 打开）。左边分段的侧栏和搜索，右边一页 */
export function Settings(
  props: SettingsProps & {
    page: SettingsPage
    onPage(p: SettingsPage): void
    /** 方向 A：开成中间的一个标签（VS Code 的做法），不是弹窗 */
    asTab?: boolean
    /** 要翻到、闪一下的那一行（搜索回车、从用的地方跳过来）；seq 变了就再闪一次 */
    focus?: { row: string; seq: number } | null
    /** App 底栏这会儿说的话：设置开着时（B 的弹窗盖住了底栏）在设置底下的提示条里说 */
    appNotice?: string | null
  },
) {
  const [q, setQ] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  /** 底下的提示条：一句说这次改了会怎样，带「撤回」，4 秒后收起（鼠标停在上面不计时） */
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: () => void; seq: number } | null>(null)
  const [toastHover, setToastHover] = useState(false)
  const said = useMemo<Said>(
    () => ({
      saved: (hint, undo) => setToast({ text: `已存 · ${hint}`, ok: true, undo, seq: Date.now() }),
      say: (text) => setToast({ text, ok: false, seq: Date.now() }),
    }),
    [],
  )
  useEffect(() => {
    if (!toast || toastHover) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast, toastHover])
  useEffect(() => {
    if (props.appNotice) said.say(props.appNotice)
  }, [props.appNotice])
  /** 设置开着时页里的话都在设置底下说（B 的弹窗盖住了底栏的提示） */
  const notice = (t: string) => said.say(t)

  useEffect(() => {
    if (props.asTab) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose, props.asTab])

  // 换页：从顶上看起；带着要闪的那一行（搜索回车、从用的地方跳过来）时翻到那一行、--acc-soft 闪 1.6 秒，
  // 那一页的内容是读出来的（AI、Git）就等它画出来。两件事在一处：先后各做会互相盖掉
  const flashedSeq = useRef(0)
  useEffect(() => {
    const f = props.focus
    const b = body.current
    if (!f || f.seq === flashedSeq.current) {
      if (b) b.scrollTop = 0
      return
    }
    flashedSeq.current = f.seq
    let tries = 0
    let off: ReturnType<typeof setTimeout> | undefined
    const find = () => {
      const row = body.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(f.row)}"]`)
      const bb = body.current
      if (!bb || !row) {
        if (tries++ < 40) off = setTimeout(find, 50)
        return
      }
      const top = row.getBoundingClientRect().top - bb.getBoundingClientRect().top + bb.scrollTop
      bb.scrollTop = Math.max(0, top - bb.clientHeight / 2 + row.offsetHeight / 2)
      row.classList.remove('sa-flash')
      void row.offsetWidth
      row.classList.add('sa-flash')
      off = setTimeout(() => row.classList.remove('sa-flash'), 1600)
    }
    find()
    return () => clearTimeout(off)
  }, [props.page, props.focus?.seq])

  const hits = useMemo(() => searchSettings(q), [q])
  const go = (it: SettingsItem) => props.onGoRow(it.id)
  const page = SETTINGS_PAGES.find((p) => p.id === props.page) ?? SETTINGS_PAGES[0]!
  const pp = { ...props, onNotice: notice }

  return (
    <SaidContext.Provider value={said}>
      <div className={props.asTab ? 'pane setpane' : 'set-back'} onMouseDown={(e) => !props.asTab && e.target === e.currentTarget && props.onClose()}>
        <div className={'set' + (props.asTab ? ' set-tab' : '')} role={props.asTab ? 'region' : 'dialog'} aria-label="设置">
          <nav className="set-nav" aria-label="设置分页">
            <h3>设置</h3>
            <label className="sa-srch">
              <Codicon name="search" size={14} />
              <input
                ref={input}
                value={q}
                placeholder="搜设置：字号、同步…"
                aria-label="搜设置"
                onChange={(e) => setQ(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // 输入法组字时的回车是选字，不算（CN-115）
                  if (e.key === 'Enter' && !composing(e) && hits[0]) {
                    e.preventDefault()
                    go(hits[0])
                  }
                  if (e.key === 'Escape' && q) {
                    // esc 先清空搜索，再按一次才关设置
                    e.preventDefault()
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation()
                    setQ('')
                  }
                }}
              />
              {q && (
                <button type="button" className="clr" aria-label="清空" onClick={() => (setQ(''), input.current?.focus())}>
                  <Codicon name="close" size={14} />
                </button>
              )}
            </label>
            {q ? (
              <div className="sa-res" role="list" aria-label="搜到的设置">
                {hits.length ? (
                  <>
                    <div className="sa-rhead">{hits.length} 项</div>
                    {hits.slice(0, 30).map((it, i) => (
                      <button key={it.id} type="button" role="listitem" className={'sa-rrow' + (i === 0 ? ' sel' : '')} data-go={it.id} onClick={() => go(it)}>
                        <b>
                          <Mark text={it.label} q={q} />
                        </b>
                        <small>{`${SETTINGS_PAGES.find((p) => p.id === it.pg)!.name} › ${it.grp}`}</small>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="sa-rempty">
                    没找到「{q.trim()}」。
                    <br />
                    试试{' '}
                    {['字号', '同步', '下载'].map((w, i) => (
                      <Fragment key={w}>
                        {i > 0 && '、'}
                        <button type="button" className="sa-lnk" onClick={() => setQ(w)}>
                          {w}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="sa-navlist">
                {SETTINGS_SECTIONS.map((sec) => (
                  <Fragment key={sec}>
                    <div className="sa-sec">{sec}</div>
                    {SETTINGS_PAGES.filter((p) => p.sec === sec).map((p) => (
                      <button key={p.id} className={'si' + (props.page === p.id ? ' on' : '')} aria-current={props.page === p.id ? 'page' : undefined} onClick={() => props.onPage(p.id)}>
                        {/* AI 这一页画 AI 对话现在用的那一家的标志（同右下角圆钮） */}
                        {p.id === 'ai' ? <AiIcon job="chat" size={16} /> : <Codicon name={p.icon as CodiconName} />}
                        {p.name}
                        {p.id === 'general' && props.updateReady && <span className="udot nav" aria-label="新版本已下好" />}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </div>
            )}
          </nav>
          {/* × 在滚动区外面：页面滚动、有没有滚动条它都不动 */}
          <button className="iconbtn set-x" hidden={props.asTab} aria-label="关上设置" title="关上 esc" onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
          <div className="set-body" ref={body}>
            <PageHead page={page} />
            {props.page === 'general' && <GeneralPage {...pp} />}
            {props.page === 'look' && (
              <div className="sa-keep">
                <LookPage {...pp} />
              </div>
            )}
            {props.page === 'home' && (
              <div className="sa-keep">
                <HomePage {...pp} />
              </div>
            )}
            {props.page === 'editor' && <EditorPage {...pp} />}
            {props.page === 'files' && <FilesPage {...pp} />}
            {props.page === 'pdf' && <PdfPage {...pp} />}
            {props.page === 'web' && <WebPage {...pp} />}
            {props.page === 'ai' && <AiSettingsPage {...pp} />}
            {props.page === 'dream' && (
              <div className="sa-keep">
                <DreamSettingsPage settings={props.settings} onChange={props.onChange} onNotice={notice} onOpenDream={props.onOpenDream} onAiRow={() => props.onGoRow('fDream')} />
              </div>
            )}
            {props.page === 'vault' && <VaultPage {...pp} />}
            {props.page === 'git' && <GitPage {...pp} />}
            {props.page === 'privacy' && <PrivacyPage {...pp} />}
            {props.page === 'plugins' && (
              <div className="sa-keep">
                <PluginsSettings onNotice={notice} />
              </div>
            )}
            {props.page === 'keys' && <KeysPage {...pp} />}
            {props.page === 'advanced' && <AdvancedPage {...pp} />}
          </div>
          <div className={'sa-toast' + (toast ? ' show' : '') + (toast?.undo ? ' with-act' : '')} role="status" data-testid="settings-toast" onMouseEnter={() => setToastHover(true)} onMouseLeave={() => setToastHover(false)}>
            {toast && (
              <>
                <Codicon name={toast.ok ? 'pass-filled' : 'info'} size={14} className={toast.ok ? 'ok' : undefined} />
                <span>{toast.text}</span>
                {toast.undo && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.undo!()
                      setToast(null)
                      setToastHover(false)
                    }}
                  >
                    撤回
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </SaidContext.Provider>
  )
}

/** 搜索结果里名字打中的那几个字染色 */
function Mark({ text, q }: { text: string; q: string }) {
  const k = q.trim().toLowerCase()
  const i = text.toLowerCase().indexOf(k)
  if (!k || i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="sa-mark">{text.slice(i, i + k.length)}</mark>
      {text.slice(i + k.length)}
    </>
  )
}

/** 方角开关（用户偏好：开关的轨道和滑块都是小圆角方形） */
export function Toggle(props: { on: boolean; label: string; onChange(v: boolean): void }) {
  return <button className={'sw-toggle' + (props.on ? ' on' : '')} role="switch" aria-checked={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)} />
}

/** 一套主题的小窗口预览：用那套主题自己的变量画，结构也照它（标题栏、图标栏、侧栏、标签条和当前标签的标记、卡片、底栏） */
function Mini({ skin }: { skin: SkinInfo }) {
  return (
    <div className="mini" data-skin={skin.id} data-tabmark={skin.tab} aria-hidden="true">
      <i className="m-title" />
      <div className="m-body">
        <div className="m-bar">
          <i className="on" />
          <i />
          <i />
        </div>
        <div className="m-side">
          <i />
          <i className="on" />
          <i />
          <i />
        </div>
        <div className="m-main">
          <div className="m-tabs">
            <i className="on" />
            <i />
          </div>
          <div className="m-doc">
            <em />
            <s />
            <s className="short" />
            <b />
            <u />
          </div>
        </div>
      </div>
      <i className="m-status" />
    </div>
  )
}

/**
 * 界面风格 A 的小图：用现在这套主题的颜色，照主题卡的画法画出 VS Code 的样子——
 * 标题栏、左右图标栏、侧栏、标签条（当前标签的标记）、面包屑、底栏一条
 */
function FrameMiniA({ tab }: { tab: SkinInfo['tab'] }) {
  return (
    <span className="mini fr-mini-a" data-tabmark={tab} aria-hidden="true">
      <i className="m-title" />
      <span className="m-body">
        <span className="m-bar">
          <i className="on" />
          <i />
          <i />
        </span>
        <span className="m-side">
          <i />
          <i className="on" />
          <i />
          <i />
        </span>
        <span className="m-main">
          <span className="m-tabs">
            <i className="on" />
            <i />
          </span>
          <span className="m-crumb">
            <i />
          </span>
          <span className="m-doc">
            <em />
            <s />
            <s className="short" />
          </span>
        </span>
        <span className="m-bar m-rbar">
          <i />
          <i />
        </span>
      </span>
      <i className="m-status" />
    </span>
  )
}

function SkinCard(props: { skin: SkinInfo; on: boolean; slot: string | null; onPick(): void; onRemove?(): void }) {
  const s = props.skin
  return (
    <div className={'sk' + (props.on ? ' on' : '')}>
      <button className="sk-pick" role="radio" aria-checked={props.on} aria-label={s.name} aria-description={s.note} data-tip={s.note} data-side="below" data-skin-card={s.id} onClick={props.onPick}>
        <Mini skin={s} />
        <span className="nm">
          <span className="t">{s.name}</span>
          {props.slot && <em className="slot">{props.slot}</em>}
        </span>
      </button>
      {props.onRemove && (
        <button className="iconbtn sk-x" aria-label={`删掉 ${s.name}`} data-tip="删掉这套导入的主题" onClick={props.onRemove}>
          <Codicon name="trash" size={14} />
        </button>
      )}
    </div>
  )
}

function LookPage(props: { settings: AppSettings; systemDark: boolean; onChange(p: Patch): Promise<AppSettings>; onNotice(t: string): void }) {
  const a = props.settings.appearance
  const now = activeSkin(a, props.systemDark)
  const set = (appearance: Partial<AppSettings['appearance']>) => void props.onChange({ appearance })
  const user = userSkinInfos(useUserThemes())
  const all = allSkins(user)
  const [importing, setImporting] = useState(false)
  const bgs: { id: WinBg; name: string; bg: string }[] = [
    { id: 'none', name: '不用图', bg: 'var(--title)' },
    { id: 'aurora', name: '极光照片', bg: `url("${WINBG_THUMBS.aurora}") center/cover` },
    { id: 'cave', name: '冰洞照片', bg: `url("${WINBG_THUMBS.cave}") center/cover` },
  ]
  const card = (s: SkinInfo) => (
    <SkinCard
      key={s.id}
      skin={s}
      on={now === s.id}
      slot={a.followSystem ? (a.day === s.id ? '白天' : a.night === s.id ? '夜里' : null) : null}
      onPick={() => set(pickSkin(a, s))}
      onRemove={
        s.imported
          ? async () => {
              const next = await window.cn.removeTheme(s.id)
              await reloadUserThemes()
              await props.onChange({ appearance: next.appearance })
              props.onNotice(`删掉了「${s.name}」`)
            }
          : undefined
      }
    />
  )
  const importTheme = async () => {
    setImporting(true)
    try {
      const r = await window.cn.importTheme()
      if (!r) return
      await reloadUserThemes()
      await props.onChange({ appearance: r.settings.appearance })
      props.onNotice(r.added.length > 1 ? `导入了${r.added.length}套：${r.added.map((t) => t.name).join('、')}` : `导入了「${r.added[0]!.name}」，已经用上`)
    } catch (e) {
      props.onNotice('导入失败：' + String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setImporting(false)
    }
  }
  return (
    <>
      <h4>
        主题<span>{a.followSystem ? '跟着系统：点浅色换白天那套，点深色换夜里那套' : '点一张就换'}</span>
      </h4>
      <div role="radiogroup" aria-label="主题" data-row="skin">
        <div className="skins-h">浅色</div>
        <div className="skins">{SKINS.filter((s) => s.tone === 'light').map(card)}</div>
        <div className="skins-h">深色</div>
        <div className="skins">{SKINS.filter((s) => s.tone === 'dark').map(card)}</div>
        {user.length > 0 && (
          <>
            <div className="skins-h">导入的VS Code主题</div>
            <div className="skins">{user.map(card)}</div>
          </>
        )}
      </div>
      <div className="pair plain imp-theme" data-row="importTheme">
        <button className="btn" onClick={() => void importTheme()} disabled={importing}>
          <Codicon name={importing ? 'loading' : 'add'} size={14} className={importing ? 'spin' : undefined} />
          导入VS Code主题…
        </button>
        <span className="note">选 .json或 .vsix；对不上的颜色按底色和字色算</span>
      </div>

      <div className="pair" data-row="follow">
        <Toggle on={a.followSystem} label="跟着系统换浅深" onChange={(v) => set(setFollowSystem(a, v, props.systemDark))} />
        <span>跟着系统换浅深</span>
        {a.followSystem && (
          <>
            <span className="sp" />
            <label>
              白天用
              <select aria-label="白天用" value={a.day} onChange={(e) => set({ day: e.target.value })}>
                {all
                  .filter((s) => s.tone === 'light')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              夜里用
              <select aria-label="夜里用" value={a.night} onChange={(e) => set({ night: e.target.value })}>
                {all
                  .filter((s) => s.tone === 'dark')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
      </div>

      <h4>
        界面风格<span>结构一样，只换样子和几处位置</span>
      </h4>
      <div className="hstyles frames" role="radiogroup" aria-label="界面风格" data-row="frame">
        {(
          [
            ['a', '照VS Code', '平的、细线分区；标签下有位置；底栏写满，AI在底栏最右'],
            ['b', '浮岛书桌', '背景图铺满窗口，三块圆角磨砂面板；AI是右下角圆按钮'],
          ] as const
        ).map(([id, name, note]) => (
          <button key={id} role="radio" aria-checked={a.frame === id} className={'hs' + (a.frame === id ? ' on' : '')} onClick={() => set({ frame: id })}>
            {id === 'a' ? (
              <FrameMiniA tab={(all.find((s) => s.id === now) ?? all[0]!).tab} />
            ) : (
              <span className={'fr-pv ' + id} style={{ ['--pv' as string]: coverImage({ kind: 'builtin', id: 'aurora' }, true) }}>
                <i className="ab" />
                <i className="sd" />
                <i className="md" />
                <i className="sd" />
                <i className="ab" />
              </span>
            )}
            <span className="nm">
              {id.toUpperCase()} · {name}
            </span>
            <span className="ds">{note}</span>
          </button>
        ))}
      </div>

      <h4>
        窗口背景<span>{a.frame === 'b' ? '浮岛书桌铺满整个窗口，哪套主题都能配；照片会压暗一点' : '换成B浮岛书桌时铺满整个窗口；A照VS Code不用'}</span>
      </h4>
      <div className="bgs" role="radiogroup" aria-label="窗口背景" data-row="winbg">
        {bgs.map((b) => (
          <button key={b.id} role="radio" aria-checked={a.winBg === b.id} className={a.winBg === b.id ? 'on' : ''} onClick={() => set({ winBg: b.id })}>
            <i style={{ background: b.bg }} />
            {b.name}
          </button>
        ))}
        <button
          role="radio"
          aria-checked={a.winBg === 'custom'}
          className={a.winBg === 'custom' ? 'on' : ''}
          onClick={async () => {
            if (a.winBg !== 'custom' || !a.winBgFile) {
              const next = await window.cn.pickWinBg()
              if (next) await props.onChange({ appearance: next.appearance })
            } else set({ winBg: 'custom' })
          }}
        >
          <i className="up" style={a.winBgFile ? { background: `url("cn-file://app/backgrounds/${encodeURIComponent(a.winBgFile)}") center/cover` } : undefined}>
            {!a.winBgFile && <Codicon name="add" size={16} />}
          </i>
          从电脑选
        </button>
      </div>

      <h4>
        首页样式<span>两种都能自己摆组件、换封面</span>
      </h4>
      <HomeStylePicker value={a.homeStyle} onChange={(homeStyle) => set({ homeStyle })} />
      <HomeWinBgRow settings={props.settings} onChange={(homeWinBg) => set({ homeWinBg })} />
    </>
  )
}

/** 首页样式选 B 时多一行：整页背景用窗口背景那张图（CN-52）；勾上后首页里的「换封面」变灰 */
function HomeWinBgRow(props: { settings: AppSettings; onChange(v: boolean): void }) {
  if (props.settings.appearance.homeStyle !== 'b') return null
  return (
    <label className="pair hs-winbg" data-row="homeWinBg">
      <input type="checkbox" checked={props.settings.appearance.homeWinBg} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>整页背景用窗口背景那张图</span>
      <span className="note">现在：{winBgName(props.settings)}</span>
    </label>
  )
}

function HomeStylePicker(props: { value: 'a' | 'b'; onChange(v: 'a' | 'b'): void }) {
  return (
    <div className="hstyles" role="radiogroup" aria-label="首页样式" data-row="homeStyle">
      {(
        [
          ['a', '封面长图', '上面一条封面，下面组件网格'],
          ['b', '整页背景', '图铺满首页，组件是半透明玻璃'],
        ] as const
      ).map(([id, name, note]) => (
        <button key={id} role="radio" aria-checked={props.value === id} className={'hs' + (props.value === id ? ' on' : '')} onClick={() => props.onChange(id)}>
          <span className={'hs-pv ' + id} style={{ ['--pv' as string]: coverImage({ kind: 'builtin', id: 'aurora' }, true) }}>
            <i />
            <b />
            <b />
            <b />
          </span>
          <span className="nm">
            {id.toUpperCase()} · {name}
          </span>
          <span className="ds">{note}</span>
        </button>
      ))}
    </div>
  )
}

function HomePage(props: { settings: AppSettings; onChange(p: Patch): Promise<AppSettings>; onNotice(t: string): void }) {
  const cfg = useHomeConfig()
  if (!cfg) return null
  const isCover = (c: Cover) => (c.kind === 'file' ? cfg.cover.kind === 'file' && cfg.cover.path === c.path : cfg.cover.kind === 'builtin' && cfg.cover.id === c.id)
  return (
    <>
      <h4>
        首页样式<span>首页上的「编辑首页」改的也是这里</span>
      </h4>
      <HomeStylePicker value={props.settings.appearance.homeStyle} onChange={(homeStyle) => void props.onChange({ appearance: { homeStyle } })} />
      <HomeWinBgRow settings={props.settings} onChange={(homeWinBg) => void props.onChange({ appearance: { homeWinBg } })} />
      <h4>
        封面<span>{homeWinBg(props.settings) ? '现在首页用的是窗口背景那张图（上面的勾），这里换了也不显示' : '存在库里，跟着Git走'}</span>
      </h4>
      <div className={'covers' + (homeWinBg(props.settings) ? ' off' : '')} data-row="cover">
        {[...COVER_PHOTOS, ...COVER_GRADIENTS].map((id) => {
          const c: Cover = { kind: 'builtin', id }
          return (
            <button key={id} className={isCover(c) ? 'on' : ''} aria-pressed={isCover(c)} title={COVERS.find((x) => x.id === id)!.name} onClick={() => void saveHome({ ...cfg, cover: c })}>
              <i style={{ backgroundImage: coverImage(c, true) }} />
              {COVERS.find((x) => x.id === id)!.name}
            </button>
          )
        })}
        <button
          className={cfg.cover.kind === 'file' ? 'on' : ''}
          onClick={async () => {
            try {
              const p = await window.cn.pickCover()
              if (p) await saveHome({ ...cfg, cover: { kind: 'file', path: p } })
            } catch (e) {
              props.onNotice(String((e as Error).message))
            }
          }}
        >
          <i className="up" style={cfg.cover.kind === 'file' ? { backgroundImage: coverImage(cfg.cover) } : undefined}>
            {cfg.cover.kind !== 'file' && <Codicon name="file-media" size={16} />}
          </i>
          从电脑选
        </button>
      </div>
      <h4>
        组件<span>关掉的收进首页下面的抽屉，随时放回来</span>
      </h4>
      <div className="wlist-set" data-row="widgets">
        {WIDGETS.map((w) => {
          const on = cfg.order.includes(w.id)
          return (
            <div key={w.id} className="row">
              <span>{w.name}</span>
              <span className="sp" />
              <Toggle on={on} label={w.name} onChange={(v) => void saveHome(v ? showWidget(cfg, w.id) : hideWidget(cfg, w.id))} />
            </div>
          )
        })}
      </div>
    </>
  )
}
