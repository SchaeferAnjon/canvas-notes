/**
 * 设置 › 对外接口（task-av5t8，方案 46-对外开放MCP 第一批，原型 img/08、09）：
 * 总开关（默认关）；各家 AI 一行（Claude Code、Codex「装上」写进它的配置，Claude 桌面版、别的 AI「拷贝配置」，
 * ParaRead、MeetCaption「接上」；打开后只读，「读和写」灰着写「下一批」）；自动化外面怎么跑（这一批只列出来）；
 * 调用记录（点「看记录」进记录那一页：谁、什么时候、调了什么、回了多少字）。主进程在 main/mcp-ext.ts。
 */
import { Codicon } from '@cn/design'
import { Toggle } from '@cn/design/settings'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { MCP_CLIENT_NAMES, MCP_CLIENTS, type McpCall, type McpClientId, type McpRow, type McpView } from '../../shared/mcp'
import { t as tNow } from '../../shared/i18n'
import { clock, when } from '../../shared/when'
import { type AutoRuleInfo, listing } from '../base/auto-ipc'
import { useT } from '../i18n'
import type { SettingsProps } from '../Settings'
import { SETTINGS_PAGES } from '../../shared/settings-index'
import { Group, PageHead, Row, Sel, useSaid } from './ui'
import './mcp.css'
import { ipcOn } from '../crash/ipc'

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 各家的名字：Claude 桌面版、别的 AI 有中文叫法，其余是专有名 */
function nameOf(id: McpClientId): string {
  if (id === 'claude-desktop') return tNow('Claude 桌面版')
  if (id === 'other') return tNow('别的AI')
  return MCP_CLIENT_NAMES[id]
}

/** 家里的路径写短：/Users/x/.claude.json → ~/.claude.json */
const tilde = (p: string | undefined) => (p ?? '').replace(/^\/Users\/[^/]+/, '~')

export function McpSettingsPage(props: SettingsProps) {
  const [v, setV] = useState<McpView | null>(null)
  const [sub, setSub] = useState<'main' | 'log'>('main')
  const [logFor, setLogFor] = useState<McpClientId | 'all'>('all')
  const load = () => void window.cnMcp.get().then(setV)
  useEffect(() => {
    load()
    const off = ipcOn(window.cnMcp.onCalled, 'cnMcp.onCalled')(() => load())
    // 窗口重新拿到焦点（去装了 Claude Code、Codex 回来）：再看一下
    const f = () => void window.cnMcp.recheck().then(setV)
    window.addEventListener('focus', f)
    return () => (off(), window.removeEventListener('focus', f))
  }, [])
  if (sub === 'log') return <McpLog client={logFor} onClient={setLogFor} onBack={() => setSub('main')} />
  return (
    <>
      <PageHead page={SETTINGS_PAGES.find((p) => p.id === 'mcp')!} />
      {v && <McpMain {...props} v={v} setV={setV} onLog={(c) => (setLogFor(c), setSub('log'))} />}
    </>
  )
}

function McpMain(props: SettingsProps & { v: McpView; setV(v: McpView): void; onLog(c: McpClientId | 'all'): void }) {
  const t = useT()
  const said = useSaid()
  const { v } = props
  const [busy, setBusy] = useState<McpClientId | null>(null)
  const act = async (id: McpClientId, f: () => Promise<McpView>, ok: (v: McpView) => string) => {
    setBusy(id)
    try {
      const next = await f()
      props.setV(next)
      said.say(ok(next))
    } catch (e) {
      said.say(t('没做成：{why}', { why: errText(e) }))
    } finally {
      setBusy(null)
    }
  }
  const setOn = (on: boolean) => {
    void window.cnMcp
      .setOn(on)
      .then(props.setV)
      .catch((e: unknown) => said.say(t('没做成：{why}', { why: errText(e) })))
    said.saved(on ? t('别的AI能连进来了：只读，没装上的还连不上') : t('关上了：谁都连不上，装上的配置留着'), () => void window.cnMcp.setOn(!on).then(props.setV))
  }
  const copy = async (id: McpClientId) => {
    setBusy(id)
    try {
      await window.cnMcp.copyConfig(id)
      props.setV(await window.cnMcp.get())
      said.say(id === 'claude-desktop' ? t('拷好了：贴进 Claude 桌面版的配置，完全退出 Claude 再打开') : t('拷好了：贴进它的MCP设置，重开一次它就认'))
    } catch (e) {
      said.say(t('没做成：{why}', { why: errText(e) }))
    } finally {
      setBusy(null)
    }
  }

  const row = (r: McpRow) => {
    const name = nameOf(r.id)
    const off = !v.on || busy === r.id
    const used = r.lastUsed ? t('{when} 用过 · 7天调了{n}次', { when: when(r.lastUsed, { time: true }), n: r.calls7 }) : t('还没用过')
    const level = (
      <Sel
        label={t('{name}能做到哪', { name })}
        value="read"
        disabled={!v.on}
        options={[
          ['read', t('只读')],
          ['write', t('读和写（下一批）'), true],
        ]}
        onChange={() => undefined}
      />
    )
    // 一页只有一颗黑色主按钮的规矩：这一页的「装上」「接上」「拷贝配置」都是普通按钮（designer 复审）
    const btn = (label: string, onClick: () => void, aria?: string) => (
      <button type="button" className="sa-btn" disabled={off} aria-label={aria} onClick={onClick}>
        {label}
      </button>
    )
    const remove = btn(r.id === 'pararead' || r.id === 'meetcaption' || r.id === 'claude-code' || r.id === 'codex' ? t('断开') : t('作废钥匙'), () =>
      void act(r.id, () => window.cnMcp.remove(r.id), () => t('{name}断开了：钥匙作废，它再调会被拒', { name })),
    )
    let desc: ReactNode
    let ctl: ReactNode
    const dot = <i className="dot" />
    switch (r.id) {
      case 'claude-code':
      case 'codex': {
        const cmd = r.id === 'codex' ? 'codex' : 'claude'
        if (r.installed) {
          desc = (
            <>
              {dot}
              {t('已装上 · {used}', { used })}
            </>
          )
          ctl = (
            <>
              {level}
              {remove}
            </>
          )
        } else if (!r.found) {
          desc = r.id === 'codex' ? t('没找到 codex 命令 · brew install codex 装好后点「再看一下」') : t('没找到 claude 命令 · 照 claude.ai/install.sh 装好后点「再看一下」')
          ctl = btn(t('再看一下'), () => void act(r.id, () => window.cnMcp.recheck(), (n) => (n.rows.find((x) => x.id === r.id)?.found ? t('找到{cmd}了，能装上了', { cmd }) : t('还是没找到{cmd}命令', { cmd }))))
        } else {
          desc = r.keyed ? t('配置里没有了（可能被别的程序改掉了）：点「装上」再写一次') : t('点「装上」写进{path}，新开的会话就能用', { path: tilde(r.configPath) })
          ctl = btn(t('装上'), () => void act(r.id, () => window.cnMcp.install(r.id), () => t('装上了：写进了{path}；新开一个{name}会话就能用', { path: tilde(r.configPath), name })))
        }
        break
      }
      case 'claude-desktop':
        if (r.installed) {
          desc = (
            <>
              {dot}
              {t('已在 Claude 桌面版的配置里 · {used}', { used })}
            </>
          )
          ctl = (
            <>
              {level}
              {remove}
            </>
          )
        } else {
          desc = r.found ? t('拷贝配置，贴进 Claude › 设置 › 开发者 › 编辑配置，完全退出 Claude 再打开') : t('没找到 Claude 桌面版；装了以后照样拷贝配置')
          ctl = btn(t('拷贝配置'), () => void copy(r.id), t('拷贝 {name} 的配置', { name }))
        }
        break
      case 'pararead':
      case 'meetcaption':
        if (!r.found) {
          desc = t('没装 · 装上后在这里能接上')
          ctl = (
            <button type="button" className="sa-btn" aria-label={t('去软件家族看{name}', { name })} onClick={() => props.onGoRow(`fam-${r.id}`)}>
              {t('去看看')}
            </button>
          )
        } else if (r.installed) {
          desc = (
            <>
              {dot}
              {t('已接上 · {used}', { used })}
            </>
          )
          ctl = (
            <>
              {level}
              {remove}
            </>
          )
        } else {
          desc = r.version ? t('已装 {version} · 接上后它能找你的笔记、在画布笔记里打开某篇', { version: r.version }) : t('已装 · 接上后它能找你的笔记、在画布笔记里打开某篇')
          ctl = btn(t('接上'), () => void act(r.id, () => window.cnMcp.install(r.id), () => t('接上了：{name}下次拉起 AI 时带上画布笔记', { name })))
        }
        break
      case 'other':
        desc = r.keyed ? t('拷过一份配置 · {used}', { used }) : t('Cursor、Zed、OpenCode……拷一段配置贴进它的MCP设置；这份配置带自己的钥匙，能单独断开')
        ctl = (
          <>
            {btn(t('拷贝配置'), () => void copy(r.id), t('拷贝 {name} 的配置', { name }))}
            {r.keyed && remove}
          </>
        )
        break
    }
    return (
      <Row key={r.id} id={`mcp-${r.id}`} label={name} desc={desc} dim={!v.on}>
        {ctl}
      </Row>
    )
  }

  return (
    <div className="mcp-set">
      <div className="sa-card" role="group" aria-label={t('让别的AI连进来')}>
        <Row id="mcpOn">
          <Toggle on={v.on} label={t('让别的AI连进来')} onChange={setOn} />
        </Row>
        <Row id="mcpLog" desc={v.calls7 ? (v.failed7 ? t('最近7天{n}次 · 没成{m}次 · 记录只存在这台Mac上', { n: v.calls7, m: v.failed7 }) : t('最近7天{n}次 · 记录只存在这台Mac上', { n: v.calls7 })) : t('最近7天还没有调用 · 记录只存在这台Mac上')}>
          <button type="button" className="sa-btn" onClick={() => props.onLog('all')}>
            {t('看记录')}
          </button>
        </Row>
      </div>

      <Group title={t('各家AI')} label={t('各家AI')}>
        <div className="mcp-cl">{v.rows.map(row)}</div>
      </Group>
      {!v.on && <p className="sa-note">{t('先打开上面的开关；关着时装上的配置留着，各家调用会被拒。')}</p>}

      <McpAuto />
      <p className="sa-note">{t('现在只给读：搜、读某一节、看最近改的和待办、在画布笔记里打开。能上网的AI读到剪藏里的字时可能被带偏，写入要每家单独开。')}</p>
    </div>
  )
}

/** 自动化外面怎么跑：现在的深链、命令行；让外面的 AI 跑在下一批（这一批只列出来） */
function McpAuto() {
  const t = useT()
  const [rules, setRules] = useState<AutoRuleInfo[] | null>(null)
  useEffect(() => void listing().then((l) => setRules(l.rules)), [])
  const said = useSaid()
  /** 深链：拷的是转义过的，显示的是人认得出的 */
  const link = (r: AutoRuleInfo, raw = false) => {
    const e = raw ? encodeURIComponent : (s: string) => s
    return `canvas-notes://automation/run?name=${e(r.rule.name)}${r.kind === 'base' ? `&where=${e(r.place)}` : ''}`
  }
  return (
    <Group
      row="mcpAuto"
      label={t('自动化')}
      title={
        <>
          {t('自动化')}
          <small>{t('能用深链和命令行跑一条规则')}</small>
        </>
      }
    >
      {rules?.map((r) => (
        <Row
          key={`${r.ref.where}#${r.ref.index}`}
          id={`mcpAuto-${r.ref.index}`}
          label={r.rule.name}
          desc={
            <span className="mcp-link" title={link(r, true)}>
              {r.rule.on ? t('开着') : t('关着')} · <code>{link(r)}</code>
            </span>
          }
        >
          <button
            type="button"
            className="sa-btn"
            aria-label={t('拷贝「{name}」的链接', { name: r.rule.name })}
            onClick={() => void window.cnMcp.copyText(link(r, true)).then(() => said.say(t('拷好了：在浏览器地址栏、终端的 open 里用它跑「{name}」', { name: r.rule.name })))}
          >
            {t('拷贝链接')}
          </button>
        </Row>
      ))}
      <Row id="mcpAutoAi" label={t('让外面的AI运行自动化、加规则')} desc={t('下一批：跑之前在画布笔记里问你一句')} dim>
        <Toggle on={false} label={t('让外面的AI运行自动化、加规则')} disabled onChange={() => undefined} />
      </Row>
    </Group>
  )
}

/** 回给 AI 的那句（英文）在记录里说成人话；认不出的照原话（原话都在悬停里） */
function errorSaid(e: string): string {
  let m: RegExpExecArray | null
  if ((m = /^No section "(.+?)" in this note/.exec(e))) return tNow('这篇里没有「{section}」一节', { section: m[1]! })
  if ((m = /^No note at "(.+?)"/.exec(e))) return tNow('库里没有{path}', { path: m[1]! })
  if (/does not recognize this key/.test(e)) return tNow('钥匙不对（断开过或重装过）')
  if (/is turned off/.test(e)) return tNow('对外接口关着')
  if (/not running|did not start/.test(e)) return tNow('画布笔记没开着，也没拉起来')
  if (/has not opened a vault|no vault is open/.test(e)) return tNow('还没打开库')
  return e
}

/** 调用记录那一句：搜了什么、读了哪一节、打开到第几行 */
function callText(c: McpCall): string {
  const a = c.args as Record<string, string | number | boolean | undefined>
  if (!c.ok) return tNow('没成：{why}', { why: errorSaid(c.error ?? '') })
  const title = c.title ?? String(a.path ?? '')
  switch (c.tool) {
    case 'search_notes':
      return tNow('搜「{q}」· 回了{n}篇', { q: String(a.query ?? ''), n: c.n ?? 0 })
    case 'read_note':
      if (a.outline_only) return tNow('读《{title}》的目录', { title })
      if (a.section) return tNow('读《{title}》「{section}」一节', { title, section: String(a.section) })
      if (a.from_line || a.to_line) return tNow('读《{title}》第{line}行起', { title, line: c.line ?? 1 })
      return tNow('读《{title}》全篇', { title })
    case 'list_recent':
      return tNow('看最近{days}天改过的 · {n}篇', { days: Number(a.days ?? 7), n: c.n ?? 0 })
    case 'list_tasks':
      return tNow('看待办 · {n}条', { n: c.n ?? 0 })
    case 'list_vaults':
      return tNow('看开过的库 · {n}个', { n: c.n ?? 0 })
    case 'open_note':
      return tNow('在画布笔记里打开《{title}》第{line}行', { title, line: c.line ?? 1 })
    default:
      return c.tool
  }
}

function McpLog(props: { client: McpClientId | 'all'; onClient(c: McpClientId | 'all'): void; onBack(): void }) {
  const t = useT()
  const [days, setDays] = useState(7)
  const [calls, setCalls] = useState<McpCall[] | null>(null)
  const q = useMemo(() => ({ days, ...(props.client === 'all' ? {} : { client: props.client }) }), [days, props.client])
  useEffect(() => {
    const load = () => void window.cnMcp.calls(q).then(setCalls)
    load()
    return ipcOn(window.cnMcp.onCalled, 'cnMcp.onCalled')(load)
  }, [q])
  return (
    <div className="mcp-set mcp-log">
      <button type="button" className="sa-lnk mcp-back" onClick={props.onBack}>
        <Codicon name="arrow-left" size={12} />
        {t('对外接口')}
      </button>
      <h3 className="mcp-h">{t('调用记录')}</h3>
      <p className="mcp-sub">{t('谁、什么时候、调了哪个工具、回了多少字；只存在这台Mac上')}</p>
      <div className="mcp-filters">
        <Sel
          label={t('哪家AI')}
          value={props.client}
          options={[['all', t('全部AI')] as const, ...MCP_CLIENTS.map((id) => [id, nameOf(id)] as const)]}
          onChange={(c) => props.onClient(c)}
        />
        <Sel<number>
          label={t('多久以内')}
          value={days}
          options={[
            [1, t('今天')],
            [7, t('最近7天')],
            [30, t('最近30天')],
          ]}
          onChange={setDays}
        />
      </div>
      {calls?.length ? (
        dayGroups(calls).map((g, gi) => (
          <McpDay key={g.day} label={g.label} calls={g.calls} open={gi < 2 || props.client !== 'all' || days === 1} />
        ))
      ) : (
        <div className="sa-card mcp-empty">{calls ? t('这段时间还没有调用。装上以后，在 Claude Code 里问「我的笔记里哪篇写过……」试试。') : ''}</div>
      )}
    </div>
  )
}

/** 按天分：今天、昨天、周四、11月20日（when() 的日子写法，去掉钟点） */
function dayGroups(calls: McpCall[]): { day: string; label: string; calls: McpCall[] }[] {
  const out: { day: string; label: string; calls: McpCall[] }[] = []
  for (const c of calls) {
    const d = new Date(c.at)
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    let g = out[out.length - 1]
    if (!g || g.day !== day) out.push((g = { day, label: when(c.at, { time: true }).replace(/\s*\d{1,2}:\d{2}.*$/, ''), calls: [] }))
    g.calls.push(c)
  }
  return out
}

/** 一天的记录：今天、昨天开着，更早的收着只写几次，点开再看 */
function McpDay(props: { label: string; calls: McpCall[]; open: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(props.open)
  return (
    <section className="mcp-day">
      <button type="button" className="mcp-dh" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        {props.label}
        <span>{t('{n}次', { n: props.calls.length })}</span>
      </button>
      {open && (
        <div className="sa-card mcp-rows" role="list" aria-label={t('{day}的调用', { day: props.label })}>
          {props.calls.map((c, i) => (
            <div key={c.at + ':' + i} role="listitem" className={'mcp-call' + (c.ok ? '' : ' bad')}>
              <span className="mc-tm">{clock(c.at)}</span>
              <span className="mc-who">{c.client ? nameOf(c.client) : t('不认识的钥匙')}</span>
              <span className="mc-tool">{c.tool}</span>
              <span className="mc-what" title={c.ok ? callText(c) : (c.error ?? '')}>
                {callText(c)}
                {c.offline && <span className="mc-off">{t('软件没开着，直接读的文件')}</span>}
              </span>
              <span className="mc-n">{t('{n}字', { n: c.chars.toLocaleString() })}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
