// 安装包自带 git（2026-11-26 用户选「带上」）：打包路径怎么认；真拿 scripts/fetch-git.mjs 下好的那份跑一遍，
// 当成没装命令行工具的新 Mac（空 HOME、DEVELOPER_DIR 指到不存在、不读系统 git 设置，PATH 最前面放一个一跑就记账报错的假 git）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as git from '@cn/git'
import { bundledGitDir, useBundledGit } from '../src/main/bundled-git'

describe('bundledGitDir', () => {
  it('在 app.asar 里跑（主进程 out/main、对外接口的小程序）：自带 git 在 Resources/git', () => {
    const res = '/Applications/Canvas Notes.app/Contents/Resources'
    expect(bundledGitDir(`${res}/app.asar/out/main`)).toBe(`${res}/git`)
    expect(bundledGitDir(`${res}/app.asar`)).toBe(`${res}/git`)
  })
  it('开发时（不在 app.asar 里）：null，用系统 git', () => {
    expect(bundledGitDir('/Users/me/canvas-notes/apps/notes/out/main')).toBeNull()
    expect(bundledGitDir('/Users/me/app.asar.bak/out/main')).toBeNull()
  })
  it('useBundledGit 只在打包时设 CN_GIT_DIR', () => {
    const was = process.env.CN_GIT_DIR
    try {
      delete process.env.CN_GIT_DIR
      useBundledGit('/Users/me/canvas-notes/apps/notes/out/main')
      expect(process.env.CN_GIT_DIR).toBeUndefined()
      useBundledGit('/A.app/Contents/Resources/app.asar/out/main')
      expect(process.env.CN_GIT_DIR).toBe('/A.app/Contents/Resources/git')
    } finally {
      if (was === undefined) delete process.env.CN_GIT_DIR
      else process.env.CN_GIT_DIR = was
    }
  })
})

describe('自带 git 真跑（没装命令行工具的 Mac）', () => {
  const bundled = join(__dirname, '../resources/git', `darwin-${process.arch === 'x64' ? 'x64' : 'arm64'}`)
  const keep: Record<string, string | undefined> = {}
  const KEYS = ['CN_GIT_DIR', 'PATH', 'HOME', 'DEVELOPER_DIR', 'GIT_CONFIG_NOSYSTEM', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL']
  let tmp = ''
  let calls = ''

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cn-bundled-git-'))
    const fake = join(tmp, 'fakebin')
    mkdirSync(fake)
    calls = join(tmp, 'system-git-calls.log')
    writeFileSync(join(fake, 'git'), `#!/bin/sh\necho "$*" >> '${calls}'\necho "system git must not run" >&2\nexit 97\n`, { mode: 0o755 })
    mkdirSync(join(tmp, 'home'))
    for (const k of KEYS) keep[k] = process.env[k]
    Object.assign(process.env, { CN_GIT_DIR: bundled, PATH: `${fake}:/usr/bin:/bin`, HOME: join(tmp, 'home'), DEVELOPER_DIR: '/nonexistent/developer', GIT_CONFIG_NOSYSTEM: '1' })
    delete process.env.XDG_CONFIG_HOME
    delete process.env.GIT_CONFIG_GLOBAL
  })
  afterAll(() => {
    for (const k of KEYS) if (keep[k] === undefined) delete process.env[k]
    else process.env[k] = keep[k]
    rmSync(tmp, { recursive: true, force: true })
  })

  it('postinstall 下好了这台 Mac 架构的那份', () => {
    expect(existsSync(join(bundled, 'libexec/git-core/git')), `先跑 node apps/notes/scripts/fetch-git.mjs`).toBe(true)
  })

  it('空库建历史、提交、同步到本地远端（file://），另一台拉得到；系统 git 一次没被调', async () => {
    const vault = join(tmp, 'vault')
    const remote = join(tmp, 'remote.git')
    mkdirSync(vault)
    mkdirSync(remote)
    await git.git(remote, ['init', '--bare', '-b', 'main'])
    expect(await git.isRepo(vault)).toBe(false)
    await git.init(vault)
    expect(await git.isRepo(vault)).toBe(true)
    // 模板带进来了（GIT_TEMPLATE_DIR）：hooks 里有示例
    expect(existsSync(join(vault, '.git/hooks/pre-commit.sample'))).toBe(true)
    await git.ensureIdentity(vault, { name: '测试', email: 'test@mac.local' })
    writeFileSync(join(vault, '第一篇.md'), '# 第一篇\n')
    expect(await git.commitAll(vault, '新增 1 个文件：第一篇')).toBeTruthy()
    await git.setRemote(vault, `file://${remote}`)
    const r = await git.sync(vault)
    expect(r).toMatchObject({ kind: 'ok', pushed: true })

    const other = join(tmp, 'other')
    await git.git(tmp, ['clone', '-q', `file://${remote}`, other])
    expect(readFileSync(join(other, '第一篇.md'), 'utf8')).toBe('# 第一篇\n')
    await git.ensureIdentity(other, { name: '另一台', email: 'other@mac.local' })
    writeFileSync(join(other, '第二篇.md'), '# 第二篇\n')
    await git.commitAll(other, '新增 1 个文件：第二篇')
    await git.git(other, ['push', '-q'])
    writeFileSync(join(vault, '第一篇.md'), '# 第一篇\n\n改了一行\n')
    expect(await git.sync(vault)).toMatchObject({ kind: 'ok', pulled: 1, pushed: true })
    expect(readFileSync(join(vault, '第二篇.md'), 'utf8')).toBe('# 第二篇\n')
    expect((await git.log(vault)).length).toBe(3)

    expect(existsSync(calls) ? readFileSync(calls, 'utf8') : '').toBe('')
  })

  it('自带的那份找不到：报错，不退回 PATH 里的 git', async () => {
    process.env.CN_GIT_DIR = join(tmp, 'gone')
    try {
      await expect(git.git(tmp, ['--version'])).rejects.toThrow('安装包里的 Git 不见了')
    } finally {
      process.env.CN_GIT_DIR = bundled
    }
    expect(existsSync(calls)).toBe(false)
  })
})
