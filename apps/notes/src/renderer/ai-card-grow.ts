/**
 * 白板上 AI 加的卡、改过字的卡：卡里的字一点点长出来（task-6kun1，节奏和文档里一样：每 60 毫秒 2 个字，长的加速、4 秒内显完）。
 * 只用 CSS 高亮（CSS Custom Highlight API，`::highlight(cn-ai-grow)` 字是透明的）把还没显的字盖住：
 * 不改卡里的 DOM、不改文件，卡的大小在一开始就是写完的样子，白板的布局一点不动。
 * 减少动态时不盖；esc 一下全显（ai-spot.ts 的 esc 也叫这里）。
 */
import { GROW_TICK, growStep, shownAt } from '../shared/ai-grow'
import { still } from './ai-act-store'

const HL = 'cn-ai-grow'

interface CardGrow {
  units: number
  step: number
  t0: number
}

const cards = new Map<HTMLElement, CardGrow>()
let timer: ReturnType<typeof setTimeout> | null = null

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void }
const highlights = (): Highlights | null => (CSS as unknown as { highlights?: Highlights }).highlights ?? null

/** 卡里的字（一个个文字节点，按顺序） */
function texts(el: HTMLElement): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.length) out.push(n as Text)
  return out
}

/** 从第 shown 个字到卡的末尾 */
function tail(el: HTMLElement, shown: number): Range | null {
  const nodes = texts(el)
  let left = shown
  for (const n of nodes) {
    if (left < n.data.length) {
      const r = document.createRange()
      // 一个字的两半（表情、生僻字）不从中间切
      const c = n.data.charCodeAt(left)
      r.setStart(n, c >= 0xdc00 && c <= 0xdfff ? left + 1 : left)
      r.setEnd(el, el.childNodes.length)
      return r
    }
    left -= n.data.length
  }
  return null
}

function paint() {
  const hl = highlights()
  const now = performance.now()
  const ranges: Range[] = []
  for (const [el, g] of cards) {
    const shown = shownAt(Math.floor((now - g.t0) / GROW_TICK) + 1, g.step, g.units, g.units)
    const r = el.isConnected && shown < g.units ? tail(el, shown) : null
    if (r) ranges.push(r)
    else cards.delete(el)
  }
  if (hl) {
    if (ranges.length) hl.set(HL, new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges))
    else hl.delete(HL)
  }
  if (cards.size && !timer)
    timer = setTimeout(() => {
      timer = null
      paint()
    }, GROW_TICK)
}

/** 这张卡里的字从头一点点长出来（已经在长的不重来） */
export function growCard(el: HTMLElement) {
  if (still() || cards.has(el) || !highlights()) return
  const units = texts(el).reduce((n, t) => n + t.data.length, 0)
  if (!units) return
  cards.set(el, { units, step: growStep(units), t0: performance.now() })
  // 先盖上（下一帧画出来之前），再按节拍一点点揭开
  paint()
}

/** 一下全显；有在长的才算接住了 esc */
export function finishCards(): boolean {
  if (!cards.size) return false
  cards.clear()
  if (timer) clearTimeout(timer)
  timer = null
  highlights()?.delete(HL)
  return true
}

/**
 * 长字的这张卡（连同下面那一颗「AI 在写这张卡」）不全在看得见的白板里（在屏幕外）：
 * 白板平移过去，四周留 24；已经整个看得见就不动。
 * 左边的工具板（.bpal）盖着的那一截不算看得见（bug 三组：以前按整块白板算，新的一列在右边时往右推，最左那一列推到工具板底下）。
 * 内容最左边原来在工具板右边时，往右推按整列走：推到某一列的左边正好离工具板 12（和刚打开时一样），这张卡整个露出来；
 * 一列都放不下时推到这张卡那一列离工具板 12。不在列里的卡只推到内容离工具板 12 为止。
 * 人自己已经把内容拖到骑在工具板右边线上的，照旧按可见区推
 */
function reveal(el: HTMLElement) {
  const wrap = el.closest<HTMLElement>('.board-wrap')
  if (!wrap) return
  const w = wrap.getBoundingClientRect()
  const c = el.getBoundingClientRect()
  const pal = wrap.parentElement?.querySelector<HTMLElement>(':scope > .bpal')?.getBoundingClientRect()
  const pad = 24
  const below = 40
  const left = pal && pal.width ? Math.max(w.left, pal.right) : w.left
  const L = left + pad
  const R = w.left + (wrap.clientWidth || w.width) - pad
  const T = w.top + pad
  const B = w.top + (wrap.clientHeight || w.height) - pad
  let dx = c.right > R ? Math.min(c.right - R, c.left - L) : c.left < L ? c.left - L : 0
  const dy = c.bottom + below > B ? Math.min(c.bottom + below - B, c.top - T) : c.top < T ? c.top - T : 0
  if (dx > 0 && pal && pal.width) {
    const rects = (sel: string) => [...wrap.querySelectorAll<HTMLElement>(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width)
    // 工具板右边以右还露着的内容（整个滚到工具板左边去的不算）：最左那一块的左边；有一块骑在工具板右边线上就是人自己拖过去的
    const shown = rects('.db-col, .db-card.placed, .fy-col, .bcard').filter((r) => r.right > pal.right + 1)
    const most = Math.min(...shown.map((r) => r.left))
    // 离工具板 12 那条线（上一回推到贴着、平滑滚动还没停时差的那一点也算没过线）
    const edge = pal.right + 12
    if (most >= pal.right - 1) {
      const col = el.closest<HTMLElement>('.db-col')?.getBoundingClientRect()
      if (col) {
        const need = c.right - R
        const step = rects('.db-col')
          .map((r) => r.left - edge)
          .filter((d) => d >= need && d <= col.left - edge + 0.5)
          .sort((a, b) => a - b)[0]
        dx = step ?? col.left - edge
      } else if (c.left <= R) dx = Math.min(dx, Math.max(most - edge, 0))
    }
  }
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  // 按现在的位置算到哪（不用 scrollBy：平滑滚动还没停时又来一张卡，scrollBy 叠在没走完的那一截上，推过头、停在两列中间）
  wrap.scrollTo({ left: wrap.scrollLeft + dx, top: wrap.scrollTop + dy, behavior: still() ? 'auto' : 'smooth' })
}

/** 卡的字（认哪张卡是新写的：白板上原来没有这段字的） */
const cardText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const CARD = '.db-card[data-id], .bcard[data-id]'

/**
 * AI 写了这块白板（ai-act-store 的 wrote）：记下现在每张卡的字，等白板按新的文字重画出来（最多 3 秒），
 * 字是新的那几张卡（加的、改过字的；挪了位置的字没变，不算）一点点长出来
 */
export function watchBoard(host: HTMLElement) {
  const before = new Set([...host.querySelectorAll(CARD)].map(cardText))
  // 白板一重画（同一个任务里的微任务）就认：在下一帧画出来之前先盖上，新卡的字不会先整段闪一下
  const mo = new MutationObserver(() => {
    for (const el of host.querySelectorAll<HTMLElement>(CARD)) {
      const t = cardText(el)
      if (!t || before.has(t)) continue
      before.add(t)
      growCard(el)
      reveal(el)
    }
  })
  mo.observe(host, { childList: true, subtree: true, characterData: true })
  setTimeout(() => mo.disconnect(), 3000)
}
