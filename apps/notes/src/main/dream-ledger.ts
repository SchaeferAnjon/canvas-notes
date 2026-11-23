/**
 * 梦游判断的进度（task-h7oy8，设计页 2.8「按篇记进度」；用户定 5A「醒来接着做」、6A「每晚封顶」）：
 * - 每一对判过的结果按「判法版本 + 两篇正文的指纹」存着：两篇都没改就不再问 AI，被 ⌘Q、合盖打断后重跑不重复花额度；
 * - 每篇判完记下它当时的指纹（done）：没改过的不再进「要判的」，改过的、新来的才判；
 * - 每晚问了几次 AI（nights）：一晚到上限就停，剩下的下一晚接着；
 * - 你丢掉过的那一对（rejected）以后不再提，你点了「留着」的旧「相关：」行（kept）以后不再复查。
 * 存在软件设置目录（每个库一份 JSON），每判完一篇写一次盘（写到临时文件再换名，断电也不会写坏）。不碰 Electron。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Judgement } from './dream-judge'
import { bodyOf, JUDGE_VERSION } from './dream-judge'

export interface Ledger {
  version: 1
  /** 一对的结果：键是 pairKey */
  pairs: Record<string, Judgement & { at: number }>
  /** 判完的那篇当时的指纹（含判法版本） */
  done: Record<string, string>
  /** 一晚（nightOf）问了几次 AI、判了几篇 */
  nights: Record<string, { asked: number; notes: number }>
  /** 不再建议的一对（无序：a\0b，小的在前） */
  rejected: string[]
  /** 复查过、你点了留着的旧「相关：」（有序：这篇\0目标的名字） */
  kept: string[]
}

export const emptyLedger = (): Ledger => ({ version: 1, pairs: {}, done: {}, nights: {}, rejected: [], kept: [] })

/** 一篇的指纹：只看正文，不算属性和末尾的「相关：」行（收下一条双链不会让这篇重判） */
export function noteFp(text: string): string {
  const body = bodyOf(text)
    .split('\n')
    .filter((l) => !/^\s*相关[：:]/.test(l))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha1').update(body).digest('hex').slice(0, 16)
}

export const pairKey = (a: string, fpA: string, b: string, fpB: string) => createHash('sha1').update([JUDGE_VERSION, a, fpA, b, fpB].join('\0')).digest('hex').slice(0, 20)
export const doneKey = (fp: string) => `${JUDGE_VERSION}:${fp}`
export const undirected = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)

/** 「一晚」：早上 6 点换一天（夜里 23 点开始、1 点还在判的算同一晚） */
export function nightOf(now: Date): string {
  const d = new Date(now.getTime() - 6 * 3600_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function loadLedger(file: string | undefined): Promise<Ledger> {
  if (!file) return emptyLedger()
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<Ledger>
    if (raw?.version !== 1) return emptyLedger()
    return { ...emptyLedger(), ...raw } as Ledger
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger()
    // 手改坏了：从头判（花额度，但不会判错）
    if (e instanceof SyntaxError) return emptyLedger()
    throw e
  }
}

export async function saveLedger(file: string | undefined, l: Ledger): Promise<void> {
  if (!file) return
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(l))
  await rename(tmp, file)
}

/** 一晚最多问几次：今晚已经问了几次，还能问几次 */
export function leftTonight(l: Ledger, now: Date, cap: number): number {
  return Math.max(0, cap - (l.nights[nightOf(now)]?.asked ?? 0))
}

export function countAsk(l: Ledger, now: Date) {
  const k = nightOf(now)
  const n = (l.nights[k] ??= { asked: 0, notes: 0 })
  n.asked++
  n.notes++
  // 只留最近 30 晚
  const keys = Object.keys(l.nights).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - 30))) delete l.nights[old]
}
