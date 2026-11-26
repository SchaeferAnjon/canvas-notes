/**
 * 设置 › AI「各家命令行」（task-m55m7，用户 r20：「Claude Code 更新了…我们是否还兼容」）：一家一行，
 * 名字前面它的标志；说明那一行：版本 · 能不能用（自查出的问题照实写）· 拉到几个模型、什么时候拉的；
 * 右边「检查更新」（重读版本、重拉模型、看有没有新版本）/「更新到 x」（跑它官方的更新，跑完再自查）。不自己升级，点了才升。
 * 没找到的「安装」、找到了运行不了的「修复」（r172 A6）：照官方装法装在用户目录（主进程 agent/cli-install.ts），装的时候说明那一行写进度，
 * 没装上写一句人话，「看详情」展开输出的最后几十行。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { ipcOn } from './crash/ipc'
import type { EngineId, EngineInfo } from '../shared/agent'
import type { CliId } from '@cn/ai-engines/shared'
import { healthText } from '@cn/ai-engines/shared'
import { EngineLogo } from './engine-logo'
/** 主进程报的错去掉 Electron 加的前缀 */
const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
import { Group, Row, useSaid } from './settings/ui'
import { t as tNow } from '../shared/i18n'
import { useT } from './i18n'

export const CLI_ROW: Record<CliId, string> = { claude: 'cliClaude', codex: 'cliCodex', gemini: 'cliGemini', opencode: 'cliOpencode' }

/** 说明那一行：前面一个小点（绿 能用，黄 没查成、正在查、只是提醒，红 不兼容、没更新成），后面一句 */
export function engineStatus(e: EngineInfo): { dot: 'ok' | 'warn' | 'bad' | 'off' | null; text: string } {
  if (!e.path) return { dot: e.broken ? 'bad' : 'off', text: e.broken ? tNow('找到了，运行不了') : tNow('没找到') }
  if (e.update?.state === 'running') return { dot: 'warn', text: tNow('正在运行 {cmd}…', { cmd: e.update.text }) }
  if (!e.version) return { dot: 'warn', text: tNow('正在读版本…') }
  const parts: string[] = []
  let dot: 'ok' | 'warn' | 'bad' = 'ok'
  if (e.update?.state === 'failed') {
    parts.push(tNow('没更新成：{why}', { why: e.update.why }))
    dot = 'bad'
  }
  if (e.checking) {
    parts.push(tNow('{v} · 正在自查…', { v: e.version }))
    if (dot === 'ok') dot = 'warn'
  } else if (e.health) {
    parts.push(healthText(e.health))
    if (e.health.state === 'bad') dot = 'bad'
    else if (e.health.state !== 'ok' && dot === 'ok') dot = 'warn'
  } else {
    parts.push(e.version)
    if (dot === 'ok') dot = 'warn'
  }
  // 不兼容时只说问题（模型几个、什么时候拉的这会儿不要紧）
  if (e.health?.state !== 'bad' && e.pulled) parts.push(e.pulledCount ? tNow('{n}个模型，{when}', { n: e.pulledCount, when: e.pulled }) : e.pulled)
  if (e.update?.state === 'ok' && e.update.from && e.update.to && e.update.from !== e.update.to) parts.push(tNow('刚从 {from} 更新到 {to}', { from: e.update.from, to: e.update.to }))
  if (e.latest) parts.push(tNow('有新版 {v}', { v: e.latest }))
  if (e.latestNote) parts.push(e.latestNote)
  if (e.updateWith && 'none' in e.updateWith) parts.push(e.updateWith.none)
  return { dot, text: parts.join(' · ') }
}

/** 说明里的参数、接口名（--mcp-config、thread/start）用等宽 */
function withCode(text: string) {
  return text.split(/(--?[a-z][\w-]*(?: [a-z][\w-]*)?|\b[a-z]+\/[\w/.]+)/i).map((part, i) => (i % 2 ? <code key={i} className="aipk-code">{part}</code> : part))
}

/** 没装上时展开的输出（同 AI 出错的「看原话」）：右上角「拷贝」 */
function CliLog({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="aipk-cli-logbox">
      <pre className="aipk-cli-log">{text}</pre>
      <button
        type="button"
        className="aipk-cli-copy"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        <Codicon name="copy" size={14} />
        {copied ? t('已拷贝') : t('拷贝')}
      </button>
    </div>
  )
}

/** 正在装、没装上的那几家：装法（安装 / 修复）、最后一行输出、没装上的一句和输出、详情开没开 */
type Inst = { mode: 'install' | 'repair'; line: string; failed?: { error: string; log: string[] }; open?: boolean }

export function EngineRows(props: { engines: EngineInfo[]; onNotice(t: string): void }) {
  const t = useT()
  const said = useSaid()
  const [inst, setInst] = useState<Partial<Record<EngineId, Inst>>>({})
  const patch = (id: EngineId, p: Partial<Inst> | null) => setInst((m) => ({ ...m, [id]: p === null ? undefined : ({ ...m[id], ...p } as Inst) }))
  useEffect(() => ipcOn(window.cn.onAiCliLine, 'cn.onAiCliLine')(({ id, line }) => setInst((m) => (m[id] && !m[id]!.failed ? { ...m, [id]: { ...m[id]!, line } } : m))), [])
  const install = async (e: EngineInfo, mode: 'install' | 'repair') => {
    patch(e.id, { mode, line: '', failed: undefined, open: false })
    const r = await window.cn.aiCliInstall(e.id, mode)
    if (r.ok) {
      patch(e.id, null)
      said.say(mode === 'repair' ? tNow('{name}修好了', { name: e.label }) : tNow('{name}装好了', { name: e.label }))
    } else patch(e.id, { failed: { error: r.error, log: r.log } })
  }
  /** 正在「检查更新」的那几家（等主进程做完） */
  const [busy, setBusy] = useState<Set<EngineId>>(new Set())
  const mark = (id: EngineId, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const check = async (e: EngineInfo) => {
    mark(e.id, true)
    try {
      await window.cn.aiCliCheck(e.id)
    } catch (err) {
      props.onNotice(errText(err))
    } finally {
      mark(e.id, false)
    }
  }
  const update = async (e: EngineInfo) => {
    try {
      const r = await window.cn.aiCliUpdate(e.id)
      if (r.update?.state === 'failed') said.say(tNow('{name}没更新成：{why}', { name: e.label, why: r.update.why }))
      else if (r.update?.state === 'ok') said.say(r.update.from && r.update.to && r.update.from !== r.update.to ? tNow('{name}更新好了：{from} → {to}', { name: e.label, from: r.update.from, to: r.update.to }) : tNow('{name}已是最新', { name: e.label }))
    } catch (err) {
      props.onNotice(errText(err))
    }
  }
  // 「更新到 x」实心黑只给一颗：不兼容、又有新版的第一家（design 复审：一页一颗主按钮，给真坏了的那家）；别的有新版的是次按钮「更新」
  const urgent = props.engines.find((e) => e.health?.state === 'bad' && e.latest)?.id
  return (
    <Group title={t('各家命令行')}>
      {props.engines.map((e) => {
        const ins = inst[e.id]
        const st = ins
          ? ins.failed
            ? { dot: 'bad' as const, text: ins.mode === 'repair' ? tNow('没修好：{why}', { why: ins.failed.error }) : tNow('没装上：{why}', { why: ins.failed.error }) }
            : { dot: 'warn' as const, text: ins.line ? '' : ins.mode === 'repair' ? tNow('正在修复…') : tNow('正在安装…') }
          : engineStatus(e)
        const running = e.update?.state === 'running'
        const canUpdate = !ins && !!e.path && !!e.updateWith && 'text' in e.updateWith
        const log = ins?.failed?.log ?? []
        return (
          <Row
            key={e.id}
            id={CLI_ROW[e.id as CliId]}
            label={
              <>
                <EngineLogo id={e.id} size={16} />
                {e.label}
              </>
            }
            desc={
              <span title={e.health?.note ?? (e.path ? undefined : (e.broken ?? undefined))} data-testid={`cli-desc-${e.id}`}>
                {st.dot && <span className={'dot' + (st.dot === 'ok' ? '' : ` ${st.dot}`)} />}
                {withCode(st.text)}
                {/* 正在装：命令行的那一行输出原样（等宽） */}
                {ins && !ins.failed && ins.line && <code className="aipk-code">{ins.line}</code>}
                {log.length > 0 && (
                  <>
                    <span className="aipk-cli-sep"> · </span>
                    <button type="button" className="aipk-cli-more" aria-expanded={!!ins?.open} data-testid={`cli-log-${e.id}`} onClick={() => patch(e.id, { open: !ins?.open })}>
                      {ins?.open ? t('收起原话') : t('看原话')}
                      <Codicon name={ins?.open ? 'chevron-down' : 'chevron-right'} size={12} />
                    </button>
                  </>
                )}
              </span>
            }
            {...(ins?.open && log.length ? { more: <CliLog text={log.join('\n')} /> } : {})}
          >
            {/* 没找到：「安装」；找到了运行不了：「修复」（照它的装法重装一遍）。正在装时灰着转圈 */}
            {!e.path &&
              (ins && !ins.failed ? (
                <button type="button" className="sa-btn aipk-cli-btn aipk-cli-busy" aria-busy="true" data-testid={`cli-busy-${e.id}`}>
                  <Codicon name="loading" size={14} className="spin" />
                  {ins.mode === 'repair' ? t('修复中') : t('安装中')}
                </button>
              ) : e.broken ? (
                <button type="button" className="sa-btn aipk-cli-btn" data-testid={`cli-repair-${e.id}`} onClick={() => void install(e, 'repair')}>
                  {t('修复', { ctx: '按钮' })}
                </button>
              ) : (
                <button type="button" className="sa-btn aipk-cli-btn" data-testid={`cli-install-${e.id}`} onClick={() => void install(e, 'install')}>
                  {t('安装', { ctx: '按钮' })}
                </button>
              ))}
            {canUpdate &&
              (running ? (
                <button type="button" className="sa-btn aipk-cli-btn" disabled>
                  <Codicon name="loading" size={14} className="spin" />
                  {t('正在更新…')}
                </button>
              ) : e.latest ? (
                <button type="button" className={'sa-btn aipk-cli-btn' + (e.id === urgent ? ' primary' : '')} aria-label={t('更新到 {v}', { v: e.latest })} data-tip={t('会运行 {cmd}', { cmd: (e.updateWith as { text: string }).text })} onClick={() => void update(e)}>
                  {e.id === urgent ? t('更新到 {v}', { v: e.latest }) : t('更新', { ctx: '按钮' })}
                </button>
              ) : (
                <button type="button" className="sa-btn aipk-cli-btn" disabled={busy.has(e.id)} onClick={() => void check(e)}>
                  {busy.has(e.id) ? t('正在查…') : t('检查更新')}
                </button>
              ))}
          </Row>
        )
      })}
    </Group>
  )
}
