/**
 * 回答下面那排的快捷回复在界面这边（task-eavzx）：表存在命令.json 的 replies（cmd-store 管写盘和撤回），
 * 自己的那几颗就是自己的 AI 命令里带 reply 的（commands/store.ts，和选中小条、存成命令同一份）。
 * - 某一处这一排要画的几颗（名字照界面语言，自己的原样）；
 * - 改表（每次改都给撤回）；
 * - 新加一颗快捷回复（设置里「加一颗」、你发的那句「存成快捷回复」），从我的命令里挑一条当快捷回复；
 * - 打开设置 › 选中小条 › 回答下面那排（列表、编辑页）。
 */
import { type AiCmd, instructionOf, rulesOfPrompt } from '../../shared/ai-cmds'
import { t } from '../../shared/i18n'
import { dropReply, placeReply, REPLY_NAME_MAX, replyNameOf, type ReplyConfig, type ReplyItem, type ReplyOut, type ReplyOwn, type ReplyPlace, repliesAt, type ReplyZone, zoneOfReply } from '../../shared/replies'
import { localAiCmds, newCmdId, saveAiCmd, setLocalAiCmds, useAiCmds } from '../commands/store'
import { cmdConfig, updateCmds, useCmds } from '../search/cmd-store'

/** 一条命令点了替你发的那句：快捷回复写的那句，没有的（从我的命令里挑的）照勾着的规矩 */
export const sayOf = (c: AiCmd) => c.prompt ?? instructionOf(c.rules)

/** 名字最多几个字：中文界面 6 个字（这一排就写这几个字），英文界面放宽到 18 个字母 */
export const replyNameMax = () => (t('这条回答') === '这条回答' ? REPLY_NAME_MAX : REPLY_NAME_MAX * 3) // 不翻：拿一句已有的字看界面是不是中文

/** 「存成快捷回复」从你发的那句取名字：中文取前几个字；英文取前三个词 */
export const replyNameFor = (text: string) =>
  replyNameMax() === REPLY_NAME_MAX
    ? replyNameOf(text)
    : text
        .replace(/[，。！？、,.!?；;：:「」"'“”（）()]+/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join(' ')
        .slice(0, replyNameMax())

/** 自己的命令里当快捷回复的那几条 */
export const replyOwnsOf = (mine: readonly AiCmd[]): ReplyOwn[] =>
  mine.flatMap((c) => (c.reply ? [{ id: c.id, name: c.name, where: c.reply.where, say: sayOf(c), out: c.reply.out }] : []))

/** 画出来的一颗：名字照界面语言（自己的原样） */
export interface ReplyBtn extends ReplyItem {
  label: string
}
const btnOf = (it: ReplyItem): ReplyBtn => ({ ...it, label: it.mine ? it.name : t(it.name) })

/** 表和自己的命令（React 里用） */
export function useReplyTable(): { replies: ReplyConfig; mine: AiCmd[] } {
  const cfg = useCmds()
  const { mine } = useAiCmds()
  return { replies: cfg.replies, mine }
}

/** 某一处这一排：排上的、收进 ⋯ 的 */
export function useReplies(place: ReplyPlace): { on: ReplyBtn[]; more: ReplyBtn[] } {
  const { replies, mine } = useReplyTable()
  return replyView(replies, mine, place)
}

export function replyView(replies: ReplyConfig, mine: readonly AiCmd[], place: ReplyPlace): { on: ReplyBtn[]; more: ReplyBtn[] } {
  const v = repliesAt(replies, replyOwnsOf(mine), place)
  return { on: v.on.map(btnOf), more: v.more.map(btnOf) }
}

/** 改表；返回撤回 */
export async function updateReplies(fn: (r: ReplyConfig) => ReplyConfig): Promise<() => Promise<void>> {
  const before = await updateCmds((cfg) => {
    const next = fn(cfg.replies)
    return next === cfg.replies ? cfg : { ...cfg, replies: next }
  })
  return async () => void (await updateCmds((cfg) => ({ ...cfg, replies: before.replies })))
}

/** 新的一颗快捷回复（也是一条命令：⌘K、/ 菜单叫得到；只回答，不改文件） */
export function newReplyCmd(o: { name: string; say: string; where: ReplyPlace[]; out?: ReplyOut; store?: 'vault' | 'local' }): AiCmd {
  const say = o.say.trim()
  return {
    id: newCmdId(),
    name: o.name.trim(),
    rules: rulesOfPrompt(say).length ? rulesOfPrompt(say) : [{ t: o.name.trim() }],
    where: [],
    write: 'answer',
    store: o.store ?? 'vault',
    desc: say.split('\n')[0]!.slice(0, 120),
    prompt: say,
    reply: { where: o.where, out: o.out ?? 'here' },
  }
}

/**
 * 存一颗快捷回复（新的、改过的）并放进表里（新的排在 zone 最后）；返回撤回。
 * 从我的命令里挑的：给它加上 reply（在哪能用默认是 where），原来的规矩、写到哪都不动
 */
export async function saveReply(c: AiCmd, zone: ReplyZone = 'on'): Promise<() => Promise<void>> {
  const before = cmdConfig()
  const beforeLocal = localAiCmds()
  await saveAiCmd(c)
  await updateReplies((r) => (zoneOfReply(r, c.id) ? r : placeReply(r, c.id, zone)))
  return async () => {
    await updateCmds(() => before)
    if (c.store === 'local' || beforeLocal.some((x) => x.id === c.id)) await setLocalAiCmds(beforeLocal)
  }
}

/** 不再当快捷回复（命令留着）：拿掉 reply、从表里拿掉；返回撤回 */
export async function unReply(c: AiCmd): Promise<() => Promise<void>> {
  const before = cmdConfig()
  const beforeLocal = localAiCmds()
  const { reply: _, ...rest } = c
  await saveAiCmd(rest)
  await updateReplies((r) => dropReply(r, c.id))
  return async () => {
    await updateCmds(() => before)
    if (c.store === 'local') await setLocalAiCmds(beforeLocal)
  }
}

// ---------------------------------------------------------------- 打开设置

/** 打开设置 › 回答下面那排：列表（某一处的样子），或者编辑一颗（新的、改哪一颗、填好的） */
export interface OpenReplies {
  view: 'list' | 'edit'
  /** 列表上面「这一排现在是这样」先看哪一处 */
  place?: ReplyPlace
  /** 编辑哪一颗（没给是新的一颗） */
  id?: string
  /** 新的一颗先填好的（复制一份再改） */
  preset?: { name: string; say: string; where: ReplyPlace[] }
}

let req: { o: OpenReplies; seq: number } | null = null
const reqSubs = new Set<() => void>()
export const repliesRequestNow = () => req
export function onRepliesRequest(f: () => void): () => void {
  reqSubs.add(f)
  return () => reqSubs.delete(f)
}

/** 打开设置 › 回答下面那排（App 听 cn:open-settings） */
export function openRepliesSettings(o: OpenReplies) {
  req = { o, seq: (req?.seq ?? 0) + 1 }
  for (const f of reqSubs) f()
  window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: 'replies' }))
}
