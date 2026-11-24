/**
 * AI 对话写进笔记（shared/ai-note.ts 说明，写法在 @cn/format 的 ai-note.ts）：主进程这边读写文件、提交。
 * - 加一问：只往后加（appendAsk），同一条回答记过不再写；一次提交「笔记：<那篇> · <问的那句>」，用户没提交的字先单独提交。
 *   写进那篇本身的（inline：网页、视频、文档）只拼好那几行交回，界面插进编辑器（光标处或末尾）再提交。
 * - 拿掉一问（撤回、⋯「从《…》拿掉」）：removeAsk，一次提交。
 * - 开关存在库里 .canvas-notes/ai-note.json（只记改过的），改了提交。
 * 写笔记照外部改动交给开着的编辑器合并（note:changed），和读 PDF 记一段那条路一样；同一篇排队写（queued）。
 */
import * as git from '@cn/git'
import { appendAsk, type AskMat, askUnits, attachDirFor, decodeNote, insertSide, newReadingNote, parseReadingNote, removeAsk, renderAsk, setProp } from '@cn/format'
import { existsSync } from 'node:fs'
import { atomicCopy, atomicWrite } from '@cn/atomic'
import { PASTED_NAME } from '../../shared/materials'
import { pastedPath } from '../pasted'
import { ipcMain } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommitInfo } from '../../shared/api'
import { NOTE_KINDS, type NoteAppendRequest, type NoteAppendResult, type NoteKind, type NoteRemoveRequest, type NoteRemoveResult, type NoteSwitch, readSwitches, SWITCH_FILE } from '../../shared/ai-note'
import { t } from '../../shared/i18n'
import type { Vault } from '../vault'

export interface AiNoteDeps {
  vault(): Vault
  readText(rel: string): Promise<string | null>
  send(ch: string, ...args: unknown[]): void
  queued<T>(note: string, f: () => Promise<T>): Promise<T>
}

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const short = (s: string) => {
  const l = s.replace(/\s+/g, ' ').trim()
  return [...l].length > 40 ? [...l].slice(0, 40).join('') + '…' : l
}

function needMd(p: unknown): string {
  if (typeof p !== 'string' || !/\.md$/i.test(p) || p.startsWith('/') || p.split('/').includes('..')) throw new Error(t('笔记路径不对'))
  return p
}

export function setupAiNote(d: AiNoteDeps) {
  async function commit(paths: string[], message: string): Promise<CommitInfo | null> {
    const v = d.vault()
    const hash = await git.commitPaths(v.root, [...new Set(paths)], message)
    d.send('files:changed')
    return hash ? ((await git.log(v.root, 1))[0] ?? null) : null
  }

  /** 笔记里用户自己没提交的字先单独提交，这次提交里只有 AI 记的这一问 */
  async function commitUserPending(paths: string[]) {
    const v = d.vault()
    const pending = (await git.status(v.root)).filter((x) => paths.includes(x.path))
    if (pending.length) await git.commitPaths(v.root, [...new Set(pending.map((p) => p.path))], git.describeChanges(pending))
  }

  /**
   * 只看一眼（不写的地方用）：不走 vault.read，那个会把盘上的字记成「已知」，之后的外部改动（改名后挪附件改的链接、别处改的字）
   * 监听就当没变、不报给开着的编辑器，编辑器留着旧字
   */
  async function peek(rel: string): Promise<string | null> {
    try {
      return decodeNote(await readFile(d.vault().abs(rel))).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** 写一篇：照 base 写，中间被改过就重读再来（最多三次） */
  async function rewrite(note: string, f: (cur: string | null) => string | null): Promise<{ text: string | null; changed: boolean }> {
    const v = d.vault()
    for (let tries = 0; ; tries++) {
      const cur = await d.readText(note)
      const next = f(cur)
      if (next === null || next === cur) return { text: cur, changed: false }
      await mkdir(dirname(v.abs(note)), { recursive: true })
      const w = await v.write(note, next, cur ?? '')
      if (w.ok) {
        d.send('note:changed', note, next)
        return { text: next, changed: true }
      }
      if (tries >= 2) throw new Error(t('笔记刚被改过，写不进去，等一下再试'))
    }
  }

  /** 加一问（不排队：调用的已经在这一篇的队里）；ainote:append 和读 PDF 记一问（reading:note:ask）共用 */
  async function appendNow(req: NoteAppendRequest): Promise<NoteAppendResult> {
    const note = needMd(req?.note)
    const a = req.ask
    if (!a || typeof a.key !== 'string' || typeof a.msg !== 'number' || typeof a.q !== 'string' || typeof a.a !== 'string' || !req.place || typeof req.place.heading !== 'string') throw new Error(t('记笔记的参数不对'))
    const files = (Array.isArray(req.files) ? req.files : []).filter((f): f is string => typeof f === 'string')
    for (const f of files) d.vault().abs(f)
    // 别处的 AI 对话带的图（贴的、网页上框的、拖进来的）还在 pasted/ 里（路径就是文件名）：拷进库里「附件/<那篇>/」
    if (a.mats?.some((m) => m.kind === 'image' && PASTED_NAME.test(m.path))) {
      const mats: AskMat[] = []
      for (const m of a.mats) {
        if (m.kind !== 'image' || !PASTED_NAME.test(m.path)) {
          mats.push(m)
          continue
        }
        const rel = `${attachDirFor(note)}/${m.path.slice(0, 8)}.${m.path.endsWith('.jpg') ? 'jpg' : 'png'}`
        const abs = d.vault().abs(rel)
        if (!existsSync(abs)) {
          try {
            await mkdir(dirname(abs), { recursive: true })
            await atomicCopy(pastedPath(m.path), abs)
          } catch (e) {
            // 贴的图已经清掉了：这张不写
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
            throw e
          }
        }
        mats.push({ ...m, path: rel })
        files.push(rel)
      }
      a.mats = mats
    }
    // 写进那篇本身的（网页、视频、文档）：只拼好那几行交回，界面插在光标处或接在末尾再提交
    // 旁支接在它那一问后面（找得到那一问时这里直接写，同外部改动交给开着的编辑器合并）
    if (req.inline) {
      const cur = (await peek(note)) ?? ''
      if (askUnits(cur, note).some((u) => u.ask.key === a.key && u.ask.msg === a.msg)) return { note, had: true, commit: null }
      if (!a.side || insertSide(cur, note, a) === null) return { note, had: false, commit: null, md: renderAsk(a, note), files }
      await commitUserPending([note])
      const w = await rewrite(note, (c) => (c === null ? null : insertSide(c, note, a)))
      if (!w.changed) return { note, had: true, commit: null }
      // 不翻：提交说明（写进 Git）
      return { note, had: false, commit: await commit([note, ...files], `笔记：${stem(note)} · ${short(req.subject ?? a.q)}`) }
    }
    await commitUserPending([note])
    let had = false
    const w = await rewrite(note, (cur) => {
      const base = cur ?? fresh(note, req.create)
      let next = appendAsk(base, note, a, req.place)
      if (cur !== null && next === base) had = true
      // 进度：问到第几页（问过的最大页码）/ 一共几页（不翻：属性键）
      if (next !== base && req.pages && req.pages > 0) next = setProp(next, '进度', `${Math.max(0, ...parseReadingNote(next, note).map((x) => x.page))}/${req.pages}`)
      return next
    })
    if (had || !w.changed) return { note, had: true, commit: null }
    // 不翻：提交说明（写进 Git）
    return { note, had: false, commit: await commit([note, ...files], `笔记：${stem(note)} · ${short(req.subject ?? a.q)}`) }
  }

  ipcMain.handle('ainote:append', (_e, req: NoteAppendRequest): Promise<NoteAppendResult> => d.queued(needMd(req?.note), () => appendNow(req)))

  ipcMain.handle('ainote:remove', (_e, req: NoteRemoveRequest): Promise<NoteRemoveResult> => {
    const note = needMd(req?.note)
    if (typeof req.key !== 'string' || typeof req.msg !== 'number') throw new Error(t('记笔记的参数不对'))
    return d.queued(note, async () => {
      await commitUserPending([note])
      let q = ''
      const w = await rewrite(note, (cur) => {
        if (cur === null) return null
        q = askUnits(cur, note).find((u) => u.ask.key === req.key && u.ask.msg === req.msg)?.ask.q ?? ''
        return removeAsk(cur, req.key, req.msg)
      })
      if (!w.changed) return { removed: false, commit: null }
      // 不翻：提交说明
      return { removed: true, commit: await commit([note], `笔记：从${stem(note)}拿掉 · ${short(q)}`) }
    })
  })

  ipcMain.handle('ainote:has', async (_e, note: unknown, key: unknown): Promise<number[]> => {
    const n = needMd(note)
    if (typeof key !== 'string') return []
    const text = await peek(n)
    return text ? askUnits(text, n).flatMap((u) => (u.ask.key === key ? [u.ask.msg] : [])) : []
  })

  // ---------- 开关 ----------
  async function switches(): Promise<Record<NoteKind, NoteSwitch>> {
    const raw = await readFile(d.vault().abs(SWITCH_FILE), 'utf8').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!raw) return readSwitches(null)
    try {
      return readSwitches(JSON.parse(raw))
    } catch {
      // 手改坏了的：当默认，改一次开关时整份重写
      return readSwitches(null)
    }
  }
  ipcMain.handle('ainote:switches', () => switches())
  ipcMain.handle('ainote:switch:set', async (_e, kind: unknown, s: unknown): Promise<Record<NoteKind, NoteSwitch>> => {
    if (!NOTE_KINDS.includes(kind as NoteKind) || !s || typeof (s as NoteSwitch).main !== 'boolean' || typeof (s as NoteSwitch).side !== 'boolean') throw new Error(t('记笔记的参数不对'))
    return d.queued(SWITCH_FILE, async () => {
      const all = { ...(await switches()), [kind as NoteKind]: { main: (s as NoteSwitch).main, side: (s as NoteSwitch).side } }
      const abs = d.vault().abs(SWITCH_FILE)
      await mkdir(dirname(abs), { recursive: true })
      await atomicWrite(abs, JSON.stringify(all, null, 2) + '\n')
      // 不翻：提交说明
      await commit([SWITCH_FILE], `设置：AI 记笔记开关（${kind}）`)
      return all
    })
  })

  return { appendNow }
}

/** 笔记还没有时的开头 */
function fresh(note: string, c: NoteAppendRequest['create']): string {
  if (c?.pdf) return newReadingNote(c.pdf)
  // 不翻：写进文件的标题
  return `# ${c?.title ?? stem(note)}\n`
}
