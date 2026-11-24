/**
 * 梦游夜里做可视化（spec 1.11 最后一条）：挑当天卡得最久的 1 到 3 处（读 PDF 笔记里今天记的段，按问了几轮、
 * 几次「还是不懂 / 换个方式讲」、几条疑惑排），各做一个能拖能点的单文件 HTML，存进那份 PDF 所在的课程文件夹，
 * 嵌进笔记那一段的末尾（单独一段 `![可视化 · 标题](x.html)`，文档里画成能拖的图，task-m552v）。
 * 和梦游别的改动一样在 dream 分支上，一处一个提交，报告里对照看了再收下。
 * 这是梦游「只动收件箱、素材、周记」之外的例外：只新建 HTML、只改那篇读 PDF 笔记里那一段的末尾，提交前核对。
 * 不依赖 Electron，单元测试直接跑。
 */
import { sizeText } from '../shared/diff'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { answerLead, askedAgain, type AskSection, lectureOf, parseReadingNote, prop, upsertSection } from '@cn/format'
import * as git from '@cn/git'
import type { DreamItem } from '../shared/api'
import { extractHtml, VIZ_SYSTEM, vizFileStem, vizTitle, withVizMeta } from './reading/prompts'
import { atomicWrite } from '@cn/atomic'

export type VizAsk = (system: string, prompt: string) => Promise<string>

/** 一处卡住的地方 */
export interface StuckSpot {
  /** 读 PDF 笔记的路径 */
  note: string
  /** 来源 PDF（笔记属性「来源」里的） */
  pdf: string
  section: AskSection
  score: number
}

/**
 * 「还是不懂」了几次：新格式数主对话里那几句原话（「还是不懂」「换个方式讲」），以前的笔记数没讲通的版本
 */
const againOf = (s: AskSection) => (s.qas ? s.qas.slice(1).filter((qa) => askedAgain(qa.q)).length : s.failed.length)

/** 一处卡得多久：问了几轮 + 还是不懂的次数 ×2 + 疑惑条数（新格式：问的每一问，主问题 + 旁支问题） */
export const stuckScore = (s: AskSection) => s.rounds + againOf(s) * 2 + s.doubts.length

/** 今天的提交里记过的读 PDF 笔记段：「笔记：<PDF 名> 第 N 页 · <小标题>」 */
export function todaysSections(subjects: string[]): { stem: string; page: number; title: string }[] {
  const out: { stem: string; page: number; title: string }[] = []
  for (const s of subjects) {
    const m = /^笔记：(.+?) 第 (\d+) 页 · (.+)$/.exec(s.trim())
    if (m) out.push({ stem: m[1]!, page: Number(m[2]), title: m[3]! })
  }
  return out
}

/**
 * 挑今天卡得最久的几处：今天记过（或更新过）、还没有可视化、至少追问过一次或换过讲法的段，按卡住的程度排，最多 max 处
 */
export function stuckSpots(texts: Map<string, string>, today: { stem: string; page: number; title: string }[], max = 3): StuckSpot[] {
  const want = new Set(today.map((t) => `${t.stem}\0${t.page}\0${t.title}`))
  const spots: StuckSpot[] = []
  for (const [path, text] of texts) {
    if (!path.endsWith(' 笔记.md')) continue
    const src = /\[\[([^\]]+\.pdf)\]\]/i.exec(prop(text, '来源') ?? '')?.[1]
    if (!src) continue
    const stem = src.replace(/\.pdf$/i, '')
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    for (const s of parseReadingNote(text, path)) {
      if (s.viz || s.web) continue
      if (!want.has(`${stem}\0${s.page}\0${s.title}`)) continue
      if (s.rounds < 2 && !againOf(s)) continue
      spots.push({ note: path, pdf: dir + src, section: s, score: stuckScore(s) })
    }
  }
  return spots.sort((a, b) => b.score - a.score || a.section.page - b.section.page).slice(0, max)
}

/**
 * 给 AI 的话：这一处他问了什么（新格式是问的原话，主问题 + 旁支问题）、这一轮的小结和最后讲的那一版；
 * 以前的笔记：AI 写的疑惑、哪几版没讲通、最后讲通的讲法
 */
export function dreamVizPrompt(spot: StuckSpot): string {
  const s = spot.section
  const name = spot.pdf.split('/').pop()!.replace(/\.pdf$/i, '')
  const again = againOf(s)
  const head = `命令：梦游可视化
PDF「${name}」第 ${s.page} 页「${s.title}」，他今天在这里卡了很久（问了 ${s.rounds} 轮${again ? `，${again} 次说还是不懂` : ''}）。`
  const body = s.qas
    ? `
他问的（原话）：
${s.doubts.map((d) => `- ${d}`).join('\n') || '- （没记）'}

这一轮的小结：${s.recap || '（没有）'}
最后讲的那一版：${answerLead(s.qas[s.qas.length - 1]?.a ?? '') || '（没有）'}
`
    : `
他的疑惑：
${s.doubts.map((d) => `- ${d}`).join('\n') || '- （没记）'}
${s.failed.length ? `\n没讲通的讲法：\n${s.failed.map((f) => `- 第 ${f.version} 版：${f.line}`).join('\n')}\n` : ''}
最后讲通的讲法：${s.good || '（还没讲通）'}
${s.points.length ? `\n要点：\n${s.points.map((p) => `- ${p}`).join('\n')}\n` : ''}`
  return `${head}
${body}
做一个单文件 HTML 可视化，让他明天自己拖一拖、点一点就看懂这一处。要求：
- 一个完整的 HTML 文件，<!doctype html> 开头；CSS 和 JS 都写在文件里，不引任何外部文件、字体、图片，不联网。
- 能动手：滑块、拖动的点、按钮，动的时候数字和图一起变；关键的数写在图旁边。
- 中文说明，一两句告诉他拖哪里、看什么。
- 浅色深色都看得清（用 prefers-color-scheme），窗口 600 到 1400 宽都放得下。
- <title> 写 8 到 16 个字的标题，像「旋转矩阵 · 拖动角度看基向量」。`
}

/**
 * 在梦游的临时检出 wt 里做可视化：一处一个提交。commit 由梦游给（提交前核对只动了 ok 里的路径）。
 * 返回报告里的条目（不带 id、group、state）；做不成的写进 notes。
 */
export async function makeDreamViz(o: {
  wt: string
  texts: Map<string, string>
  ask: VizAsk
  now: Date
  commit(message: string, ok: ReadonlySet<string>): Promise<string>
  notes: string[]
  /** 哪家哪个模型做的（「Claude Code · Opus 5.5」） */
  by?: string
  /** 最多做几个（设置 › 梦游「一晚最多几个」，默认 3） */
  max?: number
}): Promise<Omit<DreamItem, 'id' | 'group' | 'state'>[]> {
  const { wt, now } = o
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const subjects = (await git.git(wt, ['log', `--since=${start.toISOString()}`, '--format=%s'])).split('\n').filter(Boolean)
  const spots = stuckSpots(o.texts, todaysSections(subjects), o.max)
  const out: Omit<DreamItem, 'id' | 'group' | 'state'>[] = []
  const taken = new Set<string>()
  for (const spot of spots) {
    const s = spot.section
    try {
      const raw = extractHtml(await o.ask(VIZ_SYSTEM, dreamVizPrompt(spot)))
      if (!raw) throw new Error('AI 没做出能打开的网页')
      const title = vizTitle(raw, `第 ${s.page} 页的可视化`)
      const folder = dirname(spot.pdf) === '.' ? '' : dirname(spot.pdf)
      const course = /^课程\/([^/]+)/.exec(folder)?.[1] ?? ''
      const lec = lectureOf(spot.pdf)
      const html = withVizMeta(raw, { 类型: '可视化', 课程: course, 第几讲: lec !== undefined ? String(lec) : '', 来源: `[[${spot.pdf.split('/').pop()}]] 第 ${s.page} 页`, 做的: '梦游', ...(o.by ? { 模型: o.by } : {}) })
      let stem = vizFileStem(title)
      let rel = `${folder ? folder + '/' : ''}${stem}.html`
      for (let n = 2; taken.has(rel) || (await exists(wt, rel)); n++) rel = `${folder ? folder + '/' : ''}${stem} ${n}.html`
      taken.add(rel)
      stem = rel.split('/').pop()!.replace(/\.html$/, '')
      await mkdir(dirname(join(wt, rel)), { recursive: true })
      await atomicWrite(join(wt, rel), html)
      // 嵌进笔记那一段的末尾（单独一段 ![可视化 · 标题](x.html)，文档里画成能拖的图，task-m552v；只换这一段，别的字不动）
      const text = o.texts.get(spot.note)!
      const next = upsertSection(text, { ...s, viz: { path: rel, title, embed: true } }, spot.note)
      await atomicWrite(join(wt, spot.note), next)
      o.texts.set(spot.note, next)
      await git.git(wt, ['add', '--', rel, spot.note])
      const c = await o.commit(`梦游：做了可视化「${title}」（${spot.pdf.split('/').pop()!.replace(/\.pdf$/i, '')} 第 ${s.page} 页）`, new Set([rel, spot.note]))
      out.push({
        title,
        sub: `新文件 ${rel} · 挂到「${spot.note.split('/').pop()!.replace(/\.md$/, '')}」第${s.page}页`,
        why: `你今天在第${s.page}页「${s.title}」问了${s.rounds}轮${againOf(s) ? `、${againOf(s)}次还是不懂` : ''}。做了一个能拖的小网页，收下才进课程文件夹`,
        commit: c,
        files: [rel, spot.note],
        ...(o.by ? { by: o.by } : {}),
        changes: [
          { path: rel, text: `新建，${sizeText(Buffer.byteLength(html))}` },
          { path: spot.note, text: `第${s.page}页那段末尾嵌进可视化` },
        ],
      })
    } catch (e) {
      o.notes.push(`第${s.page}页「${s.title}」的可视化没做成：${(e as Error).message}`)
    }
  }
  return out
}

async function exists(wt: string, rel: string): Promise<boolean> {
  try {
    await git.git(wt, ['cat-file', '-e', `HEAD:${rel}`])
    return true
  } catch {
    return false
  }
}
