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

/**
 * 局域网、本机的地址（路由器后台、NAS）：localhost、*.local、127.x、10.x、172.16–31.x、192.168.x，可带端口、路径。
 * 这些多半只有 http，也不该拿去 Google 搜（地址会发给 Google）：用户定的，直接打开（第 6 轮）
 */
export function isLanAddress(input: string): boolean {
  const m = /^([\w.-]+)(:\d+)?(\/\S*)?$/.exec(input.trim())
  if (!m) return false
  const host = m[1]!.toLowerCase()
  if (host === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(host)) return true
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!ip) return false
  const [a, b] = [Number(ip[1]), Number(ip[2])]
  if (ip.slice(1).some((x) => Number(x) > 255)) return false
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 地址栏里打的字 → 网址：局域网地址用 http 直接开，像网址就补 https，不像就去搜 */
export function toUrl(input: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (isLanAddress(s)) return 'http://' + s
  if (looksLikeUrl(s)) return 'https://' + s
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
