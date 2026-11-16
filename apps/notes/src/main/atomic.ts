/**
 * 先写临时文件再改名：别处（Git、测试、同步）任何时候读到的都是写完的一份。
 * 同一个文件的几次写排队一个个来（点得快时，后点的那次最后落盘），临时文件名各不相同。
 * 内容和盘上一样就不写（免得 Git 里多出假改动）；比较也在队里做，不会被前一次还没写完的骗到。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const queues = new Map<string, Promise<unknown>>()
let seq = 0

export function writeFileAtomic(p: string, text: string): Promise<void> {
  const run = async () => {
    const cur = await readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (cur === text) return
    await mkdir(dirname(p), { recursive: true })
    const tmp = `${p}.${process.pid}.${++seq}.tmp`
    await writeFile(tmp, text)
    await rename(tmp, p)
  }
  const next = (queues.get(p) ?? Promise.resolve()).then(run, run)
  queues.set(p, next)
  // 队尾写完就把这个文件从表里拿掉；出错照样从 next 交给调用的人
  next.then(
    () => queues.get(p) === next && queues.delete(p),
    () => queues.get(p) === next && queues.delete(p),
  )
  return next
}
