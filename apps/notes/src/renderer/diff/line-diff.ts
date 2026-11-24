/**
 * 对比按行比（梦游对比滚动）：@codemirror/merge 自己是整篇按字比，对比里默认只比 500 层，
 * 两篇都超过 3 万多字（几千行的读书笔记）时干脆整篇算一处，满屏红绿（用户截图：两边几千行全红全绿，文件条却写「改了 36 处」）；
 * 不设上限按字比又很慢（几千行一次几十毫秒）。这里照 git 的做法：先按整行比出哪几行改了（每行算一个记号，几千行几毫秒），
 * 再只在改了的那几行里按字比（改的字更深一层）。交给 MergeView / unifiedMergeView / Chunk.build 的 diffConfig.override。
 */
import { Change, type DiffConfig, diff, presentableDiff } from '@codemirror/merge'

/** 改了的那几行里按字比：照 @codemirror/merge 默认的深度，两段差太多时退成粗比，不卡 */
const INNER: DiffConfig = { scanLimit: 500 }

/** 第 i 种行的记号：一个字（跳过代理对那一段，@codemirror/merge 不在代理对中间切） */
const mark = (i: number) => String.fromCharCode(i < 0xd800 - 1 ? i + 1 : i + 1 + 0x800)
const MAX_KINDS = 0xffff - 0x800 - 1

export function lineDiff(a: string, b: string): readonly Change[] {
  // 每行连着行尾的换行算（最后一行没有换行的和有换行的算两种，改动的位置才对得上）
  const la = a.split(/(?<=\n)/)
  const lb = b.split(/(?<=\n)/)
  const kinds = new Map<string, number>()
  const enc = (lines: string[]) => {
    let s = ''
    for (const l of lines) {
      let k = kinds.get(l)
      if (k === undefined) kinds.set(l, (k = kinds.size))
      s += mark(k)
    }
    return s
  }
  const ea = enc(la)
  const eb = enc(lb)
  // 不一样的行多到一个字装不下（六万多种）：整篇按字粗比
  if (kinds.size > MAX_KINDS) return presentableDiff(a, b, INNER)
  const starts = (lines: string[]) => {
    const out = [0]
    for (const l of lines) out.push(out[out.length - 1]! + l.length)
    return out
  }
  const sa = starts(la)
  const sb = starts(lb)
  const out: Change[] = []
  for (const c of diff(ea, eb)) {
    let { fromA, toA, fromB, toB } = c
    // 整段加、整段删的以空行开头、后面紧跟的也是这个空行时往下挪一行（git 的做法）：标出来的是「这一段 + 段后空行」，不是「段前空行 + 这一段」
    const blank = (l: string | undefined) => l !== undefined && !l.trim()
    if (fromA === toA) while (toB < lb.length && eb[fromB] === eb[toB] && blank(lb[fromB])) (fromB++, toB++, fromA++, toA++)
    else if (fromB === toB) while (toA < la.length && ea[fromA] === ea[toA] && blank(la[fromA])) (fromA++, toA++, fromB++, toB++)
    // 这几行（连行尾的换行）在原文里的位置
    const at = sa[fromA]!
    const bt = sb[fromB]!
    for (const d of presentableDiff(a.slice(at, sa[toA]), b.slice(bt, sb[toB]), INNER)) out.push(new Change(at + d.fromA, at + d.toA, bt + d.fromB, bt + d.toB))
  }
  return out
}

/** 交给 MergeView、unifiedMergeView、Chunk.build 的 */
export const LINE_DIFF: DiffConfig = { override: lineDiff }
