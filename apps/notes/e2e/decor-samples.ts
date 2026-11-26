/**
 * 白板装饰端到端测试用的样例（decor-*.spec.ts）：一块像真库那样的组会白板（四列、几张卡），第二列那张卡带编号和 ink=1
 * （胶带、贴纸挂上去不用再给它记编号，md 一个字节都不动）；还有一张透明 PNG、一张不透明 PNG（程序画的，zlib 压缩）。
 */
import { deflateSync } from 'node:zlib'

export const BOARD_PATH = '11.24 组会准备.md'
export const INK_PATH = '附件/11.24 组会准备/笔迹.ink'

export const BOARD = `---
type: board
---
# 11.24 组会准备

## 三个方向（笔记里记下的）

1. **晨佩这条线：驾驶压力识别 + 图网络。** 论文是 C72 BST-GATNet、J52 SAGE。选定以后要学 PyTorch、迁移学习。
2. **情绪识别。** 代表论文 C73，第一步先读懂 E4 手环的数据。

笔记里只记到这些。第 2、3 个方向具体做什么题目、用什么数据，没有记下来，会上要问清楚。

## 这周实际做了什么

<!-- card id=k1 ink=1 -->
- C72 BST-GATNet：第 1、2 页逐段读了，第 4、5 页读了一部分。
- 能讲清楚：输入是手环的 5 种信号（EDA、HR、BVP、TEMP、ACC），GAT 看信号之间的关系。

## 这周学到的（会上讲，约 2 分钟）

第一步，一句话说清 C72 在做什么：用手环的 5 种信号判断司机紧不紧张。

## 会上怎么说

1. 如实说进度：这周主要读了晨佩的两篇论文，深度学习基础比较弱，读得慢。
2. 说倾向：想做 Yiting 这条线（驾驶压力 + 图网络）。
3. 要问的问题：这条线的数据什么时候能拿到？
`

export const FIRST_LINE = '1. **晨佩这条线：驾驶压力识别 + 图网络。**'

// ---------------------------------------------------------------- 程序画的 PNG

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** w × h 的 RGBA PNG，px(x, y) 给每个点的 [r, g, b, a] */
export function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y)
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}

/** 透明底上一个橙色圆（手环的抠图那样）：图边一圈全透明 → 贴纸 */
export const PNG_CLEAR = png(120, 120, (x, y) => {
  const d = Math.hypot(x - 60, y - 60)
  return d < 44 ? [242, 156, 82, 255] : d < 47 ? [255, 255, 255, 255] : [0, 0, 0, 0]
})
/** 不透明的一张（白底上一个蓝块）→ 图片卡 */
export const PNG_SOLID = png(160, 100, (x, y) => (x > 30 && x < 130 && y > 20 && y < 80 ? [91, 143, 217, 255] : [250, 250, 248, 255]))
