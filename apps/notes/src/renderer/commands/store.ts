/**
 * 自己存的 AI 命令在界面这边（task-9womr）：存在库里的那几条就是 ⌘K 自定义里 kind: ai 的（.canvas-notes/命令.json，cmd-store 管写盘和撤回），
 * 只在这台 Mac 上的那几条在软件设置目录（主进程 ai/commands.json）。/ 菜单藏起的、换过的顺序也在命令.json（slash）。
 */
import { useEffect, useSyncExternalStore } from 'react'
import { type AiCmd, aiCmdJson, aiCmdOf, type SlashConfig } from '../../shared/ai-cmds'
import { addOwn, type CmdConfig, deleteOwn, type OwnCommand, updateOwn } from '../../shared/commands'
import { updateCmds, useCmds } from '../search/cmd-store'

let local: AiCmd[] = []
let loaded = false
let version = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const s of subs) s()
}

async function loadLocal() {
  if (loaded) return
  loaded = true
  local = await window.cn.aiCmdLocal()
  emit()
}

function useLocal(): AiCmd[] {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  useEffect(() => void loadLocal(), [])
  return local
}

/** 库里那份里的 AI 命令 */
export const vaultAiCmds = (cfg: CmdConfig): AiCmd[] => cfg.own.flatMap((o) => aiCmdOf(o, 'vault') ?? [])

/** 自己的 AI 命令（库里的在前）和 / 菜单的藏起、顺序 */
export function useAiCmds(): { mine: AiCmd[]; slash: SlashConfig } {
  const cfg = useCmds()
  const loc = useLocal()
  return { mine: [...vaultAiCmds(cfg), ...loc], slash: cfg.slash }
}

/** 只在这台 Mac 上的那几条（App 交给 ⌘K 的命令表） */
export const useLocalAiCmds = (): AiCmd[] => useLocal()
export const localAiCmds = () => local

async function setLocal(list: AiCmd[]) {
  local = list
  emit()
  local = await window.cn.aiCmdSetLocal(list.map(aiCmdJson))
  emit()
}

/** 新命令的编号（own- 开头，⌘K、快捷键、/ 菜单顺序都认它） */
export const newCmdId = () => `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 存一条（新的或改过的）：库里的放进 ⌘K「让AI做」那一组；换了存在哪的，原来那份里的拿掉 */
export async function saveAiCmd(c: AiCmd): Promise<void> {
  const inVault = (cfg: CmdConfig) => cfg.own.some((o) => o.id === c.id)
  const inLocal = local.some((x) => x.id === c.id)
  if (c.store === 'vault') {
    if (inLocal) await setLocal(local.filter((x) => x.id !== c.id))
    const own = aiCmdJson(c) as OwnCommand
    // 分组只写这一条（addOwn 自己带上它）：别的命令这里拿不到它们那一组，写进去会全落到「软件」组
    await updateCmds((cfg) => (inVault(cfg) ? updateOwn(cfg, [], own, 'ai') : addOwn(cfg, [], own, 'ai')))
  } else {
    await updateCmds((cfg) => (inVault(cfg) ? deleteOwn(cfg, c.id) : cfg))
    await setLocal(inLocal ? local.map((x) => (x.id === c.id ? c : x)) : [...local, c])
  }
}

/** 删掉一条（连同它在 ⌘K 哪组、别名、快捷键、/ 菜单的藏起和顺序）；返回撤回要用的 */
export async function deleteAiCmd(c: AiCmd): Promise<() => Promise<void>> {
  if (c.store === 'local') {
    const before = local
    await setLocal(local.filter((x) => x.id !== c.id))
    await updateSlash((s) => ({ hidden: s.hidden.filter((x) => x !== c.id), order: s.order.filter((x) => x !== c.id) }))
    return () => setLocal(before)
  }
  const before = await updateCmds((cfg) => {
    const next = deleteOwn(cfg, c.id)
    return { ...next, slash: { hidden: next.slash.hidden.filter((x) => x !== c.id), order: next.slash.order.filter((x) => x !== c.id) } }
  })
  return async () => void (await updateCmds(() => before))
}

/** / 菜单藏起、换顺序；返回撤回要用的 */
export async function updateSlash(fn: (s: SlashConfig) => SlashConfig): Promise<() => Promise<void>> {
  const before = await updateCmds((cfg) => ({ ...cfg, slash: fn(cfg.slash) }))
  return async () => void (await updateCmds((cfg) => ({ ...cfg, slash: before.slash })))
}
