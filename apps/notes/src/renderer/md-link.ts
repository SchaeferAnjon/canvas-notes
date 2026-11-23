/**
 * 文档里的一段 [字](网址)：在哪、字和网址各在哪（链接卡的改链接、去掉链接，右键菜单用）；卡上那一行网址怎么写。
 * 纯函数，不碰 DOM（右键菜单的单元测试也载它）。
 */
import { t } from '../shared/i18n'

/** 一行里的 [字](网址)（! 开头的是图，不算） */
const MD_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g

export interface MdLink {
  /** 整段 [字](网址) 在文档里的位置 */
  from: number
  to: number
  text: string
  url: string
  /** 网址那几个字的位置（改链接只换它） */
  urlFrom: number
  urlTo: number
}

/** 文档里 pos 这个位置上的 [字](网址)；不在链接上给 null */
export function mdLinkAt(doc: { lineAt(pos: number): { from: number; text: string } }, pos: number): MdLink | null {
  const line = doc.lineAt(pos)
  const at = pos - line.from
  MD_LINK.lastIndex = 0
  for (let m = MD_LINK.exec(line.text); m; m = MD_LINK.exec(line.text)) {
    if (m[1] || at < m.index || at > m.index + m[0].length) continue
    const urlAt = m[0].indexOf(m[3]!, m[2]!.length + 2)
    return { from: line.from + m.index, to: line.from + m.index + m[0].length, text: m[2]!, url: m[3]!, urlFrom: line.from + m.index + urlAt, urlTo: line.from + m.index + urlAt + m[3]!.length }
  }
  return null
}

/** 卡上那一行网址：不写 https:// 和 www.，中文解码，去掉末尾的 /；微信读书的书写「微信读书」 */
export function prettyUrl(url: string): string {
  if (/^weread:/i.test(url)) return t('微信读书')
  let s = url
  try {
    s = decodeURI(url)
  } catch {
    // 解不开就照原样
  }
  return s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}
