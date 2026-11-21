/**
 * 白板上的视频卡（data-part="视频卡"）和时刻卡。
 * 视频卡：封面 16:9（右下角时长、底边红色的「看到哪」、悬停出播放圆钮）、标题最多三行、来源行、虚线下面「N 个时刻 · 问过 N 次 · 双击接着看 03:42」。
 * 不露原链接（偏好「剪藏卡片别露原文」）。光秃秃一个 YouTube 链接的卡也这样画：标题、封面、频道从网上取（本机缓存）。
 * 时刻卡：第一张大（截图满宽 + 原文译文），列里其余的小（64×36 截图 + 时间 + 译文一行）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { fmtTime, parseMoment, parseVideoCard, siteName, videoOf } from '../../shared/video'
import { type BoardDoc, content } from '@cn/format'
import { imageSrc } from '../md-widgets'

interface Meta {
  title: string
  channel: string
  duration: number
  cover: string | null
}

const URL_ONLY = /^(?:\[([^\]]+)\]\()?(https?:\/\/[^\s)]+)\)?$/

export function VideoCard({ text, notePath, stats }: { text: string; notePath: string; stats?: { moments: number; asked: number } }) {
  const card = parseVideoCard(text)
  const bare = card ? null : URL_ONLY.exec(text.trim())
  const url = card ? null : (bare?.[2] ?? null)
  const ref = card?.ref ?? videoOf(url)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [pos, setPos] = useState(0)
  useEffect(() => {
    if (!ref) return
    if (!card?.cover || !card.title) void window.cnVideo?.meta(url ?? `https://www.youtube.com/watch?v=${ref.id}`).then((m) => m && setMeta(m))
    void window.cnVideo?.lastPos(ref.key).then(setPos)
  }, [ref?.key])
  if (!ref) return null
  const title = card?.title ?? bare?.[1] ?? meta?.title ?? siteName(ref.site) + ' 视频'
  const durText = /(\d+:\d{2}(?::\d{2})?)\s*$/.exec(card?.meta ?? '')?.[1] ?? (meta?.duration ? fmtTime(meta.duration) : '')
  const secs = durText ? durText.split(':').reduce((a, x) => a * 60 + Number(x), 0) : (meta?.duration ?? 0)
  const channel = (card?.meta ?? '').replace(/\s*·\s*\d+:\d{2}(?::\d{2})?\s*$/, '') || meta?.channel || ''
  const cover = card?.cover ? imageSrc(notePath, card.cover) : meta?.cover
  return (
    <div className="cb-video" data-part="视频卡">
      <div className="cb-cover">
        {cover && <img src={cover} alt="" draggable={false} />}
        {durText && <span className="dur">{durText}</span>}
        {secs > 0 && pos > 0 && <span className="seen" style={{ width: `${Math.min(100, (pos / secs) * 100)}%` }} />}
        <span className="play">
          <Codicon name="play" size={16} />
        </span>
      </div>
      <div className="txt">
        <b>{title}</b>
        <div className="from">
          <span className="site">{siteName(ref.site)}</span>
          {channel && <span className="truncate">{channel}</span>}
        </div>
        <div className="foot">
          {stats && stats.moments > 0 && <span>{`${stats.moments}个时刻`}</span>}
          {stats && stats.asked > 0 && <span>{`问过${stats.asked}次`}</span>}
          <span className="sp" />
          <span>{pos > 3 ? `双击接着看${fmtTime(pos)}` : '双击在右栏看'}</span>
        </div>
      </div>
    </div>
  )
}

export function MomentCard({ text, notePath, small }: { text: string; notePath: string; small: boolean }) {
  const m = parseMoment(text.trim())
  if (!m) return null
  const cur = m.lines.find((l) => l.current) ?? m.lines[0]
  const doubt = /^>\s*\*\*我的疑惑\*\*：(.*)$/m.exec(text)?.[1]
  const tr = doubt ?? cur?.tr ?? ''
  const orig = doubt ? '' : (cur?.text ?? '')
  const src = m.image ? imageSrc(notePath, m.image) : null
  if (small)
    return (
      <div className="cb-moment small" title="双击回到这一秒">
        {src ? <img src={src} alt="" draggable={false} /> : <span className="ph" />}
        <div className="tx">
          <span className="mono">{fmtTime(m.t)}</span>
          {tr || orig}
        </div>
      </div>
    )
  return (
    <div className="cb-moment" title="双击回到这一秒">
      <div className="shot">
        {src && <img src={src} alt="" draggable={false} />}
        <span className="tm">{fmtTime(m.t)}</span>
      </div>
      <div className="tx">
        {orig && <div>{orig}</div>}
        {tr && <div className="t">{doubt ? `问过AI：${tr}` : tr}</div>}
      </div>
    </div>
  )
}

/** 双击时刻卡、视频卡要开的地址 */
export function videoUrlOfCard(text: string): { url: string; resume: boolean } | null {
  const m = parseMoment(text.trim())
  if (m) return { url: m.url, resume: false }
  const c = parseVideoCard(text)
  if (c) return { url: c.url, resume: true }
  const u = URL_ONLY.exec(text.trim())?.[2]
  return u && videoOf(u) ? { url: u, resume: true } : null
}

/** 视频卡对着哪个视频 */
export function videoKeyOfCard(text: string): string | null {
  const c = parseVideoCard(text)
  if (c) return c.ref.key
  const u = URL_ONLY.exec(text.trim())?.[2]
  return videoOf(u)?.key ?? null
}

/** 「时刻」列标题后面的视频短标题：白板上这个视频的卡的标题 */
export function momentsTitle(doc: BoardDoc, key: string): string {
  for (const b of doc.blocks) {
    if (b.kind !== 'card') continue
    const body = content(b)
    if (videoKeyOfCard(body) === key) return parseVideoCard(body)?.title ?? ''
  }
  for (const b of doc.blocks) {
    const m = b.kind === 'card' ? parseMoment(content(b).trim()) : null
    if (m?.key === key) return m.title
  }
  return ''
}
