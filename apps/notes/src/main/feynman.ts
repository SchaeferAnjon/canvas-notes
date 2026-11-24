/**
 * 费曼学习的主进程这一半（task-yvabi）：读材料、问 AI、守规矩都在 shared/feynman/flow.ts，这里给它真的文件、PDF 抽字、搜库和引擎。
 * 用「AI 对话」那一家（设置 › AI，和输入框底行同一套模型、effort）；带图的（PDF 框选截图、手画的图）交给「看图问」那家（Claude Code）。
 * CN_AI_FAKE=1：不调模型，照 shared/feynman/fake.ts 给回答（CN_FAKE_FEYNMAN_MS 假装想多久，默认 150 毫秒；
 * CN_FAKE_FEYNMAN_LOG 给了就一问记一行：哪一步、给了几张图、用的哪家）。
 */
import { app, type BrowserWindow, ipcMain } from 'electron'
import { appendFileSync, existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { blocksText } from '@cn/format'
import { pickLabel, withoutEffort } from '../shared/ai-features'
import type { ExtractReq, JudgeReq, TurnReq } from '../shared/feynman/api'
import { type AskQ, extract, type FlowDeps, judge, turn } from '../shared/feynman/flow'
import type { GatherDeps } from '../shared/feynman/material'
import { partialField } from '../shared/feynman/prompts'
import { courseSummary } from '../shared/feynman/progress'
import { askWith, chatLabel, chatPick, engineReady, notReadyHint, visionModel } from './agent'
import type { EngineImage } from './agent/engines'
import { pdfHash, readTextCache } from './pdf-text-cache'
import type { Vault } from './vault'

const FAKE = () => process.env.CN_AI_FAKE === '1'
const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

const aborted = () => Object.assign(new Error('停下了'), { name: 'AbortError' })

/** 交给引擎的图：只认 png、jpeg（别的格式引擎不收） */
function mimeOf(path: string): EngineImage['mime'] | null {
  const e = extname(path).toLowerCase()
  return e === '.png' ? 'image/png' : e === '.jpg' || e === '.jpeg' ? 'image/jpeg' : null
}

export function setupFeynman(d: { vault(): Vault | null; win(): BrowserWindow | null }) {
  const running = new Map<number, AbortController>()
  const needVault = () => {
    const v = d.vault()
    if (!v) throw new Error('还没有打开库')
    return v
  }

  /** 库里所有不是 md 的文件（![[x.pdf]] 只写名字时按名字找） */
  async function files(root: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string, rel: string) => {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
        const r = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) await walk(join(dir, ent.name), r)
        else if (!/\.md$/i.test(ent.name)) out.push(r)
      }
    }
    await walk(root, '')
    return out
  }

  function gatherDeps(v: Vault): GatherDeps {
    let all: Promise<string[]> | null = null
    return {
      read: async (p) => {
        try {
          return await readFile(v.abs(p), 'utf8')
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw e
        }
      },
      notes: async () => (await v.list()).map((f) => f.path),
      search: async (word) => (await v.search(word, 10)).map((h) => h.path),
      pdf: async (p) => {
        if (!existsSync(v.abs(p))) return null
        // 先用 PDF 标签、搜索进程读好的全文缓存；没有现读（和数据库 AI 列读附件同一个读法）
        const data = new Uint8Array(await readFile(v.abs(p)))
        const cached = readTextCache(app.getPath('userData'), pdfHash(data))?.pages
        const pages = cached ?? (await (await import('./search/pdf-read')).readPdfText(v.abs(p))).pages
        return pages.map((blocks, i) => ({ page: blocks[0]?.page ?? i + 1, text: blocksText(blocks) }))
      },
      hasFile: async (p) => existsSync(v.abs(p)),
      findFile: async (name, here) => {
        const dir = here.includes('/') ? here.slice(0, here.lastIndexOf('/') + 1) : ''
        for (const p of [dir + name, name]) if (existsSync(v.abs(p))) return p
        all ??= files(v.root)
        const base = name.split('/').pop()!
        const hits = (await all).filter((p) => p.split('/').pop() === base)
        return hits.sort((a, b) => Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)) || a.length - b.length)[0] ?? null
      },
    }
  }

  const visionPick = () => ({ engine: 'claude' as const, ...(visionModel() ? { model: visionModel()! } : {}) })
  const by = (images: boolean) => (images ? pickLabel(visionPick()) : withoutEffort(chatLabel()))

  function flowDeps(v: Vault, reqId: number, signal: AbortSignal): FlowDeps {
    const send = (delta: string) => delta && d.win()?.webContents.send('feynman:text', reqId, delta)
    const ask = async (q: AskQ): Promise<string> => {
      if (signal.aborted) throw aborted()
      const images: EngineImage[] = []
      for (const im of q.images) {
        if ('path' in im) {
          const mime = mimeOf(im.path)
          if (mime && existsSync(v.abs(im.path))) images.push({ mime, data: (await readFile(v.abs(im.path))).toString('base64'), path: v.abs(im.path) })
        } else if (im.mime === 'image/png' || im.mime === 'image/jpeg') images.push({ mime: im.mime, data: im.base64, path: '' })
      }
      const pick = images.length ? visionPick() : chatPick()
      if (FAKE()) {
        if (process.env.CN_FAKE_FEYNMAN_LOG) appendFileSync(process.env.CN_FAKE_FEYNMAN_LOG, JSON.stringify({ kind: q.kind, images: images.length, engine: pick.engine, model: pick.model ?? null, by: by(images.length > 0) }) + '\n')
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, Number(process.env.CN_FAKE_FEYNMAN_MS ?? 150))
          signal.addEventListener('abort', () => (clearTimeout(t), rej(aborted())), { once: true })
        })
        const out = q.fake()
        if (q.stream) {
          const text = partialField(out, q.stream)
          for (const part of text.match(/[^]{1,4}/gu) ?? []) {
            if (signal.aborted) throw aborted()
            send(part)
            await new Promise((r) => setTimeout(r, Number(process.env.CN_FAKE_SAY_MS ?? 10)))
          }
        }
        return out
      }
      if (!engineReady(pick.engine)) throw new Error(notReadyHint(pick.engine))
      let raw = ''
      let shown = ''
      const out = await askWith(
        q.system,
        q.prompt,
        signal,
        (delta) => {
          raw += delta
          if (!q.stream) return
          const now = partialField(raw, q.stream)
          if (now.length > shown.length && now.startsWith(shown)) send(now.slice(shown.length))
          shown = now
        },
        pick,
        images,
      )
      return out
    }
    return { gather: gatherDeps(v), ask, by }
  }

  async function run<T>(reqId: unknown, f: (deps: FlowDeps) => Promise<T>): Promise<T> {
    if (typeof reqId !== 'number') throw new Error('参数不对')
    const v = needVault()
    const ac = new AbortController()
    running.get(reqId)?.abort()
    running.set(reqId, ac)
    try {
      return await f(flowDeps(v, reqId, ac.signal))
    } finally {
      if (running.get(reqId) === ac) running.delete(reqId)
    }
  }

  const obj = (x: unknown) => {
    if (!x || typeof x !== 'object') throw new Error('参数不对')
    return x
  }

  ipcMain.handle('feynman:extract', (_e, reqId: unknown, req: unknown) => run(reqId, (deps) => extract(obj(req) as ExtractReq, deps)))
  ipcMain.handle('feynman:split', (_e, reqId: unknown, req: unknown) => run(reqId, (deps) => extract(obj(req) as ExtractReq, deps, { listOnly: true })))
  ipcMain.handle('feynman:turn', (_e, req: unknown) => run((obj(req) as TurnReq).reqId, (deps) => turn(req as TurnReq, deps)))
  ipcMain.handle('feynman:judge', (_e, req: unknown) => run((obj(req) as JudgeReq).reqId, (deps) => judge(req as JudgeReq, deps)))
  ipcMain.handle('feynman:stop', (_e, reqId: unknown) => {
    if (typeof reqId === 'number') running.get(reqId)?.abort()
  })
  ipcMain.handle('feynman:engine', () => {
    const p = chatPick()
    if (!FAKE() && !engineReady(p.engine)) return null
    return { id: p.engine, label: withoutEffort(chatLabel()) }
  })
  ipcMain.handle('feynman:course', async (_e, folder: unknown, today: unknown, exam: unknown) => {
    if (typeof folder !== 'string' || typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('参数不对')
    const v = needVault()
    const prefix = folder.replace(/\/+$/, '') + '/'
    const notes = [...(await v.texts())].filter(([p]) => folder === '' || p.startsWith(prefix)).map(([path, text]) => ({ path, text }))
    return courseSummary(notes, today, typeof exam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exam) ? exam : undefined)
  })
}

