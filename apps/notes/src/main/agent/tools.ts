/**
 * AI 能动手的工具：网页、白板、文档，外加看看库里有什么。
 * 工具名不带前缀，各家命令行自己会加（Claude Code 里叫 mcp__canvas__board_add_card）。
 * 每个工具在白板 / 网页 / 文档不在眼前时说清楚为什么做不了，AI 会换个做法或者告诉用户。
 */
import type { AgentContext } from '../../shared/agent'
import type { NoteFile } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import * as ops from './board-ops'
import type { ToolResult, ToolSpec } from './mcp-server'

export interface WebPage {
  url: string
  title: string
  text: string
  /** 能点的东西：ref 给 web_click / web_type 用 */
  items: { ref: number; kind: 'link' | 'button' | 'input'; text: string; href?: string }[]
  selection: string
}

export interface ToolHost {
  context(): Promise<AgentContext>
  listNotes(): Promise<NoteFile[]>
  readNote(path: string): Promise<string>
  /** 改一篇：先把用户没提交的字单独提交，再写，再告诉打开着的编辑器；这一轮结束时一起提交 */
  editNote(path: string, change: (text: string) => string): Promise<void>
  /** 白板在屏幕上时量到的卡片大小 */
  measure(path: string): Promise<Record<string, ops.Size>>
  web: {
    open(url: string): Promise<{ url: string; title: string }>
    read(): Promise<WebPage>
    click(target: { ref?: number; text?: string }): Promise<string>
    type(ref: number, text: string, submit: boolean): Promise<string>
    scroll(to: 'down' | 'up' | 'top' | 'bottom'): Promise<string>
    /** 选中的字或整页进收件箱，返回新文件路径 */
    clip(whole: boolean): Promise<string>
  }
  doc: {
    read(): Promise<{ path: string; text: string; selection: string }>
    insert(text: string): Promise<string>
    replaceSelection(text: string): Promise<string>
  }
}

type Args = Record<string, unknown>

interface Tool extends ToolSpec {
  /** 浮窗里显示的一句话 */
  label(args: Args): string
  run(args: Args, host: ToolHost): Promise<string>
}

const str = (desc: string) => ({ type: 'string', description: desc })
const int = (desc: string) => ({ type: 'number', description: desc })
const PATH = str('白板的相对路径；不填就是当前标签里的白板')

function obj(props: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: props, required, additionalProperties: false }
}

function need<T>(v: unknown, name: string, type: 'string' | 'number'): T {
  if (typeof v !== type || (type === 'string' && !(v as string).trim())) throw new Error(`缺参数 ${name}`)
  return v as T
}

const opt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 当前标签里的白板；给了 path 就用 path */
async function boardPath(args: Args, host: ToolHost): Promise<string> {
  const given = opt(args.path)
  if (given) return given
  const ctx = await host.context()
  if (ctx.tab.type === 'note' && ctx.tab.path && (ctx.tab.board || ctx.tab.mode === 'board')) return ctx.tab.path
  throw new Error('现在打开的不是白板。请用户先打开一块白板，或者在 path 里写白板的路径。')
}

async function editBoard(args: Args, host: ToolHost, change: (text: string, sizes: Record<string, ops.Size>) => string): Promise<string> {
  const path = await boardPath(args, host)
  const sizes = await host.measure(path)
  await host.editNote(path, (text) => change(text, sizes))
  return path
}

const short = (s: string, n = 18) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

const host_ = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const TOOLS: Tool[] = [
  {
    name: 'canvas_context',
    description: '看用户现在在软件里打开的是什么：当前标签（白板、文档、收件箱、首页）、右栏网页开没开、文档里选中的字。不确定该用哪组工具时先调它。',
    inputSchema: obj({}),
    label: () => '看现在打开的是什么',
    run: async (_a, h) => JSON.stringify(await h.context()),
  },
  {
    name: 'notes_list',
    description: '列出库里的笔记（相对路径、是白板还是文档、在收件箱还是素材里）。',
    inputSchema: obj({ folder: str('只列这个文件夹里的，比如「收件箱」；不填列全部') }),
    label: () => '看库里有哪些笔记',
    run: async (a, h) => {
      const folder = opt(a.folder)
      const list = (await h.listNotes()).filter((n) => !folder || n.path.startsWith(folder.replace(/\/$/, '') + '/'))
      return list.map((n) => `${n.path}\t${n.board ? '白板' : n.kind === 'inbox' ? '收件箱' : n.kind === 'clip' ? '素材' : '文档'}`).join('\n') || '（没有）'
    },
  },
  {
    name: 'note_read',
    description: '读一篇笔记的 md 原文（白板也是 md：卡片写在 <!-- card --> 注释后面）。',
    inputSchema: obj({ path: str('相对路径，比如「冰岛自驾.md」') }, ['path']),
    label: (a) => `读「${titleOf(String(a.path ?? ''))}」`,
    run: (a, h) => h.readNote(need<string>(a.path, 'path', 'string')),
  },

  // ---------- 白板 ----------
  {
    name: 'board_list',
    description: '列出白板上的卡片（id、内容、位置、在哪一列）、列、连线和「未整理」的段落。改白板前先调它拿 id。',
    inputSchema: obj({ path: PATH }),
    label: () => '看白板上有什么',
    run: async (a, h) => {
      const path = await boardPath(a, h)
      return JSON.stringify({ path, ...ops.summarize(await h.readNote(path)) })
    },
  },
  {
    name: 'board_add_card',
    description: '在白板上加一张卡片。不给坐标就放在已有内容下面；给 column（列的 id）就放进那一列。内容是 md。',
    inputSchema: obj({ text: str('卡片内容（md）'), x: int('横坐标（像素）'), y: int('纵坐标（像素）'), column: str('放进哪一列（列的 id）'), color: str('卡片颜色，可不填'), path: PATH }, ['text']),
    label: (a) => `加卡片「${short(String(a.text ?? ''))}」`,
    run: async (a, h) => {
      let id = ''
      const text = need<string>(a.text, 'text', 'string')
      await editBoard(a, h, (t, sizes) => {
        const r = ops.addCard(t, { text, x: optNum(a.x), y: optNum(a.y), column: opt(a.column), color: opt(a.color) }, sizes)
        id = r.id
        return r.text
      })
      return `加好了，卡片 id=${id}`
    },
  },
  {
    name: 'board_add_column',
    description: '在白板上加一列（列可以装卡片，卡片在列里从上到下排）。',
    inputSchema: obj({ title: str('列名'), x: int('横坐标'), y: int('纵坐标'), path: PATH }, ['title']),
    label: (a) => `加一列「${short(String(a.title ?? ''))}」`,
    run: async (a, h) => {
      let id = ''
      await editBoard(a, h, (t, sizes) => {
        const r = ops.addColumn(t, { title: need<string>(a.title, 'title', 'string'), x: optNum(a.x), y: optNum(a.y) }, sizes)
        id = r.id
        return r.text
      })
      return `加好了，列 id=${id}`
    },
  },
  {
    name: 'board_update_card',
    description: '把一张卡片的内容整个换成新的 md（只改这张卡）。',
    inputSchema: obj({ id: str('卡片 id'), text: str('新内容（md）'), path: PATH }, ['id', 'text']),
    label: (a) => `改卡片「${short(String(a.text ?? ''))}」`,
    run: async (a, h) => {
      await editBoard(a, h, (t) => ops.setCardText(t, need<string>(a.id, 'id', 'string'), need<string>(a.text, 'text', 'string')))
      return '改好了'
    },
  },
  {
    name: 'board_move',
    description: '把卡片或列挪到画布上的 (x, y)。在列里的卡片会被拿出来放到画布上。',
    inputSchema: obj({ id: str('卡片或列的 id'), x: int('横坐标'), y: int('纵坐标'), path: PATH }, ['id', 'x', 'y']),
    label: (a) => `挪 ${String(a.id ?? '')} 到 (${String(a.x ?? '')}, ${String(a.y ?? '')})`,
    run: async (a, h) => {
      await editBoard(a, h, (t) => ops.moveTo(t, need<string>(a.id, 'id', 'string'), need<number>(a.x, 'x', 'number'), need<number>(a.y, 'y', 'number')))
      return '挪好了'
    },
  },
  {
    name: 'board_put_in_column',
    description: '把一张卡片放进一列；position 从 0 数，不给就放在列的最后。',
    inputSchema: obj({ id: str('卡片 id'), column: str('列 id'), position: int('放在列里第几个（从 0 数）'), path: PATH }, ['id', 'column']),
    label: (a) => `把 ${String(a.id ?? '')} 放进列 ${String(a.column ?? '')}`,
    run: async (a, h) => {
      await editBoard(a, h, (t) => ops.putInColumn(t, need<string>(a.id, 'id', 'string'), need<string>(a.column, 'column', 'string'), optNum(a.position)))
      return '放好了'
    },
  },
  {
    name: 'board_link',
    description: '在两张卡片之间连一条线（带箭头，从 from 指向 to）。',
    inputSchema: obj({ from: str('起点卡片 id'), to: str('终点卡片 id'), path: PATH }, ['from', 'to']),
    label: (a) => `连线 ${String(a.from ?? '')} → ${String(a.to ?? '')}`,
    run: async (a, h) => {
      await editBoard(a, h, (t) => ops.link(t, need<string>(a.from, 'from', 'string'), need<string>(a.to, 'to', 'string')))
      return '连好了'
    },
  },
  {
    name: 'board_arrange',
    description:
      '把白板上的卡片和列排整齐，保持现在从上到下、从左到右的顺序。mode=grid 按网格（一行 per 个，默认约等于总数的平方根）；mode=columns 按竖列（per 竖，默认 3，像瀑布流）。列里的卡片跟着列走。',
    inputSchema: obj({ mode: { type: 'string', enum: ['grid', 'columns'], description: 'grid 网格 / columns 竖列' }, per: int('一行几个（grid）或几竖（columns）'), path: PATH }, ['mode']),
    label: (a) => (a.mode === 'columns' ? '按列排整齐' : '按网格排整齐'),
    run: async (a, h) => {
      const mode = a.mode === 'columns' ? 'columns' : 'grid'
      await editBoard(a, h, (t, sizes) => ops.arrange(t, mode, { per: optNum(a.per), sizes }))
      return '排好了'
    },
  },

  // ---------- 网页 ----------
  {
    name: 'web_open',
    description: '在右栏的内置浏览器里打开一个网址（右栏没开会自动打开）。打开后用 web_read 读内容。',
    inputSchema: obj({ url: str('网址，http 或 https') }, ['url']),
    label: (a) => `打开网页 ${host_(String(a.url ?? ''))}`,
    run: async (a, h) => {
      const r = await h.web.open(need<string>(a.url, 'url', 'string'))
      return `打开了：${r.title || '（没有标题）'}\n${r.url}`
    },
  },
  {
    name: 'web_read',
    description: '读右栏当前网页：标题、网址、正文文字、能点的链接按钮和输入框（每个带 ref 编号，给 web_click / web_type 用）、用户选中的字。',
    inputSchema: obj({}),
    label: () => '读网页',
    run: async (_a, h) => {
      const p = await h.web.read()
      const items = p.items.map((i) => `[${i.ref}] ${i.kind === 'input' ? '输入框' : i.kind === 'button' ? '按钮' : '链接'} ${i.text}${i.href ? ` → ${i.href}` : ''}`).join('\n')
      return `标题：${p.title}\n网址：${p.url}\n${p.selection ? `选中的字：${p.selection}\n` : ''}\n正文：\n${p.text}\n\n能点的：\n${items || '（没有）'}`
    },
  },
  {
    name: 'web_click',
    description: '点网页上的一个链接或按钮：用 web_read 给的 ref，或者写它上面的字。',
    inputSchema: obj({ ref: int('web_read 给的编号'), text: str('链接或按钮上的字') }),
    label: (a) => `点「${a.text ? short(String(a.text)) : `#${String(a.ref ?? '')}`}」`,
    run: (a, h) => {
      const ref = optNum(a.ref)
      const text = opt(a.text)
      if (ref === undefined && !text) throw new Error('要给 ref 或 text')
      return h.web.click({ ref, text })
    },
  },
  {
    name: 'web_type',
    description: '在网页的输入框里输入文字（先清空），submit=true 时再按回车。',
    inputSchema: obj({ ref: int('web_read 给的输入框编号'), text: str('要输入的字'), submit: { type: 'boolean', description: '输入后按回车' } }, ['ref', 'text']),
    label: (a) => `输入「${short(String(a.text ?? ''))}」`,
    run: (a, h) => h.web.type(need<number>(a.ref, 'ref', 'number'), typeof a.text === 'string' ? a.text : '', a.submit === true),
  },
  {
    name: 'web_scroll',
    description: '滚动网页：down 往下一屏、up 往上一屏、top 回到顶、bottom 到底。',
    inputSchema: obj({ to: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } }, ['to']),
    label: (a) => ({ down: '往下滚', up: '往上滚', top: '滚到顶', bottom: '滚到底' })[String(a.to)] ?? '滚动网页',
    run: (a, h) => {
      const to = String(a.to)
      if (!['down', 'up', 'top', 'bottom'].includes(to)) throw new Error('to 只能是 down、up、top、bottom')
      return h.web.scroll(to as 'down' | 'up' | 'top' | 'bottom')
    },
  },
  {
    name: 'web_clip',
    description: '把网页里用户选中的字剪进收件箱（带来源）；whole=true 或者没选中时剪整页正文。',
    inputSchema: obj({ whole: { type: 'boolean', description: '剪整页' } }),
    label: (a) => (a.whole ? '整页剪进收件箱' : '剪进收件箱'),
    run: async (a, h) => `剪好了：${await h.web.clip(a.whole === true)}`,
  },

  // ---------- 文档 ----------
  {
    name: 'doc_read',
    description: '读当前标签里打开的文档：路径、md 原文、用户选中的字。',
    inputSchema: obj({}),
    label: () => '读文档',
    run: async (_a, h) => {
      const d = await h.doc.read()
      return `路径：${d.path}\n选中的字：${d.selection || '（没选）'}\n\n${d.text}`
    },
  },
  {
    name: 'doc_insert',
    description: '在当前文档的光标处插入一段 md（插在光标所在段的后面，前后空一行）。',
    inputSchema: obj({ text: str('要插入的 md') }, ['text']),
    label: (a) => `插入「${short(String(a.text ?? ''))}」`,
    run: (a, h) => h.doc.insert(need<string>(a.text, 'text', 'string')),
  },
  {
    name: 'doc_replace_selection',
    description: '把当前文档里用户选中的那段换成新的 md。没选中时会报错。',
    inputSchema: obj({ text: str('新的 md') }, ['text']),
    label: (a) => `把选中的换成「${short(String(a.text ?? ''))}」`,
    run: (a, h) => h.doc.replaceSelection(typeof a.text === 'string' ? a.text : ''),
  },
]

export const toolSpecs = (): ToolSpec[] => TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))

export async function runTool(name: string, args: Args, host: ToolHost): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return { text: `没有叫 ${name} 的工具`, isError: true }
  return { text: await t.run(args, host) }
}

export const toolLabel = (name: string, args: Args) => TOOLS.find((t) => t.name === name)?.label(args) ?? name
