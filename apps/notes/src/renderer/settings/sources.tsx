/**
 * 设置 › 库 › 同步来源（设计页 61-同步来源，原型 proto.html，用户 2026-11-23 看过定稿）：
 * - 「库」页里接在「导入」下面一组：接上的来源一行一个（各家图标、上次拉的结果、多久拉、放哪；右边「现在拉一次」和开关，点整行进子页），
 *   最后一行「接一个…」弹小菜单（库里已经有某家拉进来的排第一个）。没接任何来源的人只看到「接一个…」这一行；
 * - 子页照「自动化 › 周记」：← 名字 …… 开关；账号（Key 存这台 Mac 的钥匙串）、放到哪、什么时候拉、带什么、那边删了改了、拉取记录（能撤回）、断开；
 * - 第一次连上：对话框里分「比库里最新那篇还新的」（默认勾）和「更早的」（默认不勾，能展开一篇篇勾），主按钮直接写篇数。
 * 读写走 window.cn.sources（主进程 main/sources/），记录和撤回走自动化的（window.cn.auto.log / undo）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { PageHead as BasePageHead, Toggle } from '@cn/design/settings'
import { useEffect, useRef, useState } from 'react'
import type { AutoLogRow } from '../../shared/automation'
import type { FirstItem, FirstPlanInfo, SourceCatalogItem, SourceFail, SourceInfo, SourceProgress, SourceSettings, SourcesListing, SyncEvery } from '../../shared/sources'
import { sourceRuleName } from '../../shared/sources'
import flomoPng from '../assets/source-logos/flomo.png'
import getnotePng from '../assets/source-logos/getnote.png'
import raindropPng from '../assets/source-logos/raindrop.png'
import readwisePng from '../assets/source-logos/readwise.png'
import zoteroPng from '../assets/source-logos/zotero.png'
import { dateText } from '../../shared/when'
import { atText } from '../base/auto-text'
import { app } from '../ctx/actions'
import { useLang, useT } from '../i18n'
import type { SettingsProps } from '../Settings'
import { Group, Row, Sel, useSaid } from './ui'
import '../trash.css'
import './sources.css'

const LOGOS: Record<string, string> = { getnote: getnotePng, readwise: readwisePng, flomo: flomoPng, raindrop: raindropPng, zotero: zoteroPng }
/** 开放平台（填 Key 那一行「去开放平台 ›」） */
const OPENAPI: Record<string, string> = { getnote: 'https://www.biji.com/openapi' }

const api = () => window.cn.sources

export function SourceLogo(props: { id: string; size?: number }) {
  const src = LOGOS[props.id]
  return <span className="src-logo">{src ? <img src={src} width={props.size ?? 18} height={props.size ?? 18} alt="" /> : <Codicon name="cloud-download" size={16} />}</span>
}

/** 那边说不行：照 kind 说人话 */
function useFailText() {
  const t = useT()
  return (name: string, f: SourceFail): string => {
    if (f.kind === 'auth') return t('{name}不认这个Key：看看API Key和Client ID有没有抄全、是不是同一个应用的', { name })
    if (f.kind === 'nokey') return t('这台Mac还没填{name}的Key', { name })
    if (f.kind === 'perm') return t('{name}说这个应用没有「读笔记」的权限：在开放平台给它勾上', { name })
    if (f.kind === 'member') return t('{name}的开放接口要会员：开通以后再连', { name })
    if (f.kind === 'quota') return t('{name}的读取次数用完了，明天再拉', { name })
    if (f.kind === 'busy') return t('{name}说拉得太快了，过一会儿再拉', { name })
    if (f.kind === 'net') return t('连不上{name}：看看网络', { name })
    return f.error
  }
}

function useEveryLabel() {
  const t = useT()
  return (e: SyncEvery): string => ({ 'open+1h': t('开软件时和每小时'), 'open+2h': t('开软件时和每2小时'), 'open+22': t('开软件时和每天22:00'), open: t('只在开软件时'), manual: t('只手动') })[e]
}

function useListing() {
  const [list, setList] = useState<SourcesListing | null>(null)
  const [progress, setProgress] = useState<Record<string, SourceProgress>>({})
  useEffect(() => {
    const load = () => void api().list().then(setList)
    load()
    const offs = [api().onChanged(load), window.cn.auto.onChanged(load), api().onProgress((p) => setProgress((x) => ({ ...x, [p.id]: p })))]
    return () => offs.forEach((f) => f())
  }, [])
  const reload = () => void api().list().then(setList)
  return { list, reload, progress }
}

/** 记录里这一家的几行（新的在前；撤回的那一行不列） */
function useRuns(name: string | null) {
  const [rows, setRows] = useState<AutoLogRow[]>([])
  useEffect(() => {
    if (!name) return
    const load = () => void window.cn.auto.log({ rule: sourceRuleName(name), limit: 20 }).then((r) => setRows(r.filter((x) => !x.undo)))
    load()
    return window.cn.auto.onChanged(load)
  }, [name])
  return rows
}

/** 「设置 › 库」里的一组 */
export function SourcesGroup(props: SettingsProps & { onSub(id: string): void }) {
  const t = useT()
  const said = useSaid()
  const fail = useFailText()
  const every = useEveryLabel()
  const { list, reload, progress } = useListing()
  const zh = useLang() !== 'en'
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(menu, [box], () => setMenu(false))
  if (!list) return null
  const pull = async (s: SourceInfo) => {
    const r = await api().pull(s.id)
    reload()
    if (!r.ok) return said.say(fail(s.name, r))
    const log = r.log
    if (r.pulled && log) said.ok(t('{name}：拉了{n}篇进{folder}', { name: s.name, n: r.pulled, folder: s.settings.folder }), () => void window.cn.auto.undo(log), { label: t('看是哪几篇'), run: () => props.onSub(s.id) })
    else said.say(r.pulled ? t('{name}：拉了{n}篇进{folder}', { name: s.name, n: r.pulled, folder: s.settings.folder }) : t('{name}：没有新的', { name: s.name }))
  }
  const toggle = (s: SourceInfo, on: boolean) => {
    void api().settings(s.id, { on }).then(reload)
    said.saved(on ? t('{name}开了：{every}', { name: s.name, every: every(s.settings.every) }) : t('{name}关了：不再定时拉，「现在拉一次」照样能点', { name: s.name }), () => void api().settings(s.id, { on: !on }).then(reload))
  }
  // 库里已经有某家拉进来的排第一个；然后按界面语言（中文 Get笔记、flomo 在前）
  const catalog = [...list.catalog].sort((a, b) => b.inVault - a.inVault || Number(b.ready) - Number(a.ready) || Number(b.lang === (zh ? 'zh' : 'en')) - Number(a.lang === (zh ? 'zh' : 'en')))
  return (
    <Group
      label={t('同步来源')}
      row="sources"
      title={
        <>
          {t('同步来源')}
          <small className="src-gsub">{t('定时从别的服务拉进库；只拉，不改也不删那边')}</small>
        </>
      }
    >
      {list.sources.map((s) => {
        const p = progress[s.id]
        return (
          <div
            key={s.id}
            className="src-click"
            role="button"
            tabIndex={0}
            data-source={s.id}
            onClick={(e) => !(e.target as HTMLElement).closest('.sa-cc') && props.onSub(s.id)}
            onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && props.onSub(s.id)}
          >
            <Row
              id={`source-${s.id}`}
              label={
                <span className="src-name">
                  <SourceLogo id={s.id} />
                  <span className="src-nm">
                    <span className="src-t">
                      {s.name}
                      <Codicon name="chevron-right" size={12} />
                    </span>
                    <span className="src-ds">
                      <LastLine s={s} progress={p} />
                    </span>
                  </span>
                </span>
              }
              desc={null}
            >
              <button type="button" className="sa-btn" disabled={s.running || !s.hasKey} aria-label={t('现在拉一次{name}', { name: s.name })} onClick={() => void pull(s)}>
                <Codicon name={s.running ? 'loading' : 'sync'} size={14} className={s.running ? 'spin' : undefined} />
                {s.running ? t('在拉') : t('现在拉一次')}
              </button>
              <Toggle on={s.settings.on} label={s.name} onChange={(on) => toggle(s, on)} />
            </Row>
          </div>
        )
      })}
      <Row id="sourceAdd" label={list.sources.length ? t('再接一个') : t('从别的服务拉进库')} desc={t('有开放接口、能只读拉的服务；Key只存在这台Mac')}>
        <div className="sa-popwrap" ref={box}>
          <button type="button" className="sa-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Codicon name="add" size={14} />
            {t('接一个…')}
          </button>
          {menu && (
            <div className="sa-pop src-pop" role="menu" aria-label={t('能接的')}>
              <div className="mh">{t('能接的')}</div>
              {catalog
                .filter((c) => c.ready)
                .map((c) => (
                  <CatalogItem key={c.id} c={c} onPick={() => (setMenu(false), props.onSub(c.id))} />
                ))}
              {catalog.some((c) => !c.ready) && (
                <>
                  <div className="src-sep" role="separator" />
                  <div className="mh">{t('以后接')}</div>
                  {catalog
                    .filter((c) => !c.ready)
                    .map((c) => (
                      <CatalogItem key={c.id} c={c} onPick={() => undefined} />
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </Row>
    </Group>
  )
}

function CatalogItem(props: { c: SourceCatalogItem; onPick(): void }) {
  const t = useT()
  const c = props.c
  return (
    <button type="button" role="menuitem" disabled={!c.ready} onClick={props.onPick}>
      <SourceLogo id={c.id} />
      <span className="src-it">
        <b>{c.name}</b>
        {/* 不翻：主进程给的说明是中文；英文界面按 id 换 */}
        <span>{c.inVault ? t('库里有{n}篇来自{name}，接上就能接着拉', { n: c.inVault, name: c.name }) : catalogDesc(t, c)}</span>
      </span>
    </button>
  )
}

function catalogDesc(t: ReturnType<typeof useT>, c: SourceCatalogItem): string {
  if (c.id === 'getnote') return t('链接、图片、录音的AI笔记 · 填API Key和Client ID')
  if (c.id === 'readwise') return t('书和文章里的划线')
  if (c.id === 'flomo') return t('每一条memo')
  if (c.id === 'raindrop') return t('收藏的网址和划线')
  if (c.id === 'zotero') return t('文献和PDF标注')
  return c.desc
}

/** 一行第二行：在拉第几篇 / 上次几点拉了什么 · 多久拉 · 放哪 */
function LastLine(props: { s: SourceInfo; progress?: SourceProgress }) {
  const t = useT()
  const every = useEveryLabel()
  const runs = useRuns(props.s.name)
  const s = props.s
  const p = props.progress
  const last = runs[0]
  const head = s.running ? (p?.phase === 'pull' && p.total ? t('在拉{done}/{total}', { done: p.done, total: p.total }) : t('在读{name}的列表…', { name: s.name })) : !s.hasKey ? t('这台Mac还没填Key') : last ? `${atText(last.t)} ${last.ok ? last.did[0]!.split(' · ')[0] : last.error}` : s.lastPull ? t('{at}拉过', { at: atText(s.lastPull) }) : t('还没拉过')
  return (
    <>
      <span className={'src-dot' + (!s.hasKey || (last && !last.ok) ? ' off' : '')} />
      {head} · {every(s.settings.every)} · {s.settings.folder}
    </>
  )
}

// ---------------------------------------------------------------- 子页

export function SourcePage(props: SettingsProps & { id: string; onBack(): void }) {
  const t = useT()
  const said = useSaid()
  const fail = useFailText()
  const every = useEveryLabel()
  const { list, reload, progress } = useListing()
  const s = list?.sources.find((x) => x.id === props.id) ?? null
  const cat = list?.catalog.find((x) => x.id === props.id) ?? null
  const name = s?.name ?? cat?.name ?? ''
  const runs = useRuns(s ? name : null)
  const [editKey, setEditKey] = useState(false)
  const [key, setKey] = useState('')
  const [client, setClient] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<SourceFail | null>(null)
  const [first, setFirst] = useState<FirstPlanInfo | null>(null)
  const [folderEdit, setFolderEdit] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [ask, setAsk] = useState(false)
  if (!list) return null
  const keyed = !!s?.hasKey && !editKey
  const p = progress[props.id]

  const connect = async () => {
    setBusy(true)
    setErr(null)
    const r = await api().connect(props.id, key, client)
    setBusy(false)
    if (!r.ok) return setErr(r)
    setKey('')
    setClient('')
    setEditKey(false)
    if (s?.connected && s.settings.on) {
      // 换 Key：不再问拉哪些
      said.say(t('{name}的Key换好了', { name }))
      return reload()
    }
    setFirst(r.plan)
  }
  const set = (patch: Partial<SourceSettings>, hint: string, back: Partial<SourceSettings>) => {
    void api().settings(props.id, patch).then(reload)
    said.saved(hint, () => void api().settings(props.id, back).then(reload))
  }
  const pull = async () => {
    const r = await api().pull(props.id)
    reload()
    if (!r.ok) return said.say(fail(name, r))
    const log = r.log
    const text = r.pulled ? t('{name}：拉了{n}篇进{folder}', { name, n: r.pulled, folder: s?.settings.folder ?? '' }) : t('{name}：没有新的', { name })
    if (r.pulled && log) said.ok(text, () => void window.cn.auto.undo(log), { label: t('看是哪几篇'), run: () => setOpen(log) })
    else said.say(text)
  }
  const undo = async (row: AutoLogRow) => {
    const r = await window.cn.auto.undo(row.id)
    if (!r.ok) return said.say(t('撤回不了：{why}', { why: r.error }))
    said.ok(t('撤回了{at}那一次：拉来的这几篇删了，以后也不再拉', { at: atText(row.t) }))
  }
  const st = s?.settings
  const link = OPENAPI[props.id]

  return (
    <div className="src-set">
      <div className="au-subhead">
        <button type="button" className="ib" aria-label={t('回到库')} onClick={props.onBack}>
          <Codicon name="arrow-left" size={14} />
        </button>
        <BasePageHead icon={<SourceLogo id={props.id} size={20} />} title={name} desc={t('链接、图片、录音的AI笔记拉进库；只读，不在{name}里改、删任何东西', { name })} />
        {s && st && <Toggle on={st.on} label={name} onChange={(on) => set({ on }, on ? t('{name}开了：{every}', { name, every: every(st.every) }) : t('{name}关了：不再定时拉，「现在拉一次」照样能点', { name }), { on: !on })} />}
      </div>

      <Group title={t('账号')}>
        {keyed ? (
          <Row id="sourceKey" full label="API Key" desc={t('存在这台Mac的钥匙串，不进库、不进Git；别的Mac要拉就在那台再填一次')}>
            <div className="sa-inline">
              <span className="sa-fld mono src-keyshow">
                <Codicon name="key" size={14} />
                {s?.keyHint}
              </span>
              <button type="button" className="sa-btn" onClick={() => setEditKey(true)}>
                {t('换一个')}
              </button>
            </div>
          </Row>
        ) : (
          <Row
            id="sourceKey"
            full
            label={s?.hasKey ? t('换一个Key') : t('填Key')}
            desc={
              <>
                {t('在{name}开放平台建一个应用就有这两样，只要「读笔记」权限', { name })}
                {link && !err && (
                  <>
                    {' '}
                    <button type="button" className="sa-lnk" onClick={() => props.onOpenUrl(link)}>
                      {t('去开放平台 ›')}
                    </button>
                  </>
                )}
              </>
            }
            more={
              err && (
                <div className="src-err" role="alert">
                  <Codicon name="error" size={12} />
                  <span>
                    {fail(name, err)}
                    {err.link && (
                      <>
                        {' '}
                        <button type="button" className="sa-lnk" onClick={() => props.onOpenUrl(err.link!)}>
                          {err.kind === 'member' ? t('去开通 ›') : t('去开放平台 ›')}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )
            }
          >
            <form
              className="src-keyform"
              onSubmit={(e) => {
                e.preventDefault()
                if (key.trim() && client.trim() && !busy) void connect()
              }}
            >
              <input className="sa-fld mono" type="password" aria-label="API Key" placeholder={t('API Key（gk_live_…）')} value={key} onChange={(e) => (setKey(e.target.value), setErr(null))} autoFocus />
              <input className="sa-fld mono" aria-label="Client ID" placeholder={t('Client ID（cli_…）')} value={client} onChange={(e) => (setClient(e.target.value), setErr(null))} />
              <button type="submit" className="sa-btn primary" disabled={!key.trim() || !client.trim() || busy}>
                {busy && <Codicon name="loading" size={14} className="spin" />}
                {busy ? (p?.phase === 'list' ? t('在读列表{n}篇', { n: p.done }) : t('在连')) : t('连上')}
              </button>
              {s?.hasKey && (
                <button type="button" className="sa-btn ghost" onClick={() => (setEditKey(false), setErr(null))}>
                  {t('不换了')}
                </button>
              )}
            </form>
          </Row>
        )}
      </Group>

      {s && st && (
        <>
          <Group title={t('放到哪')}>
            <Row
              id="sourceFolder"
              full
              label={t('文件夹')}
              desc={
                st.folder === s.folderGuess && s.inVault
                  ? t('自己认出来的：库里{n}篇{name}都在这里和它下面。新的落在这一层，梦游照你的分法挪进子文件夹、连双链', { n: s.inVault, name })
                  : t('新的落在这一层，梦游照你的分法挪进子文件夹、连双链')
              }
            >
              {folderEdit === null ? (
                <div className="sa-inline">
                  <span className="sa-fld src-keyshow">
                    <Codicon name="folder" size={14} />
                    {st.folder}
                  </span>
                  <button type="button" className="sa-btn" onClick={() => setFolderEdit(st.folder)}>
                    {t('换…')}
                  </button>
                </div>
              ) : (
                <form
                  className="sa-inline"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = folderEdit.trim().replace(/^\/+|\/+$/g, '')
                    if (!f || f.split('/').includes('..')) return
                    set({ folder: f }, t('新的以后放进「{folder}」', { folder: f }), { folder: st.folder })
                    setFolderEdit(null)
                  }}
                >
                  <input className="sa-fld" aria-label={t('文件夹')} value={folderEdit} onChange={(e) => setFolderEdit(e.target.value)} autoFocus />
                  <button type="submit" className="sa-btn">
                    {t('存')}
                  </button>
                  <button type="button" className="sa-btn ghost" onClick={() => setFolderEdit(null)}>
                    {t('不换了')}
                  </button>
                </form>
              )}
            </Row>
            <Row id="sourceDedupe" label={t('认重复')} desc={t('按属性getnote_id（合并过的认getnote_ids）整个库里找，挪到哪、改了名都认得')}>
              <span className="sa-val">{t('已认出{n}篇', { n: s.inVault })}</span>
            </Row>
          </Group>

          <Group title={t('什么时候拉')}>
            <Row id="sourceEvery" label={t('定时')} desc={t('和自动化共用一个钟：自动化的总开关关了不定时拉，跑完告诉我照「自动化」那条设置')}>
              <Sel
                label={t('什么时候拉')}
                value={st.every}
                options={(['open+1h', 'open+2h', 'open+22', 'open', 'manual'] as const).map((e) => [e, every(e)] as const)}
                onChange={(v) => set({ every: v }, t('以后{every}拉', { every: every(v) }), { every: st.every })}
              />
            </Row>
          </Group>

          <Group title={t('带什么')}>
            <Row id="sourceImages" label={t('图片')} desc={t('下载进附件/。{name}的图片地址一个月左右就过期，不下的话以后是破图', { name })}>
              <Toggle on={st.images} label={t('图片')} onChange={(v) => set({ images: v }, v ? t('图片下进附件') : t('图片不下，链到{name}的地址（会过期）', { name }), { images: !v })} />
            </Row>
            <Row id="sourceTranscript" label={t('录音转写')} desc={t('逐句带时间，收在文末「录音转写」里，默认折起；录音文件不下，留「在{name}里听」的链接', { name })}>
              <Toggle on={st.transcript} label={t('录音转写')} onChange={(v) => set({ transcript: v }, v ? t('录音带上逐句转写') : t('录音只要总结，不带转写'), { transcript: !v })} />
            </Row>
            <Row id="sourceOriginal" label={t('链接的网页原文')} desc={t('收在文末「原文」里，默认折起；网址去掉微信那串跟踪参数')}>
              <Toggle on={st.original} label={t('链接的网页原文')} onChange={(v) => set({ original: v }, v ? t('链接带上网页原文') : t('链接只要总结，不带原文'), { original: !v })} />
            </Row>
            <Row id="sourceEmpty" label={t('跳过空录音')} desc={t('没有转写、AI也说「空白语音」的不拉，记在拉取记录里')}>
              <Toggle on={st.skipEmpty} label={t('跳过空录音')} onChange={(v) => set({ skipEmpty: v }, v ? t('空录音不拉') : t('空录音也拉'), { skipEmpty: !v })} />
            </Row>
          </Group>

          <Group title={t('{name}那边删了、改了', { name })}>
            <Row id="sourceDeleted" label={t('删了')} desc={t('库里那篇留着，标上「{name}里删了」和日期，搜得出来', { name })}>
              <span className="sa-val">{t('只标，不删')}</span>
            </Row>
            <Row id="sourceChanged" label={t('改了')} desc={t('库里那篇你和梦游都没动过就换成新的；动过就只标上「{name}里有新版」', { name })}>
              <span className="sa-val">{t('没动过才换')}</span>
            </Row>
          </Group>

          <Group
            label={t('拉取记录')}
            title={
              <>
                {t('拉取记录')}
                <small className="src-gsub">{t('每次一个提交，能撤回')}</small>
              </>
            }
          >
            <Row
              id="sourcePull"
              label={t('现在拉一次')}
              desc={s.running ? (p?.phase === 'pull' && p.total ? t('在拉{done}/{total}', { done: p.done, total: p.total }) : t('在读{name}的列表…', { name })) : [s.lastPull ? t('上次{at}', { at: atText(s.lastPull) }) : t('还没拉过'), s.next ? t('下次{at}', { at: atText(s.next) }) : ''].filter(Boolean).join(t('，', { ctx: '列举' }))}
            >
              <button type="button" className="sa-btn" disabled={s.running || !s.hasKey} onClick={() => void pull()}>
                <Codicon name={s.running ? 'loading' : 'sync'} size={14} className={s.running ? 'spin' : undefined} />
                {s.running ? t('在拉') : t('现在拉一次')}
              </button>
            </Row>
            {runs.slice(0, 8).map((r) => (
              <Row
                key={r.id}
                id={`sourceRun-${r.id}`}
                label={<span className={r.ok ? (r.undone ? 'src-undone' : '') : 'src-bad'}>{r.ok ? r.did.join(' · ') : r.error}</span>}
                desc={
                  <>
                    <span className="src-when">{atText(r.t)}</span>
                    {r.undone && <span className="src-when"> · {t('撤回了')}</span>}
                    {r.files.some((f) => f.endsWith('.md')) && !r.undone && (
                      <button type="button" className="sa-lnk" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {t('看是哪几篇 ›')}
                      </button>
                    )}
                  </>
                }
                more={
                  open === r.id && (
                    <ul className="src-files">
                      {r.files
                        .filter((f) => f.endsWith('.md'))
                        .map((f) => (
                          <li key={f}>
                            <button type="button" className="sa-lnk" onClick={() => (props.onClose(), app().openFile(f))}>
                              {f.split('/').pop()!.replace(/\.md$/, '')}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )
                }
              >
                {r.undoable && !r.undone && (
                  <button type="button" className="sa-btn" onClick={() => void undo(r)}>
                    {t('撤回')}
                  </button>
                )}
              </Row>
            ))}
          </Group>

          <Group title={t('断开')}>
            <Row id="sourceDisconnect" label={t('断开{name}', { name })} desc={t('Key从这台Mac的钥匙串删掉，不再拉；库里已经拉来的笔记一篇不动')}>
              <button type="button" className="sa-btn" disabled={!s.hasKey && !st.on} onClick={() => setAsk(true)}>
                {t('断开…')}
              </button>
            </Row>
          </Group>
        </>
      )}

      {first && (
        <FirstDialog
          name={name}
          plan={first}
          progress={p}
          skipEmpty={st?.skipEmpty ?? true}
          onCancel={async () => {
            setFirst(null)
            await api().disconnect(props.id)
            reload()
          }}
          onPull={async (pick) => {
            const r = await api().firstPull(props.id, pick)
            setFirst(null)
            reload()
            if (!r.ok) return said.say(fail(name, r))
            const log = r.log
            const folder = (await api().list()).sources.find((x) => x.id === props.id)?.settings.folder ?? ''
            const text = r.pulled ? t('{name}：拉了{n}篇进{folder}', { name, n: r.pulled, folder }) : t('{name}连上了，没有要拉的', { name })
            if (log && r.pulled) said.ok(text, () => void window.cn.auto.undo(log), { label: t('看是哪几篇'), run: () => setOpen(log) })
            else said.ok(text)
          }}
        />
      )}
      {ask && s && (
        <div className="trash-scrim" onMouseDown={(e) => e.target === e.currentTarget && setAsk(false)}>
          <div className="trash-dlg" role="alertdialog" aria-label={t('断开{name}？', { name })} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAsk(false))}>
            <h3>{t('断开{name}？', { name })}</h3>
            <p className="sub">{t('Key从这台Mac的钥匙串删掉，不再定时拉；库里已经拉来的{n}篇一篇不动。以后再接，删过的照样不拉回来。', { n: s.inVault })}</p>
            <div className="act">
              <button type="button" className="sa-btn" onClick={() => setAsk(false)} autoFocus>
                {t('不断开')}
              </button>
              <button
                type="button"
                className="sa-btn src-danger"
                onClick={async () => {
                  setAsk(false)
                  await api().disconnect(props.id)
                  said.say(t('{name}断开了：Key从这台Mac删掉了，拉来的笔记都在', { name }))
                  props.onBack()
                }}
              >
                {t('断开')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 第一次连上

/** 几篇链接、几篇课堂录音…… */
function useKinds() {
  const t = useT()
  return (items: FirstItem[]): string => {
    const n = (f: (k: string) => boolean) => items.filter((x) => f(x.kind)).length
    const parts: string[] = []
    const link = n((k) => k === 'link')
    const cls = n((k) => k === 'class_audio')
    const audio = n((k) => /audio|meeting|record/.test(k) && k !== 'class_audio')
    const pic = n((k) => k === 'img_text')
    const text = items.length - link - cls - audio - pic
    if (link) parts.push(t('{n}篇链接', { n: link }))
    if (cls) parts.push(t('{n}篇课堂录音', { n: cls }))
    if (audio) parts.push(t('{n}篇录音', { n: audio }))
    if (pic) parts.push(t('{n}篇图片', { n: pic }))
    if (text) parts.push(t('{n}篇文字', { n: text }))
    return parts.join(t('、', { ctx: '列举' }))
  }
}

/** 「2026-09-07 10:00:00」→「9月7日」（英文界面 Sep 7） */
const dayOf = (created: string) => {
  const ms = Date.parse(created.replace(' ', 'T'))
  return Number.isNaN(ms) ? created : dateText(ms)
}

function FirstDialog(props: { name: string; plan: FirstPlanInfo; progress?: SourceProgress; skipEmpty: boolean; onCancel(): void; onPull(pick: string[]): Promise<void> }) {
  const t = useT()
  const kinds = useKinds()
  const { plan, name } = props
  const usable = (xs: FirstItem[]) => (props.skipEmpty ? xs.filter((x) => !x.empty) : xs)
  // 库里一篇都没有：「全拉 / 只拉最近 30 天」，默认只拉最近 30 天
  const [newer, setNewer] = useState(true)
  const [older, setOlder] = useState<Set<string>>(new Set())
  const [unfold, setUnfold] = useState(false)
  const [busy, setBusy] = useState(false)
  const pick = [...(newer ? usable(plan.newer).map((x) => x.id) : []), ...usable(plan.older).filter((x) => older.has(x.id)).map((x) => x.id)]
  const allOlder = usable(plan.older)
  const olderAll = allOlder.length > 0 && allOlder.every((x) => older.has(x.id))
  const emptyNewer = plan.newer.length - usable(plan.newer).length
  const emptyOlder = plan.older.length - allOlder.length
  const missing = plan.newer.length + plan.older.length
  const p = props.progress
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  return (
    <div className="trash-scrim">
      <div className="trash-dlg src-first" role="dialog" aria-label={t('连上了：{name}里有{n}篇', { name, n: plan.total })} onKeyDown={(e) => e.key === 'Escape' && !busy && (e.stopPropagation(), props.onCancel())}>
        <h3>{t('连上了：{name}里有{n}篇', { name, n: plan.total })}</h3>
        <p className="sub">{plan.inVault ? t('库里已经有{n}篇（认出getnote_id），还差{m}篇：', { n: plan.inVault, m: missing }) : t('库里还没有来自{name}的笔记：', { name })}</p>
        <label className="src-grp">
          <input type="checkbox" checked={newer} disabled={!plan.newer.length} onChange={(e) => setNewer(e.target.checked)} />
          <span className="tx">
            <span className="t1">
              <b>{t('{n}篇', { n: plan.newer.length })}</b>{plan.newest ? t('比库里最新那篇（{day}）还新', { day: dayOf(plan.newest) }) : t('最近30天的')}
            </span>
            <span className="t2">
              {kinds(plan.newer)}
              {emptyNewer > 0 && props.skipEmpty && t('；其中{n}篇是空录音，照「跳过空录音」不拉', { n: emptyNewer })}
            </span>
          </span>
        </label>
        {plan.older.length > 0 && (
          <div className="src-grp src-older">
            <input
              type="checkbox"
              aria-label={t('更早的{n}篇', { n: plan.older.length })}
              checked={olderAll}
              ref={(el) => void (el && (el.indeterminate = !olderAll && older.size > 0))}
              disabled={!allOlder.length}
              onChange={(e) => setOlder(e.target.checked ? new Set(allOlder.map((x) => x.id)) : new Set())}
            />
            <span className="tx">
              <span className="t1">
                <b>{t('{n}篇', { n: plan.older.length })}</b>{plan.newest ? t('更早的，库里没有') : t('更早的')}
              </span>
              <span className="t2">
                {plan.newest ? t('多半是整理时删掉的') : kinds(plan.older)}
                {emptyOlder > 0 && t('；{n}篇空录音', { n: emptyOlder })}
                {allOlder.length > 0 && (
                  <button type="button" className="sa-lnk" aria-expanded={unfold} onClick={() => setUnfold(!unfold)}>
                    {unfold ? t('收起') : t('展开勾几篇')}
                  </button>
                )}
              </span>
              {unfold && (
                <span className="src-picks">
                  {allOlder.map((x) => (
                    <label key={x.id}>
                      <input
                        type="checkbox"
                        checked={older.has(x.id)}
                        onChange={(e) => {
                          const n = new Set(older)
                          if (e.target.checked) n.add(x.id)
                          else n.delete(x.id)
                          setOlder(n)
                        }}
                      />
                      <span>
                        {x.title}
                        <span className="d">{t('（{day}）', { day: dayOf(x.created) })}</span>
                      </span>
                    </label>
                  ))}
                </span>
              )}
            </span>
          </div>
        )}
        <p className="note">{t('没勾的以后也不拉；以后{name}里新存的照「什么时候拉」自己进来。', { name })}</p>
        <div className="act">
          <button type="button" className="sa-btn" disabled={busy} onClick={props.onCancel}>
            {t('不连了')}
          </button>
          <button
            ref={ok}
            type="button"
            className="sa-btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await props.onPull(pick)
            }}
          >
            {busy && <Codicon name="loading" size={14} className="spin" />}
            {busy ? (p?.phase === 'pull' && p.total ? t('在拉{done}/{total}', { done: p.done, total: p.total }) : t('在拉')) : pick.length ? t('拉{n}篇', { n: pick.length }) : t('连上，先不拉旧的')}
          </button>
        </div>
      </div>
    </div>
  )
}
