/**
 * 读 PDF、看视频那一格里打 / 的命令（task-9womr）：
 * - 这份 PDF：这份课件每页讲什么（笔记末尾加一节）、我问过的收成复习提纲（笔记最上面加一节）、出几道自测题（笔记末尾）、翻译（这一页，只回答）；
 * - 这个视频：视频要点带时间、字幕整理成一篇（新建进收件箱，commands/run.ts 那两条）、翻译（字幕，只回答）；
 * - 自己的命令（在哪能用选了网页的）：先给你看；
 * 都在这份 PDF（这个网页）的对话里答，一次提交、回答下面能撤回。整个库的命令换到收件箱、首页那段对话里跑（commands/handoff.ts）。
 */
import { linkFrom, newReadingNote, notePathFor } from '@cn/format'
import type { EngineId } from '../../shared/agent'
import type { SlashItem } from '../../shared/ai-cmds'
import type { CommitInfo } from '../../shared/api'
import * as R from '../../shared/cmd-run'
import type { DiffSource } from '../../shared/diff'
import type { ReadingMsg } from '../../shared/reading'
import { system, translatePrompt } from '../ai-commands'
import { vaultFiles } from '../files/store'
import { addProposal, removeProposal } from '../commands/proposals'
import { type RunEnv, runOwn, runVideoKeys, runVideoText } from '../commands/run'
import * as S from './store'

export interface ReadingCmdDeps {
  pdf: string
  /** 这段对话的地方（先给你看的对比标签里 AI 那一格还是它） */
  place: { key: string; label: string }
  pick: { engine: EngineId; model?: string; effort?: string }
  onOpenDiff(src: DiffSource, title: string): void
  onCloseDiff(id: string): void
}

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
/** /翻译 在 PDF 上翻全文的上限（字数）：再长就翻正在看的这一页 */
const TRANSLATE_MAX = 12_000

/** 一页的字（读全文读到的块） */
function pageText(pdf: string, page: number): string {
  return (S.get(pdf).blocks[page] ?? [])
    .filter((b) => b.kind !== 'image')
    .map((b) => b.text)
    .join('\n')
}

export async function runReadingCmd(d: ReadingCmdDeps, it: SlashItem) {
  const t = S.cmdTurn(d.pdf, '/' + it.name)
  const ask = (prompt: string, images?: string[]) => window.cn.aiAsk(t.id, system(), prompt, { pick: d.pick, ...(images?.length ? { images } : {}) })
  /** 写进这份 PDF 的笔记（还没有笔记就新建一篇），一次提交 */
  const toNote = async (name: string, f: (cur: string) => string, done: string, read: string) => {
    const r = S.get(d.pdf)
    const path = r.note.path || notePathFor(d.pdf)
    const had = !!r.note.text
    const cur = had ? r.note.text : newReadingNote(d.pdf)
    const next = f(cur)
    // 再跑一次换掉的那一节和原来一字不差：不提交，照实说
    if (had && next === cur) return t.patch({ read, text: '和笔记里原来的一样，笔记没动。' })
    const res = await window.cn.aiChange({ message: `/${name} · ${stemOf(d.pdf)}`, writes: [{ path, text: next, ...(had ? {} : { create: true }) }] })
    if (res && 'failed' in res) return t.patch({ read, text: done, warn: `改好了，提交没成功：${res.failed}` })
    void S.reloadNote(d.pdf)
    t.patch({ read, text: done, open: { path }, ...(res ? { change: { commit: res as CommitInfo, kinds: { [path]: had ? '改' : '新' } } } : {}) })
  }
  try {
    const r = S.get(d.pdf)
    const pdfLink = (page: number) => `${linkFrom(r.note.path || notePathFor(d.pdf), d.pdf)}#page=${page}`
    if (it.name === '这份课件每页讲什么' || (it.name === '出几道自测题' && !S.isWebSrc(d.pdf))) {
      if (!r.pages || r.readN < r.pages) return t.patch({ cant: r.pages ? `还在读全文（${r.readN}/${r.pages} 页），读完再试` : '先打开这份 PDF，读完全文再试' })
      const pages = Array.from({ length: r.pages }, (_x, i) => pageText(d.pdf, i + 1))
      const read = `读了全文${r.pages}页`
      t.patch({ read })
      if (it.name === '这份课件每页讲什么') {
        const items = R.parsePages(await ask(R.pagesPrompt({ pdf: d.pdf, pages })), pages.length)
        if (!items.size) return t.patch({ read, cant: 'AI 这次没写出来，笔记没动。再试一次。' })
        // 再跑一次：换掉原来那一节，不再加一节同名的（同自测题、复习提纲，task-idmm6）
        const sec = R.pagesSection(items, pdfLink)
        const had = !!R.sectionRange(r.note.text, '每页讲什么')
        return await toNote(it.name, (cur) => R.replaceSection(cur, '每页讲什么', sec) ?? R.appendSection(cur, sec), had ? `换掉了原来的「每页讲什么」，${items.size}页各一两句。` : `在笔记末尾加了「每页讲什么」，${items.size}页各一两句。`, read)
      }
      // 扫描件这种读不出字的不问 AI（task-ev29m）；已经有「自测题」那一节就接着往下出（task-idmm6）
      if (R.bodyChars(pages.join('\n')) < 20) return t.patch({ read, cant: '这份PDF里读不出字（多半是扫描的图），出不了题。' })
      const note = r.note.text
      const qs = R.parseQuiz(await ask(R.quizPrompt({ path: d.pdf, title: stemOf(d.pdf), text: pages.map((p, i) => `【第 ${i + 1} 页】\n${p}`).join('\n\n'), asked: R.existingQuiz(note) })))
      if (!qs.length) return t.patch({ read, cant: 'AI 这次没出成题，笔记没动。再试一次。' })
      const from = R.addQuiz(note, qs).from
      const done = from > 1 ? `「自测题」一节里接着加了${qs.length}道（第${from}–${from + qs.length - 1}题），和原来的不重复；答案先折着。` : `在笔记末尾加了「自测题」一节，${qs.length}道题，答案先折着。`
      return await toNote(it.name, (cur) => R.addQuiz(cur, qs).text, done, read)
    }
    if (it.name === '我问过的收成复习提纲') {
      const qas = r.note.sections.flatMap((s) => (s.qas?.length ? s.qas.map((q) => ({ page: s.page, q: q.q, a: q.a })) : s.doubts.map((q) => ({ page: s.page, q, a: s.good }))))
      if (!qas.length) return t.patch({ text: '这份 PDF 还没问过问题：框一块问几句再来收。' })
      const read = `读了笔记里问过的${qas.length}问`
      t.patch({ read })
      const items = R.parseReview(await ask(R.reviewPrompt({ pdf: d.pdf, qas })))
      if (!items.length) return t.patch({ read, cant: 'AI 这次没收出来，笔记没动。再试一次。' })
      // 提纲是照全部问过的收的：已经有一节就换掉它，不再加一节同名的（task-idmm6）
      const sec = R.reviewSection(items, pdfLink)
      const had = !!R.sectionRange(r.note.text, '复习提纲')
      return await toNote(it.name, (cur) => R.replaceSection(cur, '复习提纲', sec) ?? R.insertTop(cur, sec), had ? `换掉了原来的「复习提纲」，现在${items.length}条；问答原文没动。` : `在笔记最上面加了「复习提纲」，${items.length}条；问答原文没动。`, read)
    }
    if (it.name === '翻译') {
      const video = S.isWebSrc(d.pdf) ? await window.cn.aiCmdVideo() : null
      if (video) {
        const src = video.cues.map((c) => c[2]).join('\n').slice(0, 20_000)
        if (!src.trim()) return t.patch({ cant: '这个视频还没拿到字幕' })
        t.patch({ read: `读了《${video.title}》的字幕` })
        return t.patch({ text: (await ask(translatePrompt(src))).trim() })
      }
      // / 菜单说「没选就翻整篇」：读完全文、不太长的 PDF 翻全文（按页标出来）；太长的翻正在看的这一页，并说清翻的是哪一页（task-n1ffi）
      const at = r.state.page || 1
      const all = r.pages && r.readN >= r.pages ? Array.from({ length: r.pages }, (_x, i) => pageText(d.pdf, i + 1)) : null
      const whole = all && all.join('\n').length <= TRANSLATE_MAX ? all : null
      const src = whole ? whole.map((p, i) => `【第 ${i + 1} 页】\n${p}`).join('\n\n') : pageText(d.pdf, at)
      if (!src.trim() || (whole && !R.bodyChars(whole.join('\n')))) return t.patch({ cant: whole ? '这份PDF里读不出字' : '这一页没有字' })
      t.patch({ read: whole ? `读了全文${whole.length}页` : `读了第${at}页` })
      const out = (await ask(translatePrompt(src))).trim()
      const why = whole ? '' : r.pages && r.readN >= r.pages ? `这份PDF有${r.pages}页，太长，这次翻了第${at}页；要翻别的页，翻到那一页再打 /翻译。\n\n` : `全文还没读完，这次翻了第${at}页。\n\n`
      return t.patch({ text: why + out })
    }
    // 视频的两条、自己的命令：和 AI 对话里同一套（commands/run.ts），回答写在这一格
    const env = readingEnv(d, t)
    if (it.name === '视频要点带时间') return await runVideoKeys(env)
    if (it.name === '字幕整理成一篇') return await runVideoText(env)
    if (it.mine) return await runOwn(env, it.mine, { web: S.isWebSrc(d.pdf) })
    t.patch({ cant: `在这里用不了「/${it.name}」` })
  } catch (e) {
    // 写进去了、提交没成：黄色提醒；别的是 AI 那边没答出来（没登录、断网……），走认原因的那一套
    if (e instanceof CommitFail) t.patch({ warn: e.message })
    else t.patch({ error: errText(e) })
  } finally {
    t.done()
  }
}

class CommitFail extends Error {}

/**
 * commands/run.ts 那一套往读 PDF 的回答里写：回答的字、上面那行「读了…」、跑不了的原因、改动块。
 * 那边的 error 都是命令自己说的话（「右栏没开着视频：…」），写成 cant，不当 AI 没答出来（task-s2mhv）；
 * 那边的「打开」按钮（函数存不下来）换成 open：新建的那一篇（改动块里标「新」的）（task-69r0v）
 */
function readingEnv(d: ReadingCmdDeps, t: ReturnType<typeof S.cmdTurn>): RunEnv {
  const patch = (p: Partial<ReadingMsg> & { pending?: boolean; actions?: { label: string }[]; done?: string; error?: string }) => {
    const { pending, actions, done, error, ...rest } = p
    void pending
    const made = actions?.some((a) => a.label === '打开') ? Object.entries(rest.change?.kinds ?? {}).find(([, k]) => k === '新')?.[0] : undefined
    t.patch({ ...rest, ...(done ? { text: done } : {}), ...(error ? { cant: error } : {}), ...(made ? { open: { path: made } } : {}) })
  }
  return {
    patch,
    ask: (prompt, o) => window.cn.aiAsk(t.id, system(), prompt, { pick: d.pick, ...(o?.images?.length ? { images: o.images } : {}) }),
    async change(c, kinds) {
      const res = await window.cn.aiChange(c)
      if (res && 'failed' in res) throw new CommitFail(`改好了，提交没成功：${res.failed}`)
      if (res) t.patch({ change: { commit: res, kinds } })
      return res
    },
    notePath: null,
    noteText: async (p) => (await window.cn.readNote(p)).text,
    notes: [],
    files: vaultFiles,
    boardKey: () => null,
    open: () => undefined,
    today: new Date().toISOString().slice(0, 10),
    folder: null,
    propose(p) {
      const pid = `p${t.id}`
      const take = async () => {
        removeProposal(pid)
        d.onCloseDiff(pid)
        const res = await window.cn.aiChange({ message: p.message, writes: p.files.map((f) => ({ path: f.path, text: f.after, ...(f.before === null ? { create: true } : {}) })) })
        if (res && 'failed' in res) return t.patch({ proposal: undefined, warn: `改好了，提交没成功：${res.failed}` })
        // 新建的重名时主进程另存成「… 2」：回答、「打开」、改动块都照真写进去的那个（task-f4kf7）
        const first = p.files[0]!
        const real = first.before === null ? (res?.files.find((f) => f.path.endsWith('.md'))?.path ?? first.path) : first.path
        t.patch({ proposal: undefined, text: `收下了，写进了「${real}」`, ...(first.before === null ? { open: { path: real } } : {}), ...(res ? { change: { commit: res, kinds: { ...p.kinds, [real]: p.kinds[first.path] ?? '新' } } } : {}) })
      }
      const drop = () => {
        removeProposal(pid)
        d.onCloseDiff(pid)
        t.patch({ proposal: undefined, text: '没收下，文件没动' })
      }
      addProposal({ id: pid, name: p.name, title: p.title, place: d.place, files: p.files, ...(p.warn ? { warn: p.warn } : {}), take, drop })
      d.onOpenDiff({ kind: 'proposal', id: pid }, `${p.title} · /${p.name} 改的`)
      t.patch({ proposal: pid, text: p.warn ? `改好了，但比原文少了${p.warn.lost.length}节（${R.sectionNames(p.warn.lost)}），命令里没说要删。先在中间看清：真要这样就点「照样收下」。` : `${p.lead ?? '改好了，'}摆在中间先给你看：收下才写进去。` })
    },
  }
}
