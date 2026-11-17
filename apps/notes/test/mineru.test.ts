/**
 * PDF 精读增强（MinerU）的主进程部分：找已有安装的顺序、版本判断、后台解析（假的 mineru-kit）、失败退回、装（假的 uv）。
 * 不碰本机真的 ~/.mineru-venv：「~」一律是临时目录。
 */
import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIDDLE } from '../../../packages/format/test/mineru-fixture'
import { convertMiddle } from '../src/main/mineru/convert'
import { candidates, check, type FindEnv, findMineru, parseVersion, realFindEnv, versionOk } from '../src/main/mineru/find'
import { commandOf, installError, MineruInstaller } from '../src/main/mineru/install'
import { parseTqdm } from '../src/main/mineru/proc'
import { MineruRunner, type ParseJob, parseArgs, parseTimeout } from '../src/main/mineru/run'
import { stageName } from '../src/shared/mineru'

const FIX = join(__dirname, '../e2e/fixtures')
const root = mkdtempSync(join(tmpdir(), 'cn-mineru-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 一个临时的「~」，里面放好假的 mineru-kit（和模型） */
function fakeHome(o: { at?: string; models?: boolean } = {}) {
  const home = mkdtempSync(join(root, 'home-'))
  const kit = join(home, o.at ?? '.mineru-venv/bin/mineru-kit')
  mkdirSync(join(kit, '..'), { recursive: true })
  copyFileSync(join(FIX, 'fake-mineru-kit.sh'), kit)
  chmodSync(kit, 0o755)
  if (o.models !== false) {
    mkdirSync(join(home, '.mineru/models'), { recursive: true })
    writeFileSync(join(home, '.mineru/models/basic.ok'), '')
  }
  return { home, kit }
}

describe('版本', () => {
  it('从 --version 的输出里认出版本', () => {
    expect(parseVersion('MinerU version: 4.0.12\nPython version: 3.12.15')).toBe('4.0.12')
    expect(parseVersion('mineru-kit, version 4.2.3')).toBe('4.2.3')
    expect(parseVersion('command not found')).toBeNull()
  })
  it('4.0.12 ≤ v < 5', () => {
    expect(['4.0.12', '4.0.13', '4.2.3', '4.10.0'].every(versionOk)).toBe(true)
    expect(['4.0.11', '3.1.0', '5.0.0', '5.1'].some(versionOk)).toBe(false)
  })
})

describe('找已有的 MinerU', () => {
  const env = (over: Partial<FindEnv> & { files?: Record<string, string> }): FindEnv => ({
    home: '/H',
    shell: false,
    exists: (p) => p in (over.files ?? {}),
    readText: (p) => over.files?.[p] ?? null,
    run: async (cmd, args) => {
      const v = over.files?.[cmd]
      if (v === undefined) return { code: null, out: 'ENOENT' }
      if (args[0] === '--version') return { code: 0, out: `MinerU version: ${v.split(' ')[0]}` }
      return { code: v.includes('nomodels') ? 1 : 0, out: '' }
    },
    ...over,
  })
  const PR = '/H/Library/Application Support/ParaRead'

  it('顺序：① 自己设置的路径 ② ParaRead 设置里的 ③ ~/.mineru-venv ④ ParaRead 装的那份；同一个文件只试一次', () => {
    const files = { [`${PR}/settings.json`]: JSON.stringify({ mineruPath: '~/.mineru-venv/bin/mineru-kit' }) }
    expect(candidates(env({ own: '/opt/mk', files })).map((c) => c.path)).toEqual(['/opt/mk', '/H/.mineru-venv/bin/mineru-kit', `${PR}/mineru/venv/bin/mineru-kit`])
    expect(candidates(env({ files: { [`${PR}/settings.json`]: JSON.stringify({ mineruPath: '/x/kit' }) } })).map((c) => c.from)).toEqual(['ParaRead 设置里的路径', '~/.mineru-venv', 'ParaRead 装的那份'])
    // ParaRead 的设置文件坏了不影响找别处
    expect(candidates(env({ files: { [`${PR}/settings.json`]: '{oops' } })).map((c) => c.path)).toEqual(['/H/.mineru-venv/bin/mineru-kit', `${PR}/mineru/venv/bin/mineru-kit`])
  })

  it('找到第一个能用的就用；版本不对、缺模型的跳过去', async () => {
    const files = { '/opt/mk': '3.1.0', '/H/.mineru-venv/bin/mineru-kit': '4.0.12 nomodels', [`${PR}/mineru/venv/bin/mineru-kit`]: '4.2.3' }
    expect(await findMineru(env({ own: '/opt/mk', files }))).toEqual({ state: 'ready', path: `${PR}/mineru/venv/bin/mineru-kit`, version: '4.2.3', from: 'ParaRead 装的那份' })
  })

  it('都不能用：报第一个的原因（不当成没装，不替别人重装）', async () => {
    const f = await findMineru(env({ files: { '/H/.mineru-venv/bin/mineru-kit': '5.0.1' } }))
    expect(f).toMatchObject({ state: 'bad', path: '/H/.mineru-venv/bin/mineru-kit' })
    expect(f.state === 'bad' && f.reason).toMatch(/~\/\.mineru-venv的 MinerU 版本是 5\.0\.1，要 4\.0\.12 以上、5 以下/)
    const m = await findMineru(env({ files: { '/H/.mineru-venv/bin/mineru-kit': '4.0.12 nomodels' } }))
    expect(m.state === 'bad' && m.reason).toMatch(/缺识别模型/)
  })

  it('哪都没有就是没装；第 ⑤ 步问登录 shell 的 PATH', async () => {
    expect(await findMineru(env({}))).toEqual({ state: 'missing' })
    const files = { '/usr/local/bin/mineru-kit': '4.1.0' }
    const run: FindEnv['run'] = async (cmd, args) =>
      cmd === '/bin/zsh' ? { code: 0, out: '/usr/local/bin/mineru-kit\n' } : args[0] === '--version' ? { code: 0, out: 'MinerU version: 4.1.0' } : { code: 0, out: '' }
    expect(await findMineru(env({ shell: true, files, run }))).toMatchObject({ state: 'ready', path: '/usr/local/bin/mineru-kit', from: 'PATH 里的 mineru-kit' })
  })

  it('真的跑一遍假的 mineru-kit：--version 和 models verify（30 秒超时）', async () => {
    const { home, kit } = fakeHome()
    const e = realFindEnv({ home, shell: false })
    expect(await check(e, kit)).toEqual({ ok: true, version: '4.2.3' })
    expect(await findMineru(e)).toMatchObject({ state: 'ready', path: kit, from: '~/.mineru-venv' })
    rmSync(join(home, '.mineru/models/basic.ok'))
    expect(await check(e, kit)).toEqual({ ok: false, reason: '缺识别模型（models verify 没过）' })
    expect(await check(e, join(home, 'nope'))).toEqual({ ok: false, reason: '跑不起来（启动不了）' })
  })
})

describe('后台解析', () => {
  let pdf: string
  let middle: string
  beforeAll(() => {
    pdf = join(root, 'a.pdf')
    writeFileSync(pdf, '%PDF-1.4 fake')
    middle = join(root, 'middle.json')
    writeFileSync(middle, JSON.stringify(MIDDLE))
  })

  function runOnce(o: { home: string; kit: string; env?: Record<string, string>; timeoutMs?: number }) {
    const old = { ...process.env }
    Object.assign(process.env, { CN_FAKE_MIDDLE: middle, CN_FAKE_MINERU_SLEEP: '0.05' }, o.env ?? {})
    const events: string[] = []
    return new Promise<{ ok: boolean; error?: string; events: string[]; job: ParseJob }>((res) => {
      const job: ParseJob = { key: 'abc', pdf, pages: 6, out: join(o.home, 'out', 'abc.4.2.3.basic.json') }
      const r = new MineruRunner({
        command: () => o.kit,
        tmpRoot: join(o.home, 'tmp'),
        home: o.home,
        ...(o.timeoutMs ? { timeoutMs: () => o.timeoutMs! } : {}),
        onProgress: (_j, p) => events.push(`${p.status}${p.stage ? ` ${p.stage} ${p.percent}` : ''}`),
        onDone: () => res({ ok: true, events, job }),
        onFailed: (_j, error) => res({ ok: false, error, events, job }),
      })
      r.enqueue(job)
      r.enqueue(job) // 同一份只排一次
    }).finally(() => {
      process.env = old
    })
  }

  it('参数：middle_json、basic、-v，永远不加 --remote；超时 60 秒 + 每页 10 秒', () => {
    expect(parseArgs('/a.pdf', '/t/middle.json')).toEqual(['parse', '/a.pdf', '-o', '/t/middle.json', '-f', 'middle_json', '--tier', 'basic', '-v'])
    expect(parseArgs('/a.pdf', '/t/m.json').join(' ')).not.toMatch(/remote/)
    expect(parseTimeout(12)).toBe(180_000)
  })

  it('读 tqdm 进度；步骤名换成中文', () => {
    expect(parseTqdm('Layout Predict:  50%|#####     | 1/2\rOCR-det:  53%|█▎ | 8/15')).toEqual({ stage: 'OCR-det', percent: 53 })
    expect(['Loading weights', 'Layout Predict', 'OCR-det', 'Table-rec', 'MFR Predict', 'xyz'].map(stageName)).toEqual(['载入模型', '认版面', '认字', '认表格', '认公式', '识别中'])
  })

  it('跑完：结果存到指定的地方、临时目录删掉；进度一步步报上来；只用本机模型', async () => {
    const { home, kit } = fakeHome()
    const r = await runOnce({ home, kit })
    expect(r.ok).toBe(true)
    expect(JSON.parse(readFileSync(r.job.out, 'utf8')).schema).toBe('docvortex.middle')
    expect(r.events[0]).toBe('queued')
    expect(r.events).toContain('running Layout Predict 50')
    expect(r.events.filter((e) => e === 'queued')).toHaveLength(1)
    expect(existsSync(join(home, 'tmp')) && execSync(`ls "${join(home, 'tmp')}"`).toString().trim()).toBe('')
    expect(readFileSync(join(home, 'mineru-parse.log'), 'utf8')).toMatch(/^parse .*a\.pdf -o .*middle\.json -f middle_json --tier basic -v\n$/)
  })

  it('退出码非 0：报退出码和最后一行', async () => {
    const { home, kit } = fakeHome()
    const r = await runOnce({ home, kit, env: { CN_FAKE_MINERU_FAIL: 'exit' } })
    expect(r).toMatchObject({ ok: false, error: '退出码 3：RuntimeError: out of memory' })
    expect(existsSync(r.job.out)).toBe(false)
  })

  it('超时：整组杀掉（连它起的子进程），报超时', async () => {
    const { home, kit } = fakeHome()
    const t0 = Date.now()
    const r = await runOnce({ home, kit, env: { CN_FAKE_MINERU_FAIL: 'hang' }, timeoutMs: 1500 })
    expect(r).toMatchObject({ ok: false, error: '超时：2 秒没解析完' })
    expect(Date.now() - t0).toBeLessThan(8000)
    // 假的 mineru-kit 里的 sleep 600 也没了
    await new Promise((res) => setTimeout(res, 300))
    expect(execFileSync('ps', ['-A', '-o', 'command=']).toString()).not.toMatch(/sleep 600/)
  })

  it('找不到命令：报启动不了', async () => {
    const { home } = fakeHome()
    const r = await runOnce({ home, kit: join(home, 'nope') })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^启动不了/)
  })
})

describe('结果换成块（失败的都抛错，界面照常用 pdf.js）', () => {
  it('好的 middle_json → m1 缓存（每页块 + 页面大小 + 版本）', () => {
    const c = convertMiddle(JSON.stringify(MIDDLE), { pdf: '课程/a.pdf', pages: 6, version: '4.2.3' })
    expect(c.pages).toHaveLength(6)
    expect(c.pages[4]![0]).toMatchObject({ kind: 'table', by: 'mineru' })
    expect(c).toMatchObject({ pdf: '课程/a.pdf', mineru: '4.2.3' })
  })
  it('JSON 坏了、不是 middle_json、一块也没有：抛错', () => {
    expect(() => convertMiddle('{"pages": [', { pdf: 'a.pdf', pages: 1, version: '' })).toThrow(/不是完整的 JSON/)
    expect(() => convertMiddle('{"x": 1}', { pdf: 'a.pdf', pages: 1, version: '' })).toThrow(/不是 middle_json/)
    expect(() => convertMiddle('{"pages": [{"page_idx": 0, "blocks": [{"type": "footer", "bbox": [0,0,1,1], "content": "x"}]}]}', { pdf: 'a.pdf', pages: 1, version: '' })).toThrow(/一块也没认出来/)
  })
})

describe('装（假的 uv，装进临时的「~」）', () => {
  let server: Server
  let url = ''
  let hits = 0
  beforeAll(async () => {
    // uv 的下载：tar.gz 里一层文件夹 uv-<arch>-apple-darwin/uv，和官方发布的一样
    const name = `uv-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
    const dir = mkdtempSync(join(root, 'uvpkg-'))
    mkdirSync(join(dir, name))
    copyFileSync(join(FIX, 'fake-uv.sh'), join(dir, name, 'uv'))
    chmodSync(join(dir, name, 'uv'), 0o755)
    execFileSync('/usr/bin/tar', ['-czf', join(dir, 'uv.tar.gz'), '-C', dir, name])
    const tgz = readFileSync(join(dir, 'uv.tar.gz'))
    server = createServer((_req, res) => {
      hits++
      res.writeHead(200, { 'content-length': tgz.length, 'content-type': 'application/gzip' })
      res.end(tgz)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/uv.tar.gz`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('四步：下载 uv → 建 ~/.mineru-venv（Python 在 ~/.mineru/python）→ 装 mineru==4.2.3（缓存装完删）→ 下载模型；进度一路往上', async () => {
    const home = mkdtempSync(join(root, 'inst-'))
    const dir = join(home, 'appdata', 'mineru')
    process.env.CN_FAKE_MINERU_KIT = join(FIX, 'fake-mineru-kit.sh')
    process.env.CN_MINERU_WATCH_MS = '100'
    const states: string[] = []
    const pcts: number[] = []
    const inst = new MineruInstaller({ dir, home, uvUrl: url }, (s) => {
      if (states[states.length - 1] !== s.phase) states.push(s.phase)
      pcts.push(s.percent)
    })
    const cmd = await inst.start()
    expect(cmd).toBe(commandOf(home))
    expect(cmd).toBe(join(home, '.mineru-venv/bin/mineru-kit'))
    expect(states).toEqual(['uv', 'python', 'packages', 'models', 'done'])
    expect(pcts.every((p, i) => i === 0 || p >= pcts[i - 1]!)).toBe(true)
    expect(pcts[pcts.length - 1]).toBe(100)
    expect(existsSync(join(home, '.mineru/python/cpython-3.12-macos'))).toBe(true)
    expect(existsSync(join(home, '.mineru/models/basic.ok'))).toBe(true)
    expect(existsSync(join(dir, 'cache'))).toBe(false)
    expect(existsSync(join(dir, 'installing'))).toBe(false)
    expect(readFileSync(join(home, 'uv.log'), 'utf8')).toMatch(/^venv --python 3\.12 .*\.mineru-venv\npip install --python .*\.mineru-venv\/bin\/python mineru==4\.2\.3\n$/)
    // 装好的这份找得到、能用
    expect(await findMineru(realFindEnv({ home, shell: false }))).toMatchObject({ state: 'ready', version: '4.2.3' })
  })

  it('中途停下：状态回到没装、记着装到一半；再点接着装（uv 不重新下载），装完记号删掉', async () => {
    const home = mkdtempSync(join(root, 'inst-'))
    const dir = join(home, 'appdata', 'mineru')
    process.env.CN_FAKE_MINERU_KIT = join(FIX, 'fake-mineru-kit.sh')
    process.env.CN_FAKE_UV_SLEEP = '0.5'
    let inst!: MineruInstaller
    inst = new MineruInstaller({ dir, home, uvUrl: url }, (s) => {
      if (s.phase === 'packages' && s.line.startsWith('Downloading')) inst.stop()
    })
    const before = hits
    expect(await inst.start()).toBeNull()
    expect(inst.state.phase).toBe('none')
    expect(existsSync(join(dir, 'installing'))).toBe(true)
    expect(hits).toBe(before + 1)
    delete process.env.CN_FAKE_UV_SLEEP
    const again = new MineruInstaller({ dir, home, uvUrl: url }, () => {})
    expect(await again.start()).toBe(commandOf(home))
    expect(hits).toBe(before + 1)
    expect(existsSync(join(dir, 'installing'))).toBe(false)
  })

  it('没装成：报哪一步、最后几行输出', async () => {
    const home = mkdtempSync(join(root, 'inst-'))
    process.env.CN_FAKE_UV_FAIL = 'pip'
    const inst = new MineruInstaller({ dir: join(home, 'd'), home, uvUrl: url }, () => {})
    await expect(inst.start()).rejects.toThrow(/uv pip 退出码 1：error: Failed to download torch/)
    expect(inst.state).toMatchObject({ phase: 'failed' })
    // 界面上那句不是英文原话：下载包时没网，说检查网络
    expect(inst.state.error).toBe('下载不下来：检查网络后点「重试」')
    delete process.env.CN_FAKE_UV_FAIL
  })

  it('没网（uv 的下载地址连不上）：界面上一句「下载不下来：检查网络后点「重试」」，不是 fetch failed', async () => {
    const home = mkdtempSync(join(root, 'inst-'))
    const inst = new MineruInstaller({ dir: join(home, 'd'), home, uvUrl: 'http://127.0.0.1:9/uv.tar.gz' }, () => {})
    await expect(inst.start()).rejects.toThrow('下载不下来：检查网络后点「重试」')
    expect(inst.state).toMatchObject({ phase: 'failed', error: '下载不下来：检查网络后点「重试」' })
  })

  it('不是网络的错照原话说', () => {
    expect(installError('mineru-kit models 退出码 2：磁盘满了')).toBe('mineru-kit models 退出码 2：磁盘满了')
    expect(installError('error sending request for url (https://pypi.org/simple/torch/)')).toBe('下载不下来：检查网络后点「重试」')
  })
})
