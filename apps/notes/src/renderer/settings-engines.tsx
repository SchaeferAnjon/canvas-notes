/**
 * 设置 › AI「各家命令行」（task-m55m7，用户 r20：「Claude Code 更新了…我们是否还兼容」）：一家一行，
 * 名字前面它的标志；说明那一行：版本 · 能不能用（自查出的问题照实写）· 拉到几个模型、什么时候拉的；
 * 右边「检查更新」（重读版本、重拉模型、看有没有新版本）/「更新到 x」（跑它官方的更新，跑完再自查）。不自己升级，点了才升。
 */
import { Codicon } from '@cn/design'
import { useState } from 'react'
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

export function EngineRows(props: { engines: EngineInfo[]; onNotice(t: string): void }) {
  const t = useT()
  const said = useSaid()
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
        const st = engineStatus(e)
        const running = e.update?.state === 'running'
        const canUpdate = !!e.path && !!e.updateWith && 'text' in e.updateWith
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
              <span title={e.health?.note ?? (e.path ? undefined : e.hint)}>
                {st.dot && <span className={'dot' + (st.dot === 'ok' ? '' : ` ${st.dot}`)} />}
                {withCode(st.text)}
              </span>
            }
          >
            {/* 没找到：「怎么装」说一句装法（task-587os 设计页第 4 节：没装的写「没找到」、按钮「怎么装」） */}
            {!e.path && e.hint && (
              <button type="button" className="sa-btn aipk-cli-btn" data-testid={`cli-how-${e.id}`} onClick={() => said.say(e.hint!)}>
                {t('怎么装')}
              </button>
            )}
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
