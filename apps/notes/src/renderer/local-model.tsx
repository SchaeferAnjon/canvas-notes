/**
 * 本地模型那一块（task-h7oy8）：设置 › 梦游「判断方式」里选「本地模型」时下面这张。
 * 头一行选哪个模型；两行灰字说它要什么（下载多大、占多少内存、存在哪）；状态行：没下 → 下载；下载中 → 进度 + 取消；校验中；好了。
 * 状态行四种样子一样高（左边 16 宽一列放点或转圈，右边一颗按钮），只换内容，卡片不跳。
 * 状态来自主进程（window.cn.llmStatus / onLlm），这里只画。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { LOCAL_MODELS, type LocalLlmStatus, localModel } from '../shared/local-models'
import { useT } from './i18n'
import './local-model.css'

/** 本地模型现在怎样（主进程推过来就换） */
export function useLocalLlm(): LocalLlmStatus | null {
  const [s, setS] = useState<LocalLlmStatus | null>(null)
  useEffect(() => {
    let live = true
    const off = window.cn.onLlm((v) => live && setS(v))
    void window.cn.llmStatus().then((v) => live && setS(v))
    return () => {
      live = false
      off()
    }
  }, [])
  return s
}

/** 字节写成 Finder 那样的十进制：2.5 GB、812 MB */
const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`
const mb = (n: number) => (n >= 1e9 ? gb(n) : `${Math.round(n / 1e6)} MB`)
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export function LocalModelCard() {
  const t = useT()
  const s = useLocalLlm()
  if (!s) return <div className="llm-card" data-testid="llm-card" />
  const m = localModel(s.model)!
  const ramGb = Math.round(s.ram / 2 ** 30)
  const lowRam = ramGb < m.minRamGb
  const pct = s.got != null && s.total ? Math.floor((s.got / s.total) * 100) : 0
  const moving = s.phase === 'downloading' || s.phase === 'verifying'

  /** 状态行：点（或转圈）、两行字、按钮 */
  let state: { dot: 'none' | 'part' | 'ok' | 'bad' | 'spin'; title: string; sub?: string; err?: boolean; bar?: boolean; act?: 'download' | 'cancel' }
  if (!s.appleSilicon) state = { dot: 'bad', title: t('这台Mac跑不了本地模型'), sub: t('要Apple芯片的Mac') }
  else if (s.phase === 'ready') state = { dot: 'ok', title: t('已下好 · {size}', { size: gb(m.size) }), sub: t('梦游判断时在这台Mac上跑，不花订阅额度') }
  else if (s.phase === 'loading') state = { dot: 'spin', title: t('正在载入模型'), sub: t('梦游判断时在这台Mac上跑，不花订阅额度') }
  else if (s.phase === 'downloading') state = { dot: 'spin', title: t('正在下载 · {got} / {total}', { got: mb(s.got ?? 0), total: gb(s.total ?? m.size) }), bar: true, act: 'cancel' }
  else if (s.phase === 'verifying') state = { dot: 'spin', title: t('正在校验 · 核对文件没下坏'), bar: true, act: 'cancel' }
  else if (s.phase === 'error') state = { dot: 'bad', title: t('本地模型用不了'), sub: s.error, err: true }
  else if (s.error) state = { dot: 'bad', title: s.got ? t('下了一部分 · {got} / {total}', { got: mb(s.got), total: gb(m.size) }) : t('没下成'), sub: s.error, err: true, act: 'download' }
  else if (s.got) state = { dot: 'part', title: t('下了一部分 · {got} / {total}', { got: mb(s.got), total: gb(m.size) }), sub: t('已下的留着，接着下不从头来'), act: 'download' }
  else state = { dot: 'none', title: t('还没下载'), sub: t('下好前，梦游判断走不了本地模型'), act: 'download' }

  return (
    <div className="llm-card" data-testid="llm-card" data-phase={s.phase}>
      <div className="llm-head">
        <Codicon name="circuit-board" size={16} className="ic" />
        <span className="tx">
          <b>{t('本地模型')}</b>
          <span>{t(m.note)}</span>
        </span>
        <select aria-label={t('用哪个本地模型')} data-testid="llm-model" value={s.model} disabled={moving || !s.appleSilicon} onChange={(e) => void window.cn.llmSetModel(e.target.value)}>
          {LOCAL_MODELS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {gb(o.size)}
            </option>
          ))}
        </select>
      </div>

      <div className="llm-needs" data-testid="llm-needs">
        <p className={lowRam ? 'warn' : ''}>
          {lowRam && <Codicon name="warning" size={14} />}
          {lowRam
            ? t('下载一次{size}，以后不联网 · 跑起来约占{need} GB内存，这台Mac只有{have} GB，会很慢', { size: gb(m.size), need: m.runGb, have: ramGb })
            : t('下载一次{size}，以后不联网 · 跑起来约占{need} GB内存（这台Mac {have} GB）', { size: gb(m.size), need: m.runGb, have: ramGb })}
        </p>
        <p>
          <span className="path" title={s.dir}>
            {t('存在{dir}', { dir: home(s.dir) })}
          </span>
          <button className="reveal" onClick={() => void window.cn.llmReveal()}>
            {t('在访达中显示')}
          </button>
        </p>
      </div>

      <div className="llm-state" data-testid="llm-state">
        <span className="st">{state.dot === 'spin' ? <Codicon name="loading" size={16} className="spin" /> : <i className={'dot ' + state.dot} />}</span>
        <span className="tx">
          <b>{state.title}</b>
          {state.bar ? (
            <span className="llm-prog">
              <span className="llm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className="num" data-testid="llm-progress">
                {`${pct}%` + (s.phase === 'downloading' && s.speed ? ` · ${mb(s.speed)}/s` : '')}
              </span>
            </span>
          ) : (
            state.sub && <span className={state.err ? 'err' : ''}>{state.sub}</span>
          )}
        </span>
        {state.act === 'cancel' && (
          <button className="btn btn-sm btn-ghost" data-testid="llm-cancel" onClick={() => void window.cn.llmCancel()}>
            <Codicon name="close" size={14} />
            {t('取消')}
          </button>
        )}
        {state.act === 'download' && (
          <button className="btn btn-sm btn-primary" data-testid="llm-download" onClick={() => void window.cn.llmDownload(s.model)}>
            <Codicon name="cloud-download" size={14} />
            {s.got ? t('继续下载') : t('下载{size}', { size: gb(m.size) })}
          </button>
        )}
      </div>
    </div>
  )
}
