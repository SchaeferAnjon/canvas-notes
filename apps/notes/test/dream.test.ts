import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Ask, type DreamReportInternal, dropItem, isoWeek, itemDiff, parseDiff, runDream, takeAll, takeItem } from '../src/main/dream'
import { DREAM_VAULT, worksHash } from '../e2e/fixtures/dream'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

/** 测试用的 AI：收件箱都归到「旅行」，小结写一句固定的话 */
const fakeAsk: Ask = async (_s, prompt) => {
  if (prompt.startsWith('命令：本周小结')) return '这周在准备冰岛。'
  if (prompt.startsWith('命令：整理收件箱')) {
    const paths = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
    return '```json\n' + JSON.stringify(paths.map((path) => ({ path, topic: '旅行', why: '都是旅行的事' }))) + '\n```'
  }
  throw new Error('没想到的提问')
}

let base: string
let root: string
let scratch: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-dream-'))
  root = join(base, '库')
  scratch = join(base, 'scratch')
  mkdirSync(root)
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
  for (const [p, t] of Object.entries(DREAM_VAULT)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', '样本')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const dream = (ask: Ask = fakeAsk) => runDream({ root, scratch, ask, trigger: 'manual', now: new Date(2026, 10, 15, 3, 0) })
const count = () => Number(g(root, 'rev-list', '--count', 'HEAD').trim())

// 每条用例要起几十次 git；机器忙时（别的构建在跑）一条会超过默认的 5 秒，正常 1 到 2 秒
describe('梦游', { timeout: 30_000 }, () => {
  it('在 dream/11-15 分支上一条建议一个提交；用户的工作目录和作品一个字节不动', async () => {
    writeFileSync(join(root, '所思所想.md'), DREAM_VAULT['所思所想.md'] + '还没提交的一行\n')
    const works = worksHash(root)
    const r = (await dream()) as DreamReportInternal
    // 没提交的改动先提交到 main
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('更新 1 个文件：所思所想')
    expect(worksHash(root)).toEqual(works)

    expect(r.branch).toBe('dream/11-15')
    expect(r.base).toBe('main')
    expect(g(root, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe('dream/11-15')
    expect(r.notes).toEqual([])
    const groups = r.items.map((i) => i.group)
    expect(groups).toEqual(['inbox', 'inbox', 'inbox', 'link', 'dup', 'week'])
    const link = r.items.find((i) => i.group === 'link')!
    expect(link.title).toBe('极光')
    expect(link.sub).toBe('↔ [[极光预报]]')
    expect(link.why).toMatch(/两篇都讲到「.*云量低于三成.*」/)
    const dup = r.items.find((i) => i.group === 'dup')!
    expect(dup.commit).toBeNull()
    expect(dup.files.sort()).toEqual(['收件箱/巴黎自由行全景指南.md', '素材/巴黎/巴黎深度漫游指南.md'])
    expect(r.items.find((i) => i.group === 'week')!.files).toEqual([`周记/${isoWeek(new Date(2026, 10, 15))}.md`])
    expect(isoWeek(new Date(2026, 10, 15))).toBe('2026-W46')

    // 分支上的每个提交只碰 收件箱/ 素材/ 周记/
    const commits = g(root, 'rev-list', 'main..dream/11-15').trim().split('\n')
    expect(commits).toHaveLength(5)
    for (const c of commits) {
      for (const f of g(root, 'show', '--format=', '--name-only', '--no-renames', c).trim().split('\n')) expect(f).toMatch(/^(收件箱|素材|周记)\//)
    }
    // 临时检出在 scratch 里，用户的目录没切分支
    expect(existsSync(r.worktree!)).toBe(true)
    expect(r.worktree!.startsWith(scratch)).toBe(true)
    expect(g(root, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main')
    expect(existsSync(join(root, '周记'))).toBe(false)
  })

  it('收下一条 = cherry-pick 一次提交；丢掉 = 跳过；全部收下后删分支和临时检出', async () => {
    const works = worksHash(root)
    const r = (await dream()) as DreamReportInternal
    const before = count()

    const link = r.items.find((i) => i.group === 'link')!
    const diff = await itemDiff(root, r, link.id)
    expect(diff).toEqual([{ path: '收件箱/极光.md', status: 'changed', lines: expect.arrayContaining([{ k: 'a', t: '相关：[[极光预报]]' }]) }])
    await takeItem(root, r, link.id)
    expect(link.state).toBe('taken')
    expect(count()).toBe(before + 1)
    expect(readFileSync(join(root, '收件箱/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('梦游：「极光」补上 [[极光预报]]')

    const ice = r.items.find((i) => i.group === 'inbox' && i.files[0] === '收件箱/冰洞.md')!
    expect(ice.sub).toBe('→ 素材/旅行')
    expect(ice.why).toBe('都是旅行的事')
    await dropItem(root, r, ice.id)
    expect(ice.state).toBe('dropped')
    expect(count()).toBe(before + 1)
    expect(existsSync(join(root, '收件箱/冰洞.md'))).toBe(true)

    await takeAll(root, r)
    expect(r.items.filter((i) => i.state === 'pending')).toEqual([])
    // 极光的双链先收下了，再挪：挪过去的文件带着那一行
    expect(readFileSync(join(root, '素材/旅行/极光.md'), 'utf8')).toContain('相关：[[极光预报]]')
    expect(existsSync(join(root, '收件箱/极光.md'))).toBe(false)
    expect(existsSync(join(root, '素材/旅行/巴黎自由行全景指南.md'))).toBe(true)
    expect(readFileSync(join(root, '周记/2026-W46.md'), 'utf8')).toContain('这周在准备冰岛。')
    expect(existsSync(join(root, '收件箱/冰洞.md'))).toBe(true)
    // 收下的 4 条各一个提交（双链 1 + 挪 2 + 小结 1）
    expect(count()).toBe(before + 4)
    expect(r.closed).toBe(true)
    expect(g(root, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe('')
    expect(existsSync(r.worktree!)).toBe(false)
    expect(g(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(worksHash(root)).toEqual(works)
  })

  it('先挪后补双链也能收下：挪过去的文件末尾加上那一行', async () => {
    const r = await dream()
    const move = r.items.find((i) => i.group === 'inbox' && i.files[0] === '收件箱/极光.md')!
    await takeItem(root, r, move.id)
    await takeItem(root, r, r.items.find((i) => i.group === 'link')!.id)
    expect(readFileSync(join(root, '素材/旅行/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n')
  })

  it('那篇在 main 上又被改到同一处：收下时退回，告诉用户冲突了，main 干干净净', async () => {
    const r = await dream()
    writeFileSync(join(root, '收件箱/极光.md'), DREAM_VAULT['收件箱/极光.md'] + '用户后来加的一行\n')
    const link = r.items.find((i) => i.group === 'link')!
    await expect(takeItem(root, r, link.id)).rejects.toThrow('冲突')
    expect(link.state).toBe('pending')
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(root, '收件箱/极光.md'), 'utf8')).toContain('用户后来加的一行')
    expect(existsSync(join(root, '.git/CHERRY_PICK_HEAD'))).toBe(false)
  })

  it('AI 想把作品挪走、主题名带路径的，都不做；AI 不可用时其他组照做，报告里说一句', async () => {
    const works = worksHash(root)
    const bad: Ask = async (_s, prompt) => {
      if (prompt.startsWith('命令：本周小结')) throw new Error('AI 没有回答')
      return '```json\n' + JSON.stringify([{ path: '所思所想.md', topic: '旅行' }, { path: '收件箱/冰洞.md', topic: '../外面' }]) + '\n```'
    }
    const r = await dream(bad)
    expect(r.items.filter((i) => i.group === 'inbox')).toEqual([])
    expect(r.items.filter((i) => i.group === 'week')).toEqual([])
    expect(r.notes).toEqual(['本周小结没写成：AI 没有回答'])
    expect(r.items.map((i) => i.group)).toEqual(['link', 'dup'])
    await takeAll(root, r)
    expect(worksHash(root)).toEqual(works)
  })

  it('同一天再梦游一次，分支叫 dream/11-15-2', async () => {
    await dream()
    const r = await dream()
    expect(r.branch).toBe('dream/11-15-2')
  })

  it('没什么可整理时不留分支', async () => {
    rmSync(join(root, '收件箱'), { recursive: true })
    rmSync(join(root, '素材'), { recursive: true })
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '清空')
    const r = await dream(async () => '')
    expect(r.items).toEqual([])
    expect(r.closed).toBe(true)
    expect(g(root, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe('')
  })
})

describe('梦游 diff 解析', () => {
  it('新文件、改动、纯挪动', () => {
    const out = [
      'diff --git a/周记/2026-W46.md b/周记/2026-W46.md',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/周记/2026-W46.md',
      '@@ -0,0 +1,2 @@',
      '+# 2026-W46 小结',
      '+这周。',
      'diff --git a/收件箱/冰 洞.md b/素材/旅行/冰 洞.md',
      'similarity index 100%',
      'rename from 收件箱/冰 洞.md',
      'rename to 素材/旅行/冰 洞.md',
      '',
    ].join('\n')
    expect(parseDiff(out)).toEqual([
      { path: '周记/2026-W46.md', status: 'new', lines: [{ k: 'a', t: '# 2026-W46 小结' }, { k: 'a', t: '这周。' }] },
      { path: '素材/旅行/冰 洞.md', from: '收件箱/冰 洞.md', status: 'moved', lines: [{ k: 'gap', t: '从 收件箱/冰 洞.md 挪到 素材/旅行/冰 洞.md，内容没变' }] },
    ])
  })
})
