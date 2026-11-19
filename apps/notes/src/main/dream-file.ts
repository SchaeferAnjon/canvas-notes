/**
 * 梦游的「归类和改名」：收件箱里的东西挪进 课程/<课>/、项目/<项目>/、生活/、写作/、阅读/、周记/、剪藏/<主题>/（顶级分类，shared/categories.ts），顺手起个好名字。
 * 这里是不碰 Git 的纯函数（问 AI 的话、读 AI 的回答、挪动后文件里要跟着改的地方），dream.ts 用它们在梦游分支上提交。
 */
import { relativeLink, resolveLink } from '@cn/format'
import { CLIPS, INBOX, titleOf } from '../shared/layout'

/** 能挪去的地方：课程、项目下面一层；生活、写作、阅读、周记本身；剪藏下面一层（主题） */
const FOLDER = /^(?:(?:课程|项目)\/[^/\\:*?"<>|.][^/\\:*?"<>|]{0,39}|生活|写作|阅读|周记|剪藏\/[^/\\:*?"<>|.][^/\\:*?"<>|]{0,19})$/

export function validFolder(f: string): boolean {
  return FOLDER.test(f) && !f.split('/').some((p) => p.trim() !== p || p === '' || p === '..')
}

/** 新名字：去掉文件名里不能有的字符，不超过 60 个字；空的不算 */
export function cleanName(n: unknown): string | null {
  if (typeof n !== 'string') return null
  const s = n
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
  return s || null
}

export interface FilePlan {
  path: string
  folder: string
  /** 新名字（不带扩展名）；不改名是 null */
  name: string | null
  why: string
}

/** 收件箱里的一条，给 AI 看的样子 */
export interface InboxEntry {
  path: string
  preview: string
  props: string
}

export function filePrompt(entries: InboxEntry[], folders: string[]): string {
  return `命令：归类和改名

下面是收件箱里的东西。给每一条找一个去处，必要时起个更好的名字：
- 去处只能是：课程/<课名>、项目/<项目名>、生活、写作、阅读、周记、剪藏/<主题>。优先用已有的：${folders.join('、') || '（还没有）'}。
- 课程的笔记、导图、课件放进那门课（属性里有课程的就按它）；读的书和划线放 阅读；从网页、视频、PDF 剪来的原文放 剪藏/<主题>；有终点的事（一次旅行、一次搬家）放 项目/<项目名>；写给别人看的放 写作；每周一篇的放 周记；一直要照看的日常琐事放 生活。
- 剪藏的主题按大类起（技术、旅行……），已有的主题装得下就放进去，不为一两条另起一个细的。
- 属性里的「原文件夹」是从旧笔记软件导进来时原来所在的文件夹，可以参考，但以内容为准（旧文件夹常常是乱放的）。
- 名字：临时名（「导图 11-15 21∶40」「IMG_2041」「未命名」、速记的开头几个字）改成一看就懂的，课程的带上第几讲（如「第3讲 线性映射 导图」）；名字本来就好就不改（name 写 null）。名字短一点，不带扩展名。
- 没把握的那条就不要列出来，留在收件箱。why 用一句话说为什么放这里、为什么叫这个名字。
只输出一个 JSON 代码块：[{"path": "收件箱/…", "folder": "课程/线性代数", "name": "新名字或 null", "why": "…"}]

${entries.map((e) => `路径：${e.path}\n${e.props ? `属性：${e.props}\n` : ''}内容：${e.preview}`).join('\n\n')}`
}

/** 一次问 AI 多少条（导入几百条时一次问不完，也容易漏） */
export const FILE_BATCH = Number(process.env.CN_DREAM_BATCH) || 40
/** 第一批之后同时问几批 */
const PARALLEL = Number(process.env.CN_DREAM_PARALLEL) || 3

/**
 * 收件箱一批批问：第一批先问完，它新开的去处（课程/线性代数）告诉后面几批，免得同一门课起出两个名字；
 * 后面的同时问几批。哪批出错只记一句，别的批照常。返回的方案按收件箱原来的顺序。
 */
export async function planInBatches(entries: InboxEntry[], folders: string[], ask: (prompt: string) => Promise<string>, note: (text: string) => void): Promise<FilePlan[]> {
  const known = [...folders]
  const batches: InboxEntry[][] = []
  for (let i = 0; i < entries.length; i += FILE_BATCH) batches.push(entries.slice(i, i + FILE_BATCH))
  const results: FilePlan[][] = batches.map(() => [])
  const one = async (i: number) => {
    const b = batches[i]!
    try {
      results[i] = parsePlan(await ask(filePrompt(b, known)), b.map((e) => e.path))
      for (const p of results[i]!) if (!known.includes(p.folder)) known.push(p.folder)
    } catch (e) {
      const where = batches.length > 1 ? `第 ${i * FILE_BATCH + 1}–${i * FILE_BATCH + b.length} 条` : ''
      note(`收件箱${where}没归类：${(e as Error).message}`)
    }
  }
  if (batches.length) await one(0)
  let next = 1
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, batches.length - 1) }, async () => {
      while (next < batches.length) await one(next++)
    }),
  )
  return results.flat()
}

export function redoPrompt(feedback: string, current: { path: string; folder: string; name: string; why: string }[], folders: string[]): string {
  return `命令：按反馈重做归类

刚才的归类和改名，用户看了以后说：「${feedback}」
按他说的重做下面这几条；他没提到的地方保持原样。去处只能是：课程/<课名>、项目/<项目名>、生活、写作、阅读、周记、剪藏/<主题>，已有的：${folders.join('、') || '（还没有）'}；他说留在收件箱的，folder 写 "收件箱"。
只输出一个 JSON 代码块，只列要变的那几条：[{"path": "收件箱/…", "folder": "…", "name": "新名字或 null", "why": "…"}]

${current.map((c) => `路径：${c.path}\n现在：挪到 ${c.folder}，名字「${c.name}」\n为什么：${c.why}`).join('\n\n')}`
}

function jsonBlock(reply: string): unknown {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(reply) ?? /(\[[\s\S]*\])/.exec(reply)
  if (!m) throw new Error('AI 没给出能用的整理方案')
  return JSON.parse(m[1]!)
}

/**
 * 读 AI 的方案：只认收件箱里真有的、去处合规的；同一条只认第一次。
 * stay 为 true 时 folder 可以是「收件箱」（重做时用户说留着）。
 */
export function parsePlan(reply: string, inbox: readonly string[], stay = false): FilePlan[] {
  const raw = jsonBlock(reply)
  if (!Array.isArray(raw)) throw new Error('AI 没给出能用的整理方案')
  const out: FilePlan[] = []
  for (const x of raw as Record<string, unknown>[]) {
    if (typeof x?.path !== 'string' || typeof x.folder !== 'string') continue
    const folder = x.folder.trim().replace(/\/+$/, '')
    if (!inbox.includes(x.path) || out.some((p) => p.path === x.path)) continue
    if (!(validFolder(folder) || (stay && folder === INBOX))) continue
    const name = cleanName(x.name)
    out.push({ path: x.path, folder, name: name && name !== baseName(x.path) ? name : null, why: typeof x.why === 'string' ? x.why.trim().slice(0, 300) : '' })
  }
  return out
}

const baseName = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '')
const extOf = (p: string) => /\.[^./]+$/.exec(p)?.[0] ?? ''

/** 挪过去的路径（名字重了的由调用方加序号） */
export function targetOf(plan: FilePlan): string {
  return `${plan.folder}/${plan.name ?? baseName(plan.path)}${extOf(plan.path)}`
}

/**
 * 挪动后 md 里跟着改的：开头的一级标题是旧名就换成新名；相对链接（图片、附件）按新位置重算。
 * 别的一个字不动。
 */
export function movedText(text: string, from: string, to: string): string {
  const oldTitle = titleOf(from)
  const newTitle = titleOf(to)
  let out = text
  if (oldTitle !== newTitle) {
    const fm = /^---\n[\s\S]*?\n---\n/.exec(out)?.[0] ?? ''
    const rest = out.slice(fm.length)
    const h = new RegExp(`^(\\n*)# ${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*(\\n|$)`).exec(rest)
    if (h) out = fm + h[1] + `# ${newTitle}` + h[2] + rest.slice(h[0].length)
  }
  if (from.split('/').slice(0, -1).join('/') !== to.split('/').slice(0, -1).join('/')) {
    out = out.replace(/(!?\[[^\]\n]*\]\()([^)\s]+)(\))/g, (all, a: string, url: string, b: string) => {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return all
      const abs = resolveLink(from, url)
      return abs ? a + relativeLink(to, abs) + b : all
    })
  }
  return out
}

/** 改名后别的笔记里的 [[旧名]]、[[旧名|…]]、[[旧名#…]] 换成新名 */
export function relinkText(text: string, oldName: string, newName: string): string {
  if (oldName === newName) return text
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`\\[\\[${esc}(?=[\\]|#^])`, 'g'), `[[${newName}`)
}

/** 库里已有的去处（给 AI 挑）：课程、项目下面一层，生活、写作、阅读、周记，剪藏的主题 */
export function foldersOf(files: readonly string[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const p = f.split('/')
    if ((p[0] === '课程' || p[0] === '项目') && p.length > 2) out.add(`${p[0]}/${p[1]}`)
    else if ((p[0] === '生活' || p[0] === '写作' || p[0] === '阅读' || p[0] === '周记') && p.length > 1) out.add(p[0]!)
    else if (p[0] === CLIPS && p.length > 2) out.add(`${CLIPS}/${p[1]}`)
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
