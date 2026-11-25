/**
 * 设置 › AI「iPhone 和 iPad」（task-wwqf0）：一颗开关「让iPhone / iPad用这台Mac的AI」（默认关）；开着时下面一个二维码
 * （一次性配对码，十分钟作废、用一次作废），配好的设备一台一行（最后一次来问的时间、这台能不能用全能模式、取消配对）。
 * 手机全能模式（2026-11-24）：AI 对话这一问能按全能模式答（和右栏 AI 一样动手），每台设备一颗「全能模式」开关，下面一句风险说明。
 * 主进程在 main/mobile-ai/，桥是 window.cnMobileAi（preload/mobile-ai.ts）。
 */
import { useEffect, useState } from 'react'
import type { MobileAiState } from '../../shared/mobile-ai'
import { Toggle } from '../Settings'
import { Group, Row, useSaid } from '../settings/ui'
import './mobile-ai.css'
import { ipcOn } from '../crash/ipc'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 「刚刚」「12 分钟前」「11-22 20:15」 */
function ago(t: number, now: number): string {
  const m = Math.floor((now - t) / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 手机全能模式的风险说明（设置里一句话） */
export const RISK = '风险：开着全能模式时，拿着这台配好设备的人能让这台Mac的AI读写文件、跑命令、上网，只有删除、推送、发消息、提交表单、上传、付款、登录和改库外东西的命令要先在那台设备上点头（两分钟没回当不要）。'

export function MobileAiGroup(props: { onNotice(t: string): void }) {
  const said = useSaid()
  const [s, setS] = useState<MobileAiState | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    void window.cnMobileAi.state().then(setS, (e) => props.onNotice(errText(e)))
    return ipcOn(window.cnMobileAi.onChanged, 'cnMobileAi.onChanged')(setS)
  }, [])
  // 配对码还剩几分钟、设备「刚刚用过」：每 15 秒重算一次
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  if (!s) return null
  const run = (p: Promise<MobileAiState>, after?: (s: MobileAiState) => void) =>
    p.then(
      (n) => {
        setS(n)
        setNow(Date.now())
        after?.(n)
      },
      (e) => props.onNotice(errText(e)),
    )
  const expired = !!s.pair && s.pair.expires <= now
  const left = s.pair ? Math.max(1, Math.ceil((s.pair.expires - now) / 60_000)) : 0

  return (
    <Group title="iPhone 和 iPad">
      <Row
        id="mobileAi"
        more={
          s.on ? (
            <div className="mai-pair" data-testid="mobile-ai-pair">
              {s.error ? (
                <p className="mai-err">{s.error}</p>
              ) : s.pair ? (
                <>
                  <div className={'mai-qr' + (expired ? ' off' : '')} role="img" aria-label="配对二维码" data-link={expired ? undefined : s.pair.link}>
                    <svg viewBox={`0 0 ${s.pair.qr.side} ${s.pair.qr.side}`} shapeRendering="crispEdges" aria-hidden="true">
                      <rect width={s.pair.qr.side} height={s.pair.qr.side} fill="#fff" />
                      <path d={s.pair.qr.d} fill="#000" />
                    </svg>
                  </div>
                  <div className="mai-txt">
                    <b>用iPhone或iPad扫一下</b>
                    <p>在那边的画布笔记里：设置 › AI › 扫码配对。配好以后在同一个Wi‑Fi里问AI，先找这台Mac「{s.macName}」，用AI对话那一行选的那家答；两秒没回话就换云端。这台Mac答时，AI对话开着全能模式（手机上不切就跟这里的全能模式开关）和右栏AI一样能动手，关着只读这里的笔记库；全能模式要AI对话用Claude Code，选的是Codex时读不了库。</p>
                    <p className="mai-exp" data-testid="mobile-ai-expiry">{expired ? '这个码过期了，换一个再扫' : `这个码${left}分钟内有效，用一次就作废`}</p>
                    <div className="mai-acts">
                      <button type="button" className="sa-btn" onClick={() => void run(window.cnMobileAi.newCode())}>
                        换一个码
                      </button>
                      <button
                        type="button"
                        className="sa-btn"
                        disabled={expired}
                        title="拷贝以后在iPhone或iPad上粘贴（同一个Apple账号能用通用剪贴板）"
                        onClick={() => void navigator.clipboard.writeText(s.pair!.link).then(() => said.say('拷贝好了：在iPhone或iPad的「扫码配对」里粘贴'))}
                      >
                        拷贝配对链接
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mai-txt">
                  <p>{s.devices.length ? '配好的设备随时能问。要再配一台，点「配一台新的」。' : '还没配对设备。'}</p>
                  <div className="mai-acts">
                    <button type="button" className="sa-btn" onClick={() => void run(window.cnMobileAi.newCode())}>
                      配一台新的
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null
        }
      >
        <Toggle
          on={s.on}
          label="让iPhone / iPad用这台Mac的AI"
          onChange={(on) =>
            void run(window.cnMobileAi.set(on), () =>
              said.saved(on ? '开了：iPhone、iPad扫码配对一次就能用这台Mac的AI' : '关了：iPhone、iPad问AI直接走云端', () => void run(window.cnMobileAi.set(!on))),
            )
          }
        />
      </Row>
      {s.devices.map((d) => (
        <Row key={d.id} id={`mobileAiDev-${d.id}`} label={d.name === d.kind ? d.kind : `${d.kind}「${d.name}」`} desc={`配对于${ago(d.pairedAt, now)}${d.lastSeen ? ` · ${ago(d.lastSeen, now)}问过` : ' · 还没问过'}`}>
          <span className="mai-full" data-testid="mobile-ai-full">
            <span className="mai-full-lb">全能模式</span>
            <Toggle
              on={d.full}
              label={`${d.kind}「${d.name}」能用全能模式`}
              onChange={(on) =>
                void run(window.cnMobileAi.setFull(d.id, on), () =>
                  said.saved(on ? `${d.kind}「${d.name}」能用全能模式了` : `${d.kind}「${d.name}」的全能模式关了：这台再问只读`, () => void run(window.cnMobileAi.setFull(d.id, !on))),
                )
              }
            />
          </span>
          <button
            type="button"
            className="sa-btn"
            onClick={() => void run(window.cnMobileAi.unpair(d.id), () => said.say(`取消配对了：${d.kind}「${d.name}」要再用得重新扫码`))}
          >
            取消配对
          </button>
        </Row>
      ))}
      {s.devices.length > 0 && (
        <p className="mai-risk" data-testid="mobile-ai-risk">
          {RISK}
        </p>
      )}
    </Group>
  )
}
