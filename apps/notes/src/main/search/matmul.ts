/**
 * 一次算一大块点乘：这篇的几段 × 全库每一段（searchRelated 用）。JS 一个一个乘，7 万段的库一篇要十几秒；
 * 交给 onnxruntime 的 Gemm（多线程、SIMD）几十毫秒，结果一样（精算，不粗筛）。
 * 模型就一个 Gemm 节点（Y = A · Bᵀ），在这里手写成 ONNX 的 protobuf，不用另带文件。
 */

/** a 是 n 行、b 是 m 行（每行 d 维，连着放），回 n × m 的点乘（第 i 行第 j 列 = a_i · b_j） */
export type Scorer = (a: Float32Array, n: number, b: Float32Array, m: number, d: number) => Promise<Float32Array>

// ---------- protobuf：只用到 varint 和按长度的两种 ----------
const varint = (n: number): number[] => {
  const out: number[] = []
  while (n > 127) {
    out.push((n & 127) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const enc = new TextEncoder()
const field = (no: number, v: number[] | string) => {
  const body = typeof v === 'string' ? [...enc.encode(v)] : v
  return [...varint((no << 3) | 2), ...varint(body.length), ...body]
}
const int = (no: number, v: number) => [...varint(no << 3), ...varint(v)]

/** 二维 float 张量的类型，两维都是名字（运行时才定） */
const tensorType = (dims: string[]) => field(1, [...int(1, 1), ...field(2, dims.flatMap((p) => field(1, field(2, p))))])
const valueInfo = (name: string, dims: string[]) => [...field(1, name), ...field(2, tensorType(dims))]

/** ModelProto：ir_version 8、opset 13，一个 Gemm(transB=1) */
export function gemmModel(): Uint8Array {
  const attr = [...field(1, 'transB'), ...int(3, 1), ...int(20, 2)]
  const node = [...field(1, 'A'), ...field(1, 'B'), ...field(2, 'Y'), ...field(4, 'Gemm'), ...field(5, attr)]
  const graph = [...field(1, node), ...field(2, 'scores'), ...field(11, valueInfo('A', ['n', 'd'])), ...field(11, valueInfo('B', ['m', 'd'])), ...field(12, valueInfo('Y', ['n', 'm']))]
  return new Uint8Array([...int(1, 8), ...field(8, [...field(1, ''), ...int(2, 13)]), ...field(7, graph)])
}

/** onnxruntime 算点乘（搜索进程里用，它本来就载着 onnxruntime-node） */
export async function ortScorer(threads = 4): Promise<Scorer> {
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(gemmModel(), {
    intraOpNumThreads: threads,
    extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
  })
  return async (a, n, b, m, d) => {
    const out = await session.run({ A: new ort.Tensor('float32', a, [n, d]), B: new ort.Tensor('float32', b, [m, d]) })
    return out.Y!.data as Float32Array
  }
}

/** 没有 onnxruntime 时（单元测试）：JS 一个一个乘，结果一样 */
export const jsScorer: Scorer = async (a, n, b, m, d) => {
  const out = new Float32Array(n * m)
  for (let j = 0; j < m; j++) {
    const off = j * d
    for (let i = 0; i < n; i++) {
      let s = 0
      const ai = i * d
      for (let x = 0; x < d; x++) s += b[off + x]! * a[ai + x]!
      out[i * m + j] = s
    }
  }
  return out
}
