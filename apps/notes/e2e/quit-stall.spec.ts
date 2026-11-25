import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { launch, rail, type Running } from './app'

// 偶尔关不掉（退出卡顿）：主进程的 JS 都走完了（quit.log 到「主进程 exit」），Chromium 收尾时在 TaskTracker::CompleteShutdown 里等
// 线程池里已经开始的后台写盘：反弹跟踪数据库（BTM，设置目录里的 DIPS，SQLite）开、写 WAL、fsync、关都排在后台优先级的线程上，
// macOS 给后台优先级的读写限流，盘忙时一下要几秒到一分钟（sample 配 Electron 45.3.2 的符号看到的，packages/quit-fast）。
// 修法：这个库不开；别的后台活也卡住时，主进程的 JS 走完 2 秒还没退就结束它。
// 强杀后下次退出卡 60 秒：不读、不存窗口状态（最后一条）。

/**
 * 本机一个会「反弹」的网站：127.0.0.1/bounce 记一个 cookie、马上跳到 localhost/landed（两个不同的站）。
 * 中途碰了存储又没等用户操作就跳走，Chromium 的反弹跟踪（BTM）要把这一笔记进它的数据库
 */
let server: Server
let port = 0
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/bounce') {
      res.writeHead(302, { 'set-cookie': 'seen=1; Max-Age=3600', location: `http://localhost:${port}/landed` })
      return res.end()
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><title>到了</title><p>跳过来了</p>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

/** 从叫 app.quit（和 ⌘Q 一样）到进程真的没了，量毫秒 */
async function timedQuit(run: Running): Promise<number> {
  const proc = run.app.process()
  const t = Date.now()
  await run.close({ keep: true })
  expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
  return Date.now() - t
}

test('开着内置浏览器的网页退出：Chromium 的反弹跟踪数据库（DIPS）软件和网页的会话里都不建，收尾时没有它的后台写盘要等', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, userData } = run
  try {
    // Chromium 的功能名还叫 DIPS；什么时候建它的库不一定（开起来一会儿、走一趟反弹、退出那一下都见过），这里先看开关
    expect((await run.app.evaluate(({ app }) => app.commandLine.getSwitchValue('disable-features'))).split(',')).toContain('DIPS')
    const web = page.getByRole('complementary', { name: '网页' })
    if (!(await web.isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web.getByRole('textbox', { name: '网址' })
    // 在网页里点一下（用户操作过这个站），再走一趟反弹
    await addr.click()
    await addr.fill(`http://localhost:${port}/landed`)
    await addr.press('Enter')
    const url = () => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getURL(): string } | null)?.getURL() ?? '')
    await expect.poll(url).toBe(`http://localhost:${port}/landed`)
    const box = (await page.locator('.right.web webview.on').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + 40)
    await addr.click()
    await addr.fill(`http://127.0.0.1:${port}/bounce`)
    await addr.press('Enter')
    await page.waitForTimeout(3_000)
    const ms = await timedQuit(run)
    const shLog = existsSync(join(userData, 'quit-sh.log')) ? readFileSync(join(userData, 'quit-sh.log'), 'utf8').trim().replace(/\n/g, ' → ') : '没记'
    console.log(`开着网页退出 ${ms} ms；quit.log：${readFileSync(join(userData, 'quit.log'), 'utf8').trim().replace(/\n/g, ' → ')}；sh：${shLog}`)
    for (const f of ['DIPS', 'DIPS-wal', 'Partitions/web/DIPS', 'Partitions/web/DIPS-wal']) expect(existsSync(join(userData, f)), f).toBe(false)
    expect(ms).toBeLessThan(5_000)
  } finally {
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('主进程的 JS 走完以后收尾卡住（CN_E2E_STALL_QUIT_MS 演一直写不完的后台写盘）：2 秒还没退，盯着的 sh 结束它，5 秒内退干净', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' }, { CN_E2E_STALL_QUIT_MS: '60000' })
  try {
    const ms = await timedQuit(run)
    const log = readFileSync(join(run.userData, 'quit.log'), 'utf8')
    console.log(`收尾卡住时退出 ${ms} ms；quit.log：${log.trim().replace(/\n/g, ' → ')}`)
    expect(log).toMatch(/cookie 写完[\s\S]*主进程 exit/)
    expect(ms).toBeLessThan(5_000)
    // 结束它的是那个 sh（它比 app.close() 晚一点写完，等一下）
    await expect.poll(() => readFileSync(join(run.userData, 'quit-sh.log'), 'utf8')).toMatch(/收尾卡住，结束主进程/)
  } finally {
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('测试里强杀过一次 Electron 以后再开：不去问系统的窗口状态服务（restoration_storage），下次退出不跟着它等', async () => {
  // 没打包的 Electron 在这台 Mac 上都是 com.github.Electron：强杀一个，下一个开起来就以为上次没正常退，去问系统要「崩溃数据」，
  // 盘忙时那个服务一分钟不回话，退出时 AppKit 往同一条队列上写窗口状态，跟着等 60 秒（sample 里的 NSPersistentUIRemoteStorageClient）
  const killed = await launch({ 'a.md': '# a\n' })
  const p = killed.app.process()
  p.kill('SIGKILL')
  await new Promise((r) => p.once('exit', r))
  const run = await launch({ 'b.md': '# b\n' })
  const pid = run.app.process().pid
  try {
    await run.page.waitForTimeout(500)
    await run.close({ keep: true })
    // 系统日志里这个进程开过哪些服务的连接、有没有要恢复的窗口状态（AppKit 自己记的）
    const predicate = `processID == ${pid} AND (eventMessage CONTAINS "restoration_storage" OR eventMessage CONTAINS "hasPersistentStateToRestore")`
    const said = execFileSync('/usr/bin/log', ['show', '--last', '10m', '--style', 'compact', '--predicate', predicate], { encoding: 'utf8', timeout: 60_000 })
    console.log(said)
    expect(said).not.toContain('restoration_storage')
    // 日志确实查得到这个进程：AppKit 说了没有要恢复的窗口状态
    expect(said).toContain('hasPersistentStateToRestore=0')
  } finally {
    for (const r of [killed, run]) rmSync(dirname(r.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})
