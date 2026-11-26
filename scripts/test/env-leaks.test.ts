// 公开导出查 dispatch env 里的值（scripts/env-leaks.mjs）。全用假的 env：假的提供者对象，或 PATH 里放一个假的 dispatch 命令，不碰真的 dispatch env。
// 假值是随手编的，和真的密钥没关系；也不像任何一种密钥格式，这个文件进了画布笔记的公开导出也不会被密钥扫描挡住。
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { dispatchEnv, envLeaks, worthChecking } from '../env-leaks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const KEY = 'zq7Xk2mP9wLr4Tn8'
const tmps: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cn-env-leaks-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const put = (dir: string, rel: string, text: string | Buffer) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}
const fake = (vars: Record<string, string>) => ({ names: () => Object.keys(vars), get: (n: string) => vars[n] })
/** 跑一遍，连同打出来的话一起给回来，好查里面没有值 */
const run = async (dir: string, env: { names: () => string[] | null; get: (n: string) => string }) => {
  const logs: string[] = []
  const r = await envLeaks(dir, env, (s: string) => logs.push(s))
  return { ...r, text: JSON.stringify(r) + logs.join('\n'), logs }
}

describe('哪些值拿来比', () => {
  test.each([
    ['FAKE_API_KEY', KEY, true],
    ['FAKE_PASSWORD', 'someprojectname', true],
    ['MINIMAX_API_KEY_2', KEY, true],
    ['FAKE_KEY', 'abc1234', false],
    ['FAKE_TOKEN', '2031-07-19', false],
    ['FAKE_EXPIRES', '2031-07-19T10:00:00Z', false],
    ['FAKE_GROUP_ID', '1234567890123456789', false],
    ['FAKE_BUCKET', 'someprojectname', false],
    ['FAKE_MODEL', 'some-model-v3-chat', false],
    ['FAKE_HOST', 'https://api.example.org', false],
    ['FAKE_SERVICE_URL', 'https://abc123.example.org/v1', false],
    ['TOKENHUB_MODEL', 'some-model-name', false],
    ['FAKE_PROJECT', 'someproject', false],
    ['FAKE_NTFY_TOPIC', 'some-long-topic-name-here', true],
    ['FAKE_NTFY_TOPIC', 'alerts42x', true],
    ['FAKE_EMAIL', 'someone.fake' + '@uni.example.fi', true],
    ['FAKE_ACCOUNT_ID', 'a1b2c3d4e5f6a7b8c9d0', true],
    ['FAKE_DB_URL', 'postgres://someone:hunterpw@db.example.org/main', true],
  ])('%s = %s → %s', (name, value, want) => {
    expect(worthChecking(name, value)).toBe(want)
  })
})

describe('envLeaks（假的提供者）', () => {
  test('命中：报 env 名字和文件路径，结果和打出来的话里都没有值本身', async () => {
    const dir = tmp()
    put(dir, 'docs/notes.md', `开头\n用的是 ${KEY} 这一个\n`)
    put(dir, 'src/a.ts', `export const k = '${KEY}'\n`)
    put(dir, 'clean.md', '没有值\n')
    const r = await run(dir, fake({ FAKE_API_KEY: KEY }))
    expect(r.skipped).toBe(false)
    expect(r.hits).toEqual([expect.stringContaining('FAKE_API_KEY')])
    expect(r.hits[0]).toContain('docs/notes.md')
    expect(r.hits[0]).toContain('src/a.ts')
    expect(r.hits[0]).not.toContain('clean.md')
    expect(r.text).not.toContain(KEY)
  })

  test('不命中：值不在任何文件里', async () => {
    const dir = tmp()
    put(dir, 'a.md', '只有别的字 zq7Xk2mP\n')
    expect((await run(dir, fake({ FAKE_API_KEY: KEY }))).hits).toEqual([])
  })

  test('值是日期的跳过（名字像凭据也跳过），值像普通名字、名字又不像凭据的跳过', async () => {
    const dir = tmp()
    put(dir, 'CHANGELOG.md', '2031-07-19 发了一版；桶 someprojectname\n')
    const r = await run(dir, fake({ FAKE_EXPIRES: '2031-07-19', FAKE_TOKEN: '2031-07-19', FAKE_BUCKET: 'someprojectname', FAKE_VENDOR: 'abc' }))
    expect(r.hits).toEqual([])
    // 同一个像名字的值放在像凭据的名字下就比
    expect((await run(dir, fake({ FAKE_PASSWORD: 'someprojectname' }))).hits).toEqual([expect.stringContaining('FAKE_PASSWORD')])
  })

  test('不查 .git、node_modules 和二进制文件', async () => {
    const dir = tmp()
    put(dir, '.git/config', KEY)
    put(dir, 'node_modules/x/index.js', KEY)
    put(dir, 'icon.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from(KEY)]))
    expect((await run(dir, fake({ FAKE_API_KEY: KEY }))).hits).toEqual([])
  })

  test('提供者说没有 dispatch：跳过并说一句，不报错', async () => {
    const r = await run(tmp(), { names: () => null, get: () => { throw new Error('不该问值') } })
    expect(r).toMatchObject({ hits: [], skipped: true })
    expect(r.logs).toEqual([expect.stringContaining('没有 dispatch 命令')])
  })

  test('真的提供者：PATH 里没有 dispatch 时 names() 给 null', async () => {
    const old = process.env.PATH
    process.env.PATH = tmp()
    try {
      expect(dispatchEnv.names()).toBeNull()
    } finally {
      process.env.PATH = old
    }
  })
})

/** PATH 里只放一个假的 dispatch：list --json 给三个名字，get 给假值；fail 时一律退出码 3 */
function fakeDispatch(fail = false) {
  const bin = tmp()
  const script = fail
    ? '#!/bin/sh\nexit 3\n'
    : [
        '#!/bin/sh',
        `if [ "$1 $2 $3" = "env list --json" ]; then echo '[{"name":"FAKE_API_KEY"},{"name":"FAKE_EXPIRES"},{"name":"FAKE_BUCKET"}]'; exit 0; fi`,
        'if [ "$1 $2" = "env get" ]; then',
        `  case "$3" in FAKE_API_KEY) echo '${KEY}';; FAKE_EXPIRES) echo '2031-07-19';; FAKE_BUCKET) echo 'someprojectname';; *) exit 1;; esac`,
        '  exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n')
  writeFileSync(join(bin, 'dispatch'), script)
  chmodSync(join(bin, 'dispatch'), 0o755)
  return bin
}

// 画布笔记的公开仓库里只有第一个（别的软件的导出脚本不公开）
const SCRIPTS = ['scripts/public-export.mjs', 'apps/today/scripts/public-export.mjs', 'apps/meetcaption/scripts/public-export.mjs', 'apps/pararead/scripts/public-export.mjs'].filter((s) => existsSync(join(ROOT, s)))
const check = (script: string, dir: string, path: string) => spawnSync(process.execPath, [join(ROOT, script), '--check', dir], { encoding: 'utf8', env: { PATH: path, HOME: tmpdir() }, timeout: 60_000 })

describe.each(SCRIPTS)('%s --check 接上了', (script) => {
  test('值在导出里：停下，只报名字和文件；日期和桶名的巧合不报；输出里没有值', async () => {
    const dir = tmp()
    put(dir, 'docs/setup.md', `钥匙 ${KEY}\n2031-07-19 起用 someprojectname 这个桶\n`)
    const r = check(script, dir, fakeDispatch())
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain('有 1 处不该公开的')
    expect(r.stderr).toContain('FAKE_API_KEY')
    expect(r.stderr).toContain('docs/setup.md')
    expect(r.stdout + r.stderr).not.toContain(KEY)
  })

  test('没有 dispatch 命令：跳过这一项并说一句，检查照样过', async () => {
    const dir = tmp()
    put(dir, 'README.md', `钥匙 ${KEY}\n`)
    const r = check(script, dir, tmp())
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('没有 dispatch 命令')
    expect(r.stdout).toContain('dispatch env 那一项跳过了')
  })

  test('dispatch 在但出错：停下报错，不当成没有密钥', async () => {
    const r = check(script, tmp(), fakeDispatch(true))
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('dispatch env list 出错（退出码 3）')
  })
})
