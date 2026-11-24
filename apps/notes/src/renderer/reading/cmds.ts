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
import { t as tNow } from '../../shared/i18n'

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

// 这个文件里 t 是这一轮（cmdTurn）：界面上的字用 tNow。命令名（it.name）是自带命令的身份，比的时候用中文原句（不翻）
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
    if (had && next === cur) return t.patch({ read, text: tNow('和笔记里原来的一样，笔记没动。') })
    const res = await window.cn.aiChange({ message: `/${name} · ${stemOf(d.pdf)}`, writes: [{ path, text: next, ...(had ? {} : { create: true }) }] })
    if (res && 'failed' in res) return t.patch({ read, text: done, warn: tNow('改好了，提交没成功：{error}', { error: res.failed }) })
    void S.reloadNote(d.pdf)
    // 不翻：改动块的种类（「改」「新」）是身份，画的地方翻
    t.patch({ read, text: done, open: { path }, ...(res ? { change: { commit: res as CommitInfo, kinds: { [path]: had ? '改' : '新' } } } : {}) })
  }
  try {
    // 笔记先从盘上重读一遍：外面刚改过（另一个软件、同步、别处问了一问）时，监听报过来、右栏换上新的要一会儿，
    // 这一会儿里跑命令会照旧的笔记收（r22-cmd-audit「又问了一问以后再收」偶发只收到 1 问）
    if (S.get(d.pdf).loaded) await S.reloadNote(d.pdf)
    const r = S.get(d.pdf)
    const pdfLink = (page: number) => `${linkFrom(r.note.path || notePathFor(d.pdf), d.pdf)}#page=${page}`
    // 不翻：比的是命令名（身份）
    if (it.name === '这份课件每页讲什么' || (it.name === '出几道自测题' && !S.isWebSrc(d.pdf))) {
      if (!r.pages || r.readN < r.pages) return t.patch({ cant: r.pages ? tNow('还在读全文（{n}/{total} 页），读完再试', { n: r.readN, total: r.pages }) : tNow('先打开这份 PDF，读完全文再试') })
      const pages = Array.from({ length: r.pages }, (_x, i) => pageText(d.pdf, i + 1))
      const read = tNow('读了全文{n}页', { n: r.pages })
      t.patch({ read })
      // 不翻：命令名
      if (it.name === '这份课件每页讲什么') {
        const items = R.parsePages(await ask(R.pagesPrompt({ pdf: d.pdf, pages })), pages.length)
        if (!items.size) return t.patch({ read, cant: tNow('AI 这次没写出来，笔记没动。再试一次。') })
        // 再跑一次：换掉原来那一节，不再加一节同名的（同自测题、复习提纲，task-idmm6）
        const sec = R.pagesSection(items, pdfLink)
        const had = !!R.sectionRange(r.note.text, '每页讲什么') // 不翻：笔记里那一节的标题（写进文件的）
        const said = had ? tNow('换掉了原来的「每页讲什么」，{n}页各一两句。', { n: items.size }) : tNow('在笔记末尾加了「每页讲什么」，{n}页各一两句。', { n: items.size })
        return await toNote(it.name, (cur) => R.replaceSection(cur, '每页讲什么', sec) ?? R.appendSection(cur, sec), said, read) // 不翻：那一节的标题
      }
      // 扫描件这种读不出字的不问 AI（task-ev29m）；已经有「自测题」那一节就接着往下出（task-idmm6）
      if (R.bodyChars(pages.join('\n')) < 20) return t.patch({ read, cant: tNow('这份PDF里读不出字（多半是扫描的图），出不了题。') })
      const note = r.note.text
      // 不翻：给 AI 的话（一页一段）
      const qs = R.parseQuiz(await ask(R.quizPrompt({ path: d.pdf, title: stemOf(d.pdf), text: pages.map((p, i) => `【第 ${i + 1} 页】\n${p}`).join('\n\n'), asked: R.existingQuiz(note) })))
      if (!qs.length) return t.patch({ read, cant: tNow('AI 这次没出成题，笔记没动。再试一次。') })
      const from = R.addQuiz(note, qs).from
      const done = from > 1 ? tNow('「自测题」一节里接着加了{n}道（第{from}–{to}题），和原来的不重复；答案先折着。', { n: qs.length, from, to: from + qs.length - 1 }) : tNow('在笔记末尾加了「自测题」一节，{n}道题，答案先折着。', { n: qs.length })
      return await toNote(it.name, (cur) => R.addQuiz(cur, qs).text, done, read)
    }
    if (it.name === '我问过的收成复习提纲') { // 不翻：命令名
      const qas = r.note.sections.flatMap((s) => (s.qas?.length ? s.qas.map((q) => ({ page: s.page, q: q.q, a: q.a })) : s.doubts.map((q) => ({ page: s.page, q, a: s.good }))))
      if (!qas.length) return t.patch({ text: tNow('这份 PDF 还没问过问题：框一块问几句再来收。') })
      const read = tNow('读了笔记里问过的{n}问', { n: qas.length })
      t.patch({ read })
      const items = R.parseReview(await ask(R.reviewPrompt({ pdf: d.pdf, qas })))
      if (!items.length) return t.patch({ read, cant: tNow('AI 这次没收出来，笔记没动。再试一次。') })
      // 提纲是照全部问过的收的：已经有一节就换掉它，不再加一节同名的（task-idmm6）
      const sec = R.reviewSection(items, pdfLink)
      const had = !!R.sectionRange(r.note.text, '复习提纲') // 不翻：笔记里那一节的标题（写进文件的）
      const said = had ? tNow('换掉了原来的「复习提纲」，现在{n}条；问答原文没动。', { n: items.length }) : tNow('在笔记最上面加了「复习提纲」，{n}条；问答原文没动。', { n: items.length })
      return await toNote(it.name, (cur) => R.replaceSection(cur, '复习提纲', sec) ?? R.insertTop(cur, sec), said, read) // 不翻：那一节的标题
    }
    if (it.name === '翻译') { // 不翻：命令名
      const video = S.isWebSrc(d.pdf) ? await window.cn.aiCmdVideo() : null
      if (video) {
        const src = video.cues.map((c) => c[2]).join('\n').slice(0, 20_000)
        if (!src.trim()) return t.patch({ cant: tNow('这个视频还没拿到字幕') })
        t.patch({ read: tNow('读了《{title}》的字幕', { title: video.title }) })
        return t.patch({ text: (await ask(translatePrompt(src))).trim() })
      }
      // / 菜单说「没选就翻整篇」：读完全文、不太长的 PDF 翻全文（按页标出来）；太长的翻正在看的这一页，并说清翻的是哪一页（task-n1ffi）
      const at = r.state.page || 1
      const all = r.pages && r.readN >= r.pages ? Array.from({ length: r.pages }, (_x, i) => pageText(d.pdf, i + 1)) : null
      const whole = all && all.join('\n').length <= TRANSLATE_MAX ? all : null
      // 不翻：给 AI 的话（一页一段）
      const src = whole ? whole.map((p, i) => `【第 ${i + 1} 页】\n${p}`).join('\n\n') : pageText(d.pdf, at)
      if (!src.trim() || (whole && !R.bodyChars(whole.join('\n')))) return t.patch({ cant: whole ? tNow('这份PDF里读不出字') : tNow('这一页没有字') })
      t.patch({ read: whole ? tNow('读了全文{n}页', { n: whole.length }) : tNow('读了第{n}页', { n: at }) })
      const out = (await ask(translatePrompt(src))).trim()
      const why = whole
        ? ''
        : r.pages && r.readN >= r.pages
          ? tNow('这份PDF有{pages}页，太长，这次翻了第{n}页；要翻别的页，翻到那一页再打 /{cmd}。', { pages: r.pages, n: at, cmd: tNow('翻译') })
          : tNow('全文还没读完，这次翻了第{n}页。', { n: at })
      return t.patch({ text: why ? `${why}\n\n${out}` : out })
    }
    // 视频的两条、自己的命令：和 AI 对话里同一套（commands/run.ts），回答写在这一格
    const env = readingEnv(d, t)
    // 不翻：命令名
    if (it.name === '视频要点带时间') return await runVideoKeys(env)
    if (it.name === '字幕整理成一篇') return await runVideoText(env) // 不翻
    if (it.mine) return await runOwn(env, it.mine, { web: S.isWebSrc(d.pdf) })
    t.patch({ cant: tNow('在这里用不了「/{name}」', { name: it.builtin ? tNow(it.name) : it.name }) })
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
    // 不翻：比的是 commands/run.ts 给的按钮名、改动块的种类（身份）
    const made = actions?.some((a) => a.label === '打开') ? Object.entries(rest.change?.kinds ?? {}).find(([, k]) => k === '新')?.[0] : undefined
    t.patch({ ...rest, ...(done ? { text: done } : {}), ...(error ? { cant: error } : {}), ...(made ? { open: { path: made } } : {}) })
  }
  return {
    patch,
    ask: (prompt, o) => window.cn.aiAsk(t.id, system(), prompt, { pick: d.pick, ...(o?.images?.length ? { images: o.images } : {}) }),
    async change(c, kinds) {
      const res = await window.cn.aiChange(c)
      if (res && 'failed' in res) throw new CommitFail(tNow('改好了，提交没成功：{error}', { error: res.failed }))
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
        if (res && 'failed' in res) return t.patch({ proposal: undefined, warn: tNow('改好了，提交没成功：{error}', { error: res.failed }) })
        // 新建的重名时主进程另存成「… 2」：回答、「打开」、改动块都照真写进去的那个（task-f4kf7）
        const first = p.files[0]!
        const real = first.before === null ? (res?.files.find((f) => f.path.endsWith('.md'))?.path ?? first.path) : first.path
        // 不翻：改动块的种类「新」是身份
        t.patch({ proposal: undefined, text: tNow('收下了，写进了「{path}」', { path: real }), ...(first.before === null ? { open: { path: real } } : {}), ...(res ? { change: { commit: res, kinds: { ...p.kinds, [real]: p.kinds[first.path] ?? '新' } } } : {}) })
      }
      const drop = () => {
        removeProposal(pid)
        d.onCloseDiff(pid)
        t.patch({ proposal: undefined, text: tNow('没收下，文件没动') })
      }
      addProposal({ id: pid, name: p.name, title: p.title, place: d.place, files: p.files, ...(p.warn ? { warn: p.warn } : {}), take, drop })
      d.onOpenDiff({ kind: 'proposal', id: pid }, tNow('{title} · /{name} 改的', { title: p.title, name: p.name }))
      t.patch({
        proposal: pid,
        text: p.warn
          ? tNow('改好了，但比原文少了{n}节（{names}），命令里没说要删。先在中间看清：真要这样就点「照样收下」。', { n: p.warn.lost.length, names: R.sectionNames(p.warn.lost) })
          : p.lead
            ? tNow('{lead}摆在中间先给你看：收下才写进去。', { lead: p.lead })
            : tNow('改好了，摆在中间先给你看：收下才写进去。'),
      })
    },
  }
}
