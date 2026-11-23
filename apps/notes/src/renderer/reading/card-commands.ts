/**
 * ⌘K 里出卡的几条（task-tz7y3，原型 proto.html#dir=b 的 palette）：「出卡：Lecture05 没送的 · 6问」「出卡：这门课 ecp 没送的 · 8问」
 * 「设置 › 读PDF › 出卡」；打「我的疑惑」时一条说那一页拿掉了、问过的在哪（自己一组「以前的「我的疑惑」」），回车开这份 PDF 的「只看我问的」。
 * 名字、默认在哪组照命令表（shared/cmd-table.ts）；打 anki、卡也搜得到（kw）。
 */
import { keyDef } from '../../shared/cmd-table'
import type { CardScope } from '../../shared/reading'
import type { PaletteCommand } from '../Palette'
import { usePrefs } from '../settings-store'
import { openCards, showAsked, unsentOf, useCardsView } from './cards-store'
import { t } from '../../shared/i18n'
import { catName } from '../../shared/categories'

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 「课程/<课>」开头：分类文件夹照这个库磁盘上的名字（英文库是 Courses） */
const coursePrefix = () => `^${esc(catName('课程'))}/[^/]+`
/** 一门课的根：课程/<课>/… 是 课程/<课>，别的是 PDF 所在的文件夹 */
const courseFolder = (pdf: string) => new RegExp(`(${coursePrefix()})/`).exec(pdf)?.[1] ?? dirOf(pdf)

export function useCardCommands(o: { pdf: string | null; folder?: string | null; openNotes(pdf: string): void; openSettings(): void }): PaletteCommand[] {
  const sides = usePrefs((s) => s.pdf.ankiSides)
  const pdf = o.pdf && /\.pdf$/i.test(o.pdf) ? o.pdf : null
  // 这门课：开着课程首页就是它，不然是正在读（最近读）的那份 PDF 的课
  const home = o.folder && new RegExp(coursePrefix()).exec(o.folder)?.[0]
  const folder = home || (pdf ? courseFolder(pdf) : null)
  const pdfView = useCardsView(pdf ? { kind: 'pdf', pdf } : null)
  const courseView = useCardsView(folder !== null ? { kind: 'folder', folder } : null)
  const C = (id: string, name: string, hint: string, run: () => void, scope?: CardScope): PaletteCommand => {
    const d = keyDef(id)!
    return { id, name, hint, icon: 'symbol-event', ai: 'cards', home: d.home, kw: 'anki 出卡 卡片 送进Anki', run: () => (scope ? openCards(scope) : run()) }
  }
  const out: PaletteCommand[] = []
  if (pdf) out.push(C('cards-pdf', t('出卡：{name} 没送的', { name: stem(pdf) }), t('{n}问', { n: unsentOf(pdfView, sides).length }), () => undefined, { kind: 'pdf', pdf }))
  if (folder !== null) out.push(C('cards-course', t('出卡：这门课 {name} 没送的', { name: folder.split('/').pop() || t('库的根目录') }), t('{n}问', { n: unsentOf(courseView, sides).length }), () => undefined, { kind: 'folder', folder }))
  out.push({ ...C('cards-settings', t('设置 › 读PDF › 出卡'), '', o.openSettings), icon: 'settings-gear', ai: undefined })
  // 打「我的疑惑」：那一页拿掉了，说一句问过的在哪；回车开这份 PDF 的「只看我问的」
  out.push({
    id: 'doubts-gone',
    name: t('这一页拿掉了：问过的在每份PDF的笔记「只看我问的」里'),
    icon: 'info',
    searchOnly: true,
    kw: '我的疑惑 疑惑',
    aside: t('以前的「我的疑惑」'),
    run: () => {
      if (!pdf) return
      o.openNotes(pdf)
      showAsked(pdf)
    },
  })
  return out
}
