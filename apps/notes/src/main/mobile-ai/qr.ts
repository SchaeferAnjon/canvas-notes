/**
 * 配对用的二维码（task-wwqf0）：把配对链接编成 QR 码的黑白格（字节模式、纠错 M 级，按长短自动挑版本），设置页画成 SVG。
 * 照 ISO/IEC 18004 的做法自己写的（Electron 和 Node 都没有现成的，不为一张二维码加依赖）；
 * 编出来的码用 Apple 自己的识别（CoreImage 的 CIDetector）读回来核对：apps/apple/CanvasCore 的 MobileAIParityTests。
 * 纯函数，不碰 Electron。
 */

type Ecc = 'L' | 'M'

/** 每块的纠错码字数、块数（下标是版本 1–40，0 不用） */
const ECC_PER_BLOCK: Record<Ecc, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
}
const BLOCKS: Record<Ecc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
}
/** 格式信息里纠错等级的两位 */
const ECC_BITS: Record<Ecc, number> = { L: 1, M: 0 }

/** 这一版除了定位、校正、格式这些固定格以外能放数据的格数 */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

const dataCodewords = (ver: number, ecc: Ecc) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver]! * BLOCKS[ecc][ver]!

// ---------------------------------------------------------------- GF(256) 上的 Reed–Solomon

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j]!, root)
      if (j + 1 < degree) r[j] = r[j]! ^ r[j + 1]!
    }
    root = gfMul(root, 0x02)
  }
  return r
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ r.shift()!
    r.push(0)
    divisor.forEach((d, i) => (r[i] = r[i]! ^ gfMul(d, factor)))
  }
  return r
}

// ---------------------------------------------------------------- 画格子

export interface QrMatrix {
  size: number
  version: number
  /** modules[y][x]：true 是黑格 */
  modules: boolean[][]
}

function alignPositions(ver: number, size: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function mask(m: number, x: number, y: number): boolean {
  switch (m) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

class Grid {
  readonly ver: number
  readonly size: number
  readonly m: boolean[][]
  readonly fn: boolean[][]
  constructor(ver: number) {
    this.ver = ver
    this.size = ver * 4 + 17
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false))
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false))
  }

  set(x: number, y: number, dark: boolean) {
    this.m[y]![x] = dark
    this.fn[y]![x] = true
  }

  functionPatterns() {
    const s = this.size
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0)
      this.set(i, 6, i % 2 === 0)
    }
    this.finder(3, 3)
    this.finder(s - 4, 3)
    this.finder(3, s - 4)
    const pos = alignPositions(this.ver, s)
    const n = pos.length
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        // 和三个定位块重的那三处不画
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
        this.align(pos[i]!, pos[j]!)
      }
    this.format(ECC_BITS.M, 0)
    this.version()
  }

  finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, d !== 2 && d !== 4)
      }
  }

  align(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  /** 格式信息：纠错等级两位 + 掩码三位，BCH(15,5)，再异或 0x5412；两份 */
  format(eccBits: number, msk: number) {
    const data = (eccBits << 3) | msk
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i))
    this.set(8, 7, bit(bits, 6))
    this.set(8, 8, bit(bits, 7))
    this.set(7, 8, bit(bits, 8))
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i))
    const s = this.size
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(bits, i))
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(bits, i))
    this.set(8, s - 8, true)
  }

  /** 版本信息（7 版起）：BCH(18,6)，两份 */
  version() {
    if (this.ver < 7) return
    let rem = this.ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (this.ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i)
      const a = this.size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      this.set(a, c, b)
      this.set(c, a, b)
    }
  }

  /** 数据按之字形从右下往上填（跳过固定格和第 6 列） */
  codewords(data: number[]) {
    const s = this.size
    let i = 0
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let v = 0; v < s; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const up = ((right + 1) & 2) === 0
          const y = up ? s - 1 - v : v
          if (!this.fn[y]![x] && i < data.length * 8) {
            this.m[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7))
            i++
          }
        }
    }
  }

  applyMask(msk: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y]![x] && mask(msk, x, y)) this.m[y]![x] = !this.m[y]![x]
  }

  /** 罚分（越小越好认）：连成一长条、2×2 一块、像定位块的 1:1:3:1:1、黑白不匀 */
  penalty(): number {
    const s = this.size
    const m = this.m
    let p = 0
    const line = (get: (i: number) => boolean) => {
      let run = 1
      for (let i = 1; i <= s; i++) {
        if (i < s && get(i) === get(i - 1)) run++
        else {
          if (run >= 5) p += 3 + (run - 5)
          run = 1
        }
      }
      const at = (i: number) => (i >= 0 && i < s ? get(i) : false)
      for (let i = -4; i < s; i++) {
        const core = at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6)
        if (!core) continue
        const before = !at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4)
        const after = !at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10)
        if (before || after) p += 40
      }
    }
    for (let y = 0; y < s; y++) line((x) => m[y]![x]!)
    for (let x = 0; x < s; x++) line((y) => m[y]![x]!)
    for (let y = 0; y < s - 1; y++)
      for (let x = 0; x < s - 1; x++) {
        const c = m[y]![x]
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3
      }
    let dark = 0
    for (const row of m) for (const c of row) if (c) dark++
    const total = s * s
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
    return p
  }
}

/** 编一段字（UTF-8，字节模式）；放不下（超过 40 版 M 级）抛错 */
export function encodeQr(text: string, ecc: Ecc = 'M'): QrMatrix {
  const bytes = [...Buffer.from(text, 'utf8')]
  let ver = 1
  for (; ver <= 40; ver++) {
    const need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8
    if (need <= dataCodewords(ver, ecc) * 8) break
  }
  if (ver > 40) throw new Error('配对链接太长，放不进二维码')
  // 比特流：模式 0100（字节）、长度、数据、终止符、补齐到字节、0xEC 0x11 轮流填满
  const bits: number[] = []
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCodewords(ver, ecc) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))

  // 分块、各块算纠错码、交错排
  const nBlocks = BLOCKS[ecc][ver]!
  const eccLen = ECC_PER_BLOCK[ecc][ver]!
  const raw = Math.floor(rawModules(ver) / 8)
  const nShort = nBlocks - (raw % nBlocks)
  const shortLen = Math.floor(raw / nBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1)
    const d = data.slice(k, k + len)
    k += len
    const block = [...d, ...rsRemainder(d, divisor)]
    // 短块在数据末尾插一个占位，交错时跳过
    if (i < nShort) block.splice(len, 0, -1)
    blocks.push(block)
  }
  const all: number[] = []
  for (let i = 0; i < blocks[0]!.length; i++)
    for (let j = 0; j < blocks.length; j++) {
      const v = blocks[j]![i]!
      if (v !== -1) all.push(v)
    }

  // 八种掩码都试一遍，挑罚分最小的
  let best: { p: number; g: Grid } | null = null
  for (let msk = 0; msk < 8; msk++) {
    const g = new Grid(ver)
    g.functionPatterns()
    g.codewords(all)
    g.applyMask(msk)
    g.format(ECC_BITS[ecc], msk)
    const p = g.penalty()
    if (!best || p < best.p) best = { p, g }
  }
  return { size: best!.g.size, version: ver, modules: best!.g.m }
}

/** 画成 SVG 的一条 path（每个黑格一个 1×1 的方块），外面留 4 格白边；viewBox 是格数 */
export function qrSvgPath(q: QrMatrix, quiet = 4): { d: string; side: number } {
  const parts: string[] = []
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y]![x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
  return { d: parts.join(''), side: q.size + quiet * 2 }
}
