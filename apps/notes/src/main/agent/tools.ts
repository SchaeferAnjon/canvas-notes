/**
 * AI 能动手的工具：库里的笔记和文件夹、网页、白板、文档，外加看看库里有什么。
 * 工具名不带前缀，各家命令行自己会加（Claude Code 里叫 mcp__canvas__board_add_card）。
 * 每个工具在白板 / 网页 / 文档不在眼前时说清楚为什么做不了，AI 会换个做法或者告诉用户。
 * 笔记和文件夹那组（2026-11-19）全能模式关着也有：新建、改写、改名、挪动、删到废纸篓、建文件夹，走软件自己的库操作（vault-ops.ts）。
 * 全能模式下命令行自己的工具（跑命令、写文件、上网搜……）的步骤行也在这里写成人话（stepLabel）。
 */
import { homedir } from 'node:os'
import type { AgentContext } from '../../shared/agent'
import { type ActTally, changedParas } from '../../shared/ai-act'
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
  /**
   * AI 去拿白板上的这几样（卡片、列的 id）：白板在屏幕上时「AI」指针先移过去、那几样外圈亮一下，等人看清再动（DESIGN.v3 2.3）。
   * of：这一下是一长串里的一步（一共几步），步数多时每步短一点
   */
  grab?(path: string, ids: string[], of?: number): Promise<void>
  /** 动完等一下（外圈亮着、卡片滑过去），让人看清挪到了哪；白板不在屏幕上时不等 */
  settle?(path: string, of?: number): Promise<void>
  /** 用户按了停下（esc、提示条上的「停下」）：一长串的下一步不做了，当前这一步做完就停 */
  stopped?(): boolean
  /** 只加一张卡时只亮这一张（流光方向 A2，DESIGN.v3 2.3） */
  spot?(path: string, ids: string[]): void
  /** 记下这一轮做了多少（做完的提示条「整理好了 · 挪了N张卡」、停下的「做完的N步留着」） */
  tally?(k: keyof ActTally, n?: number): void
  web: {
    open(url: string): Promise<{ url: string; title: string }>
    read(): Promise<WebPage>
    click(target: { ref?: number; text?: string }): Promise<string>
    type(ref: number, text: string, submit: boolean): Promise<string>
    scroll(to: 'down' | 'up' | 'top' | 'bottom'): Promise<string>
    /** 选中的字或整页进收件箱，返回新文件路径；text：先找到含这几个字的那一段、选中它再剪 */
    clip(whole: boolean, text?: string): Promise<string>
  }
  doc: {
    read(): Promise<{ path: string; text: string; selection: string }>
    insert(text: string): Promise<string>
    replaceSelection(text: string): Promise<string>
  }
  /**
   * 库里的笔记和文件夹（vault-ops.ts）：参数原样交过去，那边查（出了库、没有、重名都报一句说得清的话）；
   * 做完记进这一轮（结束时一起提交），开着的标签、编辑器跟过去
   */
  vault: {
    folders(): Promise<string[]>
    create(folder: unknown, title: unknown, text: unknown): Promise<string>
    rename(path: unknown, name: unknown): Promise<{ from: string; to: string; folder: boolean; relinked: string[] }>
    move(path: unknown, folder: unknown): Promise<{ from: string; to: string; folder: boolean; relinked: string[]; with?: { from: string; to: string }[] }>
    trash(path: unknown): Promise<{ path: string; folder: boolean; files: number; images: number; kept: number }>
    mkdir(parent: unknown, name: unknown): Promise<string>
  }
}

type Args = Record<string, unknown>

interface Tool extends ToolSpec {
  /** 浮窗里显示的一句话 */
  label(args: Args): string
  /** 回给 AI 的话；label：做完以后步骤行换成这句（改名、挪动、删的原来是个文件夹） */
  run(args: Args, host: ToolHost): Promise<string | { text: string; label: string }>
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

/** 改白板上已有的这几样：指针先去拿（白板在屏幕上时），改完等一下让人看清 */
async function grabbing(args: Args, host: ToolHost, ids: string[], change: (text: string) => string): Promise<string> {
  const path = await boardPath(args, host)
  await host.grab?.(path, ids)
  await editBoard({ ...args, path }, host, (t) => change(t))
  await host.settle?.(path)
  return path
}

const short = (s: string, n = 18) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

/** 文件夹：去掉开头的 ./ 和末尾的 / */
const trimDir = (f: unknown) => (typeof f === 'string' ? f.trim().replace(/^(\.?\/)+|\/+$/g, '') : '')
/** 放进哪里的说法：「放进「课程」」；空的是库的最外层（和建文件夹一样用「」，不带末尾的 /，不手打中西文空格） */
const intoSaid = (f: unknown, verb: '放进' | '挪进') => (trimDir(f) ? `${verb}「${trimDir(f)}」` : `${verb === '放进' ? '放在' : '挪到'}库的最外层`)
/** 一篇的标题（《周报》）：路径去掉文件夹和 .md */
const titled = (p: unknown) => `《${titleOf(String(p ?? '').trim().replace(/\/+$/, ''))}》`
/** 文件夹（「课程/ecp」） */
const quoted = (p: unknown) => `「${String(p ?? '').trim().replace(/\/+$/, '')}」`
const count = (n: number, unit: string) => `${n}${unit}`

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
    description: '列出库里的笔记（相对路径、是白板还是文档、在收件箱还是剪藏里），后面列出库里的文件夹（新建、挪动前看有哪些）。',
    inputSchema: obj({ folder: str('只列这个文件夹里的，比如「收件箱」；不填列全部') }),
    label: () => '看库里有哪些笔记',
    run: async (a, h) => {
      const folder = trimDir(a.folder)
      const inside = (p: string) => !folder || p.startsWith(folder + '/')
      const list = (await h.listNotes()).filter((n) => inside(n.path))
      const notes = list.map((n) => `${n.path}\t${n.board ? '白板' : n.kind === 'inbox' ? '收件箱' : n.kind === 'clip' ? '剪藏' : '文档'}`).join('\n') || '（没有笔记）'
      const dirs = (await h.vault.folders()).filter((d) => inside(d))
      return `${notes}\n\n文件夹：\n${dirs.map((d) => d + '/').join('\n') || '（没有）'}`
    },
  },
  {
    name: 'note_read',
    description: '读一篇笔记的 md 原文（白板也是 md：卡片写在 <!-- card --> 注释后面）。',
    inputSchema: obj({ path: str('相对路径，比如「冰岛自驾.md」') }, ['path']),
    label: (a) => `读${titled(a.path)}`,
    run: (a, h) => h.readNote(need<string>(a.path, 'path', 'string')),
  },

  // ---------- 笔记和文件夹（全能模式关着也有；改名、挪动时链接跟着改，删的进废纸篓，这一轮结束一起提交、能撤回） ----------
  {
    name: 'note_create',
    description:
      '新建一篇笔记。folder：放在哪个文件夹（相对库的路径，比如「课程/线代」；不填是库的最外层；文件夹要已经有了，没有先 folder_create）；title：标题，也是文件名（不带 .md、不带 /）；text：正文 md（开头不写「# 标题」软件会补上）。同一个文件夹里已经有同名的会报错。',
    inputSchema: obj({ folder: str('放在哪个文件夹（相对库的路径）；不填是库的最外层'), title: str('标题（也是文件名）'), text: str('正文 md') }, ['title']),
    label: (a) => `新建${titled(a.title)}，${intoSaid(a.folder, '放进')}`,
    run: async (a, h) => `建好了：${await h.vault.create(a.folder, a.title, a.text)}`,
  },
  {
    name: 'note_write',
    description:
      '改写库里的一篇笔记（不只是当前打开的那篇，白板也是 md）：mode=replace（默认）把整篇换成 text，mode=append 在末尾空一行加上 text。只改已经有的；要新建用 note_create。改动这一轮结束一起提交，开着这篇的编辑器跟着刷新。',
    inputSchema: obj(
      { path: str('笔记的相对路径，比如「课程/周报.md」'), text: str('整篇的新内容，或者要加在末尾的那段（md）'), mode: { type: 'string', enum: ['replace', 'append'], description: 'replace 整篇换掉；append 加在末尾' } },
      ['path', 'text'],
    ),
    label: (a) => (a.mode === 'append' ? `在${titled(a.path)}末尾加一段` : `改写${titled(a.path)}`),
    run: async (a, h) => {
      const raw = need<string>(a.path, 'path', 'string').trim()
      const path = /\.md$/i.test(raw) ? raw : `${raw}.md`
      const text = typeof a.text === 'string' ? a.text : ''
      const append = a.mode === 'append'
      if (append && !text.trim()) throw new Error('缺参数 text')
      let cur: string | undefined
      try {
        cur = await h.readNote(path)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      if (cur === undefined) throw new Error(`没有「${path}」。要新建就用 note_create`)
      await h.editNote(path, (t) => (append ? `${t.replace(/\s*$/, '')}\n\n${text.trim()}\n` : text.endsWith('\n') ? text : `${text}\n`))
      if (append) h.tally?.('added')
      else h.tally?.('changed', changedParas(cur, text))
      return `${append ? '加好了' : '改好了'}：${path}`
    },
  },
  {
    name: 'note_rename',
    description:
      '给一篇笔记或一个文件夹改名（在原来的文件夹里）。笔记：库里的 [[旧名]] 都换成新名，开头「# 旧名」跟着改，附件跟过去；文件夹：库里写着它路径的链接跟着改。name 是新名字（不带 .md、不带 /）。重名会报错；固定的分类文件夹（收件箱、课程……）不改名。',
    inputSchema: obj({ path: str('笔记或文件夹的相对路径'), name: str('新名字') }, ['path', 'name']),
    label: (a) => `把${titled(a.path)}改名为${titled(a.name)}`,
    run: async (a, h) => {
      const r = await h.vault.rename(a.path, a.name)
      const links = r.relinked.length ? `；库里${count(r.relinked.length, '篇笔记')}的链接跟着改了` : ''
      return { text: `改好了：${r.from} → ${r.to}${links}`, label: r.folder ? `把文件夹${quoted(r.from)}改名为${quoted(r.to.split('/').pop())}` : `把${titled(r.from)}改名为${titled(r.to)}` }
    },
  },
  {
    name: 'note_move',
    description:
      '把一篇笔记或一个文件夹挪进另一个文件夹（folder 写相对库的路径；挪到库的最外层写空字符串）。附件、库里指向它的相对链接、置顶跟着改（[[双链]] 按名字找，不用改）。目标文件夹要已经有了，里面有同名的会报错；固定的分类文件夹不挪。',
    inputSchema: obj({ path: str('笔记或文件夹的相对路径'), folder: str('挪进哪个文件夹（相对库的路径；库的最外层写空字符串）') }, ['path', 'folder']),
    label: (a) => `把${titled(a.path)}${intoSaid(a.folder, '挪进')}`,
    run: async (a, h) => {
      const r = await h.vault.move(a.path, a.folder)
      const links = r.relinked.length ? `；库里${count(r.relinked.length, '篇笔记')}的链接跟着改了` : ''
      const dbs = r.with?.length ? `；挂在它下面的数据库记录文件夹跟着挪了：${r.with.map((c) => `${c.from} → ${c.to}`).join('，')}` : ''
      const into = r.to.includes('/') ? r.to.slice(0, r.to.lastIndexOf('/')) : ''
      return { text: `挪好了：${r.from} → ${r.to}${links}${dbs}`, label: `把${r.folder ? `文件夹${quoted(r.from)}` : titled(r.from)}${intoSaid(into, '挪进')}` }
    },
  },
  {
    name: 'note_delete',
    description:
      '把一篇笔记（连同只有它在用的附件，别的笔记也在用的留着）或一个文件夹（整个）移到废纸篓。这一轮结束提交一次，用户能一键撤回，访达的废纸篓里也找得回。固定的分类文件夹不删。',
    inputSchema: obj({ path: str('笔记或文件夹的相对路径') }, ['path']),
    label: (a) => `删掉${titled(a.path)}（在废纸篓里能找回）`,
    run: async (a, h) => {
      const r = await h.vault.trash(a.path)
      if (r.folder) return { text: `移到了废纸篓：${r.path}（文件夹，里面${count(r.files, '个文件')}）。这一轮结束会提交一次，用户能撤回`, label: `删掉文件夹${quoted(r.path)}（在废纸篓里能找回）` }
      const extra = [r.images ? `连同${count(r.images, '个只有它在用的附件')}` : '', r.kept ? `${count(r.kept, '个别的笔记也在用')}，留着` : ''].filter(Boolean).join('；')
      return { text: `移到了废纸篓：${r.path}${extra ? `（${extra}）` : ''}。这一轮结束会提交一次，用户能撤回`, label: `删掉${titled(r.path)}（在废纸篓里能找回）` }
    },
  },
  {
    name: 'folder_create',
    description: '新建文件夹。parent：建在哪个文件夹里（相对库的路径；不填是库的最外层）；name：名字（不带 /）。已经有同名的会报错。',
    inputSchema: obj({ parent: str('建在哪个文件夹里；不填是库的最外层'), name: str('文件夹名字') }, ['name']),
    label: (a) => `新建文件夹${quoted(`${trimDir(a.parent) ? trimDir(a.parent) + '/' : ''}${String(a.name ?? '')}`)}`,
    run: async (a, h) => `建好了文件夹：${await h.vault.mkdir(a.parent, a.name)}`,
  },

  // ---------- 白板 ----------
  {
    name: 'board_list',
    description: '列出白板上的卡片（id、内容、在哪一列、摆在空白处的位置）、列（id，一般就是列名）和连线。白板就是这篇文档：## 是列、一段是一张卡。改白板前先调它拿 id；改过字的卡 id 会变，再调一次。',
    inputSchema: obj({ path: PATH }),
    label: () => '看白板上有什么',
    run: async (a, h) => {
      const path = await boardPath(a, h)
      return JSON.stringify({ path, ...ops.summarize(await h.readNote(path)) })
    },
  },
  {
    name: 'board_add_card',
    description: '在白板上加一张卡片。给 column（列的 id，一般就是列名）就插进那一节的末尾；给坐标就放在空白处；都不给就加在最后一节。内容是 md，一段就是一张卡。',
    inputSchema: obj({ text: str('卡片内容（md）'), x: int('横坐标（像素）'), y: int('纵坐标（像素）'), column: str('放进哪一列（列的 id）'), color: str('卡片颜色，可不填'), path: PATH }, ['text']),
    label: (a) => `加卡片「${short(String(a.text ?? ''))}」`,
    run: async (a, h) => {
      let id = ''
      const text = need<string>(a.text, 'text', 'string')
      const path = await editBoard(a, h, (t, sizes) => {
        const r = ops.addCard(t, { text, x: optNum(a.x), y: optNum(a.y), column: opt(a.column), color: opt(a.color) }, sizes)
        id = r.id
        return r.text
      })
      // 只亮刚加的这一张；指针移过去，外面跑一圈光
      h.spot?.(path, [id])
      h.tally?.('added')
      await h.grab?.(path, [id])
      await h.settle?.(path)
      return `加好了，卡片 id=${id}`
    },
  },
  {
    name: 'board_add_column',
    description: '在白板上加一列（文档里新起一节「## 列名」，列里的卡片就是这一节的段落，从上到下排）。',
    inputSchema: obj({ title: str('列名'), x: int('横坐标'), y: int('纵坐标'), path: PATH }, ['title']),
    label: (a) => `加一列「${short(String(a.title ?? ''))}」`,
    run: async (a, h) => {
      let id = ''
      const path = await editBoard(a, h, (t, sizes) => {
        const r = ops.addColumn(t, { title: need<string>(a.title, 'title', 'string'), x: optNum(a.x), y: optNum(a.y) }, sizes)
        id = r.id
        return r.text
      })
      await h.grab?.(path, [id])
      await h.settle?.(path)
      return `加好了，列 id=${id}`
    },
  },
  {
    name: 'board_update_card',
    description: '把一张卡片的内容整个换成新的 md（只改这张卡）。',
    inputSchema: obj({ id: str('卡片 id'), text: str('新内容（md）'), path: PATH }, ['id', 'text']),
    label: (a) => `改卡片「${short(String(a.text ?? ''))}」`,
    run: async (a, h) => {
      await grabbing(a, h, [need<string>(a.id, 'id', 'string')], (t) => ops.setCardText(t, need<string>(a.id, 'id', 'string'), need<string>(a.text, 'text', 'string')))
      h.tally?.('changed')
      return '改好了'
    },
  },
  {
    name: 'board_move',
    description: '把卡片挪到画布空白处的 (x, y)（文档里这段前面多一行位置，正文顺序不变）。在列里的卡片会被拿出来放到空白处。',
    inputSchema: obj({ id: str('卡片或列的 id'), x: int('横坐标'), y: int('纵坐标'), path: PATH }, ['id', 'x', 'y']),
    label: (a) => `挪 ${String(a.id ?? '')} 到 (${String(a.x ?? '')}, ${String(a.y ?? '')})`,
    run: async (a, h) => {
      await grabbing(a, h, [need<string>(a.id, 'id', 'string')], (t) => ops.moveTo(t, need<string>(a.id, 'id', 'string'), need<number>(a.x, 'x', 'number'), need<number>(a.y, 'y', 'number')))
      h.tally?.('moved')
      return '挪好了'
    },
  },
  {
    name: 'board_put_in_column',
    description: '把一张卡片放进一列（文档里这段也挪进那一节）；column 是列的 id（一般就是列名）；position 从 0 数，不给就放在列的最后。',
    inputSchema: obj({ id: str('卡片 id'), column: str('列 id'), position: int('放在列里第几个（从 0 数）'), path: PATH }, ['id', 'column']),
    label: (a) => `把 ${String(a.id ?? '')} 放进列 ${String(a.column ?? '')}`,
    run: async (a, h) => {
      await grabbing(a, h, [need<string>(a.id, 'id', 'string')], (t) => ops.putInColumn(t, need<string>(a.id, 'id', 'string'), need<string>(a.column, 'column', 'string'), optNum(a.position)))
      h.tally?.('moved')
      return '放好了'
    },
  },
  {
    name: 'board_link',
    description: '在两张卡片之间连一条线（带箭头，从 from 指向 to）。',
    inputSchema: obj({ from: str('起点卡片 id'), to: str('终点卡片 id'), path: PATH }, ['from', 'to']),
    label: (a) => `连线 ${String(a.from ?? '')} → ${String(a.to ?? '')}`,
    run: async (a, h) => {
      await grabbing(a, h, [need<string>(a.from, 'from', 'string'), need<string>(a.to, 'to', 'string')], (t) => ops.link(t, need<string>(a.from, 'from', 'string'), need<string>(a.to, 'to', 'string')))
      return '连好了'
    },
  },
  {
    name: 'board_arrange',
    description:
      '把白板空白处的卡片排整齐，保持现在从上到下、从左到右的顺序。mode=grid 按网格（一行 per 个，默认约等于总数的平方根）；mode=columns 按竖列（per 竖，默认 3，像瀑布流）。列跟着文档的节排成一排，列里的卡片跟着列走，不动。',
    inputSchema: obj({ mode: { type: 'string', enum: ['grid', 'columns'], description: 'grid 网格 / columns 竖列' }, per: int('一行几个（grid）或几竖（columns）'), path: PATH }, ['mode']),
    label: (a) => (a.mode === 'columns' ? '按列排整齐' : '按网格排整齐'),
    run: async (a, h) => {
      const mode = a.mode === 'columns' ? 'columns' : 'grid'
      if (!h.grab) {
        await editBoard(a, h, (t, sizes) => ops.arrange(t, mode, { per: optNum(a.per), sizes }))
        return '排好了'
      }
      // 一张一张挪：指针先去拿、那张外圈亮一下，再挪过去；按了停下，挪完手上这张就停（已经挪了的留着，一起提交）
      const path = await boardPath(a, h)
      const sizes = await h.measure(path)
      const steps = ops.arrangeSteps(await h.readNote(path), mode, { per: optNum(a.per), sizes })
      let n = 0
      for (const st of steps) {
        if (h.stopped?.()) break
        await h.grab(path, [st.id], steps.length)
        // 拿的时候用户删了这张：跳过
        await h.editNote(path, (t) => {
          try {
            return ops.placeAt(t, st.id, st.x, st.y)
          } catch {
            return t
          }
        })
        await h.settle?.(path, steps.length)
        h.tally?.('moved')
        n++
      }
      return n === steps.length ? '排好了' : `停下了：挪了${n}/${steps.length}张`
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
    description:
      '把网页里的一段剪进收件箱（带来源）：给 text（那一段里的几个字）就先找到那一段、选中再剪，一次剪一段，要剪几段就调几次；不给 text 剪用户选中的字；whole=true 或者没选中时剪整页正文。',
    inputSchema: obj({ text: str('要剪的那一段里的几个字（原文照抄，十来个字就够）'), whole: { type: 'boolean', description: '剪整页' } }),
    label: (a) => (a.whole ? '整页剪进收件箱' : opt(a.text) ? `剪「${short(String(a.text))}」` : '剪进收件箱'),
    run: async (a, h) => {
      const path = await h.web.clip(a.whole === true, opt(a.text))
      h.tally?.('clipped')
      return `剪好了：${path}`
    },
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

export async function runTool(name: string, args: Args, host: ToolHost): Promise<ToolResult & { label?: string }> {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) return { text: `没有叫 ${name} 的工具`, isError: true }
  const r = await t.run(args, host)
  return typeof r === 'string' ? { text: r } : r
}

export const toolLabel = (name: string, args: Args) => TOOLS.find((t) => t.name === name)?.label(args) ?? name

/** 文件的说法：库里的笔记写《标题》（放进说法里），别的写路径（库里的写相对路径，库外的家目录写成 ~，太长的从左边省掉；放进等宽那一段） */
function fileSaid(p: string, root: string): { title?: string; path?: string } {
  if (!p) return { path: '文件' }
  if (p === root || p.startsWith(root + '/')) {
    const rel = p.slice(root.length + 1)
    if (/\.md$/i.test(rel)) return { title: titled(rel) }
    p = rel
  } else {
    const home = homedir()
    if (p === home || p.startsWith(home + '/')) p = '~' + p.slice(home.length)
  }
  return { path: p.length > 44 ? '…' + p.slice(-43) : p }
}

/**
 * 全能模式下命令行自己那一步的人话（engines.ts 统一成 Claude Code 的叫法）：步骤行 12px 一行。
 * 命令、库外的路径、通配放进 code（等宽、和前面的字之间留 3px，不手打空格）；跑命令的说明是中文时写说明（「跑命令：列出主目录」）
 */
export function stepLabel(tool: string, input: Record<string, unknown>, root: string): { label: string; code?: string } {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const cut = (t: string, n = 40) => {
    const one = t.replace(/\s+/g, ' ').trim()
    return one.length > n ? one.slice(0, n) + '…' : one
  }
  /** 读、写、改、删、挪一个文件：库里的笔记「读《周报》」，别的「读」+ 等宽的路径 */
  const file = (verb: string, p: string) => {
    const f = fileSaid(p, root)
    return f.title ? { label: verb + f.title } : { label: verb, code: f.path! }
  }
  switch (tool) {
    case 'Bash':
      return /[\u4e00-\u9fff]/.test(s('description')) ? { label: `跑命令：${cut(s('description'), 30)}` } : { label: '跑命令', code: cut(s('command')) }
    case 'Read':
      return file('读', s('file_path'))
    case 'Write':
      return file('写', s('file_path'))
    case 'Edit':
    case 'MultiEdit':
      return file('改', s('file_path'))
    case 'NotebookEdit':
      return file('改', s('notebook_path'))
    case 'Delete':
      return file('删', s('file_path'))
    case 'Move':
      return file('挪', s('file_path'))
    case 'Glob':
      return { label: '找文件', code: cut(s('pattern')) }
    case 'Grep':
      return { label: `搜「${cut(s('pattern'), 24)}」` }
    case 'WebSearch':
      return { label: `上网搜「${cut(s('query'), 24)}」` }
    case 'WebFetch':
      return { label: `读网页${host_(s('url'))}` }
    case 'Task':
    case 'Agent':
      return { label: `开子Agent：${cut(s('description') || s('prompt'), 24)}` }
    case 'TodoWrite':
      return { label: '列要做的几步' }
    case 'Skill':
      return { label: `用技能「${s('skill') || s('command')}」` }
    case 'Mcp':
      return { label: `用${s('server')}的${s('tool')}` }
    default:
      return { label: `用${tool}` }
  }
}
