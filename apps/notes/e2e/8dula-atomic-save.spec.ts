import { _electron as electron, expect, type Page, test } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import electronPath from 'electron'
import { dirname, join } from 'node:path'
import { gitAct, gitStatus, launch, leftView, openNote, pane, waitSaved } from './app'

// 保存改成原子写（task-8dula）：先写同一个文件夹里的临时文件、fsync，再改名盖过去。
// 这里真打字、真点提交、真把软件 kill -9，看盘上的文件：
// 1. 别的程序一直在读的时候存了好几次：每一次读到的都是整份（BOM、CRLF、结尾都在），权限、创建时间保持
// 2. 存到一半软件被杀（断电一样）：原文件是完整的旧版，没有半截；下次打开把残留的临时文件挪进 .canvas-notes/回收/、记一行
// 3. 临时文件不进文件树、搜索、Git 提交
// CN_SHOTS=<目录>：顺手存对照图（交付页用）

const SHOTS = process.env.CN_SHOTS
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name) })
}
/** 交付页的对照图：盘上真有什么（终端里 ls 的样子） */
const disk = (name: string, cwd: string, cmds: string[][]) => {
  if (!SHOTS) return
  const out = cmds.map((c) => `$ ${c.join(' ')}\n` + execFileSync(c[0]!, c.slice(1), { cwd, encoding: 'utf8' })).join('\n')
  writeFileSync(join(SHOTS, name), out)
}
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const isTemp = (n: string) => /^\..+\.cn-\d+-[0-9a-z]+\.tmp$/.test(n)
const temps = (dir: string) => readdirSync(dir).filter(isTemp)
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 另一个程序（同步盘、Obsidian、git）一直在读这一篇：记下读了几次、几次是坏的（不是整份）、见过几个不同的文件（每存一次换一个） */
function reader(file: string, ms: number) {
  const code = `
    const fs = require('fs'); const [f, ms] = process.argv.slice(1); const until = Date.now() + Number(ms)
    let reads = 0, bad = 0, missing = 0; const inos = new Set(); const samples = []
    const nap = new Int32Array(new SharedArrayBuffer(4))
    while (Date.now() < until) {
      let fd
      try { fd = fs.openSync(f, 'r') } catch (e) { if (e.code === 'ENOENT') { missing++; continue } throw e }
      const st = fs.fstatSync(fd); const b = fs.readFileSync(fd); fs.closeSync(fd)
      reads++; inos.add(st.ino)
      const s = b.subarray(3).toString()
      const ok = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf && s.endsWith('结尾\\r\\n') && !/[^\\r]\\n/.test(s)
      if (!ok) { bad++; if (samples.length < 3) samples.push(JSON.stringify(s.slice(-40))) }
      Atomics.wait(nap, 0, 0, 1)
    }
    console.log(JSON.stringify({ reads, bad, missing, inodes: inos.size, samples }))`
  const child = spawn(process.execPath, ['-e', code, file, String(ms)], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  child.stdout!.on('data', (d) => (out += d))
  return new Promise<{ reads: number; bad: number; missing: number; inodes: number; samples: string[] }>((resolve) => child.once('exit', () => resolve(JSON.parse(out))))
}

test('打字保存好几次，别的程序一直在读：每次读到的都是整份；BOM、CRLF、0600 权限、创建时间都保持，不留临时文件', async () => {
  const original = Buffer.concat([BOM, Buffer.from('# 会议\r\n\r\n第一段。\r\n\r\n结尾\r\n')])
  const born = new Date(2024, 0, 2, 3, 4, 5)
  const run = await launch({ '会议.md': original }, {}, (vault) => {
    chmodSync(join(vault, '会议.md'), 0o600)
    // 修改时间设得比创建时间早，macOS 把创建时间一起拨回去：模拟一篇很早建的笔记
    utimesSync(join(vault, '会议.md'), born, born)
  })
  const { page, vault } = run
  const file = join(vault, '会议.md')
  try {
    const birth = statSync(file).birthtimeMs
    await openNote(page, '会议')
    const reading = reader(file, 9000)
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    // 打四段，每段停下来等它存完：一共存四次以上
    for (const part of ['第一句。', '第二句。', '第三句。', '第四句。']) {
      await page.keyboard.type(part, { delay: 40 })
      await waitSaved(page)
    }
    const r = await reading
    console.log('[读的那个程序]', JSON.stringify(r))
    expect(r.reads).toBeGreaterThan(50)
    expect(r.bad).toBe(0)
    expect(r.missing).toBe(0)
    // 存了好几次（原子写每次换一个新文件）
    expect(r.inodes).toBeGreaterThan(2)
    const now = readFileSync(file)
    expect(Buffer.compare(now, Buffer.concat([BOM, Buffer.from('# 会议\r\n\r\n第一段。第一句。第二句。第三句。第四句。\r\n\r\n结尾\r\n')]))).toBe(0)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(file).birthtimeMs).toBe(birth)
    expect(temps(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

test('临时文件不进文件树、搜索、Git 提交（.git/info/exclude 里写好了）', async () => {
  const run = await launch({ '旅行.md': '# 旅行\n\n第一段。\n', '收件箱/随手记.md': '# 随手记\n' })
  const { page, vault } = run
  try {
    // 画布今日（另一个进程）正在存的一篇：临时文件还在，名字照原子写的样子
    const live = join(vault, '收件箱', `.随手记.md.cn-${process.pid}-live1.tmp`)
    writeFileSync(live, '# 随手记\n\n正在写的临时文件 LIVETMPWORD\n')
    await openNote(page, '旅行')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('加一句 VISIBLEWORD', { delay: 30 })
    await waitSaved(page)
    // 文件树（全部文件）、笔记列表、全库搜索都没有它
    const files = await page.evaluate(() => (window as unknown as { cnFiles: { all(): Promise<{ path: string }[]> } }).cnFiles.all())
    expect(files.map((f) => f.path).filter((p) => /\.tmp$/.test(p))).toEqual([])
    const notes = await page.evaluate(() => (window as unknown as { cn: { listNotes(): Promise<{ path: string }[]> } }).cn.listNotes())
    expect(notes.map((n) => n.path).sort()).toEqual(['收件箱/随手记.md', '旅行.md'])
    type Hit = { path: string }
    const search = (q: string) => page.evaluate((q) => (window as unknown as { cn: { search(q: string): Promise<Hit[]> } }).cn.search(q), q)
    expect((await search('VISIBLEWORD')).map((h) => h.path)).toEqual(['旅行.md'])
    expect(await search('LIVETMPWORD')).toEqual([])
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await expect(tree.getByRole('treeitem').first()).toBeVisible()
    const folder = tree.getByRole('treeitem').filter({ hasText: /^收件箱/ }).first()
    const toggle = folder.getByRole('button', { name: '展开 收件箱' })
    if (await toggle.count()) await toggle.click()
    await expect(tree.locator('[data-path="收件箱/随手记.md"]')).toBeVisible()
    expect(await tree.locator('[data-path$=".tmp"]').count()).toBe(0)
    await expect(tree).not.toContainText('.tmp')
    await shot(page, '2-tree-no-temp.png')
    disk('2-disk.txt', vault, [['ls', '-A1', '收件箱'], ['git', 'status', '--short', '--untracked-files=all']])
    // 真点「提交」：提交里只有改了的笔记，临时文件既不在提交里、也不在「没提交」里
    await gitAct(page, '提交')
    await expect.poll(() => gitStatus(vault)).not.toContain('旅行.md')
    const committed = execFileSync('git', ['-C', vault, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' })
    expect(committed).toContain('旅行.md')
    expect(committed).not.toContain('.tmp')
    expect(gitStatus(vault)).not.toContain('.tmp')
    const exclude = readFileSync(join(vault, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('.*.cn-*.tmp')
    expect(exclude).toContain('/.canvas-notes/回收/')
    // 别人的临时文件软件不碰（它的进程还在）
    expect(existsSync(live)).toBe(true)
  } finally {
    await run.close()
  }
})

test('存到一半软件被 kill -9（和断电一样）：原文件是完整的旧版、没有半截；下次打开把残留的临时文件挪进 .canvas-notes/回收/，记一行', async () => {
  const original = '# 会议\n\n第一段。\n\n结尾\n'
  const run = await launch({ '会议.md': original })
  const { app, page, vault, userData } = run
  const file = join(vault, '会议.md')
  const root = dirname(vault)
  const proc = app.process()
  let re: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await openNote(page, '会议')
    // 临时文件写完、fsync 了，换上去之前停住 30 秒（这时候被杀）
    await app.evaluate(() => {
      type Fn = (...a: unknown[]) => Promise<unknown>
      const fsp = process.getBuiltinModule('node:fs/promises') as unknown as Record<'rename', Fn>
      const rename = fsp.rename
      fsp.rename = async (...a: unknown[]) => {
        if (/\.md\.cn-\d+-[0-9a-z]+\.tmp$/.test(String(a[0]))) await new Promise((r) => setTimeout(r, 30_000))
        return rename(...a)
      }
    })
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('被杀之前打的字', { delay: 30 })
    await expect.poll(() => temps(vault).length, { timeout: 15_000 }).toBe(1)
    const left = temps(vault)[0]!
    proc.kill('SIGKILL')
    await expect.poll(() => proc.exitCode !== null || proc.signalCode !== null).toBe(true)
    // 盘上：原文件一个字节没动，临时文件是没换上去的那一次（整份新的）
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(readFileSync(join(vault, left), 'utf8')).toBe('# 会议\n\n第一段。被杀之前打的字\n\n结尾\n')
    expect(readdirSync(vault).filter((n) => n.startsWith('会议')).sort()).toEqual(['会议.md'])
    disk('3a-disk.txt', vault, [['ls', '-a'], ['cat', '会议.md'], ['cat', left]])
    // 过了一会儿再开（写它的进程早不在了；刚写的一分钟内不动，怕是别的程序正在写）
    const old = new Date(Date.now() - 120_000)
    utimesSync(join(vault, left), old, old)
    re = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    const p2 = await re.firstWindow()
    await expect(p2.locator('.vault b')).toHaveText('测试库')
    await expect.poll(() => temps(vault), { timeout: 15_000 }).toEqual([])
    const moved = join(vault, '.canvas-notes', '回收', today(), left.slice(1))
    expect(existsSync(moved)).toBe(true)
    expect(readFileSync(moved, 'utf8')).toBe('# 会议\n\n第一段。被杀之前打的字\n\n结尾\n')
    const log = readFileSync(join(vault, '.canvas-notes', '回收', '记录.txt'), 'utf8').trim().split('\n')
    expect(log).toHaveLength(1)
    expect(log[0]).toContain(left)
    expect(log[0]).toContain('原文件还在')
    console.log('[回收记录]', log[0])
    expect(readFileSync(file, 'utf8')).toBe(original)
    // 回收处不进 Git、不在「没提交」里
    expect(gitStatus(vault)).not.toContain('回收')
    await openNote(p2, '会议')
    await shot(p2, '3-after-crash-reopen.png')
    disk('3-disk.txt', vault, [['ls', '-a'], ['find', '.canvas-notes/回收', '-type', 'f'], ['cat', '.canvas-notes/回收/记录.txt'], ['cat', '会议.md'], ['git', 'status', '--short', '--untracked-files=all']])
  } finally {
    await re?.close().catch(() => undefined)
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('写的时候外面刚好改了同一篇（读完、换上去之前）：不盖掉，外面的改动合并进来，正在打的字也在', async () => {
  const base = '# 旅行\n\n第一段。\n\n第二段。\n'
  const run = await launch({ '旅行.md': base })
  const { app, page, vault } = run
  const file = join(vault, '旅行.md')
  try {
    await openNote(page, '旅行')
    // 下一次存：临时文件刚要建的那一刻，外面（同步盘）改了第二段
    await app.evaluate((_e, file) => {
      type Fn = (...a: unknown[]) => Promise<unknown>
      const fsp = process.getBuiltinModule('node:fs/promises') as unknown as Record<'open' | 'writeFile', Fn>
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      const open = fsp.open
      let once = true
      fsp.open = async (...a: unknown[]) => {
        if (once && /旅行\.md\.cn-\d+-[0-9a-z]+\.tmp$/.test(String(a[0]))) {
          once = false
          fs.writeFileSync(file, '# 旅行\n\n第一段。\n\n第二段，同步过来的改动。\n')
        }
        return open(...a)
      }
    }, file)
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('我在打的字', { delay: 30 })
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('# 旅行\n\n第一段。我在打的字\n\n第二段，同步过来的改动。\n')
    await waitSaved(page)
    expect(temps(vault)).toEqual([])
    expect(readdirSync(vault).filter((n) => n.includes('冲突'))).toEqual([])
  } finally {
    await run.close()
  }
})
