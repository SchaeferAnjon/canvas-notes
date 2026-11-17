/**
 * 导入旧笔记接进软件：选来源（备忘录要人在系统的打开面板里点一下它的数据文件夹；md 选一个文件夹）、
 * 在后台导、进度发给界面（import:progress）、能停、导完一次提交、能撤回。界面在 renderer/importer/。
 * 测试：CN_NOTES_DIR 指到测试造的备忘录数据文件夹、CN_IMPORT_DIR 指到要导的 md 文件夹，都不弹打开面板。
 */
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import * as git from '@cn/git'
import type { ImportFolder, ImportKind, ImportProgress, ImportResult, ImportScan } from '../../shared/import'
import type { Vault } from '../vault'
import { NoteStore, type ReadNote } from './apple-notes'
import { mdFolders, readMdFolder, scanMdFolder, type MdScan } from './md-folder'
import { cleanSegment, importDir, importedIds, writeImport, type ImportNote } from './write'

const NOTES_DIR = join(homedir(), 'Library/Group Containers/group.com.apple.notes')
const NOTES_SOURCE = '备忘录'
const DELAY = Number(process.env.CN_IMPORT_DELAY_MS) || 0

const tilde = (p: string) => p.replace(homedir(), '~')

export function setupImport(d: { vault(): Vault | null; win(): BrowserWindow | null; filesChanged(): void }) {
  /** 选好、还没开始导的来源 */
  let picked: { kind: 'notes'; store: NoteStore; scan: ImportScan } | { kind: 'folder'; md: MdScan; scan: ImportScan } | null = null
  let running: AbortController | null = null
  let last: ImportProgress | null = null

  const needVault = () => {
    const v = d.vault()
    if (!v) throw new Error('还没有打开库')
    return v
  }
  const send = (p: ImportProgress) => {
    last = p
    d.win()?.webContents.send('import:progress', p)
  }
  const drop = () => {
    if (picked?.kind === 'notes') picked.store.close()
    picked = null
  }

  async function chooseDir(o: { title: string; message: string; button: string; defaultPath?: string }): Promise<string | null> {
    const win = d.win()
    const opts = { title: o.title, message: o.message, buttonLabel: o.button, defaultPath: o.defaultPath, properties: ['openDirectory' as const, 'showHiddenFiles' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  }

  ipcMain.handle('import:pick', async (_e, kind: unknown): Promise<ImportScan | null> => {
    if (running) throw new Error('上一次导入还没完')
    const root = needVault().root
    drop()
    last = null
    const ids = await importedIds(root)
    if (kind === 'notes') {
      // 系统规定读别的软件的数据要人点一下：打开面板直接停在备忘录的数据文件夹，点「允许读取」就行
      const dir =
        process.env.CN_NOTES_DIR ||
        (await chooseDir({ title: '读备忘录', message: '「group.com.apple.notes」已经选好，点「允许读取」。只读，不改备忘录里的任何东西。', button: '允许读取', defaultPath: NOTES_DIR }))
      if (!dir) return null
      const store = new NoteStore(dir)
      try {
        const folders = store.folders()
        const done = store.noteRows(folders.map((f) => f.id)).filter((r) => ids.has(`apple-notes:${r.ident}`))
        for (const f of folders) f.already = done.filter((r) => String(r.folder) === f.id).length
        const scan: ImportScan = { kind: 'notes', source: NOTES_SOURCE, where: tilde(dir), folders }
        picked = { kind: 'notes', store, scan }
        return scan
      } catch (e) {
        store.close()
        throw e
      }
    }
    if (kind !== 'folder') throw new Error('参数不对')
    const dir = process.env.CN_IMPORT_DIR || (await chooseDir({ title: '选一个放 md 的文件夹', message: '旧的 Obsidian 库或别的放 md 的文件夹。只读，原来的文件不动。', button: '选这个文件夹' }))
    if (!dir) return null
    if (dir === root || dir.startsWith(root + '/') || root.startsWith(dir + '/')) throw new Error('这是现在这个库（或它的一部分），不用导入')
    const md = await scanMdFolder(dir)
    if (!md.notes.length) throw new Error(`「${basename(dir)}」里没有 md 文件`)
    const source = cleanSegment(basename(dir), 40)
    const folders: ImportFolder[] = mdFolders(md, source)
    for (const n of md.notes) if (ids.has(`md:${source}/${n.rel}`)) folders.find((f) => f.id === (n.rel.includes('/') ? n.rel.slice(0, n.rel.lastIndexOf('/')) : ''))!.already++
    const scan: ImportScan = { kind: 'folder', source, where: tilde(dir), folders }
    picked = { kind: 'folder', md, scan }
    return scan
  })

  async function run(kind: ImportKind, folderIds: string[], signal: AbortSignal): Promise<ImportResult> {
    const vault = needVault()
    if (!picked || picked.kind !== kind) throw new Error('先选来源')
    const scan = picked.scan
    const chosen = scan.folders.filter((f) => folderIds.includes(f.id))
    if (!chosen.length) throw new Error('一个文件夹都没选')
    const ids = await importedIds(vault.root)
    const lost: Record<string, number> = {}
    let notes: ImportNote[]
    let extra: { src: string; name: string }[] = []
    let locked = 0
    if (picked.kind === 'notes') {
      const store = picked.store
      const rows = store.noteRows(chosen.map((f) => f.id))
      const pathOf = new Map(chosen.map((f) => [f.id, f.path]))
      const todo = rows.filter((r) => !r.locked && !ids.has(`apple-notes:${r.ident}`))
      locked = rows.filter((r) => r.locked).length
      notes = []
      for (const [i, r] of todo.entries()) {
        signal.throwIfAborted()
        let n: ReadNote
        try {
          n = store.read(r, pathOf.get(String(r.folder)) ?? '', NOTES_SOURCE)
        } catch (e) {
          lost[`读不出来的笔记 · 「${String(r.title)}」：${(e as Error).message}`] = 1
          continue
        }
        for (const [k, v] of Object.entries(n.lost)) lost[k] = (lost[k] ?? 0) + v
        notes.push(n)
        send({ phase: 'reading', done: i + 1, total: todo.length, title: n.title })
        // 让出事件循环，界面的进度和「停下」接得上（CN_IMPORT_DELAY_MS：测试里让每条慢一点，看得到进度）
        if (DELAY) await new Promise((r) => setTimeout(r, DELAY))
        else if (i % 20 === 19) await new Promise((r) => setImmediate(r))
      }
    } else {
      send({ phase: 'reading', done: 0, total: 0 })
      const r = await readMdFolder(picked.md, chosen.map((f) => f.id), scan.source)
      notes = r.notes.filter((n) => !ids.has(n.id))
      extra = r.extra
    }
    const already = chosen.reduce((s, f) => s + f.already, 0)
    const total = notes.length
    const unit = kind === 'notes' ? '条' : '篇'
    const w = await writeImport({
      root: vault.root,
      source: scan.source,
      notes,
      extra,
      message: `导入旧笔记：从${kind === 'notes' ? '备忘录' : `「${scan.source}」`}导入 ${total} ${unit}`,
      signal,
      onProgress: (done, all, title) => send(done === all ? { phase: 'committing', done, total: all } : { phase: 'writing', done, total: all, title }),
    })
    const out: string[] = []
    if (locked) out.push(`${locked}条上了锁，没导（在备忘录里去掉锁再导一次就行）`)
    for (const [k, v] of Object.entries(lost)) out.push(v > 1 || !k.startsWith('读不出来') ? `${k} · ${v} 处` : k)
    return { source: scan.source, dir: importDir(scan.source), notes: total, attachments: w.attachments, bytes: w.bytes, commit: w.commit, skipped: { locked, already }, lost: out }
  }

  ipcMain.handle('import:start', (_e, kind: unknown, folders: unknown) => {
    if (running) throw new Error('上一次导入还没完')
    if ((kind !== 'notes' && kind !== 'folder') || !Array.isArray(folders) || !folders.every((f) => typeof f === 'string')) throw new Error('参数不对')
    const ac = new AbortController()
    running = ac
    send({ phase: 'reading', done: 0, total: 0 })
    void run(kind, folders as string[], ac.signal)
      .then(
        (result) => send({ phase: 'done', result }),
        (e) => send(ac.signal.aborted ? { phase: 'stopped' } : { phase: 'failed', error: (e as Error).message }),
      )
      .finally(() => {
        running = null
        drop()
        d.filesChanged()
      })
  })
  ipcMain.handle('import:stop', () => running?.abort())
  ipcMain.handle('import:current', () => last)
  ipcMain.handle('import:undo', async (_e, commit: unknown) => {
    if (typeof commit !== 'string') throw new Error('参数不对')
    const hash = await git.revert(needVault().root, commit)
    d.filesChanged()
    return hash
  })
}
