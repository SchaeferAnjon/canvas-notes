import { describe, expect, it } from 'vitest'
import { commitErrorText, initErrorText, syncErrorText } from '../src/shared/git-errors'

describe('同步出错说中文（CN-45）', () => {
  it('地址不对、连不上、没权限、推不上去各说一句；认不出的给第一行原话', () => {
    expect(syncErrorText("git fetch 失败：fatal: '/tmp/nope.git' does not appear to be a git repository\nfatal: Could not read from remote repository.")).toBe('这个地址找不到仓库，检查一下远程地址')
    expect(syncErrorText('git fetch 失败：ERROR: Repository not found.')).toBe('这个地址找不到仓库，检查一下远程地址')
    expect(syncErrorText("git fetch 失败：fatal: unable to access 'https://x/': Could not resolve host: x")).toBe('连不上远程仓库，检查网络后再点「现在同步」')
    expect(syncErrorText('git fetch 失败：git@github.com: Permission denied (publickey).')).toBe('远程仓库不让读写，检查登录或SSH钥匙')
    expect(syncErrorText('git push 失败：! [rejected] main -> main (fetch first)')).toBe('推不上去，远程有别处的新提交，再点一次「现在同步」先拉下来')
    expect(syncErrorText('git fetch 失败：something odd\nsecond line')).toBe('同步没成功：something odd')
  })
})

describe('提交出错说中文（第 4 轮：现在提交、AI 存成卡片）', () => {
  it('没有署名（英文、中文两种 git）：说去哪填署名，不露 git 的原话', () => {
    const zh = 'git commit 失败：作者身份未知\n\n*** 请告诉我您是谁。\n\n运行\n\n  git config --global user.email "you@example.com"\n  git config --global user.name "Your Name"'
    const en = 'git commit 失败：Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\nfatal: unable to auto-detect email address'
    for (const raw of [zh, en]) {
      const t = commitErrorText(raw)
      expect(t).toBe('Git不知道用什么署名提交：去设置 › Git和同步填上「提交署名」')
      expect(t).not.toMatch(/git config|you@example/)
    }
  })

  it('锁一直不放：说是锁文件、怎么办，不带完整路径', () => {
    const zh = "git add 失败：致命错误：无法创建 '/Users/runner/笔记库/.git/index.lock'：File exists。\n\n另一 git 进程似乎正在此仓库中运行"
    const en = "git add 失败：fatal: Unable to create '/Users/runner/notes/.git/index.lock': File exists.\n\nAnother git process seems to be running"
    for (const raw of [zh, en]) {
      const t = commitErrorText(raw)
      expect(t).toContain('.git/index.lock')
      expect(t).toContain('删掉它再提交')
      expect(t).not.toContain('/Users/')
    }
  })

  it('认不出的：「提交没成功」加第一行', () => {
    expect(commitErrorText('git commit 失败：fatal: something odd\nmore')).toBe('提交没成功：something odd')
  })
})

it('打开库时建不了 Git 仓库：没装命令行工具、找不到 git、文件夹不让写，各说一句怎么办（2026-11-26 收件箱）', () => {
  // 真没装时 /usr/bin/git 的原话；DEVELOPER_DIR 指错时的原话
  expect(initErrorText('git init 失败：xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun')).toContain('xcode-select --install')
  expect(initErrorText('git init 失败：xcrun: error: missing DEVELOPER_DIR path: /nonexistent/developer')).toContain('命令行工具还没装')
  expect(initErrorText('spawn git ENOENT')).toContain('找不到 Git')
  expect(initErrorText("git init 失败：/private/tmp/x/.git: Permission denied")).toContain('写不进去')
  expect(initErrorText('git init 失败：fatal: cannot mkdir /Volumes/x/.git: Read-only file system')).toContain('写不进去')
  expect(initErrorText('git init 失败：fatal: 奇怪的错\n第二行')).toBe('这个文件夹建不了库：奇怪的错')
})
