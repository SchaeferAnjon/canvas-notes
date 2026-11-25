import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FeedsCore } from '../src'
import { openFeeds, type OpenFeedsOptions } from '../src/node'

/** 一个临时文件夹，测完删掉（只在系统临时目录里） */
export function tempDir(prefix = 'cn-feeds-'): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

/** 一个能拨的钟 */
export function clock(start = Date.UTC(2026, 10, 25, 8, 0)) {
  let t = start
  return { now: () => t, set: (x: number) => void (t = x), add: (ms: number) => void (t += ms) }
}

export async function openTest(dataDir: string, o: Partial<OpenFeedsOptions> = {}): Promise<FeedsCore> {
  return openFeeds({ dataDir, deviceName: 'Test Mac', commit: false, pushDelayMs: 0, http: { hostGapMs: 0 }, ...o })
}

/** 拼一份 RSS：items 是 [guid, 标题, 发表时间] */
export function rssOf(title: string, items: { guid?: string; title: string; link?: string; date?: number; body?: string }[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>https://site.test/</link>${items
    .map(
      (i) =>
        `<item><title>${esc(i.title)}</title>${i.guid ? `<guid isPermaLink="false">${esc(i.guid)}</guid>` : ''}${i.link ? `<link>${esc(i.link)}</link>` : ''}${i.date ? `<pubDate>${new Date(i.date).toUTCString()}</pubDate>` : ''}<description>${esc(i.body ?? `<p>${i.title} 的正文</p>`)}</description></item>`,
    )
    .join('')}</channel></rss>`
}
