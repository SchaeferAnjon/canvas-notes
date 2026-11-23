/**
 * 读 PDF 时问过的（主进程）：各篇读 PDF 笔记里问过的每一问（出卡、课程首页「读PDF时问过的」都读它）；
 * 哪几问送过 Anki、送进去的是什么字记在库里 .canvas-notes/anki.json（跟着 Git 走）。
 * 2026-11-20 起「我的疑惑」不再是文件，2026-11-22 起那一页也拿掉了（task-tz7y3）：问过的就在每篇笔记里，从笔记直接出卡。
 * collectDoubts（只看一层）留给老库整理（tidy-notes.ts）核对以前软件写的「我的疑惑.md」改没改过。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type CardText, courseOf, type DoubtItem, doubtItems, lectureOf, notePathFor, parseReadingNote, prop } from '@cn/format'
import type { CardScope } from '../../shared/reading'
import type { Vault } from '../vault'

export const ANKI_STATE = '.canvas-notes/anki.json'

/** 送进去的那张：问题、答案、补充、原文摘句（出卡弹窗里过过的），note 是它在 Anki 里的笔记编号（撤回时删） */
export interface SentCard extends CardText {
  note?: number
}

export interface AnkiState {
  /** 送过的：那一问的身份 → 送的时间 */
  sent: Record<string, string>
  /** 「知识」牌组在 Anki 里的 id（改了名也认得；设置里选了「知识::…」就是那一个） */
  deckId?: number
  /** 送进去的字（2026-11-22 从笔记出卡以后才有；以前从「我的疑惑」页送的没有） */
  cards?: Record<string, SentCard>
}

export async function readAnkiState(v: Vault): Promise<AnkiState> {
  try {
    const j = JSON.parse(await readFile(v.abs(ANKI_STATE), 'utf8')) as Partial<AnkiState>
    return {
      sent: j.sent && typeof j.sent === 'object' ? j.sent : {},
      ...(typeof j.deckId === 'number' ? { deckId: j.deckId } : {}),
      ...(j.cards && typeof j.cards === 'object' ? { cards: j.cards } : {}),
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { sent: {} }
    throw e
  }
}

export async function writeAnkiState(v: Vault, s: AnkiState) {
  await mkdir(dirname(v.abs(ANKI_STATE)), { recursive: true })
  await writeFile(v.abs(ANKI_STATE), JSON.stringify(s, null, 2) + '\n')
}

export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** 文件夹是哪门课：课程/<课>/ 就是课名，别的用文件夹名 */
export function courseName(folder: string): string {
  return courseOf(folder + '/x') ?? (folder.split('/').pop() || '')
}

/** 一份 PDF 的笔记里问过的（新格式一问一条：主问题 + 旁支问题；以前的笔记一处一条）；没有笔记是空的 */
async function askedIn(v: Vault, pdf: string): Promise<DoubtItem[]> {
  const note = notePathFor(pdf)
  let text: string
  try {
    text = (await v.read(note)).text
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const lec = Number(prop(text, '第几讲')) // 不翻：文件里的属性键
  const lecture = Number.isFinite(lec) && lec > 0 ? lec : lectureOf(pdf)
  return parseReadingNote(text, note).flatMap((section) => doubtItems(pdf, section, lecture))
}

/** 这个文件夹（只看这一层）里每份 PDF 的笔记里问过的（老库整理核对以前的「我的疑惑.md」用） */
export async function collectDoubts(v: Vault, folder: string): Promise<DoubtItem[]> {
  let names: string[]
  try {
    names = await readdir(folder ? v.abs(folder) : v.root)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: DoubtItem[] = []
  for (const name of names.filter((n) => /\.pdf$/i.test(n)).sort()) out.push(...(await askedIn(v, folder ? `${folder}/${name}` : name)))
  return out
}

const SKIP = new Set(['node_modules', '附件']) // 不翻：磁盘上的附件文件夹名

/** 一个文件夹和下面所有子文件夹里的 PDF（点开头的、附件/ 不看），按路径排（第 10 讲排在第 3 讲后面） */
async function pdfsUnder(v: Vault, folder: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    let ents
    try {
      ents = await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const ent of ents) {
      if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
      const p = dir ? `${dir}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(p)
      else if (ent.isFile() && /\.pdf$/i.test(ent.name)) out.push(p)
    }
  }
  await walk(folder)
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

/** 出卡的范围里问过的每一问：一份 PDF、一门课（这个文件夹和下面的）、整个库 */
export async function collectAsked(v: Vault, scope: CardScope): Promise<DoubtItem[]> {
  const pdfs = scope.kind === 'pdf' ? [scope.pdf] : await pdfsUnder(v, scope.kind === 'folder' ? scope.folder : '')
  const out: DoubtItem[] = []
  for (const pdf of pdfs) out.push(...(await askedIn(v, pdf)))
  return out
}
