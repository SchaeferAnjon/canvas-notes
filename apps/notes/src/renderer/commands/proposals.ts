/**
 * 「先给你看」（task-9womr）：AI 照命令改好的样子先不写进文件，摆在中间栏一个对比标签里（DiffSource kind: proposal），
 * 收下才写进去（一次提交，回答下面能撤回），不要就什么都不动。只在这次打开软件时有（关了软件就没了，文件本来就没动）。
 */
import { useSyncExternalStore } from 'react'
import { goneSections, sectionNames } from '../../shared/cmd-run'
import type { DiffResult } from '../../shared/diff'
import { t } from '../../shared/i18n'

export interface ProposalFile {
  path: string
  /** 改之前（AI 读的那一版）；新建的是 null */
  before: string | null
  after: string
  /** 文件条那句人话（「并进这周那一篇」）；少了整节时写删了哪几节，不用它 */
  note?: string
}

export interface Proposal {
  id: string
  /** 命令名（不带 /） */
  name: string
  /** 举例：「第2讲 预备知识」 */
  title: string
  /** 在哪个地方的对话里跑的：看这个对比标签时 AI 那一格还是那段对话（回答下面也有收下、不要） */
  place: { key: string; label: string }
  files: ProposalFile[]
  /**
   * 要提醒的（task-1l29q）：改整篇的命令改完比原文少了这几节、命令又没说要删。
   * 有它时底下那条红字、铺一层淡红，收下不是实心的（叫「照样收下」），文件条那句人话也是红字
   */
  warn?: { lost: string[] }
  /** 收下：写进去、提交（调用的那一格做） */
  take(): Promise<void>
  drop(): void
}

const all = new Map<string, Proposal>()
let version = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const s of subs) s()
}

export function addProposal(p: Proposal) {
  all.set(p.id, p)
  emit()
}
export const getProposal = (id: string) => all.get(id) ?? null
export function removeProposal(id: string) {
  if (all.delete(id)) emit()
}

export function useProposal(id: string | null): Proposal | null {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return id ? getProposal(id) : null
}

/** 加了几行、删了几行（按行比，够标签上的 +N −N 用） */
function counts(a: string, b: string): { added: number; removed: number } {
  const x = a.split('\n')
  const y = b.split('\n')
  const n = x.length
  const m = y.length
  // 最长公共子序列（一篇笔记几百行，n*m 够快；太长时按集合估）
  if (n * m > 4_000_000) {
    const sx = new Set(x)
    const sy = new Set(y)
    return { added: y.filter((l) => !sx.has(l)).length, removed: x.filter((l) => !sy.has(l)).length }
  }
  const prev = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    let diag = 0
    for (let j = 1; j <= m; j++) {
      const up = prev[j]!
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!)
      diag = up
    }
  }
  const same = prev[m]!
  return { added: m - same, removed: n - same }
}

/** 给对比标签画的样子：左边现在的、右边 AI 改的 */
export function proposalDiff(p: Proposal): DiffResult {
  return {
    // 还没写进去这层意思底下那一条已经说了，标签条右端、文件条不再重复
    note: '',
    left: t('现在'),
    right: t('/{name} 改后', { name: p.name }),
    files: p.files.map((f) => {
      const c = counts(f.before ?? '', f.after)
      // 改完少了整节：文件条那句人话写出来（+N −N 看不出是后面几节整个没了，task-1l29q）
      const gone = f.before !== null ? goneSections(f.before, f.after) : []
      return {
        path: f.path,
        status: f.before === null ? ('new' as const) : ('changed' as const),
        kind: 'md' as const,
        before: f.before,
        after: f.after,
        size: new TextEncoder().encode(f.after).length,
        added: f.before === null ? f.after.split('\n').length : c.added,
        removed: f.before === null ? 0 : c.removed,
        summary: gone.length ? t('删了{n}节：{names}', { n: gone.length, names: sectionNames(gone) }) : (f.note ?? ''),
        ...(gone.length && p.warn ? { warn: true } : {}),
        exists: f.before !== null,
      }
    }),
  }
}
