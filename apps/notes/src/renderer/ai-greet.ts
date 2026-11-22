/**
 * AI 空对话打招呼（task-0tgz2，偏好「AI 空白页打招呼、快捷命令放底部」，小样 design/ai-empty 方向 A）：
 * 引擎标志 + 钟点问候，下面一句跟着在看的东西走；输入框上面一排快捷命令，挑这一页用得上的。
 * 软件里没有「怎么称呼你」，问候不带名字（提交署名是给 Git 用的，不拿来打招呼）。
 */
import type { CodiconName } from '@cn/design'
import { bookName } from './ai-place'
import type { Tab } from './tabs'

export function hello(hour: number): string {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const MAX = 12

/** 问候那一句里的名字：去掉「（微信读书首发）」这类尾巴，取冒号前那一截（前面至少两个字），最多 12 个字 */
export function shortTitle(title: string): string {
  let t = bookName(title)
  const at = t.search(/[：:]/)
  if (at >= 2) t = t.slice(0, at).trim()
  const chars = [...t]
  return chars.length > MAX ? chars.slice(0, MAX).join('') + '…' : t
}

/** 问候下面那一句；label 是这个地方的名字（头上对话胶囊那个），board：这篇是白板，inbox：收件箱几条 */
export function askLine(tab: Tab | null, o: { board: boolean; inbox: number; label: string }): string {
  switch (tab?.type) {
    case 'note':
      return o.board ? `要对白板《${shortTitle(o.label)}》做点什么？` : `要对《${shortTitle(o.label)}》做点什么？`
    case 'folder':
    case 'topic':
      return `要对「${o.label}」做点什么？`
    case 'inbox':
      return o.inbox ? `收件箱里有${o.inbox}条，要分一分吗？` : '收件箱是空的，想做点什么？'
    case 'home':
      return '今天想整理点什么？'
    case 'web':
    case 'webread':
      return `要对《${shortTitle(o.label)}》做点什么？`
    case 'pdf':
    case 'html':
      return readAsk(o.label)
    default:
      return '想做点什么？'
  }
}

/** 读 PDF、HTML 的那一格（名字去掉 .pdf） */
export const readAsk = (label: string) => `要问《${shortTitle(label.replace(/\.(pdf|html?)$/i, ''))}》哪里？框一块就能问。`

/** 右栏网页那一处：写网页标题（「2.2. 数据预处理」，去掉「 — 书名」那截），网页上选一段、按住 ⌘ 框一块都能问 */
export const webAsk = (title: string) => `要问《${shortTitle(title)}》哪里？选一段或框一块就能问。`

/** 一排最多几颗（放不下的收进「⋯」） */
const MOST = 4

/**
 * 底部快捷命令（文件夹页不走这里，给这个文件夹自己的三条，folder-ai.ts）：这一页用得上的 / 命令，最相关的在前；
 * 右栏开着网页时「剪藏这一页」排第一（和能动手一样）；收件箱空着不放整理收件箱和现在梦游，不拿别的凑数
 */
export function quickCmds(tab: Tab | null, o: { web: boolean; board: boolean; inbox: number }): string[] {
  const tidy = o.inbox ? ['整理收件箱'] : []
  const own =
    tab?.type === 'inbox'
      ? [...tidy, '找重复', ...(o.inbox ? ['现在梦游'] : [])]
      : tab?.type === 'home'
        ? [...tidy, ...(o.inbox ? ['现在梦游'] : []), '找重复']
        : tab?.type === 'note' && o.board
          ? ['整理当前白板', '总结这块白板', '写成文章', ...tidy]
          : tab?.type === 'note'
            ? ['翻译', ...tidy]
            : [...tidy, '找重复']
  return [...(o.web ? ['剪藏这一页'] : []), ...own].slice(0, MOST)
}

/**
 * 左栏选了好几个交给 AI 时（ai-pick.ts）的快捷命令：text 是小按钮上写的，ask 是点了发出去的那一问
 * （话里说「选中的这几篇」，是哪几篇每一轮跟着「看得到」交给 AI）；写文件的照 AI 动手的规矩一轮一次提交、能撤回
 */
export const MULTI: readonly { text: string; icon: CodiconName; ask: string }[] = [
  { text: '总结这几篇', icon: 'notebook', ask: '总结选中的这几篇' },
  { text: '合成一篇', icon: 'new-file', ask: '把选中的这几篇合成一篇新笔记' },
  { text: '找出重复的', icon: 'files', ask: '找出选中的这几篇里重复的内容' },
  { text: '归到该去的分类', icon: 'folder-opened', ask: '把选中的这几篇归到该去的分类' },
  { text: '列成表', icon: 'table', ask: '把选中的这几篇列成一张表' },
]

/** 选了好几个时问候下面那一句 */
export const pickAsk = (n: number) => `要对选中的${n}个做点什么？`
