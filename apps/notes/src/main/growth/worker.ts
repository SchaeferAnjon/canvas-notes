/**
 * 生长图在单独的进程里算（Electron utilityProcess，同找像的笔记）：读 Git 历史、拼数据、摆位置，几千篇的库要几秒，主进程不卡。
 * 读过的历史和摆好的位置存在设置目录的缓存里（不进库、不上传），下次接着用。
 */
import { setPriority } from 'node:os'
import { compute, type GrowthJob } from './compute'

try {
  setPriority(10)
} catch {
  // 调不了优先级（权限）就照常跑
}
process.parentPort.on('message', (e) => {
  const job = e.data as GrowthJob
  void compute(job).then(
    (value) => process.parentPort.postMessage({ ok: true, value }),
    (err: unknown) => process.parentPort.postMessage({ ok: false, error: String((err as Error).stack ?? err) }),
  )
})
