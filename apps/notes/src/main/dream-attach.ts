/**
 * 梦游里的一步：「附件/」根目录平铺的老图挪进引用它的那篇自己的附件文件夹（2026-11-17 用户定，four-items 第 4 节）。
 * 算法在 @cn/format 的 planOldImages；这里在梦游分支的临时检出上 git mv、改链接、一次提交（提交前核对只动了这些文件）。
 * 图不改名、内容不变；笔记只改指向这些图的链接。收下 = 一次提交进 main，可撤回。不依赖 Electron。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodeNote, encodeNote, planOldImages } from '@cn/format'
import * as git from '@cn/git'
import type { DreamItem } from '../shared/api'
import { INBOX } from '../shared/layout'
import { atomicWrite } from '@cn/atomic'

export async function oldImagesOnBranch(
  wt: string,
  mdFiles: string[],
  texts: Map<string, string>,
  commit: (message: string, ok: ReadonlySet<string>) => Promise<string>,
): Promise<Omit<DreamItem, 'id' | 'group' | 'state'> | null> {
  const all = (await git.git(wt, ['ls-files', '-z'])).split('\0').filter(Boolean)
  // 读不懂字节的笔记（只读）不改，它用的图也就不挪
  const notes: { path: string; text: string }[] = []
  for (const p of mdFiles) {
    const meta = decodeNote(await readFile(join(wt, p))).meta
    if (!meta.readOnly) notes.push({ path: p, text: texts.get(p)! })
  }
  const plan = planOldImages(notes, all, { hold: (n) => n.startsWith(INBOX + '/') })
  if (!plan.moves.length) return null
  const ok = new Set<string>()
  for (const m of plan.moves) {
    await mkdir(dirname(join(wt, m.to)), { recursive: true })
    await git.git(wt, ['mv', '--', m.from, m.to])
    ok.add(m.from).add(m.to)
  }
  for (const e of plan.edits) {
    const { meta } = decodeNote(await readFile(join(wt, e.note)))
    await atomicWrite(join(wt, e.note), encodeNote(e.text, meta))
    texts.set(e.note, e.text)
    ok.add(e.note)
  }
  await git.git(wt, ['add', '--', ...plan.edits.map((e) => e.note)])
  const links = plan.edits.reduce((n, e) => n + e.links.length, 0)
  const c = await commit(`梦游：把 ${plan.moves.length} 张老图挪进各篇自己的附件文件夹，改 ${plan.edits.length} 篇里 ${links} 处链接`, ok)
  const shared = plan.kept.filter((k) => k.why === 'shared').length
  return {
    title: `把${plan.moves.length}张老图挪进各篇自己的附件文件夹`,
    sub: `改${plan.edits.length}篇里的链接`,
    why: `这${plan.moves.length}张是按篇分文件夹以前存的，平铺在「附件/」根目录。挪进各篇自己的文件夹，以后删笔记、改名时图跟着走。图不改名，笔记里只改指向它们的链接${shared ? `；${shared}张几篇共用的留在原处` : ''}`,
    commit: c,
    files: [...ok],
    changes: plan.edits.map((e) => ({ path: e.note, text: `改了 ${e.links.length} 处图片链接` })),
    oldImages: {
      moves: plan.moves,
      kept: plan.kept,
      examples: plan.edits.map((e) => ({ note: e.note, before: e.links[0]!.before, after: e.links[0]!.after, count: e.links.length })),
    },
  }
}
