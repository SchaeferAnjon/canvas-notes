// 梦游先读懂这个库怎么分（task-h7oy8）：推断角色、存成 .canvas-notes/梦游.md 再读回来、归类只挑已有文件夹、日记不连日记
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filePrompt, parsePlan, placesOf, validFolder } from '../src/shared/filing'
import { bareName, effectiveRoles, inferRoles, isFolderNote, nativeVault, needsConfirm, parseRolesMd, roleByName, roleOf, roleTicked, ROLES_FILE, rolesMd } from '../src/shared/vault-roles'
import { rolesOfVault, saveRoles, walkFiles } from '../src/main/dream-roles'
import { skipPair } from '../src/main/dream'
import { setVaultLang } from '../src/shared/i18n'

const roles = (files: Record<string, string>) => Object.fromEntries(inferRoles(Object.keys(files), new Map(Object.entries(files))).map((r) => [r.folder, r.role]))

describe('看名字认角色', () => {
  it('去掉编号、emoji、后缀；中英同义词；PARA；年份', () => {
    expect(bareName('00-Inbox')).toBe('Inbox')
    expect(bareName('📥 收集箱')).toBe('收集箱')
    expect(bareName('1. Projects')).toBe('Projects')
    expect(bareName('读书笔记')).toBe('读书')
    const cases: [string, string | null][] = [
      ['00-Inbox', 'inbox'],
      ['10-Journal', 'journal'],
      ['01daily', 'journal'],
      ['02weekly', 'weekly'],
      ['20-Projects', 'project'],
      ['30-Courses', 'course'],
      ['40-Clippings', 'clip'],
      ['60-Creative', 'writing'],
      ['80-Meta', 'meta'],
      ['1 Projects', 'project'],
      ['2 Areas', 'area'],
      ['3 Resources', 'resource'],
      ['4 Archives', 'archive'],
      ['2024', 'chrono'],
      ['Fleeting', 'inbox'],
      ['Zettelkasten', 'resource'],
      ['写作风格', null],
      ['Heidelberg', null],
    ]
    for (const [name, role] of cases) expect([name, roleByName(name)]).toEqual([name, role])
  })
})

describe('推断：名字、内容、首页', () => {
  it('Obsidian 编号库：首页的介绍、日期命名、来源网址、第二层的周记和阅读', () => {
    const files: Record<string, string> = {
      'Vault-Home.md': '# Home\n\n| 目录 | 放什么 |\n|---|---|\n| `00-Inbox` | 新笔记暂存 |\n| `50-Series` | 自己或 AI 系统写的学习系列 |\n| `70-Misc` | 别人写的文章，剪来的 |\n',
      '00-Inbox/README.md': '---\ntype: moc\n---\n# 规则\n',
      '00-Inbox/想法.md': '随手记',
      '10-Journal/01daily/2026/2026-09-06.md': '---\ntype: journal\n---\n日记',
      '10-Journal/01daily/2026/2026-09-07.md': '---\ntype: journal\n---\n日记',
      '10-Journal/02weekly/.gitkeep': '',
      '50-Series/欧洲史/01.md': '罗马',
      '50-Series/阅读/极简欧洲史.md': '---\nauthor: 布朗\n---\n读书',
      '70-Misc/a.md': '---\nsource: https://a.com/x\n---\na',
      '70-Misc/b.md': '---\nsource: https://b.com/y\n---\nb',
      'Notes/x.md': '---\nsource: https://c.com/z\n---\nx',
      'Notes/y.md': '---\nsource: https://d.com/w\n---\ny',
      'Excalidraw/Drawing.excalidraw.md': '画',
      'Pics/a.png': 'x',
      'Pics/b.png': 'x',
      'Pics/c.jpg': 'x',
    }
    const rows = inferRoles(Object.keys(files), new Map(Object.entries(files)))
    expect(Object.fromEntries(rows.map((r) => [r.folder, r.role]))).toEqual({
      '00-Inbox': 'inbox',
      '10-Journal': 'journal',
      '10-Journal/02weekly': 'weekly',
      '50-Series': 'resource',
      '50-Series/阅读': 'reading',
      '70-Misc': 'clip',
      Excalidraw: 'attach',
      Notes: 'clip',
      Pics: 'attach',
    })
    const misc = rows.find((r) => r.folder === '70-Misc')!
    expect(misc.why).toContain('说明里写着「别人写的文章')
    expect(misc.why).toContain('2篇里2篇带来源网址')
    // 只靠内容的：把握中等
    expect(rows.find((r) => r.folder === 'Notes')!.sure).toBe('mid')
  })

  it('PARA、按年份、画布笔记自己的库', () => {
    expect(roles({ '0 Inbox/a.md': '', '1 Projects/x/a.md': '', '2 Areas/健康/a.md': '', '3 Resources/摄影/a.md': '', '4 Archive/a.md': '', 'Templates/t.md': '{{date}}' })).toEqual({
      '0 Inbox': 'inbox',
      '1 Projects': 'project',
      '2 Areas': 'area',
      '3 Resources': 'resource',
      '4 Archive': 'archive',
      Templates: 'meta',
    })
    expect(roles({ 'Inbox/a.md': '', '2024/2024-03/a.md': '', '2024/2024-05/b.md': '', '2025/2025-01/c.md': '', '2025/2025-04/c.md': '' })).toEqual({ Inbox: 'inbox', '2024': 'chrono', '2025': 'chrono' })
    // 年份下面的月份不另列；下面按月份分的「Journal」还是日记
    expect(roles({ 'Journal/2024/a.md': '', 'Journal/2025/b.md': '' })).toEqual({ Journal: 'journal' })
    expect(roles({ '收件箱/a.md': '', '课程/线代/a.md': '', '剪藏/旅行/b.md': '', 附件: '' })).toEqual({ 收件箱: 'inbox', 课程: 'course', 剪藏: 'clip' })
  })

  it('看不出来的给「不确定」', () => {
    const rows = inferRoles(['Heidelberg/a.md', 'Heidelberg/b.md'], new Map())
    expect(rows).toEqual([{ folder: 'Heidelberg', role: 'unsure', why: '名字、内容、首页里都看不出来', sure: 'low' }])
  })

  it('文件夹自己的说明（README、同名、xx-MOC、type: moc）不归类挪走', () => {
    expect(isFolderNote('00-Inbox/README.md', '')).toBe(true)
    expect(isFolderNote('00-Inbox/00-Inbox.md', '')).toBe(true)
    expect(isFolderNote('20-Projects/20-Projects-MOC.md', '')).toBe(true)
    expect(isFolderNote('00-Inbox/总览.md', '---\ntype: moc\n---\n')).toBe(true)
    expect(isFolderNote('00-Inbox/冰洞.md', '冰洞只在冬天开')).toBe(false)
  })
})

describe('存成 .canvas-notes/梦游.md 再读回来', () => {
  afterEach(() => setVaultLang('zh'))

  it('一行一个文件夹带理由，确认过的日期；手改过的、英文的角色名、认不出的行', () => {
    const rows = [
      { folder: '00-Inbox', role: 'inbox' as const, why: '名字是「Inbox」', sure: 'high' as const },
      { folder: '10-Journal/02weekly', role: 'weekly' as const, why: '', sure: 'mid' as const },
      { folder: '30 Courses (old)', role: 'archive' as const, why: '你改的', sure: 'high' as const },
    ]
    const md = rolesMd({ rows, confirmed: '2026-11-23' })
    expect(md).toContain('确认过：2026-11-23')
    expect(md).toContain('- 00-Inbox：收件箱（名字是「Inbox」）')
    expect(md).toContain('- 10-Journal/02weekly：周记\n')
    const back = parseRolesMd(md)
    expect(back.confirmed).toBe('2026-11-23')
    expect(back.rows.map((r) => [r.folder, r.role, r.why])).toEqual([
      ['00-Inbox', 'inbox', '名字是「Inbox」'],
      ['10-Journal/02weekly', 'weekly', ''],
      ['30 Courses (old)', 'archive', '你改的'],
    ])
    // 手改：英文角色名、别称、认不出的角色、往外跳的路径、重复的
    const hand = parseRolesMd('- Inbox: Inbox\n- Daily：daily\n- 杂物：杂物\n- ../外面：课程\n- Inbox：剪藏\n* `Lit`：Reading（读书）\n')
    expect(hand.rows.map((r) => [r.folder, r.role])).toEqual([
      ['Inbox', 'inbox'],
      ['Daily', 'journal'],
      ['Lit', 'reading'],
    ])
    expect(hand.confirmed).toBeNull()
    // 英文库写英文
    setVaultLang('en')
    expect(rolesMd({ rows: rows.slice(0, 1), confirmed: null })).toContain('- 00-Inbox：Inbox（')
  })

  it('照文件走；文件里没写的新文件夹补推断（算猜的）；文件里写了上一层的不再补第二层', () => {
    const inferred = inferRoles(['00-Inbox/a.md', '10-Journal/2026-01-01.md', '10-Journal/02weekly/w.md', 'New/x.md'], new Map())
    const cfg = parseRolesMd('确认过：2026-11-23\n- 00-Inbox：收件箱\n- 10-Journal：归档\n- 已删的：课程\n')
    const v = effectiveRoles(cfg, inferred, ['00-Inbox/a.md', '10-Journal/2026-01-01.md', '10-Journal/02weekly/w.md', 'New/x.md'])
    expect(v.rows.map((r) => [r.folder, r.role])).toEqual([
      ['00-Inbox', 'inbox'],
      ['10-Journal', 'archive'],
      ['New', 'unsure'],
    ])
    expect(v.guessed).toEqual(['New'])
    expect(v.confirmed).toBe('2026-11-23')
    expect(needsConfirm(v)).toBe(false)
    // 没文件：都是猜的；画布笔记自带的分类不算猜的（自己的库不烦人）
    const none = effectiveRoles(null, inferRoles(['收件箱/a.md', '剪藏/b/c.md'], new Map()), ['收件箱/a.md', '剪藏/b/c.md'])
    expect(needsConfirm(none)).toBe(false)
    expect(needsConfirm(effectiveRoles(null, inferred, ['00-Inbox/a.md']))).toBe(true)
  })
})

describe('用：归类只挑已有文件夹、补双链补在哪、日记不连日记', () => {
  it('别人的库：去处只有已有的文件夹（课程、项目下面能新建一层），不出现没有的「课程」「生活」', () => {
    const files = ['00-Inbox/a.md', '20-Projects/问库/x.md', '30-Courses/Heidelberg/2026SS/CC/a.md', '40-Clippings/AI/a.md', '80-Meta/模板/t.md', '90-Archive/old.md', 'Pics/a.png']
    const rows = inferRoles(files, new Map())
    expect(nativeVault(rows)).toBe(false)
    const places = placesOf(files, rows)
    expect(places.map((p) => p.folder)).toEqual(['20-Projects', '20-Projects/问库', '30-Courses', '30-Courses/Heidelberg', '30-Courses/Heidelberg/2026SS', '30-Courses/Heidelberg/2026SS/CC', '40-Clippings', '40-Clippings/AI'])
    expect(validFolder('30-Courses/Heidelberg/2026SS/HPDC', places)).toBe(true)
    expect(validFolder('课程/线代', places)).toBe(false)
    expect(validFolder('生活', places)).toBe(false)
    expect(validFolder('90-Archive', places)).toBe(false)
    expect(validFolder('80-Meta/模板', places)).toBe(false)
    expect(validFolder('30-Courses/Heidelberg/2026SS/CC/新/再新', places)).toBe(false)
    const prompt = filePrompt([{ path: '00-Inbox/a.md', preview: 'x', props: '' }], places)
    expect(prompt).toContain('- 30-Courses/Heidelberg/2026SS/CC｜课程｜1 篇，如：a｜能新建一层')
    expect(prompt).toContain('- 30-Courses｜课程｜还没有笔记｜只放子文件夹｜能新建一层')
    expect(prompt).not.toContain('生活')
    // AI 说的不在表里的去处不认；新建的一层标 fresh
    const stays: { path: string; why: string }[] = []
    const plans = parsePlan(
      '```json\n' + JSON.stringify([{ path: '00-Inbox/a.md', folder: '课程/线代' }, { path: '00-Inbox/b.md', folder: '30-Courses/Heidelberg/2026SS/HPDC', why: '高性能计算' }, { path: '00-Inbox/c.md', folder: null, why: '看不出是哪门课' }]) + '\n```',
      ['00-Inbox/a.md', '00-Inbox/b.md', '00-Inbox/c.md'],
      { places, stays },
    )
    expect(plans).toEqual([{ path: '00-Inbox/b.md', folder: '30-Courses/Heidelberg/2026SS/HPDC', name: null, why: '高性能计算', fresh: true }])
    expect(stays).toEqual([{ path: '00-Inbox/c.md', why: '看不出是哪门课' }])
  })

  it('按年份的库：月份文件夹能直接放，年份下面能新建一个月', () => {
    const files = ['Inbox/a.md', '2025/2025-03/a.md', '2026/2026-10/b.md']
    const places = placesOf(files, inferRoles(files, new Map()))
    expect(validFolder('2026/2026-10', places)).toBe(true)
    expect(validFolder('2026/2026-11', places)).toBe(true)
    expect(validFolder('2026', places)).toBe(false)
    expect(filePrompt([{ path: 'Inbox/a.md', preview: 'x', props: 'created: 2026-11-03' }], places)).toContain('照笔记自己的日期')
  })

  it('补双链补在角色对应的分类勾着的文件夹；日记连日记、连模板不提', () => {
    const rows = inferRoles(['00-Inbox/a.md', '40-Clippings/b.md', '30-Courses/c/d.md', '10-Journal/2026-01-01.md'], new Map())
    const ticked = ['收件箱', '阅读', '剪藏', '周记'] as const
    expect(roleTicked(rows, [...ticked], '00-Inbox/a.md')).toBe('收件箱')
    expect(roleTicked(rows, [...ticked], '40-Clippings/b.md')).toBe('剪藏')
    expect(roleTicked(rows, [...ticked], '30-Courses/c/d.md')).toBeNull()
    expect(roleTicked(rows, [...ticked, '课程'], '30-Courses/c/d.md')).toBe('课程')
    expect(roleTicked(rows, [...ticked], '10-Journal/2026-01-01.md')).toBeNull()
    expect(roleOf(rows, '10-Journal/2026-01-01.md')).toBe('journal')
    expect(skipPair('journal', 'journal')).toBe(true)
    expect(skipPair('journal', 'weekly')).toBe(true)
    expect(skipPair('inbox', 'journal')).toBe(false)
    expect(skipPair('clip', 'meta')).toBe(true)
    expect(skipPair('clip', 'course')).toBe(false)
  })
})

describe('主进程：读库、确认写文件并提交', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('设置页那一份：没文件时照推断；确认后写 .canvas-notes/梦游.md、一次提交，再读是确认过的', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-roles-'))
    const files: Record<string, string> = { '00-Inbox/a.md': 'a', '30-Courses/ML/b.md': 'b', '.obsidian/app.json': '{}', 'Home.md': '# Home\n' }
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), t)
    }
    execFileSync('git', ['init', '-q', '-b', 'main', dir])
    execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@e', 'add', '-A'])
    execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-qm', 'x'])
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T'])
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@e'])
    expect(await walkFiles(dir)).toEqual(['00-Inbox/a.md', '30-Courses/ML/b.md', 'Home.md'])
    const v = await rolesOfVault(dir)
    expect(v.rows.map((r) => [r.folder, r.role])).toEqual([
      ['00-Inbox', 'inbox'],
      ['30-Courses', 'course'],
    ])
    expect(v.confirmed).toBeNull()
    expect(v.guessed).toEqual(['00-Inbox', '30-Courses'])
    // 用户把 30-Courses 改成归档、确认
    writeFileSync(join(dir, '00-Inbox/没提交的.md'), '别跟着进这次提交')
    const { commit } = await saveRoles(dir, [v.rows[0]!, { ...v.rows[1]!, role: 'archive', why: '你改的' }], new Date(2026, 10, 23))
    expect(commit).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(dir, ROLES_FILE), 'utf8')).toContain('确认过：2026-11-23\n\n- 00-Inbox：收件箱')
    expect(execFileSync('git', ['-C', dir, 'show', '--name-only', '--format=%s', 'HEAD'], { encoding: 'utf8' }).trim().split('\n')).toEqual(['梦游：确认这个库怎么分（2 个文件夹）', '', ROLES_FILE])
    const again = await rolesOfVault(dir)
    expect(again.confirmed).toBe('2026-11-23')
    expect(again.rows.find((r) => r.folder === '30-Courses')!.role).toBe('archive')
    expect(again.guessed).toEqual([])
    // 「重新认一遍」：不看文件
    expect((await rolesOfVault(dir, true)).rows.find((r) => r.folder === '30-Courses')!.role).toBe('course')
  })
})

// 真库、测试库上看推断（CN_ROLES_VAULT=<库>，每行写进 CN_ROLES_OUT；平时跳过）
describe.skipIf(!process.env.CN_ROLES_VAULT)('真库上推断', () => {
  it('打出每个文件夹的角色', async () => {
    const t0 = Date.now()
    const v = await rolesOfVault(process.env.CN_ROLES_VAULT!, true)
    writeFileSync(process.env.CN_ROLES_OUT ?? join(tmpdir(), 'cn-roles.txt'), `推断 ${Date.now() - t0} 毫秒\n` + v.rows.map((r) => `${r.folder} → ${r.role}（${r.sure}）${r.why}`).join('\n') + '\n')
  })
})
