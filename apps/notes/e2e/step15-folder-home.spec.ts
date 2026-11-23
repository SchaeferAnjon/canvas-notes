import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type AskSection, newReadingNote, setProp, upsertSection } from '@cn/format'
import { lecturePdf } from './fixtures/pdf'
import { acts, gitStatus, launch, pane, rail, tabOn, leftView } from './app'

// 文件夹首页（task-xfrgu 第 3 段，设计稿 design-mindmap 方向 B 第 9 节）：
// 左栏「课程」那一枝点一门课开它的首页 → 课件进度、笔记和导图（头上「拍一张」）、读PDF时问过的…… → 编辑首页：拖动、换宽、收起、删除、
// 组件库加组件、按条件列出改条件 → 「⋯」设为课程模板 → ⌘K 新建一门课（用模板、标题能改）→ 恢复默认；
// 梦游预览时挪进来的导图在首页标「新」；文件夹里东西多了只露几条。

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))

const pdf = (title: string) => lecturePdf([{ title, lines: ['Linear algebra lecture notes.'] }, { title: `${title} (2)`, lines: ['More.'] }])
const note = (type: string, lecture: number, title: string) => `---\n类型: ${type}\n课程: 线性代数\n第几讲: ${lecture}\n---\n# ${title}\n\n正文。\n`

/** 读 PDF 时记的笔记（PDF 那边写的样子）：几处问答（带「我的疑惑」）和属性「进度」 */
function readingNote(pdf: string, progress: string, asks: [number, string][]): string {
  const note = pdf.replace(/\.pdf$/, ' 笔记.md')
  let t = setProp(newReadingNote(pdf, new Date(2026, 10, 10)), '进度', progress)
  asks.forEach(([page, q], i) => {
    const s: AskSection = { id: `.canvas-notes/对话/${pdf.split('/').pop()!.replace(/\.pdf$/, '')}-p${page}-${i + 1}.md`, file: pdf, page, title: q, figures: [], doubts: [q], good: '讲通了。', points: [], failed: [], rounds: 2, links: [] }
    t = upsertSection(t, s, note)
  })
  return t
}
const VIZ = '<!doctype html><html><head>\n<meta name="类型" content="可视化">\n<meta name="课程" content="线性代数">\n<meta name="第几讲" content="3">\n<title>旋转矩阵</title></head><body><p>旋转矩阵</p></body></html>\n'

const VAULT: Record<string, string | Uint8Array> = {
  '课程/线性代数/第1讲 向量.pdf': pdf('Lecture 1'),
  '课程/线性代数/第2讲 向量空间.pdf': pdf('Lecture 2'),
  '课程/线性代数/第3讲 线性映射.pdf': pdf('Lecture 3'),
  '课程/线性代数/第1讲 向量 笔记.md': readingNote('课程/线性代数/第1讲 向量.pdf', '2/2', [[2, '向量加法为什么满足交换律？']]),
  '课程/线性代数/第2讲 向量空间 笔记.md': note('笔记', 2, '第2讲 向量空间 笔记'),
  '课程/线性代数/第2讲 导图.md': note('导图', 2, '第2讲 导图'),
  '课程/线性代数/第3讲 线性映射 笔记.md': readingNote('课程/线性代数/第3讲 线性映射.pdf', '7/10', [[2, '为什么线性映射一定把 0 映到 0？'], [7, '核为什么一定是子空间？']]),
  '课程/线性代数/旋转矩阵.html': VIZ,
  '课程/线性代数/第3讲 补充 笔记.md': note('笔记', 3, '第3讲 补充 笔记'),
  '课程/线性代数/第4讲 特征值 笔记.md': note('笔记', 4, '第4讲 特征值 笔记'),
  '课程/概率论/第1讲 样本空间.md': '# 第1讲 样本空间\n',
  '项目/毕业论文/大纲.md': '# 大纲\n',
  '生活/购物.md': '# 购物\n',
  '写作/一篇草稿.md': '---\ndraft: true\n---\n# 一篇草稿\n',
}

function darkSettings(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
}

/** 左栏「课程」一格（默认摘在左边）：左栏是课程那一枝目录树，每门课一行（2026-11-18） */
const courseRow = (page: Page, name: string) => page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const courseNames = (page: Page) => page.locator('aside.side').getByRole('treeitem', { level: 1 }).locator('.truncate')
/** ⌘K「新建一门课」 */
async function newCourse(page: Page) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: '搜索和命令' })
  await pal.getByRole('textbox').fill('新建一门课')
  await pal.getByRole('option').filter({ hasText: /^新建一门课/ }).first().click()
}
/** 项目、生活、写作这些从「文件」树里点开（每个文件夹点名字都开首页） */
async function openInTree(page: Page, path: string) {
  await leftView(page, '文件')
  const parts = path.split('/')
  const row = (name: string) => page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
  for (const p of parts.slice(0, -1)) if ((await row(p).getAttribute('aria-expanded')) !== 'true') await row(p).locator('.ft-tw').click()
  await row(parts[parts.length - 1]!).click()
}
const home = (page: Page) => page.getByTestId('folder-home')
const w = (page: Page, id: string) => page.getByTestId(`fw-${id}`)
const order = (page: Page) => home(page).locator('.wgrid > [data-widget]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widget))
const toast = (page: Page) => page.locator('.toast-cn')
const fToast = (page: Page) => page.locator('.toast-cn.with-act')
const homeJson = (vault: string, folder: string) => JSON.parse(readFileSync(join(vault, folder, '.首页.json'), 'utf8'))

/** 按住组件左上的把手拖到另一个组件上（真的鼠标按下、移动、松开） */
async function dragWidget(page: Page, from: Locator, to: Locator) {
  const a = (await from.locator('.wgrip').boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 })
  await expect(to).toHaveClass(/drop-before/)
  await page.mouse.up()
}

for (const tone of ['light', 'dark'] as const) {
  test(`文件夹首页：开课程首页、编辑、组件库、按条件列出、设为模板、新建一门课、恢复默认（${tone === 'light' ? '浅色' : '深色'}）`, async () => {
    const run = await launch(VAULT, {}, tone === 'dark' ? darkSettings : undefined)
    const { page, vault } = run
    try {
      // 左栏「课程」一格：左栏是课程那一枝（每门课一行），中间开「课程」这个分类的首页
      await leftView(page, '课程')
      await expect(courseNames(page)).toHaveText(['概率论', '线性代数'])
      await courseRow(page, '线性代数').click()
      await expect(page.locator('.tab.on')).toHaveText('线性代数')
      await expect(courseRow(page, '线性代数')).toHaveAttribute('aria-current', 'page')
      await expect(home(page).locator('.fh-title h2')).toHaveText('线性代数')
      // 三份 PDF 和它们旁边的笔记各算一篇（一个 PDF 一篇笔记，和左栏那一行数得一样，task-9okg5）
      await expect(home(page).locator('.fh-title p')).toHaveText(/^课程 \/ 线性代数 · 4讲 · 7篇 · 改于/)
      // 默认的课程首页
      await expect.poll(() => order(page)).toEqual(['slides', 'review', 'exam', 'notes', 'doubts', 'feynman', 'viz', 'todo', 'links', 'cal'])
      // 课件进度：每份 PDF 一张封面，按第几讲；问到第几页读笔记的「进度」，还没问过的写「没开始」；头上「接着读」问到一半的那份
      await expect(w(page, 'slides').locator('.fw-cover .nm .truncate')).toHaveText(['第1讲 向量', '第2讲 向量空间', '第3讲 线性映射'])
      await expect(w(page, 'slides').locator('.fw-cover .nm .r')).toHaveText(['读完', '没开始', '问到7 / 10页'])
      await expect(w(page, 'slides').locator('.fw-cover .pg > i').last()).toHaveAttribute('style', 'width: 70%;')
      await expect(w(page, 'slides').locator('.fw-resume')).toHaveText('接着读第3讲 线性映射 · 第7页')
      // 笔记和导图：类型是笔记或导图，按第几讲从大到小，只露 4 条加「全部 6 份」
      await expect(w(page, 'notes').locator('.wk .n')).toHaveText('6')
      await expect(w(page, 'notes').locator('.fw-row .truncate')).toHaveText(['第4讲 特征值 笔记', '第3讲 补充 笔记', '第3讲 线性映射 笔记', '第2讲 导图'])
      await expect(w(page, 'notes').locator('.fw-more')).toHaveText('全部6篇 · 打开列表看')
      // 读PDF时问过的（2026-11-22 从「我的疑惑」改名，task-tz7y3）：最近一讲的几问加每讲几问、底下出卡；可视化读 HTML 里的 meta；今天要复习还没送过卡，说在哪出卡
      await expect(w(page, 'doubts').locator('.wk .truncate')).toHaveText('读PDF时问过的')
      await expect(w(page, 'doubts').locator('.fw-sub')).toHaveText('最近问的 · 第3讲')
      await expect(w(page, 'doubts').locator('.fw-row .truncate')).toHaveText(['核为什么一定是子空间？', '为什么线性映射一定把 0 映到 0？'])
      await expect(w(page, 'doubts').locator('.fw-row .r')).toHaveText(['第7页', '第2页'])
      await expect(w(page, 'doubts').locator('.chip')).toHaveText(['第3讲 2问', '第1讲 1问'])
      await expect(w(page, 'doubts').locator('.fw-foot')).toContainText('3问 · 都还没出卡')
      await expect(w(page, 'viz').locator('.fw-thumb .tn')).toHaveText(['旋转矩阵第3讲'])
      await expect(w(page, 'review').locator('.fw-empty')).toContainText('这门课还没有卡送进Anki')
      await shot(page, `fh-course-${tone}`)

      // 点一份笔记：开那篇
      await w(page, 'notes').locator('.fw-row', { hasText: '第4讲 特征值 笔记' }).click()
      await expect(tabOn(page)).toHaveText('第4讲 特征值 笔记')
      const back = async () => {
        await page.locator('.tab', { hasText: '线性代数' }).locator('.tl').click()
        await expect(home(page)).toBeVisible()
      }
      await back()
      // 点一条疑惑：开那份 PDF；点可视化：开 HTML 标签；接着读：开 PDF
      await w(page, 'doubts').locator('.fw-row', { hasText: '核为什么一定是子空间' }).click()
      await expect(page.locator('.tab.on')).toHaveText('第3讲 线性映射.pdf')
      await back()
      await w(page, 'viz').locator('.fw-thumb').click()
      await expect(page.locator('.tab.on')).toHaveText('旋转矩阵')
      await back()

      // 「拍一张」：开拍照窗口，课程填好
      await w(page, 'notes').getByRole('button', { name: '拍一张' }).click()
      const cam = page.getByRole('dialog', { name: '拍一张导图' })
      await expect(cam).toBeVisible()
      await cam.getByRole('button', { name: '关闭' }).click()
      await expect(cam).toHaveCount(0)

      // ---------- 编辑首页 ----------
      await acts(page).getByRole('button', { name: '编辑首页' }).click()
      await expect(home(page).getByRole('toolbar', { name: '编辑首页' })).toBeVisible()
      await expect(acts(page).getByRole('button', { name: '完成' })).toHaveClass(/btn-primary/)
      await expect(w(page, 'notes').getByRole('button', { name: '拍一张' })).toHaveCount(0)
      await shot(page, `fh-edit-${tone}`)

      // 换宽：今天要复习 窄 → 宽
      await expect(w(page, 'review')).toHaveClass(/\bs1\b/)
      await w(page, 'review').getByRole('button', { name: '变宽' }).click()
      await expect(w(page, 'review')).toHaveClass(/\bs2\b/)
      // 拖动：考试倒计时拖到课件进度前面
      await dragWidget(page, w(page, 'exam'), w(page, 'slides'))
      await expect.poll(() => order(page)).toEqual(['exam', 'slides', 'review', 'notes', 'doubts', 'feynman', 'viz', 'todo', 'links', 'cal'])
      // 收起：进下面的抽屉，点一下放回最后
      await w(page, 'links').getByRole('button', { name: '收起' }).click()
      await expect(w(page, 'links')).toHaveCount(0)
      const tray = home(page).locator('.tray')
      await expect(tray.locator('.ti')).toHaveText(['嵌一块白板', '自由文本', '快捷链接'])
      await tray.locator('.ti', { hasText: '快捷链接' }).click()
      await expect(w(page, 'links')).toBeVisible()
      // 删除：只从这页拿掉，文件一个不动
      await w(page, 'todo').getByRole('button', { name: '删掉待办' }).click()
      await expect(w(page, 'todo')).toHaveCount(0)
      await expect(fToast(page).locator('span')).toHaveText('删了「待办」组件 · 文件一个没动')
      // 撤回：回到原来的位置；再删一次
      await fToast(page).getByRole('button', { name: '撤回' }).click()
      await expect(fToast(page)).toHaveCount(0)
      await expect.poll(() => order(page)).toEqual(['exam', 'slides', 'review', 'notes', 'doubts', 'feynman', 'viz', 'todo', 'cal', 'links'])
      await w(page, 'todo').getByRole('button', { name: '删掉待办' }).click()
      await expect(w(page, 'todo')).toHaveCount(0)
      await expect.poll(() => gitStatus(vault)).toBe('?? 课程/线性代数/.首页.json\n')

      // ---------- 组件库 ----------
      await home(page).getByRole('button', { name: '加组件' }).click()
      const lib = page.getByRole('dialog', { name: '加组件' })
      // 一个列表三组（CN-102）：这门课的 / 通用 / 按条件列出
      expect(await lib.getByRole('group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['这门课的', '通用', '按条件列出'])
      await expect(lib.getByTestId('lib-slides')).toContainText('已在页面上')
      await shot(page, `fh-lib-${tone}`)
      await lib.getByTestId('lib-todo').getByRole('button', { name: '加上' }).click()
      await expect(lib.getByTestId('lib-todo')).toContainText('已在页面上')
      await lib.getByRole('textbox', { name: '找组件' }).fill('文本')
      await expect(lib.locator('.lw')).toHaveCount(1)
      await lib.getByTestId('lib-text').getByRole('button', { name: '加上' }).click()
      await lib.getByRole('button', { name: '完成' }).click()
      await expect(lib).toHaveCount(0)
      await expect(w(page, 'text')).toHaveClass(/flash/)
      expect((await order(page)).slice(-2)).toEqual(['todo', 'text'])
      // 加的自由文本能直接写
      await w(page, 'text').locator('.fw-text').click()
      await w(page, 'text').getByRole('textbox', { name: '自由文本' }).fill('老师：王老师\n教室：数学楼 HS 2')
      await home(page).locator('.fh-title h2').click()
      await expect(w(page, 'text').locator('.fw-text')).toHaveText('老师：王老师\n教室：数学楼 HS 2')

      // ---------- 按条件列出：笔记和导图只要导图、表格 ----------
      await w(page, 'notes').getByRole('button', { name: '条件' }).click()
      const cond = page.getByRole('dialog', { name: '按条件列出' })
      await expect(cond.getByTestId('cond-found')).toHaveText('预览 · 找到6个')
      await cond.getByRole('textbox', { name: '值' }).fill('导图')
      await expect(cond.getByTestId('cond-found')).toHaveText('预览 · 找到1个')
      await cond.getByRole('button', { name: '加条件' }).click()
      await cond.getByRole('combobox', { name: '属性' }).nth(1).selectOption('第几讲')
      await cond.getByRole('combobox', { name: '比较' }).nth(1).selectOption('≥')
      await cond.getByRole('textbox', { name: '值' }).nth(1).fill('3')
      await expect(cond.getByTestId('cond-found')).toHaveText('预览 · 找到0个')
      await cond.getByRole('button', { name: '删掉这条' }).nth(1).click()
      await cond.getByRole('radio', { name: '表格' }).click()
      await shot(page, `fh-cond-${tone}`)
      await cond.getByRole('button', { name: '放到首页' }).click()
      await expect(cond).toHaveCount(0)
      await expect(w(page, 'notes').locator('.fw-table tbody tr')).toHaveCount(1)
      await expect(w(page, 'notes').locator('.fw-table tbody tr td').first()).toHaveText('第2讲 导图')
      await expect.poll(() => homeJson(vault, '课程/线性代数').widgets.notes.cond).toMatchObject({ rules: [{ prop: '类型', op: '是其中', value: '导图' }], view: 'table' })

      // 图标和颜色（和树上右键「换图标和颜色…」同一个弹层）：首页的图标方块和左栏那一行一起变
      await home(page).getByRole('button', { name: '图标和颜色' }).click()
      const icons = page.getByRole('dialog', { name: '换图标和颜色' })
      await icons.getByRole('option', { name: 'beaker' }).click()
      await icons.getByRole('option', { name: '天青', exact: true }).click()
      await expect(home(page).locator('.fh-ico')).toHaveCSS('color', 'rgb(46, 127, 163)')
      await expect(home(page).locator('.fh-ico')).toHaveAttribute('data-icon', 'beaker')
      await expect(courseRow(page, '线性代数').locator('.fglyph')).toHaveCSS('color', 'rgb(46, 127, 163)')
      await home(page).getByRole('button', { name: '图标和颜色' }).click()

      await acts(page).getByRole('button', { name: '完成' }).click()
      await expect(home(page).getByRole('toolbar', { name: '编辑首页' })).toHaveCount(0)
      await shot(page, `fh-done-${tone}`)

      // ---------- 「⋯」设为课程模板 ----------
      await acts(page).getByRole('button', { name: '更多' }).click()
      await page.getByRole('menu', { name: '首页的更多' }).getByRole('menuitem', { name: '设为课程模板' }).click()
      const tpl = page.getByRole('dialog', { name: '设为课程模板？' })
      await expect(tpl).toContainText('存在课程/.首页模板.json')
      await shot(page, `fh-tpl-${tone}`)
      await tpl.getByRole('button', { name: '设为模板' }).click()
      await expect(toast(page)).toHaveText('设为课程模板了 · 以后新建的课程用这个样子')
      await expect.poll(() => existsSync(join(vault, '课程/.首页模板.json'))).toBe(true)
      // 模板管组件、排法和外观；图标和颜色是每个文件夹自己的（在 .canvas-notes/左栏.json）
      expect(JSON.parse(readFileSync(join(vault, '课程/.首页模板.json'), 'utf8')).order[0]).toBe('exam')

      // ---------- ⌘K 新建一门课：用模板，进编辑，标题能改 ----------
      await newCourse(page)
      await expect(page.locator('.tab.on')).toHaveText('新的课程')
      await expect(toast(page)).toHaveText('建了课程/新的课程 · 首页用的是「课程模板」')
      await expect(home(page).getByRole('toolbar', { name: '编辑首页' })).toBeVisible()
      const name = home(page).getByRole('textbox', { name: '文件夹名字' })
      await expect(name).toBeFocused()
      // 组件都是空的样子
      await expect(w(page, 'slides').locator('.fw-empty')).toHaveText('把PDF拖到这张卡上，就收进这门课；问到第几页也会记在这里。')
      await shot(page, `fh-new-${tone}`)
      await name.fill('数值分析')
      await name.press('Enter')
      await expect(page.locator('.tab.on')).toHaveText('数值分析')
      await expect(home(page)).toHaveAttribute('data-folder', '课程/数值分析')
      await expect(courseRow(page, '数值分析')).toBeVisible()
      expect(existsSync(join(vault, '课程/数值分析'))).toBe(true)
      expect(existsSync(join(vault, '课程/新的课程'))).toBe(false)
      await expect.poll(() => order(page)).toEqual(['exam', 'slides', 'review', 'notes', 'doubts', 'feynman', 'viz', 'cal', 'links', 'todo', 'text'])
      await expect(home(page).locator('.fh-ico')).toHaveAttribute('data-icon', 'folder-library')

      // ---------- 恢复默认（有模板用模板）：先在线性代数删一个，恢复后回来 ----------
      await courseRow(page, '线性代数').click()
      await acts(page).getByRole('button', { name: '编辑首页' }).click()
      await w(page, 'doubts').getByRole('button', { name: '删掉读PDF时问过的' }).click()
      await expect(w(page, 'doubts')).toHaveCount(0)
      await acts(page).getByRole('button', { name: '更多' }).click()
      await page.getByRole('menu', { name: '首页的更多' }).getByRole('menuitem', { name: '恢复默认' }).click()
      const reset = page.getByRole('dialog', { name: '恢复成默认的课程首页？' })
      await expect(reset).toContainText('文件一个不动')
      await reset.getByRole('button', { name: '恢复默认' }).click()
      await expect(fToast(page).locator('span')).toHaveText('恢复成默认的样子了 · 文件一个没动')
      await expect(w(page, 'doubts')).toBeVisible()
      await expect.poll(() => order(page)).toEqual(['exam', 'slides', 'review', 'notes', 'doubts', 'feynman', 'viz', 'cal', 'links', 'todo', 'text'])
      await shot(page, `fh-reset-${tone}`)
      // 恢复默认也能撤回
      await fToast(page).getByRole('button', { name: '撤回' }).click()
      await expect(w(page, 'doubts')).toHaveCount(0)
      await expect.poll(() => homeJson(vault, '课程/线性代数').order).toEqual(['exam', 'slides', 'review', 'notes', 'feynman', 'viz', 'cal', 'links', 'todo', 'text'])
      // 页面只是看法：怎么改都没动课程里的文件
      expect(gitStatus(vault).split('\n').filter((l) => l && !l.includes('.canvas-notes')).sort()).toEqual(['?? 课程/.首页模板.json', '?? 课程/线性代数/.首页.json'])
    } finally {
      await run.close()
    }
  })
}

test('文件夹首页：项目、生活、写作默认「最近改的」「待办」；东西多了只露几条', async () => {
  const many: Record<string, string> = {}
  for (let i = 1; i <= 400; i++) many[`课程/线性代数/第${(i % 12) + 1}讲 笔记 ${i}.md`] = note('笔记', (i % 12) + 1, `第${(i % 12) + 1}讲 笔记 ${i}`)
  const run = await launch({ ...VAULT, ...many })
  const { page } = run
  try {
    await openInTree(page, '项目/毕业论文')
    await expect.poll(() => order(page)).toEqual(['recent', 'todo'])
    await expect(home(page).locator('.fh-title p')).toHaveText(/^项目 \/ 毕业论文 · 1篇 · 改于/)
    await expect(w(page, 'recent').locator('.fw-row .truncate')).toHaveText(['大纲'])
    await shot(page, 'fh-project-light')
    await openInTree(page, '写作')
    await expect.poll(() => order(page)).toEqual(['recent', 'todo'])
    await expect(w(page, 'recent').locator('.fw-row .truncate')).toHaveText(['一篇草稿'])
    await shot(page, 'fh-writing-light')
    await openInTree(page, '生活')
    await expect.poll(() => order(page)).toEqual(['recent', 'todo'])
    // 待办能直接加（写进 生活/待办.md）、勾掉（task-pd1d1：和左边「待办」格同一份、同一套样子）
    await w(page, 'todo').getByRole('textbox', { name: '首页加一条' }).fill('交房租')
    await w(page, 'todo').getByRole('textbox', { name: '首页加一条' }).press('Enter')
    await w(page, 'todo').getByRole('checkbox', { name: '勾掉「交房租」' }).click()
    await expect(w(page, 'todo').locator('.td-r.done .td-t')).toHaveText('交房租')
    await shot(page, 'fh-life-light')

    // 400 篇笔记：笔记和导图只露 4 条，最近改的 5 条，其余一句「全部 N 份」
    await leftView(page, '课程')
    await courseRow(page, '线性代数').click()
    await expect(w(page, 'notes').locator('.wk .n')).toHaveText('406')
    await expect(w(page, 'notes').locator('.fw-row')).toHaveCount(4)
    await expect(w(page, 'notes').locator('.fw-more')).toHaveText('全部406篇 · 打开列表看')
    await expect(home(page).locator('.fw-row')).toHaveCount(4 + 2)
    await expect(w(page, 'slides').locator('.fw-cover')).toHaveCount(3)
    await shot(page, 'fh-many-light')
    await w(page, 'notes').locator('.fw-more').click()
    await expect(page.locator('.tab.on')).toHaveText('最近')
  } finally {
    await run.close()
  }
})

const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: iPhone 拍的\n日期: 2026-11-15\nAI填的: 课程, 第几讲\n---\n# 导图 11-15 21∶40\n\n- 线性映射\n  - 定义\n'
const CALC = '---\n类型: 笔记\n课程: 微积分\n第几讲: 1\n---\n# 极限\n\n极限的定义。\n'

test('文件夹首页：梦游预览时，挪进这门课的导图在首页标「新」，新的课先出现在左栏', async () => {
  const run = await launch({ ...VAULT, '收件箱/导图 11-15 21∶40.md': MAP, '收件箱/极限.md': CALC }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('收下才合进main', { timeout: 30_000 })
    // 「预览」改名「在树里看」（task-m552v）
    await panel.getByRole('region', { name: '归类和改名' }).getByRole('button', { name: '在树里看' }).click()
    await expect(page.getByTestId('preview-bar')).toBeVisible()
    // 左栏：只在预览里才有的「微积分」标「新」（预览时左栏先换到「文件」页，再切过来）
    await leftView(page, '课程')
    await expect(courseRow(page, '微积分').locator('.tag-new')).toHaveText('新')
    await courseRow(page, '线性代数').click()
    await expect(home(page)).toHaveClass(/previewing/)
    const row = w(page, 'notes').locator('.fw-row', { hasText: '第3讲 线性代数 导图' })
    await expect(row.locator('.tag-new')).toHaveText('新')
    await shot(page, 'fh-preview-light')
    // 点它：开的是还在收件箱里的那篇（还没收下）
    await row.click()
    await expect(tabOn(page)).toHaveText('导图 11-15 21∶40')
    // 退出预览：首页回到现在的样子
    await page.getByTestId('preview-bar').getByRole('button', { name: /退出预览/ }).click()
    await page.locator('.tab', { hasText: '线性代数' }).locator('.tl').click()
    await expect(w(page, 'notes').locator('.tag-new')).toHaveCount(0)
    await expect(courseRow(page, '微积分')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
