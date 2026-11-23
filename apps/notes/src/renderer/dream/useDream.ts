import { useEffect, useState } from 'react'
import type { DreamGroup, DreamItem, DreamReport } from '../../shared/api'
import { clock, when } from '../../shared/when'
import { t } from '../../shared/i18n'

/** 最近一份梦游报告，主进程一有变化就推过来 */
export function useDream() {
  const [report, setReport] = useState<DreamReport | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    void window.cn.dreamReport().then(setReport)
    return window.cn.onDream((r, run) => {
      setReport(r)
      setRunning(run)
    })
  }, [])
  return { report, running, setReport, setRunning }
}

export const pendingOf = (r: DreamReport | null) => r?.items.filter((i) => i.state === 'pending').length ?? 0

/** 梦游这几条收下、撤回时要改、要挪的文件：挪动的两头、挪老图时改了链接的笔记 */
export const dreamPaths = (items: DreamItem[]) => items.flatMap((i) => [...i.files, ...(i.move ? [i.move.from, i.move.to] : []), ...(i.oldImages?.moves.map((m) => m.note) ?? [])])

export const GROUPS: Record<DreamGroup, string> = {
  attach: '附件',
  file: '归类和改名',
  viz: '可视化',
  link: '补上的双链',
  unsure: t('拿不准，你来定'),
  recheck: t('旧「相关：」复查'),
  dup: '可能重复',
  week: '本周小结',
}

/**
 * 梦游的时间：「昨夜 02:40到03:18」「今天 14:03到14:05」「周四 02:40到03:18」（「到」两边不手打空格，间距交给 autospace）；
 * 刚跑完的（十分钟内）写「刚才 04:00」；起止同一分钟只写一个时间。哪一天照全软件的 when()。
 */
export function dreamWhen(r: DreamReport, now = new Date()): string {
  const span = clock(r.started) === clock(r.finished) ? clock(r.started) : t('{from}到{to}', { from: clock(r.started), to: clock(r.finished) })
  if (now.getTime() - r.finished < 10 * 60_000 && r.finished <= now.getTime()) return t('刚才 {span}', { span })
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const h = new Date(r.started).getHours()
  let day: string
  if (r.started >= today) day = h < 6 ? t('昨夜') : t('今天')
  else if (r.started >= today - 86400_000) day = h >= 21 ? t('昨夜') : t('昨天')
  else day = when(r.started, { now: now.getTime() })
  return `${day} ${span}`
}

/**
 * 这次梦游真动了正文的几处，按真改动说（摘要里用；以前一律写「你写的正文一个字没动」，不对）：
 * 「补了2处双链（在正文末尾加了一行）」「做了1个可视化（嵌在读PDF笔记那一段的末尾）」
 * 「挪老图改了3篇里的图片链接」「归类和改名时2篇里的标题或相对链接跟着改、1篇别的笔记里的[[旧名]]跟着换」。都没动是 null（不提）
 */
export function bodyEdits(items: DreamItem[]): string | null {
  const real = items.filter((i) => i.commit)
  const n = (g: DreamGroup) => real.filter((i) => i.group === g).length
  const parts: string[] = []
  if (n('link')) parts.push(`补了${n('link')}处双链（在正文末尾加了一行）`)
  if (n('viz')) parts.push(`做了${n('viz')}个可视化（嵌在读PDF笔记那一段的末尾）`)
  const pics = real.filter((i) => i.group === 'attach').reduce((k, i) => k + (i.changes?.length ?? 0), 0)
  if (pics) parts.push(`挪老图改了${pics}篇里的图片链接`)
  const files = real.filter((i) => i.group === 'file' && i.edits)
  const self = files.filter((i) => i.edits!.self).length
  const others = files.reduce((k, i) => k + i.edits!.others, 0)
  const fp = [self ? `${self}篇里的标题或相对链接跟着改` : '', others ? `${others}篇别的笔记里的[[旧名]]跟着换` : ''].filter(Boolean)
  if (fp.length) parts.push(`归类和改名时${fp.join('、')}`)
  return parts.length ? parts.join('；') : null
}

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * 收下几条后有合不上、留着的：一句说收下了几处、哪几条没收下、为什么（第 6 轮：以前一条冲突就整批不收、也不说是哪条）。
 * 都收下了是 null（调的人说自己那句）
 */
export function takenSay(ids: string[], r: DreamReport): string | null {
  const asked = r.items.filter((i) => ids.includes(i.id))
  const stuck = asked.filter((i) => i.state === 'pending' && i.conflict)
  if (!stuck.length) return null
  const taken = asked.filter((i) => i.state === 'taken').length
  const why = [...new Set(stuck.map((i) => `「${i.title}」${i.conflict}`))].join('；')
  return `${taken ? `收下了${taken}处；` : '一处都没收下；'}${stuck.length}处没收下：${why}`
}
