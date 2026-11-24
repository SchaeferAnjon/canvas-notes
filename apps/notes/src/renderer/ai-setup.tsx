/**
 * 一个 AI 都没接上时的三选一卡（task-587os 收口第 2 条，设计页 64-没装ClaudeCode时的AI 第 3 节，原型 proto.html）：
 * 放在 AI 栏空对话里（问候下面），不弹窗、不挡别的操作。三条路各两三步：
 * - 填一个 API Key（推荐，放第一）：选一家 → 粘 Key（先验，认了才存进钥匙串）→ 接上了；
 * - 用这台 Mac 上的模型：找 Ollama、LM Studio → 选一个模型 → 接上了；没找到说清要做什么；
 * - 装 Claude Code：跑官方安装命令（命令原样摆出来）→ 浏览器里登录 → 接上了。
 * 走完在同一张卡里用一句话说清全能模式和梦游（能做什么、花多少、在哪关），不要求点同意（用户定：全能模式和梦游默认开、不拦着）。
 * 画布今日的设置 › AI 也用这一张（home="today"）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import type { EngineId } from '../shared/agent'
import { ANTHROPIC_MODELS, type ModelOption, pickLabel } from '../shared/ai-features'
import { API_DEFAULT, type ApiId, KEY_SHAPE, type LocalId, preferModel, PROVIDER_NAME, sizeText, SOURCE_LABEL } from '../shared/ai-sources'
import { normalizeDream } from '../shared/dream-settings'
import { EngineLogo } from './engine-logo'
import { useT } from './i18n'
import './ai-setup.css'

type Step =
  | { s: 'pick' }
  | { s: 'provider'; id: ApiId }
  | { s: 'key'; id: ApiId; busy?: boolean; error?: string }
  | { s: 'local'; found: LocalRow[] | null; pick?: string }
  | { s: 'cc'; lines: string[]; state: 'idle' | 'installing' | 'installed' | 'login' | 'failed'; error?: string }
  | { s: 'done'; engine: EngineId; model: string; effort?: string; models: ModelOption[] }

type LocalRow = { id: LocalId; on: boolean; models: { id: string; size?: number }[] }

/** 每家选它时右边那一句（原型「选一家」那一列） */
const providerNote = (id: ApiId, t: ReturnType<typeof useT>) => ({ anthropic: t('Claude，梦游最准'), deepseek: t('便宜，中文好'), openai: t('GPT系列'), openrouter: t('一个Key用多家模型') })[id]
/** 列的顺序照原型：Anthropic、DeepSeek、OpenAI、OpenRouter */
const PROVIDER_ORDER: ApiId[] = ['anthropic', 'deepseek', 'openai', 'openrouter']

/** Haiku 5.5 · Low 判一篇约 0.0021 美元（设计页 42-梦游模型对比实测）：一晚 50 篇约 0.1，第一遍按库里的篇数现算 */
const PER_NOTE = 0.0021
const money = (usd: number) => (usd >= 10 ? `$${Math.round(usd)}` : usd >= 1 ? `$${usd.toFixed(1).replace(/\.0$/, '')}` : `$${Math.max(0.01, usd).toFixed(2).replace(/0$/, '')}`)

/** 步骤条：三格，走到第几步亮几格 */
function Steps(p: { at: 1 | 2 | 3 }) {
  return (
    <div className="aiset-steps" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= p.at ? 'on' : ''} />
      ))}
    </div>
  )
}

export function SetupCard(props: {
  /** 「开始用」：回到空对话，之前被这张卡挡住的那一问接着发 */
  onDone(): void
  /** 「去设置看看」 */
  onSettings(): void
  /** 画布今日的设置页里用：画布今日自己存选择 */
  home?: 'notes' | 'today'
}) {
  const t = useT()
  const [step, setStep] = useState<Step>({ s: 'pick' })
  const [key, setKey] = useState('')
  const [notes, setNotes] = useState<number | null>(null)
  const [idle, setIdle] = useState(15)

  // 完成卡上梦游那一句要的：库里几篇（第一遍补全库花多少）、闲多久开始梦游
  useEffect(() => {
    if (step.s !== 'done' || props.home === 'today') return
    void window.cn.listNotes().then((l) => setNotes(l.length))
    void window.cn.settings().then((s) => setIdle(normalizeDream((s as { dream?: unknown }).dream).idleMinutes))
  }, [step.s, props.home])

  // 装 Claude Code：安装命令的输出一行行来
  useEffect(() => {
    if (step.s !== 'cc') return
    return window.cn.onAiCcLine((line) => setStep((x) => (x.s === 'cc' ? { ...x, lines: [...x.lines, line].slice(-12) } : x)))
  }, [step.s])

  async function findLocal() {
    setStep({ s: 'local', found: null })
    const rows = await window.cn.aiLocal(true)
    const first = rows.find((r) => r.on && r.models.length)
    setStep({ s: 'local', found: rows, ...(first ? { pick: first.models[0]!.id } : {}) })
  }

  async function verify(id: ApiId) {
    setStep({ s: 'key', id, busy: true })
    const r = await window.cn.aiKeySet(id, key)
    if (!r.ok) return setStep({ s: 'key', id, error: r.error })
    setKey('')
    const model = preferModel(
      r.models.map((m) => m.id),
      API_DEFAULT[id].chat,
    )
    // 新装默认 Sonnet 5.5 · Medium（设计页：不用 Opus）
    const effort = id === 'anthropic' ? 'medium' : undefined
    await connect({ engine: id, model, ...(effort ? { effort } : {}) }, r.models)
  }

  async function connect(p: { engine: EngineId; model: string; effort?: string }, models: ModelOption[]) {
    if (props.home !== 'today') await window.cn.aiConnect(p)
    setStep({ s: 'done', engine: p.engine, model: p.model, ...(p.effort ? { effort: p.effort } : {}), models })
  }

  async function install() {
    setStep({ s: 'cc', lines: [], state: 'installing' })
    const r = await window.cn.aiCcInstall()
    setStep((x) => (x.s === 'cc' ? (r.ok ? { ...x, state: 'installed' } : { ...x, state: 'failed', error: r.error }) : x))
  }

  async function login() {
    setStep((x) => (x.s === 'cc' ? { ...x, state: 'login' } : x))
    const r = await window.cn.aiCcLogin()
    if (!r.ok) return setStep((x) => (x.s === 'cc' ? { ...x, state: 'installed', error: r.error ?? t('还没登好：在浏览器里登完再点一次「登录」') } : x))
    // 订阅用户梦游照旧 Sonnet · Medium；AI 对话用 Claude Code 的默认模型
    await connect({ engine: 'claude', model: 'claude-opus-5-5' }, [])
  }

  const back = (
    <button className="aiset-back" onClick={() => setStep({ s: 'pick' })}>
      <Codicon name="chevron-left" size={12} />
      {t('换一种')}
    </button>
  )

  let body: React.ReactNode
  if (step.s === 'pick') {
    body = (
      <>
        <h3>{t('先接上一个AI')}</h3>
        <p className="aiset-lead">{t('这台Mac上没找到Claude Code、Codex、Gemini或OpenCode。选一种接上，以后在 设置 › AI随时换。')}</p>
        <button className="aiset-opt" data-testid="setup-key" onClick={() => setStep({ s: 'provider', id: 'anthropic' })}>
          <Codicon name="key" size={16} className="ic" />
          <span className="tx">
            <span className="aiset-tt">
              {t('填一个API Key')}
              <span className="aiset-tag">{t('推荐')}</span>
            </span>
            <span className="aiset-dd">{t('Anthropic、OpenAI、DeepSeek、OpenRouter都行，按用量付费，两分钟能用')}</span>
          </span>
        </button>
        <button className="aiset-opt" data-testid="setup-local" onClick={() => void findLocal()}>
          <Codicon name="chip" size={16} className="ic" />
          <span className="tx">
            <span className="aiset-tt">{t('用这台Mac上的模型')}</span>
            <span className="aiset-dd">{t('Ollama或LM Studio：免费、笔记不出这台电脑；慢一些，也不如云端准')}</span>
          </span>
        </button>
        <button className="aiset-opt" data-testid="setup-cc" onClick={() => setStep({ s: 'cc', lines: [], state: 'idle' })}>
          <EngineLogo id="claude" size={16} className="ic" />
          <span className="tx">
            <span className="aiset-tt">{t('装Claude Code')}</span>
            <span className="aiset-dd">{t('有Claude订阅选这个：在这里装，在浏览器里登录')}</span>
          </span>
        </button>
        <p className="aiset-foot">
          {t('装了Codex、Gemini或OpenCode？')}
          <button className="aiset-link" onClick={() => void window.cn.aiEngines(true)}>
            {t('再找一遍')}
          </button>
        </p>
      </>
    )
  } else if (step.s === 'provider') {
    body = (
      <>
        {back}
        <Steps at={1} />
        <h3>{t('选一家')}</h3>
        <div role="radiogroup" aria-label={t('选一家')}>
          {PROVIDER_ORDER.map((id) => (
            <button key={id} role="radio" aria-checked={step.id === id} className={'aiset-radio' + (step.id === id ? ' on' : '')} onClick={() => setStep({ s: 'provider', id })}>
              <span className="aiset-dot" />
              <EngineLogo id={id} size={16} />
              <span className="n">{PROVIDER_NAME[id]}</span>
              <span className="s">{providerNote(id, t)}</span>
            </button>
          ))}
        </div>
        <div className="aiset-btns">
          <button className="btn btn-primary btn-sm" data-testid="setup-next" onClick={() => setStep({ s: 'key', id: step.id })}>
            {t('下一步')}
          </button>
        </div>
      </>
    )
  } else if (step.s === 'key') {
    const name = PROVIDER_NAME[step.id]
    body = (
      <>
        <button className="aiset-back" onClick={() => setStep({ s: 'provider', id: step.id })}>
          <Codicon name="chevron-left" size={12} />
          {t('换一家')}
        </button>
        <Steps at={2} />
        <h3 className="aiset-name">
          <EngineLogo id={step.id} size={16} />
          {SOURCE_LABEL[step.id]}
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim() && !step.busy) void verify(step.id)
          }}
        >
          <label className="aiset-field">
            <input type="password" autoFocus value={key} placeholder={KEY_SHAPE[step.id]} aria-label={t('{name}的API Key', { name })} data-testid="setup-key-input" onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          <button type="button" className="aiset-link" onClick={() => void window.cn.aiOpenPage(step.id)}>
            {t('去{name}拿Key', { name })}
            <Codicon name="link-external" size={12} />
          </button>
          <p className="aiset-note">{t('存在这台Mac的钥匙串里，不进库、不进Git、不发给我们。')}</p>
          {step.error && (
            <p className="aiset-bad" role="alert" data-testid="setup-key-error">
              <Codicon name="error" size={14} className="bic" />
              {step.error.split('\n')[0]}
            </p>
          )}
          <div className="aiset-btns">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!key.trim() || step.busy} data-testid="setup-verify">
              {step.busy ? t('在验证…') : t('验证并用它')}
            </button>
          </div>
        </form>
      </>
    )
  } else if (step.s === 'local') {
    const on = step.found?.filter((r) => r.on && r.models.length) ?? []
    body = (
      <>
        {back}
        {step.found === null ? (
          <p className="aiset-note" data-testid="setup-local-finding">
            <span className="aiset-spin" />
            {t('在找Ollama和LM Studio…')}
          </p>
        ) : on.length ? (
          <>
            <Steps at={2} />
            {step.found.map((r) => (
              <p key={r.id} className={r.on && r.models.length ? 'aiset-ok' : 'aiset-note'}>
                {r.on && r.models.length ? <Codicon name="check" size={14} className="okic" /> : null}
                {r.on && r.models.length ? t('{name}开着，有{n}个模型', { name: SOURCE_LABEL[r.id], n: r.models.length }) : r.on ? t('{name}开着，里面还没有模型', { name: SOURCE_LABEL[r.id] }) : t('{name}没开', { name: SOURCE_LABEL[r.id] })}
              </p>
            ))}
            <div role="radiogroup" aria-label={t('选一个模型')}>
              {on.flatMap((r) =>
                r.models.map((m) => (
                  <button key={`${r.id}/${m.id}`} role="radio" aria-checked={step.pick === m.id} className={'aiset-radio' + (step.pick === m.id ? ' on' : '')} onClick={() => setStep({ ...step, pick: m.id })}>
                    <span className="aiset-dot" />
                    <span className="n">{m.id}</span>
                    <span className="s">{sizeText(m.size)}</span>
                  </button>
                )),
              )}
            </div>
            <div className="aiset-btns">
              <button
                className="btn btn-primary btn-sm"
                disabled={!step.pick}
                data-testid="setup-local-use"
                onClick={() => {
                  const row = on.find((r) => r.models.some((m) => m.id === step.pick))!
                  void connect({ engine: row.id, model: step.pick! }, row.models.map((m) => ({ id: m.id, label: m.id, efforts: [] })))
                }}
              >
                {t('用这个模型')}
              </button>
            </div>
          </>
        ) : (
          <>
            <Steps at={1} />
            <h3>{t('没找到Ollama或LM Studio')}</h3>
            <p className="aiset-lead" data-testid="setup-local-none">
              {t('装一个，开着它，再点「再找一遍」。模型5到10 GB，下载一次。')}
            </p>
            <div className="aiset-btns">
              <button className="btn btn-sm" onClick={() => void window.cn.aiOpenPage('ollama')}>
                {t('装Ollama')}
                <Codicon name="link-external" size={12} />
              </button>
              <button className="btn btn-sm" onClick={() => void window.cn.aiOpenPage('lmstudio')}>
                {t('装LM Studio')}
                <Codicon name="link-external" size={12} />
              </button>
              <button className="btn btn-primary btn-sm" data-testid="setup-local-again" onClick={() => void findLocal()}>
                {t('再找一遍')}
              </button>
            </div>
          </>
        )}
      </>
    )
  } else if (step.s === 'cc') {
    body = (
      <>
        {back}
        <Steps at={step.state === 'idle' || step.state === 'installing' || step.state === 'failed' ? 1 : 2} />
        <h3 className="aiset-name">
          <EngineLogo id="claude" size={16} />
          {t('装Claude Code')}
        </h3>
        <p className="aiset-lead">{t('要Claude订阅（Pro起）或Anthropic账号。会跑官方的安装命令：')}</p>
        <pre className="aiset-code">{'curl -fsSL https://claude.ai/install.sh | bash'}</pre>
        {step.lines.length > 0 && (
          <pre className="aiset-log" data-testid="setup-cc-log">
            {step.lines.join('\n')}
          </pre>
        )}
        {(step.state === 'installed' || step.state === 'login') && (
          <>
            <p className="aiset-note">{t('装在 ~/.local/bin/claude，不用Node；以后它自己更新。')}</p>
            <p className="aiset-note">{t('登录：会打开浏览器，在Anthropic自己的页面登录。')}</p>
          </>
        )}
        {step.error && (
          <p className="aiset-bad" role="alert">
            <Codicon name="error" size={14} className="bic" />
            {step.error}
          </p>
        )}
        <div className="aiset-btns">
          {step.state === 'idle' || step.state === 'failed' ? (
            <button className="btn btn-primary btn-sm" data-testid="setup-cc-install" onClick={() => void install()}>
              {step.state === 'failed' ? t('再装一次') : t('装')}
            </button>
          ) : step.state === 'installing' ? (
            <span className="aiset-note">
              <span className="aiset-spin" />
              {t('在装…')}
            </span>
          ) : (
            <button className="btn btn-primary btn-sm" data-testid="setup-cc-login" disabled={step.state === 'login'} onClick={() => void login()}>
              {step.state === 'login' ? t('等浏览器里登好…') : t('登录')}
            </button>
          )}
        </div>
      </>
    )
  } else {
    body = <DoneCard step={step} notes={notes} idle={idle} home={props.home ?? 'notes'} onDone={props.onDone} onSettings={props.onSettings} />
  }
  return (
    <div className="aiset" data-testid="ai-setup" data-step={step.s}>
      {body}
    </div>
  )
}

/** 接上了：一家 · 模型；全能模式、梦游各一句（能做什么、花多少、在哪关），不要求点同意 */
function DoneCard(p: { step: Extract<Step, { s: 'done' }>; notes: number | null; idle: number; home: 'notes' | 'today'; onDone(): void; onSettings(): void }) {
  const t = useT()
  const { engine, model, effort, models } = p.step
  const local = engine === 'ollama' || engine === 'lmstudio'
  const label = useMemo(() => pickLabel({ engine, model }, engine === 'anthropic' && !models.length ? ANTHROPIC_MODELS : models), [engine, model, models])
  const dream = (() => {
    if (engine === 'anthropic') {
      const first = p.notes === null ? '' : t('，第一次补全库约{cost}', { cost: money(p.notes * PER_NOTE) })
      return t('闲{idle}分钟后整理收件箱和剪藏、补双链，用Haiku 5.5，按用量算在你的Key上：一晚50篇约{night}{first}。设置 › 梦游里关。', { idle: p.idle, night: money(50 * PER_NOTE), first })
    }
    if (engine === 'claude') return t('闲{idle}分钟后整理收件箱和剪藏、补双链，用Sonnet 5.5，占你的订阅额度。设置 › 梦游里关。', { idle: p.idle })
    return t('闲{idle}分钟后整理收件箱和剪藏，用{name}，按用量算在你的Key上；补双链要Claude（Claude Code或Claude API）。设置 › 梦游里关。', { idle: p.idle, name: SOURCE_LABEL[engine as ApiId] ?? engine })
  })()
  return (
    <>
      <Steps at={3} />
      <p className="aiset-ok aiset-done" data-testid="setup-done">
        <Codicon name="check" size={14} className="okic" />
        <b>{t('接上了：')}</b>
        <EngineLogo id={engine} size={16} />
        <span>{label}</span>
      </p>
      <p className="aiset-lead">{p.home === 'today' ? t('画布今日的拆步、排时间、认时间用它。') : t('以后默认用它；每个功能用哪个在设置 › AI改。')}</p>
      {p.home === 'notes' &&
        (local ? (
          <>
            <p className="aiset-info">
              <Codicon name="info" size={14} className="iic" />
              <span>{t('本机模型只聊天、做小活，不动手改笔记（9B到12B的模型调工具不稳）。')}</span>
            </p>
            <p className="aiset-info">
              <Codicon name="info" size={14} className="iic" />
              <Head text={t('梦游不用本机模型：本机模型判双链准确率50%到64%（云端约97%）。要梦游，再接一把API Key或装Claude Code。')} />
            </p>
            <p className="aiset-info">
              <Codicon name="info" size={14} className="iic" />
              <span>{t('一问大约10到80秒，这段时间风扇会转。')}</span>
            </p>
          </>
        ) : (
          <>
            <p className="aiset-info" data-testid="setup-omni">
              <Codicon name="workspace-trusted" size={14} className="iic" />
              <Head text={t('全能模式开着：AI能读写这台Mac上的文件、跑命令、上网，不再一步步问你。AI栏底下那颗开关随时关。')} />
            </p>
            <p className="aiset-info" data-testid="setup-dream">
              <Codicon name="wand" size={14} className="iic" />
              <Head text={t('梦游开着：{what}', { what: dream })} />
            </p>
          </>
        ))}
      <div className="aiset-btns">
        <button
          className="btn btn-primary btn-sm"
          data-testid="setup-start"
          onClick={() => {
            if (p.home === 'notes') {
              void window.cn.aiIntroSeen('ai')
              if (!local) void window.cn.aiIntroSeen('dream')
            }
            p.onDone()
          }}
        >
          {t('开始用')}
        </button>
        <button className="btn btn-sm" onClick={p.onSettings}>
          {t('去设置看看')}
        </button>
      </div>
    </>
  )
}

/** 一句话，第一个冒号前那截加粗（「全能模式开着：…」「Full access is on: …」）：整句是一个模板，不拼句子 */
function Head({ text }: { text: string }) {
  const m = /^(.+?)([：:]\s?)([\s\S]*)$/.exec(text)
  if (!m) return <span>{text}</span>
  return (
    <span>
      <b>{m[1]}</b>
      {m[2]}
      {m[3]}
    </span>
  )
}

/** 第一次开 AI（命令行用户没走上手卡）：一句话说明全能模式，不拦着；点「知道了」不再出 */
export function AiIntro(p: { onSeen(): void }) {
  const t = useT()
  return (
    <div className="aiset-intro" data-testid="ai-intro">
      <Codicon name="workspace-trusted" size={14} className="iic" />
      <Head text={t('全能模式开着：AI能读写这台Mac上的文件、跑命令、上网，不再一步步问你。输入框底下那颗开关随时关。')} />
      <button className="aiset-link" onClick={p.onSeen}>
        {t('知道了')}
      </button>
    </div>
  )
}
