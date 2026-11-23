/**
 * 跑选中小条上自己加的那颗（task-26nz7）：拿选中的那段（框一块时是框下来的图）照这条命令的提示词问，
 * 写进笔记（带框带标志的 AI 块，和「讲解一下」走同一条路）或只在右栏 AI 里答。
 * 「加一颗…」「小条设置…」「改名单」打开设置 › 选中小条（App 登记怎么打开）。
 */
import { type AiCmd, instructionOf, type Where } from '../../shared/ai-cmds'
import { type BarZone, dropFromBar, fillPrompt, placeOwn, zoneOf } from '../../shared/sel-bar'
import { localAiCmds, saveAiCmd, setLocalAiCmds } from '../commands/store'
import { cmdConfig, updateCmds } from '../search/cmd-store'
import { mineNow, updateBar } from './store'

/** 打开设置 › 选中小条：列表（翻到某一段），或者编辑一颗（新的、改哪一颗）；sample 是拿来举例的那段（网页上选着的） */
export interface OpenBar {
  view: 'list' | 'edit'
  /** 列表翻到哪一段：on 总开关那一段、sites 不弹的网站 */
  focus?: 'on' | 'sites'
  /** 编辑哪一颗（没给是新的一颗） */
  id?: string
  /** 编辑页先把快捷键按钮点开 */
  key?: boolean
  /** 新的一颗先填好的（复制一份再改） */
  preset?: { name: string; prompt: string; where: string[] }
  sample?: Sample
}

/** 拿来举例、填空用的：选中的字、这一页的标题、网址、上面的小标题 */
export interface Sample {
  text: string
  title?: string
  url?: string
  head?: string
}

/** 最近一次要打开的样子（设置页照它换到列表、编辑页）；seq 变了就是新的一次 */
let req: { o: OpenBar; seq: number } | null = null
const reqSubs = new Set<() => void>()
export const barRequestNow = () => req
export function onBarRequest(f: () => void): () => void {
  reqSubs.add(f)
  return () => reqSubs.delete(f)
}

/** 打开设置 › 选中小条（App 听 cn:open-settings）：翻到列表的某一段，或者打开编辑页 */
export function openBarSettings(o: OpenBar) {
  req = { o, seq: (req?.seq ?? 0) + 1 }
  for (const f of reqSubs) f()
  const row = o.view === 'list' && o.focus ? (o.focus === 'sites' ? 'barSites' : 'barOn') : null
  window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: row ? { row } : 'selbar' }))
}

/** 这条命令（库里的、这台 Mac 上的） */
export const cmdById = (id: string): AiCmd | undefined => mineNow().find((c) => c.id === id)

/** 这条命令交给 AI 的说明：小条上加的照提示词，「存成命令」存的照勾着的规矩 */
export const cmdPrompt = (c: AiCmd) => c.prompt ?? instructionOf(c.rules)

/** 填好空的那句（选中的那段也带着交给 AI，没写 {选中的字} 也收得到） */
export const cmdText = (c: AiCmd, s: Sample) => fillPrompt(cmdPrompt(c), { sel: s.text, title: s.title ?? '', url: s.url ?? '', head: s.head ?? '' }).text || c.name

/** 结果去哪：写进笔记（默认）还是只在 AI 栏答 */
export const cmdOut = (c: AiCmd) => c.out ?? 'note'

/**
 * 放到选中小条（设置里「从我的命令里挑…」、⌘K 和 / 菜单一条命令的右键、「存成命令」那张表的「选中小条」一行）：
 * 想放条上、满了收进 ⋯；放上以后它在网页、PDF、HTML、文档都能用（「在哪能用」加上这四处）。want 是 null：从表里拿掉。
 * 返回放进了哪段（拿掉是 null）和撤回
 */
export async function putOnBar(c: AiCmd, want: BarZone | null = 'on'): Promise<{ zone: BarZone | null; undo: () => Promise<void> }> {
  const before = cmdConfig()
  const beforeLocal = localAiCmds()
  let zone: BarZone | null = null
  if (want) {
    const where = [...new Set<Where>([...c.where, 'web', 'pdf', 'html', 'doc'])]
    if (where.length !== c.where.length) await saveAiCmd({ ...c, where })
    await updateBar((b) => {
      if (zoneOf(b, c.id) === want) return ((zone = want), b)
      const r = placeOwn(b, c.id, want)
      zone = r.zone
      return r.config
    })
  } else await updateBar((b) => dropFromBar(b, c.id))
  return {
    zone,
    undo: async () => {
      await updateCmds(() => before)
      if (c.store === 'local') await setLocalAiCmds(beforeLocal)
    },
  }
}
