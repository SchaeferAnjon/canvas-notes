/**
 * 设置 › AI 上半页「AI 从哪来」（task-587os，设计页第 4 节）：「各家命令行」下面两组，样子照「各家命令行」那一组的行
 * （标志 16 + 名字，下面状态点加一句，右边同宽的按钮）：
 * - API Key：一家一行，绿点表示验过能用，只露后 4 位，写存在钥匙串；按钮「换 Key」（删在点开以后）；「加一家」从这里加；
 * - 本机模型：Ollama、LM Studio 开没开、有几个模型；没找到的按钮是「下载」（去官网，软件不替人装）。
 * 下面一句小字说清动手由谁执行（软件自带的 OpenCode，写版本和许可证）。
 */
import { Codicon } from '@cn/design'
import { useState } from 'react'
import type { EngineInfo } from '../shared/agent'
import { API_IDS, type ApiId, KEY_SHAPE, type LocalId, LOCAL_IDS, PROVIDER_NAME, SOURCE_LABEL } from '@cn/ai-engines/shared'
import { EngineLogo } from './engine-logo'
import { Group, Row, useSaid } from './settings/ui'
import { useT } from './i18n'
import { errText } from './settings-ai'
import './settings-sources.css'

/** 自带的 OpenCode 钉死的版本（scripts/fetch-opencode.mjs 的 VERSION） */
export const BUNDLED_OPENCODE = '1.19'

const KEY_ROW: Record<ApiId, string> = { anthropic: 'keyAnthropic', openai: 'keyOpenai', deepseek: 'keyDeepseek', openrouter: 'keyOpenrouter' }
const LOCAL_ROW: Record<LocalId, string> = { ollama: 'localOllama', lmstudio: 'localLmstudio' }

/** 填 Key 的那一小块：密码框 + 验证；换 Key 时多一颗「删掉这把 Key」 */
function KeyForm(p: { id: ApiId; has: boolean; onDone(msg: string): void; onCancel(): void }) {
  const t = useT()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = PROVIDER_NAME[p.id]
  return (
    <form
      className="aisrc-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key.trim() || busy) return
        setBusy(true)
        setError(null)
        void window.cn.aiKeySet(p.id, key).then((r) => {
          setBusy(false)
          if (r.ok) p.onDone(t('{name}的Key验过了，存在钥匙串里', { name }))
          else setError(r.error.split('\n')[0]!)
        })
      }}
    >
      <input className="sa-fld" type="password" autoFocus value={key} placeholder={KEY_SHAPE[p.id]} aria-label={t('{name}的API Key', { name })} data-testid={`key-input-${p.id}`} spellCheck={false} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
      <button type="button" className="aisrc-link" onClick={() => void window.cn.aiOpenPage(p.id)}>
        {t('去{name}拿Key ↗', { name })}
      </button>
      {error && (
        <p className="aisrc-err" role="alert">
          <Codicon name="error" size={14} className="bic" />
          {error}
        </p>
      )}
      <div className="aisrc-btns">
        <button type="submit" className="sa-btn primary" disabled={!key.trim() || busy}>
          {busy ? t('在验证…') : t('验证并用它')}
        </button>
        <button type="button" className="sa-btn" onClick={p.onCancel}>
          {t('取消')}
        </button>
        {p.has && (
          <button type="button" className="aisrc-del" onClick={() => void window.cn.aiKeyRemove(p.id).then(() => p.onDone(t('{name}的Key删掉了', { name })))}>
            {t('删掉这把Key')}
          </button>
        )}
      </div>
    </form>
  )
}

export function SourceRows(p: { engines: EngineInfo[]; onNotice(t: string): void }) {
  const t = useT()
  const said = useSaid()
  /** 正在填哪一家的 Key（换 Key、加一家） */
  const [editing, setEditing] = useState<ApiId | null>(null)
  const [adding, setAdding] = useState<ApiId | null>(null)
  const [finding, setFinding] = useState(false)
  const info = (id: string) => p.engines.find((e) => e.id === id)
  const withKey = API_IDS.filter((id) => !!info(id)?.path)
  const missing = API_IDS.filter((id) => !info(id)?.path)
  const done = (msg: string) => {
    setEditing(null)
    setAdding(null)
    said.say(msg)
  }
  return (
    <>
      <Group title={t('API Key')}>
        {withKey.map((id) => (
          <Row
            key={id}
            id={KEY_ROW[id]}
            label={
              <>
                <EngineLogo id={id} size={16} />
                {SOURCE_LABEL[id]}
              </>
            }
            desc={
              <span>
                <span className="dot" />
                {t('能用 · ••••{tail} · 存在钥匙串', { tail: info(id)?.tail ?? '' })}
              </span>
            }
            more={editing === id ? <KeyForm id={id} has onDone={done} onCancel={() => setEditing(null)} /> : undefined}
          >
            {editing !== id && (
              <button type="button" className="sa-btn aipk-cli-btn" data-testid={`key-change-${id}`} onClick={() => setEditing(id)}>
                {t('换Key')}
              </button>
            )}
          </Row>
        ))}
        {missing.length > 0 && (
          <Row
            id="keyAdd"
            label={
              <>
                <Codicon name="plug" size={16} />
                {t('加一家')}
              </>
            }
            desc={missing.map((id) => PROVIDER_NAME[id]).join(t('、'))}
            more={
              adding ? (
                <>
                  <div className="aisrc-pick" role="radiogroup" aria-label={t('加哪一家')}>
                    {missing.map((id) => (
                      <button key={id} type="button" role="radio" aria-checked={adding === id} className={adding === id ? 'on' : ''} onClick={() => setAdding(id)}>
                        <EngineLogo id={id} size={14} />
                        {PROVIDER_NAME[id]}
                      </button>
                    ))}
                  </div>
                  <KeyForm key={adding} id={adding} has={false} onDone={done} onCancel={() => setAdding(null)} />
                </>
              ) : undefined
            }
          >
            {!adding && (
              <button type="button" className="sa-btn aipk-cli-btn" data-testid="key-add" onClick={() => setAdding(missing[0]!)}>
                {t('加Key')}
              </button>
            )}
          </Row>
        )}
      </Group>
      <Group title={t('本机模型')}>
        {LOCAL_IDS.map((id) => {
          const e = info(id)
          const n = e?.models.filter((m) => m.id).length ?? 0
          const on = !!e?.path
          return (
            <Row
              key={id}
              id={LOCAL_ROW[id]}
              label={
                <>
                  <EngineLogo id={id} size={16} />
                  {SOURCE_LABEL[id]}
                </>
              }
              desc={
                <span>
                  <span className={'dot' + (on ? '' : ' off')} />
                  {on ? t('开着 · {n}个模型', { n }) : t('没找到')}
                </span>
              }
            >
              {on ? (
                <button
                  type="button"
                  className="sa-btn aipk-cli-btn"
                  disabled={finding}
                  onClick={() => {
                    setFinding(true)
                    void window.cn
                      .aiLocal(true)
                      .catch((err: unknown) => p.onNotice(errText(err)))
                      .finally(() => setFinding(false))
                  }}
                >
                  {finding ? t('正在找…') : t('刷新')}
                </button>
              ) : (
                <button type="button" className="sa-btn aipk-cli-btn" onClick={() => void window.cn.aiOpenPage(id)}>
                  {t('下载')}
                </button>
              )}
            </Row>
          )
        })}
      </Group>
      <p className="aisrc-note">{t('不用工具的活直接问接口；动手（改笔记、全能模式）由软件自带的OpenCode {v}（MIT）执行。装了别的命令行就用你的。', { v: BUNDLED_OPENCODE })}</p>
    </>
  )
}
