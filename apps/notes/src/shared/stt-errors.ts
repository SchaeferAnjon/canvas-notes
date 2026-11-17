/**
 * 生成字幕没成时的原话 → 一句中文 + 收起来的英文原话（照 DESIGN.md「AI 出错」的写法：一行中文说明，「看原话 ›」点开才是英文）。
 * 原话是主进程写的「音频没下载下来：<yt-dlp 的话>」「Soniox 出错（500）：<接口的话>」「连不上 Soniox：fetch failed (ECONNREFUSED)」这种。
 * 不碰 Electron，能单独测。
 */
import type { Site } from './video'

export interface SttErrorView {
  /** 一行中文说明 */
  title: string
  /** 英文原话；我们自己写的中文短话是 null，不收「看原话」 */
  raw: string | null
}

const SITE: Record<Site, string> = { youtube: 'YouTube', bilibili: 'B站' }

/** 网络不通的原话：Node 的 fetch、系统的连接错误、超时 */
const NETWORK = /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|timed? ?out|aborted due to timeout|socket hang up|network/i

/** 我们自己写的中文（带几个产品名也算），原样显示 */
const ownWords = (s: string) => !/[A-Za-z]{4,}/.test(s.replace(/Soniox|yt-dlp|YouTube|Mac/g, ''))

export function sttErrorView(raw: string, site: Site): SttErrorView {
  const s = raw.trim()
  if (ownWords(s)) return { title: s, raw: null }
  const name = SITE[site]
  const m = /^(音频没下载下来|Soniox 出错（(\d+)）|Soniox 没听写成|连不上 Soniox)：([\s\S]*)$/.exec(s)
  // 菜单上面已经写着「字幕没生成成」：这一行不再重复它，说是什么问题
  if (!m) return { title: NETWORK.test(s) ? '网络不通' : '没认出是哪里出的错', raw: s }
  const [, head, status, rest] = m
  if (head === '音频没下载下来') {
    if (/HTTP Error 5\d\d/.test(rest!)) return { title: `${name}的音频服务器拒绝了下载，再试一次多半就好`, raw: rest! }
    if (/HTTP Error 40[13]/.test(rest!)) return { title: `${name}不让下载这个视频的音频：在右栏登录${name}后再试`, raw: rest! }
    if (/Unable to download webpage|urlopen error|timed? ?out|Connection (reset|refused|aborted)|Network is unreachable|nodename nor servname/i.test(rest!)) return { title: '网络断了，音频没下载下来', raw: rest! }
    return { title: '音频没下载下来', raw: rest! }
  }
  if (head === '连不上 Soniox') return { title: '网络不通，没连上Soniox', raw: rest! }
  if (status) return { title: Number(status) >= 500 ? 'Soniox那边出错了，过一会儿再试' : 'Soniox出错了', raw: rest! }
  return { title: 'Soniox没听写成，再试一次', raw: rest! }
}
