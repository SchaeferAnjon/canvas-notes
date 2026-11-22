// 梦游对照要的东西（task-m552v）：一条改的每个文件（改名时别的笔记里换了 [[旧名]] 的那篇也在）、挪的那篇在前、每个文件一句人话、
// 「打开「文件名」」开哪一份（原处的、后来挪走了跟过去、还没收下的挪动开原来那份、只在梦游分支上的开分支上那份）
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Ask, runDream, takeItem } from '../src/main/dream'
import { diffOf } from '../src/main/diff'
import { moveSay, relinkSay } from '../src/shared/diff'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

/** 收件箱都归到剪藏/旅行，名字不改 */
const ask: Ask = async (_s, prompt) => {
  if (prompt.startsWith('命令：本周小结')) return '这周在准备冰岛。'
  if (prompt.startsWith('命令：归类和改名')) {
    const paths = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
    return '```json\n' + JSON.stringify(paths.map((path) => ({ path, folder: '剪藏/旅行', name: null, why: '都是旅行的事' }))) + '\n```'
  }
  throw new Error('没想到的提问')
}

const AURORA = '---\nsource: https://www.youtube.com/watch?v=a\n---\n# 极光\n\n![封面](../附件/视频/极光/封面.png)\n\n## 记下的时刻\n\n- 01:06 · 云量低于三成、KP 指数到 3 以上就值得出门\n\n![01:06](../附件/视频/极光/0106.png)\n'
const FILES: Record<string, string> = {
  '极光预报.md': '# 极光预报\n\n每天下午看冰岛气象局的云量图，云量低于三成、KP 指数到 3 以上就开车去黑沙滩等。\n',
  '收件箱/极光.md': AURORA,
  // 剪藏/旅行/ 里已经有一篇同名的：挪过去叫「极光 2」，标题跟着改；别的笔记里的 [[极光]] 换成 [[极光 2]]
  '剪藏/旅行/极光.md': '# 极光\n\n去年剪的。\n',
  '剪藏/旅行/冰岛行程.md': '# 冰岛行程\n\n## 记下的时刻\n\n- 01:06 · [[极光]]\n',
  '收件箱/冰洞.md': '冰洞只在冬天开放，必须跟导游进去。\n',
}

let base: string
let root: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-dream-cmp-'))
  root = join(base, '库')
  mkdirSync(root)
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', '样本')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const dream = () => runDream({ root, scratch: join(base, 'scratch'), ask, trigger: 'manual', now: new Date(2026, 10, 15, 3, 0) })

describe('梦游对照（task-m552v）', { timeout: 30_000 }, () => {
  it('归类改名那条：挪的那篇在前（人话写挪到哪、标题加了什么、几张图的地址跟着改），别的笔记里换了双链的那篇也列出来', async () => {
    const r = await dream()
    const it = r.items.find((i) => i.group === 'file' && i.move?.from === '收件箱/极光.md')!
    expect(it.move!.to).toBe('剪藏/旅行/极光 2.md')
    const d = await diffOf(root, { kind: 'dream', id: it.id }, r)
    expect(d.files.map((f) => f.path)).toEqual(['剪藏/旅行/极光 2.md', '剪藏/旅行/冰岛行程.md'])
    expect(d.files[0]!.summary).toBe('挪到剪藏/旅行，标题加「2」，2张图的地址跟着改')
    expect(d.files[1]!.summary).toBe('「记下的时刻」那段的 [[极光]] 换成 [[极光 2]]')
    expect(d.right).toBe(`收下后 · ${r.branch}`)
    expect(d.rev).toBe(it.commit)
    // 还没收下：挪的那篇现在还在收件箱，打开的是那一份；换了双链的那篇就在原处
    expect(d.files[0]).toMatchObject({ exists: false, now: '收件箱/极光.md' })
    expect(d.files[1]).toMatchObject({ exists: true, now: '剪藏/旅行/冰岛行程.md' })
  })

  it('先收下归类再看补双链那条：那篇已经挪走，打开的是现在那份', async () => {
    const r = await dream()
    const mv = r.items.find((i) => i.group === 'file' && i.move?.from === '收件箱/极光.md')!
    const link = r.items.find((i) => i.group === 'link')!
    expect(link.files).toEqual(['收件箱/极光.md'])
    await takeItem(root, r, mv.id)
    const d = await diffOf(root, { kind: 'dream', id: link.id }, r)
    expect(d.files).toHaveLength(1)
    expect(d.files[0]).toMatchObject({ path: '收件箱/极光.md', exists: false, now: '剪藏/旅行/极光 2.md' })
    expect(d.files[0]!.branch).toBeUndefined()
  })

  it('只挪不改名：一句「挪到剪藏/旅行」，内容没变', async () => {
    const r = await dream()
    const it = r.items.find((i) => i.move?.from === '收件箱/冰洞.md')!
    const d = await diffOf(root, { kind: 'dream', id: it.id }, r)
    expect(d.files.map((f) => [f.path, f.from, f.summary])).toEqual([['剪藏/旅行/冰洞.md', '收件箱/冰洞.md', '挪到剪藏/旅行']])
    expect(d.files[0]!.before).toBe(d.files[0]!.after)
  })
})

describe('挪动、换双链的人话', () => {
  it('挪到哪、改名、正文跟着改了什么', () => {
    expect(moveSay('收件箱/a.md', '剪藏/旅行/a.md', 'x', 'x', '库')).toBe('挪到剪藏/旅行')
    expect(moveSay('收件箱/a.md', '收件箱/b.md', '# a\n', '# b\n', '库')).toBe('改名「b」，标题跟着改')
    expect(moveSay('收件箱/a.md', '写作/b.md', '# a\n[x](../x.md)\n', '# b\n[x](../../x.md)\n', '库')).toBe('挪到写作并改名，标题和1处链接跟着改')
    expect(moveSay('收件箱/a.md', 'a.md', 'x', 'x', '测试库')).toBe('挪到测试库')
    expect(relinkSay('旧', '新', '# 甲\n\n[[旧]]\n', '# 甲\n\n[[新]]\n')).toBe('「甲」那段的 [[旧]] 换成 [[新]]')
  })
})
