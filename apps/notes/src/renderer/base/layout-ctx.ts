/**
 * 数据库块要的数据（第三批四块合起来只这一份）：读数据源文件夹和关联连到的文件夹里的每一篇，交给 packages/format 的
 * baseContext 算（这里不另写解析）；外面改了、别处画着的同一个数据库写过（BASE_WROTE）都重读。
 * 表格、看板 / 日历 / 画廊（BaseTable 读一次交给 BaseLayout）、右栏「记录」（RecordPeek）都用 useBaseData；
 * 写之前要盘上最新的字时用 loadBaseCtx。
 * 写一条：FileWrite[] 逐个交给 note:write（带改之前的字，被别处改过就不写）；撤回同样写回去。
 */
import { type BaseCtx, type BaseDoc, type BaseRecord, baseContext, type FileWrite, parseBaseDoc, relatedFolders } from '@cn/format'
import { useEffect, useMemo, useState } from 'react'
import { BASE_WROTE, baseWrote } from './BaseTable'

const inFolder = (p: string, f: string) => /\.md$/i.test(p) && (f === '' || p.startsWith(f + '/'))

/** 这一块要读的文件夹：数据源、关联连到的 */
const foldersOf = (doc: BaseDoc) => [...new Set([doc.folder, ...relatedFolders(doc)].filter((f): f is string => f !== null))]

async function readRecords(folders: string[]): Promise<BaseRecord[]> {
  if (!folders.length) return []
  const files = (await window.cn.listNotes()).filter((f) => folders.some((d) => inFolder(f.path, d)))
  return Promise.all(
    files.map(async (f) => ({
      path: f.path,
      text: (await window.cn.readNote(f.path)).text,
    })),
  )
}

function ctxOf(doc: BaseDoc, records: BaseRecord[]): BaseCtx {
  const related: Record<string, BaseRecord[]> = {}
  for (const f of relatedFolders(doc)) related[f] = records.filter((r) => inFolder(r.path, f))
  return baseContext(doc, records, { related })
}

/** 现在盘上的样子（写之前用：before 要是最新的字） */
export async function loadBaseCtx(src: string): Promise<BaseCtx> {
  const doc = parseBaseDoc(src)
  return ctxOf(doc, await readRecords(foldersOf(doc)))
}

/**
 * src：```base 块里的 YAML（null：没开着哪一块）。ctx 是 null 时还在读；
 * reload：软件自己建了、改了名（不会来「外面改了」的通知）以后叫一次
 */
export function useBaseData(src: string | null): { ctx: BaseCtx | null; reload(): void } {
  const doc = useMemo(() => (src === null ? null : parseBaseDoc(src)), [src])
  const folders = useMemo(() => (doc ? foldersOf(doc) : []), [doc])
  const key = folders.join('\n')
  const [records, setRecords] = useState<BaseRecord[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!doc) return setRecords(null)
    let live = true
    void readRecords(folders).then((r) => live && setRecords(r))
    return () => void (live = false)
  }, [key, tick, doc === null])
  useEffect(() => {
    if (!folders.length) return
    const again = () => setTick((t) => t + 1)
    const off1 = window.cn.onFilesChanged(again)
    const off2 = window.cn.onNoteChanged((p) => folders.some((f) => inFolder(p, f)) && again())
    const wrote = (e: Event) => folders.includes((e as CustomEvent<string>).detail) && again()
    window.addEventListener(BASE_WROTE, wrote)
    return () => (off1(), off2(), window.removeEventListener(BASE_WROTE, wrote))
  }, [key])
  const ctx = useMemo(() => (doc && records ? ctxOf(doc, records) : null), [doc, records])
  return { ctx, reload: () => setTick((t) => t + 1) }
}

/**
 * 写进文件（FileWrite 是 packages/format 算好的改前改后）：一个个写，带改之前的字，被别处改过的那一篇不写、返回 false。
 * 写完叫一声，同一个数据库别处画着的跟着重读
 */
export async function writeFiles(ws: FileWrite[], folder: string | null): Promise<boolean> {
  let ok = true
  for (const w of ws) {
    const r = await window.cn.writeNote(w.path, w.after, w.before)
    if (!r.ok) ok = false
  }
  baseWrote(folder)
  return ok
}
