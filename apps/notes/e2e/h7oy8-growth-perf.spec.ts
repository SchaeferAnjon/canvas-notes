/**
 * 生长图几千篇不糊、不卡（task-h7oy8 第 4 条）：3000 篇、1 万条链接的库，分 30 次提交（两年里），
 * 量后台算一次要多久（读历史、摆位置）、播放时每帧画多久、拖着平移时一秒几帧；数写进 perf.json。都是真点，窗口不上屏。
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, tabOn } from './app'

const N = 3000
const LINKS = 10_000

function prepareBig(vault: string) {
  // 可重复的随机数
  let s = 7
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  const tops = ['课程', '剪藏', '项目', '写作', '日记', '阅读', '生活', '收件箱']
  const path = (i: number) => {
    const top = tops[i % tops.length]!
    return `${top}/${top}${Math.floor(i / 60) % 7}/笔记${i}.md`
  }
  const name = (i: number) => `笔记${i}`
  const out: string[][] = Array.from({ length: N }, () => [])
  const seen = new Set<string>()
  let made = 0
  while (made < LINKS) {
    const a = Math.floor(rnd() * N)
    // 多半连同一个文件夹里的（成团），少数连到别处
    const b = rnd() < 0.75 ? Math.max(0, Math.min(N - 1, a + Math.floor((rnd() - 0.5) * 120))) : Math.floor(rnd() * N)
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`
    if (a === b || seen.has(key)) continue
    seen.add(key)
    out[a]!.push(name(b))
    made++
  }
  const commit = (when: string, msg: string) => {
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
  }
  const per = N / 30
  for (let c = 0; c < 30; c++) {
    for (let i = c * per; i < (c + 1) * per; i++) {
      const p = join(vault, path(i))
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, `# ${name(i)}\n\n第 ${i} 篇。\n\n${out[i]!.map((t) => `讲到 [[${t}]]。`).join('\n')}\n`)
    }
    const d = new Date(Date.UTC(2024, 0, 1) + c * 24 * 86_400_000)
    commit(d.toISOString().slice(0, 19), `第 ${c + 1} 批`)
  }
  writeFileSync(join(vault, '收件箱/最后一篇.md'), '# 最后一篇\n')
}

test('3000 篇、1 万条链接：后台算多久、播放时每帧画多久、平移一秒几帧', async () => {
  test.setTimeout(300_000)
  const run = await launch({}, {}, prepareBig)
  const { page } = run
  try {
    await leftView(page, '梦游报告')
    const t0 = Date.now()
    await page.getByTestId('dream-seg-growth').click()
    await expect(tabOn(page)).toContainText('生长')
    const canvas = page.getByTestId('growth-canvas')
    await expect(canvas).toHaveAttribute('data-notes', String(N + 1), { timeout: 120_000 })
    const firstMs = Date.now() - t0
    const st = await page.evaluate(() => window.cn.growthData())
    const d = st.data!
    expect(d.links.length).toBeGreaterThanOrEqual(LINKS - 50)
    // 再开一次（缓存里有、库没变）：直接给
    const t1 = Date.now()
    await page.evaluate(() => window.cn.growthData())
    const againMs = Date.now() - t1

    // 播放：量 4 秒里画了几帧、每帧画多久
    const perf = () => page.evaluate(() => {
      const p = (window as unknown as { cnGrowthPerf: { frames: number; drawMs: number[] } }).cnGrowthPerf
      return { frames: p.frames, drawMs: [...p.drawMs] }
    })
    await page.getByTestId('growth-jumps').getByRole('button', { name: '第一个月' }).click()
    const before = await perf()
    await page.getByTestId('growth-play').click()
    await page.waitForTimeout(4000)
    const after = await perf()
    await page.getByTestId('growth-play').click()
    const playDraws = after.drawMs.slice(-Math.min(after.drawMs.length, after.frames - before.frames))
    const sorted = [...playDraws].sort((a, b) => a - b)
    const q = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! * 10) / 10
    const playFps = Math.round((after.frames - before.frames) / 4)

    // 看全库、拖着平移 2 秒：量浏览器一秒走了几帧（requestAnimationFrame）和最长的一帧
    await page.getByTestId('growth-jumps').getByRole('button', { name: '现在' }).click()
    const box = (await page.locator('.gr-stage').boundingBox())!
    await page.evaluate(() => {
      const w = window as unknown as { cnRaf: number[]; cnRafOn: boolean }
      w.cnRaf = []
      w.cnRafOn = true
      const tick = (t: number) => {
        w.cnRaf.push(t)
        if (w.cnRafOn) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const p0 = await perf()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const started = Date.now()
    let k = 0
    while (Date.now() - started < 2000) {
      k++
      await page.mouse.move(box.x + box.width / 2 + Math.sin(k / 6) * 200, box.y + box.height / 2 + Math.cos(k / 6) * 120)
    }
    await page.mouse.up()
    const raf = await page.evaluate(() => {
      const w = window as unknown as { cnRaf: number[]; cnRafOn: boolean }
      w.cnRafOn = false
      return w.cnRaf
    })
    const p1 = await perf()
    const gaps = raf.slice(1).map((t, i) => t - raf[i]!)
    const panFps = Math.round((raf.length - 1) / ((raf[raf.length - 1]! - raf[0]!) / 1000))
    const panDraws = p1.drawMs.slice(-(p1.frames - p0.frames)).sort((a, b) => a - b)
    const out = {
      notes: d.notes.length,
      links: d.links.length,
      firstOpenMs: firstMs,
      worker: d.ms,
      cachedMs: againMs,
      play: { fps: playFps, drawMedianMs: q(0.5), drawP95Ms: q(0.95) },
      pan: { fps: panFps, longestFrameMs: Math.round(Math.max(...gaps)), draws: panDraws.length, drawMedianMs: Math.round(panDraws[Math.floor(panDraws.length / 2)]! * 10) / 10 },
    }
    console.log('生长图性能', JSON.stringify(out))
    writeFileSync(test.info().outputPath('perf.json'), JSON.stringify(out, null, 2))
    await page.screenshot({ path: test.info().outputPath('big.png') })
    expect(q(0.95)).toBeLessThan(16)
    expect(panFps).toBeGreaterThanOrEqual(30)
  } finally {
    await run.close()
  }
})
