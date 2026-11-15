/**
 * 找重复：把整个库读一遍，交给 @cn/format 的 3-gram + MinHash 找讲同一件事的笔记对。
 * 只给建议，不改任何文件。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeNote, findSimilarPairs } from '@cn/format'
import type { DuplicatePair } from '../shared/api'

/** 读库里所有 md（相对路径 → 文字） */
export async function readAll(root: string, paths: string[]): Promise<{ id: string; text: string }[]> {
  return Promise.all(paths.map(async (p) => ({ id: p, text: decodeNote(await readFile(join(root, p))).text })))
}

export function duplicatesOf(docs: { id: string; text: string }[]): DuplicatePair[] {
  return findSimilarPairs(docs).map((p) => ({
    a: p.a,
    b: p.b,
    score: p.score,
    why:
      p.score >= 0.4
        ? `两篇约 ${Math.round(p.score * 100)}% 的字句相同${p.passage ? `，都有「${p.passage}」` : ''}`
        : `短的那篇有 ${Math.round(p.containment * 100)}% 在另一篇里${p.passage ? `，比如「${p.passage}」` : ''}`,
  }))
}
