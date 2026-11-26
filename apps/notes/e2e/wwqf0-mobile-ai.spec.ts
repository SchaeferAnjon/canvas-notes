// 让 iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：设置 › AI「iPhone 和 iPad」那颗开关默认关；真点打开，出二维码；
// 照 iPad 的做法写的小客户端（src/main/mobile-ai/client.ts）拿二维码里的链接配对，问一句、一帧一帧拿回答（假 AI，CN_AI_FAKE=1）；
// 没配对的、取消配对以后的一律被拒；关掉开关服务就停。另一条开 Bonjour，用系统的 dns-sd -B 看得到这台 Mac，关掉、退出软件就没了。
// 一律无头（CN_E2E=1）、临时库、临时设置目录，钥匙只放内存（不碰钥匙串）。
import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import { ask, hello, pairWith, type Paired } from '../src/main/mobile-ai/client'
import { type Frame, parsePairLink } from '../src/main/mobile-ai/protocol'
import { launch } from './app'

const files = {
  '随手记.md': '# 随手记\n\n一段字。\n',
  '课程/线性代数.md': '# 线性代数\n\n矩阵乘法就是把一个变换接在另一个后面。\n',
  '读书/三体.md': '# 三体\n\n黑暗森林是一种猜疑链。\n',
}
/** 修改时间定死：线性代数最新，三体其次，随手记最早（「最近改过哪些笔记」按这个排） */
const ages = (vault: string) => {
  const now = Date.now() / 1000
  utimesSync(join(vault, '课程/线性代数.md'), now - 60, now - 60)
  utimesSync(join(vault, '读书/三体.md'), now - 3600, now - 3600)
  utimesSync(join(vault, '随手记.md'), now - 7200, now - 7200)
}
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const group = (page: Page) => dialog(page).getByRole('group', { name: 'iPhone 和 iPad' })
const toggle = (page: Page) => group(page).getByRole('switch', { name: '让iPhone / iPad用这台Mac的AI' })
const qr = (page: Page) => group(page).getByRole('img', { name: '配对二维码' })

async function openAiSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
}

const textOf = (frames: Frame[]) =>
  frames
    .filter((f): f is Extract<Frame, { t: 'text' }> => f.t === 'text')
    .map((f) => f.d)
    .join('')

test('设置 › AI：开关默认关；打开出二维码，扫码配对以后问一句一帧一帧拿回答；没配对的、取消配对以后的被拒；关掉服务就停', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_MAC_NAME: '测试 Mac' }, ages)
  const { page } = run
  try {
    await openAiSettings(page)
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await expect(qr(page)).toHaveCount(0)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
    await expect(qr(page)).toBeVisible()
    await expect(group(page).getByTestId('mobile-ai-expiry')).toHaveText('这个码10分钟内有效，用一次就作废')
    await expect(group(page)).toContainText('用iPhone或iPad扫一下')
    // 二维码真画出来了（一百多个黑格）
    expect(await qr(page).locator('path').getAttribute('d')).toMatch(/^(M\d+ \d+h1v1h-1z){100,}$/)
    const link = parsePairLink((await qr(page).getAttribute('data-link'))!)
    expect(link.name).toBe('测试 Mac')
    const base = `http://127.0.0.1:${link.port}`

    // 没配对过的设备：被拒，AI 一个字都不答
    const stranger: Paired = { base, device: 'stranger-ipad', secret: Buffer.alloc(32, 7), mac: link.id, name: '' }
    await expect(ask(stranger, { kind: 'chat', text: '你好' })).rejects.toMatchObject({ status: 401 })

    // 扫码配对：设置里多一行这台设备，二维码换成「配一台新的」（这个码用掉了）
    const pad = await pairWith(link, base, '一飞冲天', 'iPad')
    expect(pad.name).toBe('测试 Mac')
    await expect(group(page).locator('[data-row^="mobileAiDev-"]')).toHaveCount(1)
    await expect(group(page).locator('[data-row^="mobileAiDev-"] .sa-lb')).toHaveText('iPad「一飞冲天」')
    await expect(group(page).locator('[data-row^="mobileAiDev-"] .sa-ds')).toHaveText('配对于刚刚 · 还没问过')
    await expect(qr(page)).toHaveCount(0)
    await expect(group(page).getByRole('button', { name: '配一台新的' })).toBeVisible()
    // 同一个码再扫一次：不认
    await expect(pairWith(link, base, '别人的 iPad')).rejects.toThrow('403')

    // 在吗：Mac 的名字、正在用哪家
    const h = await hello(pad)
    expect(h).toMatchObject({ t: 'hello', mac: '测试 Mac', engine: 'claude', vault: true })
    if (h.t === 'hello') expect(h.label).toMatch(/^Claude Code/)

    // 问一句：第一帧 meta（哪台 Mac、哪家），字一小段一小段来，最后 done
    const t0 = Date.now()
    let metaMs = -1
    const frames = await ask(pad, { kind: 'chat', text: '冰岛几月去好？', device: 'iPad' }, (f, at) => {
      if (f.t === 'meta') metaMs = at - t0
    })
    expect(frames[0]).toMatchObject({ t: 'meta', mac: '测试 Mac', engine: 'claude' })
    expect(metaMs).toBeGreaterThanOrEqual(0)
    expect(metaMs).toBeLessThan(2000)
    expect(frames.at(-1)).toMatchObject({ t: 'done' })
    expect(frames.filter((f) => f.t === 'text').length).toBeGreaterThan(2)
    expect(textOf(frames)).toBe('这是测试回答（Claude Code）。')

    // PDF 上选一段讲解一下：页码、选中的字都传到了 AI（假 AI 照着话里的页码答）
    const ex = await ask(pad, { kind: 'explain', text: '', quote: 'Grid lines stay straight', source: { kind: 'pdf', title: 'Linear transformations', path: '课程/Linear transformations.pdf', page: 3, pages: 12, pageText: 'Grid lines stay straight, parallel and evenly spaced.' } })
    expect(textOf(ex)).toContain('这是讲解（第 3 页')

    // 手机交给 Mac 的 AI：在首页问「最近改过哪些笔记」，Mac 这头给了读库工具，AI 调 list_recent、read_note 查到库里真的笔记再答
    // （以前一个工具都不给，AI 说一句「我先看看」就停了）。手机头上切成只读（mode: 'read'）时走这一路；全能模式那一路见 phone-full-mode.spec.ts
    const recent = await ask(pad, { kind: 'chat', text: '最近改过哪些笔记？都是说什么的', device: 'iPhone', mode: 'read' })
    expect(textOf(recent)).toBe('最近改过的笔记：《线性代数》、《三体》、《随手记》。第一篇讲的是：矩阵乘法就是把一个变换接在另一个后面。')
    await expect(group(page).locator('[data-row^="mobileAiDev-"] .sa-ds')).toHaveText('配对于刚刚 · 刚刚问过')

    // 配一台新的：换出新的码，二维码回来
    await group(page).getByRole('button', { name: '配一台新的' }).click()
    await expect(qr(page)).toBeVisible()
    const link2 = parsePairLink((await qr(page).getAttribute('data-link'))!)
    expect(link2.code).not.toBe(link.code)

    // 取消配对：这台设备再问就被拒
    await group(page).locator('[data-row^="mobileAiDev-"]').getByRole('button', { name: '取消配对' }).click()
    await expect(group(page).locator('[data-row^="mobileAiDev-"]')).toHaveCount(0)
    await expect(ask(pad, { kind: 'chat', text: '还在吗' })).rejects.toMatchObject({ status: 401 })

    // 关掉开关：服务停了，连都连不上
    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await expect(qr(page)).toHaveCount(0)
    await expect(fetch(`${base}/v1/hello`, { signal: AbortSignal.timeout(3000) })).rejects.toThrow()
  } finally {
    await run.close()
  }
})

/** 用系统的 dns-sd 浏览 ms 毫秒，返回这段时间里出现过（Add）的服务名；只结束自己起的那个进程 */
function browse(ms: number): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('/usr/bin/dns-sd', ['-B', '_canvasnotes._tcp', 'local'])
    let out = ''
    p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    setTimeout(() => {
      p.kill()
      resolve(out)
    }, ms)
  })
}

test('开着时在局域网里用 Bonjour 报一声（_canvasnotes._tcp，TXT 里有 Mac 编号）；关掉、退出软件就不报了', async () => {
  const name = `CN-e2e-${process.pid}-${Date.now() % 100000}`
  const run = await launch(files, { CN_AI_FAKE: '1', CN_MAC_NAME: name, CN_MOBILE_AI_BONJOUR: '1' })
  const { page } = run
  let closed = false
  try {
    await openAiSettings(page)
    await toggle(page).click()
    await expect(qr(page)).toBeVisible()
    const link = parsePairLink((await qr(page).getAttribute('data-link'))!)
    expect(await browse(2500)).toMatch(new RegExp(`Add .*_canvasnotes\\._tcp\\..*${name}`))
    // TXT 里的 id 就是二维码里的 Mac 编号（iPad 认这个）
    const txt = await new Promise<string>((resolve) => {
      const p = spawn('/usr/bin/dns-sd', ['-L', name, '_canvasnotes._tcp', 'local'])
      let out = ''
      p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
      setTimeout(() => {
        p.kill()
        resolve(out)
      }, 2500)
    })
    expect(txt).toContain(`id=${link.id}`)
    expect(txt).toContain(`:${link.port}`)

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await page.waitForTimeout(800)
    expect(await browse(2000)).not.toMatch(new RegExp(`Add .*${name}`))

    // 再打开、然后直接退出软件：登记服务的 dns-sd 跟着退出，不留一个指着死端口的服务
    await toggle(page).click()
    await expect(qr(page)).toBeVisible()
    await run.close()
    closed = true
    await new Promise((r) => setTimeout(r, 800))
    const left = execFileSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter((l) => l.includes('dns-sd -R') && l.includes(name))
    expect(left).toEqual([])
    expect(await browse(2000)).not.toMatch(new RegExp(`Add .*${name}`))
  } finally {
    if (!closed) await run.close()
  }
})
