/**
 * 白板装饰的画法（设计页 145「卡片贴纸便签胶带」，照设计稿 design/ink-decor/src/decor.js 的精确值）：
 * 便签纸色（浅深两套）、和纸胶带八种花样和两头撕口、消失笔光迹的颜色、自带贴纸的名字。
 * 只管「长什么样」，存法在 @cn/format 的 ink-decor.ts。
 */
import { NOTE_COLORS, type NoteColor, STICKER_PACKS, TAPE_PATTERNS } from '@cn/format'

// ---------------------------------------------------------------- 随机数：和设计稿同一个（撕口按 seed 定，两台设备画出来一样）

let rs = 7
const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const seed = (n: number) => {
  rs = (n * 2654435761) & 0x7fffffff || 7
}

// ---------------------------------------------------------------- 便签

/** 便签纸色的名字（抽屉、纸色浮层上写的） */
export const PAPER_NAMES: Record<NoteColor, string> = {
  yellow: '柠檬黄', // 不翻：画的地方翻
  green: '薄荷绿', // 不翻
  blue: '天蓝', // 不翻
  pink: '樱粉', // 不翻
  orange: '杏橙', // 不翻
  lilac: '丁香紫', // 不翻
}
export const PAPERS: readonly NoteColor[] = NOTE_COLORS

// ---------------------------------------------------------------- 胶带

/** 胶带花样的名字 */
export const TAPE_NAMES: Record<(typeof TAPE_PATTERNS)[number], string> = {
  mint: '薄荷格纹', // 不翻：画的地方翻
  dots: '樱粉波点', // 不翻
  stripe: '柠檬斜纹', // 不翻
  kraft: '牛皮纸', // 不翻
  grid: '方格纸', // 不翻
  floral: '丁香碎花', // 不翻
  stars: '夜空星星', // 不翻
  accent: '跟主题色', // 不翻
}

/** 花样一格（SVG pattern 里面的图形）；跟主题色那种用 CSS 变量（内嵌的 SVG 认 style 里的 var） */
const TAPE_ART: Record<string, { size: number; rot?: number; art: () => string }> = {
  mint: { size: 12, art: () => `<rect width="12" height="12" fill="#BFE6D2"/><rect width="6" height="12" fill="rgba(36,140,96,.26)"/><rect width="12" height="6" fill="rgba(36,140,96,.26)"/>` },
  dots: { size: 12, art: () => `<rect width="12" height="12" fill="#FFD8E0"/><circle cx="3" cy="3" r="1.7" fill="#EE7F98"/><circle cx="9" cy="9" r="1.7" fill="#EE7F98"/>` },
  stripe: { size: 10, rot: 45, art: () => `<rect width="10" height="10" fill="#FFEAA6"/><rect width="4" height="10" fill="#F3BC45"/>` },
  kraft: {
    size: 40,
    art: () =>
      `<rect width="40" height="40" fill="#D6B587"/><path d="M3 6l9 1M20 3l7 2M30 14l8-1M6 20l6 2M17 27l9-1M29 33l7 2M2 35l6-1M24 18l4 1" stroke="rgba(110,70,30,.28)" stroke-width=".8"/><path d="M10 12l5 1M33 25l5 1M14 36l4-1" stroke="rgba(255,240,210,.5)" stroke-width=".8"/>`,
  },
  grid: { size: 8, art: () => `<rect width="8" height="8" fill="#E2EEFA"/><path d="M0 .3H8M.3 0V8" stroke="#8FB4DD" stroke-width=".7"/>` },
  floral: {
    size: 18,
    art: () =>
      `<rect width="18" height="18" fill="#EEE5FB"/>` +
      [
        [5, 5],
        [14, 13],
      ]
        .map(
          ([x, y]) =>
            [0, 72, 144, 216, 288].map((a) => `<circle cx="${x! + Math.cos((a * Math.PI) / 180) * 2}" cy="${y! + Math.sin((a * Math.PI) / 180) * 2}" r="1.35" fill="#B48ADB"/>`).join('') +
            `<circle cx="${x}" cy="${y}" r="1.1" fill="#F7C44A"/>`,
        )
        .join(''),
  },
  stars: {
    size: 16,
    art: () =>
      `<rect width="16" height="16" fill="#2F4673"/><path d="M5 2.5l.9 2 2.1.3-1.5 1.5.4 2.1L5 7.4l-1.9 1 .4-2.1L2 4.8l2.1-.3z" fill="#FFE08A"/><circle cx="12" cy="11" r=".9" fill="#FFF3C4"/><circle cx="10" cy="3" r=".6" fill="#FFF3C4"/>`,
  },
  accent: { size: 14, art: () => `<rect width="14" height="14" style="fill:var(--acc)"/><rect y="5" width="14" height="1.4" fill="rgba(255,255,255,.35)"/><rect y="8" width="14" height="1.4" fill="rgba(255,255,255,.35)"/>` },
}

/** 认不出的花样按薄荷格纹画 */
export const tapePattern = (pat: string) => (TAPE_ART[pat] ? pat : 'mint')

function tornEdge(x0: number, y0: number, y1: number, dir: number): [number, number][] {
  const pts: [number, number][] = []
  for (let y = y0; y <= y1; y += 2.6) pts.push([x0 + dir * (rnd() * 3.6), Math.min(y, y1)])
  return pts
}

/** 画好的胶带（同样的花样、长、撕口画出来一样：每次画白板不重做、不换 DOM） */
const made = new Map<string, string>()
/** 一段胶带的 SVG（宽 len，高 28），两头撕口按 s 定；不透明度由外面的 CSS 管（浅色 80%、深色 86%） */
export function tapeSVG(pat: string, len: number, s: number, h = 26): string {
  const key = `${tapePattern(pat)}-${Math.round(len * 100)}-${s}-${h}`
  const hit = made.get(key)
  if (hit) return hit
  const out = drawTape(pat, len, s, h, `dctp-${key}`)
  if (made.size > 400) made.clear()
  made.set(key, out)
  return out
}
function drawTape(pat: string, len: number, s: number, h: number, pid: string): string {
  seed(s * 31 + len)
  const T = TAPE_ART[tapePattern(pat)]!
  const L = tornEdge(4, 1, h + 1, -1).reverse()
  const R = tornEdge(len - 4, 1, h + 1, 1)
  const d = `M${L[L.length - 1]![0]} 1 L${R[0]![0]} 1 ${R.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} L${L[0]![0]} ${h + 1} ${L.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')}Z`
  return `<svg class="dc-tape-svg" width="${len}" height="${h + 2}" viewBox="0 0 ${len} ${h + 2}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="${pid}" width="${T.size}" height="${T.size}" patternUnits="userSpaceOnUse"${T.rot ? ` patternTransform="rotate(${T.rot})"` : ''}>${T.art()}</pattern><linearGradient id="${pid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient></defs><g class="dc-tape-op"><path d="${d}" fill="url(#${pid})"/><path d="${d}" fill="url(#${pid}g)"/></g></svg>`
}

/** 新胶带的长度、角度、撕口：吸在卡上的长 72–88、角度在吸附位上 ±3°；钉在白板上的长 90、歪 ±10° */
export function freshTape(snapped: { rot: number } | null): { len: number; rot: number; seed: number } {
  const r = Math.random() - 0.5
  const s = Math.floor(Math.random() * 1000) + 1
  if (snapped) return { len: 72 + Math.round(Math.random() * 16), rot: Math.round((snapped.rot + r * 6) * 10) / 10, seed: s }
  return { len: 90, rot: Math.round(r * 200) / 10, seed: s }
}

// ---------------------------------------------------------------- 贴纸

export const PACK_NAMES: Record<keyof typeof STICKER_PACKS, string> = {
  study: '学习', // 不翻：画的地方翻
  label: '标签', // 不翻
  mood: '心情', // 不翻
}

/** 自带贴纸的名字（悬停提示、读屏） */
export const STICKER_NAMES: Record<string, string> = {
  star: '星星', // 不翻：画的地方翻
  bulb: '灯泡', // 不翻
  check: '对勾', // 不翻
  ask: '问号', // 不翻
  bang: '感叹号', // 不翻
  book: '书', // 不翻
  pencil: '铅笔', // 不翻
  cap: '学士帽', // 不翻
  lens: '放大镜', // 不翻
  clock: '闹钟', // 不翻
  cup: '奖杯', // 不翻
  fire: '火苗', // 不翻
  zd: '重点', // 不翻
  kd: '考点', // 不翻
  dc: '待查', // 不翻
  yd: '已读', // 不翻
  gd: '搞定', // 不翻
  wls: '问老师', // 不翻
  lg: '灵感', // 不翻
  fx: '复习', // 不翻
  cy: '存疑', // 不翻
  todo: 'TODO', // 不翻
  done: 'DONE', // 不翻
  bd: '必读', // 不翻
  coffee: '咖啡', // 不翻
  heart: '爱心', // 不翻
  smile: '笑脸', // 不翻
  spark: '闪光', // 不翻
  sun: '太阳', // 不翻
  cloud: '云', // 不翻
  leaf: '叶子', // 不翻
  cat: '猫', // 不翻
  rocket: '火箭', // 不翻
  moon: '月亮', // 不翻
  note: '音符', // 不翻
  rainbow: '彩虹', // 不翻
}

/** 字标签里横着的那几张（96 × 48）；圆章（考点、已读、DONE）是方的 */
const WIDE = new Set(['zd', 'dc', 'gd', 'wls', 'lg', 'fx', 'cy', 'todo', 'bd'])
/** 贴纸的高宽比（自带的） */
export const stickerAspect = (k: string) => (WIDE.has(k) ? 0.5 : 1)

/** 新贴纸歪 −8° 到 8° */
export const freshStickerRot = () => Math.round((Math.random() - 0.5) * 160) / 10

// ---------------------------------------------------------------- 消失笔

export type FadeColor = 'red' | 'acc' | 'yellow'
/** 光的颜色和亮芯；强调色那种按主题的 --acc */
export function glowColors(c: FadeColor, acc: string): [string, string] {
  if (c === 'acc') return [acc, '#E9FFF8']
  if (c === 'yellow') return ['#FFC400', '#FFF4C2']
  return ['#FF3B30', '#FFD5D2']
}

/** 点列 → 平滑的 SVG 路径（二次曲线过中点，同设计稿 smooth） */
export function smoothPath(P: readonly [number, number][]): string {
  if (P.length < 3) return `M${P.map((p) => p.join(' ')).join(' L')}`
  let d = `M${P[0]![0].toFixed(1)} ${P[0]![1].toFixed(1)}`
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i]![0] + P[i + 1]![0]) / 2
    const my = (P[i]![1] + P[i + 1]![1]) / 2
    d += ` Q${P[i]![0].toFixed(1)} ${P[i]![1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }
  const L = P[P.length - 1]!
  return d + ` L${L[0].toFixed(1)} ${L[1].toFixed(1)}`
}
