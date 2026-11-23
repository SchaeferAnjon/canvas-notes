/**
 * 收件箱的归法：收件箱里的东西挪进 课程/<课>/、项目/<项目>/、生活、写作、阅读、周记、剪藏/<主题>/（顶级分类，shared/categories.ts），顺手起个好名字。
 * 梦游（main/dream.ts 第 6 步，在梦游分支上提交）和 /整理收件箱（renderer/AiPanel.tsx，点同意才挪、一次提交）用的是这一份：
 * 问 AI 的话、一批批问、读 AI 的回答、挪过去的路径。纯函数，不碰 Git、不依赖 Electron，主进程和界面都用。
 */
import { HIDDEN_KEYS, readProps } from '@cn/format'
import { catId, catName } from './categories'
import { CLIPS, INBOX, previewOf, titleOf } from './layout'

/** 一节文件夹名：不能点开头、不带 / \ : * ? " < > |，课和项目最长 40 个字、剪藏的主题最长 20 个字 */
const SEG40 = String.raw`[^/\\:*?"<>|.][^/\\:*?"<>|]{0,39}`
const SEG20 = String.raw`[^/\\:*?"<>|.][^/\\:*?"<>|]{0,19}`

/**
 * 能挪去的地方：课程、项目下面一层；生活、写作、阅读、周记本身；剪藏下面一层（主题）。
 * 分类名照这个库的（英文库是 Courses/…、Life…，task-zojmg）；分类名只有汉字和字母，不用转义
 */
const folderRe = () =>
  new RegExp(`^(?:(?:${catName('课程')}|${catName('项目')})/${SEG40}|${catName('生活')}|${catName('写作')}|${catName('阅读')}|${catName('周记')}|${catName('剪藏')}/${SEG20})$`)

export function validFolder(f: string): boolean {
  return folderRe().test(f) && !f.split('/').some((p) => p.trim() !== p || p === '' || p === '..')
}

/** 提示词里「去处只能是」那一串：照这个库的文件夹名写（提示词本身不翻） */
const places = () => `${catName('课程')}/<课名>、${catName('项目')}/<项目名>、${catName('生活')}、${catName('写作')}、${catName('阅读')}、${catName('周记')}、${catName('剪藏')}/<主题>`

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

/**
 * 收件箱里的一条给 AI 看什么：属性（藏起来的不给，剪来的给「剪自」网址：剪藏的来源行在预览里是去掉的，不给就分不出剪来的和自己写的）、
 * 前 300 字；不是文字的（图片、PDF）只给类型和文件名
 */
export function inboxEntry(path: string, text: string | undefined): InboxEntry {
  if (text === undefined) return { path, preview: `（${path.split('.').pop()} 文件）${path.split('/').pop()}`, props: '' }
  const props = readProps(text)
    .filter((x) => x.key === 'source' || !HIDDEN_KEYS.has(x.key))
    .map((x) => `${x.key === 'source' ? '剪自' : x.key}: ${x.value}`)
    .join('；')
  return { path, preview: previewOf(text, 300) || titleOf(path), props }
}

/**
 * 设置 › 梦游 的两个开关怎么组合：both 挪也改名（默认）；move 只挪、名字不改；rename 只在原处改名、不挪。
 * /整理收件箱 一律 move（只给收件箱找地方，名字是你起的）
 */
export type FileMode = 'both' | 'move' | 'rename'

const listed = (entries: InboxEntry[]) => entries.map((e) => `路径：${e.path}\n${e.props ? `属性：${e.props}\n` : ''}内容：${e.preview}`).join('\n\n')

/** 只改名：问 AI 的话（不给去处，name 必填；名字本来就好的不列） */
export function renamePrompt(entries: InboxEntry[]): string {
  return `命令：改名

下面是收件箱里的东西。只起名字，不挪地方：
- 临时名（「导图 11-15 21∶40」「IMG_2041」「未命名」、速记的开头几个字）改成一看就懂的，课程的带上第几讲（如「第3讲 线性映射 导图」）；名字本来就好的不要列出来。名字短一点，不带扩展名。
- 没把握的那条就不要列出来。why 用一句话说为什么叫这个名字。
只输出一个 JSON 代码块：[{"path": "${INBOX}/…", "name": "新名字", "why": "…"}]

${listed(entries)}`
}

export function filePrompt(entries: InboxEntry[], folders: string[], mode: 'both' | 'move' = 'both'): string {
  const name =
    mode === 'move'
      ? '- 名字不改：name 一律写 null。'
      : '- 名字：临时名（「导图 11-15 21∶40」「IMG_2041」「未命名」、速记的开头几个字）改成一看就懂的，课程的带上第几讲（如「第3讲 线性映射 导图」）；名字本来就好就不改（name 写 null）。名字短一点，不带扩展名。'
  return `命令：归类和改名

下面是收件箱里的东西。给每一条找一个去处，必要时起个更好的名字：
- 去处只能是：${places()}。优先用已有的：${folders.join('、') || '（还没有）'}。
- 课程的笔记、导图、课件放进那门课（属性里有课程的就按它）；读的书和划线放 ${catName('阅读')}；从网页、视频、PDF 剪来的原文放 ${catName('剪藏')}/<主题>（属性里有「剪自」网址的就是剪来的）；有终点的事（一次旅行、一次搬家）放 ${catName('项目')}/<项目名>；写给别人看的放 ${catName('写作')}；每周一篇的、要写进周记的放 ${catName('周记')}；一直要照看的日常琐事放 ${catName('生活')}。
- 自己写的东西（没有「剪自」的速记、草稿、想法）不放${catName('剪藏')}。
- 剪藏的主题按大类起（技术、旅行……），已有的主题装得下就放进去，不为一两条另起一个细的。
- 属性里的「原文件夹」是从旧笔记软件导进来时原来所在的文件夹，可以参考，但以内容为准（旧文件夹常常是乱放的）。
${name}
- 没把握的那条就不要列出来，留在收件箱。why 用一句话说为什么放这里${mode === 'move' ? '' : '、为什么叫这个名字'}。
只输出一个 JSON 代码块：[{"path": "${INBOX}/…", "folder": "${catName('课程')}/线性代数", "name": ${mode === 'move' ? 'null' : '"新名字或 null"'}, "why": "…"}]

${listed(entries)}`
}

/** 一次问 AI 多少条（导入几百条时一次问不完，也容易漏） */
export const FILE_BATCH = 40

/**
 * 收件箱一批批问：第一批先问完，它新开的去处（课程/线性代数）告诉后面几批，免得同一门课起出两个名字；
 * 后面的同时问几批（parallel，界面这边一条消息一次只能问一个，给 1）。哪批出错只记一句，别的批照常。返回的方案按收件箱原来的顺序。
 */
export async function planInBatches(
  entries: InboxEntry[],
  folders: string[],
  ask: (prompt: string) => Promise<string>,
  note: (text: string) => void,
  mode: FileMode = 'both',
  { batch = FILE_BATCH, parallel = 3 }: { batch?: number; parallel?: number } = {},
): Promise<FilePlan[]> {
  const known = [...folders]
  const batches: InboxEntry[][] = []
  for (let i = 0; i < entries.length; i += batch) batches.push(entries.slice(i, i + batch))
  const results: FilePlan[][] = batches.map(() => [])
  const one = async (i: number) => {
    const b = batches[i]!
    try {
      const paths = b.map((e) => e.path)
      if (mode === 'rename') results[i] = parseRenames(await ask(renamePrompt(b)), paths)
      else {
        results[i] = parsePlan(await ask(filePrompt(b, known, mode)), paths)
        // 只挪：AI 顺手起了新名也不用
        if (mode === 'move') for (const p of results[i]!) p.name = null
        for (const p of results[i]!) if (!known.includes(p.folder)) known.push(p.folder)
      }
    } catch (e) {
      const where = batches.length > 1 ? `第 ${i * batch + 1}–${i * batch + b.length} 条` : ''
      note(`收件箱${where}没归类：${(e as Error).message}`)
    }
  }
  if (batches.length) await one(0)
  let next = 1
  await Promise.all(
    Array.from({ length: Math.min(parallel, batches.length - 1) }, async () => {
      while (next < batches.length) await one(next++)
    }),
  )
  return results.flat()
}

export function redoPrompt(feedback: string, current: { path: string; folder: string; name: string; why: string }[], folders: string[]): string {
  return `命令：按反馈重做归类

刚才的归类和改名，用户看了以后说：「${feedback}」
按他说的重做下面这几条；他没提到的地方保持原样。去处只能是：${places()}，已有的：${folders.join('、') || '（还没有）'}；他说留在收件箱的，folder 写 "${INBOX}"。
只输出一个 JSON 代码块，只列要变的那几条：[{"path": "${INBOX}/…", "folder": "…", "name": "新名字或 null", "why": "…"}]

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

/** 读只改名的方案：只认收件箱里真有的、名字真变了的；去处就是它现在的文件夹 */
export function parseRenames(reply: string, inbox: readonly string[]): FilePlan[] {
  const raw = jsonBlock(reply)
  if (!Array.isArray(raw)) throw new Error('AI 没给出能用的整理方案')
  const out: FilePlan[] = []
  for (const x of raw as Record<string, unknown>[]) {
    if (typeof x?.path !== 'string' || !inbox.includes(x.path) || out.some((p) => p.path === x.path)) continue
    const name = cleanName(x.name)
    if (!name || name === baseName(x.path)) continue
    out.push({ path: x.path, folder: x.path.split('/').slice(0, -1).join('/'), name, why: typeof x.why === 'string' ? x.why.trim().slice(0, 300) : '' })
  }
  return out
}

const baseName = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '')
const extOf = (p: string) => /\.[^./]+$/.exec(p)?.[0] ?? ''

/** 挪过去的路径（名字重了的由调用方加序号） */
export function targetOf(plan: FilePlan): string {
  return `${plan.folder}/${plan.name ?? baseName(plan.path)}${extOf(plan.path)}`
}

/** 库里已有的去处（给 AI 挑）：课程、项目下面一层，生活、写作、阅读、周记，剪藏的主题 */
export function foldersOf(files: readonly string[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const p = f.split('/')
    // 按分类的身份认（英文库的文件夹叫 Courses、Life…）
    const id = catId(p[0]!)
    if ((id === '课程' || id === '项目') && p.length > 2) out.add(`${p[0]}/${p[1]}`)
    else if ((id === '生活' || id === '写作' || id === '阅读' || id === '周记') && p.length > 1) out.add(p[0]!)
    else if (p[0] === CLIPS && p.length > 2) out.add(`${CLIPS}/${p[1]}`)
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
