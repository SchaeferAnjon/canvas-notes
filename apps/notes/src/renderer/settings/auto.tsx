/**
 * 设置 › 自动化（task-i921u「当……就……」，照 automations/proto.html#dir=b&scene=settings）：
 * 一个总开关、错过的怎么补、跑完发不发通知；软件自带的（周记、梦游、定时整理收件箱）一组；用户自己建的全部规则按在哪建的分组
 * （每个数据库一组、库里建的一组），每条能开关、现在跑一次、改（跳回右栏那一条）、看记录；最近跑的几行。没有自己建的写一句加「新建一条」。
 * 点「周记」进周记的设置（周几、几点、标题、模板、AI 先填、提醒）：周记就是库里那一条自带规则，改这里就是改那一条（auto.save）。
 * 读写都走 renderer/base/auto-ipc.ts（window.cn.auto）；这里不另写一份规则的读写。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { PageHead as BasePageHead, Toggle } from '@cn/design/settings'
import { AUTO_LIB_PATH, type AutoRule, type AutoStep, isoWeekOf, whenLabel } from '@cn/format'
import { type ReactNode, useEffect, useState } from 'react'
import { t as tNow } from '../../shared/i18n'
import { app } from '../ctx/actions'
import { EngineLogo, useChatEngine } from '../engine-logo'
import type { SettingsProps } from '../Settings'
import { useT } from '../i18n'
import { type AutoListing, type AutoLogRow, type AutoRuleInfo, dreamOn, listing, onChanged, prefs, runLog, runRule, saveRule, toggleRule } from '../base/auto-ipc'
import { openAuto } from '../base/auto-state'
import { atText, hasAi, RuleSentence, WEEKDAYS } from '../base/auto-text'
import { Group, Row, Sel, useSaid } from './ui'
import '../base/auto.css'
import './auto.css'

/** 周记标题的三种写法（写进规则里 newNote 的 name；不翻：写进文件的模板） */
const TITLES = { iso: '{{年}}-W{{周}}', cn: '{{年}}年第{{周}}周', range: '{{周一}}—{{周日}}' } as const
type TitleKind = keyof typeof TITLES

/** 这一周照那种写法叫什么（给人看） */
function titleNow(kind: TitleKind, now = new Date()): string {
  const w = isoWeekOf(now)
  if (kind === 'iso') return `${w.year}-W${String(w.week).padStart(2, '0')}`
  // 不翻：写进文件的、e2e 认的
  if (kind === 'cn') return `${w.year}年第${w.week}周`
  // 不翻：写进文件的、e2e 认的
  const d = (x: Date) => `${x.getMonth() + 1}月${x.getDate()}日`
  return `${d(w.monday)}—${d(w.sunday)}`
}

/** 读回来的规则 → 一条一条的「谁 · 在哪」：用户建的按在哪建的分组 */
function groupsOf(rules: AutoRuleInfo[]): { place: string; doc: string; lib: boolean; rows: AutoRuleInfo[] }[] {
  const out = new Map<string, { place: string; doc: string; lib: boolean; rows: AutoRuleInfo[] }>()
  for (const r of rules) {
    if (r.builtIn) continue
    const key = r.ref.where
    if (!out.has(key)) out.set(key, { place: r.place, doc: r.doc, lib: r.kind === 'library', rows: [] })
    out.get(key)!.rows.push(r)
  }
  return [...out.values()].sort((a, b) => Number(a.lib) - Number(b.lib))
}

export function AutoSettingsPage(props: SettingsProps & { sub: 'weekly' | null; onSub(s: 'weekly' | null): void }) {
  const [list, setList] = useState<AutoListing | null>(null)
  const [recent, setRecent] = useState<AutoLogRow[]>([])
  const load = () => {
    void listing().then(setList)
    void runLog(undefined, 6).then((r) => setRecent(r.filter((x) => !x.undo)))
  }
  useEffect(() => {
    load()
    return onChanged(load)
  }, [])
  return props.sub === 'weekly' ? <WeeklyPage {...props} list={list} reload={load} /> : <AutoListPage {...props} list={list} recent={recent} reload={load} />
}

function SysName(props: { icon: CodiconName; name: string; chevron?: boolean }) {
  return (
    <>
      <Codicon name={props.icon} size={14} />
      {props.name}
      {props.chevron && <Codicon name="chevron-right" size={12} />}
    </>
  )
}

/** 第二行：上次做了什么（加粗） */
function Last(props: { info: AutoRuleInfo | null; extra?: ReactNode }) {
  const t = useT()
  const i = props.info
  return (
    <span className="sa-blk">
      {i?.error ? (
        <span className="au-e">{t('上次出错停下了：{why}', { why: i.error })}</span>
      ) : i?.last ? (
        <>
          {t('上次')} <b className="au-b">{atText(i.last)}</b>
          {i.runs ? ` · ${t('跑过{n}次', { n: i.runs })}` : ''}
        </>
      ) : (
        t('还没跑过')
      )}
      {props.extra}
    </span>
  )
}

function AutoListPage(props: SettingsProps & { list: AutoListing | null; recent: AutoLogRow[]; reload(): void; onSub(s: 'weekly' | null): void }) {
  const t = useT()
  const said = useSaid()
  const chat = useChatEngine()
  const { list } = props
  const [running, setRunning] = useState<string | null>(null)
  const p = list?.prefs ?? null
  const dream = props.settings.dream

  const setPrefs = (patch: Parameters<typeof prefs>[0], hint: string, back: Parameters<typeof prefs>[0]) => {
    void prefs(patch).then(props.reload)
    said.saved(hint, () => void prefs(back).then(props.reload))
  }
  const run = async (it: AutoRuleInfo) => {
    const key = `${it.ref.where}#${it.ref.index}`
    setRunning(key)
    const r = await runRule(it.ref)
    setRunning(null)
    if ('error' in r) said.say(t('「{name}」没跑成：{why}', { name: it.rule.name, why: r.error }))
    else if ('ask' in r) said.say(r.ask)
    else said.say(t('「{name}」在跑，跑完底下说一句、记录多一行', { name: it.rule.name }))
  }
  const toggle = (it: AutoRuleInfo, on: boolean) => {
    void toggleRule(it.ref, on).then((r) => (r.ok ? props.reload() : said.say(t('没写进去：{why}', { why: r.error }))))
    const where = it.kind === 'base' ? t('，数据库里跟着变') : ''
    said.saved(on ? t('打开了「{name}」{where}', { name: it.rule.name, where }) : t('关掉了「{name}」{where}', { name: it.rule.name, where }), () => void toggleRule(it.ref, !on).then(props.reload))
  }
  /** 改：跳回右栏那一条（数据库的先打开那篇；库里的在右栏「库里」那一页） */
  const edit = (it: AutoRuleInfo, pane: 'edit' | 'log' = 'edit') => {
    props.onClose()
    const e = pane === 'edit' ? { kind: 'rule' as const, index: it.ref.index, draft: structuredClone(it.rule), said: null, filling: false, problems: it.problems } : null
    if (it.kind === 'library') return openAuto({ table: null, folder: '', lib: true, pane, edit: e })
    app().openFile(it.doc)
    openAuto({ table: null, folder: '', at: it.ref.where, pane, edit: e })
  }
  const runBtn = (it: AutoRuleInfo) =>
    running === `${it.ref.where}#${it.ref.index}` ? (
      <span className="sa-btn au-run">
        <EngineLogo id={chat.id} size={12} className="aic-pulse" />
        {t('在跑')}
      </span>
    ) : (
      <button type="button" className="sa-btn" aria-label={t('现在跑一次「{name}」', { name: it.rule.name })} onClick={() => void run(it)}>
        <Codicon name="play" size={12} />
        {t('现在跑一次')}
      </button>
    )

  const rules = list?.rules ?? []
  const weekly = rules.find((r) => r.builtIn === 'week') ?? null
  const inbox = rules.find((r) => r.builtIn === 'inbox') ?? null
  const dreamInfo = list?.system.find((s) => s.id === 'dream') ?? null
  const groups = groupsOf(rules)

  return (
    <div className="au-set">
      <Group title={t('全部的开关')}>
        <Row id="autoAll">{p && <Toggle on={p.on} label={t('自动化')} onChange={(on) => setPrefs({ on }, on ? t('自动化开回来了') : t('自动化全部停下，规则都留着'), { on: !on })} />}</Row>
        <Row id="autoMissed">
          {p && (
            <Sel
              label={t('Mac 关着时错过的')}
              value={p.missed}
              options={[
                ['once', t('下次打开补跑一次')],
                ['skip', t('跳过，记一行「错过了」')],
              ]}
              onChange={(missed) => setPrefs({ missed }, missed === 'once' ? t('错过的下次打开补跑一次') : t('错过的跳过，记一行「错过了」'), { missed: p.missed })}
            />
          )}
        </Row>
        <Row id="autoTell">
          {p && (
            <Sel
              label={t('跑完告诉我')}
              value={p.notify ? 'notify' : 'toast'}
              options={[
                ['notify', t('底栏一句 + 要紧的发通知')],
                ['toast', t('只在底栏说一句')],
              ]}
              onChange={(v) => setPrefs({ notify: v === 'notify' }, v === 'notify' ? t('跑完底栏说一句，周记、发通知那一步再发系统通知') : t('跑完只在底栏说一句'), { notify: p.notify })}
            />
          )}
        </Row>
      </Group>

      <Group title={t('软件自带的')}>
        {weekly && (
          <div
            className="au-click"
            role="button"
            tabIndex={0}
            /* 不翻：data-part 给 e2e 和样式认 */ data-part="周记"
            onClick={(e) => !(e.target as HTMLElement).closest('.sa-cc') && props.onSub('weekly')}
            onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && props.onSub('weekly')}
          >
            <Row
              id="autoWeekly"
              label={<SysName icon="calendar" name={t('周记')} chevron />}
              desc={
                <>
                  <span className="sa-blk">{weeklyDesc(weekly.rule)}</span>
                  <Last info={weekly} />
                </>
              }
            >
              {runBtn(weekly)}
              <Toggle on={weekly.rule.on} label={t('周记')} onChange={(on) => toggle(weekly, on)} />
            </Row>
          </div>
        )}
        <Row
          id="autoDream"
          label={<SysName icon="wand" name={t('梦游')} />}
          desc={
            <>
              <span className="sa-blk">{t('没人动 {m} 分钟以后，两次至少隔 {h} 小时', { m: dream.idleMinutes, h: dream.gapHours })}</span>
              {dreamInfo?.desc && <span className="sa-blk">{dreamInfo.desc}</span>}
            </>
          }
        >
          <button type="button" className="sa-lnk" onClick={() => props.onGoRow('dAuto')}>
            {t('去梦游页 ›')}
          </button>
          <Toggle
            on={dream.auto}
            label={t('梦游')}
            onChange={(auto) => {
              void dreamOn(auto).then(() => props.onChange({ dream: { auto } }))
              said.saved(auto ? t('自己梦游开了（梦游页里是同一个开关）') : t('自己梦游关了（梦游页里是同一个开关）'), () => void dreamOn(!auto).then(() => props.onChange({ dream: { auto: !auto } })))
            }}
          />
        </Row>
        {inbox && (
          <Row
            id="autoInbox"
            label={<SysName icon="inbox" name={t('定时整理收件箱')} />}
            desc={
              <>
                <span className="sa-blk">{inbox.rule.when.map(whenLabel).join('，')}</span>
                <Last info={inbox} />
              </>
            }
          >
            {runBtn(inbox)}
            <Toggle on={inbox.rule.on} label={t('定时整理收件箱')} onChange={(on) => toggle(inbox, on)} />
          </Row>
        )}
      </Group>

      {groups.map((g, i) => (
        <Group
          key={g.doc + g.place}
          row={i === 0 ? 'autoBase' : undefined}
          label={g.lib ? t('库里建的') : t('数据库里建的')}
          title={
            <>
              {g.lib ? t('库里建的') : t('数据库里建的')}
              <span className="au-gsub">{g.lib ? t('· {doc} · {n}条', { doc: AUTO_LIB_PATH, n: g.rows.length }) : t('· {doc} · {n}条', { doc: g.place, n: g.rows.length })}</span>
            </>
          }
        >
          {g.rows.map((it) => (
            <Row
              key={`${it.ref.where}#${it.ref.index}`}
              id={`autoRule-${it.ref.index}`}
              label={
                <span className="au-rn" data-name={it.rule.name}>
                  {hasAi(it.rule.do) ? <EngineLogo id={chat.id} size={14} /> : <Codicon name="symbol-event" size={14} />}
                  {it.rule.name}
                </span>
              }
              desc={
                <>
                  <span className="sa-blk">
                    <RuleSentence rule={it.rule} typeOf={() => 'text'} plain />
                  </span>
                  <Last
                    info={it}
                    extra={
                      <>
                        {' · '}
                        <button type="button" className="sa-lnk au-inl" onClick={() => edit(it)}>
                          {it.kind === 'base' ? t('在数据库里改') : t('改')}
                        </button>
                        {' · '}
                        <button type="button" className="sa-lnk au-inl" onClick={() => edit(it, 'log')}>
                          {t('看记录')}
                        </button>
                      </>
                    }
                  />
                </>
              }
            >
              {runBtn(it)}
              <Toggle on={it.rule.on} label={it.rule.name} onChange={(on) => toggle(it, on)} />
            </Row>
          ))}
        </Group>
      ))}
      {list && !groups.length && (
        <>
          <div className="sa-grph">{t('自己建的')}</div>
          <div className="sa-card au-none" /* 不翻：data-part 给 e2e 和样式认 */ data-part="还没有自己建的" data-row="autoBase">
            <span>{t('还没有自己建的自动化。在数据库块头点「自动化」，或者在这里新建一条只看时间的（比如每周日晚上提醒我整理）。')}</span>
            <button type="button" className="sa-btn" onClick={() => (props.onClose(), openAuto({ table: null, folder: '', lib: true }))}>
              <Codicon name="add" size={12} />
              {t('新建一条')}
            </button>
          </div>
        </>
      )}
      {groups.length > 0 && (
        <p className="sa-note">
          {(list?.buttons.length ?? 0) > 0 ? t('按钮列点了才跑，不在这里；在数据库里加的自动化会自己出现在这里') : t('在数据库里加的自动化会自己出现在这里')}
          {' · '}
          <button type="button" className="sa-lnk au-inl" onClick={() => (props.onClose(), openAuto({ table: null, folder: '', lib: true }))}>
            {t('新建一条只看时间的')}
          </button>
        </p>
      )}

      <Group title={t('最近跑的')}>
        <Row id="autoRecent" label={null} desc={null} full>
          <div className="au-mini">
            {props.recent.length ? (
              props.recent.map((r) => (
                <div className="m" key={r.id}>
                  <span className="tm">{atText(r.t)}</span>
                  <span className="nm">{r.rule}</span>
                  <span className={r.ok ? (r.undone ? 'u' : '') : 'e'}>{r.ok ? r.did.join('，') : r.error}</span>
                </div>
              ))
            ) : (
              <span className="t3">{t('还没跑过')}</span>
            )}
          </div>
        </Row>
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------- 周记

interface Weekly {
  day: string
  at: string
  folder: string
  title: TitleKind
  template: string
  ai: boolean
  reads: string[]
  remind: boolean
}
// 不翻：写进规则的命令名、读什么的三样（引擎认这几个字）
const WEEK_CMD = '/写这周的周记'
// 不翻：写进文件的、e2e 认的
const READS = ['写了剪了', '做完的待办', '梦游报告'] as const

function weeklyOf(r: AutoRule): Weekly {
  const w = r.when.find((x): x is Extract<AutoRule['when'][number], { on: 'every' }> => x.on === 'every')
  const nn = r.do.find((s): s is Extract<AutoStep, { do: 'newNote' }> => s.do === 'newNote')
  const cmd = r.do.find((s): s is Extract<AutoStep, { do: 'command' }> => s.do === 'command' && s.command === WEEK_CMD)
  const title = (Object.entries(TITLES).find(([, v]) => v === nn?.name)?.[0] ?? 'iso') as TitleKind
  // 不翻：写进文件的、e2e 认的
  return { day: w?.day ?? '日', at: w?.at ?? '20:00', folder: nn?.folder ?? '周记', title, template: nn?.template ?? '周记/模板.md', ai: !!cmd, reads: cmd?.reads ?? [...READS], remind: r.do.some((s) => s.do === 'notify' || s.do === 'todo') }
}

/** 照设置改周记那一条：只动这几样，别的步骤原样 */
function weeklyRule(r: AutoRule, w: Weekly): AutoRule {
  const when = r.when.map((x) => (x.on === 'every' ? { ...x, every: 'week' as const, day: w.day, at: w.at } : x))
  let steps = r.do.map((s) => (s.do === 'newNote' ? { ...s, folder: w.folder, name: TITLES[w.title], template: w.template } : s))
  const hasCmd = steps.some((s) => s.do === 'command' && s.command === WEEK_CMD)
  if (w.ai && !hasCmd) {
    const at = steps.findIndex((s) => s.do === 'newNote') + 1
    steps = [...steps.slice(0, at), { do: 'command', command: WEEK_CMD, reads: w.reads }, ...steps.slice(at)]
  } else if (!w.ai) steps = steps.filter((s) => !(s.do === 'command' && s.command === WEEK_CMD))
  steps = steps.map((s) => (s.do === 'command' && s.command === WEEK_CMD ? { ...s, reads: w.reads } : s))
  const reminds = steps.some((s) => s.do === 'notify' || s.do === 'todo')
  // 不翻：写进规则的通知、待办的字
  if (w.remind && !reminds) steps = [...steps, { do: 'notify', text: '这周的周记建好了' }, { do: 'todo', text: '写周记 [[{{新建的那篇}}]]', file: `${w.folder}/待办.md`, date: '今天 21:00' }]
  if (!w.remind) steps = steps.filter((s) => s.do !== 'notify' && s.do !== 'todo')
  return { ...r, when, do: steps }
}

function weeklyDesc(r: AutoRule): string {
  const w = weeklyOf(r)
  return w.ai ? tNow('每周{day} {at} 新建本周那篇，AI 先填本周摘要', { day: tNow(w.day, { ctx: '星期' }), at: w.at }) : tNow('每周{day} {at} 新建本周那篇', { day: tNow(w.day, { ctx: '星期' }), at: w.at })
}

function WeeklyPage(props: SettingsProps & { list: AutoListing | null; reload(): void; onSub(s: 'weekly' | null): void }) {
  const t = useT()
  const said = useSaid()
  const chat = useChatEngine()
  const info = props.list?.rules.find((r) => r.builtIn === 'week') ?? null
  const [running, setRunning] = useState(false)
  /** 模板那一篇的几行（没有这一篇时是引擎自带的那几节，main/automation-engine.ts 的 WEEK_TEMPLATE） */
  const [tpl, setTpl] = useState('')
  const tplPath = info ? weeklyOf(info.rule).template : null
  useEffect(() => {
    if (!tplPath) return
    // 不翻：模板里的字是那篇文件的样子
    const fallback = '## 这周最想记住的\n## 下周想做\n- [ ] '
    window.cn.readNote(tplPath).then(
      (n) => setTpl(n.text.replace(/^---\n[\s\S]*?\n---\n/, '').trim().split('\n').filter((l) => l.trim()).slice(0, 8).join('\n') || fallback),
      () => setTpl(fallback),
    )
  }, [tplPath])
  /** 刚改过的那一条（读回来之前接着改：连着点「五」又关 AI，第二下照第一下改完的样子改） */
  const [mine, setMine] = useState<AutoRule | null>(null)
  if (!info) return null
  const rule = mine ?? info.rule
  const w = weeklyOf(rule)
  const put = (p: Partial<Weekly>, hint: string) => {
    const before = rule
    const next = weeklyRule(rule, { ...w, ...p })
    setMine(next)
    void saveRule(info.ref.where, info.ref.index, next).then((r) => (r.ok ? props.reload() : said.say(t('没写进去：{why}', { why: r.error }))))
    said.saved(hint, () => (setMine(before), void saveRule(info.ref.where, info.ref.index, before).then(props.reload)))
  }
  const title = titleNow(w.title)
  const day = (d: string) => t(d, { ctx: '星期' })
  const run = async () => {
    setRunning(true)
    const r = await runRule(info.ref)
    setRunning(false)
    if ('error' in r) said.say(t('周记没跑成：{why}', { why: r.error }))
    else said.say(t('周记在跑：新建「{title}」，跑完底下说一句、能撤回', { title }))
  }
  const ck = (k: (typeof READS)[number], name: string) => (
    <label className="au-ck" key={k}>
      <input
        type="checkbox"
        checked={w.reads.includes(k)}
        onChange={(e) => {
          const on = e.currentTarget.checked
          put({ reads: on ? [...READS.filter((x) => x === k || w.reads.includes(x))] : w.reads.filter((x) => x !== k) }, on ? t('AI 填摘要时读「{name}」', { name }) : t('AI 填摘要时不读「{name}」', { name }))
        }}
      />
      {name}
    </label>
  )
  return (
    <div className="au-set">
      <div className="au-subhead">
        <button type="button" className="ib" aria-label={t('回到自动化')} onClick={() => props.onSub(null)}>
          <Codicon name="arrow-left" size={14} />
        </button>
        <BasePageHead icon={<Codicon name="calendar" size={18} />} title={t('周记')} desc={t('到点在「{folder}」里新建本周那篇；这一样也是一条自动化，和数据库里的同一套', { folder: w.folder })} />
        <Toggle
          on={rule.on}
          label={t('周记')}
          onChange={(on) => {
            setMine({ ...rule, on })
            void toggleRule(info.ref, on).then(props.reload)
            said.saved(on ? t('周记开了：每周{day} {at} 新建本周那篇', { day: day(w.day), at: w.at }) : t('周记关了：到点不再新建'), () => void toggleRule(info.ref, !on).then(props.reload))
          }}
        />
      </div>
      <Group title={t('什么时候')}>
        <Row id="weekDay">
          <div className="au-days" role="radiogroup" aria-label={t('每周几')}>
            {WEEKDAYS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={w.day === d} className={w.day === d ? 'on' : ''} onClick={() => w.day !== d && put({ day: d }, t('以后每周{day} {at} 新建周记', { day: day(d), at: w.at }))}>
                {day(d)}
              </button>
            ))}
          </div>
        </Row>
        <Row id="weekAt">
          <Sel label={t('几点')} value={w.at} options={[...new Set(['18:00', '19:00', '20:00', '21:00', '22:00', w.at])].map((x) => [x, x] as const)} onChange={(at) => put({ at }, t('以后每周{day} {at} 新建周记', { day: day(w.day), at }))} />
        </Row>
      </Group>
      <Group title={t('新建哪一篇')}>
        <Row id="weekFolder" desc={t('顶级分类「{folder}」', { folder: w.folder })}>
          <span className="au-val">
            <Codicon name="calendar" size={14} />
            {w.folder}
          </span>
        </Row>
        <Row id="weekTitle" desc={t('这周那篇叫「{title}」', { title })}>
          <Sel
            label={t('标题')}
            value={w.title}
            options={[
              ['iso', titleNow('iso')],
              ['cn', titleNow('cn')],
              ['range', titleNow('range')],
            ]}
            onChange={(v) => put({ title: v }, t('这周那篇叫「{title}」', { title: titleNow(v) }))}
          />
        </Row>
        {/* 不翻：模板里的字是那篇文件的样子 */}
        <Row id="weekTpl" desc={t('「{file}」，改它就改以后每一篇', { file: w.template })} more={<pre className="au-tpl">{tpl}</pre>}>
          <button type="button" className="sa-btn" onClick={() => (props.onClose(), app().openFile(w.template))}>
            <Codicon name="edit" size={12} />
            {t('改模板')}
          </button>
        </Row>
      </Group>
      <Group
        label={t('AI 先填本周摘要')}
        title={
          <span className="au-gt">
            <EngineLogo id={chat.id} size={14} />
            {t('AI 先填本周摘要')}
          </span>
        }
      >
        <Row
          id="weekAi"
          // 不翻：命令名和模板里留给你写的那一节是文件里的字
          desc={t('就是「{cmd}」那条命令：写进带标志的 AI 块，「{keep}」留给你写 · 用 {engine}（跟 AI 对话）', { cmd: WEEK_CMD, keep: '这周最想记住的', engine: chat.label })}
          // 不翻：写进文件的、e2e 认的
          more={w.ai ? <div className="au-cks">{[ck('写了剪了', t('这周写了、剪了什么')), ck('做完的待办', t('做完的待办')), ck('梦游报告', t('梦游整理了什么'))]}</div> : undefined}
        >
          <Toggle on={w.ai} label={t('建好以后让 AI 先填一段')} onChange={(ai) => put({ ai }, ai ? t('建好以后 AI 先填本周摘要') : t('建好以后不让 AI 填，只照模板建'))} />
        </Row>
        {/* 周记开着时梦游的「写本周小结」一定并进周记（用户定的 ⑥，主进程 index.ts 管）：这里只说一句，跟着周记的开关 */}
        <Row id="weekMerge" desc={info.rule.on ? undefined : t('周记关着：梦游照梦游页的设置写本周小结')}>
          <Toggle on={info.rule.on} label={t('梦游的「写本周小结」')} disabled onChange={() => undefined} />
        </Row>
      </Group>
      <Group title={t('提醒我写')}>
        <Row id="weekRemind">
          <Toggle on={w.remind} label={t('建好就提醒')} onChange={(remind) => put({ remind }, remind ? t('周记建好就提醒你写') : t('周记建好不提醒'))} />
        </Row>
      </Group>
      <Group title={t('现在就试')}>
        <Row id="weekRun" desc={t('新建「{title}」，和到点时一样；能撤回 · 上次 {last}', { title, last: info.last ? atText(info.last) : t('还没跑过') })}>
          {running ? (
            <span className="sa-btn au-run">
              <EngineLogo id={chat.id} size={12} className="aic-pulse" />
              {t('AI 在填…')}
            </span>
          ) : (
            <button type="button" className="sa-btn primary" onClick={() => void run()}>
              <Codicon name="play" size={12} />
              {t('现在跑一次')}
            </button>
          )}
        </Row>
      </Group>
    </div>
  )
}
