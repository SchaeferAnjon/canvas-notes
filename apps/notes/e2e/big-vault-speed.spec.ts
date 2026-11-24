import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, openNote, pane } from './app'

// 大库提速：机器忙时退出不再拖 10 秒（quit-fast.ts）；换成 GGUF 以后留下的 ONNX 版 bge-m3 挪进废纸篓（search/old-onnx.ts）。

/** 造负载：cpu 数 × 2 个忙循环子进程，跑 ms 毫秒自己停（同一个优先级，像几条测试线一起跑的时候） */
function busy(ms: number): ChildProcess[] {
  const code = `const end = Date.now() + ${ms}; while (Date.now() < end) Math.sqrt(Math.random())`
  return Array.from({ length: cpus().length * 2 }, () => spawn(process.execPath, ['-e', code], { stdio: 'ignore' }))
}

test('机器忙（几十个进程抢 CPU）时 ⌘Q：刚打的字存好、提交好，进程 3 秒内没了（以前常常拖满 10 秒）', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天去了海边。\n' })
  const { page, vault, app } = run
  const loads: ChildProcess[] = []
  try {
    await openNote(page, '日记')
    await pane(page).locator('.cm-line', { hasText: '今天去了海边。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('忙的时候退出')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    loads.push(...busy(8_000))
    await new Promise((r) => setTimeout(r, 1_000))
    const proc = app.process()
    const t = Date.now()
    await run.close({ keep: true })
    const ms = Date.now() - t
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
    const log = readFileSync(join(run.userData, 'quit.log'), 'utf8')
    console.log(`负载下退出用了 ${ms} ms；quit.log：\n${log}`)
    expect(log).toMatch(/before-quit[\s\S]*存完[\s\S]*提交完[\s\S]*cookie 写完[\s\S]*盯着网络进程 \d+[\s\S]*quit/)
    expect(ms).toBeLessThan(3_000)
    expect(readFileSync(join(vault, '日记.md'), 'utf8')).toBe('# 日记\n\n今天去了海边。忙的时候退出\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    for (const p of loads) p.kill()
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('机器忙时退出（网络进程多半被直接杀掉）：刚存的 cookie（软件自己的、内置浏览器的登录）再打开还在', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const loads: ChildProcess[] = []
  try {
    const v = `v${Date.now()}`
    await run.app.evaluate(async ({ session }, v) => {
      for (const s of [session.defaultSession, session.fromPartition('persist:web')])
        await s.cookies.set({ url: 'https://example.com', name: 'cn', value: v, expirationDate: Date.now() / 1000 + 86400 })
    }, v)
    loads.push(...busy(8_000))
    await new Promise((r) => setTimeout(r, 1_000))
    const t = Date.now()
    await run.close({ keep: true })
    console.log(`负载下退出 ${Date.now() - t} ms`)
    expect(readFileSync(join(run.userData, 'quit.log'), 'utf8')).toContain('cookie 写完')
    for (const p of loads.splice(0)) p.kill()
    // 同一个库、同一个设置目录再开
    const again = await launch({ '没用的.md': '# 没用的\n' }, { CN_USER_DATA: run.userData, CN_VAULT: run.vault })
    try {
      const got = await again.app.evaluate(async ({ session }) =>
        Promise.all([session.defaultSession, session.fromPartition('persist:web')].map(async (s) => (await s.cookies.get({ name: 'cn' }))[0]?.value ?? null)),
      )
      expect(got).toEqual([v, v])
    } finally {
      await again.close()
    }
  } finally {
    for (const p of loads) p.kill()
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('换成 GGUF 以后留下的 ONNX 版 bge-m3：打开一会儿后挪进废纸篓，GGUF 那份不动', async () => {
  const models = mkdtempSync(join(tmpdir(), 'cn-models-'))
  const sized = (rel: string, size: number) => {
    mkdirSync(dirname(join(models, rel)), { recursive: true })
    const fd = openSync(join(models, rel), 'w')
    ftruncateSync(fd, size)
    closeSync(fd)
  }
  // 当年钉死的大小（稀疏文件，不真占盘）
  sized('onnx/model_quantized.onnx', 569694530)
  sized('tokenizer.json', 17082821)
  sized('tokenizer_config.json', 1173)
  sized('config.json', 770)
  sized('bge-m3-q8_0.gguf', 1000)
  writeFileSync(join(models, 'verified.json'), '{}')
  const run = await launch({ 'a.md': '# a\n' }, { CN_EMBED_DIR: models, CN_OLD_ONNX_DELAY_MS: '300' })
  try {
    await expect.poll(() => readdirSync(run.trash).map((f) => f.replace(/^\d+-/, '')).sort(), { timeout: 15_000 }).toEqual(['config.json', 'onnx', 'tokenizer.json', 'tokenizer_config.json'])
    expect(readdirSync(models).sort()).toEqual(['bge-m3-q8_0.gguf', 'verified.json'])
    expect(existsSync(join(run.trash, readdirSync(run.trash).find((f) => f.endsWith('-onnx'))!, 'model_quantized.onnx'))).toBe(true)
  } finally {
    await run.close()
    rmSync(models, { recursive: true, force: true })
  }
})
