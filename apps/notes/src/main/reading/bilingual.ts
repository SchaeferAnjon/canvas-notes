/**
 * 「存成双语笔记」的主进程这一半：PDF 写进同一个文件夹「<PDF 名> 双语.md」，公式和图的裁图进 附件/<PDF 名>/双语/；
 * 网页阅读视图写进 收件箱/<标题> 双语.md（带原网址）。是用户点的，直接写，一次提交。
 */
import { ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as git from '@cn/git'
import { attachDirFor, biNotePathFor, bilingualNote, type BiNoteBlock, type BiNotePage, webBiNotePath } from '@cn/format'
import type { BilingualSaveRequest } from '../../shared/reading'
import type { Vault } from '../vault'

const MAX_PNG = 10 * 1024 * 1024

export function setupBilingual(deps: { vault(): Vault | null; send(ch: string, ...a: unknown[]): void }) {
  ipcMain.handle('reading:bilingual:save', async (_e, req: BilingualSaveRequest) => {
    const v = deps.vault()
    if (!v) throw new Error('还没有打开库')
    if (!req || !Array.isArray(req.pages) || req.pages.length > 5000) throw new Error('双语笔记的参数不对')
    let note: string
    let source: { pdf: string } | { url: string; title: string }
    let attach = ''
    if (typeof req.pdf === 'string' && /\.pdf$/i.test(req.pdf)) {
      v.abs(req.pdf)
      note = biNotePathFor(req.pdf)
      source = { pdf: req.pdf }
      attach = `${attachDirFor(req.pdf)}/双语`
    } else if (req.web && typeof req.web.url === 'string' && /^https?:\/\//i.test(req.web.url) && typeof req.web.title === 'string') {
      note = webBiNotePath(req.web.title)
      source = { url: req.web.url, title: req.web.title }
    } else throw new Error('双语笔记的来源不对')
    const files: string[] = []
    const pages: BiNotePage[] = []
    for (const p of req.pages) {
      const blocks: BiNoteBlock[] = []
      let k = 0
      for (const b of p.blocks ?? []) {
        if ((b.kind === 'formula' || b.kind === 'figure') && 'png' in b) {
          if (!attach || !(b.png instanceof Uint8Array) || b.png.length > MAX_PNG) continue
          const rel = `${attach}/p${p.page ?? 1}-${++k}.png`
          await mkdir(dirname(v.abs(rel)), { recursive: true })
          await writeFile(v.abs(rel), b.png)
          files.push(rel)
          blocks.push({ kind: b.kind, path: rel })
        } else if ((b.kind === 'formula' || b.kind === 'figure') && 'url' in b && typeof b.url === 'string' && /^https?:/i.test(b.url)) {
          blocks.push({ kind: b.kind, path: b.url })
        } else if ((b.kind === 'heading' || b.kind === 'text') && 'text' in b && typeof b.text === 'string') {
          blocks.push({ kind: b.kind, text: b.text, tr: typeof b.tr === 'string' ? b.tr : null })
        }
      }
      pages.push({ ...(typeof p.page === 'number' ? { page: p.page } : {}), blocks })
    }
    const md = bilingualNote({ note, source, pages, ...(typeof req.langs === 'string' ? { langs: req.langs } : {}) })
    const cur = await v.read(note).then(
      (n) => n.text,
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      },
    )
    await mkdir(dirname(v.abs(note)), { recursive: true })
    const w = await v.write(note, md, cur ?? '')
    if (!w.ok) throw new Error('这篇双语笔记刚被改过，没写进去，再点一次')
    if (cur !== null && cur !== md) deps.send('note:changed', note, md)
    await git.commitPaths(v.root, [note, ...files], `双语笔记：${note.split('/').pop()!.replace(/\.md$/, '')}`)
    deps.send('files:changed')
    return { path: note }
  })
}
