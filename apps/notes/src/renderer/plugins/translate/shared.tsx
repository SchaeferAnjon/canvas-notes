/**
 * 双语翻译界面里菜单和设置页共用的：引擎标志、引擎状态（问主进程）、失败说明块、开关翻译、去设置时展开哪一行。
 */
import { Codicon } from '@cn/design'
import { type ReactNode, useEffect, useState } from 'react'
import {
  API_PAGES,
  engineMeta,
  type EngineStatus,
  errorTitle,
  HOW_INSTALL,
  HOW_LOGIN,
  normalizeTranslate,
  type TranslateSettings,
  type TrEngineId,
  type TrError,
  type TrPageState,
} from '../../../shared/plugins/translate'
import { errText, pageStateOf, pluginInfo, setPluginSettings, webHost } from '../host'
import type { WebPage } from '../types'
import { EngineLogo } from '../../engine-logo'

export const ID = 'translate'

export { EngineLogo }

export const settingsNow = (): TranslateSettings => normalizeTranslate(pluginInfo(ID)?.settings)

export interface EnginesInfo {
  list: EngineStatus[]
  current: TrEngineId | null
  label: string | null
  lastUsed: TrEngineId | null
  blocked: TrError | null
}

/** 引擎状态：打开时问一次（refresh 时重新看命令行和登录）；设置变了再问 */
export function useEngines(refresh: boolean, deps: unknown[] = []): [EnginesInfo | null, (i: EnginesInfo) => void, () => void] {
  const [info, setInfo] = useState<EnginesInfo | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    window.cnPlugins.call<EnginesInfo>(ID, 'engines', { refresh: refresh && tick === 0 }).then(
      (i) => live && setInfo(i),
      (e) => console.error('翻译引擎状态读不到', e),
    )
    return () => {
      live = false
    }
  }, [tick, ...deps])
  return [info, setInfo, () => setTick((n) => n + 1)]
}

/** 视频页上翻译按钮和 ⌥A 是开关字幕（renderer/video/keys.ts 交进来；不是视频页给 false） */
let videoPageToggle: ((wcId: number) => boolean) | null = null
export const setVideoPageToggle = (f: (wcId: number) => boolean) => (videoPageToggle = f)

/** 开 / 关当前网页的双语翻译 */
export function toggleTranslate(page: WebPage | null) {
  const h = webHost()
  if (!h) return
  if (page && videoPageToggle?.(page.wcId)) return h.show()
  if (!page?.url) {
    h.show()
    h.notice('先在右栏打开一个网页，再开双语翻译')
    return
  }
  h.show()
  h.command(page.wcId, ID, 'toggle')
}

/** 整页剪藏完的提示条：开关开着、这页有翻好的段时多半句「· 带了译文」 */
export function clipSuffix(page: WebPage | null): string {
  const st = page ? pageStateOf<TrPageState>(page.wcId, ID) : undefined
  return st?.on && st.done > 0 && settingsNow().clipWithTranslation && pluginInfo(ID)?.enabled ? ' · 带了译文' : ''
}

/** 去设置时要展开哪一行（「填 DeepSeek Key」「换 Key」「怎么装」）；设置页打开时读一次 */
export const focusRow: { id: TrEngineId | null; how?: boolean } = { id: null }

export function openTranslateSettings(row?: TrEngineId, how = false) {
  focusRow.id = row ?? null
  focusRow.how = how
  webHost()?.openSettings()
}

/** 「改用 Codex」：下一个真能用的（除了出错的那个）；没有就不给这颗按钮 */
export function nextUsable(list: EngineStatus[] | undefined, except?: TrEngineId): EngineStatus | null {
  return list?.find((e) => e.state === 'ok' && e.id !== except) ?? null
}

const nameOf = (id: TrEngineId) => engineMeta(id).name.replace(/ CLI$/, '')

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/**
 * 失败说明块：左边红色图标，右边「N 段没翻成：原因」、一句说明、一排按钮（按种类给，见 spec 3.1）。
 * 菜单里和设置页最上面（都不能用时）用同一个样子。
 */
export function FailBox(props: {
  error: TrError
  failed: number
  engines: EnginesInfo | null
  page: WebPage | null
  retryAt?: number
  onDone?(): void
  onNotice(t: string): void
}) {
  const { error: e, failed, engines } = props
  const [how, setHow] = useState(false)
  const now = useNow(!!props.retryAt)
  const s = settingsNow()
  const title = (failed ? `${failed}段没翻成：` : '') + errorTitle(e) + (props.retryAt && e.code === 'rate-limit' ? `，${Math.max(0, Math.ceil((props.retryAt - now) / 1000))}秒后再试` : '')
  const next = nextUsable(engines?.list, e.engine)
  const cli = e.engine && engineMeta(e.engine).kind === 'cli' ? (e.engine as keyof typeof HOW_LOGIN) : null
  const api = e.engine === 'deepseek' || e.engine === 'zhipu' ? e.engine : null

  const retryAll = () => {
    if (props.page) webHost()?.command(props.page.wcId, ID, 'retryAll')
  }
  const use = (id: TrEngineId) => {
    void setPluginSettings(ID, { engineMode: 'pick', pick: id }).then(retryAll, (err) => props.onNotice(errText(err)))
  }
  const useAuto = () => void setPluginSettings(ID, { engineMode: 'auto' }).then(retryAll, (err) => props.onNotice(errText(err)))
  const copy = (t: string, what: string) => void navigator.clipboard.writeText(t).then(() => props.onNotice(`${what}复制好了`))

  const why =
    e.code === 'none'
      ? `${e.raw.replace(/。?$/, '。')}装好一个命令行并登录，或者填一个API Key。`
      : s.engineMode === 'pick' && e.engine
        ? `设置里指定了只用${nameOf(e.engine)}。`
        : e.code === 'bad-output'
          ? '已经自动重问过一次。'
          : e.code === 'rate-limit'
            ? '不用点，到时候自动再翻。'
            : ''

  const btn = (label: string, run: () => void, cls = 'btn btn-sm') => (
    <button key={label} type="button" className={cls} onClick={run}>
      {label}
    </button>
  )
  const acts: ReactNode[] = []
  const retryBtn = (
    <button key="retry" type="button" className="btn btn-sm btn-ghost" onClick={retryAll}>
      <Codicon name="refresh" size={12} />
      全部重试
    </button>
  )
  const useNext = next ? btn(`改用${nameOf(next.id)}`, () => use(next.id)) : null
  switch (e.code) {
    case 'none':
      acts.push(btn('去设置', () => (props.onDone?.(), openTranslateSettings()), 'btn btn-sm btn-primary'))
      acts.push(
        <span key="fast" className="tr-fast">
          最快：填一个DeepSeek Key
        </span>,
      )
      break
    case 'not-installed':
      if (cli) acts.push(btn(how ? '收起' : '怎么装', () => setHow(!how)))
      acts.push(btn('改用自动', useAuto))
      break
    case 'not-logged-in':
      if (cli) acts.push(btn(how ? '收起' : '怎么登录', () => setHow(!how)))
      acts.push(useNext, retryBtn)
      break
    case 'bad-model':
      acts.push(useNext, btn('翻译设置…', () => (props.onDone?.(), openTranslateSettings())))
      break
    case 'bad-key':
    case 'no-key':
      acts.push(btn(e.code === 'no-key' ? '填Key' : '换Key', () => (props.onDone?.(), openTranslateSettings(e.engine))))
      break
    case 'no-balance':
      if (api) acts.push(btn('去充值 ↗', () => (props.onDone?.(), webHost()?.open(API_PAGES[api].billing, true))))
      acts.push(useNext)
      break
    case 'rate-limit':
      break
    case 'timeout':
      acts.push(retryBtn, useNext)
      break
    default:
      acts.push(retryBtn)
  }
  const helpText = cli && how ? (e.code === 'not-installed' ? HOW_INSTALL[cli] : HOW_LOGIN[cli]) : null

  return (
    <div className="tr-callout" role="alert" aria-label="没翻成的原因">
      <span className="ic">
        <Codicon name="error" size={16} />
      </span>
      <div className="tr-callout-body">
        <b>{title}</b>
        {why && <p>{why}</p>}
        <div className="acts">
          {acts.filter(Boolean)}
          {e.code !== 'none' && (
            <button type="button" className="tr-lnk" onClick={() => copy(e.raw, '原话')} title={e.raw}>
              复制原话
            </button>
          )}
        </div>
        {helpText && (
          <div className="how">
            {helpText.text}
            <code>{helpText.cmd}</code>
            <button type="button" className="tr-lnk" onClick={() => copy(helpText.cmd, '命令')}>
              <Codicon name="copy" size={11} />
              复制
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
