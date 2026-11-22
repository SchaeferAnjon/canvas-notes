/**
 * 配成一对、解除、改范围、点笔记时网页跟着开（task-kbnc0 方向 A）。属性写在笔记开头 `read-along: <网址前缀>`：
 * 笔记开着就改编辑器里的字（能 ⌘Z、自动保存），没开就先比后写文件。别的一个字不动（rule1：打开再保存不变）。
 * 软件别处（底栏提示、右栏网页）由 App 交进来（setReadAlongHost）。
 */
import { setProp } from '@cn/format'
import type { CodiconName } from '@cn/design'
import { NoteDoc } from '../note-doc'
import { bookPrefix, inBook, type PagePos, READ_ALONG_KEY, stripHash } from '../../shared/read-along'
import { headOf, pairOf, positionOf, recordPos, setPairNow } from './store'
import type { Went } from './web'

/** 要右栏网页开到一本书的哪里 */
export interface BookRequest {
  seq: number
  book: string
  /** 要开的网址：读到的那一页；还没读过是书的开头 */
  url: string
  /** 回到的那一段；null 是只开网页 */
  pos: PagePos | null
  /** 那段亮 1.6 秒 */
  flash: boolean
  /** 从头读：滚到最上面 */
  top?: boolean
  /** 回到选中的那几句（task-6cxtc，笔记里「↩」、右栏「笔记」里点一条）：在每一段里面找它，只亮那几句 */
  quote?: string
  done?(how: Went['how']): void
}

export interface ReadAlongHost {
  notice(text: string, opts?: { undo?: () => void; act?: { label: string; icon: CodiconName; run(): void } }): void
  /** 收掉底栏那一句（那段找不到、浮了「上次那段找不到了」时，前一句「回到了…」不能还挂着） */
  quiet(): void
  /** 右栏开一本书（网页标签开着就用它，没开就新开），回到那一段 */
  openBook(req: Omit<BookRequest, 'seq'>): void
  /** 右栏前面那个网页现在读到哪（网页里量的） */
  pageNow(): Promise<PagePos | null>
  /** 笔记的属性改了：重新列一遍笔记 */
  refresh(): void
}

let host: ReadAlongHost | null = null
export const setReadAlongHost = (h: ReadAlongHost) => void (host = h)
const H = () => {
  if (!host) throw new Error('软件还没准备好')
  return host
}

/** 属性整段都空了（配对时新加的那段 frontmatter）：连「---」一起拿掉，文件回到配对以前的样子 */
const dropEmptyFm = (t: string) => (t.startsWith('---\n---\n') ? t.slice(8) : t === '---\n---' ? '' : t)

/** 改这篇的 read-along：开着就改编辑器，没开就先比后写 */
async function writeBook(path: string, book: string | undefined): Promise<void> {
  const d = [...NoteDoc.open].find((x) => x.path === path)
  if (d) {
    if (d.readOnly) throw new Error('这篇是只读的，改不了属性')
    const next = book === undefined ? dropEmptyFm(setProp(d.text, READ_ALONG_KEY, undefined)) : setProp(d.text, READ_ALONG_KEY, book)
    if (next !== d.text) d.setText(next)
    await d.save()
    return
  }
  const note = await window.cn.readNote(path)
  if (note.readOnly) throw new Error('这篇是只读的，改不了属性')
  const next = book === undefined ? dropEmptyFm(setProp(note.text, READ_ALONG_KEY, undefined)) : setProp(note.text, READ_ALONG_KEY, book)
  if (next === note.text) return
  const r = await window.cn.writeNote(path, next, note.text)
  if (!r.ok) throw new Error('这篇刚在别处改过，没写上，再试一次')
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export { bookName, headOf } from './store'

/** 配成一对：写属性，记下右栏这一页现在读到哪；底栏能撤回 */
export async function pairNote(note: string, book: string): Promise<void> {
  const h = H()
  try {
    await writeBook(note, book)
  } catch (e) {
    return h.notice(errText(e))
  }
  setPairNow(note, book)
  h.refresh()
  const now = await h.pageNow().catch(() => null)
  if (now && inBook(book, now.url)) recordPos(book, now)
  h.notice('配成一对了：点开这篇，网页跟着开到读到的那段', { undo: () => void unpairNote(note) })
}

/** 解除：属性那一行删掉（读到哪留在库里，再配上接着读）；底栏能撤回 */
export async function unpairNote(note: string): Promise<void> {
  const h = H()
  const was = pairOf(note)
  try {
    await writeBook(note, undefined)
  } catch (e) {
    return h.notice(errText(e))
  }
  setPairNow(note, null)
  h.refresh()
  h.notice('不再一起开了：属性「对着看」删掉了', {
    undo: () =>
      void (async () => {
        if (!was) return
        await writeBook(note, was)
        setPairNow(note, was)
        h.refresh()
        h.notice('配对回来了')
      })().catch((e) => h.notice(errText(e))),
  })
}

/** 整本书 ↔ 只这一页：换属性的值，读到哪跟到新的值下面 */
export async function rescopeNote(note: string, whole: boolean): Promise<void> {
  const h = H()
  const book = pairOf(note)
  if (!book) return
  const pos = positionOf(book)
  const next = whole ? bookPrefix(pos?.url ?? book) : stripHash(pos?.url ?? book)
  try {
    await writeBook(note, next)
  } catch (e) {
    return h.notice(errText(e))
  }
  setPairNow(note, next)
  if (pos && inBook(next, pos.url)) recordPos(next, pos)
  h.refresh()
  h.notice(whole ? '改成整本书：换章也算' : '改成只配这一页')
}

/**
 * 点开配好对的笔记：网页跟着在右栏开到上次读到的那段、亮一下，底栏说一句回到了哪；还没读过开在书的开头。
 * 返回这篇有没有配对
 */
export function followNote(note: string, who = '网页跟着开了'): boolean {
  const book = pairOf(note)
  if (!book || !host) return false
  const pos = positionOf(book)
  const usable = pos && inBook(book, pos.url) ? pos : null
  host.openBook({
    book,
    url: usable?.url ?? book,
    pos: usable,
    flash: true,
    done: (how) => {
      if (usable && (how === 'exact' || how === 'fuzzy')) host?.notice(`${who}：回到上次读到的「${headOf(usable)}」那段`)
      else if (how === 'ratio') host?.quiet()
    },
  })
  return true
}

/** 从头读：开书的开头、滚到最上面 */
export function readFromStart(note: string) {
  const book = pairOf(note)
  if (!book || !host) return
  host.openBook({ book, url: book, pos: null, flash: false, top: true })
}
