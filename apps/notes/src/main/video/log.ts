import { appendFileSync } from 'node:fs'

/** 排查用：CN_VIDEO_LOG 指一个文件时，视频和生成字幕的每一步记一行（不记 cookie、密钥） */
export function dbg(...a: unknown[]) {
  const f = process.env.CN_VIDEO_LOG
  if (f) appendFileSync(f, `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`)
}
