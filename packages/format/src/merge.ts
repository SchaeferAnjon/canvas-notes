import { diff3Merge, diffPatch } from 'node-diff3'

export interface MergeResult {
  text: string
  /** 两边改了同一处，text 是 local 原样 */
  conflict: boolean
}

/** 按行三方合并：base 是上次读到的磁盘版本，local 是编辑器里的，remote 是磁盘上新的。 */
export function merge3(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { text: local, conflict: false }
  if (local === base) return { text: remote, conflict: false }
  if (remote === base) return { text: local, conflict: false }
  const regions = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'), { excludeFalseConflicts: true })
  const lines: string[] = []
  for (const r of regions) {
    if (r.conflict) return { text: local, conflict: true }
    lines.push(...r.ok!)
  }
  return { text: lines.join('\n'), conflict: false }
}

export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * 把 a 改成 b 的最小一组改动（按行找改动块，块内再去掉相同的头尾），offset 都是相对 a 的。
 * 编辑器按这组改动更新，光标和没动的地方保持原样。
 */
export function textChanges(a: string, b: string): TextChange[] {
  if (a === b) return []
  const al = a.split('\n')
  const bl = b.split('\n')
  const lineStart: number[] = [0]
  for (let i = 0; i < al.length; i++) lineStart.push(lineStart[i]! + al[i]!.length + 1)

  const changes: TextChange[] = []
  for (const p of diffPatch(al, bl)) {
    const { offset: aOff, length: aLen } = p.buffer1
    const { chunk: bChunk } = p.buffer2
    // 改动块在 a 里对应的字符范围；把块后面的换行算进去，插入整行时才对得上
    let from = lineStart[aOff]!
    let to = lineStart[aOff + aLen]!
    let insert = bChunk.map((l) => l + '\n').join('')
    if (to > a.length) {
      // 块一直到最后一行（最后一行后面没有换行）：改用块前面的那个换行
      to = a.length
      insert = (aOff > 0 && bChunk.length ? '\n' : '') + bChunk.join('\n')
      if (aOff > 0) from -= 1
    }
    changes.push(trim({ from, to, insert }, a))
  }
  return changes
}

function trim(c: TextChange, a: string): TextChange {
  let { from, to, insert } = c
  while (from < to && insert.length > 0 && a[from] === insert[0]) {
    from++
    insert = insert.slice(1)
  }
  while (from < to && insert.length > 0 && a[to - 1] === insert[insert.length - 1]) {
    to--
    insert = insert.slice(0, -1)
  }
  return { from, to, insert }
}

export function applyChanges(a: string, changes: TextChange[]): string {
  let out = ''
  let pos = 0
  for (const c of changes) {
    out += a.slice(pos, c.from) + c.insert
    pos = c.to
  }
  return out + a.slice(pos)
}
