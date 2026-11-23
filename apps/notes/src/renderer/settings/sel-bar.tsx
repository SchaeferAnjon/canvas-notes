/**
 * 设置 › 选中小条（task-26nz7，照方案原型 21-选中小条自定义/proto.html）：
 * - 「条上现在是这样」：照表画出网页、PDF、HTML 上的真小条，文档那格画右键菜单；下面一行写 ⋯ 里有哪几颗；
 * - 「按钮」：一张能拖的三段表（条上最多 5 颗、收进 ⋯、不出现），每行把手 · 勾 · 图标 · 名字 · 我的 / 自带 · 在哪出现 · 键 · ⋯；
 *   「从我的命令里挑…」把「存成命令」存过的放上来，「加一颗」新建；
 * - 「弹不弹」总开关、「这些网站不弹」名单；
 * - 编辑一颗：名字、提示词（+ 选中的字 这些空、例子、AI 收到的样子）、结果去哪、快捷键（撞了说撞了谁）、在哪能用、放在、存在哪。
 * 改了马上存，底下「已存 · 撤回」，和设置别的页一样。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { PageHead as BasePageHead, Toggle, useSaid } from '@cn/design/settings'
import { type CSSProperties, Fragment, type PointerEvent as RPointerEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { type AiCmd, cleanName, descOf, rulesOfPrompt, type Where, whereText as cmdWhereText } from '../../shared/ai-cmds'
import { comboOf } from '../../shared/cmd-keys'
import { setKey, swapKey } from '../../shared/commands'
import { t as tNow } from '../../shared/i18n'
import {
  BAR_CAP,
  BAR_NAME_MAX,
  BAR_PLACES,
  type BarConfig,
  type BarPlace,
  type BarZone,
  barClash,
  barFull,
  barItem,
  barKeyOk,
  dropFromBar,
  fillPrompt,
  moveTo,
  muteSite,
  placeOwn,
  PROMPT_MAX,
  PROMPT_VARS,
  siteKey,
  today,
  unmuteSite,
  zoneOf,
} from '../../shared/sel-bar'
import { deleteAiCmd, localAiCmds, newCmdId, saveAiCmd, setLocalAiCmds } from '../commands/store'
import { AiIcon } from '../engine-logo'
import { useT } from '../i18n'
import { availNow, checkKey, keyFor, withKeys } from '../keys'
import { cmdConfig, updateCmds } from '../search/cmd-store'
import { barKey, barView, docBtns, type BarBtn, markFresh, ownsOf, updateBar, useBar, useFresh } from '../sel-bar/store'
import { type OpenBar, type Sample, onBarRequest, barRequestNow, putOnBar } from '../sel-bar/run'
import { openSettingsAt } from './jump'
import './sel-bar.css'

type T = ReturnType<typeof useT>

const ZONES: readonly BarZone[] = ['on', 'more', 'off']
/** 一颗的图标：ai 画 AI 对话那一家的标志，tr 画翻译那一家的 */
function Ico({ icon, size = 16 }: { icon: string; size?: number }) {
  if (icon === 'ai') return <AiIcon job="chat" size={size} />
  if (icon === 'tr') return <AiIcon job="translate" size={size} />
  return <Codicon name={icon as CodiconName} size={size} />
}

/** 表里「在哪出现」那一格 */
function whereText(t: T, it: { note?: string; where: readonly BarPlace[] }): string {
  if (it.note) return t(it.note)
  if (it.where.length === 4) return t('四处都有')
  return BAR_PLACES.filter(([k]) => it.where.includes(k))
    .map(([, n]) => t(n, { ctx: '在哪能用' }))
    .join(' · ')
}

/** 提示词里「选中的字」那个空照界面语言怎么写（点「+ 选中的字」、例子里放的那个） */
const selToken = () => (tNow('选中的字') === '选中的字' ? '{选中的字}' : '{selection}') // 不翻：提示词里的占位，存进文件

/** 举例用的那段（没从网页来时） */
const EXAMPLE = '举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件中。' // 不翻：举例的一段原文，像网页上选的字

export function SelBarPage() {
  const t = useT()
  const said = useSaid()
  const { bar, mine } = useBar()
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sample, setSample] = useState<Sample | null>(null)
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null)
  const req = useSyncExternalStore(onBarRequest, barRequestNow)

  // 从网页小条「加一颗…」「小条设置…」、底栏「改名单」跳过来
  const seen = useRef(0)
  useEffect(() => {
    if (!req || req.seq === seen.current) return
    seen.current = req.seq
    const o = req.o
    if (o.sample) setSample(o.sample)
    if (o.view === 'edit') startDraft(o.id ?? null, o, o.sample ?? null)
    else setView('list')
  }, [req?.seq])

  function startDraft(id: string | null, o: Partial<OpenBar> = {}, from: Sample | null = sample) {
    const c = id ? mine.find((x) => x.id === id) : undefined
    setDraft(
      c
        ? { id: c.id, name: c.name, prompt: rulesText(c), out: c.out ?? 'note', key: keyFor(c.id) ?? '', keyMode: null, where: c.where.filter(isPlace), keep: c.where.filter((w) => !isPlace(w)), place: zoneOf(bar, c.id) ?? 'more', store: c.store, rec: !!o.key, fromWeb: !!from }
        : {
            id: null,
            name: o.preset?.name ?? '',
            prompt: o.preset?.prompt ?? '',
            out: 'note',
            key: '',
            keyMode: null,
            where: o.preset ? o.preset.where.filter(isPlace) : ['web', 'pdf', 'html', 'doc'],
            keep: [],
            place: barFull(bar) ? 'more' : 'on',
            store: 'vault',
            rec: false,
            fromWeb: !!from && !o.preset,
          },
    )
    setView('edit')
  }

  const back = () => {
    setView('list')
    setDraft(null)
  }

  if (view === 'edit' && draft)
    return (
      <EditView
        t={t}
        bar={bar}
        mine={mine}
        draft={draft}
        sample={sample}
        setDraft={setDraft}
        onBack={back}
        onSaved={(id, hint, undo) => {
          back()
          setFlash({ id, seq: Date.now() })
          said.saved(hint, undo)
        }}
      />
    )
  return <ListView t={t} bar={bar} mine={mine} flash={flash} setFlash={setFlash} onEdit={(id, o) => startDraft(id, o, null)} focus={req?.o.view === 'list' ? (req.o.focus ?? null) : null} focusSeq={req?.seq ?? 0} />
}

/** 「从我的命令里挑」每条下面一行：存在哪 · 在哪能用 */
const cmdNote = (t: T, c: AiCmd) => t('{store} · {where}', { store: c.store === 'vault' ? t('存在库里') : t('只在这台 Mac'), where: cmdWhereText(c.where) || t('别处') })

/** 编辑页里提示词那一格：小条上加的是它的提示词，「存成命令」存的是勾着的规矩一行一条 */
const rulesText = (c: AiCmd) => c.prompt ?? c.rules.filter((r) => !r.off).map((r) => r.t).join('\n')

const isPlace = (w: string): w is BarPlace & Where => w === 'web' || w === 'pdf' || w === 'html' || w === 'doc'

// ---------------------------------------------------------------- 列表

function ListView(props: {
  t: T
  bar: BarConfig
  mine: AiCmd[]
  flash: { id: string; seq: number } | null
  setFlash(f: { id: string; seq: number } | null): void
  onEdit(id: string | null, o?: Partial<OpenBar>): void
  focus: 'on' | 'sites' | null
  focusSeq: number
}) {
  const { t, bar, mine } = props
  const said = useSaid()
  const fresh = useFresh()
  const [previewAt, setPreviewAt] = useState<BarPlace>('web')
  const [menu, setMenu] = useState<{ kind: 'row'; id: string; at: DOMRect } | { kind: 'pick'; at: DOMRect } | null>(null)
  const [deny, setDeny] = useState(0)
  /** 正拖着往满了的条上放（松手、拖走、拖拽被打断都退掉） */
  const [dragDeny, setDragDeny] = useState(false)
  const [siteIn, setSiteIn] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const owns = ownsOf(mine)

  const name = (id: string) => {
    const it = barItem(id, owns)
    return it ? (it.mine ? it.name : t(it.name)) : id
  }

  /** 改表，底下「已存 · {hint}」带撤回；flashId：改完那一行亮一下 */
  async function change(fn: (b: BarConfig) => BarConfig | null, hint: (b: BarConfig) => string, flashId?: string) {
    const next = fn(bar)
    if (!next) return void denyFull()
    const undo = await updateBar(() => next)
    said.saved(hint(next), () => void undo())
    if (flashId) props.setFlash({ id: flashId, seq: Date.now() })
  }

  function denyFull() {
    setDeny(Date.now())
  }
  useEffect(() => {
    if (!deny) return
    const off = setTimeout(() => setDeny(0), 2400)
    return () => clearTimeout(off)
  }, [deny])

  // 从别处跳过来：翻到总开关、名单那一段，第一行亮一下
  useEffect(() => {
    if (!props.focus || !root.current) return
    const el = root.current.querySelector<HTMLElement>(props.focus === 'sites' ? '[data-row="barSites"]' : '[data-row="barOn"]')
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.classList.remove('sb-flash')
    void el.offsetWidth
    el.classList.add('sb-flash')
  }, [props.focusSeq])

  const zn = (z: BarZone) => (z === 'on' ? t('条上') : z === 'more' ? t('⋯ 里') : t('不出现'))

  // ---------- 拖着排
  const drag = useRef<{ id: string; x0: number; y0: number; off: number; started: boolean; ghost: HTMLElement | null; row: HTMLElement; target: { z: BarZone; idx: number } | 'deny' | null } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const dropline = useRef<HTMLDivElement>(null)

  function onRowDown(e: RPointerEvent<HTMLDivElement>, id: string) {
    if (e.button !== 0 || (e.target as Element).closest('.sb-ck, .sb-more')) return
    const row = e.currentTarget
    const rr = row.getBoundingClientRect()
    drag.current = { id, x0: e.clientX, y0: e.clientY, off: e.clientY - rr.top, started: false, ghost: null, row, target: null }
    row.setPointerCapture(e.pointerId)
  }
  function onRowMove(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current
    const L = list.current
    if (!d || !L) return
    if (!d.started) {
      if (Math.abs(e.clientY - d.y0) < 4 && Math.abs(e.clientX - d.x0) < 4) return
      d.started = true
      d.row.classList.add('dragging')
      const g = d.row.cloneNode(true) as HTMLElement
      g.classList.remove('dragging', 'flash')
      g.classList.add('sb-ghost')
      L.appendChild(g)
      d.ghost = g
    }
    const lr = L.getBoundingClientRect()
    d.ghost!.style.left = '6px'
    d.ghost!.style.width = `${lr.width - 12}px`
    d.ghost!.style.top = `${e.clientY - lr.top - d.off}px`
    let best: { z: BarZone; idx: number; y: number } | null = null
    for (const z of Array.from(L.querySelectorAll<HTMLElement>('.sb-zone'))) {
      const zr = z.getBoundingClientRect()
      if (e.clientY < zr.top - 18 || e.clientY > zr.bottom + 18) continue
      const rows = Array.from(z.querySelectorAll<HTMLElement>('.sb-it')).filter((r) => r.dataset.id !== d.id)
      let idx = rows.length
      let y = rows.length ? rows[rows.length - 1]!.getBoundingClientRect().bottom : zr.top + 4
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          idx = i
          y = r.top
          break
        }
      }
      best = { z: z.dataset.z as BarZone, idx, y }
      break
    }
    const dl = dropline.current!
    const denyNow = !!best && best.z === 'on' && barFull(bar, d.id)
    setDragDeny(denyNow)
    if (!best) {
      dl.style.display = 'none'
      d.target = null
      return
    }
    if (denyNow) {
      dl.style.display = 'none'
      d.target = 'deny'
      return
    }
    dl.style.display = 'block'
    dl.style.top = `${best.y - lr.top - 1}px`
    d.target = { z: best.z, idx: best.idx }
  }
  function onRowUp() {
    const d = drag.current
    drag.current = null
    setDragDeny(false)
    if (!d || !d.started) return
    d.ghost?.remove()
    d.row.classList.remove('dragging')
    if (dropline.current) dropline.current.style.display = 'none'
    const tg = d.target
    if (!tg) return
    if (tg === 'deny') return denyFull()
    const before = zoneOf(bar, d.id)
    if (before === tg.z && bar[tg.z].indexOf(d.id) === tg.idx) return
    void change(
      (b) => moveTo(b, d.id, tg.z, tg.idx),
      (b) => (tg.z === 'on' ? t('「{name}」在条上第 {n} 颗', { name: name(d.id), n: b.on.indexOf(d.id) + 1 }) : t('「{name}」挪到{zone}', { name: name(d.id), zone: zn(tg.z) })),
      d.id,
    )
  }

  function toggleCk(id: string) {
    const z = zoneOf(bar, id)
    if (z === 'off') void change((b) => moveTo(b, id, 'more'), () => t('「{name}」收进 ⋯', { name: name(id) }), id)
    else void change((b) => moveTo(b, id, 'off', 0), () => t('「{name}」不出现了', { name: name(id) }), id)
  }

  async function removeOwn(id: string) {
    const c = mine.find((x) => x.id === id)
    if (!c) return
    const before = cmdConfig()
    const beforeLocal = localAiCmds()
    await deleteAiCmd(c)
    await updateBar((b) => dropFromBar(b, id))
    said.saved(t('已删掉「{name}」', { name: c.name }), () => {
      void updateCmds(() => before)
      if (c.store === 'local') void setLocalAiCmds(beforeLocal)
    })
  }

  /** 从我的命令里挑：放上条（满了进 ⋯）；放上以后在网页、PDF、HTML、文档都能用 */
  async function pick(c: AiCmd) {
    setMenu(null)
    const r = await putOnBar(c, 'on')
    props.setFlash({ id: c.id, seq: Date.now() })
    said.saved(t('「{name}」放上了{zone}', { name: c.name, zone: zn(r.zone ?? 'more') }), () => void r.undo())
  }

  const v = previewAt === 'doc' ? null : barView(bar, mine, previewAt)
  const moreNames = v ? v.more.map((b) => b.label) : []
  const onN = bar.on.length
  const zoneItems = (z: BarZone) => bar[z].flatMap((id) => barItem(id, owns) ?? [])
  const notPicked = mine.filter((c) => !zoneOf(bar, c.id))
  const picked = mine.filter((c) => zoneOf(bar, c.id))

  return (
    <div className="sb-page" ref={root}>
      <BasePageHead icon={<Codicon name="list-selection" size={18} />} title={t('选中小条')} desc={t('网页、PDF、HTML 里选了字弹出的那一条：放哪几颗、在哪出现、哪些网站不弹')} />
      <div className="sa-grph">{t('条上现在是这样')}</div>
      <div className="sb-prev" data-testid="selbar-preview">
        <div className="top">
          <span>{t('看看在这几处长什么样')}</span>
          <div className="sb-seg" role="radiogroup" aria-label={t('在哪')}>
            {BAR_PLACES.map(([p, n]) => (
              <button key={p} type="button" role="radio" aria-checked={previewAt === p} className={previewAt === p ? 'on' : ''} onClick={() => setPreviewAt(p)}>
                {t(n, { ctx: '在哪能用' })}
              </button>
            ))}
          </div>
        </div>
        {v ? (
          <>
            <div className="barhost">
              <BarPreview t={t} v={v} pdf={previewAt !== 'web'} fresh={fresh} />
            </div>
            <div className="why">
              {t('⋯ 里：{names}', { names: moreNames.join(' · ') || t('没有') })}　{t('四处共用这一份，每颗按「在哪能用」出现')}
            </div>
          </>
        ) : (
          <>
            <div className="sb-docmenu" role="menu" aria-label={t('文档里选了字的右键菜单')}>
              <DocMenuRows t={t} btns={docBtns(bar, mine)} />
            </div>
            <div className="why">{t('文档里选了字不弹条（会挡着打字）：右键菜单最上面列出勾了「文档」的几颗，键照样能按')}</div>
          </>
        )}
      </div>

      <div className="sa-grph sb-gt">
        {t('按钮')}
        <span className="sub">{t('按住把手拖着排；去掉勾就不出现')}</span>
        <span className="acts">
          <button type="button" className="sb-btn" onClick={(e) => setMenu({ kind: 'pick', at: e.currentTarget.getBoundingClientRect() })}>
            <Codicon name="bookmark" size={14} />
            {t('从我的命令里挑…')}
          </button>
          <button type="button" className="sb-btn" onClick={() => props.onEdit(null)}>
            <Codicon name="add" size={14} />
            {t('加一颗')}
          </button>
        </span>
      </div>
      <div className="sb-tbl sb-list" ref={list} role="group" aria-label={t('按钮')} data-row="barList">
        {ZONES.map((z, zi) => {
          const items = zoneItems(z)
          return (
            <Fragment key={z}>
              <div className="sb-sec">
                {z === 'on' ? t('条上') : z === 'more' ? t('收进 ⋯') : t('不出现')}
                <span className={'cnt' + (z === 'on' && onN >= BAR_CAP ? ' full' : '')}>{z === 'on' ? t('{n} / {cap}颗', { n: onN, cap: BAR_CAP }) : t('{n}颗', { n: items.length })}</span>
                {zi === 0 && (
                  <span className={'warn' + (deny || dragDeny ? ' show' : '')}>
                    {t('条上最多 {cap}颗：先把一颗拖下去', { cap: BAR_CAP })}
                  </span>
                )}
              </div>
              <div
                className={'sb-zone' + (items.length ? '' : ' empty') + (z === 'on' && (deny || dragDeny) ? ' deny' : '') + (z === 'on' && deny ? ' shake' : '')}
                data-z={z}
                role="list"
                aria-label={z === 'on' ? t('条上') : z === 'more' ? t('收进 ⋯') : t('不出现')}
                data-empty={z === 'on' ? t('拖到这里') : z === 'more' ? t('拖到这里，点了 ⋯ 才看得到') : t('拖到这里，或去掉勾')}
              >
                {items.map((it) => {
                  const k = barKey(it.id, 'web') ?? barKey(it.id, 'pdf')
                  const off = z === 'off'
                  const label = it.mine ? it.name : t(it.name)
                  return (
                    <div
                      key={it.id + (props.flash?.id === it.id ? props.flash.seq : '')}
                      className={'sb-it' + (off ? ' off' : '') + (props.flash?.id === it.id ? ' flash' : '')}
                      data-id={it.id}
                      role="listitem"
                      aria-label={label}
                      onPointerDown={(e) => onRowDown(e, it.id)}
                      onPointerMove={onRowMove}
                      onPointerUp={onRowUp}
                      onPointerCancel={onRowUp}
                      onLostPointerCapture={onRowUp}
                    >
                      <span className="sb-grip" title={t('按住拖')}>
                        <Codicon name="gripper" size={16} />
                      </span>
                      <span
                        className={'sb-ck' + (off ? '' : ' on')}
                        role="checkbox"
                        aria-checked={!off}
                        aria-label={label}
                        title={off ? t('勾上：收进 ⋯') : t('去掉勾：不出现')}
                        onClick={() => toggleCk(it.id)}
                      >
                        {!off && <Codicon name="check" size={12} />}
                      </span>
                      <span className="sb-ico">
                        <Ico icon={it.icon} />
                      </span>
                      <span className="sb-n">{label}</span>
                      <span className={'sb-tag' + (it.mine ? ' mine' : '')}>{it.mine ? t('我的') : t('自带')}</span>
                      <span className="sb-wh">{whereText(t, it)}</span>
                      <span className="sb-kk">{k && <span className="sb-kbd">{k}</span>}</span>
                      <button type="button" className="sb-more" aria-label={t('这一颗还能…')} title={t('这一颗还能…')} onClick={(e) => setMenu({ kind: 'row', id: it.id, at: e.currentTarget.getBoundingClientRect() })}>
                        <Codicon name="ellipsis" size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </Fragment>
          )
        })}
        <div className="sb-dropline" ref={dropline} />
      </div>
      <div className="sb-fall">{t('「翻译设置…」「剪到哪篇…」「加一颗…」「小条设置…」固定在 ⋯ 最下面，不在这张表里。自带的能挪、能收、能藏，字不能改；要改就「复制一份再改」。')}</div>

      <div className="sa-grph">{t('弹不弹')}</div>
      <div className="sb-tbl" role="group" aria-label={t('弹不弹')}>
        <div className="sb-row" data-row="barOn">
          <div className="nm">
            <b>{t('选好字就弹小条')}</b>
            <span>{bar.enabled ? t('网页、PDF、HTML 里选了字就弹；下面名单上的网站除外') : withKeys(t('关着：哪里都不弹。选了字按 {k:enter}、{k:quote-selection} 这些键照样能用'))}</span>
          </div>
          <div className="rc">
            <Toggle on={bar.enabled} label={t('选好字就弹小条')} onChange={(on) => void change((b) => ({ ...b, enabled: on }), () => (on ? t('选好字就弹') : t('哪里都不弹了')))} />
          </div>
        </div>
      </div>

      <div className="sa-grph sb-gt">
        {t('这些网站不弹')}
        <span className="sub">{t('默认哪里都弹；存在库里，换台 Mac 也在')}</span>
      </div>
      <div className="sb-tbl" role="group" aria-label={t('这些网站不弹')} data-row="barSites">
        {bar.offSites.length ? (
          bar.offSites.map((s) => (
            <div className="sb-site" key={s.site}>
              <span className="fav">
                <Codicon name="globe" size={16} />
              </span>
              <b>{s.site}</b>
              {s.at && <span>{s.at === today() ? t('今天加的') : t('{day}加的', { day: s.at })}</span>}
              <button type="button" className="x" aria-label={t('从名单拿掉 {site}', { site: s.site })} title={t('从名单拿掉')} onClick={() => void change((b) => unmuteSite(b, s.site), () => t('{site} 又会弹了', { site: s.site }))}>
                <Codicon name="close" size={16} />
              </button>
            </div>
          ))
        ) : (
          <div className="sb-site">
            <span>{t('没有，哪个网站都弹。右键小条上的 ×，选「这个网站不弹」就记在这里。')}</span>
          </div>
        )}
        <div className="sb-site">
          <input
            className="sb-input"
            style={{ flex: 1 }}
            value={siteIn}
            aria-label={t('加一个网站')}
            placeholder={t('加一个网站，比如 youtube.com')}
            onChange={(e) => setSiteIn(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) addSite()
            }}
          />
          <button type="button" className="sb-btn" onClick={addSite}>
            {t('加上')}
          </button>
        </div>
      </div>
      <div className="sb-fall">{t('名单按网站记（zh.d2l.ai 下面每一页都算）。PDF、HTML 不进名单，只跟着上面的总开关走。')}</div>

      {menu?.kind === 'row' && <RowMenu t={t} bar={bar} mine={mine} id={menu.id} at={menu.at} onClose={() => setMenu(null)} onMove={(z) => void move(menu.id, z)} onEdit={props.onEdit} onDelete={() => void removeOwn(menu.id)} onDeny={denyFull} />}
      {menu?.kind === 'pick' && (
        <Pop at={menu.at} width={420} onClose={() => setMenu(null)} className="sb-pick" label={t('从我的命令里挑')}>
          <div className="ph">{withKeys(t('「存成命令」存下的、还没放上小条的。放上以后它拿的是选中的那段，不是整篇；{k:search}、/ 菜单里照旧叫得到。'))}</div>
          {notPicked.map((c) => (
            <div className="pr" key={c.id}>
              <span className="ico">
                <AiIcon job="chat" size={16} />
              </span>
              <div className="nm">
                <b>{c.name}</b>
                <span>{cmdNote(t, c)}</span>
              </div>
              <button type="button" className="sb-btn" onClick={() => void pick(c)}>
                {t('放上小条')}
              </button>
            </div>
          ))}
          {picked.map((c) => (
            <div className="pr" key={c.id}>
              <span className="ico">
                <AiIcon job="chat" size={16} />
              </span>
              <div className="nm">
                <b>{c.name}</b>
                <span>{cmdNote(t, c)}</span>
              </div>
              <span className="st">{zoneOf(bar, c.id) === 'on' ? t('已在条上') : zoneOf(bar, c.id) === 'more' ? t('已在 ⋯ 里') : t('已在「不出现」里')}</span>
            </div>
          ))}
          {!mine.length && <div className="ph">{t('还没存过命令：在 AI 对话里调出满意的样子后点「存成命令」')}</div>}
        </Pop>
      )}
    </div>
  )

  async function move(id: string, z: BarZone) {
    setMenu(null)
    if (z === 'on' && barFull(bar, id)) return denyFull()
    await change((b) => moveTo(b, id, z), () => t('「{name}」挪到{zone}', { name: name(id), zone: zn(z) }), id)
  }

  function addSite() {
    const s = siteKey(siteIn)
    if (!s) return
    setSiteIn('')
    void change((b) => muteSite(b, s, today()), () => t('{site} 不弹了', { site: s }))
  }
}

/** 预览里的小条（照网页上的黑色胶囊，PDF、HTML 是 34 高的那种） */
function BarPreview(props: { t: T; v: { main: BarBtn[]; tail: BarBtn[]; more: BarBtn[] }; pdf: boolean; fresh: string | null }) {
  const { t, v } = props
  const b = (x: BarBtn) => (
    <button type="button" key={x.id} className={props.fresh === x.id ? 'new' : ''} tabIndex={-1}>
      <Ico icon={x.icon} size={14} />
      <span className="lb">{x.label}</span>
      {x.key && <kbd>{x.key}</kbd>}
    </button>
  )
  return (
    <div className={'sb-bar' + (props.pdf ? ' pdf' : '')} role="toolbar" aria-label={t('小条预览')}>
      {v.main.map(b)}
      {v.tail.length > 0 && <span className="sep" />}
      {v.tail.map(b)}
      <span className="sep" />
      <button type="button" className="ico" tabIndex={-1} aria-label={t('更多')}>
        <Codicon name="ellipsis" size={14} />
      </button>
      <button type="button" className="ico" tabIndex={-1} aria-label={t('收起')}>
        <Codicon name="close" size={14} />
      </button>
    </div>
  )
}

/** 文档那格：右键菜单最上面勾了「文档」的几颗，下面照旧拷贝、高亮、加链接 */
function DocMenuRows({ t, btns }: { t: T; btns: BarBtn[] }) {
  return (
    <>
      {btns.map((x) => (
        <div className="mi" key={x.id}>
          <Ico icon={x.icon} size={14} />
          {x.label}
          <span className="r">{x.key ?? ''}</span>
        </div>
      ))}
      {btns.length > 0 && <div className="ms" />}
      <div className="mi">
        <Codicon name="copy" size={14} />
        {t('拷贝')}
        <span className="r">{keyFor('copy') ?? ''}</span>
      </div>
      <div className="mi">
        <Codicon name="symbol-color" size={14} />
        {t('高亮')}
        <span className="r">{keyFor('highlight') ?? ''}</span>
      </div>
      <div className="mi">
        <Codicon name="link-external" size={14} />
        {t('加链接')}
        <span className="r">{keyFor('add-link') ?? ''}</span>
      </div>
    </>
  )
}

/** 浅底的小菜单：贴着按钮下面，右边对齐，下面放不下放上面 */
function Pop(props: { at: DOMRect; width: number; onClose(): void; children: React.ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999, width: props.width })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const left = Math.max(8, Math.min(props.at.right - props.width, innerWidth - props.width - 8))
    let top = props.at.bottom + 4
    if (top + el.offsetHeight > innerHeight - 8) top = Math.max(8, props.at.top - el.offsetHeight - 4)
    setStyle({ left, top, width: props.width })
  }, [props.at])
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && props.onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    }
    document.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  return (
    <div ref={ref} className={'sb-pmenu' + (props.className ? ' ' + props.className : '')} style={style} role="menu" aria-label={props.label}>
      {props.children}
    </div>
  )
}

/** 一行的 ⋯：编辑 / 复制一份再改、设快捷键、挪到哪段、删掉 */
function RowMenu(props: { t: T; bar: BarConfig; mine: AiCmd[]; id: string; at: DOMRect; onClose(): void; onMove(z: BarZone): void; onEdit(id: string | null, o?: Partial<OpenBar>): void; onDelete(): void; onDeny(): void }) {
  const { t, bar, id } = props
  const it = barItem(id, ownsOf(props.mine))
  if (!it) return null
  const z = zoneOf(bar, id)
  const full = barFull(bar, id)
  const label = it.mine ? it.name : t(it.name)
  const k = barKey(id, 'web') ?? barKey(id, 'pdf')
  // 自带的键在设置 › 快捷键里改（引用、剪藏）；讲解一下、拷贝是固定的键
  const keyRow = id === 'quote' ? 'k-quote-selection' : id === 'clip' ? 'k-clip-selection' : null
  const close = (f: () => void) => () => {
    props.onClose()
    f()
  }
  return (
    <Pop at={props.at} width={220} onClose={props.onClose} label={t('这一颗还能…')}>
      {it.mine ? (
        <button type="button" role="menuitem" onClick={close(() => props.onEdit(id))}>
          <Codicon name="edit" size={14} />
          {t('编辑…')}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={close(() =>
            props.onEdit(null, { preset: { name: t('{name}（我的）', { name: label }), prompt: id === 'explain' ? t('用三五句讲清楚{v}在说什么，先说结论。', { v: selToken() }) : t('照「{name}」的做法处理{v}。', { name: label, v: selToken() }), where: [...it.where] } }),
          )}
        >
          <Codicon name="copy" size={14} />
          {t('复制一份再改…')}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={!it.mine && !keyRow}
        onClick={close(() => (it.mine ? props.onEdit(id, { key: true }) : keyRow && openSettingsAt(keyRow)))}
      >
        <Codicon name="record-keys" size={14} />
        {t('设快捷键…')}
        <span className="r">{!it.mine && !keyRow && k ? t('固定的键') : (k ?? '')}</span>
      </button>
      <div className="ms" />
      {ZONES.filter((x) => x !== z).map((x) => (
        <button key={x} type="button" role="menuitem" disabled={x === 'on' && full} onClick={() => props.onMove(x)}>
          <Codicon name={x === 'on' ? 'arrow-right' : x === 'more' ? 'ellipsis' : 'eye-closed'} size={14} />
          {x === 'on' ? t('放上条') : x === 'more' ? t('收进 ⋯') : t('不出现')}
          {x === 'on' && full && <span className="r">{t('满了')}</span>}
        </button>
      ))}
      {it.mine && (
        <>
          <div className="ms" />
          <button type="button" role="menuitem" className="red" onClick={close(props.onDelete)}>
            <Codicon name="trash" size={14} />
            {t('删掉这条命令')}
          </button>
        </>
      )}
    </Pop>
  )
}

// ---------------------------------------------------------------- 编辑一颗

interface Draft {
  id: string | null
  name: string
  prompt: string
  out: 'note' | 'answer'
  key: string
  /** 撞了别的：换给这一条（give），两个对调（swap）；没撞是 null */
  keyMode: 'give' | 'swap' | null
  where: (BarPlace & Where)[]
  /** 「在哪能用」里小条管不着的那几处（白板、文件夹），存的时候照旧带上 */
  keep: Where[]
  place: BarZone
  store: 'vault' | 'local'
  /** 一进来就在按新键 */
  rec: boolean
  fromWeb: boolean
}

// 不翻：名字是键（画的地方 t()），提示词是写给 AI 的例子，画的地方 t()
const SUGS: readonly (readonly [string, string, 'note' | 'answer'])[] = [
  ['用高中生能懂的话讲', '用高中生能听懂的话讲{v}：先一句话说它在干什么，再举一个生活里的例子。不用术语，非用不可就先解释。', 'note'], // 不翻
  ['查这个词的词源', '说说{v}这个词是怎么来的：词根、最早的意思、后来怎么变成现在的意思。三句以内。', 'answer'], // 不翻
  ['改成一道自测题', '照{v}出一道自测题，答案先折起来。', 'note'], // 不翻
]

function EditView(props: { t: T; bar: BarConfig; mine: AiCmd[]; draft: Draft; sample: Sample | null; setDraft(d: Draft): void; onBack(): void; onSaved(id: string, hint: string, undo: () => void): void }) {
  const { t, bar, draft: d } = props
  const [rec, setRec] = useState(d.rec)
  const [clash, setClash] = useState<{ text: string; who?: string } | null>(null)
  const nameIn = useRef<HTMLInputElement>(null)
  const prIn = useRef<HTMLTextAreaElement>(null)
  const set = (p: Partial<Draft>) => props.setDraft({ ...d, ...p })
  const ok = !!d.name.trim() && !!d.prompt.trim()
  const fullOn = barFull(bar, d.id ?? undefined) && d.place !== 'on'

  useEffect(() => {
    if (!d.id && !d.rec) nameIn.current?.focus()
  }, [])

  // 按新键：esc 取消；要带 ⌘ 或 ⌃，或 ⌥ 加字母；撞了条上的、命令表里的说撞了谁
  useEffect(() => {
    if (!rec) return
    setClash({ text: t('要带 ⌘ 或 ⌃，或 ⌥ 加字母；esc 取消') })
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRec(false)
        setClash(null)
        return
      }
      const c = comboOf(e)
      if (!c || ['Meta', 'Alt', 'Control', 'Shift'].includes(e.key)) return
      if (!barKeyOk(c)) return setClash({ text: t('「{key}」不能用：要带 ⌘ 或 ⌃，或 ⌥ 加字母', { key: c }) })
      setRec(false)
      const self = d.id ?? 'own-new'
      const items = [...new Set([...barView(bar, props.mine, 'web').main, ...barView(bar, props.mine, 'web').tail, ...barView(bar, props.mine, 'web').more, ...barView(bar, props.mine, 'pdf').main])].map((b) => ({ id: b.id, name: b.label, key: b.key }))
      const hit = barClash(c, items, self)
      const app = hit ? null : checkKey(self, c)
      if (app?.problem) return setClash({ text: app.problem })
      const who = hit?.name ?? app?.clash?.name
      set({ key: c, keyMode: who ? 'give' : null })
      setClash(who ? { text: t('和「{name}」撞了', { name: who }), who } : null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, d])

  // ⌘↵ 存好
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rec || e.key !== 'Enter' || !e.metaKey) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const s = props.sample
  const ex = s?.text || EXAMPLE
  const short = ex.length > 46 ? ex.slice(0, 46) + '…' : ex
  const vars = { sel: short, title: s?.title ?? t('2.2. 数据预处理'), url: (s?.url ?? 'zh.d2l.ai/chapter_preliminaries/pandas.html').replace(/^https?:\/\//, ''), head: s?.head ?? t('2.2.1. 读取数据集') }

  function insertVar(name: string) {
    const ta = prIn.current
    if (!ta) return
    const v = `{${name}}`
    const a = ta.selectionStart ?? ta.value.length
    const b = ta.selectionEnd ?? a
    const next = ta.value.slice(0, a) + v + ta.value.slice(b)
    set({ prompt: next.slice(0, PROMPT_MAX) })
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = a + v.length
    })
  }

  async function save() {
    if (!ok) return
    const before = cmdConfig()
    const beforeLocal = localAiCmds()
    const old = d.id ? props.mine.find((x) => x.id === d.id) : undefined
    const id = d.id ?? newCmdId()
    const name = cleanName(d.name)
    const prompt = d.prompt.trim().slice(0, PROMPT_MAX)
    // 「存成命令」存的、提示词没动：规矩原样留着（依据、勾掉的那几条不丢），不另写提示词
    const keepRules = !!old && !old.prompt && prompt === rulesText(old)
    const rules = keepRules ? old!.rules : rulesOfPrompt(prompt)
    const where = [...new Set<Where>([...d.keep, ...d.where])]
    const write = old?.write ?? 'answer'
    const c: AiCmd = {
      id,
      name,
      rules,
      where,
      write,
      store: d.store,
      desc: keepRules && old!.name === name ? old!.desc : descOf(rules, old?.from, write),
      ...(keepRules ? {} : { prompt }),
      out: d.out,
      ...(old?.from ? { from: old.from } : {}),
    }
    await saveAiCmd(c)
    let zone: BarZone = d.place
    await updateBar((b) => {
      if (d.place === 'on' && zoneOf(b, id) !== 'on' && barFull(b)) zone = 'more'
      // 改的是已有的一颗、段没换：位置不动
      if (zoneOf(b, id) === zone) return b
      return moveTo(b, id, zone) ?? b
    })
    // 键记进命令表：撞了的「换给这一条」（别的那条让出来）或「两个对调」
    const curKey = keyFor(id)
    if ((d.key || null) !== curKey) {
      const avail = availNow()
      await updateCmds((cfg) => (d.key ? (d.keyMode === 'swap' ? swapKey(cfg, avail, id, d.key) : setKey(cfg, avail, id, d.key)) : setKey(cfg, avail, id, null)))
    }
    markFresh(zone === 'on' ? id : null)
    const where2 = zone === 'on' ? t('放上了条上') : zone === 'more' ? t('收进了 ⋯') : t('存好了，先不出现')
    props.onSaved(id, d.fromWeb ? t('「{name}」{where}，回网页再选一段试试', { name, where: where2 }) : t('「{name}」{where}', { name, where: where2 }), () => {
      markFresh(null)
      void updateCmds(() => before)
      void setLocalAiCmds(beforeLocal)
    })
  }

  const filled = fillPrompt(d.prompt, vars)
  return (
    <div className="sb-page sb-edit">
      <button type="button" className="sb-back" onClick={props.onBack}>
        <Codicon name="chevron-left" size={14} />
        {t('选中小条')}
      </button>
      <BasePageHead icon={<AiIcon job="chat" size={18} />} title={d.name || t('新的一颗')} desc={d.fromWeb ? t('从网页小条的 ⋯ 来的：拿你刚选的那段举例') : withKeys(t('一颗按钮就是一条命令：{k:search}、AI 输入框打 / 也叫得到'))} />
      <div className="sb-tbl" role="group" aria-label={t('自定义一颗')}>
        <div className="sb-row">
          <div className="nm">
            <b>{t('名字')}</b>
            <span>{t('小条上就写这几个字；{n} 个字以内，长了条会挤', { n: BAR_NAME_MAX })}</span>
          </div>
          <div className="rc">
            <input ref={nameIn} className="sb-input" style={{ width: 220 }} value={d.name} maxLength={BAR_NAME_MAX * 3} aria-label={t('名字')} placeholder={t('比如：用高中生能懂的话讲')} onChange={(e) => set({ name: e.currentTarget.value })} />
          </div>
        </div>
        <div className="sb-row col">
          <div className="nm">
            <b>{t('提示词')}</b>
            <span>{t('跟 AI 说拿选中的这段做什么。点下面的词把它放进去')}</span>
          </div>
          <textarea ref={prIn} className="sb-input" value={d.prompt} aria-label={t('提示词')} placeholder={t('比如：用高中生能听懂的话讲{v}，举一个生活里的例子', { v: selToken() })} onChange={(e) => set({ prompt: e.currentTarget.value.slice(0, PROMPT_MAX) })} />
          <div className="sb-chips">
            {PROMPT_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                className="sb-chip var"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertVar(tNow(v.zh) === v.zh ? v.zh : v.en)
                }}
              >
                <Codicon name="add" size={13} />
                {t(v.zh)}
              </button>
            ))}
          </div>
          <div className="sb-sug">
            {t('没想好？试试：')}
            {SUGS.map(([n, p, out]) => (
              <a key={n} role="button" tabIndex={0} onClick={() => set({ name: t(n), prompt: t(p, { v: selToken() }), out })}>
                {t(n)}
              </a>
            ))}
          </div>
          <div className="sb-fall">{t('没写 {v} 时，选中的那段接在最后当材料，照样收得到。框一块（网页按住 ⌘ 框、PDF、HTML）时，{v} 是框下来的那张图。', { v: selToken() })}</div>
          <div className="sb-sample" data-testid="selbar-sample">
            <b>{t('AI 收到的样子')}</b>
            {s ? t('（拿网页上你选着的这段举例）') : t('（拿一段例子给你看）')}
            <br />
            <SampleText prompt={d.prompt} vars={vars} short={short} tail={filled.tail} t={t} />
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('结果去哪')}</b>
            <span>{d.out === 'note' ? t('写进网页正在剪进去的那篇（读 PDF 时是这份的笔记），带框带标志，和「讲解一下」一样') : t('在右栏 AI 里答，不动笔记；想留下来再点「插到文档」')}</span>
          </div>
          <div className="rc">
            <SmallSeg label={t('结果去哪')} value={d.out} options={[['note', t('写进笔记')], ['answer', t('只在 AI 栏答')]]} onChange={(v) => set({ out: v })} />
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('快捷键')}</b>
            <span>{withKeys(t('记进命令表；设置 › 快捷键、{k:search} 里也能改。小条出来时按它就行'))}</span>
            {clash && (
              <div className="sb-clash" role="status">
                {clash.text}
                {clash.who && (
                  <>
                    <a role="button" tabIndex={0} className={d.keyMode === 'give' ? 'on' : ''} onClick={() => (set({ keyMode: 'give' }), setClash({ text: t('「{name}」的键给这一条；存好时改', { name: clash.who! }), who: clash.who }))}>
                      {t('换给这一条')}
                    </a>
                    <a role="button" tabIndex={0} className={d.keyMode === 'swap' ? 'on' : ''} onClick={() => (set({ keyMode: 'swap' }), setClash({ text: t('和「{name}」两个对调；存好时改', { name: clash.who! }), who: clash.who }))}>
                      {t('两个对调')}
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="rc">
            <button type="button" className={'sb-keybtn' + (rec ? ' rec' : '')} aria-label={t('快捷键')} onClick={() => setRec(true)}>
              {rec ? t('按下新键…') : d.key || t('设快捷键')}
            </button>
            {d.key && !rec && (
              <button type="button" className="sb-btn ghost" onClick={() => (set({ key: '', keyMode: null }), setClash(null))}>
                {t('清掉')}
              </button>
            )}
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('在哪能用')}</b>
            <span>{t('勾了哪处，哪处才有它：网页、PDF、HTML 在小条上，文档里在选了字的右键菜单最上面')}</span>
          </div>
          <div className="rc" style={{ width: 300 }}>
            <div className="sb-chips nowrap" role="group" aria-label={t('在哪能用')}>
              {BAR_PLACES.map(([p, n, icon]) => {
                const on = d.where.includes(p as BarPlace & Where)
                return (
                  <button
                    key={p}
                    type="button"
                    className={'sb-chip' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => {
                      const w = p as BarPlace & Where
                      const next = on ? d.where.filter((x) => x !== w) : [...d.where, w]
                      set({ where: next.length ? next : [w] })
                    }}
                  >
                    <Codicon name={icon as CodiconName} size={13} />
                    {t(n, { ctx: '在哪能用' })}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('放在')}</b>
            <span>{fullOn ? t('条上满了（{n} / {cap}），先收进 ⋯；要放上去先拿下一颗', { n: bar.on.length, cap: BAR_CAP }) : t('条上一眼看得到；⋯ 里点一下才出来')}</span>
          </div>
          <div className="rc">
            <SmallSeg
              label={t('放在')}
              value={d.place}
              options={[
                ['on', t('条上'), fullOn],
                ['more', t('收进 ⋯')],
                ['off', t('不出现')],
              ]}
              onChange={(v) => set({ place: v })}
            />
          </div>
        </div>
        <div className="sb-row">
          <div className="nm">
            <b>{t('存在哪')}</b>
            <span>{d.store === 'vault' ? t('库里的 .canvas-notes/命令.json，跟 Git 走，换台 Mac 也在') : t('只在这台 Mac 的软件设置里')}</span>
          </div>
          <div className="rc">
            <SmallSeg
              label={t('存在哪')}
              value={d.store}
              options={[
                ['vault', t('存在库里')],
                ['local', t('只在这台 Mac')],
              ]}
              onChange={(v) => set({ store: v })}
            />
          </div>
        </div>
      </div>
      <div className="sb-foot">
        <span className="l">{d.id ? withKeys(t('改了以后小条、{k:search}、/ 菜单一起变')) : t('存好以后它也是一条命令')}</span>
        <button type="button" className="sb-btn ghost" onClick={props.onBack}>
          {t('取消')}
        </button>
        <button type="button" className="sb-btn solid" disabled={!ok} onClick={() => void save()}>
          <Codicon name="check" size={14} />
          {withKeys(t('存好 {k:submit}'))}
        </button>
      </div>
    </div>
  )
}

/** AI 收到的样子：空填好的地方染色；没写 {选中的字} 时选中的那段接在最后 */
function SampleText(props: { prompt: string; vars: Record<string, string>; short: string; tail: boolean; t: T }) {
  const { t } = props
  if (!props.prompt.trim()) return <>{t('（还没写）')}</>
  const re = new RegExp(`\\{(${PROMPT_VARS.flatMap((v) => [v.zh, v.en]).join('|')})\\}`, 'g')
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of props.prompt.matchAll(re)) {
    parts.push(props.prompt.slice(last, m.index))
    const v = PROMPT_VARS.find((x) => x.zh === m[1] || x.en === m[1])!
    parts.push(<mark key={m.index}>{props.vars[v.key]}</mark>)
    last = m.index! + m[0].length
  }
  parts.push(props.prompt.slice(last))
  return (
    <>
      {parts}
      {props.tail && (
        <>
          <br />
          <br />
          {t('选中的这段：')}
          <mark>{props.short}</mark>
        </>
      )}
    </>
  )
}

/** 220 宽的分段（原型 .seg.w220；停用的一样灰） */
function SmallSeg<V extends string>(props: { label: string; value: V; options: readonly (readonly [V, string, boolean?])[]; onChange(v: V): void }) {
  return (
    <div className="sb-seg w220" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text, off]) => (
        <button key={v} type="button" role="radio" aria-checked={props.value === v} className={props.value === v ? 'on' : ''} disabled={off} onClick={() => props.value !== v && props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

