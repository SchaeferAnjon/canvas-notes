// 课程主页「课件进度」（CN-21 方向 A、CN-2）：每份 PDF 一张第一页封面（缓存在软件设置目录、不进库）；
// 从访达拖 PDF 到卡上就拷进这门课，标「新」，能撤回；不是 PDF 的不收。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitStatus, launch, leftView } from './app'
import { lecturePdf } from './fixtures/pdf'
import { shotTone, shotWindow } from './shots'

const slidePdf = (title: string) => lecturePdf([{ title, lines: ['Approximate computing trades accuracy for energy.'], image: { x: 320, y: 300, w: 220, h: 160 } }, { title: `${title} (2)`, lines: ['More.'] }])
const VAULT = { '课程/ecp/Lecture04.pdf': slidePdf('Analog Computing'), '课程/ecp/Lecture03.pdf': slidePdf('Approximate Computing') }

const home = (page: Page) => page.getByTestId('folder-home')
const slides = (page: Page) => home(page).getByTestId('fw-slides')
const toast = (page: Page) => page.locator('.toast-cn')

/** 从访达拖文件进来：文件经由文件选择框变成真的本机文件（webUtils 拿得到路径），再照拖放的事件顺序发到页面上 */
async function dropFiles(page: Page, paths: string[], opts: { drop: boolean } = { drop: true }) {
  await page.evaluate(() => {
    let i = document.getElementById('e2e-files') as HTMLInputElement | null
    if (!i) {
      i = document.createElement('input')
      i.type = 'file'
      i.multiple = true
      i.id = 'e2e-files'
      i.style.display = 'none'
      document.body.append(i)
    }
  })
  await page.setInputFiles('#e2e-files', paths)
  await page.evaluate((drop) => {
    const files = (document.getElementById('e2e-files') as HTMLInputElement).files!
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(f)
    const target = document.querySelector('[data-testid="folder-home"] .fh-title') ?? document.querySelector('[data-testid="folder-home"]')!
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    if (drop) target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, opts.drop)
}

test('CN-21：课件进度一排封面（第一页），缓存在软件设置目录、不进库；CN-2：拖 PDF 到课程主页就拷进这门课、标「新」、能撤回，不是 PDF 的不收', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'cn-finder-'))
  writeFileSync(join(outside, 'Lecture06.pdf'), slidePdf('Neuromorphic Computing'))
  writeFileSync(join(outside, '作业.txt'), '不是 PDF')
  const run = await launch(VAULT)
  const { page, vault, userData } = run
  try {
    await leftView(page, '课程')
    await page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^ecp$/ }) }).click()
    await expect(home(page)).toBeVisible()
    // 封面：两份都画出第一页（按 Lecture 几排），图真的出来了
    const covers = slides(page).getByTestId('slide-cover')
    await expect(covers.locator('.nm .truncate')).toHaveText(['Lecture03', 'Lecture04'])
    for (const i of [0, 1]) {
      const img = covers.nth(i).locator('img')
      await expect(img).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(300)
    }
    await expect(slides(page).locator('.fw-dropcell')).toHaveText('拖PDF')
    await expect(slides(page).locator('.fw-dropcell')).toHaveAttribute('data-tip', '把PDF拖到这张卡上，就收进ecp')
    // 封面缓存在软件设置目录，库里干干净净
    expect(readdirSync(join(userData, 'thumbs')).filter((n) => n.endsWith('.png'))).toHaveLength(2)
    expect(gitStatus(vault)).toBe('')

    // 拖着 PDF 经过：卡外圈亮、盖一层「松手收进 ecp」
    await dropFiles(page, [join(outside, 'Lecture06.pdf')], { drop: false })
    await expect(slides(page)).toHaveClass(/drop-hot/)
    await expect(slides(page).getByTestId('slides-drop')).toContainText('松手收进ecp')
    await expect(slides(page).getByTestId('slides-drop')).toContainText('拷一份进这门课的文件夹，访达里的原文件不动')
    // 松手：拷进课程文件夹，卡上多一份、标「新」，原文件还在
    await dropFiles(page, [join(outside, 'Lecture06.pdf')])
    await expect(slides(page).getByTestId('slides-drop')).toHaveCount(0)
    await expect(toast(page)).toContainText('拷进了ecp：Lecture06.pdf')
    await expect(covers.locator('.nm .truncate')).toHaveText(['Lecture03', 'Lecture04', 'Lecture06'])
    await expect(covers.nth(2).locator('.tag-new')).toHaveText('新')
    await expect(covers.nth(2).locator('img')).toBeVisible({ timeout: 15_000 })
    expect(existsSync(join(vault, '课程/ecp/Lecture06.pdf'))).toBe(true)
    expect(existsSync(join(outside, 'Lecture06.pdf'))).toBe(true)
    // 同一份再拖一次（第 2 轮）：不再悄悄多出一份，说已经有了
    await dropFiles(page, [join(outside, 'Lecture06.pdf')])
    await expect(toast(page)).toHaveText('ecp里已经有这份了')
    expect(existsSync(join(vault, '课程/ecp/Lecture06 2.pdf'))).toBe(false)
    await expect(covers).toHaveCount(3)
    // 同名、内容不一样的另一份：照访达加「 2」
    mkdirSync(join(outside, '另一份'))
    writeFileSync(join(outside, '另一份/Lecture06.pdf'), slidePdf('Neuromorphic Computing v2'))
    await dropFiles(page, [join(outside, '另一份/Lecture06.pdf')])
    await expect(toast(page)).toContainText('拷进了ecp：Lecture06 2.pdf')
    expect(existsSync(join(vault, '课程/ecp/Lecture06 2.pdf'))).toBe(true)
    // 撤回：刚拷的那份拿掉
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '课程/ecp/Lecture06 2.pdf'))).toBe(false)
    await expect(covers).toHaveCount(3)
    // 不是 PDF 的不收
    await dropFiles(page, [join(outside, '作业.txt')])
    await expect(toast(page)).toContainText('课件进度只收PDF')
    expect(existsSync(join(vault, '课程/ecp/作业.txt'))).toBe(false)
  } finally {
    await run.close()
    rmSync(outside, { recursive: true, force: true })
  }
})

test('一次拖两份 PDF 进课件进度：两份都在卡上标「新」，不被名字排在前面的挤掉；再拖一份名字不按 Lecture 排的，刚拖的几份还在', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'cn-finder-'))
  writeFileSync(join(outside, 'Lecture06.pdf'), slidePdf('Neuromorphic Computing'))
  writeFileSync(join(outside, 'Lecture07.pdf'), slidePdf('Quantum Computing'))
  writeFileSync(join(outside, '补充材料.pdf'), slidePdf('Extra'))
  const run = await launch(VAULT)
  const { page } = run
  try {
    await shotTone(page)
    await leftView(page, '课程')
    await page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^ecp$/ }) }).click()
    await expect(home(page)).toBeVisible()
    const covers = slides(page).getByTestId('slide-cover')
    await expect(covers).toHaveCount(2)
    await dropFiles(page, [join(outside, 'Lecture06.pdf'), join(outside, 'Lecture07.pdf')])
    await expect(toast(page)).toContainText('拷进了ecp：Lecture06.pdf、Lecture07.pdf')
    // 放 3 格：两份新的都在（标「新」），按第几讲排
    await expect(covers.locator('.nm .truncate')).toHaveText(['Lecture03', 'Lecture06', 'Lecture07'])
    await expect(covers.locator('.tag-new')).toHaveCount(2)
    await expect(slides(page).locator('.fw-more')).toHaveText('全部4份 · 打开列表看')
    await dropFiles(page, [join(outside, '补充材料.pdf')])
    await expect(toast(page)).toContainText('拷进了ecp：补充材料.pdf')
    await expect(covers.locator('.nm .truncate')).toHaveText(['补充材料', 'Lecture06', 'Lecture07'])
    await expect(covers.locator('.tag-new')).toHaveCount(3)
    await shotWindow(run, 'r1-slides-dropped')
    // 抬头「5讲」和「课程」首页「在上的课」那一行「0/5讲」对得上（补充材料认不出第几讲，也算一讲）
    await expect(home(page).getByTestId('folder-lead')).toContainText('课程 / ecp · 5讲')
    await page.locator('.tab', { hasText: /^课程/ }).locator('.tl').click()
    await expect(page.getByTestId('fw-courses').locator('.fw-row', { hasText: 'ecp' })).toContainText('0/5讲')
  } finally {
    await run.close()
    rmSync(outside, { recursive: true, force: true })
  }
})
