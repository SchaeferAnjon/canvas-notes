// 安装包自带 git（2026-11-26）：CN_GIT_DIR 给了就只起那一份，找不到报错、不退回系统 git；没给用系统的
import { describe, expect, it } from 'vitest'
import { bundledGitLayout, GitError, gitProgram, KEYCHAIN_HELPERS } from '../src'

const R = '/Applications/Canvas Notes.app/Contents/Resources/git'
const BIN = `${R}/libexec/git-core/git`

describe('gitProgram', () => {
  it('没给自带 git 的目录（开发）：照 PATH 找系统的 git，PATH 补上 Homebrew', () => {
    const p = gitProgram(undefined, () => true, '/usr/bin:/bin')
    expect(p.file).toBe('git')
    expect(p.env).toEqual({ PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_TERMINAL_PROMPT: '0' })
  })

  it('给了：起安装包里的 git，GIT_EXEC_PATH、GIT_TEMPLATE_DIR 指进安装包', () => {
    const p = gitProgram(R, (f) => f === BIN, '/usr/bin:/bin')
    expect(p.file).toBe(BIN)
    expect(p.env).toEqual({
      PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin',
      GIT_TERMINAL_PROMPT: '0',
      GIT_EXEC_PATH: `${R}/libexec/git-core`,
      GIT_TEMPLATE_DIR: `${R}/share/git-core/templates`,
    })
    expect(bundledGitLayout(R)).toEqual({ bin: BIN, execPath: `${R}/libexec/git-core`, templateDir: `${R}/share/git-core/templates` })
  })

  it('给了却找不到：报「重新安装」，不退回系统 git', () => {
    expect(() => gitProgram(R, () => false)).toThrow(GitError)
    expect(() => gitProgram(R, () => false)).toThrow('安装包里的 Git 不见了：重新安装画布笔记')
  })

  it('装着命令行工具或 Xcode 时借它们的钥匙串小程序存 https 密码（绝对路径），先找命令行工具那份', () => {
    const p = gitProgram(R, (f) => f === BIN || KEYCHAIN_HELPERS.includes(f))
    expect(p.env).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: KEYCHAIN_HELPERS[0] })
    const xcode = gitProgram(R, (f) => f === BIN || f === KEYCHAIN_HELPERS[1])
    expect(xcode.env.GIT_CONFIG_VALUE_0).toBe(KEYCHAIN_HELPERS[1])
    expect(gitProgram(R, (f) => f === BIN).env.GIT_CONFIG_COUNT).toBeUndefined()
  })
})
