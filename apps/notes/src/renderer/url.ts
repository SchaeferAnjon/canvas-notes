const SEARCH = 'https://www.google.com/search?q='

/**
 * 打的字像不像一个网址（没写 http:// 的）：域名的最后一段要有字母。
 * 纯数字带点的（3.14、2.0、1.2.3.4 这种版本号）不算：Chromium 会把「3.14」读成 IP 3.0.0.14，去连一个随便的公网地址（第 5 轮）。
 * 真要去一个 IP，写全 http://，或者带端口、路径（192.168.1.1:8080、192.168.1.1/admin）
 */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim()
  if (/^https?:\/\/\S/i.test(s)) return true
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(s)) return true
  const m = /^([\w-]+(?:\.[\w-]+)+)(:\d+)?(\/\S*)?$/.exec(s)
  if (!m) return false
  const host = m[1]!
  if (/^[\d.]+$/.test(host)) return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) && !!(m[2] || m[3])
  return /[a-z]/i.test(host.slice(host.lastIndexOf('.') + 1))
}

/** 地址栏里打的字 → 网址：像网址就补 https，不像就去搜 */
export function toUrl(input: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (looksLikeUrl(s)) return (s.toLowerCase().startsWith('localhost') ? 'http://' : 'https://') + s
  return SEARCH + encodeURIComponent(s)
}

/** 这个网址是 toUrl 拿打的字去搜出来的（不是打的网址） */
export const isSearchUrl = (u: string) => u.startsWith(SEARCH)

/** 地址里的 %E5%90%89 显示成中文 */
export function decodeUrl(u: string): string {
  try {
    return decodeURI(u)
  } catch {
    return u
  }
}
