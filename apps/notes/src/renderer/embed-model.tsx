/**
 * 设置 › 梦游里「找候选用的本机模型」那一行（2026-11-23 用户定换 bge-m3，第一次用时下载）：
 * 现在用的是哪个；bge-m3 下到哪（「已下 212 MB / 605 MB · 35%」）、索引建到哪（「建索引 340 / 1200 段」）；
 * 好了写「bge-m3 · 已就绪」；「按意思找」关着时说一句在哪打开。状态来自主进程 search/embed-model.ts（window.cn.embedStatus / onEmbed）。
 * 样式和梦游页别的行一样（settings.css 的 .dset-list）。
 */
import { Codicon } from '@cn/design'
import { type ReactNode, useEffect, useState } from 'react'
import type { EmbedModelStatus } from '../shared/search'
import { useT } from './i18n'
import { openSettingsAt } from './settings/jump'

const MB = 1024 * 1024
const mb = (n: number) => Math.round(n / MB)
/** 模型名（索引按它认的那个）在界面上的叫法 */
const modelName = (m: string | null) => (m?.startsWith('bge-m3') ? 'bge-m3' : 'e5-small')

export function EmbedModelRow() {
  const t = useT()
  const [s, setS] = useState<EmbedModelStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.embedStatus().then((v) => live && setS(v))
    const off = window.cn.onEmbed(setS)
    return () => {
      live = false
      off()
    }
  }, [])

  const [raw, setRaw] = useState(false)
  let line: string
  let bar: number | null = null
  let side: ReactNode = null
  const name = modelName(s?.model ?? null)
  if (!s) line = t('读取中')
  else if (!s.semantic) {
    line = t('设置 › 文档和白板里开了「按意思找」才会下载')
    side = (
      <button className="dset-go" onClick={() => openSettingsAt('semantic')}>
        {t('去打开')}
        <Codicon name="chevron-right" size={12} />
      </button>
    )
  } else if (s.phase === 'ready') {
    line = t('搜索和梦游都在用它')
    side = (
      <span className="dset-model">
        <i className="dot" />
        {t('bge-m3 · 已就绪')}
      </span>
    )
  } else if (s.phase === 'error') {
    line = t('bge-m3没弄好，先接着用{model}', { model: name })
    side = (
      <button className="btn btn-sm" onClick={() => void window.cn.embedRetry()}>
        {t('重试')}
      </button>
    )
  } else {
    if (s.phase === 'downloading') {
      bar = s.size ? s.got / s.size : 0
      line = t('在下载bge-m3：已下{got} MB / {size} MB · {pct}%', { got: mb(s.got), size: mb(s.size), pct: Math.floor(bar * 100) })
    } else if (s.phase === 'verifying') line = t('bge-m3下好了，在校验')
    else if (s.phase === 'indexing') {
      bar = s.total ? s.done / s.total : 0
      line = s.total ? t('bge-m3建索引{done} / {total}段，建好以前先用右边这个', { done: s.done, total: s.total }) : t('bge-m3下好了，在准备建索引')
    } else line = t('一会儿在后台下bge-m3（约{size} MB）', { size: mb(s.size) })
    side = <span className="dset-model">{t('现在用{model}', { model: name })}</span>
  }

  const err = s?.semantic && s.phase === 'error' ? s.error : undefined
  return (
    <div className="dset-list dset-embed" data-row="dEmbed" data-testid="embed-model-row" data-phase={s ? (s.semantic ? s.phase : 'off') : 'loading'}>
      <div className="row">
        <span className="tx">
          <b>{t('找候选用的本机模型')}</b>
          <span className={err !== undefined ? 'err' : undefined}>
            {line}
            {err && (
              <button className="dset-raw" onClick={() => setRaw(!raw)}>
                {raw ? t('收起原话') : t('看原话 ›')}
              </button>
            )}
          </span>
          {err && raw && <span className="raw">{err}</span>}
        </span>
        {side}
        {bar !== null && (
          <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(bar * 100)}>
            <i style={{ width: `${Math.min(100, bar * 100)}%` }} />
          </span>
        )}
      </div>
    </div>
  )
}
