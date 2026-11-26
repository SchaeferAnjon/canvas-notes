// 导入 Obsidian 库卡死（2026-11-26 用户：「导入非常慢而且导入会卡住，风扇一直转……导入进去之后也一直显示在提交，然后软件整个卡死」）。
// 照用户的路径：新建空文件夹当库，⌘K「导入旧笔记…」选 Markdown 文件夹（同规模的样本库：3000 篇、2700 张图、300 份 PDF，
// 带 .git 指针文件和 .obsidian），点导入；一边导一边量主进程卡顿、每个进程的 CPU、每次 git 调用（import-measure.ts）。
// 自动提交调成每 10 秒、闲时梦游调成马上就算闲（用户导一个大库时干等着不动电脑，过一阵这两样都会来）。
// CN_IMPORT_SRC=<文件夹>：换成别的来源量（用户真库的副本只拿来量，不截图、不判对错）。CN_MEASURE_DIR：结果和截图存在这里。
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeObsidianBig } from './fixtures/obsidian-big'
import { measureImport } from './import-measure'

const OUT = process.env.CN_MEASURE_DIR
if (OUT) mkdirSync(OUT, { recursive: true })
const REAL = process.env.CN_IMPORT_SRC
/** 导的这一阵自动提交、闲时梦游都会来 */
const BUSY_ENV = { CN_MINUTE_MS: '1000', CN_DREAM_CHECK_MS: '2000', CN_DREAM_IDLE_SEC: '0', CN_AI_FAKE: '1' }
/** 用户真库的副本：AI 一律用假的（闲时梦游会把笔记里的句子发给 AI，真库的内容不能出这台电脑） */
const REAL_ENV = { CN_AI_FAKE: '1' }
const gitIn = (dir: string, ...a: string[]) => execFileSync('/usr/bin/git', ['-C', dir, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

test('整个 Obsidian 库（3000 篇、3000 个图片和 PDF）导进新库：一次提交全带上，导的时候不起几千个 git、不被自动提交和梦游拆开，进度一步步报', async () => {
  test.setTimeout(60 * 60_000)
  let src = REAL
  let notes = 0
  if (!src) {
    src = join(mkdtempSync(join(tmpdir(), 'cn-obs-big-')), '样本Obsidian库')
    notes = makeObsidianBig(src).notes
  }
  const m = await measureImport({ label: process.env.CN_MEASURE_LABEL ?? 'run', src, outDir: OUT, shots: !REAL, settleSec: Number(process.env.CN_SETTLE_SEC ?? 90), env: REAL ? REAL_ENV : BUSY_ENV })
  try {
    console.log(JSON.stringify({ scanMs: m.scanMs, importMs: m.importMs, commitMs: m.commitMs, mainMaxLagMs: m.mainMaxLagMs, rt: m.rendererMaxRoundtripMs, git: m.git.total, after: m.after, vault: m.vault, errors: m.errors.slice(0, 10) }, null, 1))
    if (REAL) return
    // 导入那一次提交带上了全部 3000 篇（以前导到一半被自动提交、梦游 git add -A 提交走一大半）
    const hash = gitIn(m.dir, 'log', '--format=%H', '--grep=^导入旧笔记', '-1').trim()
    expect(hash).not.toBe('')
    const mds = gitIn(m.dir, 'show', '--name-only', '--format=', hash).split('\n').filter((l) => l.endsWith('.md'))
    expect(mds).toHaveLength(notes)
    // 导入之前（导的那一阵）没有别的提交带走导入的笔记：导入那次之前的提交里一篇都没有（导完以后梦游再改名、挪动是另一回事）
    const mine = new Set(mds)
    const parents = gitIn(m.dir, 'rev-list', '--parents', '-n', '1', hash).trim().split(' ').slice(1)
    const before = parents.length ? gitIn(m.dir, 'log', '--format=', '--name-only', ...parents).split('\n').filter((p) => mine.has(p)) : []
    expect(before).toEqual([])
    // 以前梦游、自动提交 add -A 提交走的那种「新增 4155 个文件」
    expect(gitIn(m.dir, 'log', '--format=%s', '--all').split('\n').filter((s) => Number(/^新增 (\d+) 个文件/.exec(s)?.[1] ?? 0) > 50)).toEqual([])
    // 导的这一阵没有一个文件一次的 git 状态（以前 3000 篇起了 2 万多个 git，git status 3700 多次）
    expect(m.git.byCmd['--no-optional-locks']?.n ?? 0).toBeLessThan(60)
    expect(m.git.total).toBeLessThan(300)
    // 进度：读笔记、写文件、记进历史，每一步都有「几个 / 共几个」
    const steps = m.phases.map((p) => p.phase)
    expect(steps).toEqual(expect.arrayContaining(['reading', 'writing', 'committing', 'done']))
    const reading = m.phases.filter((p) => p.phase === 'reading' && p.total)
    expect(reading.at(-1)?.total).toBe(notes)
    // 记进历史从 0 报到全部（几千个文件、分好几批）
    const committing = m.phases.filter((p) => p.phase === 'committing')
    expect(committing[0]).toMatchObject({ done: 0 })
    expect(committing.at(-1)!.total).toBeGreaterThan(notes)
    expect(committing.at(-1)!.done).toBe(committing.at(-1)!.total)
    // .git 指针文件、.obsidian 没拷进来；新库的 git 好好的、都提交了
    expect(m.vault).toMatchObject({ obsidianCopied: false, gitPointerCopied: false, gitWorks: true, trashCopied: false })
    expect(m.errors.filter((e) => /Uncaught|ENOENT/.test(e))).toEqual([])
  } finally {
    await m.close()
  }
})

test.describe(() => {
  test.skip(!!REAL, '只在样本库上跑')

  test('导到一半点「停下」：正在跑的停掉，写进来的都删掉，库回到导入前', async () => {
    test.setTimeout(20 * 60_000)
    const src = join(mkdtempSync(join(tmpdir(), 'cn-obs-mid-')), '样本Obsidian库')
    makeObsidianBig(src, { notes: 1500, images: 1500, pdfs: 50 })
    const m = await measureImport({
      label: 'stop',
      src,
      settleSec: 5,
      expectDone: false,
      async during({ page }) {
        const sheet = page.getByRole('dialog', { name: '导入旧笔记' })
        await expect(sheet.getByTestId('import-progress')).toContainText(/在写进库里 · \d+\/\d+个文件/, { timeout: 120_000 })
        await sheet.getByRole('button', { name: '停下' }).click()
        await expect(sheet.getByTestId('import-stopped')).toHaveText('库里什么都没动，原来的文件夹也没动。', { timeout: 120_000 })
        await expect(sheet.getByRole('heading', { name: '停下了' })).toBeVisible()
        if (OUT) await page.screenshot({ path: join(OUT, 'stop-停下了.png') })
      },
    })
    try {
      for (const d of ['00-Inbox', '10-Journal', '30-Courses', '附件/导入']) expect(existsSync(join(m.dir, d)), d).toBe(false)
      expect(gitIn(m.dir, 'log', '--all', '--format=%s', '--grep=^导入旧笔记')).toBe('')
      // 暂存区里没有导入的东西
      expect(gitIn(m.dir, 'diff', '--cached', '--name-only')).toBe('')
      expect(m.errors.filter((e) => /Uncaught|ENOENT/.test(e))).toEqual([])
    } finally {
      await m.close()
    }
  })

  test('来源里有还在 iCloud 里的占位文件：选文件夹时说有几个，导入先下载（有进度），下不下来的不导、导完列出名字', async () => {
    test.setTimeout(10 * 60_000)
    const src = join(mkdtempSync(join(tmpdir(), 'cn-obs-cloud-')), '样本Obsidian库')
    const s = makeObsidianBig(src, { notes: 60, images: 40, pdfs: 6 })
    // 没法在 iCloud 外面造真的占位文件：挑 8 个当占位，下载要 1.5 秒，其中 2 个下不下来（icloud.ts 的 CN_IMPORT_FAKE_CLOUD）
    const md = s.files.filter((f) => f.endsWith('.md'))
    const att = s.files.filter((f) => !f.endsWith('.md'))
    const cloud = [...md.slice(0, 4), ...att.slice(0, 4)]
    const fail = [md[0]!, att[0]!]
    const spec = join(src, '..', 'cloud.json')
    writeFileSync(spec, JSON.stringify(Object.fromEntries(cloud.map((r) => [r, { ms: 1500, ...(fail.includes(r) ? { fail: true } : {}) }]))))
    const m = await measureImport({
      label: 'cloud',
      src,
      settleSec: 5,
      outDir: OUT,
      shots: true,
      env: { CN_IMPORT_FAKE_CLOUD: spec },
      async onScan(sheet) {
        await expect(sheet.getByTestId('import-cloud')).toContainText('有8个文件还在iCloud里没下载')
        await expect(sheet.getByTestId('import-skipped')).toContainText('.git、.gitignore、.obsidian、.trash不拷')
      },
      async during({ page }) {
        const sheet = page.getByRole('dialog', { name: '导入旧笔记' })
        await expect(sheet.getByTestId('import-progress')).toContainText(/在从iCloud下载 · \d\/8个文件/, { timeout: 60_000 })
        if (OUT) await page.screenshot({ path: join(OUT, 'cloud-下载中.png') })
      },
    })
    try {
      const sheet = m.page.getByRole('dialog', { name: '导入旧笔记' })
      const down = m.phases.filter((p) => p.phase === 'downloading')
      expect(down.at(-1)).toMatchObject({ done: 8, total: 8 })
      const lost = await sheet.getByRole('list', { name: '没导全的' }).textContent()
      expect(lost).toContain('2个文件在iCloud里没下载下来，没导')
      for (const f of fail) expect(lost).toContain(f.split('/').pop()!)
      // 下不下来的那篇没导，下下来了的导进来了
      expect(existsSync(join(m.dir, md[0]!))).toBe(false)
      expect(existsSync(join(m.dir, md[1]!))).toBe(true)
      expect(Number(gitIn(m.dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter((l) => l.endsWith('.md')).length)).toBe(59)
    } finally {
      await m.close()
    }
  })
})
