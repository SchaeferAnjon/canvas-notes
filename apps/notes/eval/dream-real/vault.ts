/**
 * 读一个 Obsidian 式的库：每篇的标题、给 AI 看的干净正文、[[双链]] 图。只读，不往库里写任何东西。
 * 干净正文：去掉 frontmatter（标签留成一行「标签：…」）、注释、图片、网址；整行几乎只有链接的（「相关」「See also」那种列表）整行去掉，
 * 标题像「相关 / Related / Siblings」的整节去掉；正文里剩下的 [[名字|别名]] 换成别名。这样评测时拿掉一条链接，正文里不会再露出它。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface Note {
  path: string
  title: string
  raw: string
  /** 被这篇链到的笔记（路径），不含自己 */
  out: Set<string>
}

const LINK = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g

/** 这些节是链接列表，不是正文 */
const LINK_SECTION =
  /^#{1,6}\s*(?:\d+[.、]\s*)?(?:[^\p{L}\p{N}]\s*)?(related|相关|see also|siblings|同层|parent|父笔记|children|子笔记|cross-?ref|关联|与.{0,20}的关系|延伸阅读|backlinks?|反向链接|链接|导航|上一篇|下一篇|prev|next)/iu

export function readVault(root: string, skipDirs: string[] = ['.obsidian', '.git', '.trash']): Map<string, Note> {
  const notes = new Map<string, Note>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') && skipDirs.includes(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) {
        const rel = relative(root, p)
        notes.set(rel, { path: rel, title: e.name.slice(0, -3), raw: readFileSync(p, 'utf8'), out: new Set() })
      }
    }
  }
  walk(root)
  // [[名字]] 认文件名（Obsidian 默认）；同名的几篇（各个项目都有的 CLAUDE、process、style-guide）先认写出来的路径，再认离得最近的
  const byName = new Map<string, string[]>()
  for (const n of notes.values()) byName.set(n.title, [...(byName.get(n.title) ?? []), n.path])
  for (const n of notes.values())
    for (const m of n.raw.matchAll(LINK)) {
      if (m[0].startsWith('!')) continue
      const target = resolveLink(m[1]!, n.path, byName)
      if (target && target !== n.path) n.out.add(target)
    }
  return notes
}

function resolveLink(name: string, from: string, byName: Map<string, string[]>): string | undefined {
  const written = name.trim().replace(/\.md$/i, '')
  const all = byName.get(written.split('/').pop()!)
  if (!all || all.length < 2) return all?.[0]
  if (written.includes('/')) {
    const hit = all.find((p) => p.replace(/\.md$/i, '').endsWith(written))
    if (hit) return hit
  }
  const shared = (p: string) => {
    const a = p.split('/')
    const b = from.split('/')
    let i = 0
    while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++
    return i
  }
  return [...all].sort((x, y) => shared(y) - shared(x) || x.length - y.length)[0]
}

/** 这一行链到了 names 里的哪一篇（按标题认） */
function lineLinksTo(line: string, titles: Set<string>): boolean {
  for (const m of line.matchAll(LINK)) {
    const base = m[1]!.trim().replace(/\.md$/i, '').split('/').pop()!
    if (titles.has(base)) return true
  }
  return false
}

/**
 * 给 AI 和向量看的正文。hide：这几篇的标题，提到它们的链接所在的整行去掉（评测时拿掉 A↔B 那条链接）。
 */
export function cleanText(raw: string, hide: Set<string> = new Set()): string {
  let body = raw.replace(/^﻿?/, '')
  let tags = ''
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  if (fm) {
    body = body.slice(fm[0].length)
    tags = tagsOf(fm[1]!)
  }
  const out: string[] = []
  let skipLevel = 0
  let fence = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,6})\s/.exec(line)
    if (h) {
      const level = h[1]!.length
      if (skipLevel && level > skipLevel) continue
      skipLevel = LINK_SECTION.test(line) ? level : 0
      if (skipLevel) continue
    } else if (skipLevel) continue
    if (hide.size && lineLinksTo(line, hide)) continue
    // 整行几乎只有链接：列表里的「- [[X]]」「[[A]] · [[B]]」
    const links = [...line.matchAll(LINK)]
    if (links.length) {
      const rest = line.replace(LINK, '').replace(/[\s\-*+>|·•,，、:：;；()（）[\]【】—–]+/g, '')
      if (rest.length < 12) continue
    }
    out.push(line)
  }
  const text = out
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(LINK, (_m, name: string, alias?: string) => (alias?.trim() || name.trim().split('/').pop()!.replace(/\.md$/i, '')))
    .replace(/\[([^\]]*)\]\((?:https?:|\.|\/)[^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return tags ? `标签：${tags}\n${text}` : text
}

function tagsOf(fm: string): string {
  const inline = /^tags:\s*\[(.*)\]\s*$/m.exec(fm)
  if (inline) return inline[1]!.replace(/["']/g, '').split(',').map((s) => s.trim()).filter(Boolean).join('、')
  const block = /^tags:\s*\n((?:\s*-\s*.*\n?)+)/m.exec(fm)
  if (block) return block[1]!.split('\n').map((s) => s.replace(/^\s*-\s*/, '').replace(/["']/g, '').trim()).filter(Boolean).join('、')
  const one = /^tags:\s*(\S.*)$/m.exec(fm)
  return one ? one[1]!.replace(/["']/g, '').trim() : ''
}

/** 入链数 */
export function inDegree(notes: Map<string, Note>): Map<string, number> {
  const d = new Map<string, number>()
  for (const n of notes.values()) for (const q of n.out) d.set(q, (d.get(q) ?? 0) + 1)
  return d
}

/** 两篇之间（不论方向）有没有直接链着 */
export function linked(notes: Map<string, Note>, a: string, b: string): boolean {
  return !!(notes.get(a)?.out.has(b) || notes.get(b)?.out.has(a))
}

/** 不论方向的邻居 */
export function neighbors(notes: Map<string, Note>): Map<string, Set<string>> {
  const nb = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    let s = nb.get(a)
    if (!s) nb.set(a, (s = new Set()))
    s.add(b)
  }
  for (const n of notes.values())
    for (const q of n.out) {
      add(n.path, q)
      add(q, n.path)
    }
  return nb
}
