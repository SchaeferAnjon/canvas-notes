import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { movedText, relinkText } from '../src/main/dream-file'
import { cleanName, FILE_BATCH, foldersOf, inboxEntry, parsePlan, planInBatches, targetOf, validFolder } from '../src/shared/filing'
import { type Ask, type DreamReportInternal, dropMany, redo, runDream, takeAll, takeMany, undo } from '../src/main/dream'
import { diffOf } from '../src/main/diff'

describe('归类和改名：纯函数', () => {
  it('去处只能是 课程/<课>、项目/<项目>、生活、写作、剪藏/<主题>', () => {
    for (const ok of ['课程/线性代数', '项目/毕业设计', '生活', '写作', '剪藏/旅行']) expect(validFolder(ok)).toBe(true)
    for (const bad of ['课程', '课程/a/b', '../外面', '收件箱', '剪藏/../x', '课程/.git', '我写的', '写作/草稿', '/生活', '课程/ 空格']) expect(validFolder(bad)).toBe(false)
  })

  it('新名字去掉文件名里不能有的字符；读方案只认收件箱里有的、去处合规的、第一次的', () => {
    expect(cleanName('第3讲: 线性映射.md')).toBe('第3讲 线性映射')
    expect(cleanName('  ')).toBeNull()
    expect(cleanName(null)).toBeNull()
    const reply = '```json\n' + JSON.stringify([
      { path: '收件箱/a.md', folder: '课程/线性代数', name: '第3讲 导图', why: '属性里写着' },
      { path: '收件箱/a.md', folder: '生活' },
      { path: '所思所想.md', folder: '生活' },
      { path: '收件箱/b.md', folder: '../外面' },
      { path: '收件箱/c.md', folder: '收件箱' },
      { path: '收件箱/d.md', folder: '写作/', name: 'd' },
    ]) + '\n```'
    const plans = parsePlan(reply, ['收件箱/a.md', '收件箱/b.md', '收件箱/c.md', '收件箱/d.md'])
    expect(plans).toEqual([
      { path: '收件箱/a.md', folder: '课程/线性代数', name: '第3讲 导图', why: '属性里写着' },
      { path: '收件箱/d.md', folder: '写作', name: null, why: '' },
    ])
    expect(parsePlan(reply, ['收件箱/c.md'], true)).toEqual([{ path: '收件箱/c.md', folder: '收件箱', name: null, why: '' }])
    expect(targetOf({ path: '收件箱/IMG_2041.pdf', folder: '课程/概率论', name: '第2讲 条件概率', why: '' })).toBe('课程/概率论/第2讲 条件概率.pdf')
    expect(() => parsePlan('没有 JSON', [])).toThrow('没给出能用的整理方案')
  })

  it('挪过去：开头的标题是旧名就换新名，相对链接按新位置重算，别的不动', () => {
    const t = '---\n类型: 导图\n---\n# 导图 11-15 21∶40\n\n![原照片](../附件/导图/a.jpg)\n\n- [网页](https://x.com/a) [别的](../写作/b.md) [锚](#x)\n# 导图 11-15 21∶40\n'
    const out = movedText(t, '收件箱/导图 11-15 21∶40.md', '课程/线性代数/第3讲 导图.md')
    expect(out).toBe('---\n类型: 导图\n---\n# 第3讲 导图\n\n![原照片](../../附件/导图/a.jpg)\n\n- [网页](https://x.com/a) [别的](../../写作/b.md) [锚](#x)\n# 导图 11-15 21∶40\n')
    // 同一个文件夹里改名：链接不动
    expect(movedText('# a\n![x](../附件/p.png)\n', '收件箱/a.md', '收件箱/b.md')).toBe('# b\n![x](../附件/p.png)\n')
  })

  it('别的笔记里的双链换成新名', () => {
    expect(relinkText('看 [[导图 1]]、[[导图 1|那张]]、[[导图 1#核]]，[[导图 10]] 不动', '导图 1', '第3讲')).toBe('看 [[第3讲]]、[[第3讲|那张]]、[[第3讲#核]]，[[导图 10]] 不动')
  })

  it('库里已有的去处', () => {
    expect(foldersOf(['课程/线性代数/a.md', '课程/a.md', '生活/x.md', '剪藏/旅行/y.md', '写作/z.md', '我写的.md', '项目/毕设/p/q.md', '阅读/人类简史.md', '周记/第46周.md'])).toEqual(['剪藏/旅行', '课程/线性代数', '生活', '项目/毕设', '写作', '阅读', '周记'])
  })

  it('收件箱里的一条给 AI 看什么：剪来的带「剪自」网址（来源行在预览里是去掉的），别的藏起来的属性不给；不是文字的只给类型和文件名', () => {
    const clip = '---\ncreated: 2026-11-14 21:10\nsource: https://safetravel.is/ice-caves\n课程: 地理\n---\n> 冰洞只在冬天开放\n\n—— [Ice caves](https://safetravel.is/ice-caves)\n'
    expect(inboxEntry('收件箱/冰洞.md', clip)).toEqual({ path: '收件箱/冰洞.md', preview: '冰洞只在冬天开放', props: '剪自: https://safetravel.is/ice-caves；课程: 地理' })
    expect(inboxEntry('收件箱/想法.md', '---\ncreated: 2026-11-15\n---\n这周要写进周记的\n')).toEqual({ path: '收件箱/想法.md', preview: '这周要写进周记的', props: '' })
    expect(inboxEntry('收件箱/空的.md', '')).toEqual({ path: '收件箱/空的.md', preview: '空的', props: '' })
    expect(inboxEntry('收件箱/IMG_2041.pdf', undefined)).toEqual({ path: '收件箱/IMG_2041.pdf', preview: '（pdf 文件）IMG_2041.pdf', props: '' })
  })
})

// ---------- 在真的 Git 仓库里跑 ----------

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n---\n# 导图 11-15 21∶40\n\n![原照片](../附件/导图/a.jpg)\n\n- 线性映射\n'
const VAULT: Record<string, string> = {
  '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n',
  '复习.md': '---\ntype: board\n---\n# 复习\n\n<!-- card id=a1 x=0 y=0 w=280 -->\n[[导图 11-15 21∶40]]\n',
  '收件箱/导图 11-15 21∶40.md': MAP,
  '附件/导图/a.jpg': 'jpg',
  '收件箱/周末去花市.md': '周末去花市买绣球，顺便看看多肉。\n',
  '收件箱/说不好的.md': '一句说不好放哪的话。\n',
}

/** 测试用的 AI：导图进线性代数并改名，花市进生活；说不好的不列（留在收件箱） */
const ask: Ask = async (_s, prompt) => {
  if (prompt.startsWith('命令：本周小结')) return ''
  if (prompt.startsWith('命令：归类和改名'))
    return '```json\n' + JSON.stringify([
      { path: '收件箱/导图 11-15 21∶40.md', folder: '课程/线性代数', name: '第3讲 线性映射 导图', why: '属性里写着课程和第 3 讲' },
      { path: '收件箱/周末去花市.md', folder: '生活', name: '周末花市', why: '日常的事' },
    ]) + '\n```'
  if (prompt.startsWith('命令：按反馈重做归类')) {
    const said = /说：「([^」]*)」/.exec(prompt)![1]!
    if (said.includes('写作')) return '```json\n' + JSON.stringify([{ path: '收件箱/周末去花市.md', folder: '写作', name: '花市', why: '随笔放写作' }]) + '\n```'
    if (said.includes('留在收件箱')) return '```json\n' + JSON.stringify([{ path: '收件箱/周末去花市.md', folder: '收件箱', name: null, why: '先留着' }]) + '\n```'
    return '```json\n[]\n```'
  }
  throw new Error('没想到的提问：' + prompt.slice(0, 20))
}

let base: string
let root: string
let scratch: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-file-'))
  root = join(base, '库')
  scratch = join(base, 'scratch')
  mkdirSync(root)
  g(root, 'init', '-q', '-b', 'main')
  g(root, 'config', 'user.name', 'Test')
  g(root, 'config', 'user.email', 'test@example.com')
  for (const [p, t] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-qm', '样本')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const dream = () => runDream({ root, scratch, ask, trigger: 'manual', now: new Date(2026, 10, 16, 3, 0) }) as Promise<DreamReportInternal>
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const count = () => Number(g(root, 'rev-list', '--count', 'HEAD').trim())
const NEW_MAP = '课程/线性代数/第3讲 线性映射 导图.md'

describe('归类和改名：在梦游分支上', { timeout: 30_000 }, () => {
  it('挪进课程并改名：标题、图片链接、别处的双链在同一个提交里跟着改；拿不准的留着；main 不动', async () => {
    const r = await dream()
    const files = r.items.filter((i) => i.group === 'file')
    expect(files.map((i) => [i.title, i.sub])).toEqual([
      ['第3讲 线性映射 导图', '从收件箱挪来 · 原名「导图 11-15 21∶40」'],
      ['周末花市', '从收件箱挪来 · 原名「周末去花市」'],
    ])
    expect(r.stay).toBe(1)
    // main 上什么都没变
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(read('收件箱/导图 11-15 21∶40.md')).toBe(MAP)
    // 分支上那次提交：挪、改标题、改图片链接、复习.md 里的双链
    const c = files[0]!.commit!
    const changed = g(root, 'show', '--format=', '--name-status', '-M', c).trim().split('\n').map((l) => l.replace(/^R\d+/, 'R')).sort()
    expect(changed).toEqual([`M\t复习.md`, `R\t收件箱/导图 11-15 21∶40.md\t${NEW_MAP}`].sort())
    const moved = g(root, 'show', `${c}:${NEW_MAP}`)
    expect(moved).toContain('# 第3讲 线性映射 导图\n\n![原照片](../../附件/导图/a.jpg)')
    expect(g(root, 'show', `${c}:复习.md`)).toContain('[[第3讲 线性映射 导图]]')
    const d = (await diffOf(root, { kind: 'dream', id: files[0]!.id }, r)).files
    expect(d.find((f) => f.path === NEW_MAP)).toMatchObject({ status: 'moved', from: '收件箱/导图 11-15 21∶40.md' })
  })

  it('一组收下是一次提交；撤回是反向提交、文件回到收件箱原名，再收下也行', async () => {
    const r = await dream()
    const ids = r.items.filter((i) => i.group === 'file').map((i) => i.id)
    const before = count()
    const hash = await takeMany(root, r, ids)
    expect(count()).toBe(before + 1)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('收下梦游的归类和改名：2 处')
    expect(existsSync(join(root, NEW_MAP))).toBe(true)
    expect(read('生活/周末花市.md')).toBe(VAULT['收件箱/周末去花市.md'])
    expect(read('复习.md')).toContain('[[第3讲 线性映射 导图]]')
    expect(r.items.filter((i) => ids.includes(i.id)).every((i) => i.taken === hash)).toBe(true)

    const back = await undo(root, r, ids, hash!)
    expect(back).toMatch(/^[0-9a-f]{40}$/)
    // 撤回的说明是中文（第 3 轮：历史里是「Revert "…"」）
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('撤回梦游的归类和改名：2 处')
    expect(read('收件箱/导图 11-15 21∶40.md')).toBe(MAP)
    expect(read('复习.md')).toContain('[[导图 11-15 21∶40]]')
    expect(existsSync(join(root, '生活/周末花市.md'))).toBe(false)
    expect(r.items.filter((i) => ids.includes(i.id)).map((i) => i.state)).toEqual(['pending', 'pending'])
    // 分支已经删了（都处理完那次），提交还在，再收下照样行
    await takeMany(root, r, ids)
    expect(existsSync(join(root, NEW_MAP))).toBe(true)
    expect(g(root, 'status', '--porcelain')).toBe('')
  })

  it('丢掉一组再撤回：回到待看', async () => {
    const r = await dream()
    const ids = r.items.filter((i) => i.group === 'file').map((i) => i.id)
    await dropMany(root, r, ids)
    expect(r.items.filter((i) => ids.includes(i.id)).map((i) => i.state)).toEqual(['dropped', 'dropped'])
    await undo(root, r, ids)
    expect(r.items.filter((i) => ids.includes(i.id)).map((i) => i.state)).toEqual(['pending', 'pending'])
    await expect(undo(root, r, ids)).rejects.toThrow('没丢掉')
  })

  it('跟 AI 说哪里不对：分支上多一次提交，收下时一起合进来；说留在收件箱的算丢掉', async () => {
    const r = await dream()
    const flower = r.items.find((i) => i.title === '周末花市')!
    const map = r.items.find((i) => i.title === '第3讲 线性映射 导图')!
    const changed = await redo(root, r, [flower.id, map.id], '速记放 写作 下面', ask, scratch)
    expect(changed).toBe(1)
    expect(flower.move).toEqual({ from: '收件箱/周末去花市.md', to: '写作/花市.md' })
    expect(flower.redo).toBe('速记放 写作 下面')
    expect(flower.why).toBe('你说「速记放 写作 下面」，随笔放写作')
    expect(flower.redoCommits).toHaveLength(1)
    expect(map.redoCommits).toBeUndefined()
    // 改了什么：从收件箱直接到写作（这一句照真改动说，task-m552v；「按你说的」在小卡的标签上）
    const d = (await diffOf(root, { kind: 'dream', id: flower.id }, r)).files
    expect(d).toEqual([expect.objectContaining({ path: '写作/花市.md', from: '收件箱/周末去花市.md', status: 'moved', summary: '挪到写作并改名' })])
    await takeMany(root, r, [flower.id])
    expect(read('写作/花市.md')).toBe(VAULT['收件箱/周末去花市.md'])
    expect(existsSync(join(root, '生活'))).toBe(false)

    const again = await redo(root, r, [map.id], '留在收件箱', ask, scratch).catch((e: Error) => e.message)
    expect(again).toBe(0)
  })

  it('说留在收件箱：那一条挪回去、算丢掉', async () => {
    const r = await dream()
    const flower = r.items.find((i) => i.title === '周末花市')!
    expect(await redo(root, r, [flower.id], '留在收件箱', ask, scratch)).toBe(1)
    expect(flower.state).toBe('dropped')
    expect(flower.sub).toBe('按你说的留在收件箱')
    await takeAll(root, r)
    expect(existsSync(join(root, '收件箱/周末去花市.md'))).toBe(true)
  })

  it('都处理完、分支删了以后撤回，还能接着重做（按最后一次提交重建分支）', async () => {
    const r = await dream()
    const ids = r.items.filter((i) => i.group === 'file').map((i) => i.id)
    const hash = await takeMany(root, r, ids)
    expect(r.closed).toBe(true)
    await undo(root, r, ids, hash!)
    const flower = r.items.find((i) => i.title === '周末花市')!
    expect(await redo(root, r, [flower.id], '速记放 写作 下面', ask, scratch)).toBe(1)
    expect(r.closed).toBe(false)
    await takeAll(root, r)
    expect(read('写作/花市.md')).toBe(VAULT['收件箱/周末去花市.md'])
    expect(r.closed).toBe(true)
    expect(g(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })
})

describe('归类和改名：大批量分批问', () => {
  it('每批最多 FILE_BATCH 条；第一批新开的去处告诉后面几批；一批出错只记一句，别的照常，结果按原来的顺序', async () => {
    const entries = Array.from({ length: FILE_BATCH * 3 + 5 }, (_, i) => ({ path: `收件箱/导入/备忘录/第${i}条.md`, preview: `内容 ${i}`, props: '' }))
    const asked: string[] = []
    const notes: string[] = []
    const plans = await planInBatches(
      entries,
      ['生活'],
      async (prompt) => {
        asked.push(prompt)
        const paths = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
        if (paths.includes(`收件箱/导入/备忘录/第${FILE_BATCH + 5}条.md`)) throw new Error('超时了')
        return '```json\n' + JSON.stringify(paths.map((path) => ({ path, folder: '课程/线性代数', name: null, why: '' }))) + '\n```'
      },
      (n) => notes.push(n),
    )
    expect(asked.map((p) => [...p.matchAll(/^路径：/gm)].length).sort((a, b) => b - a)).toEqual([FILE_BATCH, FILE_BATCH, FILE_BATCH, 5])
    // 第一批开的「课程/线性代数」后面几批都知道
    expect(asked[0]).toContain('优先用已有的：生活。')
    for (const p of asked.slice(1)) expect(p).toContain('优先用已有的：生活、课程/线性代数。')
    expect(notes).toEqual([`收件箱第 ${FILE_BATCH + 1}–${FILE_BATCH * 2} 条没归类：超时了`])
    expect(plans.map((p) => p.path)).toEqual(entries.filter((_, i) => i < FILE_BATCH || i >= FILE_BATCH * 2).map((e) => e.path))
  })
})
