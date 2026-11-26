/**
 * 来源在 iCloud 里（用户的 Obsidian 库放在 iCloud 云盘）：一部分文件只是占位（dataless，访达里是一朵云，内容还在云上），
 * 读一下才去下载，一个几 MB 的要等几秒、断网时一直等、偶尔直接报错（「Resource deadlock avoided」）。
 * 以前导入在主进程里一篇篇直接读，读到占位文件就卡在那儿（界面上「在读 · 0 / …」一直不动），读 Node 的文件线程池被占满时整个软件的读写都跟着停。
 * 现在：选文件夹时用 /usr/bin/find -flags +dataless 一个进程数出哪些是占位（只看标记，不读内容，不触发下载）；
 * 导入时先把它们下载下来（每个文件起一个 /bin/cat 读一遍、输出扔掉，同时 4 个，带进度；卡住的 10 分钟杀掉），
 * 读和下载都在子进程里，主进程不等；下不下来的不导，结果里一个个列出来。
 *
 * 测试（没法在 iCloud 外面造真的占位文件）：CN_IMPORT_FAKE_CLOUD=<json 文件>，里面 { "相对路径": { "ms": 下载要多久, "fail": 下不下来 } }，
 * 这些文件当成占位：数的时候算它们，「下载」是起一个 /bin/sleep 等那么久（照样是子进程、照样能停、照样有进度），fail 的下完还是占位。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FAKE = process.env.CN_IMPORT_FAKE_CLOUD
type Fake = Record<string, { ms: number; fail?: boolean }>
const fake: Fake | null = FAKE ? (JSON.parse(readFileSync(FAKE, 'utf8')) as Fake) : null
/** 假的那些里已经「下载」好的 */
const fetched = new Set<string>()

/** 每个文件最多等多久（一个大视频在慢网上也该下完了；再长多半是断网，杀掉算下不下来） */
const FILE_MS = 10 * 60_000
const PARALLEL = 4

function run(cmd: string, args: string[], o: { signal?: AbortSignal; timeoutMs?: number; out?: boolean } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', o.out ? 'pipe' : 'ignore', 'ignore'], ...(o.signal ? { signal: o.signal } : {}), ...(o.timeoutMs ? { timeout: o.timeoutMs } : {}) })
    const chunks: Buffer[] = []
    p.stdout?.on('data', (b: Buffer) => chunks.push(b))
    p.on('error', (e) => (o.signal?.aborted ? reject(o.signal.reason) : reject(e)))
    p.on('close', (code) => (o.signal?.aborted ? reject(o.signal.reason) : resolve({ code, out: Buffer.concat(chunks).toString('utf8') })))
  })
}

/**
 * dir 下面还是占位的文件（相对路径），. 开头的文件夹不进（导入本来就不拷它们）。
 * 只看文件系统的标记，不读内容
 */
export async function cloudFiles(dir: string, signal?: AbortSignal): Promise<Set<string>> {
  if (fake) return new Set(Object.keys(fake).filter((k) => fake[k]!.fail || !fetched.has(k)))
  const r = await run('/usr/bin/find', [dir, '-name', '.*', '-not', '-path', dir, '-prune', '-o', '-type', 'f', '-flags', '+dataless', '-print0'], { signal, timeoutMs: 120_000, out: true })
  if (r.code !== 0) throw new Error(`数 iCloud 里没下载的文件没成功（find 退出码 ${r.code}）`)
  return new Set(
    r.out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.slice(dir.length + 1)),
  )
}

/**
 * 把这些占位文件下载下来：每个起一个子进程读一遍，同时 PARALLEL 个；每好一个报一次进度。
 * 返回下完以后还是占位的（下不下来的）。停下时杀掉正在下的，抛 signal.reason
 */
export async function download(dir: string, rels: string[], o: { signal?: AbortSignal; onProgress?(done: number, total: number, rel: string): void } = {}): Promise<Set<string>> {
  let next = 0
  let done = 0
  const one = async (rel: string) => {
    if (fake) {
      const f = fake[rel]!
      await run('/bin/sleep', [String(f.ms / 1000)], { signal: o.signal })
      if (!f.fail) fetched.add(rel)
      return
    }
    // 读不下来（退出码不是 0、超时被杀）这里不管：下完再数一遍，还是占位的就是没下下来
    await run('/bin/cat', ['--', join(dir, rel)], { signal: o.signal, timeoutMs: FILE_MS })
  }
  const lane = async () => {
    while (next < rels.length) {
      o.signal?.throwIfAborted()
      const rel = rels[next++]!
      await one(rel)
      o.onProgress?.(++done, rels.length, rel)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, rels.length) }, lane))
  if (!rels.length) return new Set()
  const still = await cloudFiles(dir, o.signal)
  return new Set(rels.filter((r) => still.has(r)))
}
