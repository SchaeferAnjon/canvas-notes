/**
 * 设置 › 插件 › 双语翻译（spec 第 5 节）：翻译用什么（自动 / 指定一个、顺序、各家状态、API Key、测试连接、试一句），
 * 默认怎么翻（和网页里菜单是同一份），术语表，缓存。Key 只在主进程：这里只拿得到「有没有、最后 4 位」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import {
  API_PAGES,
  type EngineStatus,
  errorTitle,
  HOW_INSTALL,
  HOW_LOGIN,
  LANGS,
  normalizeTranslate,
  STATE_TEXT,
  STYLES,
  type TrEngineId,
  type TrError,
} from '../../../shared/plugins/translate'
import type { PluginInfo } from '../../../shared/plugins'
import { Toggle } from '../../Settings'
import { errText, webHost } from '../host'
import { EngineLogo, type EnginesInfo, focusRow, ID, useEngines } from './shared'

const STATE_COLOR: Record<EngineStatus['state'], string> = {
  ok: 'var(--green)',
  login: 'var(--yellow)',
  missing: 'var(--t3)',
  nokey: 'var(--t3)',
  badkey: 'var(--red)',
  nobalance: 'var(--red)',
  badmodel: 'var(--red)',
}

type TestResult = { run: true } | { ok: true; ms: number; text: string; who?: string } | { ok: false; ms: number; error: TrError }

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`

export function TranslateSettingsPane({ info, onChange, onNotice }: { info: PluginInfo; onChange(patch: Record<string, unknown>): void; onNotice(t: string): void }) {
  const s = normalizeTranslate(info.settings)
  const [engines, setEngines, reload] = useEngines(true, [s.engineMode, s.pick, s.engineOrder.join()])
  const [open, setOpen] = useState<{ id: TrEngineId; how?: boolean } | null>(focusRow.id ? { id: focusRow.id, how: focusRow.how } : null)
  const [cached, setCached] = useState<number | null>(null)
  const [tryRes, setTryRes] = useState<TestResult | null>(null)
  const [gl, setGl] = useState<{ course: string | null; path: string | null; exists: boolean; count: number } | null>(null)
  const [drag, setDrag] = useState<TrEngineId | null>(null)

  useEffect(() => {
    focusRow.id = null
    void window.cnPlugins.call<{ cached: number }>(ID, 'stats').then((r) => setCached(r.cached), () => undefined)
    void window.cnPlugins.call<typeof gl>(ID, 'glossary').then(setGl, () => undefined)
  }, [])

  const list = engines?.list ?? []
  const none = engines?.blocked?.code === 'none' ? engines.blocked : null
  const current = engines?.current ?? null

  function reorder(from: TrEngineId, to: TrEngineId) {
    if (from === to) return
    const order = s.engineOrder.filter((x) => x !== from)
    order.splice(order.indexOf(to) + (s.engineOrder.indexOf(from) < s.engineOrder.indexOf(to) ? 1 : 0), 0, from)
    onChange({ engineOrder: order })
  }

  return (
    <>
      <h4 className="trs-h">
        翻译用什么 <span>一批段落问一次；翻过的段记在本机，同一段不再问</span>
      </h4>
      {none && (
        <div className="trs-none">
          <NoneBox reason={none.raw} onKey={() => setOpen({ id: 'deepseek' })} onHow={() => setOpen({ id: 'claude', how: true })} />
        </div>
      )}
      <div className="trs-mode">
        <div className="seg" role="radiogroup" aria-label="怎么选翻译引擎">
          {(
            [
              ['auto', '自动'],
              ['pick', '指定一个'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={s.engineMode === id} className={s.engineMode === id ? 'on' : ''} onClick={() => onChange({ engineMode: id })}>
              {name}
            </button>
          ))}
        </div>
        <span className="note">{s.engineMode === 'auto' ? '从上往下用第一个能用的；一个出错就换下一个。拖动换顺序。' : '只用选中的这个；它出错时不换别的，直接告诉你。'}</span>
      </div>
      <div className="trs-list" role={s.engineMode === 'pick' ? 'radiogroup' : 'list'} aria-label="翻译用什么">
        {list.map((e, i) => (
          <EngineRow
            key={e.id}
            e={e}
            n={i + 1}
            mode={s.engineMode}
            picked={s.pick === e.id}
            current={current === e.id}
            open={open?.id === e.id ? open : null}
            dragging={drag === e.id}
            onPick={() => onChange({ pick: e.id })}
            onOpen={(how) => setOpen(open?.id === e.id ? null : { id: e.id, how })}
            onDragStart={() => setDrag(e.id)}
            onDrop={() => (drag && reorder(drag, e.id), setDrag(null))}
            onDragEnd={() => setDrag(null)}
            onStatuses={(l) => setEngines({ ...(engines as EnginesInfo), list: l })}
            reload={reload}
            onNotice={onNotice}
          />
        ))}
      </div>
      <div className="trs-try">
        <button
          type="button"
          className="btn btn-sm"
          disabled={tryRes !== null && 'run' in tryRes}
          onClick={async () => {
            setTryRes({ run: true })
            const r = await window.cnPlugins.call<{ ok: true; ms: number; text: string; label: string } | { ok: false; ms: number; error: TrError }>(ID, 'tryOne').catch(
              (e) => ({ ok: false as const, ms: 0, error: { code: 'other' as const, raw: errText(e) } }),
            )
            setTryRes(r.ok ? { ok: true, ms: r.ms, text: r.text, who: r.label } : r)
            reload()
          }}
        >
          <Codicon name="refresh" size={12} />
          试一句
        </button>
        <span className="note">用现在的设置翻「eigenvalue」，看谁答、多快</span>
      </div>
      {tryRes && <ResultLine r={tryRes} what={(t) => `${t.who} 答的 · ${secs(t.ms)} · eigenvalue → ${t.text}`} />}

      <h4 className="trs-h">
        默认怎么翻 <span>网页里随手改的也记在这里</span>
      </h4>
      <div className="pair">
        <span>翻成</span>
        <select aria-label="翻成" value={s.target} onChange={(e) => onChange({ target: e.target.value })}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="note plug-inline">网页本身就是这种语言时，中文翻成英文，别的翻成简体中文</span>
      </div>
      <div className="pair">
        <span>显示</span>
        <div className="seg" role="radiogroup" aria-label="译文怎么显示">
          {(
            [
              ['below', '对照'],
              ['only', '只看译文'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={s.display === id} className={s.display === id ? 'on' : ''} onClick={() => onChange({ display: id })}>
              {name}
            </button>
          ))}
        </div>
        <span className="sp" />
        <span>样式</span>
        <select aria-label="译文样式" value={s.style} disabled={s.display === 'only'} onChange={(e) => onChange({ style: e.target.value })}>
          {STYLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="pair">
        <span className="wide">整页剪藏带上译文</span>
        <span className="sp" />
        <Toggle on={s.clipWithTranslation} label="整页剪藏带上译文" onChange={(v) => onChange({ clipWithTranslation: v })} />
      </div>
      <p className="note trs-note">关着：只存原文。开着：每段原文下面跟一段译文（md 里是「&gt; 」引用），只看译文时也照样存原文。</p>

      <h4 className="trs-h">
        术语表 <span>课程文件夹里的 术语表.md</span>
      </h4>
      <div className="pair">
        <span className="wide">中间栏开着哪门课的文件，就照哪门课的术语表翻</span>
        <span className="sp" />
        {gl?.exists && gl.path ? (
          <button type="button" className="btn btn-sm" onClick={() => webHost()?.openNote(gl.path!)}>
            打开 {gl.path.replace(/^课程\//, '')}
          </button>
        ) : (
          <span className="note plug-inline">{gl?.course ? `${gl.course}还没有，网页里翻译菜单能让 AI 起个头` : '现在中间栏没开课程里的文件'}</span>
        )}
      </div>
      <p className="note trs-note">
        翻过的段记在本机{cached !== null && `（已记 ${cached} 段）`}
        {!!cached && (
          <button
            type="button"
            className="tr-lnk"
            onClick={async () => {
              try {
                await window.cnPlugins.call(ID, 'clearCache')
                setCached(0)
                onNotice('翻译缓存清空了')
              } catch (e) {
                onNotice(errText(e))
              }
            }}
          >
            <Codicon name="trash" size={11} />
            清空
          </button>
        )}
      </p>
    </>
  )
}

/** 都不能用时最上面那块（和网页菜单里的失败说明块一个样子） */
function NoneBox({ reason, onKey, onHow }: { reason: string; onKey(): void; onHow(): void }) {
  return (
    <div className="tr-callout" role="alert" aria-label="现在没有能翻的">
      <span className="ic">
        <Codicon name="error" size={16} />
      </span>
      <div className="tr-callout-body">
        <b>现在没有能翻的</b>
        <p>{reason.replace(/。?$/, '。')}最快：填一个 DeepSeek Key，1 分钟。</p>
        <div className="acts">
          <button type="button" className="btn btn-sm btn-primary" onClick={onKey}>
            填 DeepSeek Key
          </button>
          <button type="button" className="btn btn-sm" onClick={onHow}>
            怎么装 Claude Code
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultLine({ r, what }: { r: TestResult; what(t: { ms: number; text: string; who?: string }): string }) {
  if ('run' in r)
    return (
      <div className="trs-res">
        <Codicon name="loading" size={12} className="spin" />
        在试…
      </div>
    )
  return (
    <div className="trs-res" role="status">
      <i style={{ background: r.ok ? 'var(--green)' : 'var(--red)' }} />
      {r.ok ? what(r) : errorTitle(r.error)}
    </div>
  )
}

function EngineRow(props: {
  e: EngineStatus
  n: number
  mode: 'auto' | 'pick'
  picked: boolean
  current: boolean
  open: { id: TrEngineId; how?: boolean } | null
  dragging: boolean
  onPick(): void
  onOpen(how?: boolean): void
  onDragStart(): void
  onDrop(): void
  onDragEnd(): void
  onStatuses(l: EngineStatus[]): void
  reload(): void
  onNotice(t: string): void
}) {
  const { e, mode } = props
  const api = e.kind === 'api'
  const cli = e.kind === 'cli' ? (e.id as keyof typeof HOW_LOGIN) : null
  const link = cli && e.state === 'login' ? '怎么登录' : cli && e.state === 'missing' ? '怎么装' : api ? (e.keyTail ? '换 Key' : '填 Key') : null
  const dis = mode === 'pick' && e.state !== 'ok'
  return (
    <>
      <div
        className={'trs-row' + (props.current ? ' on' : '') + (props.dragging ? ' dragging' : '')}
        role={mode === 'pick' ? 'radio' : 'listitem'}
        aria-checked={mode === 'pick' ? props.picked : undefined}
        aria-label={e.name}
        data-dis={dis || undefined}
        onClick={mode === 'pick' ? props.onPick : undefined}
        onDragOver={mode === 'auto' ? (ev) => ev.preventDefault() : undefined}
        onDrop={mode === 'auto' ? (ev) => (ev.preventDefault(), props.onDrop()) : undefined}
      >
        {mode === 'auto' ? (
          <>
            <span
              className="gp"
              draggable
              aria-label={`拖动 ${e.name} 换顺序`}
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', e.id)
                props.onDragStart()
              }}
              onDragEnd={props.onDragEnd}
            >
              <Codicon name="gripper" size={14} />
            </span>
            <span className="n num">{props.n}</span>
          </>
        ) : (
          <span className={'rd' + (props.picked ? ' on' : '')} />
        )}
        <span className="lg">
          <EngineLogo id={e.id} />
        </span>
        <span className="nmw">
          <b>{e.name}</b>
          {e.sub && <span className="sub">{e.sub}</span>}
        </span>
        <span className="sp" />
        {props.current && <span className="trs-tag">正在用</span>}
        <span className="stt">
          <i style={{ background: STATE_COLOR[e.state] }} />
          {STATE_TEXT[e.state]}
          {e.keyTail && <span className="mono"> · ••••{e.keyTail}</span>}
        </span>
        {link && (
          <button
            type="button"
            className="tr-lnk"
            onClick={(ev) => {
              ev.stopPropagation()
              props.onOpen(!api)
            }}
          >
            {link}
          </button>
        )}
      </div>
      {props.open && (api ? <KeyBox e={e} onStatuses={props.onStatuses} reload={props.reload} onNotice={props.onNotice} /> : cli && <HowBox cli={cli} install={e.state === 'missing'} onNotice={props.onNotice} />)}
    </>
  )
}

function HowBox({ cli, install, onNotice }: { cli: keyof typeof HOW_LOGIN; install: boolean; onNotice(t: string): void }) {
  const h = install ? HOW_INSTALL[cli] : HOW_LOGIN[cli]
  return (
    <div className="trs-box">
      <p className="note">{h.text}</p>
      <div className="trs-kin">
        <code className="inp">{h.cmd}</code>
        <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(h.cmd).then(() => onNotice('命令复制好了'))}>
          <Codicon name="copy" size={12} />
          复制
        </button>
      </div>
    </div>
  )
}

/** API 那一行展开：没 Key 时输入框 + 存好；有 Key 时只读显示最后 4 位 + 删掉；测试连接 */
function KeyBox({ e, onStatuses, reload, onNotice }: { e: EngineStatus; onStatuses(l: EngineStatus[]): void; reload(): void; onNotice(t: string): void }) {
  const [draft, setDraft] = useState('')
  const [test, setTest] = useState<TestResult | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = e.id as 'deepseek' | 'zhipu'
  const has = !!e.keyTail
  useEffect(() => {
    if (!has) input.current?.focus()
  }, [has])

  async function save() {
    try {
      onStatuses(await window.cnPlugins.call<EngineStatus[]>(ID, 'setKey', e.id, draft))
      setDraft('')
      setTest(null)
      reload()
      // 网页那边一开就不能用的：现在有能用的了，再查一次
      const h = webHost()
      const pg = h?.page()
      if (h && pg) h.command(pg.wcId, ID, 'retryIfBlocked')
    } catch (err) {
      onNotice(errText(err))
    }
  }

  async function runTest() {
    setTest({ run: true })
    const r = await window.cnPlugins.call<{ ok: true; ms: number; text: string } | { ok: false; ms: number; error: TrError }>(ID, 'testKey', e.id).catch((err) => ({
      ok: false as const,
      ms: 0,
      error: { code: 'other' as const, raw: errText(err) },
    }))
    setTest(r.ok ? { ok: true, ms: r.ms, text: r.text } : r)
    reload()
  }

  const failText = (err: TrError) =>
    err.code === 'bad-key'
      ? `Key 不对（${/\b(401|403)\b/.exec(err.raw)?.[1] ?? 401}），去 ${e.name} 看看是不是复制少了`
      : err.code === 'no-balance'
        ? `余额不够（${/\b402\b/.test(err.raw) ? 402 : /1113/.test(err.raw) ? 1113 : 402}）`
        : err.code === 'timeout'
          ? '连不上，10 秒没回应'
          : err.code === 'network'
            ? `连不上：${err.raw}`
            : errorTitle(err)

  return (
    <div className="trs-box" aria-label={`${e.name} 的 API Key`}>
      <div className="trs-kin">
        {has ? (
          <>
            <span className="inp ro" aria-label="已存的 Key">
              ••••••••••••{e.keyTail}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  onStatuses(await window.cnPlugins.call<EngineStatus[]>(ID, 'clearKey', e.id))
                  setTest(null)
                  reload()
                } catch (err) {
                  onNotice(errText(err))
                }
              }}
            >
              删掉
            </button>
          </>
        ) : (
          <>
            <input
              ref={input}
              className="inp"
              aria-label={`${e.name} 的 API Key`}
              placeholder={`粘贴 ${e.name} 的 API Key`}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => ev.key === 'Enter' && draft.trim() && void save()}
            />
            <button type="button" className="btn btn-sm btn-primary" disabled={!draft.trim()} onClick={() => void save()}>
              存好
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm" disabled={!has || (test !== null && 'run' in test)} onClick={() => void runTest()}>
          测试连接
        </button>
      </div>
      <p className="note">
        存在这台 Mac 的钥匙串里，不进库、不进 Git；这里只露最后 4 位。
        <button type="button" className="tr-lnk" onClick={() => webHost()?.open(API_PAGES[id].key, true)}>
          去 {e.name} 拿 Key
          <Codicon name="link-external" size={11} />
        </button>
      </p>
      {test &&
        ('run' in test ? (
          <div className="trs-res">
            <Codicon name="loading" size={12} className="spin" />在连 {e.name}…
          </div>
        ) : test.ok ? (
          <div className="trs-res" role="status">
            <i style={{ background: 'var(--green)' }} />
            能用 · {secs(test.ms)} · eigenvalue → {test.text}（{e.name}）
          </div>
        ) : (
          <div className="trs-res" role="status">
            <i style={{ background: 'var(--red)' }} />
            {failText(test.error)}
            {test.error.code === 'no-balance' && (
              <button type="button" className="tr-lnk" onClick={() => webHost()?.open(API_PAGES[id].billing, true)}>
                去充值
                <Codicon name="link-external" size={11} />
              </button>
            )}
          </div>
        ))}
    </div>
  )
}
