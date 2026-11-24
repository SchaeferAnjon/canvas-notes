/**
 * 收件箱的归法：收件箱角色的文件夹里的东西挪进这个库已有的文件夹（照它的分法：shared/vault-roles.ts，task-h7oy8），顺手起个好名字。
 * 画布笔记自己的库就是 课程/<课>、项目/<项目>、生活、写作、阅读、周记、剪藏/<主题>；从别的软件搬来的库（00-Inbox、PARA、按年份）照它自己的文件夹。
 * 梦游（main/dream.ts 第 6 步，在梦游分支上提交）和 /整理收件箱（renderer/AiPanel.tsx，点同意才挪、一次提交）用的是这一份：
 * 问 AI 的话、一批批问、读 AI 的回答、挪过去的路径。纯函数，不碰 Git、不依赖 Electron，主进程和界面都用。
 */
import { HIDDEN_KEYS, readProps } from '@cn/format'
import { previewOf, titleOf } from './layout'
import { DEST_ROLES, missingCategoryRows, NEW_OK_ROLES, type Role, roleZh, rowOf, type RoleRow } from './vault-roles'

/** 新建的一层文件夹名：不能点开头、不带 / \ : * ? " < > |，最长 40 个字 */
const SEG = /^[^/\\:*?"<>|.][^/\\:*?"<>|]{0,39}$/

/**
 * 能挪去的一个文件夹：它的角色、直接放着几篇、几篇例子（给 AI 学这个库现在怎么放）。
 * direct：能直接放进去（课程、项目、剪藏这种「下面一门课一个文件夹」的，自己没直接放笔记时只放子文件夹）；
 * newOk：能在它下面新建一层（一门新课、新项目、剪藏的新主题、按时间的新月份）
 */
export interface Place {
  folder: string
  role: Role
  n: number
  examples: string[]
  direct: boolean
  newOk: boolean
}

/** 附件、图片这种子文件夹不当去处 */
const ASSETS = /^(_?attachments?|_?assets?|images?|imgs?|pics?|media|附件|图片|_resources)$/i

/**
 * 这个库里能挪去的文件夹：角色能当去处的那几行下面、放着笔记的每一层（连同它们的上一层）；
 * 画布笔记自己的库里还没建的分类也算（第一次往里放时才建）。files 是库里文件的相对路径
 */
export function placesOf(files: readonly string[], rows: readonly RoleRow[]): Place[] {
  const all = [...rows, ...missingCategoryRows(rows)]
  const map = new Map<string, { role: Role; names: string[] }>()
  const add = (folder: string, role: Role) => map.get(folder) ?? map.set(folder, { role, names: [] }).get(folder)!
  for (const r of all) if (DEST_ROLES.has(r.role)) add(r.folder, r.role)
  for (const f of files) {
    if (!/\.(md|pdf)$/i.test(f) || !f.includes('/')) continue
    const dir = f.slice(0, f.lastIndexOf('/'))
    const row = rowOf(all, dir)
    if (!row || !DEST_ROLES.has(row.role) || dir.split('/').some((s) => s.startsWith('.') || ASSETS.test(s))) continue
    add(dir, row.role).names.push(titleOf(f))
    // 上一层也是去处（只放子文件夹的那种）
    for (let d = dir; d.length > row.folder.length && d.includes('/'); ) {
      d = d.slice(0, d.lastIndexOf('/'))
      add(d, row.role)
    }
  }
  const out: Place[] = []
  for (const [folder, { role, names }] of map) {
    const newOk = NEW_OK_ROLES.has(role)
    const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    // 例子挑头、中间、尾巴三篇（别都是同一讲的）
    const examples = sorted.length <= 3 ? sorted : [sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!]
    out.push({ folder, role, n: names.length, examples: examples.map((e) => (e.length > 30 ? e.slice(0, 30) + '…' : e)), direct: !newOk || names.length > 0, newOk })
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder, 'zh-CN'))
}

/** 一行给 AI 看的去处：「- 课程/线性代数｜课程｜12 篇，如：第1讲、第5讲、期末」 */
const placeLine = (p: Place) =>
  `- ${p.folder}｜${roleZh(p.role)}｜${p.n ? `${p.n} 篇，如：${p.examples.join('、')}` : '还没有笔记'}${p.direct ? '' : '｜只放子文件夹'}${p.newOk ? '｜能新建一层' : ''}`

/** 归类去处合规吗：列着的、能直接放的文件夹；或者能新建一层的文件夹下面新的一层（名字合规） */
export function validFolder(f: string, places: readonly Place[]): boolean {
  if (f.split('/').some((p) => p.trim() !== p || p === '' || p === '..' || p.startsWith('.'))) return false
  const at = places.find((p) => p.folder === f)
  if (at) return at.direct
  const i = f.lastIndexOf('/')
  if (i < 0) return false
  const parent = places.find((p) => p.folder === f.slice(0, i))
  return !!parent?.newOk && SEG.test(f.slice(i + 1)) && !ASSETS.test(f.slice(i + 1))
}

/** 这几种角色怎么放（库里有这种角色的文件夹才说那一句；提示词不翻） */
const ROLE_HINTS: [Role, string][] = [
  ['course', '一门课的讲义、作业、导图、疑惑放进那门课的文件夹（属性里有课程的按它；有按讲分的子文件夹就放进那一讲）'],
  ['clip', '从网页、视频、PDF 剪来的原文（属性里有「剪自」网址的）放剪藏角色的文件夹，按主题放；自己写的速记、想法不放这里'],
  ['reading', '读的书和划线、读书笔记放阅读角色的文件夹'],
  ['project', '有终点的事（一次旅行、一次搬家、一个要做完的东西）放进那个项目的文件夹'],
  ['area', '一直要照看、没有终点的事（身体、钱、家、工作的某一块）放进那个领域'],
  ['resource', '以后可能用得上的主题资料放进那个主题'],
  ['writing', '写给别人看的（文章、文案、脚本）放写作角色的文件夹'],
  ['life', '一直要照看的日常琐事放生活角色的文件夹'],
  ['journal', '某一天的流水记录放日记角色的文件夹，照那里的命名和分层'],
  ['weekly', '每周一篇的、要写进周记的放周记角色的文件夹'],
  ['chrono', '按时间分的文件夹：照笔记自己的日期（属性 created、date，文件名里的日期）放进那一年那一月的文件夹，起名照已有的月份文件夹；看不出日期的算拿不准'],
]

/** 提示词里的去处清单：给 AI 每个文件夹的角色和几篇现有笔记名 */
function placesText(places: readonly Place[]): string {
  const roles = new Set(places.map((p) => p.role))
  return `这个库的文件夹（「｜」后面是它的角色、里面有几篇、几篇例子）：
${places.map(placeLine).join('\n') || '（还没有）'}

- 去处只能是上面列着的文件夹，原样照抄；标了「只放子文件夹」的，选它下面的一个；标了「能新建一层」的，上面实在没有合适的才在它下面新建一层（名字照旁边那几个的起法），不要另起和已有的意思一样的。
- 照这个库现在的放法：和哪个文件夹里的例子最像就放哪；有更细的一层就放进最贴切的那一层。
${ROLE_HINTS.filter(([r]) => roles.has(r))
  .map(([, h]) => `- ${h}。`)
  .join('\n')}`
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
  /** 去处是新建的一层（报告里标出来） */
  fresh?: boolean
}

/** 拿不准、留在收件箱的一条和为什么 */
export interface FileStay {
  path: string
  why: string
}

/** 收件箱里的一条，给 AI 看的样子 */
export interface InboxEntry {
  path: string
  preview: string
  props: string
}

/**
 * 收件箱里的一条给 AI 看什么：属性（藏起来的不给，剪来的给「剪自」网址：剪藏的来源行在预览里是去掉的，不给就分不出剪来的和自己写的；
 * 建的日期给：按时间分的库照它放）、前 300 字；不是文字的（图片、PDF）只给类型和文件名
 */
export function inboxEntry(path: string, text: string | undefined): InboxEntry {
  if (text === undefined) return { path, preview: `（${path.split('.').pop()} 文件）${path.split('/').pop()}`, props: '' }
  const props = readProps(text)
    .filter((x) => x.key === 'source' || x.key === 'created' || !HIDDEN_KEYS.has(x.key))
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
const inboxOf = (entries: InboxEntry[]) => entries[0]?.path.slice(0, entries[0].path.lastIndexOf('/')) || '收件箱'

/** 只改名：问 AI 的话（不给去处，name 必填；名字本来就好的不列） */
export function renamePrompt(entries: InboxEntry[]): string {
  return `命令：改名

下面是收件箱里的东西。只起名字，不挪地方：
- 临时名（「导图 11-15 21∶40」「IMG_2041」「未命名」、速记的开头几个字）改成一看就懂的，课程的带上第几讲（如「第3讲 线性映射 导图」）；名字本来就好的不要列出来。名字短一点，不带扩展名。
- 没把握的那条就不要列出来。why 用一句话说为什么叫这个名字。
只输出一个 JSON 代码块：[{"path": "${inboxOf(entries)}/…", "name": "新名字", "why": "…"}]

${listed(entries)}`
}

export function filePrompt(entries: InboxEntry[], places: readonly Place[], mode: 'both' | 'move' = 'both'): string {
  const name =
    mode === 'move'
      ? '- 名字不改：name 一律写 null。'
      : '- 名字：临时名（「导图 11-15 21∶40」「IMG_2041」「未命名」、速记的开头几个字）改成一看就懂的，课程的带上第几讲（如「第3讲 线性映射 导图」）；名字本来就好、或者照这个库的命名法（日期开头、编号开头）起的就不改（name 写 null）。名字短一点，不带扩展名。'
  return `命令：归类和改名

下面是收件箱里的东西。照这个库已有的放法给每一条找一个去处，必要时起个更好的名字。
${placesText(places)}
- 属性里的「原文件夹」是从旧笔记软件导进来时原来所在的文件夹，可以参考，但以内容为准（旧文件夹常常是乱放的）。
${name}
- 准确第一：拿不准放哪的，folder 写 null，why 写为什么拿不准（如「像课程笔记，但看不出是哪门课」），这条留在收件箱等人定。
- why 用一句话说为什么放这里${mode === 'move' ? '' : '、为什么叫这个名字'}。
只输出一个 JSON 代码块，每条都要列：[{"path": "${inboxOf(entries)}/…", "folder": "<上面的一个文件夹>", "name": ${mode === 'move' ? 'null' : '"新名字或 null"'}, "why": "…"}]

${listed(entries)}`
}

/** 一次问 AI 多少条（导入几百条时一次问不完，也容易漏） */
export const FILE_BATCH = 40

/** 第一批新开的那一层，后面几批也能选（能直接放、标着是新的） */
function withNew(places: Place[], plans: FilePlan[]): Place[] {
  for (const p of plans) {
    if (places.some((x) => x.folder === p.folder)) continue
    const parent = places.find((x) => p.folder.startsWith(x.folder + '/'))
    if (parent) places.push({ folder: p.folder, role: parent.role, n: 0, examples: [], direct: true, newOk: false })
  }
  return places
}

/**
 * 收件箱一批批问：第一批先问完，它新开的去处（课程/线性代数）告诉后面几批，免得同一门课起出两个名字；
 * 后面的同时问几批（parallel，界面这边一条消息一次只能问一个，给 1）。哪批出错只记一句，别的批照常。返回的方案按收件箱原来的顺序。
 * stays：AI 说拿不准的那几条和为什么（报告里列）
 */
export async function planInBatches(
  entries: InboxEntry[],
  places: readonly Place[],
  ask: (prompt: string) => Promise<string>,
  note: (text: string) => void,
  mode: FileMode = 'both',
  { batch = FILE_BATCH, parallel = 3, stays }: { batch?: number; parallel?: number; stays?: FileStay[] } = {},
): Promise<FilePlan[]> {
  const known = [...places]
  const batches: InboxEntry[][] = []
  for (let i = 0; i < entries.length; i += batch) batches.push(entries.slice(i, i + batch))
  const results: FilePlan[][] = batches.map(() => [])
  const one = async (i: number) => {
    const b = batches[i]!
    try {
      const paths = b.map((e) => e.path)
      if (mode === 'rename') results[i] = parseRenames(await ask(renamePrompt(b)), paths)
      else {
        results[i] = parsePlan(await ask(filePrompt(b, known, mode)), paths, { places: known, ...(stays ? { stays } : {}) })
        // 只挪：AI 顺手起了新名也不用
        if (mode === 'move') for (const p of results[i]!) p.name = null
        withNew(known, results[i]!)
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

export function redoPrompt(feedback: string, current: { path: string; folder: string; name: string; why: string }[], places: readonly Place[]): string {
  return `命令：按反馈重做归类

刚才的归类和改名，用户看了以后说：「${feedback}」
按他说的重做下面这几条；他没提到的地方保持原样。
${placesText(places)}
- 他说留在收件箱的，folder 写 null。
只输出一个 JSON 代码块，只列要变的那几条：[{"path": "<收件箱路径>", "folder": "…", "name": "新名字或 null", "why": "…"}]

${current.map((c) => `路径：${c.path}\n现在：挪到 ${c.folder}，名字「${c.name}」\n为什么：${c.why}`).join('\n\n')}`
}

function jsonBlock(reply: string): unknown {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(reply) ?? /(\[[\s\S]*\])/.exec(reply)
  if (!m) throw new Error('AI 没给出能用的整理方案')
  return JSON.parse(m[1]!)
}

/**
 * 读 AI 的方案：只认收件箱里真有的、去处合规的（照这个库的去处）；同一条只认第一次。
 * stay 为 true 时 folder 可以是 null 或收件箱自己（重做时用户说留着），这时 folder 是它原来的文件夹。
 * stays：拿不准、写了 null 的那几条和为什么
 */
export function parsePlan(reply: string, inbox: readonly string[], o: { places: readonly Place[]; stay?: boolean; stays?: FileStay[] }): FilePlan[] {
  const raw = jsonBlock(reply)
  if (!Array.isArray(raw)) throw new Error('AI 没给出能用的整理方案')
  const out: FilePlan[] = []
  const seen = new Set<string>()
  for (const x of raw as Record<string, unknown>[]) {
    if (typeof x?.path !== 'string' || !inbox.includes(x.path) || seen.has(x.path)) continue
    const why = typeof x.why === 'string' ? x.why.trim().slice(0, 300) : ''
    const home = x.path.slice(0, x.path.lastIndexOf('/'))
    const folder = typeof x.folder === 'string' ? x.folder.trim().replace(/\/+$/, '') : null
    if (folder === null || folder === '' || folder === home) {
      seen.add(x.path)
      if (o.stay) out.push({ path: x.path, folder: home, name: null, why })
      else o.stays?.push({ path: x.path, why })
      continue
    }
    if (!validFolder(folder, o.places)) continue
    seen.add(x.path)
    const name = cleanName(x.name)
    out.push({ path: x.path, folder, name: name && name !== baseName(x.path) ? name : null, why, ...(o.places.some((p) => p.folder === folder) ? {} : { fresh: true }) })
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
