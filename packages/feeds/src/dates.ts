/**
 * 源里的时间：RSS 用 RFC 822（「Wed, 02 Oct 2002 13:00:00 GMT」，常见各种不规矩：两位年份、没有秒、
 * 「+08:00」「UT」「Z」、星期写错），Atom 和 JSON Feed 用 RFC 3339，有的中文站写「2024-01-02 03:04:05」或「2024年1月2日 03:04」。
 * 没写时区的按本机时区。读不懂返回 undefined（调的人用抓到的时间）。
 */
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }
const ZONES: Record<string, number> = { ut: 0, utc: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420, cet: 60, cest: 120, bst: 60, jst: 540, kst: 540, hkt: 480, sgt: 480 }

export function parseDate(raw: string | undefined | null): number | undefined {
  const s = raw?.trim()
  if (!s) return undefined
  return rfc3339(s) ?? rfc822(s) ?? chinese(s) ?? fallback(s)
}

function rfc3339(s: string): number | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2}|UTC|GMT)?$/i.exec(s)
  if (!m) return undefined
  const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '0', zone] = m
  const ms = Number((frac + '00').slice(0, 3))
  return build(+y!, +mo! - 1, +d!, +h, +mi, +sec, ms, zone)
}

function rfc822(s: string): number | undefined {
  // 星期几可有可无、写错也不管
  const m = /^(?:[a-z]{2,9}\.?,?\s*)?(\d{1,2})[\s-]+([a-z]{3,9})\.?[\s-]+(\d{2,4})(?:[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([a-z]{1,5}|[+-]\d{2}:?\d{2})?/i.exec(s)
  if (!m) return undefined
  const mon = MONTHS[m[2]!.toLowerCase()]
  if (mon === undefined) return undefined
  let y = +m[3]!
  if (m[3]!.length === 2) y += y < 50 ? 2000 : 1900
  return build(y, mon, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), 0, m[7] ?? 'GMT')
}

function chinese(s: string): number | undefined {
  const m = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?/.exec(s)
  if (!m) return undefined
  return build(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), 0, undefined)
}

function fallback(s: string): number | undefined {
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

function build(y: number, mo: number, d: number, h: number, mi: number, sec: number, ms: number, zone: string | undefined): number | undefined {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 24 || mi > 59 || sec > 60) return undefined
  if (zone === undefined) {
    const t = new Date(y, mo, d, h, mi, sec, ms).getTime()
    return Number.isFinite(t) ? t : undefined
  }
  const off = zoneOffset(zone)
  if (off === undefined) return undefined
  return Date.UTC(y, mo, d, h, mi, sec, ms) - off * 60_000
}

/** 时区写法 → 比 UTC 早多少分钟；认不出的军用单字母等当 UTC */
function zoneOffset(zone: string): number | undefined {
  const z = zone.toLowerCase()
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(z)
  if (m) return (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +(m[3] ?? 0))
  if (z in ZONES) return ZONES[z]
  return /^[a-z]{1,5}$/.test(z) ? 0 : undefined
}
