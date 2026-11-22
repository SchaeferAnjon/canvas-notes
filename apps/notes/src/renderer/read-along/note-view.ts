/** 一篇笔记标题下「对着看」那一行和提示要的东西（NoteTab 算好交给编辑器，folder-chip.ts 画） */
import { prop } from '@cn/format'
import { inBook, isPairUrl, READ_ALONG_KEY } from '../../shared/read-along'
import type { ReadAlongView } from '../folder-chip'
import { bookName, headOf } from './pairing'
import { hintFor, useCoOpen, useDesks, usePairs, usePositions, useRightPage } from './store'

export function useReadAlongView(path: string, active: boolean, text: string | null): ReadAlongView {
  const pairs = usePairs()
  const positions = usePositions()
  const page = useRightPage()
  const desks = useDesks()
  useCoOpen()
  // 这篇自己开头写着的为准（属性里刚改的当场跟着变）；还没读完文件时看笔记列表
  const own = text === null ? undefined : prop(text, READ_ALONG_KEY)
  const book = isPairUrl(own) ? own : text === null ? pairs.get(path) : undefined
  const pos = book ? positions[book] : undefined
  const chip = book ? { book, title: bookName(book), at: pos && inBook(book, pos.url) ? headOf(pos) : null } : null
  return { chip, hint: active ? hintFor(path, page, book, desks) : null }
}
