/**
 * AI 对话跟着地方走（D 组 CN-132）：每个文件、文件夹、首页、收件箱各是一个地方，各存各的对话；
 * 读 PDF / HTML、右栏网页上框着问的对话本来就按来源存（userData/reading/），在菜单里的 key 是「read:<来源>」。
 */
import { hostOf, readKey } from '../shared/ai-chats'
import { buildTree, type FileEntry, subtree } from '../shared/files'
import { CLIPS, titleOf } from '../shared/layout'
import type { Tab } from './tabs'
import { getProposal } from './commands/proposals'

/** 一个地方：存对话用的 key，头上胶囊、菜单里写的名字 */
export interface Place {
  key: string
  label: string
}

const lastSeg = (p: string) => p.split('/').pop() || p

/** 书摘的书名：去掉「（微信读书出品）」这类尾巴（D 组小样「书摘：趣说明朝276年」）；整个名字就是括号的照旧 */
export const bookName = (title: string) => title.replace(/\s*[（(][^（）()]*[）)]$/, '') || title

/** 当前标签是哪个地方；digest：开着的这篇是书摘（头上胶囊写短书名） */
export function placeOf(tab: Tab | null, digest = false): Place {
  if (!tab) return { key: 'none', label: '空白页' }
  switch (tab.type) {
    case 'note':
      return { key: `file:${tab.path}`, label: digest ? bookName(titleOf(tab.path)) : titleOf(tab.path) }
    case 'folder':
      return { key: `folder:${tab.folder}`, label: lastSeg(tab.folder) }
    case 'home':
      return { key: 'home', label: '首页' }
    case 'inbox':
      return { key: 'inbox', label: '收件箱' }
    // 剪藏的一个主题就是那个文件夹（剪藏/<主题>，CLIPS）：和它的首页同一段对话
    case 'topic':
      return { key: `folder:${CLIPS}/${tab.topic}`, label: tab.topic }
    case 'recent':
      return { key: 'recent', label: '最近' }
    case 'archive':
      return { key: 'archive', label: '归档' }
    case 'web':
      return { key: `page:${tab.url}`, label: tab.title || hostOf(tab.url) }
    case 'webread':
      return { key: `page:${tab.url}`, label: tab.title || hostOf(tab.url) }
    case 'doubts':
      return { key: `doubts:${tab.folder}`, label: '我的疑惑' }
    case 'diff':
      // AI 命令「先给你看」的对比标签：还是跑命令的那段对话（task-9womr）
      if (tab.src.kind === 'proposal') {
        const p = getProposal(tab.src.id)
        if (p) return p.place
      }
      return { key: `diff:${tab.title}`, label: tab.title }
    case 'oldimages':
      return { key: 'dream', label: '梦游预览' }
    case 'pdf':
    case 'html':
      return { key: readKey(tab.path), label: lastSeg(tab.path) }
  }
}

/** 「看得到」第一颗（这一页）和「能动手」那颗（D 组 CN-132：文件夹页认得出、首页写「首页」，不再写「没打开笔记」） */
export interface Seen {
  see: string
  /** 它在这一页能替你做的；null：这一页没有能动手的 */
  hands: string | null
}

export const HANDS = {
  web: '滚动、选中、剪藏网页',
  board: '挪卡片、排成列、合并',
  doc: '改写、插入、挪块',
  folder: '整理、归类、写小结',
  desk: '整理收件箱、开白板',
} as const

/** 一个文件夹里有几篇（和文件夹首页头上「周记 · 1篇」同一个数：里面所有的 md、PDF、HTML，子文件夹里的也算） */
export function folderCount(folder: string, files: readonly FileEntry[]): number {
  return subtree(buildTree([...files]), folder).reduce((s, x) => s + x.count, 0)
}

/** 这一页在「看得到」里怎么写、能动手做什么；board：这篇是白板（或正在白板看法），digest：这篇是书摘，inbox：收件箱几条，count：文件夹里几篇 */
export function seenOf(tab: Tab | null, o: { board: boolean; digest?: boolean; inbox: number; count(folder: string): number }): Seen {
  if (!tab) return { see: '空白页', hands: null }
  switch (tab.type) {
    case 'note':
      if (o.board) return { see: `白板：${titleOf(tab.path)}`, hands: HANDS.board }
      return { see: o.digest ? `书摘：${bookName(titleOf(tab.path))}` : `文档：${titleOf(tab.path)}`, hands: HANDS.doc }
    case 'folder':
      return { see: `文件夹：${lastSeg(tab.folder)} · ${o.count(tab.folder)}篇`, hands: HANDS.folder }
    case 'topic':
      return { see: `文件夹：${tab.topic} · ${o.count(`${CLIPS}/${tab.topic}`)}篇`, hands: HANDS.folder }
    case 'home':
      return { see: '首页', hands: HANDS.desk }
    case 'inbox':
      return { see: `收件箱${o.inbox}条`, hands: HANDS.desk }
    case 'recent':
      return { see: '最近', hands: null }
    case 'archive':
      return { see: '归档', hands: null }
    case 'web':
      return { see: `网页：${hostOf(tab.url)}`, hands: null }
    case 'webread':
      return { see: `阅读视图：${tab.title || hostOf(tab.url)}`, hands: null }
    case 'doubts':
      return { see: `我的疑惑：${tab.folder || '库的根目录'}`, hands: null }
    case 'diff':
      return { see: `对比：${tab.title}`, hands: null }
    case 'oldimages':
      return { see: '梦游预览', hands: null }
    case 'pdf':
    case 'html':
      return { see: lastSeg(tab.path), hands: null }
  }
}

export { readKey, readLabel, readSrc } from '../shared/ai-chats'
