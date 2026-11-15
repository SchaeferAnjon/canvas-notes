/** 地址栏里打的字 → 网址：像网址就补 https，不像就去搜 */
export function toUrl(input: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) || /^localhost(:\d+)?(\/\S*)?$/.test(s)) return (s.startsWith('localhost') ? 'http://' : 'https://') + s
  return 'https://www.google.com/search?q=' + encodeURIComponent(s)
}

/** 地址里的 %E5%90%89 显示成中文 */
export function decodeUrl(u: string): string {
  try {
    return decodeURI(u)
  } catch {
    return u
  }
}
