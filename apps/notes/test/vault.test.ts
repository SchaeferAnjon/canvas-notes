import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localStamp, safeName, Vault } from '../src/main/vault'

/**
 * 慢盘：写 md 前先等这么多毫秒（量改名插进写中间的竞态）。存笔记是原子写（@cn/atomic）：写的是 `.<名字>.md.cn-…tmp`，从 open 拦。
 * whileWriting：临时文件刚建、还没换上去的那一刻调一次（模拟这时候外面改了文件）
 */
const disk = vi.hoisted(() => ({ slowWrite: 0, whileWriting: null as ((tmp: string) => void) | null }))
vi.mock('node:fs/promises', async (orig) => {
  const fsp = await orig<typeof import('node:fs/promises')>()
  const isMdTemp = (p: unknown) => /\.md\.cn-\d+-[0-9a-z]+\.tmp$/.test(String(p))
  return {
    ...fsp,
    writeFile: async (...a: Parameters<typeof fsp.writeFile>) => {
      if (disk.slowWrite && String(a[0]).endsWith('.md')) await new Promise((r) => setTimeout(r, disk.slowWrite))
      return fsp.writeFile(...a)
    },
    open: async (...a: Parameters<typeof fsp.open>) => {
      if (isMdTemp(a[0])) {
        if (disk.slowWrite) await new Promise((r) => setTimeout(r, disk.slowWrite))
        const hook = disk.whileWriting
        disk.whileWriting = null
        hook?.(String(a[0]))
      }
      return fsp.open(...a)
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

it('速记进收件箱，带创建时间；列表里分出收件箱、剪藏、我写的', async () => {
  const p = await v.capture('周末去看一下 Raycast\n第二行', new Date(2026, 10, 15, 14, 3))
  expect(p).toBe('收件箱/周末去看一下 Raycast.md')
  expect(readFileSync(join(root, p), 'utf8')).toBe('---\ncreated: 2026-11-15 14:03\n---\n周末去看一下 Raycast\n第二行\n')
  await v.create('剪藏/AI 与工具', '剪的', '---\nsource: https://nav.al/rich\n---\n> 原文\n')
  writeFileSync(join(root, '所思所想.md'), '# 所思所想\n')
  const list = await v.list()
  const byPath = Object.fromEntries(list.map((n) => [n.path, n]))
  expect(byPath['收件箱/周末去看一下 Raycast.md']).toMatchObject({ kind: 'inbox', preview: '周末去看一下 Raycast 第二行' })
  expect(byPath['收件箱/周末去看一下 Raycast.md']!.createdMs).toBe(new Date(2026, 10, 15, 14, 3).getTime())
  expect(byPath['剪藏/AI 与工具/剪的.md']).toMatchObject({ kind: 'clip', topic: 'AI 与工具', source: 'https://nav.al/rich' })
  expect(byPath['所思所想.md']).toMatchObject({ kind: 'work' })
  await expect(v.capture('   ')).rejects.toThrow('空的')
})

it('只有数据库表的笔记：摘要写「数据库」，不当空的（第 6 轮：文件夹首页写成「空的」）', async () => {
  writeFileSync(join(root, '清单.md'), '# 清单\n\n```base\nfilters:\n  and:\n    - file.inFolder("写作/清单")\nviews:\n  - type: table\n```\n')
  writeFileSync(join(root, '空的.md'), '# 空的\n\n')
  writeFileSync(join(root, '有字.md'), '# 有字\n\n前面一句。\n\n```base\nviews:\n  - type: table\n```\n')
  const byPath = Object.fromEntries((await v.list()).map((n) => [n.path, n]))
  expect(byPath['清单.md']!.excerpt).toBe('数据库')
  expect(byPath['空的.md']!.excerpt).toBeUndefined()
  expect(byPath['有字.md']!.excerpt).toBe('前面一句。')
})

it('分区和预览', () => {
  expect(kindOf('收件箱/a.md')).toEqual({ kind: 'inbox' })
  expect(kindOf('剪藏/a.md')).toEqual({ kind: 'clip', topic: '未分主题' })
  // 2026-11-18「素材」改叫「剪藏」：老名字的文件夹打开库时就整理掉了，不再当剪藏
  expect(kindOf('素材/a.md')).toEqual({ kind: 'work' })
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

it('写不进去时另存一篇在旁边；每次都是新的一篇，绝不覆盖已有的文件（另存那篇以后由编辑器照常先比后写）', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 17, 18, 20) })
  const first = await v.rescue('收件箱/极光.md', '一\n').finally(() => vi.useRealTimers())
  // 时间和冲突副本同一个写法（「18-20」，clockStamp）
  expect(first).toBe('收件箱/极光（没存上的字 18-20）.md')
  // 用户在另存那篇里接着写了；再另存一次（旧版会多传上次那篇的路径，整篇覆盖它，把接着写的冲掉）
  writeFileSync(join(root, first), '一\n在另存那篇里接着写的。\n')
  const second = await (v.rescue as (rel: string, text: string, into?: string) => Promise<string>)('收件箱/极光.md', '一二\n', first)
  expect(second).not.toBe(first)
  expect(readFileSync(join(root, first), 'utf8')).toBe('一\n在另存那篇里接着写的。\n')
  expect(readFileSync(join(root, second), 'utf8')).toBe('一二\n')
})

it('原子写（task-8dula）：BOM、CRLF、没有结尾换行、0600 权限都保持，目录里不留临时文件', async () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 会议\r\n\r\n第一段。\r\n\r\n结尾')])
  writeFileSync(join(root, '会议.md'), bytes)
  chmodSync(join(root, '会议.md'), 0o600)
  const { text } = await v.read('会议.md')
  expect(text).toBe('# 会议\n\n第一段。\n\n结尾')
  expect((await v.write('会议.md', text.replace('第一段。', '第一段。加了字'), text)).ok).toBe(true)
  const after = readFileSync(join(root, '会议.md'))
  expect(after.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  expect(after.subarray(3).toString()).toBe('# 会议\r\n\r\n第一段。加了字\r\n\r\n结尾')
  expect(statSync(join(root, '会议.md')).mode & 0o777).toBe(0o600)
  expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([])
})

it('原子写：读完到换上去之间外面改了（同步盘、画布今日刚好写）：不盖掉，把外面的还给界面合并', async () => {
  writeFileSync(join(root, '旅行.md'), '# 旅行\n\n第一段。\n')
  const { text } = await v.read('旅行.md')
  disk.whileWriting = () => writeFileSync(join(root, '旅行.md'), '# 旅行\n\n第一段。\n\n同步过来的一段。\n')
  const r = await v.write('旅行.md', '# 旅行\n\n第一段。我打的字\n', text)
  expect(r).toEqual({ ok: false, diskText: '# 旅行\n\n第一段。\n\n同步过来的一段。\n' })
  expect(readFileSync(join(root, '旅行.md'), 'utf8')).toBe('# 旅行\n\n第一段。\n\n同步过来的一段。\n')
  expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([])
  // 外面只是碰了一下（内容没变，修改时间变了）：重读一遍，照常写进去
  disk.whileWriting = () => writeFileSync(join(root, '旅行.md'), '# 旅行\n\n第一段。\n\n同步过来的一段。\n')
  const base = '# 旅行\n\n第一段。\n\n同步过来的一段。\n'
  expect(await v.write('旅行.md', base + '我接着打\n', base)).toEqual({ ok: true })
  expect(readFileSync(join(root, '旅行.md'), 'utf8')).toBe(base + '我接着打\n')
})

it('标题改了名：别的篇里指着旧标题的 [[这篇#旧标题]] 跟着改（梦游 Wiki 那节 W.5）；块链接、别的篇的同名标题、删标题不动', async () => {
  const b = '# 解剖02\n\n## 九、双杠臂屈伸（多关节） 52:56\n\n双杠臂屈伸练胸。 ^abc123\n'
  writeFileSync(join(root, '解剖02.md'), b)
  writeFileSync(join(root, '日记.md'), '练了[[解剖02#九、双杠臂屈伸（多关节） 52:56|双杠臂屈伸]]，见[[解剖02#^abc123|那一段]]，[[别的#九、双杠臂屈伸（多关节） 52:56]]\n')
  writeFileSync(join(root, '别的.md'), '# 别的\n\n## 九、双杠臂屈伸（多关节） 52:56\n')
  const opened = await v.read('解剖02.md')
  const after = b.replace('## 九、双杠臂屈伸（多关节） 52:56', '## 九、双杠臂屈伸')
  expect((await v.write('解剖02.md', after, opened.text)).ok).toBe(true)
  expect(readFileSync(join(root, '日记.md'), 'utf8')).toBe('练了[[解剖02#九、双杠臂屈伸|双杠臂屈伸]]，见[[解剖02#^abc123|那一段]]，[[别的#九、双杠臂屈伸（多关节） 52:56]]\n')
  // 删掉标题（个数变了）不猜
  expect((await v.write('解剖02.md', after.replace('## 九、双杠臂屈伸\n\n', ''), after)).ok).toBe(true)
  expect(readFileSync(join(root, '日记.md'), 'utf8')).toContain('[[解剖02#九、双杠臂屈伸|双杠臂屈伸]]')
})

it('盘上刚被改过、监听还没对账时别处读一下（右栏笔记、疑问卡、名词卡）：照样报给开着的编辑器，不被这一下读吞掉', async () => {
  writeFileSync(join(root, '第3讲 笔记.md'), '# 第3讲 笔记\n\n见 [[甲]]。\n')
  writeFileSync(join(root, '别的.md'), '# 别的\n')
  // 编辑器打开这一篇
  await v.read('第3讲 笔记.md')
  const changed: string[] = []
  let files = 0
  v.watch(
    (_rel, text) => changed.push(text),
    () => files++,
  )
  try {
    // 监听真的在听了（改一篇别的，等它报「文件变了」）再开始
    await vi.waitFor(() => {
      writeFileSync(join(root, '别的.md'), `# 别的\n\n${Date.now()}\n`)
      expect(files).toBeGreaterThan(0)
    }, { timeout: 10_000, interval: 200 })
    // 外面改了（甲改名成乙，别处的双链改好），对账前马上有一处读了它
    writeFileSync(join(root, '第3讲 笔记.md'), '# 第3讲 笔记\n\n见 [[乙]]。\n')
    expect((await v.read('第3讲 笔记.md')).text).toContain('[[乙]]')
    expect(await v.peek('第3讲 笔记.md')).toContain('[[乙]]')
    await vi.waitFor(() => expect(changed).toEqual(['# 第3讲 笔记\n\n见 [[乙]]。\n']), { timeout: 10_000 })
    expect(await v.peek('没有.md')).toBeNull()
  } finally {
    v.close()
  }
})

it('软件自己的、隐藏的 md（.obsidian/、.canvas-notes/对话/、. 开头的）不是笔记：左栏、⌘F 都没有；存了、外面改了也不进搜索', async () => {
  const { mkdirSync } = await import('node:fs')
  for (const p of ['.obsidian', '.canvas-notes/对话', '课程']) mkdirSync(join(root, p), { recursive: true })
  writeFileSync(join(root, '课程/极光.md'), '# 极光\n\n极光要看太阳风。\n')
  writeFileSync(join(root, '.obsidian/模板.md'), '极光模板\n')
  writeFileSync(join(root, '.canvas-notes/对话/t1.md'), '# 对话\n\n极光对话\n')
  writeFileSync(join(root, '课程/.藏起来.md'), '藏起来的极光\n')
  writeFileSync(join(root, '课程/.DS_Store'), '极光')
  expect((await v.list()).map((n) => n.path)).toEqual(['课程/极光.md'])
  expect((await v.search('极光')).map((h) => h.path)).toEqual(['课程/极光.md'])
  // 软件存了一份完整对话（读 PDF 的对话就是这样写的）
  const t1 = (await v.read('.canvas-notes/对话/t1.md')).text
  await v.write('.canvas-notes/对话/t1.md', t1 + '\n极光又一问\n', t1)
  expect((await v.search('极光')).map((h) => h.path)).toEqual(['课程/极光.md'])
  // 监听：外面改了它照样对账（开着的照样合），但不进搜索
  const changed: string[] = []
  let files = 0
  v.watch(
    (rel) => changed.push(rel),
    () => files++,
  )
  try {
    await vi.waitFor(
      () => {
        writeFileSync(join(root, '别的.md'), `# 别的\n\n${Date.now()}\n`)
        expect(files).toBeGreaterThan(0)
      },
      { timeout: 10_000, interval: 200 },
    )
    writeFileSync(join(root, '.canvas-notes/对话/t1.md'), '# 对话\n\n极光外面改的\n')
    await vi.waitFor(() => expect(changed).toContain('.canvas-notes/对话/t1.md'), { timeout: 10_000, interval: 100 })
    expect((await v.search('极光')).map((h) => h.path)).toEqual(['课程/极光.md'])
  } finally {
    v.close()
  }
})
