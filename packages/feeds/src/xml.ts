/**
 * 宽容的 XML 读法：源和 OPML 常常不规矩（开头有垃圾、标签不闭合、XML 里写 HTML 的 &nbsp;），
 * 用 htmlparser2（MIT）的 xmlMode 读成一棵小树，读不懂的地方尽量保留字而不是报错。
 *
 * - 名字一律小写；带命名空间前缀的按命名空间网址换成固定前缀（content:、dc:、media:、atom:、itunes:、rdf:、yt:），
 *   源里写成 `<c:encoded xmlns:c="http://purl.org/rss/1.0/modules/content/">` 也认成 content:encoded。
 *   Atom 根元素的默认命名空间不加前缀（atom 文档里就是 entry、link）。
 * - 实体自己解：XML 的和 HTML 的都认（&amp; &nbsp; &#20320;），只解一次。CDATA 原样。
 */
import { Parser } from 'htmlparser2'
import { decodeHTML, decodeHTMLAttribute } from 'entities'

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: (XmlNode | string)[]
  parent: XmlNode | null
}

const KNOWN_NS: Record<string, string> = {
  'http://purl.org/rss/1.0/modules/content/': 'content',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://search.yahoo.com/mrss/': 'media',
  'http://search.yahoo.com/mrss': 'media',
  'http://www.w3.org/2005/Atom': 'atom',
  'http://purl.org/atom/ns#': 'atom',
  'http://www.itunes.com/dtds/podcast-1.0.dtd': 'itunes',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://purl.org/rss/1.0/': '',
  'http://www.youtube.com/xml/schemas/2015': 'yt',
  'http://www.w3.org/XML/1998/namespace': 'xml',
}

export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], parent: null }
  let cur = root
  let cdata: string | null = null
  // 每层的前缀表（xmlns:x 声明只在那一层往下有效）
  const nsStack: Record<string, string>[] = [{ xml: 'http://www.w3.org/XML/1998/namespace' }]
  const canon = (raw: string, ns: Record<string, string>): string => {
    const lower = raw.toLowerCase()
    const i = lower.indexOf(':')
    if (i < 0) {
      // 默认命名空间：Atom 里的 atom 元素不加前缀；别的（RSS 1.0）也不加
      return lower
    }
    const prefix = lower.slice(0, i)
    const local = lower.slice(i + 1)
    const uri = ns[prefix]
    if (uri === undefined) return lower
    const known = KNOWN_NS[uri]
    if (known === undefined) return lower
    return known ? `${known}:${local}` : local
  }
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const ns = { ...nsStack[nsStack.length - 1]! }
        for (const [k, v] of Object.entries(attribs)) {
          const lk = k.toLowerCase()
          if (lk.startsWith('xmlns:')) ns[lk.slice(6)] = v.trim()
        }
        nsStack.push(ns)
        const attrs: Record<string, string> = {}
        for (const [k, v] of Object.entries(attribs)) attrs[k.includes(':') && !k.toLowerCase().startsWith('xmlns') ? canon(k, ns) : k.toLowerCase()] = decodeHTMLAttribute(v)
        const node: XmlNode = { name: canon(name, ns), attrs, children: [], parent: cur }
        cur.children.push(node)
        cur = node
      },
      onclosetag() {
        nsStack.pop()
        if (cur.parent) cur = cur.parent
      },
      ontext(data) {
        // CDATA 里的字也从这里进来：原样，不解实体
        if (cdata !== null) cdata += data
        else cur.children.push(decodeHTML(data))
      },
      oncdatastart() {
        cdata = ''
      },
      oncdataend() {
        cur.children.push(cdata ?? '')
        cdata = null
      },
    },
    { xmlMode: true, decodeEntities: false, recognizeCDATA: true },
  )
  parser.parseComplete(text.replace(/^﻿/, ''))
  return root
}

/** 元素里的字（CDATA 原样，实体解过）；碰到 stop 里的子元素不往里读（标签没闭合吞进来的下一条） */
export function textOf(node: XmlNode | undefined, stop: ReadonlySet<string> = STOP): string {
  if (!node) return ''
  let out = ''
  for (const c of node.children) {
    if (typeof c === 'string') out += c
    else if (!stop.has(c.name)) out += textOf(c, stop)
  }
  return out
}
const STOP = new Set(['item', 'entry', 'rdf:li'])

/** 直接子元素里第一个叫这个名字的 */
export const child = (node: XmlNode | undefined, ...names: string[]): XmlNode | undefined => {
  if (!node) return undefined
  for (const n of names) {
    const hit = node.children.find((c): c is XmlNode => typeof c !== 'string' && c.name === n)
    if (hit) return hit
  }
  return undefined
}

export const children = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node ? node.children.filter((c): c is XmlNode => typeof c !== 'string' && c.name === name) : []

/** 所有层里叫这个名字的（不进 skip 里那种元素的里面） */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (typeof c === 'string') continue
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

/** 第一个元素（跳过开头的垃圾字、注释、处理指令） */
export const rootElement = (doc: XmlNode): XmlNode | undefined => doc.children.find((c): c is XmlNode => typeof c !== 'string')
