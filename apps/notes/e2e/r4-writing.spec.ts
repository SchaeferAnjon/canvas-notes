/**
 * 发版前第 4 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按、真拖。
 */
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { acts, launch, leftView, openNote, pane, waitSaved } from './app'
import { ICELAND } from './fixtures/board'
import { DREAM_VAULT } from './fixtures/dream'

const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const vaultGit = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const toast = (page: Page) => page.getByTestId('toast')

async function palette(page: Page, cmd: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(cmd)
  await page.keyboard.press('Enter')
}

test('这台 Mac 上 git 没有署名：打开库时软件给库设一个（系统用户全名、用户名@电脑名.local），提交都成功；设置里看得到、能改；提交没成功时说中文原因，AI 存好的卡不说「没答出来」', async () => {
  // 临时 HOME：没有 ~/.gitconfig、不读系统配置；useConfigOnly 让 git 不从机器名猜（新 Mac 上就是猜不出、报「作者身份未知」）
  const home = mkdtempSync(join(tmpdir(), 'cn-home-'))
  const noId = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
  }
  const run = await launch({ '冰岛自驾.md': ICELAND, '日记.md': '# 日记\n\n今天。\n' }, { ...noId, CN_AI_FAKE: '1' }, (vault) => {
    execFileSync('git', ['-C', vault, 'config', '--unset', 'user.name'])
    execFileSync('git', ['-C', vault, 'config', '--unset', 'user.email'])
  })
  const { page, vault } = run
  const full = execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8' }).trim()
  const host = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim()
  const email = `${userInfo().username}@${host}.local`
  try {
    // 库里补上了署名，全局一个字没写
    expect(vaultGit(vault, ['config', '--local', 'user.name'])).toBe(full)
    expect(vaultGit(vault, ['config', '--local', 'user.email'])).toBe(email)
    expect(() => readFileSync(join(home, '.gitconfig'))).toThrow()

    // 打几个字，⌘K「现在提交」：提交上了，署名是补上的那个
    await openNote(page, '日记')
    await pane(page).locator('.cm-content').press('End')
    await page.keyboard.type('下雪')
    await waitSaved(page)
    await palette(page, '现在提交')
    await expect(toast(page)).toContainText('提交好了：更新 1 个文件：日记')
    expect(vaultGit(vault, ['status', '--porcelain'])).toBe('')
    expect(vaultGit(vault, ['log', '-1', '--format=%an <%ae>'])).toBe(`${full} <${email}>`)

    // 设置 › Git和同步：写着提交署名，改成别的，下一次提交用新的
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
    // 设置方向 A：署名是「提交」一组里的一行，名字 · 邮箱写在说明里，右边「改」
    const row = dlg.locator('[data-row="gitId"]')
    await expect(row.getByTestId('git-identity')).toContainText(`${full} · ${email}`)
    await row.getByRole('button', { name: '改' }).click()
    const form = dlg.getByRole('form', { name: '改提交署名' })
    await form.getByRole('textbox', { name: '署名的名字' }).fill('写作的我')
    await form.getByRole('textbox', { name: '署名的邮箱' }).fill('me@writing.local')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(dlg.getByTestId('git-identity')).toContainText('写作的我 · me@writing.local')
    await expect(dlg.getByTestId('settings-toast')).toContainText('提交署名改好了')
    expect(vaultGit(vault, ['config', '--local', 'user.name'])).toBe('写作的我')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)

    // AI「存成卡片」：卡写进文件了、提交没成功（锁文件一直不放）时照实说，不说「没答出来」，「存成卡片」按钮收起
    writeFileSync(join(vault, '.git/index.lock'), '')
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await page.getByRole('button', { name: '打开 AI' }).click()
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('/总结这块白板')
    await box.press('Enter')
    const msg = ai(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('这块白板讲了三件事')
    await msg.getByRole('button', { name: '存成卡片' }).click()
    const warn = msg.getByTestId('ai-warn')
    await expect(warn.locator('.t')).toHaveText('卡存好了，提交没成功', { timeout: 15_000 })
    await expect(warn.locator('.why')).toHaveText('库里留着一个Git锁文件（.git/index.lock，多半是上次Git没退干净）：确认没有别的Git程序在用这个库，删掉它再提交')
    await expect(msg).not.toContainText('没答出来')
    await expect(msg.getByTestId('ai-error')).toHaveCount(0)
    await expect(msg.getByRole('button', { name: '存成卡片' })).toHaveCount(0)
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('这块白板讲了三件事')
    await expect(pane(page).locator('.db-card', { hasText: '这块白板讲了三件事' })).toBeVisible()

    // 「现在提交」也撞上这把锁：一句中文原因，不露 git 原话、不带完整路径
    await palette(page, '现在提交')
    await expect(toast(page)).toContainText('库里留着一个Git锁文件', { timeout: 15_000 })
    await expect(toast(page)).not.toContainText(vault)
    await expect(toast(page)).not.toContainText('fatal')

    // 锁拿掉，点提醒下面的「再提交一次」：提交上了，用的是改过的署名
    rmSync(join(vault, '.git/index.lock'))
    await warn.getByRole('button', { name: '再提交一次' }).click()
    // 打开时转好的写法也还没提交：锁一放开，自动提交可能先把这篇收进去了，两种说法都对
    await expect(msg.locator('.done')).toHaveText(/^卡存好了，(提交好了|已经由自动提交收进去了)$/)
    await expect(warn).toHaveCount(0)
    expect(vaultGit(vault, ['log', '-1', '--format=%an <%ae>'])).toBe('写作的我 <me@writing.local>')
    expect(vaultGit(vault, ['status', '--porcelain'])).toBe('')
  } finally {
    await run.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('白板上单独摆着的段落：文档里 ←、Home 两下、Ctrl+A、点行首再 Home、退格两下，光标都进不去藏着的位置行，字和退格落在看得见的字里', async () => {
  const LINE = '<!-- card id=d2 x=900 y=200 -->'
  const NOTE = (t: string) => `# ${t}\n\n第一段卡片。\n\n第二段卡片。\n\n${LINE}\n收尾一段。\n`
  const names = ['左移', '两下', '控制', '行首', '退格']
  const run = await launch(Object.fromEntries(names.map((n) => [`${n}.md`, NOTE(n)])))
  const { page, vault } = run
  const file = (n: string) => readFileSync(join(vault, `${n}.md`), 'utf8')
  const tail = () => pane(page).locator('.cm-line', { hasText: '收尾一段。' })
  /** 点「收尾一段。」这行最左边（行首） */
  const clickLineStart = async () => {
    const b = (await tail().boundingBox())!
    await page.mouse.click(b.x + 2, b.y + b.height / 2)
  }
  /** 点在「收尾一段。」字中间 */
  const clickMiddle = async () => {
    const b = (await tail().boundingBox())!
    await page.mouse.click(b.x + 40, b.y + b.height / 2)
  }
  const check = async (n: string, want: string) => {
    await waitSaved(page)
    expect(file(n)).toBe(want)
    await expect(pane(page).locator('.cm-content')).not.toContainText('<!--')
  }
  try {
    // ←：从段首走到上一段末尾（task-ys1rr 起块和块之间的空行不停光标；以前停在空行上，打的字并进上一段成了它的第二行），位置行不碰
    await openNote(page, '左移')
    await clickMiddle()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('Y')
    await check('左移', NOTE('左移').replace('第二段卡片。', '第二段卡片。Y'))
    // Home 两下：停在段首
    await openNote(page, '两下')
    await clickMiddle()
    await page.keyboard.press('Home')
    await page.keyboard.press('Home')
    await page.keyboard.type('Y')
    await check('两下', NOTE('两下').replace('收尾一段', 'Y收尾一段'))
    // Ctrl+A（行首）
    await openNote(page, '控制')
    await clickMiddle()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Y')
    await check('控制', NOTE('控制').replace('收尾一段', 'Y收尾一段'))
    // 点这行最左边再 Home
    await openNote(page, '行首')
    await clickLineStart()
    await page.keyboard.press('Home')
    await page.keyboard.type('Y')
    await check('行首', NOTE('行首').replace('收尾一段', 'Y收尾一段'))
    // 白板上这张卡还摆在原处
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).getByTestId('doc-board').locator('.db-card.placed')).toHaveCount(1)
    await expect(pane(page).getByTestId('doc-board').locator('.db-card.placed')).toContainText('Y收尾一段')
    // 点行首退格两下：第一下并掉上面的空行，第二下并到上一段末尾，位置行挪到并好的那段前面，不露在屏上
    await openNote(page, '退格')
    await clickLineStart()
    await page.keyboard.press('Backspace')
    await check('退格', NOTE('退格').replace(`\n\n${LINE}`, `\n${LINE}`))
    await page.keyboard.press('Backspace')
    await check('退格', NOTE('退格').replace(`第二段卡片。\n\n${LINE}\n收尾一段。`, `${LINE}\n第二段卡片。收尾一段。`))
  } finally {
    await run.close()
  }
})

test('打开笔记直接打字：开头是下划线标题、分隔线、属性下面空一行再写标题，字都落在第一段正文末尾', async () => {
  const notes: Record<string, string> = {
    '游记总目.md': '游记总目\n====\n\n第一段。\n',
    '分隔线二.md': '# 分隔线二\n\n___\n\n正文。\n',
    '极光六.md': '---\ncreated: 2026-11-17 10:00\n---\n\n# 极光六\n\n看到了。\n',
  }
  const run = await launch(notes)
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    for (const [path, text] of Object.entries(notes)) {
      const name = path.replace(/\.md$/, '')
      await page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).click()
      await expect(pane(page).locator('.cm-content')).toBeFocused()
      await page.keyboard.type('今天')
      await waitSaved(page)
      const want = text.replace(/(第一段。|正文。|看到了。)\n$/, '$1今天\n')
      expect(readFileSync(join(vault, path), 'utf8')).toBe(want)
    }
  } finally {
    await run.close()
  }
})

test('展开的折叠块：标题末尾回车，新起的一段和标题之间空一行，粗体照常生效；一行写法也一样（文档方向 A：→ 不在藏着的 </summary> 后面白按一下）', async () => {
  const NOTES: Record<string, string> = {
    折叠甲: '# 折叠甲\n\n<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n\n后面一段。\n',
    折叠辛: '# 折叠辛\n\n<details><summary>标题辛</summary>\n第一段里面。\n</details>\n\n后面一段。\n',
  }
  const run = await launch(Object.fromEntries(Object.entries(NOTES).map(([k, v]) => [`${k}.md`, v])))
  const { page, vault } = run
  try {
    for (const [name, text] of Object.entries(NOTES)) {
      await openNote(page, name)
      await pane(page).locator('.cm-fold-head').click()
      const head = pane(page).locator('.cm-line.cm-fold-headline')
      await expect(head).toBeVisible()
      // 点标题字，End 到标题末尾，回车
      await head.locator('.cm-fold-title').click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('**加粗**新起')
      await waitSaved(page)
      expect(readFileSync(join(vault, `${name}.md`), 'utf8')).toBe(text.replace(/<\/summary>\n\n?第一段/, '</summary>\n\n**加粗**新起\n\n第一段'))
      // 光标挪开：这一行是正文，粗体画成粗体、不露星号
      await pane(page).locator('.cm-line', { hasText: '后面一段。' }).click()
      const line = pane(page).locator('.cm-line', { hasText: '新起' })
      await expect(line.locator('.cm-strong')).toHaveText('加粗')
      await expect(line).not.toContainText('**')
    }
  } finally {
    await run.close()
  }
})

test('套着的折叠块全部展开：每套一层再缩一级，里层标题和外层正文的字对齐，里层正文比里层标题多缩 23；外面几层的细线连着画；打开再关字节不变', async () => {
  const NOTE =
    '# 折叠三层\n\n<details>\n<summary>一层</summary>\n\n<details>\n<summary>二层</summary>\n\n<details>\n<summary>三层</summary>\n\n最深。\n\n</details>\n\n二层的字。\n\n</details>\n\n一层的字。\n\n</details>\n\n后面。\n'
  const run = await launch({ '折叠三层.md': NOTE })
  const { page, vault } = run
  try {
    await openNote(page, '折叠三层')
    for (const t of ['一层', '二层', '三层']) await pane(page).locator('.cm-fold-head', { hasText: t }).click()
    await expect(pane(page).locator('.cm-line', { hasText: '最深。' })).toBeVisible()
    const m = await pane(page)
      .locator('.cm-content')
      .evaluate((root) => {
        const lineOf = (t: string) => [...root.querySelectorAll<HTMLElement>('.cm-line')].find((l) => l.textContent?.trim() === t)!
        /** 字从哪儿开始（行左边 + 细线 + 内边距） */
        const textX = (t: string) => {
          const l = lineOf(t)
          const cs = getComputedStyle(l)
          return l.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
        }
        const chevX = (t: string) => lineOf(t).querySelector('.cm-fold-chev')!.getBoundingClientRect().left
        const before = (t: string) => getComputedStyle(lineOf(t), '::before').width
        const titleX = (t: string) => lineOf(t).querySelector('.cm-fold-title')!.getBoundingClientRect().left
        return {
          title: [titleX('一层'), titleX('二层'), titleX('三层')],
          chev: [chevX('一层'), chevX('二层'), chevX('三层')],
          text: [textX('一层的字。'), textX('二层的字。'), textX('最深。')],
          lines: [before('一层的字。'), before('二层的字。'), before('最深。')],
        }
      })
    // 每层正文比自己的标题多缩 23（和最外层一样）；里一层的标题和外一层的正文对齐
    for (let i = 0; i < 3; i++) expect(Math.round(m.text[i]! - m.chev[i]!)).toBe(23)
    expect(Math.round(m.chev[1]! - m.text[0]!)).toBe(0)
    expect(Math.round(m.chev[2]! - m.text[1]!)).toBe(0)
    // 标题的字和自己那层正文的字对齐
    for (let i = 0; i < 3; i++) expect(Math.round(m.title[i]! - m.text[i]!)).toBe(0)
    // 外面几层的细线：二层的字左边多画一条，最深的多画两条（23 一条）
    expect(m.lines.slice(1)).toEqual(['23px', '46px'])
    await page.screenshot({ path: 'test-results/r4-fold-nested.png' })
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(500)
    expect(readFileSync(join(vault, '折叠三层.md'), 'utf8')).toBe(NOTE)
  } finally {
    await run.close()
  }
})

test('写作首页：数据库主笔记在别的文件夹（生活）时，写作里的数据源条目不算草稿；只有双链、只有代码块的不算写完的文章', async () => {
  const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("写作/清单库")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'
  const long = '这是一段写完的文章，'.repeat(12)
  const links = Array.from({ length: 30 }, (_, i) => `[[参考笔记第${i}篇]]`).join(' ')
  const run = await launch({
    '写作/清单库/一.md': '',
    '写作/清单库/二.md': '',
    '写作/清单库/三.md': '',
    '生活/清单表.md': `# 清单表\n\n${BASE}\n`,
    '写作/正文草稿.md': '# 正文草稿\n\n还没写完。\n',
    '写作/长文.md': `# 长文\n\n${long}\n`,
    '写作/双链多.md': `# 双链多\n\n${links}\n`,
    '写作/代码块.md': '# 代码块\n\n```js\n' + 'console.log("hello world, this is code");\n'.repeat(6) + '```\n',
  })
  const { page } = run
  try {
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^写作$/ }) }).click()
    const home = page.getByTestId('folder-home')
    // 头一行：「分类 · 篇数 · 改于」（写作里一共 7 篇，含清单库的三条）
    await expect(home.locator('.fh-title p')).toHaveText(/^分类 · 7篇 · 改于/)
    // 写作首页默认只有「最近改的」「待办」（2026-11-18 方案 v2 / 写作首页走样修）：草稿、「这个月写完的」从组件库加上再看
    await acts(page).getByRole('button', { name: '编辑首页' }).click()
    await home.getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await lib.getByRole('button', { name: '加上 草稿' }).click()
    await lib.getByRole('button', { name: '加上 这个月写完的' }).click()
    await lib.getByRole('button', { name: '完成' }).click()
    await acts(page).getByRole('button', { name: '完成' }).click()
    // 草稿：正文草稿、双链多、代码块；写完的：长文。三个条目两边都不算
    const drafts = page.getByTestId('fw-drafts')
    await expect(drafts.locator('.fw-row')).toHaveCount(3)
    for (const n of ['一', '二', '三']) await expect(drafts.locator('.fw-row .truncate', { hasText: new RegExp(`^${n}$`) })).toHaveCount(0)
    const done = page.getByTestId('fw-list')
    await expect(done).toContainText('长文')
    await expect(done).not.toContainText('双链多')
    await expect(done).not.toContainText('代码块')
  } finally {
    await run.close()
  }
})

test('数据库「新一条」手快双击：只建一条，打的名字给这一条，不多出空的「未命名」', async () => {
  const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("项目/库")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'
  const run = await launch({ '项目/表.md': `# 表\n\n${BASE}\n`, '项目/库/已有.md': '---\n状态: 进行中\n---\n' })
  const { page, vault } = run
  const names = () => readdirSync(join(vault, '项目/库')).filter((f) => f.endsWith('.md')).sort()
  try {
    await openNote(page, '表')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(1)
    for (const n of ['双击', '双击二']) {
      await db.getByRole('button', { name: '新一条' }).dblclick()
      await expect(db.locator('input.base-in')).toBeFocused()
      await page.keyboard.type(n)
      await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(join(vault, `项目/库/${n}.md`))).toBe(true)
    }
    await page.waitForTimeout(500)
    expect(names()).toEqual(['已有.md', '双击.md', '双击二.md'].sort())
    await expect(db.locator('tbody tr')).toHaveCount(3)
    // 单击照旧：点一下建一条
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('input.base-in')).toBeFocused()
    await page.keyboard.type('单击')
    await page.keyboard.press('Enter')
    await expect.poll(() => names()).toEqual(['已有.md', '双击.md', '双击二.md', '单击.md'].sort())
  } finally {
    await run.close()
  }
})

test('白板（type: board，以前的写法打开时转好）上改卡按 Esc：打的字存下，不丢', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    const card = pane(page).getByTestId('doc-board').locator('.db-card[data-id="k1"]')
    await card.dblclick()
    const box = pane(page).getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    // 卡里是排好的样子：## 和 ** 不露
    await expect(box).not.toContainText('**')
    await page.keyboard.type('自驾')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(card).toContainText('自驾')
    await expect.poll(() => readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('2.27 和 2.28 两晚住哪还没订，**租车要四驱**。自驾\n')
  } finally {
    await run.close()
  }
})

test('梦游跑到一半 ⌘Q：留下的半截 dream/ 分支和临时检出，下次梦游前清掉；新的分支照旧叫 dream/月-日，不改叫 -2', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '4000' })
  const { page, vault, userData } = run
  const root = dirname(vault)
  const now = new Date()
  const branch = `dream/${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const branches = () => vaultGit(vault, ['branch', '--list', '--format=%(refname:short)', 'dream/*']).split('\n').filter(Boolean)
  const worktrees = () => vaultGit(vault, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length
  try {
    await page.getByTestId('dream-card').getByRole('button', { name: '现在梦游' }).click()
    // 分支和临时检出建好了、AI 还在想：这时退出
    await expect.poll(branches, { timeout: 15_000 }).toEqual([branch])
    expect(worktrees()).toBe(2)
    await run.close({ keep: true })
    // 打断后留着的：半截分支（报告没存下，界面上看不到）
    expect(branches()).toEqual([branch])

    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash') },
    })
    try {
      const p2 = await app.firstWindow()
      const card = p2.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toHaveText(/^整理了\d+处，等你过目$/, { timeout: 30_000 })
      // 只剩这一次的分支，名字没加 -2；上次的临时检出清掉了
      expect(branches()).toEqual([branch])
      expect(worktrees()).toBeLessThanOrEqual(2)
      expect(vaultGit(vault, ['status', '--porcelain'])).toBe('')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('上次 git 崩了留下的锁一直不放时退出：打的字在文件里，quit.log 照实记「没提交上」和中文原因，不写「提交完」', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天。\n' })
  const { page, vault, userData } = run
  try {
    await openNote(page, '日记')
    await pane(page).locator('.cm-content').press('End')
    await page.keyboard.type('下雪')
    await waitSaved(page)
    writeFileSync(join(vault, '.git/index.lock'), '')
    await run.close({ keep: true })
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天。下雪\n')
    const log = readFileSync(join(userData, 'quit.log'), 'utf8')
    expect(log).toContain('没提交上：库里留着一个Git锁文件')
    expect(log).not.toContain('提交完')
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})

test('<details> 和 <summary> 中间空一行、<summary> 写成好几行：文档里收成一行标题、展开不露标签，白板上是折叠卡；打开再关字节不变', async () => {
  const NOTE =
    '# 折叠写法\n\n<details>\n\n<summary>空行写法</summary>\n\n空行里面。\n\n</details>\n\n<details>\n<summary>\n多行写法\n</summary>\n\n多行里面。\n\n</details>\n\n后面一段。\n'
  const run = await launch({ '折叠写法.md': NOTE })
  const { page, vault } = run
  try {
    await openNote(page, '折叠写法')
    const content = pane(page).locator('.cm-content')
    await expect(pane(page).locator('.cm-fold-head')).toHaveText(['空行写法', '多行写法'])
    for (const raw of ['<details', 'summary>', '</details>']) await expect(content).not.toContainText(raw)
    for (const t of ['空行写法', '多行写法']) await pane(page).locator('.cm-fold-head', { hasText: t }).click()
    await expect(pane(page).locator('.cm-line.cm-fold-headline')).toHaveText(['空行写法', '多行写法'])
    await expect(pane(page).locator('.cm-line', { hasText: '多行里面。' })).toBeVisible()
    for (const raw of ['<details', 'summary>', '</details>']) await expect(content).not.toContainText(raw)
    await page.screenshot({ path: 'test-results/r4-details-forms.png' })
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const db = pane(page).getByTestId('doc-board')
    await expect(db.locator('.db-card[data-kind="details"]')).toHaveCount(2)
    for (const raw of ['<details', 'summary>', '</details>']) await expect(db).not.toContainText(raw)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(500)
    expect(readFileSync(join(vault, '折叠写法.md'), 'utf8')).toBe(NOTE)
  } finally {
    await run.close()
  }
})
