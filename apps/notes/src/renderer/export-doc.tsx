/**
 * 文档「⋯」、文件树右键的「导出 PDF…」「导出为 Markdown…」（2026-11-24）。主进程那一半在 main/export-doc.ts。
 * - 开着的那篇用编辑器里的字（还没存进去的也算），没开的读磁盘。
 * - PDF：这篇按文档看法（标题、表格、图、公式、提示块）画进 #cn-print 这一层，只在打印时出现（export-print.css），印完拿掉。
 * - 白板（type: board，或这一页正用白板看）、数据库（只有 ```base 块的那篇）先不支持：两项灰掉，悬停说一句。
 */
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Markdown } from './md-render'
import { embedImageSrc, imageSrc } from './md-widgets'
import { NoteDoc } from './note-doc'
import { app } from './ctx/actions'
import type { MenuEntry } from './ctx/menu'
import { titleOf } from '../shared/layout'
import { t } from '../shared/i18n'
import './export-print.css'

async function liveText(path: string): Promise<string> {
  for (const d of NoteDoc.open) if (d.path === path) return d.text
  return (await window.cn.readNote(path)).text
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 印出来的正文：去掉属性、白板位置行、行尾块编号；没有「# 标题」就在最前面补一行 */
export function printBody(text: string, title: string): string {
  const body = text
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
    .split('\n')
    .filter((l) => !/^\s*<!--\s*(card|column)\b.*-->\s*$/.test(l))
    .map((l) => l.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, ''))
    .join('\n')
  return /^\s*# /.test(body) ? body : `# ${title}\n\n${body}`
}

/** 图载完（载不出来的不等），最多等 10 秒 */
const imagesReady = (host: HTMLElement) =>
  Promise.race([Promise.all([...host.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 10_000))])

export async function exportPdf(path: string): Promise<void> {
  try {
    const text = await liveText(path)
    const ticket = await window.cnMenu.pickPdf(titleOf(path))
    if (ticket === null) return
    const host = document.createElement('div')
    host.id = 'cn-print'
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      flushSync(() =>
        root.render(
          <article className="cn-print-doc">
            <Markdown text={printBody(text, titleOf(path))} img={(url, embed) => (embed ? embedImageSrc(path, url) : imageSrc(path, url))} />
          </article>,
        ),
      )
      await imagesReady(host)
      await document.fonts.ready
      const saved = await window.cnMenu.printPdf(ticket)
      app().notice(t('已导出 PDF：{name}', { name: saved.split('/').pop()! }), 'check')
    } finally {
      root.unmount()
      host.remove()
    }
  } catch (e) {
    app().notice(t('导出 PDF 没成功：{why}', { why: errText(e) }))
  }
}

export async function exportMd(path: string): Promise<void> {
  try {
    const r = await window.cnMenu.exportMd(path, await liveText(path))
    if (r) app().notice(t('已导出为 Markdown：{name}', { name: r.dir.split('/').pop()! }), 'check')
  } catch (e) {
    app().notice(t('导出 Markdown 没成功：{why}', { why: errText(e) }))
  }
}

/** 菜单里的两项；board：这一页正用白板看 */
export function exportItems(path: string, board = false): MenuEntry[] {
  const no = board || app().exportBlocked(path)
  const tip = no ? t('白板 / 数据库暂不支持导出') : undefined
  return [
    { label: t('导出 PDF…'), enabled: !no, ...(tip ? { tip } : {}), run: () => exportPdf(path) },
    { label: t('导出为 Markdown…'), enabled: !no, ...(tip ? { tip } : {}), run: () => exportMd(path) },
  ]
}
