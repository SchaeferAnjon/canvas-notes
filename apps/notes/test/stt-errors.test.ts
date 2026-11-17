import { expect, it } from 'vitest'
import { sttErrorView } from '../src/shared/stt-errors'

// 第 4 轮美学存疑 1：B 站 CDN 报 567 时菜单里直接是 yt-dlp 的英文原话
const B567 = '音频没下载下来：[download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries'

it('音频服务器拒绝（5xx）：一句中文说哪个网站、再试多半就好，英文原话收进「看原话」', () => {
  const v = sttErrorView(B567, 'bilibili')
  expect(v.title).toBe('B站的音频服务器拒绝了下载，再试一次多半就好')
  expect(v.raw).toBe('[download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries')
  expect(sttErrorView('音频没下载下来：unable to download video data: HTTP Error 503: Service Unavailable', 'youtube').title).toBe('YouTube的音频服务器拒绝了下载，再试一次多半就好')
})

it('403、网络断了、别的下载错误：各一句中文，原话收起来', () => {
  expect(sttErrorView('音频没下载下来：unable to download video data: HTTP Error 403: Forbidden', 'bilibili')).toEqual({
    title: 'B站不让下载这个视频的音频：在右栏登录B站后再试',
    raw: 'unable to download video data: HTTP Error 403: Forbidden',
  })
  expect(sttErrorView('音频没下载下来：Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided>', 'youtube').title).toBe('网络断了，音频没下载下来')
  expect(sttErrorView('音频没下载下来：Requested format is not available', 'youtube')).toEqual({ title: '音频没下载下来', raw: 'Requested format is not available' })
})

it('Soniox 出错：说是 Soniox 那边，原话收起来', () => {
  expect(sttErrorView('Soniox 出错（500）：internal error', 'youtube')).toEqual({ title: 'Soniox那边出错了，过一会儿再试', raw: 'internal error' })
  expect(sttErrorView('Soniox 没听写成：audio decode failed', 'youtube')).toEqual({ title: 'Soniox没听写成，再试一次', raw: 'audio decode failed' })
})

it('我们自己写的中文短话原样显示，不收「看原话」', () => {
  expect(sttErrorView('Soniox 密钥不对：到设置 › AI 里重新填', 'youtube')).toEqual({ title: 'Soniox 密钥不对：到设置 › AI 里重新填', raw: null })
  expect(sttErrorView('音频没下载下来：yt-dlp 没留下文件', 'bilibili')).toEqual({ title: '音频没下载下来：yt-dlp 没留下文件', raw: null })
  expect(sttErrorView('Soniox 没听写成：没说原因', 'bilibili')).toEqual({ title: 'Soniox 没听写成：没说原因', raw: null })
})

it('认不出的英文原话：不再重复上面那行「字幕没生成成」，说没认出是哪里出的错，原话整句收起来', () => {
  expect(sttErrorView('ENOSPC: no space left on device, write', 'youtube')).toEqual({ title: '没认出是哪里出的错', raw: 'ENOSPC: no space left on device, write' })
})

it('连不上 Soniox（第 5 轮：标题、说明都写「字幕没生成成」，原话 fetch failed）：说清是网络问题，英文原话收起来', () => {
  expect(sttErrorView('连不上 Soniox：fetch failed (ECONNREFUSED)', 'youtube')).toEqual({ title: '网络不通，没连上Soniox', raw: 'fetch failed (ECONNREFUSED)' })
  expect(sttErrorView('连不上 Soniox：The operation was aborted due to timeout', 'bilibili').title).toBe('网络不通，没连上Soniox')
  // 没带开头的网络原话（别处冒出来的）：也说是网络
  for (const raw of ['fetch failed', 'connect ECONNREFUSED 127.0.0.1:9', 'getaddrinfo ENOTFOUND api.soniox.com', 'read ETIMEDOUT'])
    expect(sttErrorView(raw, 'youtube'), raw).toEqual({ title: '网络不通', raw })
})
