/**
 * 我的疑惑（主进程）：一个文件夹里各篇读 PDF 笔记问过的地方汇成清单；哪几条送过 Anki 记在库里 .canvas-notes/anki.json（跟着 Git 走）；
 * 每次记笔记、送 Anki 后重写 <文件夹>/我的疑惑.md。
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { courseOf, type DoubtItem, doubtItems, DOUBTS_NAME, doubtsNote, lectureOf, notePathFor, parseReadingNote, prop } from '@cn/format'
import type { Vault } from '../vault'

export const ANKI_STATE = '.canvas-notes/anki.json'

export interface AnkiState {
  /** 送过的：那一段的身份 → 送的时间 */
  sent: Record<string, string>
  /** 「知识」牌组在 Anki 里的 id（改了名也认得） */
  deckId?: number
}

export async function readAnkiState(v: Vault): Promise<AnkiState> {
  try {
    const j = JSON.parse(await readFile(v.abs(ANKI_STATE), 'utf8')) as Partial<AnkiState>
    return { sent: j.sent && typeof j.sent === 'object' ? j.sent : {}, ...(typeof j.deckId === 'number' ? { deckId: j.deckId } : {}) }
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

/** 这个文件夹（只看这一层）里每份 PDF 的笔记里问过的：新格式一问一条（原话，主问题 + 旁支问题），以前的笔记一处一条 */
export async function collectDoubts(v: Vault, folder: string): Promise<DoubtItem[]> {
  const out: DoubtItem[] = []
  let names: string[]
  try {
    names = await readdir(folder ? v.abs(folder) : v.root)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  for (const name of names.filter((n) => /\.pdf$/i.test(n)).sort()) {
    const pdf = folder ? `${folder}/${name}` : name
    const note = notePathFor(pdf)
    let text: string
    try {
      text = (await v.read(note)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const lec = Number(prop(text, '第几讲'))
    const lecture = Number.isFinite(lec) && lec > 0 ? lec : lectureOf(pdf)
    for (const section of parseReadingNote(text, note)) out.push(...doubtItems(pdf, section, lecture))
  }
  return out
}

/** 重写 <文件夹>/我的疑惑.md；没有一条就不建。返回写了的路径（没变就是 null） */
export async function writeDoubtsNote(v: Vault, folder: string): Promise<string | null> {
  const items = await collectDoubts(v, folder)
  if (!items.length) return null
  const path = folder ? `${folder}/${DOUBTS_NAME}` : DOUBTS_NAME
  const sent = new Set(Object.keys((await readAnkiState(v)).sent))
  const next = doubtsNote(folder, courseName(folder), items, sent)
  let cur: string | null = null
  try {
    cur = (await v.read(path)).text
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  if (cur === next) return null
  const w = await v.write(path, next, cur ?? '')
  if (!w.ok) throw new Error('我的疑惑.md 刚被改过，下次记笔记时再更新')
  return path
}

