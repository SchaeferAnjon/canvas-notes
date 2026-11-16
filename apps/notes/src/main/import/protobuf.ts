/**
 * 读备忘录数据库里的 protobuf：只认线上格式（varint、定长、带长度的一段），不要 .proto 描述；
 * 字段号照备忘录的结构（见 apple-notes-md.ts 开头的说明）按需取。写的那半只给测试造数据用。
 */

/** 一条消息：字段号 → 出现过的值（varint 是 bigint，带长度的是字节） */
export class Pb {
  private constructor(private readonly f: Map<number, (bigint | Uint8Array)[]>) {}

  static decode(buf: Uint8Array): Pb {
    const f = new Map<number, (bigint | Uint8Array)[]>()
    let i = 0
    const varint = (): bigint => {
      let v = 0n
      let shift = 0n
      for (;;) {
        if (i >= buf.length) throw new Error('protobuf 读到一半断了')
        const b = buf[i++]!
        v |= BigInt(b & 0x7f) << shift
        if (!(b & 0x80)) return v
        shift += 7n
      }
    }
    while (i < buf.length) {
      const tag = Number(varint())
      const no = tag >>> 3
      let val: bigint | Uint8Array
      switch (tag & 7) {
        case 0:
          val = varint()
          break
        case 1:
          val = buf.subarray(i, (i += 8))
          break
        case 2: {
          const n = Number(varint())
          val = buf.subarray(i, (i += n))
          break
        }
        case 5:
          val = buf.subarray(i, (i += 4))
          break
        default:
          throw new Error(`protobuf 里有不认识的类型 ${tag & 7}`)
      }
      if (i > buf.length) throw new Error('protobuf 读到一半断了')
      const list = f.get(no)
      if (list) list.push(val)
      else f.set(no, [val])
    }
    return new Pb(f)
  }

  private last(no: number) {
    const l = this.f.get(no)
    return l?.[l.length - 1]
  }

  /** int32 / int64 / bool：负数按 64 位补码还原 */
  int(no: number): number | undefined {
    const v = this.last(no)
    return typeof v === 'bigint' ? Number(BigInt.asIntN(64, v)) : undefined
  }

  bytes(no: number): Uint8Array | undefined {
    const v = this.last(no)
    return v instanceof Uint8Array ? v : undefined
  }

  str(no: number): string | undefined {
    const b = this.bytes(no)
    return b ? Buffer.from(b).toString('utf8') : undefined
  }

  msg(no: number): Pb | undefined {
    const b = this.bytes(no)
    return b ? Pb.decode(b) : undefined
  }

  msgs(no: number): Pb[] {
    return (this.f.get(no) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map((b) => Pb.decode(b))
  }

  allBytes(no: number): Uint8Array[] {
    return (this.f.get(no) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array)
  }
}

// ---------- 写：测试造备忘录数据库用 ----------

/** 一个字段：数字写成 varint，字符串和字节写成带长度的一段，数组是重复字段 */
export type PbField = number | string | Uint8Array | PbField[]

function varintBytes(v: bigint): number[] {
  const out: number[] = []
  let x = BigInt.asUintN(64, v)
  do {
    let b = Number(x & 0x7fn)
    x >>= 7n
    if (x) b |= 0x80
    out.push(b)
  } while (x)
  return out
}

export function pbEncode(fields: Record<number, PbField | undefined>): Uint8Array {
  const out: number[] = []
  const put = (no: number, v: PbField) => {
    if (Array.isArray(v)) return v.forEach((x) => put(no, x))
    if (typeof v === 'number') {
      out.push(...varintBytes(BigInt((no << 3) | 0)), ...varintBytes(BigInt(v)))
      return
    }
    const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v
    out.push(...varintBytes(BigInt((no << 3) | 2)), ...varintBytes(BigInt(b.length)), ...b)
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) put(Number(k), v)
  return Uint8Array.from(out)
}
