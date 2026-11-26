// 2026-11-25 收件箱「在项目里面新建文件夹时，PDF 没有办法直接拖到新建的文件夹里面，就是没有这个课程进度的组件」：
// - 课程首页的「课件进度」卡照旧收访达拖来的 PDF；
// - 课程挪进「项目」以后卡还在、写着「拖PDF」：以前拖上去没反应（只认 课程/<课>），现在拷得进去；
// - 项目里新建的文件夹首页没有课件进度卡：整页收访达拖来的 PDF（拷一份进去），也收文件树里拖来的 PDF（连挂着的笔记挪进去）；
// - 文件树里 PDF 那一行能拖了（以前只有 md 那一行能拖），松在新建的文件夹上就挪进去；访达拖来的 PDF 松在文件树的文件夹上也拷进去。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, leftView } from './app'
import { lecturePdf } from './fixtures/pdf'
import { shotWindow } from './shots'

const pdf = (title: string) => lecturePdf([{ title, lines: ['Wearable affect recognition with physiological signals.'], image: { x: 320, y: 300, w: 220, h: 160 } }, { title: `${title} (2)`, lines: ['More.'] }])
/** 用户那台的样子：study project 2 原来是一门课（首页带课件进度），挪进了「项目」 */
const COURSE_HOME = JSON.stringify({ style: 'a', cover: { kind: 'builtin', id: 'myvatn' }, coverY: 40, icon: 'sigma', color: null, order: ['slides', 'notes', 'todo'], hidden: [], sizes: {}, widgets: { slides: { type: 'slides' }, notes: { type: 'notes', cond: { name: '笔记和导图', scope: 'folder', all: true, rules: [{ prop: '类型', op: '是其中', value: '笔记, 导图' }], sort: { prop: '第几讲', dir: 'desc' }, view: 'list', limit: 4 } }, todo: { type: 'todo' } } }, null, 2) + '\n'
const VAULT = {
  '课程/ecp/Lecture05.pdf': pdf('Lecture 5'),
  '项目/study project 2/.首页.json': COURSE_HOME,
  '项目/study project 2/论文/Emo-01.pdf': pdf('Emo 01'),
  '收件箱/WESAD.pdf': pdf('WESAD'),
  '收件箱/WESAD 笔记.md': '---\n进度: 2/2\n---\n# WESAD 笔记\n\n读到第二页。\n',
  '收件箱/K-EmoCon.pdf': pdf('K-EmoCon'),
}

const home = (page: Page) => page.getByTestId('folder-home')
const toast = (page: Page) => page.getByTestId('toast')
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const treeRow = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
async function expand(page: Page, path: string) {
  await leftView(page, '文件')
  for (const p of path.split('/')) if ((await treeRow(page, p).getAttribute('aria-expanded')) !== 'true') await treeRow(page, p).locator('.ft-tw').click()
}

/**
 * 从访达拖文件进来：文件经由文件选择框变成真的本机文件（webUtils 拿得到路径），再照拖放的事件顺序发到 selector 那一处
 * （同 step22-slides）；drop: false 只经过不松手
 */
async function dropFiles(page: Page, paths: string[], selector: string, drop = true) {
  await page.evaluate(() => {
    if (document.getElementById('e2e-files')) return
    const i = document.createElement('input')
    i.type = 'file'
    i.multiple = true
    i.id = 'e2e-files'
    i.style.display = 'none'
    document.body.append(i)
  })
  await page.setInputFiles('#e2e-files', paths)
  await page.evaluate(
    ({ selector, drop }) => {
      const files = (document.getElementById('e2e-files') as HTMLInputElement).files!
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(f)
      const target = document.querySelector(selector)!
      target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      if (drop) target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { selector, drop },
  )
}

test('PDF 拖进文件夹首页：课程的课件进度卡、挪进项目的那门课、项目里新建的文件夹（访达拖、文件树拖都行），文件树里 PDF 那一行能拖进新文件夹', async () => {
  test.setTimeout(120_000)
  const outside = mkdtempSync(join(tmpdir(), 'cn-finder-'))
  writeFileSync(join(outside, 'Lecture06.pdf'), pdf('Lecture 6'))
  writeFileSync(join(outside, 'SAGE.pdf'), pdf('SAGE'))
  writeFileSync(join(outside, 'ASCERTAIN.pdf'), pdf('ASCERTAIN'))
  writeFileSync(join(outside, '作业.txt'), '不是 PDF')
  // 截交付图时换外观：CN_SHOT_LOOK='{"frame":"b","glassLevel":100}' 写进设置的 appearance
  const look = process.env.CN_SHOT_LOOK
  const run = await launch(VAULT, {}, look ? (v) => {
    const ud = join(dirname(v), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...JSON.parse(look) } }))
  } : undefined)
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // 1) 课程首页：拖到「课件进度」卡上照旧拷进这门课
    await expand(page, '课程')
    await treeRow(page, 'ecp').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ecp')
    await expect(home(page).getByTestId('fw-slides').getByTestId('slide-cover')).toHaveCount(1)
    await dropFiles(page, [join(outside, 'Lecture06.pdf')], '[data-testid="fw-slides"]')
    await expect(toast(page)).toContainText('拷进了ecp：Lecture06.pdf')
    expect(existsSync(join(vault, '课程/ecp/Lecture06.pdf'))).toBe(true)

    // 2) 挪进「项目」的那门课：卡上照旧写「拖PDF」，拖上去要拷得进去（以前什么都不发生）
    await expand(page, '项目')
    await treeRow(page, 'study project 2').click()
    await expect(home(page)).toHaveAttribute('data-folder', '项目/study project 2')
    const slides = home(page).getByTestId('fw-slides')
    await expect(slides.getByTestId('slides-dropcell')).toHaveText('拖PDF')
    await dropFiles(page, [join(outside, 'SAGE.pdf')], '[data-testid="fw-slides"]', false)
    await expect(slides).toHaveClass(/drop-hot/)
    await shotWindow(run, 'inbox-cpu-slides-drop-over')
    await dropFiles(page, [join(outside, 'SAGE.pdf')], '[data-testid="fw-slides"]')
    await expect(toast(page)).toContainText('拷进了study project 2：SAGE.pdf')
    expect(existsSync(join(vault, '项目/study project 2/SAGE.pdf'))).toBe(true)
    await expect(slides.getByTestId('slide-cover').filter({ hasText: 'SAGE' }).locator('.tag-new')).toHaveText('新')

    // 3) 在这个项目里新建一个文件夹（文件树头上「新建文件夹」，选着 study project 2）
    await tree(page).locator('xpath=ancestor::aside').getByRole('button', { name: '新建文件夹' }).click()
    const name = page.getByRole('textbox', { name: '新文件夹的名字' })
    await name.fill('数据集')
    await name.press('Enter')
    await expect(toast(page)).toContainText('建好了「项目/study project 2/数据集」')
    await expect(treeRow(page, '数据集')).toHaveCount(1)
    await treeRow(page, '数据集').click()
    await expect(home(page)).toHaveAttribute('data-folder', '项目/study project 2/数据集')
    // 新文件夹首页没有课件进度卡（默认组件不归这里管）
    await expect(home(page).getByTestId('fw-slides')).toHaveCount(0)

    // 4) 访达拖 PDF 到新文件夹首页：整页亮一层「松手收进数据集」，松手拷进去，原文件不动；不是 PDF 的不收；能撤回
    await dropFiles(page, [join(outside, 'ASCERTAIN.pdf')], '[data-testid="folder-home"] .fh-title', false)
    await expect(home(page).getByTestId('home-drop')).toContainText('松手收进数据集')
    await expect(home(page).getByTestId('home-drop')).toContainText('拷一份进这个文件夹，访达里的原文件不动')
    await shotWindow(run, 'inbox-cpu-home-drop-over')
    await dropFiles(page, [join(outside, 'ASCERTAIN.pdf'), join(outside, '作业.txt')], '[data-testid="folder-home"] .fh-title')
    await expect(home(page).getByTestId('home-drop')).toHaveCount(0)
    await expect(toast(page)).toContainText('拷进了数据集：ASCERTAIN.pdf · 1个不是PDF，没收')
    expect(readFileSync(join(vault, '项目/study project 2/数据集/ASCERTAIN.pdf'))).toEqual(readFileSync(join(outside, 'ASCERTAIN.pdf')))
    expect(existsSync(join(outside, 'ASCERTAIN.pdf'))).toBe(true)
    expect(existsSync(join(vault, '项目/study project 2/数据集/作业.txt'))).toBe(false)
    await expect(home(page)).toContainText('ASCERTAIN')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '项目/study project 2/数据集/ASCERTAIN.pdf'))).toBe(false)
    await dropFiles(page, [join(outside, 'ASCERTAIN.pdf')], '[data-testid="folder-home"] .fh-title')
    await expect.poll(() => existsSync(join(vault, '项目/study project 2/数据集/ASCERTAIN.pdf'))).toBe(true)

    // 5) 文件树里真拖：收件箱的 PDF 那一行能拖，松在「数据集」那一行上，PDF 和挂着的笔记一起挪进去
    await expand(page, '收件箱')
    const wesad = treeRow(page, 'WESAD')
    await expect(wesad).toHaveAttribute('draggable', 'true')
    await wesad.dragTo(treeRow(page, '数据集'))
    await expect.poll(() => existsSync(join(vault, '项目/study project 2/数据集/WESAD.pdf'))).toBe(true)
    expect(existsSync(join(vault, '项目/study project 2/数据集/WESAD 笔记.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/WESAD.pdf'))).toBe(false)
    await expect(toast(page)).toContainText('「WESAD.pdf」和它的笔记挪到了「项目/study project 2/数据集」')

    // 6) 文件树里的 PDF 直接拖到开着的新文件夹首页上：也挪进去
    await expect(home(page)).toHaveAttribute('data-folder', '项目/study project 2/数据集')
    await treeRow(page, 'K-EmoCon').dragTo(home(page).locator('.fh-title'))
    await expect.poll(() => existsSync(join(vault, '项目/study project 2/数据集/K-EmoCon.pdf'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/K-EmoCon.pdf'))).toBe(false)
    await expect(home(page)).toContainText('K-EmoCon')
    // 挪完那句说完再拖下一个（挪文件那一步说话晚，会盖掉下一句）
    await expect(toast(page)).toContainText('「K-EmoCon.pdf」挪到了「项目/study project 2/数据集」')

    // 7) 访达拖 PDF 松在文件树的文件夹那一行上：拷进那个文件夹
    await expand(page, '项目/study project 2')
    await dropFiles(page, [join(outside, 'Lecture06.pdf')], '[role="tree"] [data-path="项目/study project 2/论文"]', false)
    await expect(treeRow(page, '论文')).toHaveClass(/\bdrop\b/)
    await dropFiles(page, [join(outside, 'Lecture06.pdf')], '[role="tree"] [data-path="项目/study project 2/论文"]')
    await expect(toast(page)).toContainText('拷进了论文：Lecture06.pdf')
    expect(existsSync(join(vault, '项目/study project 2/论文/Lecture06.pdf'))).toBe(true)
    expect(existsSync(join(outside, 'Lecture06.pdf'))).toBe(true)
    await shotWindow(run, 'inbox-cpu-home-dropped')
  } finally {
    await run.close()
    rmSync(outside, { recursive: true, force: true })
  }
})
