/**
 * 抓下来的字节 → 字。先后：BOM → HTTP 头的 charset → `<?xml encoding=…?>` → HTML 的 `<meta charset>` →
 * 按 UTF-8 读得通就是 UTF-8 → GB18030（中文站没写编码时最常见）→ windows-1252。
 * 声明了却读不通（服务器头写 UTF-8、正文其实是 GBK，中文站常见）时往下一个试，不硬读出乱码。
 * 用 TextDecoder（Node、Electron、浏览器都带全套编码表）。
 */

export interface Decoded {
  text: string
  /** 最后用的编码（WHATWG 的名字，如 utf-8、gbk、gb18030、big5、shift_jis） */
  charset: string
}

export function decodeBody(bytes: Uint8Array, contentType?: string | null): Decoded {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), charset: 'utf-8' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), charset: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), charset: 'utf-16be' }
  const head = latin1(bytes.subarray(0, 2048))
  const declared = [charsetOf(contentType), /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1], metaCharset(head)]
  const tried = new Set<string>()
  for (const label of [...declared, 'utf-8', 'gb18030']) {
    if (!label) continue
    const d = decoder(label, true)
    if (!d || tried.has(d.encoding)) continue
    tried.add(d.encoding)
    try {
      return { text: d.decode(bytes), charset: d.encoding }
    } catch {
      // 读不通：换下一个
    }
  }
  return { text: new TextDecoder('windows-1252').decode(bytes), charset: 'windows-1252' }
}

function decoder(label: string, fatal: boolean): TextDecoder | null {
  try {
    return new TextDecoder(label.trim().toLowerCase(), { fatal })
  } catch {
    return null
  }
}

export function charsetOf(contentType: string | null | undefined): string | undefined {
  return contentType ? /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1] : undefined
}

function metaCharset(head: string): string | undefined {
  return /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1]
}

function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return s
}
