/**
 * 网页的问答、剪藏写进那篇（task-6cxtc）：中间看得见那篇时插在它的光标处（和以前的剪进文档一样：左边一道竖线 1.6 秒）；
 * 中间收起了、没开着这篇时接在末尾（编辑器里开着就改编辑器，没开着先比后写文件）。返回写在哪、能撤回（只拿掉写进去的那几行，之后打的字不动）。
 */
import { NoteDoc } from '../note-doc'

export interface Wrote {
  path: string
  where: 'cursor' | 'end'
  /** 拿掉写进去的那一段；那段已经被改过、找不到了返回 false */
  undo(): Promise<boolean>
}

/** 两版字的差别（只差一处）：从哪开始、加了什么 */
function addedOf(before: string, after: string): { at: number; text: string } {
  let a = 0
  while (a < before.length && before[a] === after[a]) a++
  let b = 0
  while (b < before.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++
  return { at: a, text: after.slice(a, after.length - b) }
}

/** 拿掉加进去的那一段：原处还是它就拿原处的，挪了位置（前面打了字）找唯一的一处 */
function without(text: string, add: { at: number; text: string }): string | null {
  if (!add.text) return text
  if (text.slice(add.at, add.at + add.text.length) === add.text) return text.slice(0, add.at) + text.slice(add.at + add.text.length)
  const i = text.indexOf(add.text)
  if (i < 0 || text.indexOf(add.text, i + 1) >= 0) return null
  return text.slice(0, i) + text.slice(i + add.text.length)
}

/** 接在一篇末尾：中间空一行，最后留一个换行 */
const appendTo = (text: string, md: string) => (text.trim() ? text.replace(/\s*$/, '') + '\n\n' : text) + md.trimEnd() + '\n'

const openDoc = (path: string) => [...NoteDoc.open].find((d) => d.path === path && !d.readOnly) ?? null

/** 那篇现在的字：开着读编辑器（还没存的字也算），没开着读文件 */
export async function noteText(path: string): Promise<string> {
  const d = [...NoteDoc.open].find((x) => x.path === path)
  if (d) return d.text
  return (await window.cn.readNote(path)).text
}

/**
 * 写进 path：cursor（中间看得见这篇）插在光标处，不然接在末尾；focus：插完光标回到那篇（剪藏是，问答不是：回答是后来才到的）
 */
export async function writeInto(path: string, md: string, o: { cursor: boolean; focus?: boolean }): Promise<Wrote> {
  const d = openDoc(path)
  if (d) {
    const before = d.text
    if (o.cursor) d.insertAtCursor(md, { focus: o.focus === true })
    else d.setText(appendTo(before, md))
    const add = addedOf(before, d.text)
    await d.save()
    return {
      path,
      where: o.cursor ? 'cursor' : 'end',
      async undo() {
        const now = openDoc(path)
        if (now) {
          const next = without(now.text, add)
          if (next === null) return false
          now.setText(next)
          await now.save()
          return true
        }
        return undoOnDisk(path, add)
      },
    }
  }
  for (let i = 0; i < 2; i++) {
    const note = await window.cn.readNote(path)
    if (note.readOnly) throw new Error(`《${path.split('/').pop()?.replace(/\.md$/i, '')}》是只读的，记不进去`)
    const next = appendTo(note.text, md)
    const r = await window.cn.writeNote(path, next, note.text)
    if (!r.ok) continue
    const add = addedOf(note.text, next)
    return { path, where: 'end', undo: () => undoOnDisk(path, add) }
  }
  throw new Error('那篇刚在别处改过，没记进去，再来一次')
}

async function undoOnDisk(path: string, add: { at: number; text: string }): Promise<boolean> {
  const d = openDoc(path)
  if (d) {
    const next = without(d.text, add)
    if (next === null) return false
    d.setText(next)
    await d.save()
    return true
  }
  const note = await window.cn.readNote(path)
  const next = without(note.text, add)
  if (next === null) return false
  const r = await window.cn.writeNote(path, next, note.text)
  return r.ok
}
