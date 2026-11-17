import { describe, expect, it } from 'vitest'
import { isSearchUrl, looksLikeUrl, toUrl } from '../src/renderer/url'

describe('地址栏和 ⌘K 里打的字 → 网址', () => {
  it('像网址就补 https，不像就去搜；搜出来的认得出是搜索', () => {
    expect(toUrl('weread.qq.com/web/shelf')).toBe('https://weread.qq.com/web/shelf')
    expect(isSearchUrl(toUrl('weread.qq.com'))).toBe(false)
    expect(toUrl('小布什')).toBe('https://www.google.com/search?q=%E5%B0%8F%E5%B8%83%E4%BB%80')
    expect(isSearchUrl(toUrl('小布什'))).toBe(true)
    expect(isSearchUrl(toUrl('localhost:5173'))).toBe(false)
  })

  it('纯数字带点的（3.14、2.0、版本号）不是网址：拿去搜，不当 IP 去连（第 5 轮：3.14 去连了 3.0.0.14）', () => {
    for (const s of ['3.14', '3.1415926', '1.5', '2.0', '10.0.19041.1', '192.168.1.1']) {
      expect(looksLikeUrl(s), s).toBe(false)
      expect(isSearchUrl(toUrl(s)), s).toBe(true)
    }
    for (const s of ['example.com', 'github.com/foo', 'readme.md', 'Node.js', 'v0.4.0.app', '192.168.1.1:8080', '192.168.1.1/admin', 'localhost:5173', 'http://3.14']) expect(looksLikeUrl(s), s).toBe(true)
    expect(toUrl('3.14')).toBe('https://www.google.com/search?q=3.14')
    expect(toUrl('192.168.1.1:8080')).toBe('https://192.168.1.1:8080')
  })
})
