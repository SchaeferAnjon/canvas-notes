/**
 * 量「导入 Obsidian 库」（2026-11-26 导入卡死）：照用户的路径，新建一个空文件夹当库、⌘K「导入旧笔记…」选 Markdown 文件夹、点导入，
 * 一边导一边每秒量：每个进程用了多少 CPU（按 ps 的累计 CPU 时间算，不是 ps 的 %CPU 那个衰减平均）、主进程事件循环最长卡多久、
 * 界面回一次话要多久；每个 git 子进程的命令行、起止时间、CPU（PATH 里垫一个 git，转给 /usr/bin/git，记一行）。
 * 导完再接着量一会儿（看导完以后还在不在忙）。测试模式（CN_E2E=1）窗口不上屏；设置目录、库都在临时目录；
 * git 全局配置换成临时文件（不带这台 Mac 的全局钩子，和一台普通的 Mac 一样）。
 * CN_PKG=<Canvas Notes.app> 量打好的包（比如 0.5.14 正式包），不给量这份代码构建的 out/。
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

export interface GitCall {
  start: number
  end: number
  rc: number
  cpu: number
  cwd: string
  args: string
}

export interface Sample {
  /** 从点「导入」算起的秒数（点之前是负的） */
  t: number
  /** 每类进程用了几个核（这一秒里） */
  cores: Record<string, number>
  total: number
}

export interface Measured {
  label: string
  /** 这台机器测量时的负载（uptime 的 1 分钟平均） */
  load: string[]
  scanMs: number
  importMs: number
  /** 「在提交」那一段（主进程报 committing 到报 done） */
  commitMs: number | null
  phases: { t: number; phase: string; done?: number; total?: number; step?: string }[]
  /** 主进程事件循环：超过 50 ms 的卡顿（[从点导入算起的毫秒, 卡了多久]） */
  mainLags: [number, number][]
  mainMaxLagMs: number
  /** 界面回一次话最慢多久（page.evaluate 来回） */
  rendererMaxRoundtripMs: number
  samples: Sample[]
  git: { total: number; byCmd: Record<string, { n: number; ms: number; cpu: number; fail: number }>; longest: GitCall[] }
  /** 导完以后（settle 那一段）git 又跑了几次、CPU 什么时候回落 */
  after: { gitCalls: number; settledAt: number | null; cpuAvg: number }
  vault: { obsidianCopied: boolean; gitPointerCopied: boolean; gitWorks: boolean; commits: number; uncommitted: number; trashCopied: boolean }
  errors: string[]
}

const cpuSec = (s: string) => {
  // ps 的 time：[[dd-]hh:]mm:ss.cc
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s]
  const parts = rest!.split(':').map(Number)
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return Number(d) * 86400 + sec
}

function kindOf(cmd: string): string {
  if (/\bgit\b|\/git |zsh .*\/git$|\/usr\/bin\/time/.test(cmd) && !/Helper|Electron|Canvas Notes\.app\/Contents\/MacOS/.test(cmd)) return 'git'
  if (/--type=renderer/.test(cmd)) return 'renderer'
  if (/--type=gpu-process/.test(cmd)) return 'gpu'
  // 网络进程、搜索进程（Node 子进程，NodeService）等：按 --utility-sub-type 分
  const svc = /搜索索引|生长图|找像的笔记/.exec(cmd)
  if (svc) return svc[0]
  if (/--type=utility/.test(cmd)) return /--utility-sub-type=network\./.test(cmd) ? 'network' : /--utility-sub-type=node\./.test(cmd) ? 'node' : 'utility'
  if (/Helper/.test(cmd)) return 'helper'
  return 'main'
}

export async function measureImport(o: {
  label: string
  /** 要导入的文件夹（样本库或用户真库的副本） */
  src: string
  /** 导完以后再量几秒 */
  settleSec?: number
  /** 存结果、截图的文件夹 */
  outDir?: string
  /** 截图（真库别截：会露出用户的笔记） */
  shots?: boolean
  env?: Record<string, string>
  /** 导的途中做点什么（点「停下」） */
  during?: (r: { app: ElectronApplication; page: Page; vault: string }) => Promise<void>
  /** 选好文件夹、还没点导入时看一眼第二步（窗口 locator） */
  onScan?: (sheet: ReturnType<Page['getByRole']>) => Promise<void>
  /** 等不等导完（测「停下」时不等） */
  expectDone?: boolean
}): Promise<Measured & { root: string; dir: string; page: Page; app: ElectronApplication; close(): Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'cn-imp-'))
  const vault = join(root, '导入目标')
  const userData = join(root, 'user-data')
  const trash = join(root, 'trash')
  const bin = join(root, 'bin')
  const gitlog = join(root, 'git.log')
  for (const d of [vault, trash, bin]) mkdirSync(d, { recursive: true })
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = false\n')
  writeFileSync(gitlog, '')
  // 垫一个 git：转给 /usr/bin/git（用户那台 Mac 从访达打开拿到的就是它），记下起止时间、退出码、CPU、在哪个文件夹、命令行
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/zsh
zmodload zsh/datetime
s=$EPOCHREALTIME
tf=$(/usr/bin/mktemp -t cngit)
/usr/bin/time -p -o "$tf" /usr/bin/git "$@"
rc=$?
e=$EPOCHREALTIME
cpu=$(/usr/bin/awk '/^(user|sys)/{s+=$2} END{print s+0}' "$tf")
/bin/rm -f "$tf"
a="\${(j: :)@}"
a="\${a//$'\\n'/⏎}"
print -r -- "$s	$e	$rc	$cpu	$PWD	$a" >> ${JSON.stringify(gitlog)}
exit $rc
`,
  )
  chmodSync(join(bin, 'git'), 0o755)
  const load = () => execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim().replace(/[{}]/g, '').trim()
  const loads = [load()]

  const app = await electron.launch({
    executablePath: process.env.CN_PKG ? join(process.env.CN_PKG, 'Contents/MacOS/Canvas Notes') : (electronPath as unknown as string),
    args: process.env.CN_PKG ? [] : [join(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      CN_VAULT: vault,
      CN_USER_DATA: userData,
      CN_E2E: '1',
      CN_NO_AX: '1',
      CN_QUICK_KEY: 'Alt+Command+Shift+F19',
      CN_TRASH_DIR: trash,
      CN_ICLOUD_CONTAINER: join(root, 'icloud'),
      CN_IMPORT_DIR: o.src,
      // AI 一律假的：梦游、整理会把库里的句子发给 AI，量测用的库（尤其用户真库的副本）不能出这台电脑
      CN_AI_FAKE: '1',
      ...o.env,
    },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`界面 Uncaught：${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`界面 console.error：${m.text().slice(0, 300)}`))
  app.process().stderr?.on('data', (b: Buffer) => {
    const s = b.toString()
    if (/Error|Uncaught|ENOENT|失败/.test(s)) errors.push(`主进程：${s.trim().slice(0, 300)}`)
  })
  await expect(page.locator('.vault b')).toHaveText('导入目标', { timeout: 60_000 })
  const pid = app.process().pid!

  // 主进程事件循环：每 20 ms 一跳，晚到超过 50 ms 记一笔
  await app.evaluate(() => {
    const g = globalThis as unknown as { __lag: [number, number][] }
    g.__lag = []
    let last = performance.now()
    setInterval(() => {
      const now = performance.now()
      const d = now - last - 20
      if (d > 50) g.__lag.push([Date.now(), Math.round(d)])
      last = now
    }, 20)
  })
  // 界面：主进程报的每一步（导入进度）记下时间
  await page.evaluate(() => {
    const w = window as unknown as { __imp: unknown[]; cnImport: { onProgress(cb: (p: unknown) => void): void } }
    w.__imp = []
    w.cnImport.onProgress((p) => {
      const x = p as { phase: string; done?: number; total?: number; step?: string }
      w.__imp.push({ at: Date.now(), phase: x.phase, done: x.done, total: x.total, step: x.step })
    })
  })

  // 每秒量一次这棵进程树
  let t0 = Date.now()
  const samples: Sample[] = []
  const prev = new Map<number, number>()
  let sampling = true
  let lastAt = Date.now()
  const sampleOnce = () =>
    new Promise<void>((res) =>
      execFile('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
        if (err) return res()
        const now = Date.now()
        const rows = out.split('\n').map((l) => {
          const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)
          return m ? { pid: Number(m[1]), ppid: Number(m[2]), cpu: cpuSec(m[3]!), cmd: m[4]! } : null
        })
        const kids = new Map<number, number[]>()
        for (const r of rows) if (r) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid])
        const mine = new Set<number>([pid])
        const q = [pid]
        while (q.length) for (const k of kids.get(q.pop()!) ?? []) if (!mine.has(k)) (mine.add(k), q.push(k))
        const dt = (now - lastAt) / 1000
        lastAt = now
        const cores: Record<string, number> = {}
        for (const r of rows) {
          if (!r || !mine.has(r.pid)) continue
          const before = prev.get(r.pid)
          prev.set(r.pid, r.cpu)
          // 这一秒里新起的进程（git）：整个累计都算这一秒的
          const used = before === undefined ? (r.pid === pid ? 0 : r.cpu) : r.cpu - before
          const k = kindOf(r.cmd)
          cores[k] = (cores[k] ?? 0) + used / dt
        }
        const total = Object.values(cores).reduce((a, b) => a + b, 0)
        samples.push({ t: Math.round((now - t0) / 100) / 10, cores: Object.fromEntries(Object.entries(cores).map(([k, v]) => [k, Math.round(v * 100) / 100])), total: Math.round(total * 100) / 100 })
        res()
      }),
    )
  const loop = (async () => {
    while (sampling) {
      const at = Date.now()
      await sampleOnce()
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - at))))
    }
  })()
  // 界面回话：每 500 ms 问一次，记最慢的
  let rtMax = 0
  let probing = true
  const probe = (async () => {
    while (probing) {
      const at = Date.now()
      await page.evaluate(() => 1).catch(() => undefined)
      rtMax = Math.max(rtMax, Date.now() - at)
      await new Promise((r) => setTimeout(r, 500))
    }
  })()

  // 等打开库那一阵忙完（建分类、首次提交、搜索进程起来）再开始
  await page.waitForTimeout(8000)
  const sheet = page.getByRole('dialog', { name: '导入旧笔记' })
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
  await page.getByRole('option', { name: /导入旧笔记…/ }).click()
  let at = Date.now()
  await sheet.getByRole('button', { name: /^Markdown文件夹/ }).click()
  const go = sheet.getByRole('button', { name: /^导入\d+篇$/ })
  await expect(go).toBeVisible({ timeout: 10 * 60_000 })
  const scanMs = Date.now() - at
  if (o.onScan) await o.onScan(sheet)
  if (o.shots && o.outDir) await page.screenshot({ path: join(o.outDir, `${o.label}-1-选文件夹.png`) })
  t0 = Date.now()
  at = Date.now()
  const gitBefore = readFileSync(gitlog, 'utf8').split('\n').filter(Boolean).length
  await go.click()
  let shotN = 0
  const shooter =
    o.shots && o.outDir
      ? setInterval(() => {
          void page.screenshot({ path: join(o.outDir!, `${o.label}-2-导入中-${String(++shotN).padStart(2, '0')}.png`) }).catch(() => undefined)
        }, 3000)
      : undefined
  if (o.during) await o.during({ app, page, vault })
  let importMs = 0
  if (o.expectDone !== false) {
    // 导完（结果）或没导成（红字）都算结束：0.5.14 上导到一半被自动提交抢了锁会报「没导成」
    await expect(sheet.getByTestId('import-result').or(sheet.getByRole('alert'))).toBeVisible({ timeout: 40 * 60_000 })
    importMs = Date.now() - at
    if (await sheet.getByRole('alert').isVisible()) errors.push(`导入没成：${(await sheet.getByRole('alert').textContent())?.slice(0, 300)}`)
  }
  clearInterval(shooter)
  if (o.shots && o.outDir) await page.screenshot({ path: join(o.outDir, `${o.label}-3-导好了.png`) })
  loads.push(load())
  const doneAt = Date.now()
  const gitAtDone = readFileSync(gitlog, 'utf8').split('\n').filter(Boolean).length
  // 导完接着量：等 CPU 连续 10 秒低于 0.3 个核，最多 settleSec 秒
  const settleSec = o.settleSec ?? 90
  let settledAt: number | null = null
  for (let i = 0; i < settleSec; i++) {
    await page.waitForTimeout(1000)
    const last10 = samples.filter((s) => s.t * 1000 >= doneAt - t0).slice(-10)
    if (last10.length === 10 && last10.every((s) => s.total < 0.3)) {
      settledAt = Math.round(((doneAt - t0) / 1000 + i - 9) * 10) / 10
      break
    }
  }
  if (o.shots && o.outDir) await page.screenshot({ path: join(o.outDir, `${o.label}-4-导完以后.png`) })
  loads.push(load())
  sampling = false
  probing = false
  await Promise.all([loop, probe])

  const phases = ((await page.evaluate(() => (window as unknown as { __imp: { at: number; phase: string; done?: number; total?: number; step?: string }[] }).__imp)) ?? []).map((p) => ({ ...p, t: Math.round((p.at - t0) / 100) / 10 }))
  const lags = ((await app.evaluate(() => (globalThis as unknown as { __lag: [number, number][] }).__lag)) ?? []).filter(([t]) => t >= t0).map(([t, d]) => [t - t0, d] as [number, number])
  const committing = phases.find((p) => p.phase === 'committing')
  const done = phases.find((p) => p.phase === 'done')

  const calls: GitCall[] = readFileSync(gitlog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [s, e, rc, cpu, cwd, ...rest] = l.split('\t')
      return { start: Math.round(Number(s) * 1000 - t0), end: Math.round(Number(e) * 1000 - t0), rc: Number(rc), cpu: Number(cpu), cwd: cwd!, args: rest.join('\t') }
    })
  const importCalls = calls.slice(gitBefore)
  const byCmd: Measured['git']['byCmd'] = {}
  for (const c of importCalls) {
    const cmd = c.args.replace(/^(-c \S+ )+/, '').split(' ')[0] || '?'
    const b = (byCmd[cmd] ??= { n: 0, ms: 0, cpu: 0, fail: 0 })
    b.n++
    b.ms += c.end - c.start
    b.cpu += c.cpu
    if (c.rc) b.fail++
  }
  for (const b of Object.values(byCmd)) b.cpu = Math.round(b.cpu * 100) / 100
  const afterSamples = samples.filter((s) => s.t * 1000 >= doneAt - t0)

  const git = (...a: string[]) => {
    try {
      return execFileSync('/usr/bin/git', ['-C', vault, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } })
    } catch {
      return null
    }
  }
  // 库里有没有别处来的 .git（指针文件或文件夹，库根自己那个仓库除外）
  const strayGit = execFileSync('/usr/bin/find', [vault, '-mindepth', '1', '-name', '.git', '-not', '-path', join(vault, '.git')], { encoding: 'utf8' }).trim()
  const rootGitIsDir = existsSync(join(vault, '.git', 'HEAD'))
  const m: Measured = {
    label: o.label,
    load: loads,
    scanMs,
    importMs,
    commitMs: committing && done ? Math.round((done.t - committing.t) * 1000) : null,
    phases: phases.filter((p, i, a) => i === 0 || p.phase !== a[i - 1]!.phase || p.phase !== a[i + 1]?.phase || i % 50 === 0).map(({ t, phase, done, total, step }) => ({ t, phase, done, total, step })),
    mainLags: lags,
    mainMaxLagMs: Math.max(0, ...lags.map(([, d]) => d)),
    rendererMaxRoundtripMs: rtMax,
    samples,
    git: { total: importCalls.length, byCmd, longest: [...importCalls].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 12) },
    after: { gitCalls: calls.length - gitAtDone, settledAt, cpuAvg: Math.round((afterSamples.reduce((s, x) => s + x.total, 0) / Math.max(1, afterSamples.length)) * 100) / 100 },
    vault: {
      obsidianCopied: !!execFileSync('/usr/bin/find', [vault, '-name', '.obsidian'], { encoding: 'utf8' }).trim(),
      gitPointerCopied: !rootGitIsDir || !!strayGit,
      gitWorks: git('rev-parse', 'HEAD') !== null,
      commits: Number(git('rev-list', '--count', 'HEAD')?.trim() ?? 0),
      uncommitted: (git('status', '--porcelain', '--untracked-files=all') ?? '').split('\n').filter(Boolean).length,
      trashCopied: existsSync(join(vault, '.trash')),
    },
    errors,
  }
  if (o.outDir) writeFileSync(join(o.outDir, `${o.label}.json`), JSON.stringify(m, null, 1))
  return {
    ...m,
    root,
    dir: vault,
    page,
    app,
    async close() {
      await app.close().catch(() => undefined)
    },
  }
}
