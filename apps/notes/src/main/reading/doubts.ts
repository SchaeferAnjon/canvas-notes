/**
 * 我的疑惑（主进程）：一个文件夹里各篇读 PDF 笔记问过的地方汇成清单（中间栏「我的疑惑」、课程首页的组件、送 Anki 都读它）；
 * 哪几条送过 Anki 记在库里 .canvas-notes/anki.json（跟着 Git 走）。看视频时框一块问的在文档里的问答块（collectVideoDoubts）。
 * 2026-11-20 起「我的疑惑」不再是文件：不写 <文件夹>/我的疑惑.md、视频里的疑惑.md，都直接读各篇笔记（老库打开时整理一次，tidy-notes.ts）
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { courseOf, decodeNote, type DoubtItem, doubtItems, lectureOf, notePathFor, parseReadingNote, prop } from '@cn/format'
import type { VideoDoubt } from '../../shared/reading'
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

/** 一门课的根：在 课程/<课>/ 下面（PDF 可能在课里的子文件夹）就是 课程/<课>，别的就是这个文件夹自己 */
function courseRoot(folder: string): string {
  const m = /^(课程\/[^/]+)(?:\/|$)/.exec(folder)
  return m ? m[1]! : folder
}

/** 一篇文档里看视频框一块问的问答块（main/video/index.ts 写的那几行）：问题原话、回答开头一段、视频名、时间、在第几行 */
export function videoDoubtsIn(doc: string, text: string): VideoDoubt[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: VideoDoubt[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^<!--\s*moment-ask\b/.test(lines[i]!)) continue
    let title = ''
    let time = ''
    let url = ''
    let question = ''
    let answer = ''
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const l = lines[j]!
      const link = /^\[▶ ([\d:]+) · (.*)\]\(([^)]+)\)\s*$/.exec(l)
      if (link) ((time = link[1]!), (title = link[2]!.trim()), (url = link[3]!))
      const q = /^>\s*\*\*我的疑惑\*\*：(.*)$/.exec(l)
      if (q) question = q[1]!.trim()
      if (/^>\s*\[!ai\]/.test(l)) {
        const body: string[] = []
        for (let k = j + 1; k < lines.length && /^>/.test(lines[k]!); k++) body.push(lines[k]!.replace(/^>\s?/, ''))
        answer = (body.join('\n').split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim()
        break
      }
    }
    if (question) out.push({ doc, line: i + 1, time, title, url, question, answer })
  }
  return out
}

/** 一门课（folder 所在的那门课，不在课程里就是这个文件夹）里每篇文档看视频时框一块问的，按文档名、行排 */
export async function collectVideoDoubts(v: Vault, folder: string): Promise<VideoDoubt[]> {
  const root = courseRoot(folder)
  if (!root) return []
  const out: VideoDoubt[] = []
  const walk = async (dir: string) => {
    let ents
    try {
      ents = await readdir(v.abs(dir), { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const ent of ents.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
      if (ent.name.startsWith('.')) continue
      const p = `${dir}/${ent.name}`
      if (ent.isDirectory()) await walk(p)
      else if (ent.isFile() && /\.md$/i.test(ent.name)) {
        const text = decodeNote(await readFile(v.abs(p))).text
        if (text.includes('moment-ask')) out.push(...videoDoubtsIn(p, text))
      }
    }
  }
  await walk(root)
  return out
}
