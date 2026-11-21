// 用本机真的 Claude Code 跑 4 条新命令（task-9womr）：截图转成文字、出几道自测题、白板排成计划、视频要点带时间，
// 看写到哪、改了什么和 / 菜单小标签说的是否一致（只加字、只在末尾加、只挪卡、新建进收件箱），一次提交、能撤回。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-cmds2.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录（/ 命令不留会话，一般没有）。每条的结果写进 CN_REAL_LOG 指的文件（交回时贴）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, rail, tabOn, type Running } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const log = (s: string) => (process.env.CN_REAL_LOG ? appendFileSync(process.env.CN_REAL_LOG, s + '\n') : console.log(s))

/** 说明以 prefix 开头的最近一次提交：说明和改了哪些文件 */
function commitOf(vault: string, prefix: string): string[] {
  const out = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'log', '--format=@@%s', '--name-only'], { encoding: 'utf8' })
  const part = out.split('@@').find((x) => x.startsWith(prefix))
  return part ? part.split('\n').filter(Boolean) : []
}

async function openByName(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

async function slashIn(page: Page, cell: ReturnType<typeof chat>, typed: string, name: string) {
  await cell.getByRole('textbox', { name: '问 AI' }).click()
  await page.keyboard.type('/' + typed)
  await page.getByTestId('slash-menu').locator(`.it:has(.n:text-is("${name}"))`).click()
}

async function lowEffort(page: Page, cell: ReturnType<typeof chat>) {
  await cell.getByTestId('ai-effort').click()
  await page.getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(cell.getByTestId('ai-effort')).toHaveText('Low')
}

/** 这次在 ~/.claude 下留的会话记录（按临时库路径起名的文件夹） */
function forgetSessions(run: Running) {
  const projects = join(homedir(), '.claude', 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}`)
}

/** 画一张有字、有表格的截图（隐藏窗口里画网页再截下来） */
async function tableShot(run: Running): Promise<Buffer> {
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false, width: 460, height: 190, webPreferences: { offscreen: true } })
    const html = `<html><body style="font:16px -apple-system;margin:16px;background:#fff;color:#111"><b>张量的写法</b><table border="1" cellspacing="0" cellpadding="6" style="margin-top:8px"><tr><th>写法</th><th>意思</th></tr><tr><td>x</td><td>标量</td></tr><tr><td>x（粗体）</td><td>向量</td></tr><tr><td>X</td><td>矩阵</td></tr></table></body></html>`
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 400))
    const img = await w.webContents.capturePage()
    w.destroy()
    return img.toPNG().toString('base64')
  })
  return Buffer.from(b64, 'base64')
}

const LECTURE = `# 第2讲 预备知识

## 张量

张量就是多维数组：一个轴是向量，两个轴是矩阵。

![](../附件/截图 1.png)

## 广播

两个张量形状不同、但能扩展成一样时，按元素运算前会自动扩展。比如 (3,1) 加 (1,2) 得到 (3,2)。

## 自动微分

backward 只能对标量调用；要对向量求导，先把它加起来变成一个数。detach 会把一个张量从计算图里拿出来。
`

const BOARD = '---\ntype: board\n---\n## 冰岛\n\n下周三前订机票\n\n这周五把租车订了\n\n看极光（11 月以后都行）\n\n## 杂事\n\n写游记\n\n下周买雪地靴\n\n明年夏天再去一次峡湾\n'

test('真 Claude Code：截图转成文字、出几道自测题、白板排成计划，写到哪、改了什么和小标签说的一样', async () => {
  const run = await launch({ '课程/第2讲 预备知识.md': LECTURE, '计划/冰岛.md': BOARD }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    mkdirSync(join(vault, '附件'), { recursive: true })
    writeFileSync(join(vault, '附件', '截图 1.png'), await tableShot(run))
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, 'commit', '-q', '-m', '截图'])
    await openByName(page, '第2讲 预备知识')
    await openAi(page)
    await lowEffort(page, chat(page))
    const lec = '课程/第2讲 预备知识.md'

    let t = Date.now()
    await slashIn(page, chat(page), '截图', '截图转成文字')
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 4 * 60_000 })
    const ocr = read(vault, lec)
    const added = ocr.split('\n').filter((l) => !LECTURE.split('\n').includes(l))
    for (const line of LECTURE.split('\n')) expect(ocr.split('\n')).toContain(line)
    expect(ocr).toMatch(/标量/)
    log(`截图转成文字（${Math.round((Date.now() - t) / 1000)} 秒）：提交「${commitOf(vault, 'AI：/截图转成文字')[0]}」，改的文件 ${commitOf(vault, 'AI：/截图转成文字').slice(1).join('、')}；原文一行不少，图下面加了 ${added.filter(Boolean).length} 行：\n${added.filter(Boolean).join('\n')}`)

    t = Date.now()
    const beforeQuiz = read(vault, lec)
    await slashIn(page, chat(page), '自测', '出几道自测题')
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 4 * 60_000 })
    const quiz = read(vault, lec)
    expect(quiz.startsWith(beforeQuiz.replace(/\s+$/, '') + '\n\n## 自测题\n\n1. ')).toBe(true)
    const qs = quiz.slice(beforeQuiz.replace(/\s+$/, '').length).match(/^\d\. .+$/gm) ?? []
    expect(qs.length).toBeGreaterThanOrEqual(3)
    log(`出几道自测题（${Math.round((Date.now() - t) / 1000)} 秒）：提交「${commitOf(vault, 'AI：/出几道自测题')[0]}」；原文是开头那一截一字不差，末尾加了「自测题」${qs.length} 道：\n${qs.join('\n')}`)

    t = Date.now()
    await openByName(page, '冰岛')
    await slashIn(page, chat(page), '排成', '白板排成计划')
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 4 * 60_000 })
    const plan = read(vault, '计划/冰岛.md')
    for (const card of ['下周三前订机票', '这周五把租车订了', '看极光（11 月以后都行）', '写游记', '下周买雪地靴', '明年夏天再去一次峡湾']) expect(plan).toContain(card)
    for (const col of ['## 这周', '## 下周', '## 以后', '## 冰岛', '## 杂事']) expect(plan).toContain(col)
    log(`白板排成计划（${Math.round((Date.now() - t) / 1000)} 秒）：提交「${commitOf(vault, 'AI：/白板排成计划')[0]}」；6 张卡一张不少、字没改，原来两列留着，排好的样子：\n${plan.slice(plan.indexOf('## 这周'), plan.indexOf('## 冰岛')).trim()}`)

    // 撤回：白板回到排之前
    await chat(page).getByTestId('ai-msg').last().getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(vault, '计划/冰岛.md')).toBe(BOARD)
    log('白板排成计划：撤回以后白板一字不差回到原样')
  } finally {
    forgetSessions(run)
    await run.close()
  }
})

test('真 Claude Code：视频要点带时间新建进收件箱，每条能点回那一秒', async () => {
  const { server, base } = await startFakeVideoSite()
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_AI_MODEL: 'sonnet', CN_VIDEO_TEST_ORIGIN: base })
  const { page, vault } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web.getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    await openAi(page)
    const rchat = page.getByRole('complementary', { name: '边读边问 AI' })
    await lowEffort(page, rchat)
    const t = Date.now()
    await slashIn(page, rchat, '视频', '视频要点带时间')
    await expect(rchat.getByTestId('reading-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 4 * 60_000 })
    const c = commitOf(vault, 'AI：/视频要点带时间')
    expect(c[1]).toMatch(/^收件箱\/.+ 要点\.md$/)
    const note = read(vault, c[1]!)
    const points = note.match(/^- \[\d\d:\d\d\]\(.+&t=\d+s\) .+$/gm) ?? []
    expect(points.length).toBeGreaterThanOrEqual(3)
    expect(c.slice(1)).toHaveLength(1)
    log(`视频要点带时间（${Math.round((Date.now() - t) / 1000)} 秒）：提交「${c[0]}」，只新建了 ${c[1]}，别的文件没碰；${points.length} 个要点：\n${points.join('\n')}`)
  } finally {
    forgetSessions(run)
    await run.close()
    server.close()
  }
})
