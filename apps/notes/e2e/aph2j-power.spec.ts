/**
 * 主题渐变动起来多费电（task-aph2j，用来定「慢慢动」默认开不开）。只在 APH_POWER=1 时跑，结果写到 APH_POWER_OUT（JSON）。
 * 同一个窗口（1440×900、B 浮岛书桌、松林、开着一篇文档和右栏 AI）四种背景各量一遍：纯色、渐变不动、渐变慢慢动、渐变快。
 * 每种：
 *  - 闲着 20 秒：软件所有进程（主进程、界面、GPU…）的 CPU 占用，Electron app.getAppMetrics 每 2 秒取一次的平均；
 *    同时 macOS 的 top 量这几个进程的「能耗影响」（POWER 列，活动监视器里那一列）。
 *  - 一秒画几帧（requestAnimationFrame 数）：确认测试窗口真的在一帧帧合成（不然量出来的不算数）。
 *  - 打字和滚动：在文档里打 120 个字（每个 25 毫秒）、在 AI 栏和文档上滚轮滚 20 次，量这段时间里每一帧隔多久（卡一下 = 一帧超过 50 毫秒）、
 *    每次按键从按下到画出来多久（Event Timing）。
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { open } from './aph2j-look'

const CASES = [
  { name: '纯色', look: { winBg: 'none' } },
  { name: '渐变不动', look: { winBg: 'wall', wallMove: false } },
  { name: '渐变慢慢动', look: { winBg: 'wall', wallMove: true, wallSpeed: 'slow' } },
  { name: '渐变快', look: { winBg: 'wall', wallMove: true, wallSpeed: 'fast' } },
] as const

test.skip(process.env.APH_POWER !== '1', '只在 APH_POWER=1 时量')

test('四种背景闲着、打字、滚动时的占用', async () => {
  test.setTimeout(20 * 60_000)
  const rounds = Number(process.env.APH_ROUNDS ?? 2)
  const out: Record<string, unknown>[] = []
  for (let round = 0; round < rounds; round++)
    for (const c of CASES) {
      const run = await open({ skin: 'pine', frame: 'b', wallMix: 'mid', ...c.look })
      const { page, app } = run
      try {
        await expect(page.locator('html')).toHaveAttribute('data-winbg', c.look.winBg === 'wall' ? 'wall' : 'none')
        // 打开以后先等 5 秒，启动时的活儿（索引、提交检查）过去
        await page.waitForTimeout(5000)
        const pids: number[] = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => m.pid))
        // 一秒几帧
        const fps = await page.evaluate(
          () =>
            new Promise<number>((r) => {
              let n = 0
              const t0 = performance.now()
              const f = () => {
                n++
                if (performance.now() - t0 < 3000) requestAnimationFrame(f)
                else r(n / ((performance.now() - t0) / 1000))
              }
              requestAnimationFrame(f)
            }),
        )
        // 闲着 20 秒：getAppMetrics 的 CPU（每次取的是距上次的平均）
        await app.evaluate(({ app }) => app.getAppMetrics())
        const cpu: Record<string, number[]> = {}
        for (let i = 0; i < 10; i++) {
          await page.waitForTimeout(2000)
          const ms: { type: string; cpu: number }[] = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })))
          const sum: Record<string, number> = {}
          for (const m of ms) sum[m.type] = (sum[m.type] ?? 0) + m.cpu
          sum['合计'] = ms.reduce((a, m) => a + m.cpu, 0)
          for (const [k, v] of Object.entries(sum)) (cpu[k] ??= []).push(v)
        }
        const avg = Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)]))
        // top：5 秒一次取两次，第二次才是这 5 秒里的；POWER 是活动监视器的「能耗影响」
        // 机器很忙时 top 自己也慢：给 120 秒
        const topOut = execFileSync('top', ['-l', '2', '-s', '5', '-stats', 'pid,cpu,power', ...pids.flatMap((p) => ['-pid', String(p)])], { encoding: 'utf8', timeout: 120_000 })
        const last = topOut.split(/\n(?=Processes:)/).pop()!
        const rows = last
          .split('\n')
          .map((l) => l.trim().split(/\s+/))
          .filter((p) => p.length === 3 && pids.includes(Number(p[0])))
        const topCpu = +rows.reduce((a, p) => a + Number(p[1]), 0).toFixed(1)
        const power = +rows.reduce((a, p) => a + Number(p[2]), 0).toFixed(1)

        // 打字、滚动时每一帧隔多久、按键多久画出来
        await page.evaluate(() => {
          const w = window as unknown as { aphFrames: number[]; aphKeys: number[]; aphRun: boolean }
          w.aphFrames = []
          w.aphKeys = []
          w.aphRun = true
          let last = performance.now()
          const f = (t: number) => {
            w.aphFrames.push(t - last)
            last = t
            if (w.aphRun) requestAnimationFrame(f)
          }
          requestAnimationFrame(f)
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (e.name === 'keydown') w.aphKeys.push(e.duration)
          }).observe({ type: 'event', buffered: false, durationThreshold: 16 } as PerformanceObserverInit)
        })
        const body = page.locator('.cm-content, .ProseMirror, [contenteditable="true"]').first()
        await body.click()
        await page.keyboard.press('End')
        await page.keyboard.type('一边写一边看背景会不会卡住打字的手感 '.repeat(6).slice(0, 120), { delay: 25 })
        const box = (await body.boundingBox())!
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(box.x + box.width / 2, box.y + 200)
          await page.mouse.wheel(0, i % 2 ? -300 : 300)
          await page.waitForTimeout(60)
        }
        const r = await page.evaluate(() => {
          const w = window as unknown as { aphFrames: number[]; aphKeys: number[]; aphRun: boolean }
          w.aphRun = false
          const fr = w.aphFrames.slice(1).sort((a, b) => a - b)
          const p = (q: number) => +(fr[Math.floor(fr.length * q)] ?? 0).toFixed(1)
          return { frames: fr.length, p50: p(0.5), p95: p(0.95), max: +(fr[fr.length - 1] ?? 0).toFixed(1), janks: fr.filter((x) => x > 50).length, slowKeys: w.aphKeys.length, worstKey: Math.max(0, ...w.aphKeys) }
        })
        out.push({ round, case: c.name, fps: +fps.toFixed(1), cpu: avg, topCpu, power, typing: r })
        console.log(JSON.stringify(out[out.length - 1]))
      } finally {
        await run.close()
      }
    }
  if (process.env.APH_POWER_OUT) writeFileSync(process.env.APH_POWER_OUT, JSON.stringify(out, null, 2))
})
