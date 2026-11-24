/**
 * AI 对话跟着地方走（D 组 CN-132）：每个文件、文件夹、首页、收件箱各是一个地方，各存各的对话；
 * 读 PDF / HTML、右栏网页上框着问的对话本来就按来源存（userData/reading/），在菜单里的 key 是「read:<来源>」。
 */
import { hostOf, readKey } from '../shared/ai-chats'
import { buildTree, type FileEntry, subtree } from '../shared/files'
import { CLIPS, INBOX, titleOf } from '../shared/layout'
import type { Tab } from './tabs'
import { getProposal } from './commands/proposals'
import { t } from '../shared/i18n'

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
  if (!tab) return { key: 'none', label: t('空白页') }
  switch (tab.type) {
    case 'note':
      return { key: `file:${tab.path}`, label: digest ? bookName(titleOf(tab.path)) : titleOf(tab.path) }
    case 'folder':
    // 文件夹里那一类的列表：和这个文件夹的首页同一段对话
    case 'flist':
      return { key: `folder:${tab.folder}`, label: lastSeg(tab.folder) }
    case 'home':
      return { key: 'home', label: t('首页') }
    case 'inbox':
      return { key: 'inbox', label: INBOX }
    // 剪藏的一个主题就是那个文件夹（剪藏/<主题>，CLIPS）：和它的首页同一段对话
    case 'topic':
      return { key: `folder:${CLIPS}/${tab.topic}`, label: tab.topic }
    case 'recent':
      return { key: 'recent', label: t('最近') }
    case 'archive':
      return { key: 'archive', label: t('归档') }
    case 'web':
      return { key: `page:${tab.url}`, label: tab.title || hostOf(tab.url) }
    case 'webread':
      return { key: `page:${tab.url}`, label: tab.title || hostOf(tab.url) }
    case 'diff':
      // AI 命令「先给你看」的对比标签：还是跑命令的那段对话（task-9womr）
      if (tab.src.kind === 'proposal') {
        const p = getProposal(tab.src.id)
        if (p) return p.place
      }
      return { key: `diff:${tab.title}`, label: tab.title }
    case 'oldimages':
      return { key: 'dream', label: t('梦游预览') }
    case 'trash':
      return { key: 'trash', label: t('最近删掉的') }
    case 'todo':
      return { key: 'todo', label: t('待办') }
    case 'calendar':
      return { key: 'calendar', label: t('日历') }
    case 'growth':
      return { key: 'growth', label: t('生长') }
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

// 不翻：键，画的地方翻（AiPanel 里「能动手」那颗 t(hands)）
export const HANDS = {
  web: '点、填表、剪藏网页', // 不翻
  board: '挪卡片、排成列、合并', // 不翻
  doc: '改写、插入、挪块', // 不翻
  folder: '整理、归类、写小结', // 不翻
  desk: '整理收件箱、开白板', // 不翻
} as const

/** 一个文件夹里有几篇（和文件夹首页头上「周记 · 1篇」同一个数：里面所有的 md、PDF、HTML，子文件夹里的也算） */
export function folderCount(folder: string, files: readonly FileEntry[]): number {
  return subtree(buildTree([...files]), folder).reduce((s, x) => s + x.count, 0)
}

/** 这一页在「看得到」里怎么写、能动手做什么；board：这篇是白板（或正在白板看法），digest：这篇是书摘，inbox：收件箱几条，count：文件夹里几篇 */
export function seenOf(tab: Tab | null, o: { board: boolean; digest?: boolean; inbox: number; count(folder: string): number }): Seen {
  if (!tab) return { see: t('空白页'), hands: null }
  switch (tab.type) {
    case 'note':
      if (o.board) return { see: t('白板：{name}', { name: titleOf(tab.path) }), hands: HANDS.board }
      return { see: o.digest ? t('书摘：{name}', { name: bookName(titleOf(tab.path)) }) : t('文档：{name}', { name: titleOf(tab.path) }), hands: HANDS.doc }
    case 'folder':
      return { see: t('文件夹：{name} · {n}篇', { name: lastSeg(tab.folder), n: o.count(tab.folder) }), hands: HANDS.folder }
    case 'flist':
      return { see: t('文件夹：{name} · {n}篇', { name: lastSeg(tab.folder), n: o.count(tab.folder) }), hands: null }
    case 'topic':
      return { see: t('文件夹：{name} · {n}篇', { name: tab.topic, n: o.count(`${CLIPS}/${tab.topic}`) }), hands: HANDS.folder }
    case 'home':
      return { see: t('首页'), hands: HANDS.desk }
    case 'inbox':
      return { see: t('收件箱{n}条', { n: o.inbox }), hands: HANDS.desk }
    case 'recent':
      return { see: t('最近'), hands: null }
    case 'archive':
      return { see: t('归档'), hands: null }
    case 'web':
      return { see: t('网页：{host}', { host: hostOf(tab.url) }), hands: null }
    case 'webread':
      return { see: t('阅读视图：{name}', { name: tab.title || hostOf(tab.url) }), hands: null }
    case 'diff':
      return { see: t('对比：{name}', { name: tab.title }), hands: null }
    case 'oldimages':
      return { see: t('梦游预览'), hands: null }
    case 'trash':
      return { see: t('最近删掉的'), hands: null }
    case 'todo':
      return { see: t('待办首页'), hands: null }
    case 'calendar':
      return { see: t('日历'), hands: null }
    case 'growth':
      return { see: t('生长图'), hands: null }
    case 'pdf':
    case 'html':
      return { see: lastSeg(tab.path), hands: null }
  }
}

export { readKey, readLabel, readSrc } from '../shared/ai-chats'
