/**
 * 写进文件的旁支（`> [!side]` 挂在 `> [!ai]` 讲解下面）几处共用的：文档里的讲解块（doc-side.tsx）、白板上的 AI 讲解卡、
 * 网页视频框一块问的问框（file-side.tsx，task-p90ra）。问的是同一个 ai:side、同一个旁支编号（这篇、那一句、第一问），
 * 所以在哪开、在哪接着问都是同一条旁支；改过的名字记在这台 Mac 上，三处一样。
 */
import { aiBodyOf, type DocAiBlock, docAiBlocks, foldQuote, locateQuote, sideInsert } from '@cn/format'
import type { AiPick } from '../../shared/ai-features'
import type { Material } from '../../shared/materials'
import { imageNames } from '../../shared/materials'

/** 一个字符串的短指纹（旁支编号：这篇、那一句、第一问定下来，主进程按它记旁支自己的会话） */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// ---------------------------------------------------------------- 改过的名字：记在这台 Mac 上（同读 PDF 的旁支，名字记在对话记录里、不写进文件）

const NAMES = 'cn.docSideNames'
/** 认一条旁支：这篇、那一句、第一问（文件里写着的就这三样） */
const nameKey = (path: string, quote: string, first: string) => `${path}\n${foldQuote(quote)}\n${first.trim()}`
const readNames = (): Record<string, string> => JSON.parse(localStorage.getItem(NAMES) ?? '{}') as Record<string, string>
export const nameOf = (path: string, quote: string, first: string | undefined) => (first ? readNames()[nameKey(path, quote, first)] : undefined)
export function setName(path: string, quote: string, first: string, name: string) {
  const all = readNames()
  const k = nameKey(path, quote, first)
  if (name.trim()) all[k] = name.trim()
  else delete all[k]
  localStorage.setItem(NAMES, JSON.stringify(all))
}

/** 接着问的是哪一条：那一句 + 它的第一问（写的时候按它找，不按第几条）；新开的一条是 null */
export type SideTarget = { quote: string; first: string } | null

/** 写到第几条：接着问的按那一句和第一问找回那一条（找不到就当新开一条），新开的写在最后面 */
export function sideIndex(blk: DocAiBlock, target: SideTarget): number {
  const i = target ? blk.sides.findIndex((x) => x.quote === target.quote && x.turns[0]?.q === target.first) : -1
  return i >= 0 ? i : blk.sides.length
}

/** 这一块讲解在文字里还在哪：先按原来那一行（还找得到那一句），再按那一句找 */
export function blockAgain(text: string, headLine: number | null, quote: string): DocAiBlock | null {
  const blocks = docAiBlocks(text)
  return (headLine !== null ? blocks.find((x) => x.head === headLine && locateQuote(text, x, quote)) : undefined) ?? blocks.find((x) => locateQuote(text, x, quote)) ?? null
}

/** 认一块讲解：头一行、正文第一行的原文，和当时在第几行（白板卡、问框按它找回那一块，文字被改过也认得） */
export interface AiBlockSig {
  head: string
  first: string
  line: number
}

export function aiBlockSig(text: string, b: DocAiBlock): AiBlockSig {
  const lines = text.split('\n')
  return { head: lines[b.head] ?? '', first: lines[b.head + 1] ?? '', line: b.head }
}

/** 按头一行和正文第一行找回那一块讲解（一样的几块里挑离原来那一行最近的） */
export function findAiBlock(text: string, sig: AiBlockSig): DocAiBlock | null {
  const lines = text.split('\n')
  const same = docAiBlocks(text).filter((b) => lines[b.head] === sig.head && (lines[b.head + 1] ?? '') === sig.first)
  return same.sort((a, b) => Math.abs(a.head - sig.line) - Math.abs(b.head - sig.line))[0] ?? null
}

/**
 * 编辑器没开着这篇：照文件现在的样子写进去（先比后写，和编辑器存盘同一个接口）。
 * was 是问之前看到的文字（没有就直接读文件）；被别处改过时按那一句找回同一块讲解再写；找不到就算了（回答在 AI 的会话里还在）
 */
export async function writeOnDisk(path: string, was: string | null, find: (text: string) => DocAiBlock | null, turn: { q: string; a: string }, quote: string, target: SideTarget): Promise<boolean> {
  const bases = was === null ? [null] : [was, null]
  for (const b of bases) {
    const base = b ?? (await window.cn.readNote(path)).text
    const blk = find(base)
    if (!blk) return false
    const ins = sideInsert(base, blk, sideIndex(blk, target), turn, quote)
    const r = await window.cn.writeNote(path, base.slice(0, ins.at) + ins.insert + base.slice(ins.at), base)
    if (r.ok) return true
  }
  return false
}

/**
 * 问一句：交给 ai:side。讲解块没有会话可分叉：新会话，那段讲解（和这条旁支已经问过的）放在第一问前面；
 * lead 是讲解前面的话（视频框一块问时他当时问的那一句）。sid 只看这篇、那一句、第一问，哪儿开的都是同一条旁支的会话
 */
export async function askSide(o: {
  id: number
  path: string
  title: string
  text: string
  block: DocAiBlock
  quote: string
  q: string
  done: { q: string; a: string }[]
  lead?: string
  /** 没写进文件的讲解（问框只问不记）：直接给原文 */
  body?: string
  where: string
  mats: Material[]
  how: { engine: AiPick['engine']; req: { model?: string; effort?: string } }
}): Promise<{ text: string; error?: string }> {
  const history = [
    `【那段讲解】（${o.where}）${o.lead ? `\n${o.lead}` : ''}\n${o.body ?? aiBodyOf(o.text, o.block)}`,
    ...(o.done.length ? [`【这条旁支问过的】\n${o.done.map((t) => `他问：${t.q}\n你答：${t.a.slice(0, 2000)}`).join('\n')}`] : []),
  ].join('\n\n')
  const sid = 'd-' + hash(`${o.path}\n${o.quote}\n${o.done[0]?.q ?? o.q}`)
  const pasted = imageNames(o.mats)
  try {
    return await window.cn.aiSide({
      id: o.id,
      engine: o.how.engine,
      place: { key: `file:${o.path}`, label: o.title },
      text: o.q,
      side: { id: sid, quote: o.quote, history, fresh: true, where: o.where },
      context: { tab: { type: 'note', title: o.title, path: o.path, mode: 'doc' }, web: { open: false, url: null } },
      ...o.how.req,
      ...(pasted.length ? { pasted } : {}),
      ...(o.mats.length ? { mats: o.mats } : {}),
    })
  } catch (e) {
    return { text: '', error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  }
}
