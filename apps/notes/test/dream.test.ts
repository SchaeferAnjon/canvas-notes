import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Ask, clearStrayDreams, DUP_MAX, sameVideoNotes, type DreamReportInternal, dropItem, isoWeek, LINK_MAX, movesOf, runDream, takeAll, takeItem, takeMany, undo } from '../src/main/dream'
import { diffOf } from '../src/main/diff'
import { parseHunks } from '../src/shared/diff'
import { writeImport } from '../src/main/import/write'
import { Vault } from '../src/main/vault'
import { isArchived } from '../src/shared/sidebar'
import { recentOf } from '../src/shared/recent'
import { DREAM_VAULT, worksHash } from '../e2e/fixtures/dream'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

/** 测试用的 AI：收件箱都归到「旅行」，小结写一句固定的话 */
const fakeAsk: Ask = async (_s, prompt) => {
  if (prompt.startsWith('命令：本周小结')) return '这周在准备冰岛。'
  if (prompt.startsWith('命令：归类和改名')) {
    const paths = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
    return '```json\n' + JSON.stringify(paths.map((path) => ({ path, folder: '剪藏/旅行', name: null, why: '都是旅行的事' }))) + '\n```'
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
    expect(groups).toEqual(['file', 'file', 'file', 'link', 'dup', 'week'])
    const link = r.items.find((i) => i.group === 'link')!
    expect(link.title).toBe('极光')
    expect(link.sub).toBe('↔ [[极光预报]]')
    expect(link.why).toMatch(/两篇都讲到「.*云量低于三成.*」/)
    const dup = r.items.find((i) => i.group === 'dup')!
    expect(dup.commit).toBeNull()
    expect(dup.files.sort()).toEqual(['剪藏/巴黎/巴黎深度漫游指南.md', '收件箱/巴黎自由行全景指南.md'])
    expect(r.items.find((i) => i.group === 'week')!.files).toEqual([`周记/${isoWeek(new Date(2026, 10, 15))}.md`])
    expect(isoWeek(new Date(2026, 10, 15))).toBe('2026-W46')

    // 分支上的每个提交只碰 收件箱/ 剪藏/ 周记/
    const commits = g(root, 'rev-list', 'main..dream/11-15').trim().split('\n')
    expect(commits).toHaveLength(5)
    for (const c of commits) {
      for (const f of g(root, 'show', '--format=', '--name-only', '--no-renames', c).trim().split('\n')) expect(f).toMatch(/^(收件箱|剪藏|阅读|周记)\//)
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
    const diff = await diffOf(root, { kind: 'dream', id: link.id }, r)
    expect(diff.files).toEqual([expect.objectContaining({ path: '收件箱/极光.md', status: 'changed', before: DREAM_VAULT['收件箱/极光.md'], after: DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n', summary: '末尾加了一行 相关：[[极光预报]]' })])
    expect(diff).toMatchObject({ left: '现在的 · main', right: `收下后 · ${r.branch}` })
    await takeItem(root, r, link.id)
    expect(link.state).toBe('taken')
    expect(count()).toBe(before + 1)
    expect(readFileSync(join(root, '收件箱/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('梦游：「极光」补上 [[极光预报]]')

    const ice = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/冰洞.md')!
    expect(ice.sub).toBe('从收件箱挪来 · 原名「冰洞」')
    expect(ice.move).toEqual({ from: '收件箱/冰洞.md', to: '剪藏/旅行/冰洞.md' })
    expect(ice.why).toBe('都是旅行的事')
    await dropItem(root, r, ice.id)
    expect(ice.state).toBe('dropped')
    expect(count()).toBe(before + 1)
    expect(existsSync(join(root, '收件箱/冰洞.md'))).toBe(true)

    await takeAll(root, r)
    expect(r.items.filter((i) => i.state === 'pending')).toEqual([])
    // 极光的双链先收下了，再挪：挪过去的文件带着那一行
    expect(readFileSync(join(root, '剪藏/旅行/极光.md'), 'utf8')).toContain('相关：[[极光预报]]')
    expect(existsSync(join(root, '收件箱/极光.md'))).toBe(false)
    expect(existsSync(join(root, '剪藏/旅行/巴黎自由行全景指南.md'))).toBe(true)
    expect(readFileSync(join(root, '周记/2026-W46.md'), 'utf8')).toContain('这周在准备冰岛。')
    expect(existsSync(join(root, '收件箱/冰洞.md'))).toBe(true)
    // 双链收下时一个提交；剩下的（挪 2 + 小结 1）全部收下是一次提交
    expect(count()).toBe(before + 2)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('收下梦游的整理：3 处')
    expect(r.closed).toBe(true)
    expect(g(root, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe('')
    expect(existsSync(r.worktree!)).toBe(false)
    expect(g(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(worksHash(root)).toEqual(works)
  })

  it('先挪后补双链也能收下：挪过去的文件末尾加上那一行', async () => {
    const r = await dream()
    const move = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/极光.md')!
    await takeItem(root, r, move.id)
    await takeItem(root, r, r.items.find((i) => i.group === 'link')!.id)
    expect(readFileSync(join(root, '剪藏/旅行/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '\n相关：[[极光预报]]\n')
  })

  it('收下、全部收下、撤回挪了哪几篇（开着的那篇跟过去用）：一条条收下和全部收下说的一样，撤回反过来', async () => {
    const r = await dream()
    const snap = () => new Map(r.items.map((i) => [i.id, i.state] as const))
    const ji = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/极光.md')!
    let before = snap()
    await takeAll(root, r)
    const all = movesOf(before, r.items)
    expect(all).toContainEqual({ from: '收件箱/极光.md', to: '剪藏/旅行/极光.md' })
    expect(all).toContainEqual({ from: '收件箱/冰洞.md', to: '剪藏/旅行/冰洞.md' })
    // 补双链那条没挪文件，不算
    expect(all.filter((m) => m.from === '收件箱/极光.md')).toHaveLength(1)
    before = snap()
    await undo(root, r, [ji.id], ji.taken!)
    expect(movesOf(before, r.items)).toEqual([{ from: '剪藏/旅行/极光.md', to: '收件箱/极光.md' }])
  })

  it('那篇在 main 上末尾也加了一句（第 6 轮）：两边都只往末尾加，合得上，收下后两句都在', async () => {
    const r = await dream()
    writeFileSync(join(root, '收件箱/极光.md'), DREAM_VAULT['收件箱/极光.md'] + '用户后来加的一行')
    const link = r.items.find((i) => i.group === 'link')!
    await takeItem(root, r, link.id)
    expect(link.state).toBe('taken')
    expect(readFileSync(join(root, '收件箱/极光.md'), 'utf8')).toBe(DREAM_VAULT['收件箱/极光.md'] + '用户后来加的一行\n相关：[[极光预报]]\n')
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('梦游：「极光」补上 [[极光预报]]')
    expect(existsSync(join(root, '.git/CHERRY_PICK_HEAD'))).toBe(false)
  })

  it('那篇在 main 上删了：收下时退回，说是哪条、为什么，main 干干净净', async () => {
    const r = await dream()
    rmSync(join(root, '收件箱/极光.md'))
    const link = r.items.find((i) => i.group === 'link')!
    await expect(takeItem(root, r, link.id)).rejects.toThrow('「极光」没收下：你后来删了这篇')
    expect(link.state).toBe('pending')
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(root, '.git/CHERRY_PICK_HEAD'))).toBe(false)
  })

  it('全部收下碰到合不上的（第 6 轮）：能收的都收、一次提交；合不上的那几条留着待看，各自记下为什么', async () => {
    const r = (await dream()) as DreamReportInternal
    rmSync(join(root, '收件箱/极光.md'))
    // 周记这一篇用户自己也建了一篇同名的，写的是别的
    mkdirSync(join(root, '周记'), { recursive: true })
    writeFileSync(join(root, '周记/2026-W46.md'), '# 这周\n\n我自己写的小结。\n')
    const before = count()
    await takeAll(root, r)
    const state = Object.fromEntries(r.items.map((i) => [`${i.title} ${i.sub}`, i.state]))
    expect(Object.values(state).filter((s) => s === 'taken')).toHaveLength(3)
    const left = r.items.filter((i) => i.state === 'pending')
    expect(left.map((i) => i.group).sort()).toEqual(['file', 'link', 'week'])
    for (const i of left.filter((x) => x.title === '极光')) expect(i.conflict).toBe('你后来删了这篇')
    expect(left.find((i) => i.group === 'week')!.conflict).toBe('你后来也建了一篇「2026-W46」')
    expect(r.items.filter((i) => i.state === 'taken').every((i) => !i.conflict)).toBe(true)
    // 删掉的那篇：用户删的提交 + 收下的一次提交
    expect(count()).toBe(before + 2)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('收下梦游的归类和改名：2 处')
    expect(existsSync(join(root, '剪藏/旅行/冰洞.md'))).toBe(true)
    expect(existsSync(join(root, '剪藏/旅行/巴黎自由行全景指南.md'))).toBe(true)
    expect(readFileSync(join(root, '周记/2026-W46.md'), 'utf8')).toBe('# 这周\n\n我自己写的小结。\n')
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(root, '.git/CHERRY_PICK_HEAD'))).toBe(false)
    expect(r.closed).toBeFalsy()
  })

  it('AI 想把作品挪走、主题名带路径的，都不做；AI 不可用时其他组照做，报告里说一句', async () => {
    const works = worksHash(root)
    const bad: Ask = async (_s, prompt) => {
      if (prompt.startsWith('命令：本周小结')) throw new Error('AI 没有回答')
      return '```json\n' + JSON.stringify([{ path: '所思所想.md', folder: '剪藏/旅行' }, { path: '收件箱/冰洞.md', folder: '../外面' }, { path: '收件箱/极光.md', folder: '剪藏/a/b' }]) + '\n```'
    }
    const r = await dream(bad)
    expect(r.items.filter((i) => i.group === 'file')).toEqual([])
    expect(r.items.filter((i) => i.group === 'week')).toEqual([])
    expect(r.notes).toEqual(['本周小结没写成：AI 没有回答'])
    expect(r.items.map((i) => i.group)).toEqual(['link', 'dup'])
    await takeAll(root, r)
    expect(worksHash(root)).toEqual(works)
  })

  it('挪动不算改过：导进来的旧笔记收下后修改时间还是原来的、直接进归档；一条条收下、撤回也一样', async () => {
    const old = new Date(2021, 4, 15, 10, 0)
    const notes = ['旧笔记 一', '旧笔记 二', '旧笔记 三'].map((title, i) => ({
      folder: '生活',
      title,
      text: `第${i}条旧笔记的正文。\n`,
      props: [['来源', '备忘录']] as [string, string][],
      created: old.getTime(),
      updated: old.getTime() + i * 60_000,
      attachments: [],
      id: `apple-notes:T${i}`,
    }))
    await writeImport({ root, source: '备忘录', notes, message: '导入旧笔记' })
    const mtime = (p: string) => statSync(join(root, p)).mtimeMs
    const at = (i: number) => old.getTime() + i * 60_000
    /** 这一条原来的时间（按标题里的一二三） */
    const want = (it: { move?: { from: string } }) => at('一二三'.indexOf(/旧笔记 (.)/.exec(it.move!.from)![1]!))
    expect(mtime('收件箱/导入/备忘录/生活/旧笔记 一.md')).toBe(at(0))
    // 都归进「生活」（算我写的，才看得出进没进「这周动过的」）
    const toLife: Ask = async (s, prompt) => (prompt.startsWith('命令：归类和改名') ? (await fakeAsk(s, prompt)).replaceAll('剪藏/旅行', '生活') : fakeAsk(s, prompt))
    const r = (await dream(toLife)) as DreamReportInternal
    const file = r.items.filter((i) => i.group === 'file' && i.move!.from.includes('旧笔记'))
    expect(file).toHaveLength(3)
    // 一条单独收下（cherry-pick）
    await takeItem(root, r, file[0]!.id)
    expect(mtime(file[0]!.move!.to)).toBe(want(file[0]!))
    // 剩下的一起收下（合成一次提交）
    const hash = await takeMany(root, r, [file[1]!.id, file[2]!.id])
    expect(mtime(file[1]!.move!.to)).toBe(want(file[1]!))
    expect(mtime(file[2]!.move!.to)).toBe(want(file[2]!))
    // 左栏：不算这周动过的，90 天归档里有它们
    const list = await new Vault(root).list()
    const moved = list.filter((n) => n.path.includes('旧笔记'))
    expect(moved.map((n) => n.kind)).toEqual(['work', 'work', 'work'])
    expect(moved.every((n) => isArchived(n, Date.now(), 90, new Set()))).toBe(true)
    const side = recentOf(list, { pins: [], now: Date.now(), archiveDays: 90 })
    expect(side.groups.some((g) => g.items.some((n) => n.path.includes('旧笔记')))).toBe(false)
    expect(side.archived).toBe(3)
    // 撤回：挪回收件箱，时间也还是原来的
    await undo(root, r, [file[1]!.id, file[2]!.id], hash!)
    expect(mtime(file[1]!.move!.from)).toBe(want(file[1]!))
    expect(g(root, 'status', '--porcelain')).toBe('')
  })

  it('收下归类后在外面改了名、挪走、删了再撤回：说它后来改名成了什么 / 挪到哪 / 删了，名字不重复；什么都不动，改名那次提交写「挪了」', async () => {
    const r = (await dream()) as DreamReportInternal
    const file = r.items.filter((i) => i.group === 'file')
    const [a, b, c] = file
    for (const it of [a!, b!, c!]) await takeItem(root, r, it.id)
    // a 改名（像访达里改），b 挪去别的文件夹，c 删了
    const renamed = a!.move!.to.replace(/\.md$/, '攻略.md')
    execFileSync('mv', [join(root, a!.move!.to), join(root, renamed)])
    mkdirSync(join(root, '剪藏/别处'), { recursive: true })
    execFileSync('mv', [join(root, b!.move!.to), join(root, '剪藏/别处', b!.move!.to.split('/').pop()!)])
    rmSync(join(root, c!.move!.to))
    const title = (p: string) => p.split('/').pop()!.replace(/\.md$/, '')
    const before = count()
    await expect(undo(root, r, [a!.id], a!.taken)).rejects.toThrow(`撤回不了：「${title(a!.move!.to)}」收下以后改名成了「${title(renamed)}」，什么都没动`)
    // 撤回前先把外面的改动提交了：改名写成「挪了」，不是「新增…；删除…」
    expect(count()).toBe(before + 1)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toMatch(/^挪了 \d+ 个文件：/)
    expect(g(root, 'log', '-1', '--format=%s')).toContain(`${a!.move!.to.replace(/\.md$/, '')} → ${renamed.replace(/\.md$/, '')}`)
    await expect(undo(root, r, [b!.id], b!.taken)).rejects.toThrow(`撤回不了：「${title(b!.move!.to)}」收下以后挪到了剪藏/别处，什么都没动`)
    await expect(undo(root, r, [c!.id], c!.taken)).rejects.toThrow(`撤回不了：「${title(c!.move!.to)}」收下以后被删了，什么都没动`)
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(root, '.git/REVERT_HEAD'))).toBe(false)
    expect(existsSync(join(root, renamed))).toBe(true)
    expect([a, b, c].map((i) => i!.state)).toEqual(['taken', 'taken', 'taken'])
  })

  it('收下归类后在外面改名、同时添了几句（短笔记，git 认不出是改名）再撤回：照样说「改名成了」，不说「被删了」', async () => {
    const r = (await dream()) as DreamReportInternal
    const it = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/冰洞.md')!
    await takeItem(root, r, it.id)
    const to = join(root, it.move!.to)
    const renamed = join(dirname(to), '冰岛冰洞.md')
    writeFileSync(renamed, readFileSync(to, 'utf8') + '\n去之前看天气预报，零下十度要穿雪地靴。\n导游会给冰爪和头盔，不用自己带。\n')
    rmSync(to)
    await expect(undo(root, r, [it.id], it.taken)).rejects.toThrow('撤回不了：「冰洞」收下以后改名成了「冰岛冰洞」，什么都没动')
    expect(existsSync(renamed)).toBe(true)
    expect(g(root, 'status', '--porcelain')).toBe('')
  })

  // 第 6 轮：收件箱随手记只有 4 行（3 行 front matter），改一行就只剩 75% 的行原样在；按字比还在九成以上
  for (const [how, edit] of [
    ['把「提前两周订」改成「提前三周订」', (t: string) => t.replace('提前两周订', '提前三周订')],
    ['在「冰洞只在冬天开放」后面插一段、末尾再添一句', (t: string) => t.replace('冰洞只在冬天开放，', '冰洞只在冬天开放（十一月到三月，暖冬会提前关），') + '记得带备用手套。\n'],
  ] as const)
    it(`收下归类后在外面改名、同时${how}再撤回：按内容相似认出是改名，说「改名成了」`, async () => {
      const r = (await dream()) as DreamReportInternal
      const it = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/冰洞.md')!
      await takeItem(root, r, it.id)
      const to = join(root, it.move!.to)
      const renamed = join(dirname(to), '冰岛冰洞.md')
      writeFileSync(renamed, edit(readFileSync(to, 'utf8')))
      rmSync(to)
      await expect(undo(root, r, [it.id], it.taken)).rejects.toThrow('撤回不了：「冰洞」收下以后改名成了「冰岛冰洞」，什么都没动')
      expect(existsSync(renamed)).toBe(true)
    })

  it('收下归类后在外面删了、另建了一篇不相干的短笔记再撤回：还说「被删了」，不把不相干的那篇当成改名', async () => {
    const r = (await dream()) as DreamReportInternal
    const it = r.items.find((i) => i.group === 'file' && i.files[0] === '收件箱/冰洞.md')!
    await takeItem(root, r, it.id)
    rmSync(join(root, it.move!.to))
    writeFileSync(join(root, '剪藏/旅行/蓝湖.md'), '---\ncreated: 2026-11-16 09:00\n---\n蓝湖要提前订票，下午人少。\n')
    await expect(undo(root, r, [it.id], it.taken)).rejects.toThrow('撤回不了：「冰洞」收下以后被删了，什么都没动')
  })

  it('导入几百条旧笔记：双链最多补 LINK_MAX 处、重复最多列 DUP_MAX 对，挑最像的，剩下的报告里说一句', async () => {
    // 60 条讲同一件事的「旧笔记」，彼此相似、也和库里的一篇相似
    for (let i = 1; i <= 60; i++) {
      mkdirSync(join(root, '收件箱/导入/备忘录'), { recursive: true })
      writeFileSync(join(root, `收件箱/导入/备忘录/冰岛 ${i}.md`), `第${i}次想去冰岛看极光，冰洞只在冬天开放，环岛自驾要租四驱车，${'第'.repeat(i % 7)}${i}号笔记写了些别的话。\n`)
    }
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '导入')
    const r = await dream()
    expect(r.items.filter((i) => i.group === 'link').length).toBeLessThanOrEqual(LINK_MAX)
    expect(r.items.filter((i) => i.group === 'dup')).toHaveLength(DUP_MAX)
    const scores = r.items.filter((i) => i.group === 'dup').map((i) => Number(/^相似度(\d+)%$/.exec(i.sub)![1]))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(r.notes.some((n) => /^还有 \d+ 对可能重复的没列出来/.test(n))).toBe(true)
  })

  it('同一天再梦游一次，分支叫 dream/11-15-2', async () => {
    await dream()
    const r = await dream()
    expect(r.branch).toBe('dream/11-15-2')
  })

  it('没什么可整理时不留分支', async () => {
    rmSync(join(root, '收件箱'), { recursive: true })
    rmSync(join(root, '剪藏'), { recursive: true })
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '清空')
    const r = await dream(async () => '')
    expect(r.items).toEqual([])
    expect(r.closed).toBe(true)
    expect(g(root, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()).toBe('')
  })
})

describe('diff -U0 片段解析', () => {
  it('新文件、挪动（以新路径为准）', () => {
    const out = [
      'diff --git a/周记/2026-W46.md b/周记/2026-W46.md',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/周记/2026-W46.md',
      '@@ -0,0 +1,2 @@',
      '+# 2026-W46 小结',
      '+这周。',
      'diff --git a/收件箱/冰 洞.md b/剪藏/旅行/冰 洞.md',
      'similarity index 90%',
      'rename from 收件箱/冰 洞.md',
      'rename to 剪藏/旅行/冰 洞.md',
      '@@ -3 +3 @@',
      '-旧的',
      '+新的',
      '',
    ].join('\n')
    expect(parseHunks(out)).toEqual(
      new Map([
        ['周记/2026-W46.md', [{ oldStart: 0, newStart: 1, del: [], add: ['# 2026-W46 小结', '这周。'] }]],
        ['剪藏/旅行/冰 洞.md', [{ oldStart: 3, newStart: 3, del: ['旧的'], add: ['新的'] }]],
      ]),
    )
  })
})

describe('同一个视频散在几篇里（CN-80）', () => {
  it('按视频卡、时刻、问答和属性「视频」认；两篇以上才算；字幕全文和视频里的疑惑不算', () => {
    const moment = (id: string) => `<!-- moment video=youtube:${id} t=7 -->\n[▶ 00:07 · 赛百味为什么又贵又难吃](https://www.youtube.com/watch?v=${id}&t=7s)`
    const texts = new Map([
      ['又贵又难吃的赛百味.md', `---\n视频: https://www.youtube.com/watch?v=subway00001\n---\n\n# 赛百味\n`],
      ['写作/快餐.md', `# 快餐\n\n${moment('subway00001')}\n`],
      ['课程/a.md', `# a\n\n${moment('other000001')}\n`],
      ['剪藏/视频/赛百味为什么又贵又难吃.md', `# x\n\n${moment('subway00001')}\n`],
      ['视频里的疑惑.md', `---\n生成: 软件\n---\n\n${moment('subway00001')}\n`],
    ])
    expect(sameVideoNotes(texts)).toEqual([{ key: 'youtube:subway00001', title: '赛百味为什么又贵又难吃', files: ['写作/快餐.md', '又贵又难吃的赛百味.md'] }])
  })
})

describe('老图挪进各篇自己的附件文件夹', { timeout: 30_000 }, () => {
  it('一条「附件」：分支上一次提交挪图、改链接；收下进 main（图不改名，别的字不动），共用的、没人用的、收件箱里用的留原处；撤回回到原样', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    mkdirSync(join(root, '附件'), { recursive: true })
    mkdirSync(join(root, '课程/ecp'), { recursive: true })
    for (const n of [1, 2, 12, 30, 40]) writeFileSync(join(root, `附件/image-${n}.png`), png)
    const note = '# Lecture05 笔记\n\n![](../../附件/image-1.png)\n\n## 符号\n\n![图二](../../附件/image-2.png) ![](../../附件/image-12.png)\n'
    writeFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), note)
    writeFileSync(join(root, '所思所想.md'), DREAM_VAULT['所思所想.md'] + '\n![](附件/image-12.png)\n')
    writeFileSync(join(root, '收件箱/速记.md'), '速记 ![](../附件/image-40.png)\n')
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '老图')
    const before = g(root, 'rev-parse', 'HEAD').trim()
    const r = (await dream()) as DreamReportInternal
    const it = r.items.find((i) => i.group === 'attach')!
    expect(r.items[0]).toBe(it)
    expect(it.title).toBe('把2张老图挪进各篇自己的附件文件夹')
    expect(it.sub).toBe('改1篇里的链接')
    expect(it.oldImages!.moves.map((m) => [m.from, m.to, m.section])).toEqual([
      ['附件/image-1.png', '附件/课程/ecp/Lecture05 笔记/image-1.png', 'Lecture05 笔记'],
      ['附件/image-2.png', '附件/课程/ecp/Lecture05 笔记/image-2.png', '符号'],
    ])
    expect(it.oldImages!.kept.map((k) => [k.path, k.why])).toEqual([
      ['附件/image-12.png', 'shared'],
      ['附件/image-30.png', 'unused'],
      ['附件/image-40.png', 'inbox'],
    ])
    expect(it.oldImages!.examples).toEqual([{ note: '课程/ecp/Lecture05 笔记.md', before: '![](../../附件/image-1.png)', after: '![](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)', count: 2 }])
    // main 没动
    expect(existsSync(join(root, '附件/image-1.png'))).toBe(true)
    await takeItem(root, r, it.id)
    expect(existsSync(join(root, '附件/image-1.png'))).toBe(false)
    expect(readFileSync(join(root, '附件/课程/ecp/Lecture05 笔记/image-1.png'))).toEqual(png)
    expect(readFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), 'utf8')).toBe(note.replace('../../附件/image-1.png', '../../附件/课程/ecp/Lecture05%20笔记/image-1.png').replace('../../附件/image-2.png', '../../附件/课程/ecp/Lecture05%20笔记/image-2.png'))
    for (const n of [12, 30, 40]) expect(existsSync(join(root, `附件/image-${n}.png`))).toBe(true)
    expect(g(root, 'status', '--porcelain')).toBe('')
    // 收下以后那篇开着接着打字（自动存了、还没提交）：撤回照样撤得回，打的字留着
    const typed = readFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), 'utf8').replace('# Lecture05 笔记', '# Lecture05 笔记（后来打的字）')
    writeFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), typed)
    // 撤回：一次反向提交，回到收下前的样子
    await undo(root, r, [it.id], it.taken)
    expect(g(root, 'diff', '--stat', before, 'HEAD', '--', '附件').trim()).toBe('')
    expect(readFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), 'utf8')).toBe(note.replace('# Lecture05 笔记', '# Lecture05 笔记（后来打的字）'))
    expect(g(root, 'status', '--porcelain')).toBe('')
    // 撤回的提交说明是中文
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('撤回梦游：把 2 张老图挪进各篇自己的附件文件夹，改 1 篇里 2 处链接')
  })

  /** 第 3 轮：收下挪老图、在图那一行后面接着打字，再撤回 */
  async function takeOldImages() {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    mkdirSync(join(root, '附件'), { recursive: true })
    mkdirSync(join(root, '课程/ecp'), { recursive: true })
    writeFileSync(join(root, '附件/image-1.png'), png)
    writeFileSync(join(root, '课程/ecp/Lecture05 笔记.md'), '# Lecture05 笔记\n\n![](../../附件/image-1.png)\n\n下面一段。\n')
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '老图')
    const r = (await dream()) as DreamReportInternal
    const it = r.items.find((i) => i.group === 'attach')!
    await takeItem(root, r, it.id)
    return { r, it, path: join(root, '课程/ecp/Lecture05 笔记.md'), moved: '![](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)' }
  }

  it('收下以后在图那一行后面接着打了字：撤回照样撤得回（同一行按字合并），图回原处、链接改回、打的字留着', async () => {
    const { r, it, path, moved } = await takeOldImages()
    expect(readFileSync(path, 'utf8')).toContain(moved)
    writeFileSync(path, readFileSync(path, 'utf8').replace(moved, moved + ' 图：这是比较静态的示意'))
    await undo(root, r, [it.id], it.taken)
    expect(readFileSync(path, 'utf8')).toBe('# Lecture05 笔记\n\n![](../../附件/image-1.png) 图：这是比较静态的示意\n\n下面一段。\n')
    expect(existsSync(join(root, '附件/image-1.png'))).toBe(true)
    expect(existsSync(join(root, '附件/课程/ecp/Lecture05 笔记/image-1.png'))).toBe(false)
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toMatch(/^撤回梦游：把 1 张老图/)
    expect(existsSync(join(root, '.git/REVERT_HEAD'))).toBe(false)
  })

  it('收下以后把链接里挪过的那段路径也改了：合不了，什么都不动，提示说清楚怎么办', async () => {
    const { r, it, path, moved } = await takeOldImages()
    const edited = readFileSync(path, 'utf8').replace(moved, '![](../../附件/课程/ECP/Lecture05%20笔记/image-1.png)')
    writeFileSync(path, edited)
    const head = g(root, 'rev-parse', 'HEAD').trim()
    await expect(undo(root, r, [it.id], it.taken)).rejects.toThrow(/撤回不了：「Lecture05 笔记」里这次改过的地方后来又改了.*历史/)
    // 打的字先提交了一次，别的都没动、没卡在撤回中间
    expect(g(root, 'rev-parse', 'HEAD~1').trim()).toBe(head)
    expect(readFileSync(path, 'utf8')).toBe(edited)
    expect(existsSync(join(root, '附件/课程/ecp/Lecture05 笔记/image-1.png'))).toBe(true)
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(root, '.git/REVERT_HEAD'))).toBe(false)
  })
})


describe('梦游被打断留下的分支', { timeout: 30_000 }, () => {
  it('上次梦游被 ⌘Q 打断：半截的 dream/ 分支和临时检出在下次梦游前清掉，下次照旧用 dream/11-15，不再叫 dream/11-15-2；开着的报告的分支留着', async () => {
    // 被打断的那次：分支、临时检出、半截提交都在，报告没存下
    const wt = join(scratch, 'dream-old')
    mkdirSync(scratch, { recursive: true })
    g(root, 'worktree', 'add', '-q', '-b', 'dream/11-15', wt, 'HEAD')
    writeFileSync(join(wt, '半截.md'), '半截\n')
    g(wt, 'add', '-A')
    g(wt, 'commit', '-qm', '梦游：半截')
    g(root, 'branch', 'dream/11-14', 'HEAD')
    expect(await clearStrayDreams(root, 'dream/11-14')).toEqual(['dream/11-15'])
    expect(g(root, 'branch', '--list', 'dream/*').trim().split('\n').map((b) => b.trim())).toEqual(['dream/11-14'])
    expect(existsSync(wt)).toBe(false)
    expect(g(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    const r = await dream()
    expect(r.branch).toBe('dream/11-15')
  })
})
