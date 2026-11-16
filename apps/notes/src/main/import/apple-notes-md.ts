/**
 * 备忘录的一条笔记（数据库里 gzip 过的 protobuf）→ md。
 * 结构照 Obsidian Importer（MIT，obsidianmd/obsidian-importer 的 src/formats/apple-notes/）和
 * apple_cloud_notes_parser 摸出来的字段号，代码是我们自己写的：
 *   NoteStoreProto { 2: Document { 2: version, 3: Note { 2: 文字, 5: AttributeRun[] } } }
 *   AttributeRun { 1: 长度（UTF-16）, 2: ParagraphStyle, 5: 粗斜体, 6: 下划线, 7: 删除线, 9: 链接, 12: AttachmentInfo }
 *   ParagraphStyle { 1: 样式（0 标题 1 小标题 2 副标题 4 等宽 100 圆点 101 短横 102 编号 103 勾选清单）, 4: 缩进, 5: Checklist { 2: 勾上 }, 8: 引用 }
 *   AttachmentInfo { 1: 附件 ID, 2: 类型（UTI） }
 * 附件（图片、表格、扫描、手写、链接卡片）由调用方按 ID 查数据库后给出 md（embed）。
 */
import { gunzipSync } from 'node:zlib'
import { Pb } from './protobuf'

export interface NoteRun {
  length: number
  style: number
  indent: number
  done: boolean
  quote: boolean
  /** 1 粗 2 斜 3 粗斜 */
  weight: number
  strike: boolean
  link?: string
  attachment?: { id: string; uti: string }
}

export interface AppleNote {
  text: string
  runs: NoteRun[]
}

export const STYLE = { title: 0, heading: 1, subheading: 2, mono: 4, dotted: 100, dashed: 101, numbered: 102, checkbox: 103 } as const
const LIST = new Set<number>([STYLE.dotted, STYLE.dashed, STYLE.numbered, STYLE.checkbox])

/** 附件在 md 里的样子；block 为 true 的（图片、表格）自己占一行 */
export type Embed = ((id: string, uti: string) => { md: string; block: boolean }) & {
  /** 链到另一条备忘录（applenotes:note/<ID>）：那条的标题，变成 [[标题]] */
  noteTitle?(ident: string): string | null
}

/** 一个 Note 消息（也用在表格的格子里） */
export function readNote(note: Pb): AppleNote {
  return {
    text: note.str(2) ?? '',
    runs: note.msgs(5).map((r) => {
      const p = r.msg(2)
      const a = r.msg(12)
      const run: NoteRun = {
        length: r.int(1) ?? 0,
        style: p?.int(1) ?? -1,
        indent: p?.int(4) ?? 0,
        done: !!p?.msg(5)?.int(2),
        quote: !!p?.int(8),
        weight: r.int(5) ?? 0,
        strike: !!r.int(7),
      }
      const link = r.str(9)
      if (link) run.link = link
      if (a) run.attachment = { id: a.str(1) ?? '', uti: a.str(2) ?? '' }
      return run
    }),
  }
}

/** 数据库 ZICNOTEDATA.ZDATA：gzip 过的 NoteStoreProto */
export function decodeNoteData(gz: Uint8Array): AppleNote {
  const top = Pb.decode(gunzipSync(gz))
  const doc = top.msg(2) ?? top
  const note = doc.msg(3)
  if (!note) throw new Error('这条笔记的数据认不出来')
  return readNote(note)
}

const SOFT = '\u2028'
const OBJ = '\uFFFC'

/** 第一行有字的那行（文件名用） */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.replace(/\uFFFC/g, '').replace(/[\u2028\u2029]/g, ' ').trim())
      .find(Boolean) ?? ''
  )
}

interface Seg {
  text: string
  run: NoteRun
}
interface Line {
  segs: Seg[]
  /** 这一行的段落样式来自哪段 */
  run: NoteRun
  /** 软回车（⇧↩）接着上一行 */
  soft: boolean
}

function splitLines(note: AppleNote): Line[] {
  const lines: Line[] = []
  let cur: Line | null = null
  let at = 0
  const fallback: NoteRun = { length: 0, style: -1, indent: 0, done: false, quote: false, weight: 0, strike: false }
  const push = (soft: boolean, run: NoteRun) => {
    cur = { segs: [], run, soft }
    lines.push(cur)
  }
  const runs = note.runs.length ? note.runs : [{ ...fallback, length: note.text.length }]
  for (const run of runs) {
    const piece = note.text.slice(at, at + run.length)
    at += run.length
    // 按 \n 和软回车切开；样式是整段的，切出来的每行都用这一段的
    for (const part of piece.split(/(\n|\u2028)/)) {
      if (part === '\n' || part === SOFT) {
        if (!cur) push(false, run)
        cur = null
        if (part === SOFT) push(true, run)
        continue
      }
      if (!part) continue
      if (!cur) push(false, run)
      cur!.segs.push({ text: part, run })
    }
  }
  return lines
}

const sameInline = (a: NoteRun, b: NoteRun) => a.weight === b.weight && a.strike === b.strike && a.link === b.link && !a.attachment && !b.attachment

/** 一行里的字：粗体、斜体、删除线、链接；记号包在去掉首尾空格的字上 */
function inline(segs: Seg[], embed: Embed): { text: string; blocks: string[] } {
  const merged: Seg[] = []
  for (const s of segs) {
    const prev = merged[merged.length - 1]
    if (prev && sameInline(prev.run, s.run)) prev.text += s.text
    else merged.push({ ...s })
  }
  let text = ''
  const blocks: string[] = []
  for (const s of merged) {
    if (s.run.attachment) {
      const e = embed(s.run.attachment.id, s.run.attachment.uti)
      if (e.block) blocks.push(e.md)
      else text += e.md
      continue
    }
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text.replace(/\uFFFC/g, ''))!
    let core = m[2]!
    if (core) {
      const mark = s.run.weight === 1 ? '**' : s.run.weight === 2 ? '*' : s.run.weight === 3 ? '***' : ''
      if (mark) core = mark + core + mark
      if (s.run.strike) core = `~~${core}~~`
      const ident = s.run.link && /^applenotes:note\/([-0-9a-fA-F]+)/.exec(s.run.link)?.[1]
      const to = ident ? embed.noteTitle?.(ident) : null
      if (to) core = to === m[2] ? `[[${to}]]` : `[[${to}|${m[2]!.replace(/[[\]|]/g, '')}]]`
      else if (s.run.link && s.run.link !== m[2]) core = `[${core}](${s.run.link.replace(/[()\s]/g, encodeURIComponent)})`
    }
    text += m[1] + core + m[3]
  }
  return { text, blocks }
}

/**
 * 转成 md。omitTitle：第一行是标题（文件名就是它），正文里去掉；只有一行时不去。
 * table：表格的一个格子，换行变 <br>、竖线转义。
 */
export function noteToMarkdown(note: AppleNote, embed: Embed, o: { omitTitle?: boolean; table?: boolean } = {}): string {
  let lines = splitLines(note)
  if (o.omitTitle && !o.table) {
    const i = lines.findIndex((l) => l.segs.some((s) => s.text.replace(OBJ, '').trim()))
    const titleLine = lines[i]
    const rest = lines.slice(i + 1).some((l) => l.segs.length)
    if (titleLine && rest && !titleLine.segs.some((s) => s.run.attachment)) lines = lines.slice(i + 1)
    // 标题下面紧跟的空行也去掉
    while (lines.length && !lines[0]!.segs.length) lines.shift()
  }

  const out: string[] = []
  let code = false
  /** 编号列表每层数到几 */
  let numbers: number[] = []
  for (const line of lines) {
    const st = line.run.style
    if (st === STYLE.mono) {
      if (!code) out.push('```')
      code = true
      out.push(line.segs.map((s) => s.text.replace(/\uFFFC/g, '')).join(''))
      continue
    }
    if (code) {
      out.push('```')
      code = false
    }
    const { text, blocks } = inline(line.segs, embed)
    const quote = line.run.quote ? '> ' : ''
    const tab = '\t'.repeat(Math.max(0, line.run.indent))
    let prefix = ''
    if (line.soft) prefix = LIST.has(st) ? tab + '\t' : ''
    else if (st === STYLE.numbered) {
      numbers = numbers.slice(0, line.run.indent + 1)
      while (numbers.length <= line.run.indent) numbers.push(0)
      numbers[line.run.indent]!++
      prefix = `${tab}${numbers[line.run.indent]}. `
    } else if (st === STYLE.dotted || st === STYLE.dashed) prefix = `${tab}- `
    else if (st === STYLE.checkbox) prefix = `${tab}- [${line.run.done ? 'x' : ' '}] `
    else if (st === STYLE.title) prefix = '# '
    else if (st === STYLE.heading) prefix = '## '
    else if (st === STYLE.subheading) prefix = '### '
    if (!LIST.has(st) && !line.soft) numbers = []
    if (text.trim() || (!blocks.length && prefix && LIST.has(st))) out.push(quote + prefix + text.replace(/\s+$/, ''))
    else if (!blocks.length) out.push(quote.trimEnd())
    for (const b of blocks) out.push('', b, '')
  }
  if (code) out.push('```')

  // 附件前后补的空行别叠成好几行
  let md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (o.table) md = md.replace(/ *\n/g, '<br>').replace(/\|/g, '&#124;')
  return md
}
