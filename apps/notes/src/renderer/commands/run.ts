/**
 * 真跑 AI 命令（task-9womr）：12 条新的自带命令（读 PDF 的三条在 reading/ 里）和自己存的命令。
 * AI 只给要加什么、放哪（shared/cmd-run.ts 拼进文件、再核一遍只改了该改的），写进去走 ai:change（一次提交「AI：/命令 · 对象」，回答下面能撤回）；
 * 自己存的命令和写这周的周记先给你看（摆在中间，收下才写）。用的 AI 跟着输入框底行选的那一家、模型、想多久（env.ask）。
 */
import type { AiCmd } from '../../shared/ai-cmds'
import { draftName, instructionOf } from '../../shared/ai-cmds'
import type { AiChange, CommitInfo, NoteFile } from '../../shared/api'
import * as R from '../../shared/cmd-run'
import type { FileEntry } from '../../shared/files'
import { INBOX, titleOf } from '../../shared/layout'
import { safeTitle, timeUrl } from '../../shared/video'
import type { Msg } from '../ai-chats'
import type { ProposalFile } from './proposals'

export interface RunEnv {
  patch(p: Partial<Msg>): void
  /** 问 AI 一次（输入框选的那一家、模型、想多久）；images：库里的图 */
  ask(prompt: string, o?: { images?: string[] }): Promise<string>
  /** 写进文件、一次提交（提交说明前面主进程加「AI：」）；kinds：改动块那一列 */
  change(c: AiChange, kinds: Record<string, string>): Promise<CommitInfo | null>
  /** 开着的这一篇（白板也是）；没开是 null */
  notePath: string | null
  noteText(path: string): Promise<string>
  notes: readonly NoteFile[]
  files(): readonly FileEntry[]
  /** 白板上选中的那张卡（DocBoardView 的选中）：这块白板上的 key */
  boardKey(): string | null
  open(path: string): void
  /**
   * 先给你看：摆在中间（对比标签），收下才写；name 不带 /。
   * lead：回答开头先说的一句（这周已经有周记，并进那一篇）；warn：要提醒的（少了整节、命令没说要删，标红、只给「照样收下」）
   */
  propose(p: { name: string; title: string; files: ProposalFile[]; message: string; kinds: Record<string, string>; lead?: string; warn?: { lost: string[] } }): void
  today: string
  /** 文件夹首页：这个文件夹 */
  folder: string | null
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const findImage = (files: readonly FileEntry[]) => (name: string) => files.find((f) => f.path === name || f.path.endsWith('/' + name))?.path ?? null

/** 一篇笔记的路径和全文（没开着就说先打开） */
async function needNote(env: RunEnv, what = '一篇笔记'): Promise<{ path: string; title: string; text: string } | null> {
  if (!env.notePath) {
    env.patch({ pending: false, error: `先打开${what}` })
    return null
  }
  return { path: env.notePath, title: titleOf(env.notePath), text: await env.noteText(env.notePath) }
}

/** 改这一篇：核过只改了该改的，一次提交；没核过的不写 */
async function writeBack(env: RunEnv, name: string, n: { path: string; title: string; text: string }, next: string, ok: boolean, done: string, read: string) {
  if (!ok) return env.patch({ pending: false, read, error: `AI 这次改得超出了「/${name}」说的范围，没写进去。再试一次。` })
  if (next === n.text) return env.patch({ pending: false, read, text: '看过了，没有要改的地方，文件没动。' })
  const commit = await env.change({ message: `/${name} · ${n.title}`, writes: [{ path: n.path, text: next }] }, { [n.path]: '改' })
  env.patch({ pending: false, read, text: done, ...(commit ? { change: { commit, kinds: { [n.path]: '改' } } } : {}) })
}

/** 新建一篇：一次提交，回答下面「打开」和改动块 */
async function create(env: RunEnv, name: string, subject: string, path: string, text: string, read: string, say: (p: string) => string) {
  const commit = await env.change({ message: `/${name} · ${subject}`, writes: [{ path, text, create: true }] }, {})
  const at = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? path
  env.patch({
    pending: false,
    read,
    text: say(at),
    actions: [{ label: '打开', primary: true, run: () => env.open(at) }],
    ...(commit ? { change: { commit, kinds: { [at]: '新' } } } : {}),
  })
}

/** list 里第几张和它写法一样的图（AI 认字的时候这一篇又改过：照写法和第几次出现找回每张图） */
const nthSame = (list: readonly R.DocImage[], im: R.DocImage) => list.filter((x) => x.raw === im.raw && x.line < im.line).length

/**
 * 截图转成文字：只做图下面还没写过字的图（上次转过的从这一篇的提交里认出来，task-t41et），8 张一批问 AI，一次最多 24 张，
 * 多的说清还剩几张、再跑一次接着做（task-ov1z1）；AI 认出的字图下面本来就有的不再加
 */
export async function runOcr(env: RunEnv) {
  const n = await needNote(env)
  if (!n) return
  const all = R.docImages(n.text, n.path, findImage(env.files()))
  if (!all.length) return env.patch({ pending: false, text: '这篇里没有截图或照片（网上的图、SVG 示意图不算）。' })
  const done = R.ocrDone(n.text, all, new Set(await window.cn.aiCmdOcrLines(n.path)))
  const todo = all.filter((_im, i) => !done[i])
  const skipped = all.length - todo.length
  if (!todo.length) return env.patch({ pending: false, text: `这篇的${all.length}张图下面都已经写过字了（上次「/截图转成文字」加的），没再问AI。` })
  const now = todo.slice(0, R.OCR_MAX)
  const read = `看了《${n.title}》里的${now.length}张图`
  env.patch({ read })
  const got: { im: R.DocImage; text: string }[] = []
  /** 问过 AI 的几张、后面一批出错时的原因 */
  let asked = 0
  let cut = ''
  for (let i = 0; i < now.length; i += R.OCR_BATCH) {
    const part = now.slice(i, i + R.OCR_BATCH)
    if (now.length > R.OCR_BATCH) env.patch({ read: `${read}（第${i + 1}–${i + part.length}张）` })
    let answer: string
    try {
      answer = await env.ask(R.ocrPrompt({ path: n.path, title: n.title, doc: n.text, images: part }), { images: part.map((x) => x.path) })
    } catch (e) {
      // 前几批认好了、后面一批出错：认好的照样写进去，照实说后面没做的（再跑一次接着做）
      if (!asked) throw e
      cut = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      break
    }
    asked += part.length
    for (const it of R.parseOcr(answer, part.length)) got.push({ im: part[it.n - 1]!, text: it.text })
  }
  if (now.length > R.OCR_BATCH) env.patch({ read })
  const rest = todo.length - asked
  const cur = await env.noteText(n.path)
  const curImgs = R.docImages(cur, n.path, findImage(env.files()))
  const targets: R.DocImage[] = []
  const items: { n: number; text: string }[] = []
  let dup = 0
  for (const g of got) {
    const at = curImgs.filter((x) => x.raw === g.im.raw)[nthSame(all, g.im)]
    if (!at) continue
    if (R.alreadyBelow(cur, at, g.text)) {
      dup++
      continue
    }
    targets.push(at)
    items.push({ n: targets.length, text: g.text })
  }
  const blank = asked - got.length
  const more = [
    skipped ? `另外${skipped}张上次转过，跳过了。` : '',
    dup ? `${dup}张图下面本来就有这些字，没再加。` : '',
    blank > 0 ? `${blank}张图上没认出要写的字。` : '',
    rest > 0 ? (cut ? `还有${rest}张这次没认成（${cut}）：再打一次「/截图转成文字」接着做。` : `还剩${rest}张没做：再打一次「/截图转成文字」接着做后面的。`) : '',
  ].join('')
  if (!items.length) return env.patch({ pending: false, read, text: `没有要加的字，文件没动。${more}` })
  const next = R.applyOcr(cur, targets, items)
  await writeBack(env, '截图转成文字', { ...n, text: cur }, next, R.onlyAdded(cur, next), `把${items.length}张图里的字写在了图下面，原图留着。${more}`, read)
}

export async function runLinks(env: RunEnv) {
  const n = await needNote(env)
  if (!n) return
  const titles = [...new Set(env.notes.filter((x) => /\.md$/i.test(x.path) && x.path !== n.path).map((x) => titleOf(x.path)))].slice(0, 400)
  if (!titles.length) return env.patch({ pending: false, text: '库里还没有别的笔记可以链。' })
  const read = `读了《${n.title}》和库里${titles.length}篇笔记的名字`
  env.patch({ read })
  const links = R.parseLinks(await env.ask(R.linksPrompt({ path: n.path, title: n.title, doc: n.text, titles })))
  const cur = await env.noteText(n.path)
  const r = R.applyLinks(cur, links, new Set(titles), n.title)
  if (!r.added.length) return env.patch({ pending: false, read, text: '没找到这篇提到、库里已有的笔记，文件没动。' })
  await writeBack(env, '补双链', { ...n, text: cur }, r.text, R.onlyLinksAdded(cur, r.text), `加了${r.added.length}个双链：${r.added.map((t) => `[[${t}]]`).join('、')}。别的字没动。`, read)
}

/** 出题至少要这么多字的正文（空笔记、只有标题的不问 AI，task-ev29m） */
export const QUIZ_MIN = 20

/** 正文太少出不了题时的那句话；够就是 null */
export function noQuiz(text: string): string | null {
  const chars = R.bodyChars(text)
  if (chars >= QUIZ_MIN) return null
  return !chars ? `这篇还没有正文${/^\s*#{1,6}\s/m.test(text) ? '（只有标题）' : ''}，出不了题。先写点内容再来。` : `这篇正文只有${chars}个字，出不了题。多写一点再来。`
}

/**
 * AI 没按要求给（不是 JSON、不是一篇文章）：它说了话就照实给人看（多半是说为什么做不了），当回答，不当出错
 * （出错那一块六十个字以上的话会收进「看原话」）；什么都没说才算没答上、叫再试
 */
export function failed(lead: string, answer: string): Partial<Msg> {
  const t = answer.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim()
  return t ? { text: `${lead}它说：${t.length > 200 ? t.slice(0, 200) + '…' : t}` } : { error: `${lead}再试一次。` }
}

/** 出几道自测题：已经有「自测题」那一节就接着往下出（不和原来的重复），没有就在末尾加一节（task-idmm6） */
export async function runQuiz(env: RunEnv) {
  const n = await needNote(env)
  if (!n) return
  const no = noQuiz(n.text)
  if (no) return env.patch({ pending: false, text: no })
  const read = `读了《${n.title}》`
  env.patch({ read })
  const answer = await env.ask(R.quizPrompt({ path: n.path, title: n.title, text: n.text, asked: R.existingQuiz(n.text) }))
  const qs = R.parseQuiz(answer)
  if (!qs.length) return env.patch({ pending: false, read, ...failed('AI这次没出成题，文件没动。', answer) })
  const cur = await env.noteText(n.path)
  const r = R.addQuiz(cur, qs)
  const done = r.from > 1 ? `「自测题」一节里接着加了${qs.length}道（第${r.from}–${r.from + qs.length - 1}题），和原来的不重复；答案先折着。` : `在末尾加了「自测题」一节，${qs.length}道题，答案先折着。`
  await writeBack(env, '出几道自测题', { ...n, text: cur }, r.text, R.onlyAdded(cur, r.text), done, read)
}

export async function runSplit(env: RunEnv) {
  const n = await needNote(env, '一篇文档')
  if (!n) return
  const read = `读了《${n.title}》`
  env.patch({ read })
  let columns: { name: string; items: number[] }[] | undefined
  if (!R.hasHeads(n.text)) {
    const cards = R.cardsOf(n.text)
    if (!cards.length) return env.patch({ pending: false, read, text: '这篇还没有正文，没有能拆的。' })
    columns = R.parseColumns(await env.ask(R.splitPrompt({ path: n.path, title: n.title, cards })), cards.length)
    if (!columns.length) columns = [{ name: '全部', items: cards.map((_c, i) => i + 1) }]
  }
  const dir = dirOf(n.path)
  const path = `${dir ? dir + '/' : ''}${n.title}：白板.md`
  await create(env, '拆成白板卡片', n.title, path, R.splitBoard({ title: n.title, doc: n.text, ...(columns ? { columns } : {}) }), read, (p) => `新建了白板「${titleOf(p)}」，放在这篇旁边；原文不动。`)
}

export async function runPlan(env: RunEnv) {
  const n = await needNote(env, '一块白板')
  if (!n) return
  const cards = R.boardCards(n.text)
  if (!cards.length) return env.patch({ pending: false, text: '这块白板上还没有卡。' })
  const read = `读了白板《${n.title}》上的${cards.length}张卡`
  env.patch({ read })
  const plan = R.parsePlan(await env.ask(R.planPrompt({ path: n.path, title: n.title, cards, today: env.today })), cards.length)
  if (!plan.size) return env.patch({ pending: false, read, error: 'AI 这次没排出来，白板没动。再试一次。' })
  const cur = await env.noteText(n.path)
  const next = R.applyPlan(cur, plan)
  const by = (c: string) => [...plan.values()].filter((p) => p.col === c).length
  const todo = [...plan.values()].filter((p) => p.todo).length
  await writeBack(env, '白板排成计划', { ...n, text: cur }, next, R.sameCards(cur, next), `排好了：这周${by('这周')}张、下周${by('下周')}张、以后${by('以后')}张${todo ? `，${todo}张变成了待办` : ''}。一张卡没删。`, read)
}

export async function runTodo(env: RunEnv) {
  const n = await needNote(env, '一块白板')
  if (!n) return
  const key = env.boardKey()
  const hit = key ? R.selectedCard(n.text, key) : null
  if (!key || !hit) return env.patch({ pending: false, error: '先在白板上选中一张卡，再打 /计划拆成待办' })
  const read = `读了选中的那张卡「${hit.unit.text.trim().slice(0, 16)}」`
  env.patch({ read })
  const todos = R.parseTodos(await env.ask(R.todoPrompt({ path: n.path, card: hit.unit.text, col: hit.col?.title ?? null })))
  if (!todos.length) return env.patch({ pending: false, read, error: 'AI 这次没拆出来，白板没动。再试一次。' })
  const cur = await env.noteText(n.path)
  const next = R.applyTodos(cur, key, todos)
  await writeBack(env, '计划拆成待办', { ...n, text: cur }, next, R.onlyAdded(cur, next), `拆成了${todos.length}条小待办，放在它后面一张卡里；原来那张没动。`, read)
}

export async function runBookThemes(env: RunEnv) {
  const n = await needNote(env, '一本书的书摘')
  if (!n) return
  const d = R.digestOf(n.text)
  if (!d || d.groups.length < 2) return env.patch({ pending: false, text: '这篇书摘里的划线不到两条，不用分节。' })
  const read = `读了《${n.title}》的${d.groups.length}条划线`
  env.patch({ read })
  const themes = R.parseThemes(await env.ask(R.bthemePrompt({ title: n.title, groups: d.groups })), d.groups.length)
  if (!themes.length) return env.patch({ pending: false, read, error: 'AI 这次没分出主题，书摘没动。再试一次。' })
  const cur = await env.noteText(n.path)
  const cd = R.digestOf(cur)
  if (!cd) return env.patch({ pending: false, read, error: '书摘刚被改过，再试一次。' })
  const next = R.applyThemes(cd, themes)
  // 软件自己拼的（AI 只给分组），核不过是软件的错，不怪 AI、不叫再试（再试也一样，task-ftdc9）
  if (!R.sameGroups(cur, next)) return env.patch({ pending: false, read, error: '分好的节没核对上（划线、想法和你的评价要一字不差），书摘没动。这是软件的问题，不用再试。' })
  await writeBack(env, '书摘按主题分节', { ...n, text: cur }, next, true, `按主题分成了${themes.length}节；划线、想法和你的评价一字没改。`, read)
}

/** 右栏正在看的视频（还没字幕的说清楚） */
async function needVideo(env: RunEnv) {
  const v = await window.cn.aiCmdVideo()
  if (!v) {
    env.patch({ pending: false, error: '右栏没开着视频：先在右栏网页里打开一个YouTube或B站视频' })
    return null
  }
  if (!v.cues.length) {
    env.patch({ pending: false, error: '这个视频还没拿到字幕：等视频条上的字幕出来再试，或者先在视频条上生成字幕' })
    return null
  }
  return v
}

export async function runVideoKeys(env: RunEnv) {
  const v = await needVideo(env)
  if (!v) return
  const read = `读了《${v.title}》的${v.cues.length}条字幕`
  env.patch({ read })
  const items = R.placeOnCues(R.parseVkey(await env.ask(R.vkeyPrompt({ title: v.title, cues: v.cues })), v.duration), v.cues)
  if (!items.length) return env.patch({ pending: false, read, error: 'AI 这次没写出要点，什么都没建。再试一次。' })
  const text = R.vkeyNote({ title: v.title, url: v.url, items, at: (t) => timeUrl(v, t) })
  await create(env, '视频要点带时间', v.title, `${INBOX}/${safeTitle(v.title)} 要点.md`, text, read, (p) => `写了${items.length}个要点，每条能点回那一秒，放进了「${dirOf(p)}」。`)
}

export async function runVideoText(env: RunEnv) {
  const v = await needVideo(env)
  if (!v) return
  const tr = v.cues.some((c) => c[3])
  const read = `读了《${v.title}》的${v.cues.length}条字幕${tr ? '和译文' : ''}`
  env.patch({ read })
  const paras = R.placeOnCues(R.parseVtext(await env.ask(R.vtextPrompt({ title: v.title, cues: v.cues, tr }))), v.cues)
  if (!paras.length) return env.patch({ pending: false, read, error: 'AI 这次没整理出来，什么都没建。再试一次。' })
  const text = R.vtextNote({ title: v.title, url: v.url, paras, at: (t) => timeUrl(v, t) })
  await create(env, '字幕整理成一篇', v.title, `${INBOX}/${safeTitle(v.title)} 字幕整理.md`, text, read, (p) => `整理成了${paras.length}段${tr ? '，原文和译文对照' : ''}，放进了「${dirOf(p)}」。`)
}

/**
 * 写这周的周记：照这周改过的笔记、这周新划的线和问过的问题写（task-iztii）。
 * 这周已经有一篇（一周一篇）：叫 AI 只写新的事，并进那一篇、原来的字不动，先给你看里是改那一篇；都写到了就不改（task-f4kf7）
 */
export async function runWeek(env: RunEnv) {
  const w = await window.cn.aiCmdWeek()
  const books = w.books.filter((b) => b.kind === 'book').length
  const pdfs = w.books.length - books
  const read = `读了这周改过的${w.notes.length}篇笔记${books ? `、${books}本书的新划线` : ''}${pdfs ? `、${pdfs}份PDF里问过的` : ''}${w.had !== null ? '和这周已经写的周记' : ''}`
  env.patch({ read })
  const body = await env.ask(R.weekPrompt(w, w.had))
  if (!body.trim()) return env.patch({ pending: false, read, error: 'AI 这次没写出来。再试一次。' })
  const path = R.weekPath(w.week)
  const title = `${w.week} 周记`
  const base = { name: '写这周的周记', title, message: `/写这周的周记 · ${w.week}` }
  if (w.had === null) {
    env.propose({ ...base, files: [{ path, before: null, after: R.weekNote(w, body) }], kinds: { [path]: '新' } })
    return env.patch({ read })
  }
  const after = R.mergeWeek(w.had, body)
  if (after === w.had) return env.patch({ pending: false, read, text: `这周的「${title}」里都写到了，没有要加的。` })
  env.propose({ ...base, files: [{ path, before: w.had, after, note: '并进这周那一篇' }], kinds: { [path]: '改' }, lead: `这周已经有「${title}」：新的事并进那一篇，原来写的一个字不动。` })
  env.patch({ read })
}

/**
 * 自己存的命令：照它的写到哪和能碰的跑——拿这一篇（网页上是网页的字，文件夹首页是里面最近几篇）和它的图交给 AI，
 * 不给工具（全能模式不开、只碰这一个文件）；只回答的答在对话里，别的先给你看、收下才写
 */
export async function runOwn(env: RunEnv, c: AiCmd, o: { web: boolean }) {
  const instruction = instructionOf(c.rules)
  let source: 'doc' | 'web' | 'folder'
  let title: string
  let path: string
  let text: string
  let images: string[] = []
  if (env.notePath && (c.where.includes('doc') || c.where.includes('board'))) {
    source = 'doc'
    path = env.notePath
    title = titleOf(path)
    text = await env.noteText(path)
    images = R.docImages(text, path, findImage(env.files()))
      .slice(0, 8)
      .map((i) => i.path)
  } else if (o.web && c.where.includes('web')) {
    const page = await window.cn.aiCmdPage()
    if (!page) return env.patch({ pending: false, error: '右栏没开着网页' })
    source = 'web'
    title = page.title || page.url
    path = page.url
    text = page.text
  } else if (env.folder !== null && c.where.includes('folder')) {
    source = 'folder'
    const list = env.notes.filter((x) => x.path.startsWith(env.folder + '/') && /\.md$/i.test(x.path)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8)
    if (!list.length) return env.patch({ pending: false, text: '这个文件夹里还没有笔记。' })
    title = env.folder.split('/').pop() || env.folder
    path = env.folder
    text = (await Promise.all(list.map(async (x) => `## ${titleOf(x.path)}\n\n${await env.noteText(x.path)}`))).join('\n\n')
  } else return env.patch({ pending: false, error: `在这里用不了「/${c.name}」` })
  const read = source === 'web' ? `读了网页《${title}》` : source === 'folder' ? `读了「${title}」里最近几篇` : `读了《${title}》${images.length ? `和${images.length}张图` : ''}`
  env.patch({ read })
  const answer = await env.ask(R.ownPrompt({ name: c.name, instruction, title, path, text, write: c.write, images: images.length, source }), images.length ? { images } : {})
  if (c.write === 'answer') return env.patch({ pending: false, read, text: answer.trim() })
  const doc = R.docOut(answer)
  // 开了代码块没收尾：没写完就停了，照实说（不拿半篇去改）
  if (!doc) return env.patch({ pending: false, read, error: R.docCut(answer) ? 'AI这次给的整篇没写完（代码块没收尾），文件没动。再试一次。' : 'AI这次没给出改好的整篇，文件没动。再试一次。' })
  // 写到哪：改这一篇（网页、文件夹首页上没有这一篇可改：网页进收件箱，文件夹放进这个文件夹）、新建放旁边、新建进收件箱
  const inplace = c.write === 'inplace' && source === 'doc'
  const dir = source === 'doc' ? dirOf(path) : source === 'folder' ? path : INBOX
  const target = inplace ? path : `${c.write === 'inbox' || (c.write === 'inplace' && source === 'web') ? INBOX : dir || INBOX}/${draftName(safeTitle(title))}.md`
  const after = inplace ? R.keepFrontmatter(text, doc) : doc
  // 改整篇少了整节、规矩里又没说要删：先给你看标红，只给「照样收下」（task-1l29q）
  const gone = inplace ? R.goneSections(text, after) : []
  const warn = gone.length && !R.saysDelete(instruction) ? { lost: gone } : undefined
  env.propose({ name: c.name, title, files: [{ path: target, before: inplace ? text : null, after }], message: `/${c.name} · ${title}`, kinds: { [target]: inplace ? '改' : '新' }, ...(warn ? { warn } : {}) })
  env.patch({ read })
}

