/**
 * 底栏「后台在做的事」里的建索引那一件（2026-11-25 收件箱「第一次打开 CPU 直接占满」：第一次打开一个库要读全部 PDF、算向量，
 * 以前只有 ⌘K 和设置里看得到在忙什么）：「正在建搜索索引 32%」「正在下载本机模型 40%」，A 写在底栏，B 收进「后台 N 件」。
 * 忙不到 2 秒的不出（平时打开库时扫一遍、改了一篇重算一下，一闪就没）。点了到设置「按意思找」那一行。
 */
import { useEffect, useState } from 'react'
import type { EmbedModelStatus, SearchStatus } from '../../shared/search'
import { useT } from '../i18n'
import { openSettingsAt } from '../settings/jump'
import type { Job } from './StatusBar'

/** 忙了多久才出 */
export const INDEX_JOB_DELAY_MS = 2000

const pct = (done: number, total: number) => Math.min(99, Math.floor((done / Math.max(1, total)) * 100))

/** 现在这一句；不在忙的时候 null（纯函数，单元测试用） */
export function indexJobText(s: SearchStatus | null, e: EmbedModelStatus | null, t: ReturnType<typeof useT>): { icon: Job['icon']; text: string } | null {
  if (e?.phase === 'downloading') return { icon: 'cloud-download', text: t('正在下载本机模型 {pct}%', { pct: pct(e.got, e.size) }) }
  if (e?.phase === 'verifying') return { icon: 'cloud-download', text: t('正在校验本机模型') }
  // 大模型那份在读 PDF 的字、还没切出段数时 total 是 0：照样算在建，不写数（设计复审：一直 0% 看着像卡住），不然底栏这一件一会儿没一会儿有
  if (e?.phase === 'indexing') return { icon: 'search', text: e.total > 0 ? t('正在建搜索索引 {pct}%', { pct: pct(e.done, e.total) }) : t('正在建搜索索引…') }
  if ((s?.phase === 'text' || s?.phase === 'embed') && s.total > 0) return { icon: 'search', text: t('正在建搜索索引 {pct}%', { pct: pct(s.done, s.total) }) }
  return null
}

export function useIndexJob(): Job | null {
  const t = useT()
  const [s, setS] = useState<SearchStatus | null>(null)
  const [e, setE] = useState<EmbedModelStatus | null>(null)
  const [since, setSince] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    let live = true
    void window.cnSearch.status().then((v) => live && setS(v))
    void window.cn.embedStatus().then((v) => live && setE(v))
    const offS = window.cnSearch.onStatus(setS)
    const offE = window.cn.onEmbed(setE)
    return () => ((live = false), offS(), offE())
  }, [])
  const now = indexJobText(s, e, t)
  const busy = !!now
  useEffect(() => {
    if (!busy) return setSince(null)
    setSince((x) => x ?? Date.now())
    const timer = setTimeout(() => tick((n) => n + 1), INDEX_JOB_DELAY_MS)
    return () => clearTimeout(timer)
  }, [busy])
  if (!now || since === null || Date.now() - since < INDEX_JOB_DELAY_MS) return null
  return { id: 'index', icon: now.icon, text: now.text, onClick: () => openSettingsAt('semantic') }
}
