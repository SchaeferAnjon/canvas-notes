import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localStamp, safeName, Vault } from '../src/main/vault'

/** 慢盘：写 md 前先等这么多毫秒（量改名插进写中间的竞态） */
const disk = vi.hoisted(() => ({ slowWrite: 0 }))
vi.mock('node:fs/promises', async (orig) => {
  const fsp = await orig<typeof import('node:fs/promises')>()
  return {
    ...fsp,
    writeFile: async (...a: Parameters<typeof fsp.writeFile>) => {
      if (disk.slowWrite && String(a[0]).endsWith('.md')) await new Promise((r) => setTimeout(r, disk.slowWrite))
      return fsp.writeFile(...a)
    },
  }
})
import { kindOf, previewOf } from '../src/shared/layout'

let root: string
let v: Vault
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-vault-'))
  v = new Vault(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('路径不许跑出库外', () => {
  expect(() => v.abs('../外面.md')).toThrow('库外')
  expect(() => v.abs('/etc/passwd')).toThrow('库外')
  expect(v.abs('收件箱/a.md')).toBe(join(root, '收件箱/a.md'))
})

it('新建：名字重了加序号，文件名里的怪字符换掉', async () => {
  expect(await v.create('', '未命名', '')).toBe('未命名.md')
  expect(await v.create('', '未命名', '')).toBe('未命名 2.md')
  expect(await v.create('', 'a/b:c?', 'x')).toBe('a b c.md')
  expect(safeName('  ..  ')).toBe('未命名')
})

it('新建：同一个文件夹连着建十篇「未命名」，每篇的标题都和文件名一样（第 3 篇起不再写成「未命名 2」）', async () => {
  for (let i = 1; i <= 10; i++) {
    const rel = await v.create('收件箱', '未命名', '# 未命名\n\n')
    const title = i === 1 ? '未命名' : `未命名 ${i}`
    expect(rel).toBe(`收件箱/${title}.md`)
    expect(readFileSync(join(root, rel), 'utf8')).toBe(`# ${title}\n\n`)
  }
})

it('改名：同一个文件夹里，重名报错', async () => {
  await v.create('', '甲', '内容\n')
  await v.create('', '乙', '')
  expect(await v.rename('甲.md', '丙')).toBe('丙.md')
  expect(readFileSync(join(root, '丙.md'), 'utf8')).toBe('内容\n')
  await expect(v.rename('丙.md', '乙')).rejects.toThrow('已经有一篇叫「乙」了')
  // 标题跟着改名：重名加「 2」，[[丙]] 换成新名
  await v.create('', '引用', '见 [[丙]]\n')
  expect(await v.rename('丙.md', '乙', true)).toBe('乙 2.md')
  expect(readFileSync(join(root, '引用.md'), 'utf8')).toBe('见 [[乙 2]]\n')
  expect(await v.rename('乙 2.md', '乙', true)).toBe('乙 2.md')
})

it('写到一半来了改名（机器慢时 ⌘W 关新建的笔记）：等写完再改，新名字里是刚写的字，旧名字不被写回来', async () => {
  for (let i = 0; i < 5; i++) {
    const rel = await v.create('收件箱', '未命名', '# 未命名\n\n')
    // 盘慢：这次写要 50ms。不等写完就改名，和编辑器自动保存还在路上时按 ⌘W 一样
    disk.slowWrite = 50
    const w = v.write(rel, `# 标题${i}\n\n`, '# 未命名\n\n')
    const to = v.rename(rel, `标题${i}`, true)
    expect((await w).ok).toBe(true)
    expect(await to).toBe(`收件箱/标题${i}.md`)
    expect(readFileSync(join(root, `收件箱/标题${i}.md`), 'utf8')).toBe(`# 标题${i}\n\n`)
    expect(existsSync(join(root, rel))).toBe(false)
    disk.slowWrite = 0
  }
})

it('改名之后编辑器还拿着旧路径存（回话还没到）：写进新名字的文件，旧名字不建回来；挪走也一样', async () => {
  const rel = await v.create('', '旧名', '# 旧名\n\n')
  const to = await v.rename(rel, '新名')
  expect((await v.write(rel, '# 旧名\n\n接着打的字', '# 旧名\n\n')).ok).toBe(true)
  expect(readFileSync(join(root, to), 'utf8')).toBe('# 旧名\n\n接着打的字')
  expect(existsSync(join(root, rel))).toBe(false)
  const moved = await v.move(to, '别处')
  expect((await v.write(rel, '# 旧名\n\n接着打的字。', '# 旧名\n\n接着打的字')).ok).toBe(true)
  expect(readFileSync(join(root, moved), 'utf8')).toBe('# 旧名\n\n接着打的字。')
  expect(existsSync(join(root, to))).toBe(false)
})

it('速记进收件箱，带创建时间；列表里分出收件箱、素材、我写的', async () => {
  const p = await v.capture('周末去看一下 Raycast\n第二行', new Date(2026, 10, 15, 14, 3))
  expect(p).toBe('收件箱/周末去看一下 Raycast.md')
  expect(readFileSync(join(root, p), 'utf8')).toBe('---\ncreated: 2026-11-15 14:03\n---\n周末去看一下 Raycast\n第二行\n')
  await v.create('素材/AI 与工具', '剪的', '---\nsource: https://nav.al/rich\n---\n> 原文\n')
  writeFileSync(join(root, '所思所想.md'), '# 所思所想\n')
  const list = await v.list()
  const byPath = Object.fromEntries(list.map((n) => [n.path, n]))
  expect(byPath['收件箱/周末去看一下 Raycast.md']).toMatchObject({ kind: 'inbox', preview: '周末去看一下 Raycast 第二行' })
  expect(byPath['收件箱/周末去看一下 Raycast.md']!.createdMs).toBe(new Date(2026, 10, 15, 14, 3).getTime())
  expect(byPath['素材/AI 与工具/剪的.md']).toMatchObject({ kind: 'clip', topic: 'AI 与工具', source: 'https://nav.al/rich' })
  expect(byPath['所思所想.md']).toMatchObject({ kind: 'work' })
  await expect(v.capture('   ')).rejects.toThrow('空的')
})

it('分区和预览', () => {
  expect(kindOf('收件箱/a.md')).toEqual({ kind: 'inbox' })
  expect(kindOf('素材/a.md')).toEqual({ kind: 'clip', topic: '未分主题' })
  expect(kindOf('收件箱.md')).toEqual({ kind: 'work' })
  expect(previewOf('---\na: 1\n---\n# 标题\n<!-- card id=a -->\n> 引文 [[笔记|别名]] [链接](http://x)\n**粗**')).toBe('标题 引文 笔记 链接 粗')
  // 导进来的备忘录：勾选清单、列表、表格的记号不露出来
  expect(previewOf('- [x] 看懂定义\n- [ ] 做习题\n\t- 子项\n\n| 名词 | 意思 |\n| --- | --- |\n| 核 | 零空间 |\n```\ncode\n```')).toBe('看懂定义 做习题 子项 名词 意思 核 零空间 code')
  // 折叠块、提示块、嵌入、尖括号链接、脚注、高亮：只留字（文件夹首页「笔记」一栏的摘要）
  // ```base 数据库块（文档里画成表）不露 YAML；第 4 轮美学：⌘K「意思相近」摘要露了「base filters: and: file.inFolder…」
  expect(previewOf('只列在读的。\n\n```base\nfilters:\n  and:\n    - file.inFolder("写作/书单")\n```\n\n后面一段。')).toBe('只列在读的。 后面一段。')
  expect(previewOf('````dataview\nTABLE 作者\n````\n正文')).toBe('正文')
  expect(previewOf('预算\n\n开头一段。\n\n<details><summary>旧的预算</summary>\n\n旧预算第一段\n\n</details>')).toBe('预算 开头一段。 旧的预算 旧预算第一段')
  expect(previewOf('![[不存在.png]]\n<https://example.com> a[^1]\n\n[^1]: 脚注')).toBe('https://example.com a 脚注')
  expect(previewOf('> [!tip]- 小心\n> ==路面== 结冰 <span style="color:red">红字</span>')).toBe('小心 路面 结冰 红字')
  expect(localStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04')
})

it('按标题改名还没做完（盘慢，正在改别的笔记里的双链）时新建：不用正在挪走的「未命名」，新建的叫「未命名 2」；上一篇编辑器拿着旧路径存的字跟到新名字（第 5 轮：两篇撞在一个名字上）', async () => {
  writeFileSync(join(root, '链着它.md'), '# 链着它\n\n见 [[未命名]]。\n')
  const a = await v.create('', '未命名', '# 未命名\n\n')
  await v.write(a, '# 甲标题\n\n', '# 未命名\n\n')
  // 改双链那一步写盘慢：改名落到盘上了、还没做完
  disk.slowWrite = 200
  const moving = v.rename(a, '甲标题', true)
  await new Promise((r) => setTimeout(r, 60))
  expect(existsSync(join(root, '甲标题.md'))).toBe(true)
  const b = await v.create('', '未命名', '# 未命名\n\n')
  expect(b).toBe('未命名 2.md')
  expect(await moving).toBe('甲标题.md')
  disk.slowWrite = 0
  // 上一篇的编辑器还没换路径：存的字进甲标题，不把「未命名」建回来，也不写进新建的那篇
  expect((await v.write(a, '# 甲标题\n\n甲正文\n', '# 甲标题\n\n')).ok).toBe(true)
  expect(readFileSync(join(root, '甲标题.md'), 'utf8')).toBe('# 甲标题\n\n甲正文\n')
  expect(existsSync(join(root, '未命名.md'))).toBe(false)
  expect(readFileSync(join(root, b), 'utf8')).toBe('# 未命名 2\n\n')
  expect(readFileSync(join(root, '链着它.md'), 'utf8')).toBe('# 链着它\n\n见 [[甲标题]]。\n')
  // 改完了：旧名字照常给新建的用
  expect(await v.create('', '未命名', '# 未命名\n\n')).toBe('未命名.md')
})

it('写的时候文件和文件夹都不在了（挪走了又认不出去哪了）：字存回原来的位置、文件夹建回来，回话里说是存回去的', async () => {
  await v.create('收件箱', '极光', '# 极光\n')
  rmSync(join(root, '收件箱'), { recursive: true })
  expect(await v.write('收件箱/极光.md', '# 极光\n\n刚打的。\n', '# 极光\n')).toEqual({ ok: true, recreated: '收件箱/极光.md' })
  expect(readFileSync(join(root, '收件箱/极光.md'), 'utf8')).toBe('# 极光\n\n刚打的。\n')
})

it('软件自己挪走又改了字（梦游全部收下）：followOwnMove 之后旧路径上的写跟到新路径，和新内容合并而不是建回旧文件', async () => {
  writeFileSync(join(root, '极光.md'), '旧\n')
  await v.read('极光.md')
  await v.exclusive(async () => {
    rmSync(join(root, '极光.md'))
    writeFileSync(join(root, '新.md'), '旧\n相关：[[极光预报]]\n')
  })
  expect(await v.followOwnMove('极光.md', '新.md')).toBe('旧\n相关：[[极光预报]]\n')
  // 编辑器还拿着旧路径、旧底稿：不写，把新内容还回去让它合并
  expect(await v.write('极光.md', '旧\n打的字\n', '旧\n')).toEqual({ ok: false, diskText: '旧\n相关：[[极光预报]]\n' })
  expect(existsSync(join(root, '极光.md'))).toBe(false)
})

it('写不进去时另存一篇在旁边；同一篇再失败覆盖上次另存的那篇', async () => {
  const first = await v.rescue('收件箱/极光.md', '一\n')
  expect(first).toMatch(/^收件箱\/极光（没存上的字 \d\d-\d\d）\.md$/)
  expect(await v.rescue('收件箱/极光.md', '一二\n', first)).toBe(first)
  expect(readFileSync(join(root, first), 'utf8')).toBe('一二\n')
})
