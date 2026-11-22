import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, shownText } from './app'

// 从 Obsidian 导入先修三处 + %%注释%%（task-4xtbp）：照规格造一个小的 Obsidian 库（![[图|300]]、同名的 [[子文件夹/笔记]]、
// 行尾 ^块编号、%%注释%%），⌘K「导入旧笔记」真点一遍；看导进来的文件、源库一个字节不动、一次提交、撤回回到导入前；
// 打开那一篇：图是 300 宽、块编号藏着（光标在哪都不露）、注释是收起的提示块，打开再保存文件不变。

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const sheet = (page: Page) => page.getByRole('dialog', { name: '导入旧笔记' })

const MAIN =
  '---\ntags:\n  - 线代\n---\n# 线性映射\n\n定义：线性映射保持加法和数乘。 ^def1\n\n![[极光.jpg|300]]\n\n%%这句是 Obsidian 的注释，读的时候看不见%%\n\n' +
  '正文里夹一句 %%行内注释%% 接着写。\n\n同一个文件夹的 [[第一讲]]、概率那边的 [[课程/概率/第一讲|概率第一讲]]、[[第二讲]]、[[小结]]。\n'

/** 照规格 1.4、1.7 的小 Obsidian 库；返回库的路径 */
function obsidianVault(): string {
  const d = join(mkdtempSync(join(tmpdir(), 'cn-e2e-obs-')), '我的Obsidian库')
  const put = (p: string, s: string | Buffer) => {
    mkdirSync(dirname(join(d, p)), { recursive: true })
    writeFileSync(join(d, p), s)
  }
  put('.obsidian/app.json', '{"attachmentFolderPath":"附件"}')
  put('附件/极光.jpg', readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')))
  put('课程/线代/线性映射.md', MAIN)
  put('课程/线代/第一讲.md', '# 第一讲\n\n线代的第一讲，见 [[线性映射#^def1]]。\n')
  put('课程/线代/第二讲.md', '# 第二讲\n')
  put('课程/线代/小结.md', '# 小结\n')
  put('课程/概率/第一讲.md', '# 概率的第一讲\n')
  return d
}

/** 一个文件夹里每个文件的内容摘要（看源库动没动） */
function digest(dir: string): string {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const n of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${n}` : n
      const st = statSync(join(dir, r))
      if (st.isDirectory()) walk(r)
      else out.push(`${r} ${st.mtimeMs} ${createHash('sha1').update(readFileSync(join(dir, r))).digest('hex')}`)
    }
  }
  walk('')
  return out.join('\n')
}

const theme = (skin: string) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin } }))
}

for (const [tone, skin] of [
  ['light', 'sky'],
  ['dark', 'petrol'],
] as const) {
  test(`Obsidian 库：⌘K 导入旧笔记，图宽、同名双链、^块编号、%%注释%% 都对；源库不动，一次提交，撤回回到导入前（${tone === 'light' ? '浅色天青' : '深色深湖'}）`, async () => {
    const src = obsidianVault()
    const srcBefore = digest(src)
    // 库里本来就有一篇「第二讲」：导进来的「第二讲」同名，链接要写路径
    const run = await launch({ '课程/线性代数/第二讲.md': '# 第二讲\n\n库里原来的。\n' }, { CN_IMPORT_DIR: src }, theme(skin))
    const { page, vault } = run
    try {
      const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
      await page.getByRole('option', { name: /导入旧笔记…/ }).click()
      await sheet(page).getByRole('button', { name: /^Markdown文件夹/ }).click()
      await expect(sheet(page).getByTestId('import-summary')).toContainText('5篇')
      await sheet(page).getByRole('button', { name: '导入5篇' }).click()
      const result = sheet(page).getByTestId('import-result')
      await expect(result).toContainText('从「我的Obsidian库」导入了5篇', { timeout: 15_000 })
      // 行内的 %%注释%% 照原文留着：结果页「没导全的」里列出来
      await expect.soft(sheet(page).getByRole('list', { name: '没导全的' })).toContainText('一行里夹着的%%注释%%照原文留着 · 1 处')
      await shot(page, `obs-1-result-${tone}`)

      // 文件：一次提交；宽留着；同名的写路径、不重的写名字；整段注释变成收起的提示块、行内的原样；^块编号原样
      expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
      expect(git(vault, 'log', '-1', '--format=%s')).toBe('导入旧笔记：从「我的Obsidian库」导入 5 篇\n')
      expect(gitStatus(vault)).toBe('')
      const at = '收件箱/导入/我的Obsidian库/课程'
      const main = readFileSync(join(vault, at, '线代/线性映射.md'), 'utf8')
      expect.soft(main.replace(/^---\n[\s\S]*?\n---\n/, '')).toBe(
        '# 线性映射\n\n定义：线性映射保持加法和数乘。 ^def1\n\n![|300](../../../../../附件/导入/我的Obsidian库/附件/极光.jpg)\n\n' +
          '> [!note]- 注释\n> 这句是 Obsidian 的注释，读的时候看不见\n\n正文里夹一句 %%行内注释%% 接着写。\n\n' +
          `同一个文件夹的 [[${at}/线代/第一讲]]、概率那边的 [[${at}/概率/第一讲|概率第一讲]]、[[${at}/线代/第二讲]]、[[小结]]。\n`,
      )
      expect(readFileSync(join(vault, at, '线代/第一讲.md'), 'utf8')).toContain('线代的第一讲，见 [[线性映射#^def1]]。\n')
      // 源库：一个字节、一个修改时间都没变
      expect(digest(src)).toBe(srcBefore)

      // 撤回这次导入：库回到导入前（一次反向提交）；再导一次，接着看打开的样子
      await sheet(page).getByRole('button', { name: '撤回这次导入' }).click()
      await expect(page.getByTestId('toast')).toContainText('撤回了这次导入')
      expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 2)
      expect(existsSync(join(vault, '收件箱/导入'))).toBe(false)
      expect(existsSync(join(vault, '附件/导入'))).toBe(false)
      expect(gitStatus(vault)).toBe('')
      expect(readFileSync(join(vault, '课程/线性代数/第二讲.md'), 'utf8')).toBe('# 第二讲\n\n库里原来的。\n')
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
      await page.getByRole('option', { name: /导入旧笔记…/ }).click()
      await sheet(page).getByRole('button', { name: /^Markdown文件夹/ }).click()
      await sheet(page).getByRole('button', { name: '导入5篇' }).click()
      await expect(sheet(page).getByTestId('import-result')).toContainText('从「我的Obsidian库」导入了5篇', { timeout: 15_000 })
      expect(readFileSync(join(vault, at, '线代/线性映射.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')).toBe(main.replace(/^---\n[\s\S]*?\n---\n/, ''))
      expect(digest(src)).toBe(srcBefore)

      // 打开那一篇（上面和下面看样子的几条用 soft：改之前也走到底、截到「改前」的图）
      await sheet(page).getByRole('button', { name: '关闭' }).click()
      const main2 = readFileSync(join(vault, at, '线代/线性映射.md'), 'utf8')
      await openNote(page, '线性映射')
      // 打开时光标在正文第一行（块编号那一行，露着）：先点到最后一段，块编号藏起来
      await pane(page).locator('.cm-content').getByText('同一个文件夹的').click()
      const content = pane(page).locator('.cm-content')
      await expect(content).toContainText('定义：线性映射保持加法和数乘。')
      // 块编号藏着；注释是收起的提示块（只露「注释」标题）；%% 写法不露
      await expect.soft.poll(() => shownText(page)).not.toContain('^def1')
      expect.soft(await shownText(page)).not.toContain('这句是 Obsidian 的注释')
      await expect.soft(content.locator('.cm-callout-head', { hasText: '注释' })).toBeVisible({ timeout: 3000 })
      await expect.soft(content.locator('.cm-callout-folded')).toHaveCount(1, { timeout: 3000 })
      // 图按 300 宽画
      const img = content.locator('img[src*="jpg"]').first()
      await expect.soft.poll(() => img.evaluate((e) => (e as HTMLImageElement).complete && Math.round(e.getBoundingClientRect().width)), { timeout: 5000 }).toBe(300)
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      await shot(page, `obs-2-note-${tone}`)

      // 点那一行：块编号照样藏着（DESIGN.v3 6.5 方向 A，光标在哪都不露）；End 停在它前面，打的字在它前面；⌘Z 回到原样
      await content.getByText('定义：线性映射保持加法和数乘。').click()
      await expect.soft.poll(() => shownText(page)).not.toContain('^def1')
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      await shot(page, `obs-3-cursor-${tone}`)
      await page.keyboard.press('End')
      await page.keyboard.type('（线性）')
      await expect.poll(() => editorText(page)).toContain('数乘。（线性） ^def1\n')
      await page.keyboard.press('Meta+z')
      await expect.poll(() => editorText(page)).toBe(main2)
      // 打开、点、撤销以后文件和导进来时一个字节不差
      await page.waitForTimeout(1500)
      expect(readFileSync(join(vault, at, '线代/线性映射.md'), 'utf8')).toBe(main2)

    } finally {
      await run.close()
      rmSync(dirname(src), { recursive: true, force: true })
    }
  })
}
