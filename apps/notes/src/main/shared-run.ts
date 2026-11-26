/**
 * 同一件整库的重活（底栏的 git 状态、列整个库、待办、PDF 列表……）同时只算一份（2026-11-26 导入卡死）。
 * 以前界面每收到一次「文件变了」就把这些全问一遍，导入几千个文件时同一件活几百份一起跑（一秒上百个 git 进程），
 * 谁也跑不完，窗口卡死。现在：没在算就马上算；正在算时又来问的，都等这一份算完、再一起算一份新的（拿到的是问的那一刻以后的样子），
 * 最多一份在算、一份排着，不会越积越多。
 */
export function sharedRun<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null
  let queued: Promise<T> | null = null
  const start = (): Promise<T> => {
    const p = fn().finally(() => {
      if (running === p) running = null
    })
    running = p
    return p
  }
  return () => {
    if (!running) return start()
    if (!queued) {
      const q = running.then(
        () => undefined,
        () => undefined,
      ).then(() => {
        queued = null
        return start()
      })
      queued = q
    }
    return queued
  }
}

/**
 * 一阵一阵来的通知并成一次（文件监听报「文件变了」）：第一下来了 ms 毫秒内又来的都算同一阵，这一阵停了再报一次；
 * 一直不停（在访达里拷几千个进来）也至少每 maxMs 报一次，界面照样跟得上。以前一个文件报一次，几千个文件界面就重算几千遍
 */
export function burst(fn: () => void, ms = 100, maxMs = 1000): () => void {
  let timer: NodeJS.Timeout | null = null
  let first = 0
  return () => {
    const now = Date.now()
    if (!timer) first = now
    else clearTimeout(timer)
    const wait = Math.max(0, Math.min(ms, first + maxMs - now))
    timer = setTimeout(() => {
      timer = null
      fn()
    }, wait)
  }
}
