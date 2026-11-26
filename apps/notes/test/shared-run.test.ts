// 整库的重活同时只算一份、一阵通知并成一次（2026-11-26 导入卡死：导入 6000 个文件时界面每个文件把整个库和 git 状态全问一遍，几百份一起跑）
import { describe, expect, it, vi } from 'vitest'
import { burst, sharedRun } from '../src/main/shared-run'

describe('sharedRun', () => {
  it('正在算时又来 50 次：一共只再算一份，后来的拿到的是新的那份', async () => {
    let calls = 0
    let release: (() => void)[] = []
    const run = sharedRun(
      () =>
        new Promise<number>((r) => {
          const n = ++calls
          release.push(() => r(n))
        }),
    )
    const first = run()
    const later = Array.from({ length: 50 }, () => run())
    expect(calls).toBe(1)
    release.shift()!()
    expect(await first).toBe(1)
    await vi.waitFor(() => expect(calls).toBe(2))
    release.shift()!()
    expect(new Set(await Promise.all(later))).toEqual(new Set([2]))
    // 都算完了，再问是马上算新的
    const again = run()
    expect(calls).toBe(3)
    release.shift()!()
    expect(await again).toBe(3)
    release = []
  })

  it('这一份出错：等它的人拿到错，排着的那份照样算', async () => {
    let calls = 0
    const run = sharedRun(async () => {
      calls++
      if (calls === 1) throw new Error('第一份坏了')
      return calls
    })
    const a = run()
    const b = run()
    await expect(a).rejects.toThrow('第一份坏了')
    expect(await b).toBe(2)
  })
})

describe('burst', () => {
  it('一阵里报 1000 次只通知一次；一直不停时每秒至少一次', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const ping = burst(fn, 100, 1000)
      for (let i = 0; i < 1000; i++) ping()
      expect(fn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
      // 每 50 毫秒来一下、连着 3 秒：不是一直憋着，大约每秒一次
      for (let i = 0; i < 60; i++) {
        ping()
        vi.advanceTimersByTime(50)
      }
      vi.advanceTimersByTime(200)
      expect(fn.mock.calls.length).toBeGreaterThanOrEqual(4)
      expect(fn.mock.calls.length).toBeLessThanOrEqual(5)
    } finally {
      vi.useRealTimers()
    }
  })
})
