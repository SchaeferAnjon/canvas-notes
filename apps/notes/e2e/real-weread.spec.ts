// 真的微信读书账号验证（CN-37、CN-53），只在 CN_REAL_WEREAD=1 时跑，只读：
//   CN_REAL_WEREAD=1 npx playwright test e2e/real-weread.spec.ts
// 1. 用软件的「⋯ › 导入 Chrome 登录」把 Chrome 的登录导进这个测试实例的临时设置目录（macOS 会问一次钥匙串，要人点「允许」；
//    CN_REAL_CHROME_PROFILE 指定 Chrome 用户，不给用第一个）；
// 2. 右竖条「微信读书」打开 weread.qq.com，设置 › 插件 › 微信读书显示「已登录」；
// 3. 网页「笔记」页上这本书的划线数（网页自己问笔记本接口的 noteCount）和插件用网页版划线接口同步进阅读的条数一样；
// 4. 把这本书已有的最新一条划线走一遍「插进左边开着的文档」（插进临时库里的文档），不在账号里新划线、不删不改。
// 临时库和设置目录测完就删（launch 的 close）；cookie、昵称、头像、书的内容都不打印、不截图（截图前打码）。
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, waitSaved } from './app'
import { readerCode } from '../src/shared/plugins/weread'

test.skip(process.env.CN_REAL_WEREAD !== '1', '真账号验证：CN_REAL_WEREAD=1 才跑')

const md5 = (t: string) => createHash('md5').update(t).digest('hex')

test('真的微信读书：导入 Chrome 登录后设置显示已登录；网页版接口读到的划线数和网页一致；已有的一条划线插进左边文档', async () => {
  const run = await launch({ '读书笔记.md': '# 读书笔记\n\n' })
  const { page, vault } = run
  try {
    // ---- 导入 Chrome 登录（软件现有的功能，cookie 只进这个临时实例的 persist:web）----
    const profiles = await page.evaluate(() => window.cn.chromeProfiles())
    const want = process.env.CN_REAL_CHROME_PROFILE
    const profile = profiles.find((p) => p.id === want || p.name === want) ?? profiles[0]
    expect(profile, '这台电脑上没找到 Chrome 用户').toBeTruthy()
    const r = await page.evaluate((id) => window.cn.importChrome(id), profile!.id)
    expect(r.imported).toBeGreaterThan(0)

    // ---- 1. 右竖条「微信读书」打开，设置里显示已登录 ----
    await rail(page).getByRole('button', { name: '微信读书' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const guest = <T,>(code: string) =>
      page.evaluate((c) => {
        const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
        try {
          return w ? w.executeJavaScript(c).catch(() => null) : null
        } catch {
          return null
        }
      }, code) as Promise<T>
    await expect.poll(() => guest<string>('location.host'), { timeout: 30_000 }).toBe('weread.qq.com')
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const acct = page.getByRole('region', { name: '微信读书' }).getByRole('group', { name: '微信读书登录' })
    await expect(acct).toContainText('已登录', { timeout: 15_000 })
    await expect(acct).toContainText('用的是右栏网页里登录的微信读书')
    if (process.env.CN_SHOTS)
      await acct.screenshot({ path: join(process.env.CN_SHOTS, 'real-weread-settings.png'), mask: [acct.locator('.wr-av'), acct.locator('b')] })
    await page.keyboard.press('Meta+,')

    // ---- 2. 书架上一本有划线的书：网页自己问到的条数 = 插件同步进阅读的条数 ----
    // 网页「笔记」页上每本书的划线数：网页自己问笔记本接口（/api/user/notebook）拿到的 noteCount（真账号上 bookmarkCount 是另一种计数）
    const book = await guest<{ bookId: string; shown: number } | null>(`(async () => {
      const nb = await (await fetch('/api/user/notebook', { credentials: 'include' })).json()
      const b = (nb.books || []).find((x) => x.noteCount > 0)
      return b ? { bookId: String(b.bookId || b.book.bookId), shown: Number(b.noteCount) } : null
    })()`)
    expect(book, '书架上没有带划线的书').toBeTruthy()
    const st = await page.evaluate(() => window.cnPlugins.call<{ state: string }>('weread', 'syncAll'))
    expect(st.state).toBe('ok')
    const dir = join(vault, '阅读')
    const file = readdirSync(dir).find((f) => readFileSync(join(dir, f), 'utf8').includes(`bookId: ${book!.bookId}\n`))
    expect(file, '这本书没同步进阅读').toBeTruthy()
    const synced = Number(/^划线: (\d+)$/m.exec(readFileSync(join(dir, file!), 'utf8'))?.[1])
    // 只打数字，不打书名、划线内容
    console.log('[real-weread] 网页笔记页上这本书的划线数', book!.shown, '· 插件用网页版接口同步进阅读的', synced)
    expect(synced).toBe(book!.shown)

    // ---- 3. 已有的一条划线走一遍「插进左边开着的文档」----
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    // 阅读页的地址是书的编号编出来的（shared/plugins/weread.ts 的 readerCode），直接打开这本书的阅读页；
    // 插件按地址认书（真网站上阅读页 __INITIAL_STATE__ 里的编号会是别的书，所以不拿它比）
    const addr = web.getByRole('textbox', { name: '网址' })
    const reader = `https://weread.qq.com/web/reader/${readerCode(book!.bookId, md5)}`
    await addr.fill(reader)
    await addr.press('Enter')
    await expect.poll(() => guest<string>('document.readyState + location.pathname'), { timeout: 30_000 }).toBe(`complete${new URL(reader).pathname}`)
    const target = book!.bookId
    // 打开书那一次检查做完（见过的都记下）后，忘掉最新的一条，再让网页里松开一次鼠标：插件当它是刚划的
    await page.waitForTimeout(4000)
    const mark = await page.evaluate((id) => window.cnPlugins.call<{ text: string } | null>('weread', 'forgetNewest', { bookId: id }), target)
    expect(mark, '这本书的阅读页没被认出来（没记下见过的划线）').toBeTruthy()
    await guest(`document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`)
    await expect(page.locator('#wr-toast')).toHaveText('已加到《读书笔记》', { timeout: 15_000 })
    await waitSaved(page)
    const md = await editorText(page)
    // 只比对，不把书的内容打进日志
    expect(md.includes(`> ${mark!.text.split(/\n+/)[0]!.trim().slice(0, 12)}`)).toBe(true)
    expect(md.includes('—— [《')).toBe(true)
  } finally {
    await run.close()
  }
})
