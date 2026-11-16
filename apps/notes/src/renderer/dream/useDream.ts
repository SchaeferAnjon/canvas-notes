import { useEffect, useState } from 'react'
import type { DreamGroup, DreamReport } from '../../shared/api'

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

export const GROUPS: Record<DreamGroup, string> = {
  file: '归类和改名',
  viz: '可视化',
  link: '补上的双链',
  dup: '可能重复',
  week: '本周小结',
}

const hm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 「昨夜 02:40 到 03:18」「今天 14:03 到 14:05」「11-12 02:40 到 03:18」 */
export function dreamWhen(r: DreamReport, now = new Date()): string {
  const s = new Date(r.started)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const h = s.getHours()
  const md = `${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`
  let day: string
  if (r.started >= today) day = h < 6 ? '昨夜' : '今天'
  else if (r.started >= today - 86400_000) day = h >= 21 ? '昨夜' : '昨天'
  else day = md
  return `${day} ${hm(r.started)} 到 ${hm(r.finished)}`
}

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
