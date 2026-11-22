/**
 * 从笔记出卡送 Anki（task-tz7y3，2026-11-22 用户选方向 B「AI 先改成卡，一张张过」；原型 /private/tmp/canvas-notes-anki/proto.html#dir=b）：
 * 读 PDF 时问过的每一问，AI 改成一张离开那一页也看得懂的卡，用户在出卡弹窗里一张张过（空格不送、E 改、← → 换张），再送进 Anki。
 *
 * - 出卡规矩照用户自己的 ChatCards（~/Documents/Projects/anki-learn 的 Core/Sources/AnkiLearnCore/CardMaker.swift）：
 *   一张卡一个点、问题离开原文也看得懂、答案尽量不超过 40 字、带一句原文出处。ANKI_LEARN_RULES 是那边一字不差的原话，
 *   READING_RULES 是读 PDF 才有的补充（test/cards.test.ts 在本机有 anki-learn 时逐条核对原话还在，那边改了这边跟着改）。
 *   一问一张（不像 ChatCards 从整段材料里挑）；AI 一行回一张 JSON，改好一张界面就显示一张。一次最多 6 问，最多 3 批一起问（同 ChatCards 的 parallel）。
 * - 用哪家 AI：设置 › 读PDF「改写成卡用哪家AI」（AI 功能 cards，没单独选跟设置 › AI 的默认），和别的功能同一套 pickFor / modelOpt。
 * - 改好还没送的（AI 改的、自己改过的、选了不送的）记在本机 userData/anki/drafts.json：关掉弹窗、Anki 没开时选好的都留着，下次出卡接着用，不再问 AI；
 *   笔记里那一问的问题或回答变了，上次改的就不算了。
 * - 送：anki.ts 的 sendCards（学习卡 · 问答、牌组「知识」、同问题不重复）；送过的、送进去的字和 Anki 里的笔记编号记在库里 .canvas-notes/anki.json，一次提交；
 *   撤回是 Anki 里删掉这几张、记号拿掉，再一次提交。
 * - Anki 装没装、开没开（anki-learn DESIGN.md「连上 Anki」三行）：Anki.app 在不在、addons21/2055492159 在不在、AnkiConnect 答不答话。
 *   测试实例（CN_E2E=1）不看这台 Mac 上真的 Anki：CN_ANKI_APP、CN_ANKI_ADDONS 指到测试造的，不给就是没装。
 */
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import { blocksText, type CardText, cardText, type DoubtItem, parseCardLines } from '@cn/format'
import type { CommitInfo } from '../../shared/api'
import type { AnkiReview, AnkiStatus, CardEvent, CardItem, CardScope, CardSendResult, CardsView } from '../../shared/reading'
import { engine, featureLabel, modelOpt, pickFor } from '../agent'
import { pdfHash, readTextCache } from '../pdf-text-cache'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { AnkiConnectError, browse, connected, countCards, courseDeckOf, DECK, deleteNotes, sendCards } from './anki'
import { CARD_SYSTEM, cardMaterial, cardPrompt } from './card-prompt'
import { ANKI_STATE, type AnkiState, collectAsked, courseName, dirOf, readAnkiState, writeAnkiState } from './doubts'

// ---------------------------------------------------------------- 本机记着的：改好还没送的

/** 改好还没送的一问：src 是那一问的问题和回答的指纹（笔记里变了就不算了） */
interface Draft {
  card: CardText
  src: string
  edited?: boolean
  skip?: boolean
}

function fnv(s: string): string {
  let h = 0x811c9dc5
  for (const ch of s) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
const srcOf = (it: DoubtItem) => fnv(`${it.section.doubts[0] ?? ''}\n${it.quote ?? ''}\n${it.answer ?? it.section.good}`)

const BATCH = 6
const PARALLEL = 3

export interface CardsDeps {
  vault(): Vault | null
  win(): BrowserWindow | null
}

export function setupCards(deps: CardsDeps) {
  const needVault = () => {
    const v = deps.vault()
    if (!v) throw new Error('还没有打开库')
    return v
  }
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)

  // ---------- 改好还没送的（本机 userData/anki/drafts.json，按库分） ----------
  const draftsPath = () => join(app.getPath('userData'), 'anki', 'drafts.json')
  type DraftFile = { vaults: Record<string, Record<string, Draft>> }
  let drafts: DraftFile | null = null
  let saving = Promise.resolve()
  const loadDrafts = async (): Promise<DraftFile> => {
    if (drafts) return drafts
    try {
      const j = JSON.parse(await readFile(draftsPath(), 'utf8')) as Partial<DraftFile>
      drafts = { vaults: j.vaults && typeof j.vaults === 'object' ? j.vaults : {} }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
      drafts = { vaults: {} }
    }
    return drafts
  }
  const mine = async () => {
    const d = await loadDrafts()
    return (d.vaults[needVault().root] ??= {})
  }
  /** 一个接一个写（几批 AI 同时回来时不互相盖掉），先写临时文件再换名 */
  const saveDrafts = () => {
    saving = saving.then(async () => {
      const p = draftsPath()
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p + '.tmp', JSON.stringify(drafts))
      await rename(p + '.tmp', p)
    })
    return saving
  }

  // ---------- 范围 ----------
  const needScope = (x: unknown): CardScope => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    if (o.kind === 'pdf' && typeof o.pdf === 'string' && /\.pdf$/i.test(o.pdf)) return { kind: 'pdf', pdf: o.pdf }
    if (o.kind === 'folder' && typeof o.folder === 'string') return { kind: 'folder', folder: o.folder }
    if (o.kind === 'vault') return { kind: 'vault' }
    throw new Error('出卡的范围不对')
  }
  const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
  const labelOf = (s: CardScope) => (s.kind === 'pdf' ? stem(s.pdf) : s.kind === 'folder' ? courseName(s.folder) || '库的根目录' : '整个库')
  const courseOfPdf = (pdf: string) => courseName(courseRoot(dirOf(pdf)))

  ipcMain.handle('reading:cards', async (_e, scope: unknown): Promise<CardsView> => {
    const sc = needScope(scope)
    const v = needVault()
    const [items, st, d] = await Promise.all([collectAsked(v, sc), readAnkiState(v), mine()])
    const out: CardItem[] = items.map((it) => {
      const s = it.section
      const at = st.sent[it.id]
      const dr = d[it.id]
      const sentCard = st.cards?.[it.id]
      return {
        id: it.id,
        pdf: it.pdf,
        ...(it.lecture !== undefined ? { lecture: it.lecture } : {}),
        page: s.page,
        ...(s.rect ? { rect: s.rect } : {}),
        title: s.title,
        question: s.doubts[0] ?? s.title,
        ...(it.quote !== undefined ? { quote: it.quote } : {}),
        lead: s.good,
        ...(s.crop ? { crop: s.crop } : {}),
        ...(s.cropW ? { cropW: s.cropW } : {}),
        course: courseOfPdf(it.pdf),
        ...(at ? { sent: { at, ...(sentCard ? { card: { q: sentCard.q, a: sentCard.a, more: sentCard.more, quote: sentCard.quote } } : {}) } } : {}),
        // 笔记里这一问变了（重新问过、改了原话）：上次改的不算了
        ...(dr && (!dr.src || dr.src === srcOf(it)) ? { draft: { card: dr.card, ...(dr.edited ? { edited: true } : {}), ...(dr.skip ? { skip: true } : {}) } } : {}),
      }
    })
    return { label: labelOf(sc), items: out, by: featureLabel('cards') }
  })

  // ---------- AI 改写 ----------
  const jobs = new Map<number, AbortController>()
  ipcMain.handle('reading:cards:stop', (_e, job: unknown) => jobs.get(Number(job))?.abort())

  ipcMain.handle('reading:cards:draft', async (_e, job: unknown, scope: unknown, ids: unknown) => {
    if (typeof job !== 'number' || !Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('出卡的参数不对')
    const sc = needScope(scope)
    const v = needVault()
    const want = new Set(ids as string[])
    const items = (await collectAsked(v, sc)).filter((it) => want.has(it.id))
    const ctl = new AbortController()
    jobs.set(job, ctl)
    const emit = (e: CardEvent) => send('reading:cards:event', e)
    const d = await mine()
    const got = new Set<string>()
    let failed: string | undefined
    try {
      const pageTexts = await pageTextsFor(v, items)
      const p = pickFor('cards')
      const eng = engine(p.engine)
      const batches: DoubtItem[][] = []
      for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))
      /** 问一批：边回边读，改好一张发一张、记一张；没回的那几问再问一次 */
      const ask = async (batch: DoubtItem[], retry: boolean): Promise<void> => {
        const byNo = new Map(batch.map((it, k) => [String(k + 1), it]))
        const blocks = batch.map((it, k) => cardMaterial(k + 1, it, { course: courseOfPdf(it.pdf), pageText: pageTexts.get(`${it.pdf}#${it.section.page}`) }))
        let text = ''
        const take = () => {
          for (const { id, card } of parseCardLines(text)) {
            const it = byNo.get(id)
            if (!it || got.has(it.id)) continue
            got.add(it.id)
            // 旁支那一问：原文摘句就是被问的那一句
            const c = it.quote ? { ...card, quote: it.quote } : card
            d[it.id] = { card: c, src: srcOf(it) }
            void saveDrafts()
            emit({ job, id: it.id, card: c })
          }
        }
        const r = await eng.run({
          prompt: cardPrompt(blocks),
          system: CARD_SYSTEM,
          cwd: v.root,
          signal: ctl.signal,
          onText: (delta) => {
            text += delta
            take()
          },
          ...modelOpt('cards', p.engine),
        })
        text = r.text || text
        take()
        const left = batch.filter((it) => !got.has(it.id))
        if (left.length && retry && !ctl.signal.aborted) await ask(left, false)
      }
      let next = 0
      const worker = async () => {
        while (next < batches.length && !ctl.signal.aborted) await ask(batches[next++]!, true)
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        failed = String((e as Error).message ?? e)
        console.error('出卡没问成', e)
      }
    } finally {
      jobs.delete(job)
    }
    const missing = items.filter((it) => !got.has(it.id)).length
    emit({ job, done: true, ...(failed ? { error: failed } : missing && !ctl.signal.aborted ? { error: `AI 没改出${missing}问，先照你问的原话，按 E 能自己改` } : {}) })
  })

  ipcMain.handle('reading:cards:keep', async (_e, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('出卡的参数不对')
    const d = await mine()
    if (patch === null) delete d[id]
    else {
      const p = (patch && typeof patch === 'object' ? patch : {}) as { card?: unknown; edited?: unknown; skip?: unknown }
      const card = p.card === undefined ? d[id]?.card : cardText(p.card)
      if (!card) throw new Error('卡的字不对')
      d[id] = { ...d[id], card, src: d[id]?.src ?? '', ...(typeof p.edited === 'boolean' ? { edited: p.edited } : {}), ...(typeof p.skip === 'boolean' ? { skip: p.skip } : {}) }
    }
    await saveDrafts()
  })

  // ---------- 送进 Anki、撤回 ----------
  const commitInfo = async (v: Vault, hash: string | null): Promise<CommitInfo | null> => (hash ? ((await git.log(v.root, 1))[0] ?? null) : null)

  ipcMain.handle('reading:cards:send', async (_e, scope: unknown, cards: unknown): Promise<CardSendResult> => {
    const sc = needScope(scope)
    if (!Array.isArray(cards)) throw new Error('要送的卡不对')
    const v = needVault()
    const want = new Map<string, CardText>()
    for (const x of cards as { id?: unknown; card?: unknown }[]) {
      const c = cardText(x?.card)
      if (typeof x?.id !== 'string' || !c) throw new Error('要送的卡不对')
      want.set(x.id, c)
    }
    const items = new Map((await collectAsked(v, sc)).map((it) => [it.id, it]))
    const inputs = await Promise.all(
      [...want].flatMap(([id, card]) => {
        const it = items.get(id)
        if (!it) return []
        return [
          (async () => ({
            id,
            pdf: it.pdf,
            course: courseOfPdf(it.pdf),
            section: it.section,
            question: it.section.doubts[0] ?? it.section.title,
            ...(it.quote ? { quote: it.quote } : {}),
            card,
            ...(it.section.crop ? { png: await readFile(v.abs(it.section.crop)).catch(() => undefined) } : {}),
          }))(),
        ]
      }),
    )
    const st = await readAnkiState(v)
    let r
    try {
      r = await sendCards(inputs)
    } catch (e) {
      if (e instanceof AnkiConnectError && e.kind === 'off') return { added: [], duplicates: [], failed: {}, off: await status(), commit: null }
      if (e instanceof AnkiConnectError) return { added: [], duplicates: [], failed: {}, error: e.message, commit: null }
      throw e
    }
    const now = new Date().toISOString()
    st.cards ??= {}
    for (const id of [...r.added, ...r.duplicates]) {
      st.sent[id] = now
      st.cards[id] = { ...want.get(id)!, ...(r.notes[id] ? { note: r.notes[id] } : {}) }
    }
    await writeAnkiState(v, st)
    const hash = await git.commitPaths(v.root, [ANKI_STATE], `送进 Anki：${labelOf(sc)} ${r.added.length} 张`)
    // 送过的不再留草稿；这个范围里别的那几问「不送」不留到下次（下次出卡默认都要，同原型）
    const d = await mine()
    for (const id of [...r.added, ...r.duplicates]) delete d[id]
    for (const id of items.keys()) if (d[id]?.skip) delete d[id]!.skip
    await saveDrafts()
    send('files:changed')
    return { added: r.added, duplicates: r.duplicates, failed: r.failed, decks: r.decks, commit: await commitInfo(v, hash) }
  })

  ipcMain.handle('reading:cards:undo', async (_e, scope: unknown, ids: unknown): Promise<{ commit: CommitInfo | null; error?: string }> => {
    const sc = needScope(scope)
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('要撤回的卡不对')
    const v = needVault()
    const st = await readAnkiState(v)
    const notes = (ids as string[]).flatMap((id) => (st.cards?.[id]?.note ? [st.cards[id]!.note!] : []))
    try {
      await deleteNotes(notes)
    } catch (e) {
      if (e instanceof AnkiConnectError) return { commit: null, error: e.kind === 'off' ? 'Anki 没开着，撤回不了：打开 Anki 再点一次撤回' : e.message }
      throw e
    }
    for (const id of ids as string[]) {
      delete st.sent[id]
      delete st.cards?.[id]
    }
    await writeAnkiState(v, st)
    const hash = await git.commitPaths(v.root, [ANKI_STATE], `撤回送进 Anki：${labelOf(sc)} ${notes.length} 张`)
    send('files:changed')
    return { commit: await commitInfo(v, hash) }
  })

  // ---------- Anki 装没装、开没开 ----------
  ipcMain.handle('reading:anki:status', () => status())
  ipcMain.handle('reading:anki:download', () => shell.openExternal('https://apps.ankiweb.net'))

  ipcMain.handle('reading:anki:open', async (_e, ids: unknown) => {
    const a = await findAnki()
    if (!a) return false
    // 开着就在卡片浏览器里只看这几张；没开先把 Anki 打开（开了再点「打开Anki」就能看）
    if (Array.isArray(ids) && ids.length && ids.every((x) => typeof x === 'string') && (await connected())) await browse(ids as string[]).catch((e) => console.error('在 Anki 里看没成功', e))
    const err = await shell.openPath(a.path)
    if (err) throw new Error(`打不开 Anki：${err}`)
    return true
  })

  ipcMain.handle('reading:anki:review', async (_e, folder: unknown): Promise<AnkiReview> => {
    if (typeof folder !== 'string') throw new Error('文件夹不对')
    const v = needVault()
    const [items, st] = await Promise.all([collectAsked(v, { kind: 'folder', folder }), readAnkiState(v)])
    const sent = items.filter((it) => st.sent[it.id]).length
    // 这门课的卡在「课程::<课>」；不在课程里的在「知识」，按文件夹名的标签找
    const root = courseRoot(folder)
    const deck = courseDeckOf(`${root}/x.pdf`) ?? DECK
    if (!sent || !(await connected())) return { sent, deck, connected: false }
    // deck: 连下面跟着文件夹分的牌组一起数
    const q = deck === DECK ? `"deck:${DECK}" "tag:主题::${courseName(root).trim().split(/\s+/).join('_')}"` : `"deck:${deck}"`
    const [newCards, due] = await Promise.all([countCards(`${q} is:new`), countCards(`${q} is:due`)])
    return { sent, deck, connected: true, newCards, due }
  })
}

/** 一门课的根：在 课程/<课>/ 下面（PDF 可能在课里的子文件夹）就是 课程/<课>，别的就是这个文件夹自己 */
export function courseRoot(folder: string): string {
  const m = /^(课程\/[^/]+)(?:\/|$)/.exec(folder)
  return m ? m[1]! : folder
}

/** 每一问那一页 PDF 上的字（读 PDF 时 pdf.js 拼好存在 userData 的全文缓存里；没打开过的 PDF 没有） */
async function pageTextsFor(v: Vault, items: DoubtItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const pdf of new Set(items.map((it) => it.pdf))) {
    let data: Buffer
    try {
      data = await readFile(v.abs(pdf))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const pages = readTextCache(app.getPath('userData'), pdfHash(data))?.pages
    if (!pages) continue
    for (const it of items) if (it.pdf === pdf && pages[it.section.page - 1]) out.set(`${pdf}#${it.section.page}`, blocksText(pages[it.section.page - 1]!))
  }
  return out
}

// ---------------------------------------------------------------- Anki 装没装、开没开

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout: 3000 }, (err, out) => resolve(err ? '' : String(out).trim())))

/** Anki 桌面版在哪、什么版本（现在的 Anki 是 net.ankiweb.anki，老版本 net.ankiweb.dtop）；没装是 null */
async function findAnki(): Promise<{ path: string; version?: string } | null> {
  let path: string | undefined
  if (E2E) path = process.env.CN_ANKI_APP && existsSync(process.env.CN_ANKI_APP) ? process.env.CN_ANKI_APP : undefined
  else {
    path = ['/Applications/Anki.app', join(homedir(), 'Applications/Anki.app')].find((p) => existsSync(p))
    if (!path) path = (await run('mdfind', ["kMDItemCFBundleIdentifier == 'net.ankiweb.anki' || kMDItemCFBundleIdentifier == 'net.ankiweb.dtop'"])).split('\n').find((p) => p.endsWith('.app'))
  }
  if (!path) return null
  const version = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(path, 'Contents/Info.plist')])
  return { path, ...(version ? { version } : {}) }
}

/** AnkiConnect 插件的文件夹在不在（编号 2055492159，也是 addons21 下的文件夹名） */
function addonInstalled(): boolean {
  const dir = E2E ? process.env.CN_ANKI_ADDONS : join(homedir(), 'Library/Application Support/Anki2/addons21')
  return !!dir && existsSync(join(dir, '2055492159'))
}

export async function status(): Promise<AnkiStatus> {
  const [a, c] = await Promise.all([findAnki(), connected()])
  return { app: a, addon: addonInstalled(), connected: c }
}

export type { AnkiState }
