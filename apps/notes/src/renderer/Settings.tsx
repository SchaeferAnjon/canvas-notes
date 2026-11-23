import { Codicon, type CodiconName } from '@cn/design'
import { DreamSettingsPage } from './settings-dream'
import { AutoSettingsPage } from './settings/auto'
import { AiIcon } from './engine-logo'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { VaultInfo } from '../shared/api'
import { activeSkin, allSkins, type AppSettings, pickSkin, type SettingsPatch, setFollowSystem, type WinBg } from '../shared/appearance'
import { searchSettings, settingsItem, SETTINGS_PAGES, SETTINGS_SECTIONS, type SettingsItem, type SettingsPageId } from '../shared/settings-index'
import { COVER_GRADIENTS, COVER_PHOTOS, hideWidget, showWidget, WIDGETS, type Cover } from '../shared/home'
import { COVERS, coverImage, WINBG_THUMBS } from './covers'
import { homeWinBg, reloadUserThemes, userSkinInfos, useUserThemes, winBgName } from './theme'
import { saveHome, useHomeConfig } from './home-store'
import { list, t as tNow, tIn } from '../shared/i18n'
import { useLangInfo, useT } from './i18n'
import { PluginsSettings } from './plugins'
import { PageHead } from './settings/ui'
import { AppearancePage, SettingsShell, Toggle, useSaid } from '@cn/design/settings'

/** 方角开关：共用的那个（设置各页、插件、视频条从这里拿） */
export { Toggle }
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
import { FamilySettingsPage } from './settings/family'
import { KeysPage } from './settings/keys'
import { AdvancedPage } from './settings/advanced'
import { SelBarPage } from './settings/sel-bar'
import '@cn/design/settings.css'
import './settings.css'
import './settings/settings-a.css'

/** 设置的 16 页（方向 A，shared/settings-index.ts） */
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
  onGoPlace(place: 'web-extensions' | 'video-subs'): void
  /** 翻到另一页的某一行、闪一下（「排顺序 ›」「去AI页换 ›」「去Git和同步 ›」、搜索回车） */
  onGoRow(row: string): void
}

/** 设置：B 里是居中弹窗，A 里是中间的一个标签（⌘, 打开）。左边分段的侧栏和搜索，右边一页。框架是共用的 @cn/design/settings（画布今日也用） */
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
  const t = useT()
  const [q, setQ] = useState('')
  /** 设置 › 自动化里点了「周记」：那一页换成周记的设置（换页就回来） */
  const [autoSub, setAutoSub] = useState<'weekly' | null>(null)
  useEffect(() => setAutoSub(null), [props.page])
  // 搜到、或从别处跳到周记那几项（每周几、几点……）：先进周记那一页，那一行才在（不然翻到自动化页、哪一行都不闪）
  // 只认新的一次跳（seq 变了）：之后点侧栏回到自动化页不再进周记
  const subSeq = useRef(0)
  useEffect(() => {
    const f = props.focus
    if (props.page !== 'auto' || !f || f.seq === subSeq.current) return
    subSeq.current = f.seq
    setAutoSub(settingsItem(f.row)?.sub ?? null)
  }, [props.page, props.focus?.seq])
  const input = useRef<HTMLInputElement>(null)
  // 「界面语言」那一行没放出来时搜不到（main/lang.ts 的 LANG_SWITCH）
  const langOn = !!useLangInfo()?.available
  const hits = useMemo(() => searchSettings(q, (s) => tIn('en', s)).filter((it) => it.id !== 'lang' || langOn), [q, langOn])
  const go = (it: SettingsItem) => props.onGoRow(it.id)
  const page = SETTINGS_PAGES.find((p) => p.id === props.page) ?? SETTINGS_PAGES[0]!
  const sections = SETTINGS_SECTIONS.map((sec) => ({
    name: t(sec),
    pages: SETTINGS_PAGES.filter((p) => p.sec === sec).map((p) => ({
      id: p.id,
      name: t(p.name),
      // AI 这一页画 AI 对话现在用的那一家的标志（同右下角圆钮）
      icon: p.id === 'ai' ? <AiIcon job="chat" size={16} /> : <Codicon name={p.icon as CodiconName} />,
      after: p.id === 'general' && props.updateReady ? <span className="udot nav" aria-label={t('新版本已下好')} /> : undefined,
    })),
  }))
  const search = (
    <label className="sa-srch">
      <Codicon name="search" size={14} />
      <input
        ref={input}
        value={q}
        placeholder={t('搜设置：字号、同步…')}
        aria-label={t('搜设置')}
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
        <button type="button" className="clr" aria-label={t('清空')} onClick={() => (setQ(''), input.current?.focus())}>
          <Codicon name="close" size={14} />
        </button>
      )}
    </label>
  )
  const results = q ? (
    <div className="sa-res" role="list" aria-label={t('搜到的设置')}>
      {hits.length ? (
        <>
          <div className="sa-rhead">{t('{n} 项', { n: hits.length })}</div>
          {hits.slice(0, 30).map((it, i) => (
            <button key={it.id} type="button" role="listitem" className={'sa-rrow' + (i === 0 ? ' sel' : '')} data-go={it.id} onClick={() => go(it)}>
              <b>
                <Mark text={t(it.label)} q={q} />
              </b>
              <small>{t('{page} › {group}', { page: t(SETTINGS_PAGES.find((p) => p.id === it.pg)!.name), group: t(it.grp) })}</small>
            </button>
          ))}
        </>
      ) : (
        <div className="sa-rempty">
          {t('没找到「{q}」。', { q: q.trim() })}
          <br />
          {t('试试')}{' '}
          {[t('字号'), t('同步'), t('下载')].map((w, i) => (
            <Fragment key={w}>
              {i > 0 && t('、', { ctx: '列举' })}
              <button type="button" className="sa-lnk" onClick={() => setQ(w)}>
                {w}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  ) : undefined
  const text = useMemo(() => ({ title: t('设置'), nav: t('设置分页'), close: t('关上设置'), closeTip: t('关上 esc'), saved: (hint: string) => tNow('已存 · {hint}', { hint }), undo: t('撤回') }), [t])

  return (
    <SettingsShell
      text={text}
      sections={sections}
      page={props.page}
      onPage={(id) => props.onPage(id as SettingsPage)}
      onClose={props.onClose}
      asTab={props.asTab}
      navTop={search}
      navBody={results}
      focus={props.focus}
      appNotice={props.appNotice}
    >
      {/* 选中小条那一页自己画页头（编辑一颗时换成那一颗的）；自动化点了「周记」换成周记的页头 */}
      {props.page !== 'selbar' && !(props.page === 'auto' && autoSub) && <PageHead page={page} />}
      <SettingsPageBody {...props} autoSub={props.page === 'auto' ? autoSub : null} onAutoSub={setAutoSub} />
    </SettingsShell>
  )
}

/** 右边这一页的内容：设置开着时页里的话都在设置底下说（B 的弹窗盖住了底栏的提示） */
function SettingsPageBody(props: SettingsProps & { page: SettingsPage; autoSub: 'weekly' | null; onAutoSub(s: 'weekly' | null): void }) {
  const said = useSaid()
  const notice = said.say
  const pp = { ...props, onNotice: notice }
  return (
    <>
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
      {props.page === 'auto' && <AutoSettingsPage {...pp} sub={props.autoSub} onSub={props.onAutoSub} />}
      {props.page === 'selbar' && <SelBarPage />}
      {props.page === 'vault' && <VaultPage {...pp} />}
      {props.page === 'git' && <GitPage {...pp} />}
      {props.page === 'privacy' && <PrivacyPage {...pp} />}
      {props.page === 'family' && <FamilySettingsPage {...pp} />}
      {props.page === 'plugins' && (
        <div className="sa-keep">
          <PluginsSettings onNotice={notice} />
        </div>
      )}
      {props.page === 'keys' && <KeysPage {...pp} />}
      {props.page === 'advanced' && <AdvancedPage {...pp} />}
    </>
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

function LookPage(props: { settings: AppSettings; systemDark: boolean; onChange(p: Patch): Promise<AppSettings>; onNotice(t: string): void }) {
  const t = useT()
  const a = props.settings.appearance
  const set = (appearance: Partial<AppSettings['appearance']>) => void props.onChange({ appearance })
  const user = userSkinInfos(useUserThemes())
  // 自带的十套照英文名（Mint、Pine…）；导入的 VS Code 主题用它自己的名字
  const skins = allSkins(user).map((s) => ({ id: s.id, tab: s.tab, tone: s.tone, name: t(s.name), note: t(s.note), imported: s.imported }))
  const bgs: { id: WinBg; name: string; bg: string }[] = [
    { id: 'none', name: t('不用图'), bg: 'var(--title)' },
    { id: 'aurora', name: t('极光照片'), bg: `url("${WINBG_THUMBS.aurora}") center/cover` },
    { id: 'cave', name: t('冰洞照片'), bg: `url("${WINBG_THUMBS.cave}") center/cover` },
  ]
  const importTheme = async () => {
    try {
      const r = await window.cn.importTheme()
      if (!r) return
      await reloadUserThemes()
      await props.onChange({ appearance: r.settings.appearance })
      props.onNotice(r.added.length > 1 ? tNow('导入了{n}套：{names}', { n: r.added.length, names: list(r.added.map((x) => x.name)) }) : tNow('导入了「{name}」，已经用上', { name: r.added[0]!.name }))
    } catch (e) {
      props.onNotice(tNow('导入失败：{err}', { err: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
    }
  }
  return (
    <AppearancePage
      text={{
        theme: t('主题'),
        themeHint: t('点一张就换'),
        themeHintSys: t('跟着系统：点浅色换白天那套，点深色换夜里那套'),
        light: t('浅色'),
        dark: t('深色'),
        imported: t('导入的VS Code主题'),
        day: t('白天'),
        night: t('夜里'),
        follow: t('跟着系统换浅深'),
        dayUse: t('白天用'),
        nightUse: t('夜里用'),
        frame: t('界面风格'),
        frameHint: t('结构一样，只换样子和几处位置'),
        winBg: t('窗口背景'),
        winBgHintA: t('换成B浮岛书桌时铺满整个窗口；A照VS Code不用'),
        winBgHintB: t('浮岛书桌铺满整个窗口，哪套主题都能配；照片会压暗一点'),
      }}
      skins={skins}
      current={activeSkin(a, props.systemDark)}
      followSystem={a.followSystem}
      day={a.day}
      night={a.night}
      onPick={(s) => set(pickSkin(a, s))}
      onFollow={(v) => set(setFollowSystem(a, v, props.systemDark))}
      onDay={(day) => set({ day })}
      onNight={(night) => set({ night })}
      frame={{
        value: a.frame,
        pv: coverImage({ kind: 'builtin', id: 'aurora' }, true),
        a: { name: t('照VS Code'), note: t('平的、细线分区；标签下有位置；底栏写满，AI在底栏最右') },
        b: { name: t('浮岛书桌'), note: t('背景图铺满窗口，三块圆角磨砂面板；AI是右下角圆按钮') },
        onChange: (frame) => set({ frame }),
      }}
      winBg={{
        value: a.winBg,
        options: bgs,
        onChange: (winBg) => set({ winBg }),
        extra: (
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
            {t('从电脑选')}
          </button>
        ),
      }}
      importTheme={{
        label: t('导入VS Code主题…'),
        note: t('选 .json或 .vsix；对不上的颜色按底色和字色算'),
        run: importTheme,
        removeLabel: (name) => t('删掉 {name}', { name }),
        removeTip: t('删掉这套导入的主题'),
        remove: async (s) => {
          const next = await window.cn.removeTheme(s.id)
          await reloadUserThemes()
          await props.onChange({ appearance: next.appearance })
          props.onNotice(tNow('删掉了「{name}」', { name: s.name }))
        },
      }}
      home={{
        title: t('首页样式'),
        hint: t('两种都能自己摆组件、换封面'),
        body: (
          <>
            <HomeStylePicker value={a.homeStyle} onChange={(homeStyle) => set({ homeStyle })} />
            <HomeWinBgRow settings={props.settings} onChange={(homeWinBg) => set({ homeWinBg })} />
          </>
        ),
      }}
    />
  )
}

/** 首页样式选 B 时多一行：整页背景用窗口背景那张图（CN-52）；勾上后首页里的「换封面」变灰 */
function HomeWinBgRow(props: { settings: AppSettings; onChange(v: boolean): void }) {
  const t = useT()
  if (props.settings.appearance.homeStyle !== 'b') return null
  return (
    <label className="pair hs-winbg" data-row="homeWinBg">
      <input type="checkbox" checked={props.settings.appearance.homeWinBg} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>{t('整页背景用窗口背景那张图')}</span>
      <span className="note">{t('现在：{name}', { name: t(winBgName(props.settings)) })}</span>
    </label>
  )
}

function HomeStylePicker(props: { value: 'a' | 'b'; onChange(v: 'a' | 'b'): void }) {
  const t = useT()
  return (
    <div className="hstyles" role="radiogroup" aria-label={t('首页样式')} data-row="homeStyle">
      {(
        [
          ['a', t('封面长图'), t('上面一条封面，下面组件网格')],
          ['b', t('整页背景'), t('图铺满首页，组件是半透明玻璃')],
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
  const t = useT()
  const cfg = useHomeConfig()
  if (!cfg) return null
  const isCover = (c: Cover) => (c.kind === 'file' ? cfg.cover.kind === 'file' && cfg.cover.path === c.path : cfg.cover.kind === 'builtin' && cfg.cover.id === c.id)
  return (
    <>
      <h4>
        {t('首页样式')}
        <span>{t('首页上的「编辑首页」改的也是这里')}</span>
      </h4>
      <HomeStylePicker value={props.settings.appearance.homeStyle} onChange={(homeStyle) => void props.onChange({ appearance: { homeStyle } })} />
      <HomeWinBgRow settings={props.settings} onChange={(homeWinBg) => void props.onChange({ appearance: { homeWinBg } })} />
      <h4>
        {t('封面')}
        <span>{homeWinBg(props.settings) ? t('现在首页用的是窗口背景那张图（上面的勾），这里换了也不显示') : t('存在库里，跟着Git走')}</span>
      </h4>
      <div className={'covers' + (homeWinBg(props.settings) ? ' off' : '')} data-row="cover">
        {[...COVER_PHOTOS, ...COVER_GRADIENTS].map((id) => {
          const c: Cover = { kind: 'builtin', id }
          return (
            <button key={id} className={isCover(c) ? 'on' : ''} aria-pressed={isCover(c)} title={t(COVERS.find((x) => x.id === id)!.name)} onClick={() => void saveHome({ ...cfg, cover: c })}>
              <i style={{ backgroundImage: coverImage(c, true) }} />
              {t(COVERS.find((x) => x.id === id)!.name)}
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
          {t('从电脑选')}
        </button>
      </div>
      <h4>
        {t('组件')}
        <span>{t('关掉的收进首页下面的抽屉，随时放回来')}</span>
      </h4>
      <div className="wlist-set" data-row="widgets">
        {WIDGETS.map((w) => {
          const on = cfg.order.includes(w.id)
          return (
            <div key={w.id} className="row">
              <span>{t(w.name)}</span>
              <span className="sp" />
              <Toggle on={on} label={t(w.name)} onChange={(v) => void saveHome(v ? showWidget(cfg, w.id) : hideWidget(cfg, w.id))} />
            </div>
          )
        })}
      </div>
    </>
  )
}
