import { when } from '../shared/when'
import { Codicon, type CodiconName } from '@cn/design'
import { AiSettingsPage } from './settings-ai'
import { DreamSettingsPage } from './settings-dream'
import { AiIcon } from './engine-logo'
import { useEffect, useRef, useState } from 'react'
import type { VaultInfo } from '../shared/api'
import { activeSkin, allSkins, type AppSettings, AUTO_COMMIT_CHOICES, autoCommitLabel, pickSkin, setFollowSystem, type SkinInfo, SKINS, type WinBg } from '../shared/appearance'
import { ARCHIVE_CHOICES, archiveLabel, type ArchiveDays } from '../shared/sidebar'
import { COVER_GRADIENTS, COVER_PHOTOS, hideWidget, showWidget, WIDGETS, type Cover } from '../shared/home'
import { COVERS, coverImage, WINBG_THUMBS } from './covers'
import { homeWinBg, reloadUserThemes, userSkinInfos, useUserThemes, winBgName } from './theme'
import { saveHome, useHomeConfig } from './home-store'
import { openImport } from './importer/store'
import { PluginsSettings } from './plugins'
import { VideoKeys } from './video/VideoKeys'
import './settings.css'
import { UpdatePage } from './update'

export type SettingsPage = 'look' | 'home' | 'vault' | 'ai' | 'dream' | 'plugins' | 'git' | 'keys' | 'update'

const PAGES: { id: SettingsPage; name: string; icon: CodiconName }[] = [
  { id: 'look', name: '外观', icon: 'symbol-color' },
  { id: 'home', name: '首页', icon: 'home' },
  { id: 'vault', name: '库', icon: 'library' },
  { id: 'ai', name: 'AI', icon: 'comment-discussion' },
  { id: 'dream', name: '梦游', icon: 'wand' },
  { id: 'plugins', name: '插件', icon: 'extensions' },
  { id: 'git', name: 'Git和同步', icon: 'git-branch' },
  { id: 'keys', name: '快捷键', icon: 'record-keys' },
  { id: 'update', name: '更新', icon: 'arrow-circle-up' },
]

type Patch = Parameters<typeof window.cn.setSettings>[0]

/** 设置：居中的面板，左边分页（⌘, 打开） */
export function Settings(props: {
  page: SettingsPage
  onPage(p: SettingsPage): void
  settings: AppSettings
  systemDark: boolean
  onChange(p: Patch): Promise<AppSettings>
  vault: VaultInfo
  onSwitchVault(): void
  onSync(): Promise<void>
  onNotice(t: string): void
  onGitChanged(): void
  onClose(): void
  /** 新版本下好了：「更新」分页上一颗小点 */
  updateReady: boolean
  onInstallUpdate(): Promise<void>
  onOpenUrl(url: string): void
  /** 方向 A：开成中间的一个标签（VS Code 的做法），不是弹窗 */
  asTab?: boolean
  /** 梦游页的「看报告」：左栏开梦游报告（弹窗先关上） */
  onOpenDream(): void
}) {
  /** 梦游页点「用哪家 AI」那一行：到 AI 页，「梦游」那一行滚进来、闪一下 */
  const [aiFocus, setAiFocus] = useState<'dream' | null>(null)
  useEffect(() => {
    if (props.page !== 'ai') setAiFocus(null)
  }, [props.page])
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

  return (
    <div className={props.asTab ? 'pane setpane' : 'set-back'} onMouseDown={(e) => !props.asTab && e.target === e.currentTarget && props.onClose()}>
      <div className={'set' + (props.asTab ? ' set-tab' : '')} role={props.asTab ? 'region' : 'dialog'} aria-label="设置">
        <nav className="set-nav" aria-label="设置分页">
          <h3>设置</h3>
          {PAGES.map((p) => (
            <button key={p.id} className={'si' + (props.page === p.id ? ' on' : '')} aria-current={props.page === p.id ? 'page' : undefined} onClick={() => props.onPage(p.id)}>
              {/* AI 这一页画 AI 对话现在用的那一家的标志（同右下角圆钮） */}
              {p.id === 'ai' ? <AiIcon job="chat" size={16} /> : <Codicon name={p.icon} />}
              {p.name}
              {p.id === 'update' && props.updateReady && <span className="udot nav" aria-label="新版本已下好" />}
            </button>
          ))}
        </nav>
        <div className="set-body">
          <button className="iconbtn set-x" hidden={props.asTab} aria-label="关上设置" title="关上 esc" onClick={props.onClose}>
            <Codicon name="close" size={14} />
          </button>
          {props.page === 'look' && <LookPage {...props} />}
          {props.page === 'home' && <HomePage {...props} />}
          {props.page === 'vault' && <VaultPage {...props} />}
          {props.page === 'ai' && (
            <>
              <AiSettingsPage onNotice={props.onNotice} onPlugins={() => props.onPage('plugins')} focus={aiFocus} />
              <SttKey onNotice={props.onNotice} />
            </>
          )}
          {props.page === 'dream' && <DreamSettingsPage settings={props.settings} onChange={props.onChange} onNotice={props.onNotice} onOpenDream={props.onOpenDream} onAiRow={() => (setAiFocus('dream'), props.onPage('ai'))} />}
          {props.page === 'plugins' && <PluginsSettings onNotice={props.onNotice} />}
          {props.page === 'git' && <GitPage {...props} />}
          {props.page === 'keys' && <KeysPage />}
          {props.page === 'update' && (
            <UpdatePage
              autoUpdate={props.settings.autoUpdate}
              onAutoUpdate={(v) => void props.onChange({ autoUpdate: v })}
              onInstall={props.onInstallUpdate}
              onOpenUrl={props.onOpenUrl}
            />
          )}
        </div>
      </div>
    </div>
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
      <div role="radiogroup" aria-label="主题">
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
      <div className="pair plain imp-theme">
        <button className="btn" onClick={() => void importTheme()} disabled={importing}>
          <Codicon name={importing ? 'loading' : 'add'} size={14} className={importing ? 'spin' : undefined} />
          导入VS Code主题…
        </button>
        <span className="note">选 .json或 .vsix；对不上的颜色按底色和字色算</span>
      </div>

      <div className="pair">
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
      <div className="hstyles frames" role="radiogroup" aria-label="界面风格">
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
      <div className="bgs" role="radiogroup" aria-label="窗口背景">
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
    <label className="pair hs-winbg">
      <input type="checkbox" checked={props.settings.appearance.homeWinBg} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>整页背景用窗口背景那张图</span>
      <span className="note">现在：{winBgName(props.settings)}</span>
    </label>
  )
}

function HomeStylePicker(props: { value: 'a' | 'b'; onChange(v: 'a' | 'b'): void }) {
  return (
    <div className="hstyles" role="radiogroup" aria-label="首页样式">
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
      <div className={'covers' + (homeWinBg(props.settings) ? ' off' : '')}>
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
      <div className="wlist-set">
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

function VaultPage(props: { vault: VaultInfo; onSwitchVault(): void; settings: AppSettings; onChange(p: Patch): Promise<AppSettings>; onClose(): void }) {
  return (
    <>
      <h4>现在的库</h4>
      <div className="card-row">
        <span className="vi">
          <Codicon name="library" />
        </span>
        <div className="tx">
          <b>{props.vault.name}</b>
          <span title={props.vault.path}>{props.vault.path.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
      </div>
      <p className="note">库就是一个文件夹，里面是普通的md文件；没有Git的话打开时会帮你建一个。换库前，这个库没提交的改动会先提交。</p>
      <button className="btn" onClick={props.onSwitchVault}>
        <Codicon name="folder-opened" size={14} />
        打开别的文件夹…
      </button>
      <h4>
        导入旧笔记<span>备忘录或旧的Obsidian库：先进收件箱，梦游时分好类、起好名字，你预览了再收下</span>
      </h4>
      <button
        className="btn"
        onClick={() => {
          props.onClose()
          openImport()
        }}
      >
        <Codicon name="root-folder" size={14} />
        导入旧笔记…
      </button>
      <h4>
        自动归档<span>很久没改的笔记从左栏收进「归档」；文件不挪、不改，置顶的不归档，改一下就回到左栏</span>
      </h4>
      <div className="pair">
        <span>归档</span>
        <select aria-label="自动归档" value={props.settings.archiveDays} onChange={(e) => void props.onChange({ archiveDays: Number(e.target.value) as ArchiveDays })}>
          {ARCHIVE_CHOICES.map((d) => (
            <option key={d} value={d}>
              {archiveLabel(d)}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

/** 听写（Soniox）密钥：没字幕的视频「生成字幕」时用（CN-69）。加密存在这台 Mac 上，界面只看得到最后 4 位 */
function SttKey(props: { onNotice(t: string): void }) {
  const [st, setSt] = useState<{ has: boolean; tail: string | null; fromEnv: boolean } | null>(null)
  const [val, setVal] = useState('')
  useEffect(() => void window.cnVideo.sttKey().then(setSt), [])
  const errText = (err: unknown) => String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const save = async (key: string | null) => {
    try {
      setSt(await window.cnVideo.setSttKey(key))
      setVal('')
      props.onNotice(key ? 'Soniox密钥存好了' : 'Soniox密钥删掉了')
    } catch (err) {
      props.onNotice(errText(err))
    }
  }
  return (
    <>
      <h4>
        听写（Soniox）密钥<span>没字幕的视频「生成字幕」时用：下载音频交给Soniox听写，约 ¥0.7一小时</span>
      </h4>
      <form
        className="pair"
        onSubmit={(e) => {
          e.preventDefault()
          if (val.trim()) void save(val)
        }}
      >
        <span>密钥</span>
        <input className="field mono" type="password" aria-label="Soniox 密钥" placeholder={st?.tail ? `已填 ••••${st.tail}` : '粘贴Soniox的API Key'} value={val} onChange={(e) => setVal(e.target.value)} />
        <button className="btn btn-sm" type="submit" disabled={!val.trim()}>
          <Codicon name="save" size={14} />
          保存
        </button>
        {st?.tail && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void save(null)}>
            删掉
          </button>
        )}
      </form>
      <p className="note" data-testid="stt-key-state">
        {st?.tail ? `已填 ••••${st.tail}，加密存在这台Mac上` : st?.fromEnv ? '用的是环境变量SONIOX_API_KEY' : '还没填：到soniox.com注册后在控制台拿一个API Key'}
      </p>
    </>
  )
}

/**
 * 提交署名：每次提交记进历史的名字和邮箱。这台 Mac 上 git 没设时，打开库时软件按系统用户给这个库设了一个（main/git-identity.ts）；
 * 这里看得到、能改（只改这个库的 .git/config）
 */
function GitIdentity(props: { onNotice(t: string): void }) {
  const [id, setId] = useState<{ name: string; email: string; local: boolean } | null | undefined>(undefined)
  const [draft, setDraft] = useState<{ name: string; email: string } | null>(null)
  /** 存不进去的原因（邮箱格式不对……）：写在输入框下面，不跑到底栏 */
  const [bad, setBad] = useState('')
  const errText = (err: unknown) => String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  useEffect(() => void window.cn.gitIdentity().then(setId), [])
  async function save() {
    if (!draft) return
    try {
      setId(await window.cn.setGitIdentity(draft.name, draft.email))
      setDraft(null)
      setBad('')
      props.onNotice('提交署名改好了，以后的提交用它')
    } catch (err) {
      setBad(errText(err))
    }
  }
  const cancel = () => (setDraft(null), setBad(''))
  return (
    <>
      <h4>
        提交署名<span>每次提交记进历史的名字和邮箱；同步后远程仓库也看得到</span>
      </h4>
      {draft ? (
        <form
          className="pair"
          aria-label="改提交署名"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          onKeyDown={(e) => {
            // Esc 只收起这一行（第 5 轮：以前整个设置关掉，填的字丢了）
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }}
        >
          <span>名字和邮箱</span>
          <input className="field id-name" aria-label="署名的名字" placeholder="名字" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          <input className="field" aria-label="署名的邮箱" aria-invalid={!!bad || undefined} placeholder="邮箱" value={draft.email} onChange={(e) => (setDraft({ ...draft, email: e.target.value }), setBad(''))} />
          <button className="btn btn-sm" type="submit" disabled={!draft.name.trim() || !draft.email.trim()}>
            <Codicon name="save" size={14} />
            保存
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={cancel}>
            取消
          </button>
        </form>
      ) : (
        <div className="pair" data-testid="git-identity">
          <span>名字和邮箱</span>
          {id === undefined ? (
            <span className="sp aside">正在读…</span>
          ) : id ? (
            <span className="sp truncate id-val">
              {id.name}
              <span className="id-mail">{id.email}</span>
            </span>
          ) : (
            <span className="sp id-none">
              <i className="dot warn" />
              还没有，提交会失败
            </span>
          )}
          <button className="btn btn-sm" type="button" disabled={id === undefined} onClick={() => setDraft({ name: id?.name ?? '', email: id?.email ?? '' })}>
            <Codicon name="edit" size={14} />
            改
          </button>
        </div>
      )}
      {draft && bad && (
        <p className="note id-bad" role="alert">
          <Codicon name="error" size={12} className="ic" />
          <span>{bad}</span>
        </p>
      )}
      {/* 库里、全局都没有署名时不提全局设置（第 5 轮：那一行说「还没有」，下面却说「用的是全局设置」） */}
      {id !== undefined && <p className="note">{id?.local ? '写在这个库里，只用在这个库' : id ? '用的是这台Mac上Git的全局设置；改了只改这个库' : '填上后写在这个库里，只用在这个库'}</p>}
    </>
  )
}

function GitPage(props: { settings: AppSettings; onChange(p: Patch): Promise<AppSettings>; onSync(): Promise<void>; onNotice(t: string): void; onGitChanged(): void }) {
  const [remote, setRemote] = useState<string>('')
  const [saved, setSaved] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<{ at: number; text: string } | null>(null)
  const readState = () =>
    window.cn.gitState().then((g) => {
      setLastSync(g.lastSync)
      setSyncError(g.syncError)
    })
  useEffect(() => {
    void window.cn.gitRemote().then((r) => {
      setRemote(r?.url ?? '')
      setSaved(r?.url ?? null)
    })
    void readState()
  }, [])
  const dirty = !!remote.trim() && remote.trim() !== saved
  const errText = (err: unknown) => String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  async function save() {
    try {
      const r = await window.cn.setGitRemote(remote)
      setSaved(r?.url ?? null)
      props.onNotice('远程地址存好了')
      props.onGitChanged()
    } catch (err) {
      props.onNotice(errText(err))
    }
  }
  // 离开这一页（换到别的设置页、关上设置）时，填了没存的地址自动存
  const latest = useRef({ remote, dirty })
  latest.current = { remote, dirty }
  useEffect(
    () => () => {
      const { remote: url, dirty: unsaved } = latest.current
      if (!unsaved) return
      void window.cn.setGitRemote(url).then(
        () => (props.onNotice('远程地址存好了'), props.onGitChanged()),
        (err: unknown) => props.onNotice(errText(err)),
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const min = props.settings.autoCommitMinutes
  return (
    <>
      <GitIdentity onNotice={props.onNotice} />
      <h4>
        自动提交<span>没提交的改动到点自动提交一次；退出、换库前也会提交</span>
      </h4>
      <div className="pair">
        <span>间隔</span>
        <select aria-label="自动提交间隔" value={min} onChange={(e) => void props.onChange({ autoCommitMinutes: Number(e.target.value) }).then(props.onGitChanged)}>
          {AUTO_COMMIT_CHOICES.map((m) => (
            <option key={m} value={m}>
              {autoCommitLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <h4>
        远程同步<span>同步 = 先提交，再拉，再推；只在你点「同步」时联网</span>
      </h4>
      <form
        className="pair"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) void save()
        }}
      >
        <span>远程地址</span>
        <input className="field mono" aria-label="远程地址" placeholder="比如git@github.com:你/笔记.git" value={remote} onChange={(e) => setRemote(e.target.value)} />
        {saved && !dirty ? (
          <button className="btn btn-sm" type="button" disabled>
            <Codicon name="check" size={14} />
            已保存
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" type="submit" disabled={!dirty}>
            <Codicon name="save" size={14} />
            保存
          </button>
        )}
      </form>
      <div className="git-state" data-testid="git-remote-state">
        {dirty ? (
          <>
            <i className="dot warn" />
            <span>
              地址还没保存：按 <kbd>↵</kbd> 或点「保存」
            </span>
            <span className="sp" />
            <span className="aside">离开这一页时也会自动存</span>
          </>
        ) : saved && syncError ? (
          <>
            <i className="dot warn" />
            <span>上次同步没成功（{when(syncError.at, { time: true })}）：{syncError.text}</span>
          </>
        ) : saved ? (
          <>
            <i className="dot ok" />
            <span>地址存好了 · {lastSync ? `上次同步${when(lastSync, { time: true })}` : '还没同步过：点「现在同步」推上去'}</span>
          </>
        ) : (
          <span className="aside">还没有远程仓库：先填地址，再同步</span>
        )}
      </div>
      <div className="pair plain">
        <button
          className={'btn btn-sm' + (saved && !dirty ? ' btn-primary' : '')}
          disabled={!saved || dirty || syncing}
          onClick={async () => {
            setSyncing(true)
            try {
              await props.onSync()
              await readState()
            } finally {
              setSyncing(false)
            }
          }}
        >
          <Codicon name="refresh" size={14} className={syncing ? 'spin' : ''} />
          {syncing ? '正在同步' : '现在同步'}
        </button>
        <span className="note">{saved && !dirty ? '底栏的「同步」也是这个' : '存好地址后才能同步'}</span>
      </div>
    </>
  )
}

const KEYS: [string, string, string?][] = [
  ['速记', '⌥⌘N', '在任何软件里都能按'],
  ['搜索', '⌘F', '⌘K 也行'],
  ['打开 / 关上AI', '⌘J', '在网页里也能按'],
  ['收起 / 展开左栏', '⌘\\'],
  ['新建笔记', '⌘N'],
  ['关掉标签', '⌘W'],
  ['新网页', '⌘T', '右栏网页'],
  ['地址栏', '⌘L', '右栏网页'],
  ['双语翻译', '⌥A', '右栏网页 · 再按一次恢复原文'],
  ['设置', '⌘,'],
]

function KeysPage() {
  return (
    <>
      <h4>
        快捷键<span>这一组现在还不能改</span>
      </h4>
      <div className="keys-list">
        {KEYS.map(([name, k, note]) => (
          <div key={name} className="row">
            <span>{name}</span>
            {note && <span className="note">{note}</span>}
            <span className="sp" />
            <kbd>{k}</kbd>
          </div>
        ))}
      </div>
      <VideoKeys />
    </>
  )
}
