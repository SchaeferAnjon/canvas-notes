#!/usr/bin/env node
// 假的 yt-dlp（测试用，CN_YTDLP 指过来）：认 -o 模板，在那个文件夹里写一个小小的 audio.m4a；
// 网址里带 fail 就像真 yt-dlp 那样报 ERROR 退出。CN_FAKE_YTDLP_LOG 给了就把收到的参数记进去。
// 网址里带 edgeone：像 B 站分到腾讯 EdgeOne 那家 CDN，不分段下（请求不带 Range）就回 567。
import { appendFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (process.env.CN_FAKE_YTDLP_LOG) appendFileSync(process.env.CN_FAKE_YTDLP_LOG, JSON.stringify(args) + '\n')
const url = args[args.length - 1] ?? ''
// CN_FAKE_YTDLP_DELAY_MS：慢一点，好看「正在生成」；CN_FAKE_YTDLP_567=1：像 B 站 CDN 那样一律报 567（分段下也一样）
if (process.env.CN_FAKE_YTDLP_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.CN_FAKE_YTDLP_DELAY_MS)))
if (process.env.CN_FAKE_YTDLP_567) {
  process.stderr.write('ERROR: [download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries\n')
  process.exit(1)
}
if (url.includes('fail')) {
  process.stderr.write('ERROR: [youtube] fail: Video unavailable\n')
  process.exit(1)
}
if (url.includes('edgeone') && !args.includes('--http-chunk-size')) {
  process.stderr.write('ERROR: [download] Got error: HTTP Error 567: Unknown Status. Giving up after 10 retries\n')
  process.exit(1)
}
const tpl = args[args.indexOf('-o') + 1]
writeFileSync(tpl.replace('%(ext)s', 'm4a'), Buffer.from('fake m4a audio'))
