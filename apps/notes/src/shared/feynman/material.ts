/**
 * 材料从哪来（四种入口，能混选）：读成一段段给 AI 的字和图，同时找出「说同一件事、要一起盖住的东西」。
 * 读文件、读 PDF、搜库都由调用的人给（GatherDeps：主进程给真的，测试给假的），这里不碰 Electron、Node。
 *
 * - 导图的一支：这个节点和它下面全部（嵌套列表原样）；导图这块白板配对的网页一起盖住。超过 5 个子枝：子枝各当一个点，这一支变串讲。
 * - 白板上的卡：普通卡读卡上的字和图（PDF 框选截图 `![我框的|宽](附件/…)` 一起给 AI，交「看图问」那家）；
 *   剪藏卡（引文带「—— [标题](网址)」、![[剪藏笔记]]）读摘要和出处页；子白板卡（[[白板]]）读它的名字和头几张卡；
 *   PDF 页卡（![[x.pdf#page=5]]）、卡里的「第 N 页」链接：出处写回那份 PDF 那一页，那份 PDF 一起盖住。
 * - 直接写一个词：库里找相关笔记当材料；找不到就按常识（noMaterial，凭什么都写「AI 判断」）。
 * - 一整份 PDF：每页的字（现有的 PDF 抽字）；先给知识点单子让人挑（feynman.ts），挑了只读那几页。
 * - 整块白板：白板上的卡一张张照上面读（最多 BOARD_CARDS_MAX 张）。
 * 卡都带上它在哪一列；读到的卡之间的连线（frontmatter 的 links）另给一段。在白板上直接写一个词时，先拿这块白板上说到它的卡
 * （收件箱「费曼学习需要检测到白板的内容」：以前只搜库，还特意把这块白板排除了，白板上写的东西 AI 一个字也看不到）。
 */
import { type DocUnit, fmValue, highlightsOf, linksOf, notePathFor, isMindmap, keyPath, type MapNode, mindmapList, nodeAt, parseMindmap, parsePdfAnchor, pathKey, prop, resolveLink, splitDoc } from '@cn/format'
import type { Candidate } from './api'
import { findRounds } from './doc'
import type { CoverRef, MaterialRef, SourceRef } from './types'
import { BOARD_CARDS_MAX, CARDS_MAX, CORE_MAX } from './types'

export interface GatherDeps {
  /** 读库里一篇（相对路径）；没有是 null */
  read(path: string): Promise<string | null>
  /** 库里所有 md 的相对路径（[[名字]] 找文件用） */
  notes(): Promise<string[]>
  /** 库里搜一个词：相关的几篇（最相关的在前） */
  search(word: string): Promise<string[]>
  /** PDF 每页的字（现有的 PDF 抽字）；读不了是 null */
  pdf(path: string): Promise<{ page: number; text: string }[] | null>
  /** 库里这张图在不在（框选截图、卡上的图） */
  hasFile(path: string): Promise<boolean>
  /** 按名字找库里的文件（![[x.pdf]]、![[图.png]] 只写了名字）：相对路径，找不到是 null */
  findFile(name: string, here: string): Promise<string | null>
}

/** 给 AI 的一段材料 */
export interface Piece {
  ref: MaterialRef
  /** 「导图「范数」这一支」「卡 3 · 网页剪藏」「第3讲.pdf 第 5 页」 */
  title: string
  text: string
  /** 这一段带的图（库里的相对路径）：交给「看图问」那家 */
  images: string[]
  /** 出处 */
  src?: SourceRef
}

export interface Gathered {
  /** 材料（导图那一支的路径按字找回来以后改好的） */
  refs: MaterialRef[]
  pieces: Piece[]
  /** 要一起盖住的（同一页的卡、讲同一件事的卡由 feynman.ts 问 AI 以后再补） */
  cover: CoverRef[]
  /** 知识点名的线索：导图节点的字、写的那个词、PDF 单子上挑的名字 */
  topic?: string
  noMaterial: boolean
  lecture?: number
  /** 列头第二行「照导图「范数」这一支和配对的网页核对」 */
  basisLine: string
  /** 导图这一支超过 5 个子枝：子枝各当一个点（这一支本身是 chain 串讲） */
  branch?: { items: Candidate[]; chain: Candidate; title: string }
  /** 一整份 PDF 还没挑：每页的字（交给 AI 切单子） */
  pdfToList?: { path: string; pages: { page: number; text: string }[] }
  /** 同一块白板上别的卡（问 AI 哪几张讲同一件事） */
  others: { path: string; unit: DocUnit; text: string }[]
}

const IMG_MD = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const IMG_EMBED = /!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp))(?:\|[^\]]*)?\]\]/gi
const EMBED = /^!\[\[([^\]|#^]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]\s*$/
const LINK = /^\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/
const SOURCE_LINE = /^(?:>\s*)?——\s*(?:\[([^\]]+)\]\((\S+?)\)|(.+?))\s*$/m
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g

const baseName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
/** 同一份 PDF 同一页（只写名字的 ![[x.pdf]] 和带路径的链接按文件名对） */
const pageKey = (p: { path: string; page: number }) => `${p.path.split('/').pop()}#${p.page}`
const stripHash = (u: string) => (u.includes('#') ? u.slice(0, u.indexOf('#')) : u)

/** 按名字找库里的文件（同一个文件夹里的先，再是路径短的；和白板卡一样） */
export function nearestNote(paths: readonly string[], name: string, here: string): string | null {
  const want = name.replace(/\.md$/i, '')
  const hits = paths.filter((p) => p === want + '.md' || p === want || baseName(p) === baseName(want))
  if (!hits.length) return null
  const dir = here.includes('/') ? here.slice(0, here.lastIndexOf('/') + 1) : ''
  return [...hits].sort((a, b) => Number(!a.startsWith(dir)) - Number(!b.startsWith(dir)) || a.length - b.length)[0]!
}

/** 卡的开头 40 个字（没编号的卡按它找回来） */
export const headOf = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)

/** 这张卡的编号（位置行、编号行上的） */
export const unitIdOf = (u: DocUnit) => u.place?.id || u.tag?.id || undefined

/** 白板上所有的卡（列里的、拖到空白处的） */
export function allUnits(text: string): DocUnit[] {
  const b = splitDoc(text)
  return [...b.columns.flatMap((c) => c.cards), ...b.placed].filter((u) => u.kind !== 'gap')
}

/** 白板上算「卡」的：以前的费曼轮、导图本身（那一段列表）不算 */
export function notCard(text: string): (u: DocUnit) => boolean {
  const map = isMindmap(text) ? parseMindmap(text) : null
  const mapRange = map?.found ? [map.before.length, text.length - map.after.length] : null
  const rounds = findRounds(text).map((r) => [r.head.from, r.end])
  return (u) => (mapRange !== null && u.from >= mapRange[0]! && u.to <= mapRange[1]!) || rounds.some(([a, z]) => u.from >= a! && u.to <= z!)
}

/** 白板上的卡（列里的、拖到空白处的），不含以前的费曼轮和导图那一段 */
export function boardUnits(text: string): DocUnit[] {
  const skip = notCard(text)
  return allUnits(text).filter((u) => !skip(u))
}

/** 卡在哪一列（卡在文档里的起点 → 列名）；开头没标题那一组、拖到空白处的没有 */
function columnsOf(text: string): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of splitDoc(text).columns) if (c.title) for (const u of c.cards) m.set(u.from, c.title)
  return m
}

/** 导图里第一个字里带着这个词的节点（在导图白板上直接写一个词） */
function nodeWith(roots: MapNode[], word: string): MapNode | null {
  for (const n of roots) {
    if (n.text.toLowerCase().includes(word)) return n
    const hit = nodeWith(n.children, word)
    if (hit) return hit
  }
  return null
}

/** 按编号、再按开头的字找卡 */
export function findUnit(text: string, ref: { id?: string; head: string }): DocUnit | null {
  const units = allUnits(text)
  if (ref.id) {
    const u = units.find((x) => unitIdOf(x) === ref.id)
    if (u) return u
  }
  const h = ref.head.trim()
  return units.find((x) => headOf(x.text) === h) ?? (h ? (units.find((x) => headOf(x.text).startsWith(h.slice(0, 20))) ?? null) : null)
}

/** 卡上的图（md 图片、![[图]]）：库里的相对路径 */
export function imagesIn(text: string, here: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(IMG_MD)) {
    const p = resolveLink(here, m[2]!)
    if (p && /\.(png|jpe?g|gif|webp)$/i.test(p)) out.push(p)
  }
  for (const m of text.matchAll(IMG_EMBED)) out.push(m[1]!)
  return [...new Set(out)]
}

/** 卡里指回 PDF 的链接（「第 N 页」、框选截图下面那行）：哪份 PDF 哪一页 */
export function pdfLinksIn(text: string, here: string): { path: string; page: number }[] {
  const out: { path: string; page: number }[] = []
  for (const m of text.matchAll(MD_LINK)) {
    if (m.index! > 0 && text[m.index! - 1] === '!') continue
    const a = parsePdfAnchor(m[2]!)
    if (!a) continue
    out.push({ path: resolveLink(here, a.file.replace(/ /g, '%20')) ?? a.file, page: a.page })
  }
  const e = /!\[\[([^\]|#]+\.pdf)#page=(\d+)[^\]]*\]\]/gi
  for (const m of text.matchAll(e)) out.push({ path: resolveLink(here, m[1]!.replace(/ /g, '%20')) ?? m[1]!, page: Number(m[2]) })
  return out
}

/** 卡上的字去掉图、注释、md 写法里的长链接，留给 AI 读的字 */
export function plainOf(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(IMG_MD, (_a, alt: string) => `[图${alt ? `：${alt.split('|')[0]}` : ''}]`)
    .replace(MD_LINK, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 「第3讲 线性映射.pdf」「第 3 讲」里的讲次 */
export function lectureOf(s: string | undefined): number | undefined {
  const m = s ? /第\s*(\d{1,3})\s*讲|lecture\s*(\d{1,3})/i.exec(s) : null
  return m ? Number(m[1] ?? m[2]) : undefined
}

function lectureOfNote(text: string, path: string): number | undefined {
  const p = prop(text, '第几讲')
  return (p && /^\d+$/.test(p.trim()) ? Number(p) : undefined) ?? lectureOf(baseName(path))
}

/** 导图的一支：按路径找，路径变了按字找回来 */
export function branchOf(text: string, ref: { node: string; text: string }): { node: MapNode; key: string } | null {
  const roots = parseMindmap(text).roots
  const at = nodeAt(roots, keyPath(ref.node))
  if (at && (!ref.text || at.text === ref.text)) return { node: at, key: ref.node }
  let hit: { node: MapNode; key: string } | null = null
  const walk = (list: MapNode[], base: number[]) =>
    list.forEach((n, i) => {
      if (hit) return
      if (n.text === ref.text) hit = { node: n, key: pathKey([...base, i]) }
      else walk(n.children, [...base, i])
    })
  walk(roots, [])
  return hit
}

/** 一张卡读成材料：剪藏卡、子白板卡、PDF 页卡、带图的卡 */
async function cardPiece(path: string, u: DocUnit, n: number, deps: GatherDeps, notes: () => Promise<string[]>, col?: string): Promise<{ piece: Piece; covers: CoverRef[]; url?: string; pdfPages: { path: string; page: number }[] }> {
  const t = u.text.trim()
  const ref: MaterialRef = { kind: 'card', path, head: headOf(t), ...(unitIdOf(u) ? { id: unitIdOf(u) } : {}) }
  const covers: CoverRef[] = []
  const pdfPages = pdfLinksIn(t, path)
  const images = imagesIn(t, path)
  const name = col ? `卡 ${n}（「${col}」那一列）` : `卡 ${n}`
  let title = name
  let text = plainOf(t)
  let src: SourceRef | undefined = { kind: 'card', path, head: ref.head, ...(ref.id ? { id: ref.id } : {}) }
  let url: string | undefined
  const embed = EMBED.exec(t)
  const link = LINK.exec(t)
  if (embed && /\.pdf$/i.test(embed[1]!)) {
    // PDF 页卡：读那一页的字
    const page = Number(/page=(\d+)/.exec(embed[2] ?? '')?.[1] ?? 1)
    const pdf = (await deps.findFile(embed[1]!, path)) ?? embed[1]!
    const pages = await deps.pdf(pdf)
    text = pages?.find((p) => p.page === page)?.text.trim() || text
    title = `${name} · ${baseName(pdf)} 第 ${page} 页`
    src = { kind: 'pdf', path: pdf, page }
    pdfPages.push({ path: pdf, page })
  } else if (embed && !/\.(png|jpe?g|gif|webp)$/i.test(embed[1]!)) {
    // 嵌入的笔记：整页剪藏读摘要和出处页
    const p = nearestNote(await notes(), embed[1]!, path)
    const body = p ? await deps.read(p) : null
    if (body !== null && p) {
      url = fmValue(body, 'source') ?? fmValue(body, '来源')
      const clean = plainOf(body.replace(/^---\n[\s\S]*?\n---\n/, ''))
      text = clean.slice(0, 3000)
      title = `${name} · ${url ? '网页剪藏' : '笔记'}「${baseName(p)}」`
      src = url && /^https?:/.test(url) ? { kind: 'web', url, title: baseName(p) } : { kind: 'note', path: p }
      images.push(...imagesIn(body, p))
    }
  } else if (link) {
    // 子白板卡：它的名字和头几张卡
    const p = nearestNote(await notes(), link[1]!, path)
    const body = p ? await deps.read(p) : null
    if (body !== null && p) {
      const inner = isMindmap(body) ? [mindmapList(parseMindmap(body).roots)] : allUnits(body).slice(0, 6).map((x) => plainOf(x.text))
      text = `子白板「${baseName(p)}」：\n${inner.join('\n\n').slice(0, 3000)}`
      title = `${name} · 子白板「${baseName(p)}」`
      src = { kind: 'note', path: p }
    }
  } else {
    const s = SOURCE_LINE.exec(t)
    if (s?.[2] && /^https?:/.test(s[2])) {
      url = s[2]
      title = `${name} · 网页剪藏「${s[1] ?? s[2]}」`
      src = { kind: 'web', url, title: s[1] ?? '' }
    } else if (pdfPages.length) {
      title = `${name} · ${baseName(pdfPages[0]!.path)} 第 ${pdfPages[0]!.page} 页`
      src = { kind: 'pdf', path: pdfPages[0]!.path, page: pdfPages[0]!.page }
    }
  }
  const have: string[] = []
  for (const im of images) {
    const p = (await deps.hasFile(im)) ? im : await deps.findFile(im, path)
    if (p && !have.includes(p)) have.push(p)
  }
  for (const p of [...pdfPages].reverse()) if (!covers.some((c) => c.kind === 'pdf' && c.path.split('/').pop() === p.path.split('/').pop())) covers.push({ kind: 'pdf', path: p.path, page: p.page })
  return { piece: { ref, title, text, images: have, ...(src ? { src } : {}) }, covers, ...(url ? { url } : {}), pdfPages }
}

/**
 * 把这几样材料读出来。board：正在看的那块白板（找同一页的卡、配对的网页）
 */
export async function gather(refs: readonly MaterialRef[], deps: GatherDeps, o: { board?: string } = {}): Promise<Gathered> {
  let noteList: Promise<string[]> | null = null
  const notes = () => (noteList ??= deps.notes())
  const pieces: Piece[] = []
  const cover: CoverRef[] = []
  const addCover = (c: CoverRef) => {
    const same = cover.some((x) => JSON.stringify(x) === JSON.stringify(c) || (x.kind === 'pdf' && c.kind === 'pdf' && x.path.split('/').pop() === c.path.split('/').pop()) || (x.kind === 'web' && c.kind === 'web' && stripHash(x.url) === stripHash(c.url)))
    if (!same) cover.push(c)
  }
  let topic: string | undefined
  let lecture: number | undefined
  let branch: Gathered['branch']
  let pdfToList: Gathered['pdfToList']
  const said: string[] = []
  const pickedUnits = new Map<string, Set<number>>()
  const pickedUrls = new Set<string>()
  const pickedPdfPages = new Set<string>()
  const boards = new Set<string>()
  let cardN = 0
  const texts = new Map<string, string | null>()
  const readOnce = async (p: string) => {
    if (!texts.has(p)) texts.set(p, await deps.read(p))
    return texts.get(p)!
  }

  const fixed: MaterialRef[] = []
  const cards = refs.filter((r) => r.kind === 'card')
  if (cards.length > CARDS_MAX) throw new Error(`一次最多讲 ${CARDS_MAX} 张卡，这次选了 ${cards.length} 张`)
  /** 选中的卡几张（别的是整块白板、写的词在白板上找到的） */
  let pickedN = 0
  /** 每块白板上读进材料的卡：编号 → 第几张（连线用） */
  const cardNo = new Map<string, Map<string, number>>()
  const cols = new Map<string, Map<number, string>>()
  /** 白板上的一张卡读进材料：盖住、剪自同一页的一起盖、连线认它 */
  const addCard = async (path: string, text: string, u: DocUnit) => {
    boards.add(path)
    lecture ??= lectureOfNote(text, path)
    if (!cols.has(path)) cols.set(path, columnsOf(text))
    const n = ++cardN
    const got = await cardPiece(path, u, n, deps, notes, cols.get(path)!.get(u.from))
    pieces.push(got.piece)
    got.covers.forEach(addCover)
    if (got.url) pickedUrls.add(stripHash(got.url))
    for (const p of got.pdfPages) pickedPdfPages.add(pageKey(p))
    if (!pickedUnits.has(path)) pickedUnits.set(path, new Set())
    pickedUnits.get(path)!.add(u.from)
    const id = unitIdOf(u)
    if (id) {
      if (!cardNo.has(path)) cardNo.set(path, new Map())
      cardNo.get(path)!.set(id, n)
    }
    addCover({ kind: 'card', path, head: got.piece.ref.kind === 'card' ? got.piece.ref.head : '', from: u.from, to: u.to, why: 'picked', ...(id ? { id } : {}) })
  }

  for (const r of refs) {
    if (r.kind === 'map') {
      const text = await readOnce(r.path)
      const b = text === null ? null : branchOf(text, r)
      if (!b || text === null) throw new Error(`导图里找不到「${r.text}」这一支了`)
      boards.add(r.path)
      lecture ??= lectureOfNote(text, r.path)
      topic ??= b.node.text
      const list = mindmapList([b.node])
      fixed.push({ ...r, node: b.key, text: b.node.text })
      pieces.push({ ref: { ...r, node: b.key, text: b.node.text }, title: `导图「${b.node.text}」这一支`, text: list, images: imagesIn(list, r.path), src: { kind: 'note', path: r.path } })
      said.push(`导图「${b.node.text}」这一支`)
      // 超过 5 个子枝：子枝各当一个点，这一支本身是串讲（teaching.md 3.3）
      if (b.node.children.length > CORE_MAX && refs.length === 1) {
        const items: Candidate[] = b.node.children.map((c, i) => ({ name: c.text, refs: [{ kind: 'map', path: r.path, node: pathKey([...keyPath(b.key), i]), text: c.text }], scope: 'point' }))
        branch = { items, chain: { name: b.node.text, refs: [{ ...r, node: b.key, text: b.node.text }], scope: 'section' }, title: b.node.text }
      }
    } else if (r.kind === 'card') {
      fixed.push(r)
      const text = await readOnce(r.path)
      const u = text === null ? null : findUnit(text, r)
      if (!u || text === null) throw new Error(`白板上找不到这张卡了：${r.head}`)
      pickedN++
      await addCard(r.path, text, u)
    } else if (r.kind === 'board') {
      fixed.push(r)
      const text = await readOnce(r.path)
      if (text === null) throw new Error(`找不到「${baseName(r.path)}」了`)
      boards.add(r.path)
      lecture ??= lectureOfNote(text, r.path)
      const map = isMindmap(text) ? parseMindmap(text) : null
      if (map?.found && map.roots.length) {
        const list = mindmapList(map.roots)
        pieces.push({ ref: r, title: `导图「${map.roots[0]!.text}」`, text: list, images: imagesIn(list, r.path), src: { kind: 'note', path: r.path } })
      }
      const units = boardUnits(text).filter((u) => !pickedUnits.get(r.path)?.has(u.from)).slice(0, BOARD_CARDS_MAX)
      for (const u of units) await addCard(r.path, text, u)
      said.push(units.length ? `这块白板上的 ${units.length} 张卡` : map?.found ? '这块白板上的导图' : '')
    } else if (r.kind === 'word') {
      fixed.push(r)
      topic ??= r.word
      // 在白板上写的词：先拿这块白板上说到它的卡（导图白板是带着这个词的那一支），再到库里找
      const here = o.board ? await readOnce(o.board) : null
      if (o.board && here) {
        const w = r.word.trim().toLowerCase()
        const map = isMindmap(here) ? parseMindmap(here) : null
        const node = map?.found ? nodeWith(map.roots, w) : null
        if (node) {
          const list = mindmapList([node])
          pieces.push({ ref: { kind: 'note', path: o.board }, title: `导图「${node.text}」这一支`, text: list, images: imagesIn(list, o.board), src: { kind: 'note', path: o.board } })
          boards.add(o.board)
        }
        const hits = boardUnits(here)
          .filter((u) => !pickedUnits.get(o.board!)?.has(u.from) && plainOf(u.text).toLowerCase().includes(w))
          .slice(0, CARDS_MAX)
        for (const u of hits) await addCard(o.board, here, u)
        said.push(hits.length ? `白板上说到「${r.word}」的 ${hits.length} 张卡` : node ? `导图「${node.text}」这一支` : '')
      }
      const hits = (await deps.search(r.word)).filter((p) => p !== o.board).slice(0, 3)
      for (const p of hits) {
        const body = await readOnce(p)
        if (!body) continue
        const clean = plainOf(body.replace(/^---\n[\s\S]*?\n---\n/, ''))
        const at = Math.max(0, clean.indexOf(r.word) - 600)
        pieces.push({ ref: { kind: 'note', path: p }, title: `笔记「${baseName(p)}」`, text: clean.slice(at, at + 3000), images: [], src: { kind: 'note', path: p } })
        lecture ??= lectureOfNote(body, p)
      }
      said.push(hits.length ? `库里的 ${Math.min(hits.length, 3)} 篇笔记` : '')
    } else if (r.kind === 'pdf') {
      fixed.push(r)
      const pages = await deps.pdf(r.path)
      if (!pages) throw new Error(`读不出「${baseName(r.path)}」里的字（扫描版的 PDF 先在画布笔记里打开做一次文字识别）`)
      lecture ??= lectureOf(baseName(r.path))
      addCover({ kind: 'pdf', path: r.path })
      if (!r.pages) {
        pdfToList = { path: r.path, pages }
        said.push(`「${baseName(r.path)}」`)
        continue
      }
      const [a, b] = r.pages
      const sel = pages.filter((p) => p.page >= a && p.page <= b)
      for (const p of sel) pieces.push({ ref: { kind: 'pdf', path: r.path, pages: [p.page, p.page] }, title: `${baseName(r.path)} 第 ${p.page} 页`, text: p.text, images: [], src: { kind: 'pdf', path: r.path, page: p.page } })
      // 这几页上划成「重点」「定义」的（ParaRead 联动：费曼讲之前先把这几句当材料，两个软件划的都在配对笔记里）
      const marked = highlightsOf((await deps.read(notePathFor(r.path))) ?? '', notePathFor(r.path)).filter((h) => (h.key === 'key' || h.key === 'def') && h.page >= a && h.page <= b)
      if (marked.length)
        pieces.push({
          ref: { kind: 'pdf', path: r.path, pages: [a, b] },
          title: `${baseName(r.path)} 里划的重点和定义`, // 不翻：给 AI 的材料标题
          text: marked.map((h) => `- 第 ${h.page} 页 · ${h.name || h.key}：${h.text}`).join('\n'),
          images: [],
          src: { kind: 'pdf', path: r.path, page: marked[0]!.page },
        })
      said.push(`「${baseName(r.path)}」第 ${a === b ? a : `${a}–${b}`} 页`)
    } else {
      fixed.push(r)
      const body = await readOnce(r.path)
      if (body === null) throw new Error(`找不到「${baseName(r.path)}」了`)
      pieces.push({ ref: r, title: `笔记「${baseName(r.path)}」`, text: plainOf(body.replace(/^---\n[\s\S]*?\n---\n/, '')).slice(0, 6000), images: imagesIn(body, r.path), src: { kind: 'note', path: r.path } })
      lecture ??= lectureOfNote(body, r.path)
    }
  }
  if (pickedN) said.push(`选中的 ${pickedN} 张卡`)

  // 读进材料的卡之间的连线（另一头不在材料里的写它开头几个字）
  for (const [b, nos] of cardNo) {
    const text = texts.get(b)
    if (!text) continue
    const name = (id: string) => {
      const n = nos.get(id)
      if (n) return `卡 ${n}`
      const u = allUnits(text).find((x) => unitIdOf(x) === id)
      return u ? `另一张「${headOf(plainOf(u.text)).slice(0, 20)}」` : null
    }
    const lines = linksOf(text)
      .filter((l) => nos.has(l.from) || nos.has(l.to))
      .map((l) => [name(l.from), name(l.to)])
      .filter((x): x is [string, string] => !!x[0] && !!x[1])
      .map(([a, z]) => `- ${a} → ${z}`)
    if (lines.length) pieces.push({ ref: { kind: 'board', path: b }, title: '白板上这几张卡之间的连线', text: lines.join('\n'), images: [] })
  }

  // 配对的网页（白板属性 read-along）；同一块白板上别的卡：剪自同一页的一起盖，别的交给 AI 挑讲同一件事的
  const others: Gathered['others'] = []
  let paired = false
  for (const b of new Set([...boards, ...(o.board ? [o.board] : [])])) {
    const text = await readOnce(b)
    if (!text) continue
    const ra = prop(text, 'read-along')
    if (ra && /^https?:/.test(ra)) {
      addCover({ kind: 'web', url: ra })
      paired = true
    }
    const skip = pickedUnits.get(b) ?? new Set<number>()
    // 导图本身（那一段列表）和以前的费曼轮不算「别的卡」
    const inside = notCard(text)
    for (const u of allUnits(text)) {
      if (skip.has(u.from) || inside(u)) continue
      const s = SOURCE_LINE.exec(u.text)
      const sameUrl = s?.[2] && pickedUrls.has(stripHash(s[2]))
      const samePdf = pdfLinksIn(u.text, b).some((p) => pickedPdfPages.has(pageKey(p)))
      if (sameUrl || samePdf) addCover({ kind: 'card', path: b, head: headOf(u.text), from: u.from, to: u.to, why: 'same-page', ...(unitIdOf(u) ? { id: unitIdOf(u) } : {}) })
      else others.push({ path: b, unit: u, text: plainOf(u.text) })
    }
  }

  const noMaterial = !pieces.length && !pdfToList
  const parts = said.filter(Boolean)
  const basisLine = noMaterial ? '没有材料，AI 自己定的要点' : `照${parts.join('、')}${paired ? '和配对的网页' : ''}核对`
  return { refs: fixed, pieces, cover, ...(topic ? { topic } : {}), noMaterial, ...(lecture ? { lecture } : {}), basisLine, ...(branch ? { branch } : {}), ...(pdfToList ? { pdfToList } : {}), others }
}

/** 给 AI 的材料全文（几段之间用标题隔开，图写成「[图 N]」和交给 AI 的图对上号） */
export function materialText(pieces: readonly Piece[]): { text: string; images: string[] } {
  const images: string[] = []
  const blocks = pieces.map((p) => {
    const marks = p.images.map((im) => {
      images.push(im)
      return `[图 ${images.length}]`
    })
    const src = p.src?.kind === 'pdf' ? `（出处：${baseName(p.src.path)} 第 ${p.src.page} 页）` : p.src?.kind === 'web' ? `（出处：${p.src.url}）` : ''
    return `## ${p.title}${src}\n${p.text}${marks.length ? `\n${marks.join(' ')}` : ''}`
  })
  return { text: blocks.join('\n\n').slice(0, 40_000), images }
}
