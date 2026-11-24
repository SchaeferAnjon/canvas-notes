// 退出时盯着网络进程的小 sh（quit-fast.ts，大库提速）：到点主进程还在，就杀这个软件的网络进程（Chromium 重起的、成了孤儿的也杀）；
// 别的设置目录的、主进程还在时不是网络进程的不碰；主进程没了以后它的孤儿扫 1 秒
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { killNetworkLater } from '../src/main/quit-fast'

const MARK = '--utility-sub-type=network.mojom.NetworkService'
// 设置目录里带空格和正则里有意思的字（真的设置目录在 Application Support 里）
const dir = mkdtempSync(join(tmpdir(), 'cn-quit fast (ud)+'))
const UD = join(dir, 'user data')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** 像 Chromium 收尾时的网络进程：一直闲着不退，命令行和真的一样带子类型和设置目录（这个测试进程的子进程） */
const fakeNet = (args: string[] = ['--type=utility', MARK, `--user-data-dir=${UD}`, '--shared-files']) =>
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', ...args], { stdio: 'ignore' })
/** 成了孤儿的进程（父进程是 1，默认像网络进程）：中间隔一层马上退的 sh；回它的 pid */
const orphanNet = (args: string[] = ['--type=utility', MARK, `--user-data-dir=${UD}`]) => {
  const out = join(dir, `pid-${Math.random()}`)
  const sh = spawn('/bin/sh', ['-c', `"${process.execPath}" -e 'setTimeout(() => {}, 30000)' -- ${args.map((a) => `'${a}'`).join(' ')} & echo $! > '${out}'`], { stdio: 'ignore' })
  return new Promise<number>((r) => sh.once('exit', () => r(Number(readFileSync(out, 'utf8').trim()))))
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const exited = (p: ChildProcess) => new Promise<string | null>((r) => (p.exitCode !== null || p.signalCode !== null ? r(p.signalCode) : p.once('exit', (_c, sig) => r(sig))))
const gone = (p: ChildProcess) => new Promise<void>((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', () => r())))
const until = async (f: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  return f()
}

it('到点主进程还在：这个软件的网络进程 SIGKILL，Chromium 又起一个也杀；GPU 进程、别的设置目录的网络进程不碰', async () => {
  const net = fakeNet()
  const gpu = fakeNet(['--type=gpu-process', `--user-data-dir=${UD}`])
  const otherApp = fakeNet([MARK, `--user-data-dir=${UD}-另一个`])
  const t = Date.now()
  const sh = killNetworkLater(process.pid, UD, 200, 4_000)
  expect(await exited(net)).toBe('SIGKILL')
  expect(Date.now() - t).toBeGreaterThanOrEqual(190)
  // sh 不会把自己认成网络进程，接着盯
  await new Promise((r) => setTimeout(r, 600))
  expect(sh.exitCode).toBe(null)
  const again = fakeNet()
  expect(await exited(again)).toBe('SIGKILL')
  for (const p of [gpu, otherApp]) expect(p.exitCode === null && p.signalCode === null).toBe(true)
  gpu.kill()
  otherApp.kill()
  await gone(sh)
}, 15_000)

it('主进程走了、留下的孤儿网络进程（父进程是 1）也杀：主进程在的时候、走了以后 1 秒内冒出来的都算', async () => {
  // 主进程：活 1.5 秒
  const main = spawn('/bin/sleep', ['1.5'])
  const first = await orphanNet()
  const sh = killNetworkLater(main.pid!, UD, 200, 6_000)
  expect(await until(() => !alive(first))).toBe(true)
  await gone(main)
  const late = await orphanNet()
  expect(await until(() => !alive(late))).toBe(true)
  await gone(sh)
}, 15_000)

it('主进程已经没了：留下的这个软件的孤儿（网页进程也算）扫 1 秒就走；别的设置目录的孤儿、主进程名下还在的不碰', async () => {
  const dead = spawn('/usr/bin/true')
  await gone(dead)
  const orphan = await orphanNet(['--type=renderer', `--user-data-dir=${UD}`])
  const stranger = await orphanNet(['--type=renderer', `--user-data-dir=${UD}-另一个`])
  const mine = fakeNet(['--type=renderer', `--user-data-dir=${UD}`])
  const t = Date.now()
  const sh = killNetworkLater(dead.pid!, UD, 100, 3_000)
  expect(await until(() => !alive(orphan))).toBe(true)
  await gone(sh)
  expect(Date.now() - t).toBeLessThan(2_500)
  expect(alive(stranger)).toBe(true)
  expect(mine.exitCode === null && mine.signalCode === null).toBe(true)
  process.kill(stranger, 'SIGTERM')
  mine.kill()
})

it('进程号、设置目录不对就报错，不起 sh', () => {
  expect(() => killNetworkLater(1, UD)).toThrow('进程号不对')
  expect(() => killNetworkLater(Number.NaN, UD)).toThrow('进程号不对')
  expect(() => killNetworkLater(process.pid, 'user data')).toThrow('设置目录不对')
})
