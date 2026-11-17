/**
 * 全软件界面上的日期只有这一种写法（DESIGN.md「日期」），别处不再自己拼：
 * - 只写哪天（列表右边、卡片和文件夹的元信息）：今天写钟点「10:34」、昨天「昨天」、这周「周四」、今年「11月6日」、往年「2024年11月6日」
 * - 带钟点（time: true，历史、提交、剪的时间、检查更新、AI 对话）：「今天 10:34」「昨天 21:05」「周四 21:05」「11月6日 09:30」「2024年11月6日 09:30」
 * 中文和数字之间不手打空格，间距交给 text-autospace。写进文件里的日期（2026-11-15）不归这里管。
 */
const DAY_MS = 86400_000
const p2 = (x: number) => String(x).padStart(2, '0')

export function when(ms: number, opts: { now?: number; time?: boolean } = {}): string {
  const d = new Date(ms)
  const now = new Date(opts.now ?? Date.now())
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let day: string
  if (ms >= start && ms < start + DAY_MS) {
    if (!opts.time) return hm
    day = '今天'
  } else if (ms >= start - DAY_MS && ms < start) day = '昨天'
  else if (ms >= start - 6 * DAY_MS && ms < start) day = '周' + '日一二三四五六'[d.getDay()]
  else day = dateText(ms, now.getTime())
  return opts.time ? `${day} ${hm}` : day
}

/** 哪一天（不说今天昨天）：今年「11月6日」，往年「2024年11月6日」；首页问候、日历、提示里的日子 */
export function dateText(ms: number, nowMs = Date.now()): string {
  const d = new Date(ms)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(nowMs).getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/** 钟点「09:05」 */
export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}
