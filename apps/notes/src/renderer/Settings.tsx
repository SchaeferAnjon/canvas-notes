import { Icon } from '@cn/design'
import { Bot, Check, FolderOpen, GitBranch, Home, Image as ImageIcon, Keyboard, Library, Palette, Plus, Puzzle, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VaultInfo } from '../shared/api'
import type { EngineInfo } from '../shared/agent'
import { activeSkin, type AppSettings, AUTO_COMMIT_CHOICES, autoCommitLabel, pickSkin, setFollowSystem, SKINS, type SkinId, type WinBg } from '../shared/appearance'
import { ARCHIVE_CHOICES, archiveLabel, type ArchiveDays } from '../shared/sidebar'
import { COVER_GRADIENTS, COVER_PHOTOS, hideWidget, showWidget, WIDGETS, type Cover } from '../shared/home'
import { COVERS, coverImage, GRADIENTS, WINBG_THUMBS } from './covers'
import { saveHome, useHomeConfig } from './home-store'
import { PluginsSettings } from './plugins'
import './settings.css'

export type SettingsPage = 'look' | 'home' | 'vault' | 'ai' | 'plugins' | 'git' | 'keys'

const PAGES: { id: SettingsPage; name: string; icon: typeof Palette }[] = [
  { id: 'look', name: '外观', icon: Palette },
  { id: 'home', name: '首页', icon: Home },
  { id: 'vault', name: '库', icon: Library },
  { id: 'ai', name: 'AI', icon: Bot },
  { id: 'plugins', name: '插件', icon: Puzzle },
  { id: 'git', name: 'Git 和同步', icon: GitBranch },
  { id: 'keys', name: '快捷键', icon: Keyboard },
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
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  return (
    <div className="set-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="set" role="dialog" aria-label="设置">
        <nav className="set-nav" aria-label="设置分页">
          <h3>设置</h3>
          {PAGES.map((p) => (
            <button key={p.id} className={'si' + (props.page === p.id ? ' on' : '')} aria-current={props.page === p.id ? 'page' : undefined} onClick={() => props.onPage(p.id)}>
              <Icon of={p.icon} />
              {p.name}
            </button>
          ))}
        </nav>
        <div className="set-body">
          <button className="iconbtn set-x" aria-label="关上设置" title="关上 esc" onClick={props.onClose}>
            <Icon of={X} size={14} />
          </button>
          {props.page === 'look' && <LookPage {...props} />}
          {props.page === 'home' && <HomePage {...props} />}
          {props.page === 'vault' && <VaultPage {...props} />}
          {props.page === 'ai' && <AiPage onNotice={props.onNotice} />}
          {props.page === 'plugins' && <PluginsSettings onNotice={props.onNotice} />}
          {props.page === 'git' && <GitPage {...props} />}
          {props.page === 'keys' && <KeysPage />}
        </div>
      </div>
    </div>
  )
}

/** 方角开关（用户偏好：开关的轨道和滑块都是小圆角方形） */
export function Toggle(props: { on: boolean; label: string; onChange(v: boolean): void }) {
  return <button className={'sw-toggle' + (props.on ? ' on' : '')} role="switch" aria-checked={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)} />
}

/** 一套主题的小窗口预览：用那套主题自己的变量画 */
function Mini({ skin }: { skin: SkinId }) {
  return (
    <div className="mini" data-skin={skin}>
      <div className="ms">
        <i className="on" />
        <i />
        <i />
        <i />
      </div>
      <div className="mc">
        <em />
        <b className="acc" />
        <b />
        <u />
      </div>
    </div>
  )
}

function LookPage(props: { settings: AppSettings; systemDark: boolean; onChange(p: Patch): Promise<AppSettings>; onNotice(t: string): void }) {
  const a = props.settings.appearance
  const now = activeSkin(a, props.systemDark)
  const set = (appearance: Partial<AppSettings['appearance']>) => void props.onChange({ appearance })
  const deep = now === 'deepsea'
  const bgs: { id: WinBg; name: string; bg: string }[] = [
    { id: 'glow', name: '深海光', bg: GRADIENTS.glow! },
    { id: 'aurora', name: '极光照片', bg: `url("${WINBG_THUMBS.aurora}") center/cover` },
    { id: 'cave', name: '冰洞照片', bg: `url("${WINBG_THUMBS.cave}") center/cover` },
  ]
  return (
    <>
      <h4>
        主题 <span>{a.followSystem ? '跟着系统：点浅色换白天那套，点深色换夜里那套' : '点一张就换'}</span>
      </h4>
      <div className="skins" role="radiogroup" aria-label="主题">
        {SKINS.map((s) => {
          const slot = a.followSystem ? (a.day === s.id ? '白天' : a.night === s.id ? '夜里' : null) : null
          return (
            <button key={s.id} className={'sk' + (now === s.id ? ' on' : '')} role="radio" aria-checked={now === s.id} data-skin-card={s.id} onClick={() => set(pickSkin(a, s.id))}>
              <Mini skin={s.id} />
              <span className="nm">
                {s.name}
                {slot && <em className="slot">{slot}</em>}
                <span className="tone">{s.tone === 'light' ? '浅色' : '深色'}</span>
              </span>
              <span className="ds">{s.note}</span>
            </button>
          )
        })}
      </div>

      <div className="pair">
        <Toggle on={a.followSystem} label="跟着系统换浅深" onChange={(v) => set(setFollowSystem(a, v, props.systemDark))} />
        <span>跟着系统换浅深</span>
        {a.followSystem && (
          <>
            <span className="sp" />
            <label>
              白天用
              <select aria-label="白天用" value={a.day} onChange={(e) => set({ day: e.target.value as SkinId })}>
                {SKINS.filter((s) => s.tone === 'light').map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              夜里用
              <select aria-label="夜里用" value={a.night} onChange={(e) => set({ night: e.target.value as SkinId })}>
                {SKINS.filter((s) => s.tone === 'dark').map((s) => (
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
        首页样式 <span>两种都能自己摆组件、换封面</span>
      </h4>
      <HomeStylePicker value={a.homeStyle} onChange={(homeStyle) => set({ homeStyle })} />

      <h4>
        窗口背景 <span>{deep ? '照片会压暗到字能看清' : '只有深海蓝用得上'}</span>
      </h4>
      <div className={'bgs' + (deep ? '' : ' off')} role="radiogroup" aria-label="窗口背景" aria-disabled={!deep}>
        {bgs.map((b) => (
          <button key={b.id} role="radio" aria-checked={a.winBg === b.id} className={a.winBg === b.id ? 'on' : ''} disabled={!deep} onClick={() => set({ winBg: b.id })}>
            <i style={{ background: b.bg }} />
            {b.name}
          </button>
        ))}
        <button
          role="radio"
          aria-checked={a.winBg === 'custom'}
          className={a.winBg === 'custom' ? 'on' : ''}
          disabled={!deep}
          onClick={async () => {
            if (a.winBg !== 'custom' || !a.winBgFile) {
              const next = await window.cn.pickWinBg()
              if (next) await props.onChange({ appearance: next.appearance })
            } else set({ winBg: 'custom' })
          }}
        >
          <i className="up" style={a.winBgFile ? { background: `url("cn-file://app/backgrounds/${encodeURIComponent(a.winBgFile)}") center/cover` } : undefined}>
            {!a.winBgFile && <Icon of={Plus} size={16} />}
          </i>
          从电脑选
        </button>
      </div>

      <h4>
        强调色 <span>每套主题里的李子紫，只用在选中和标记上</span>
      </h4>
      <div className="accrow">
        {SKINS.map((s) => (
          <div key={s.id} data-skin={s.id}>
            <i style={{ background: 'var(--acc)' }} />
            {s.name}
            {s.id === 'fam-light' || s.id === 'fam-dark' ? (s.tone === 'light' ? '浅' : '深') : ''}
          </div>
        ))}
      </div>
    </>
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
        首页样式 <span>首页上的「编辑首页」改的也是这里</span>
      </h4>
      <HomeStylePicker value={props.settings.appearance.homeStyle} onChange={(homeStyle) => void props.onChange({ appearance: { homeStyle } })} />
      <h4>
        封面 <span>存在库里，跟着 Git 走</span>
      </h4>
      <div className="covers">
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
            {cfg.cover.kind !== 'file' && <Icon of={ImageIcon} size={16} />}
          </i>
          从电脑选
        </button>
      </div>
      <h4>
        组件 <span>关掉的收进首页下面的抽屉，随时放回来</span>
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

function VaultPage(props: { vault: VaultInfo; onSwitchVault(): void; settings: AppSettings; onChange(p: Patch): Promise<AppSettings> }) {
  return (
    <>
      <h4>现在的库</h4>
      <div className="card-row">
        <span className="vi">
          <Icon of={Library} />
        </span>
        <div className="tx">
          <b>{props.vault.name}</b>
          <span title={props.vault.path}>{props.vault.path.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
      </div>
      <p className="note">库就是一个文件夹，里面是普通的 md 文件；没有 Git 的话打开时会帮你建一个。换库前，这个库没提交的改动会先提交。</p>
      <button className="btn" onClick={props.onSwitchVault}>
        <Icon of={FolderOpen} size={14} />
        打开别的文件夹…
      </button>
      <h4>
        自动归档 <span>很久没改的笔记从左栏收进「归档」；文件不挪、不改，置顶的不归档，改一下就回到左栏</span>
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

function AiPage(props: { onNotice(t: string): void }) {
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [cur, setCur] = useState<string | null>(null)
  useEffect(() => {
    void window.cn.aiEngines().then((r) => {
      setEngines(r.engines)
      setCur(r.current)
    })
  }, [])
  return (
    <>
      <h4>
        默认引擎 <span>用这台 Mac 上已经登录的命令行，不另存密钥；AI 浮窗头上也能换</span>
      </h4>
      <div className="eng-list" role="radiogroup" aria-label="AI 引擎">
        {engines.map((e) => (
          <button
            key={e.id}
            role="radio"
            aria-checked={cur === e.id}
            className={'row' + (cur === e.id ? ' on' : '')}
            disabled={!e.path}
            onClick={async () => {
              try {
                await window.cn.aiSetEngine(e.id)
                setCur(e.id)
              } catch (err) {
                props.onNotice(String((err as Error).message))
              }
            }}
          >
            <span className="ck">{cur === e.id && <Icon of={Check} size={14} />}</span>
            <b>{e.label}</b>
            <span className="sp" />
            <span className="st">{e.path ? '已装好' : (e.hint ?? '没装')}</span>
          </button>
        ))}
      </div>
      <p className="note">AI 改的每一处都是一次提交，浮窗里能撤回；它不能自己写文件、跑命令，只能用软件给它的工具。</p>
    </>
  )
}

function GitPage(props: { settings: AppSettings; onChange(p: Patch): Promise<AppSettings>; onSync(): Promise<void>; onNotice(t: string): void; onGitChanged(): void }) {
  const [remote, setRemote] = useState<string>('')
  const [saved, setSaved] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    void window.cn.gitRemote().then((r) => {
      setRemote(r?.url ?? '')
      setSaved(r?.url ?? null)
    })
  }, [])
  const min = props.settings.autoCommitMinutes
  return (
    <>
      <h4>
        自动提交 <span>没提交的改动到点自动提交一次；退出、换库前也会提交</span>
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
        远程同步 <span>同步 = 先提交，再拉，再推；只在你点「同步」时联网</span>
      </h4>
      <form
        className="pair"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            const r = await window.cn.setGitRemote(remote)
            setSaved(r?.url ?? null)
            props.onNotice('远程地址存好了')
            props.onGitChanged()
          } catch (err) {
            props.onNotice(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          }
        }}
      >
        <span>远程地址</span>
        <input className="field" aria-label="远程地址" placeholder="比如 git@github.com:你/笔记.git" value={remote} onChange={(e) => setRemote(e.target.value)} />
        <button className="btn btn-sm" type="submit" disabled={!remote.trim() || remote.trim() === saved}>
          存
        </button>
      </form>
      <div className="pair plain">
        <button
          className="btn btn-sm"
          disabled={!saved || syncing}
          onClick={async () => {
            setSyncing(true)
            try {
              await props.onSync()
            } finally {
              setSyncing(false)
            }
          }}
        >
          <Icon of={RefreshCw} size={14} className={syncing ? 'spin' : ''} />
          {syncing ? '正在同步' : '现在同步'}
        </button>
        <span className="note">{saved ? '底栏的「同步」也是这个' : '还没有远程仓库：先填地址，再同步'}</span>
      </div>
    </>
  )
}

const KEYS: [string, string, string?][] = [
  ['速记', '⌥⌘N', '在任何软件里都能按'],
  ['搜索', '⌘F', '⌘K 也行'],
  ['AI', '⌘J'],
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
        快捷键 <span>现在还不能改</span>
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
    </>
  )
}
