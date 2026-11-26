/**
 * ui-b A10（软件有时会频闪）：测试模式录帧（CDP screencast）找到的一处：启动时窗口在第一次画完就显示，那一帧还是 index.html 写死的薄荷、
 * 没套主题（书桌挂上、导入主题列表读回来才换），深色主题先白一下再变黑；没开库的欢迎页一直是薄荷。
 * 改成设置读回来就套主题，主题套上、画过一帧才显示窗口。这里量：主进程决定显示的那一下是哪一下、那时套的主题，和从那以后录到的每一帧都是深色。
 * 测试模式窗口不上屏，显示这一步主进程只记下来（cnShown），录帧走 CDP。
 */
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

const PINE = { followSystem: false, skin: 'pine', frame: 'b', winBg: 'wall', wallMix: 'rich', wallMove: true, wallSpeed: 'fast' }

/** 起软件（vault 为 null 是没开过库：欢迎页），从第一帧起录每帧整窗的平均亮度 */
async function start(withVault: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'cn-uib-look-'))
  const userData = join(root, 'ud')
  mkdirSync(userData)
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ appearance: PINE }))
  const env: Record<string, string> = { ...(process.env as Record<string, string>), CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash') }
  delete env.CN_VAULT
  if (withVault) {
    const vault = join(root, '测试库')
    execFileSync('git', ['init', '-q', '-b', 'main', vault])
    writeFileSync(join(vault, 'a.md'), '# a\n')
    execFileSync('git', ['-C', vault, '-c', 'user.name=T', '-c', 'user.email=t@e', 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-qm', 'x'])
    env.CN_VAULT = vault
  }
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [join(__dirname, '../out/main/index.js')], env })
  const page = await app.firstWindow()
  const frames: { t: number; data: string }[] = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    frames.push({ t: Date.now(), data: f.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 50, maxWidth: 480, maxHeight: 300 })
  return { app, page, root, frames, cdp }
}

/** 每帧的平均亮度（0 黑到 255 白，主进程的 nativeImage 解 JPEG） */
const lum = (app: ElectronApplication, frames: { t: number; data: string }[]) =>
  app.evaluate(({ nativeImage }, fs) =>
    fs.map((f) => {
      const b = nativeImage.createFromBuffer(Buffer.from(f.data, 'base64')).toBitmap()
      let sum = 0
      let n = 0
      for (let j = 0; j + 3 < b.length; j += 4 * 5) {
        sum += 0.0722 * b[j]! + 0.7152 * b[j + 1]! + 0.2126 * b[j + 2]!
        n++
      }
      return { t: f.t, mean: Math.round(sum / n) }
    }),
  frames)

for (const withVault of [true, false]) {
  test(`A10 深色主题（松林）启动：主题套上才显示窗口，显示以后没有一帧是白的${withVault ? '（书桌）' : '（没开过库的欢迎页）'}`, async () => {
    const run = await start(withVault)
    try {
      if (withVault) await expect(run.page.locator('.vault b')).toHaveText('测试库', { timeout: 30_000 })
      else await expect(run.page.getByRole('heading', { name: '打开一个文件夹当库' })).toBeVisible({ timeout: 30_000 })
      const shown = await expect
        .poll(() => run.app.evaluate(() => (globalThis as { cnShown?: { by: string; at: number; skin?: string } }).cnShown ?? null), { timeout: 10_000 })
        .toMatchObject({ by: '主题套上了', skin: 'pine' })
        .then(() => run.app.evaluate(() => (globalThis as { cnShown?: { at: number } }).cnShown!.at))
      await run.page.waitForTimeout(1500)
      await run.cdp.send('Page.stopScreencast')
      const all = await lum(run.app, run.frames)
      // 显示以后（留 100 毫秒给录帧送过来的路上）每一帧都是深色；显示之前那几帧（没套主题的白）用户看不到
      const after = all.filter((f) => f.t > shown + 100)
      expect(after.length).toBeGreaterThan(0)
      expect(after.filter((f) => f.mean > 120), `显示以后的帧：${JSON.stringify(after.map((f) => f.mean))}`).toEqual([])
      expect(await run.page.evaluate(() => document.documentElement.dataset.skin)).toBe('pine')
    } finally {
      await run.app.close()
      rmSync(run.root, { recursive: true, force: true, maxRetries: 5 })
    }
  })
}
