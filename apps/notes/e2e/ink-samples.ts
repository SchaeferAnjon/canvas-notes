/**
 * 白板笔迹端到端测试用的样例（ink-board.spec.ts、ink-shots.spec.ts、ink-perf.spec.ts）：一块白板和它的 笔迹.ink。
 * 笔是程序合成的：像写字一样的波浪线、圈、下划线，点宽、力、时间照 PencilKit 钢笔写出来的样子（钢笔点宽 3–4.5，荧光笔 14 上下）。
 */
import { encodePoints, type InkPoint } from '@cn/format'

const pt = (x: number, y: number, w: number, i: number, n: number, o: { az?: number; al?: number } = {}): InkPoint => {
  const f = 0.3 + 0.7 * Math.sin((Math.PI * (i + 1)) / (n + 1))
  return { x, y, w, f, t: i / 240, az: o.az ?? 0, al: o.al ?? Math.PI / 2, h: w, o: 1 }
}

/** 一行「字」：波浪线带几个上下的钩，宽 len、起笔收笔细 */
export function scribble(len: number, seed = 1, w0 = 3.6): string {
  const n = Math.max(8, Math.round(len / 3))
  const pts: InkPoint[] = []
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * len
    const y = 8 * Math.sin(i * 0.9 + seed) + 5 * Math.sin(i * 2.3 + seed * 1.7)
    pts.push(pt(x, y, w0 * (0.85 + 0.25 * Math.sin((Math.PI * i) / n)), i, n))
  }
  return encodePoints(pts)
}

/** 一个圈：中心 (cx, cy)、半径 r，收笔略过起笔 */
export function circle(cx: number, cy: number, r: number, w0 = 3.4): string {
  const n = 40
  const pts: InkPoint[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / (n - 4)) * Math.PI * 2
    pts.push(pt(cx + r * 1.15 * Math.cos(a), cy + r * Math.sin(a), w0, i, n))
  }
  return encodePoints(pts)
}

/** 一笔直的荧光笔：长 len，扁头斜着拿（方位角 0.9） */
export function highlight(len: number, w0 = 14): string {
  const n = Math.max(6, Math.round(len / 6))
  const pts: InkPoint[] = []
  for (let i = 0; i < n; i++) pts.push(pt((i / (n - 1)) * len, Math.sin(i * 0.7) * 1.2, w0, i, n, { az: 0.9, al: 0.95 }))
  return encodePoints(pts)
}

/** 一条下划线（挂在卡上的那一笔） */
export function underline(len: number, w0 = 3.8): string {
  const n = 24
  const pts: InkPoint[] = []
  for (let i = 0; i < n; i++) pts.push(pt((i / (n - 1)) * len, 2 * Math.sin(i * 0.5), w0, i, n))
  return encodePoints(pts)
}

/** 白板：两列，第一列第二张卡有编号 k1（笔迹挂在它上面，那一行带 ink=1） */
export const BOARD = `---
type: board
---
# 组会白板

## 方向

驾驶压力识别 + 图网络。

<!-- card id=k1 ink=1 -->
情绪识别：E4 手环，唤醒和效价。

## 这周

- [x] 读完 C73
- [ ] 跑通特征
`

export const BOARD_PATH = '组会白板.md'
export const INK_PATH = '附件/组会白板/笔迹.ink'

/** 笔迹：空白处一组（钢笔两笔：一行字和一个圈）、一组荧光笔、挂在卡 k1 上的一笔下划线 */
export const INK =
  [
    '{"ink":1}',
    '{"g":"free0001","x":860,"y":300}',
    `{"id":"word0001","g":"free0001","pen":"pen","c":"#1d2421","seed":11,"p":"${scribble(150, 1)}"}`,
    `{"id":"ring0001","g":"free0001","pen":"pen","c":"#2459c6","seed":12,"p":"${circle(75, 0, 30)}"}`,
    '{"g":"mark0001","x":860,"y":440}',
    `{"id":"hili0001","g":"mark0001","pen":"marker","c":"#ffd84d","seed":13,"p":"${highlight(140)}"}`,
    '{"g":"card0001","on":"k1","x":16,"y":34}',
    `{"id":"undr0001","g":"card0001","pen":"pen","c":"#d64545","seed":14,"p":"${underline(150)}"}`,
  ].join('\n') + '\n'
