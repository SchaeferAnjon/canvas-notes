// 清理没用到的附件（2026-11-25 用户「这里加一个一键清理没有用到的图片的按钮」）：「没用到」要稳，宁可少清不可误清。
// 每一种引用写法各一份样本，没有一个会被列进能清的；真没人用的列进去；拿不准的单列、写为什么；清理一次提交，撤回原样回来。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, shell: {} }))

const { attachUsage, cleanAttachments, MAX_TEXT } = await import('../src/main/attach-usage')
const { testTrash } = await import('../src/main/folder-ops')
const { recentDeleted } = await import('../src/main/trash-recent')
const { Vault } = await import('../src/main/vault')

const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@e', ...args], { encoding: 'utf8' }).trim()

let base: string
let root: string
let trash: string
const HOUR_AGO = (Date.now() - 3600_000) / 1000
const put = (f: string, data: string | Buffer, old = true) => {
  mkdirSync(dirname(join(root, f)), { recursive: true })
  writeFileSync(join(root, f), data)
  // 放了一小时的（1 分钟内刚加的算拿不准）
  if (old) utimesSync(join(root, f), HOUR_AGO, HOUR_AGO)
}
const png = (s: string) => Buffer.from(`\x89PNG-${s}`)
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-clean-'))
  root = join(base, '库')
  trash = join(base, 'trash')
  mkdirSync(trash, { recursive: true })
  mkdirSync(root, { recursive: true })
  git(root, ['init', '-q', '-b', 'main'])
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

/** 每种引用写法：附件 → 用它的那个文件和内容 */
const KINDS: [kind: string, att: string, file: string, text: string][] = [
  ['文档：相对路径的图', '附件/写作/文档/rel.png', '写作/文档.md', '# 文档\n\n![](../附件/写作/文档/rel.png)\n'],
  ['文档：从库的最外层写的路径', '附件/k/root.png', '最外层.md', '# 最外层\n\n![图](附件/k/root.png)\n'],
  ['文档：URL 编码的路径', '附件/k/url enc图.png', '写作/编码.md', '# 编码\n\n![](../附件/k/url%20enc%E5%9B%BE.png)\n'],
  ['文档：地址里直接带空格（没编码、没尖括号）', '附件/写作/文档/截图 1.png', '写作/空格.md', '# 空格\n\n![](../附件/写作/文档/截图 1.png)\n'],
  ['文档：带空格的链接加标题', '附件/k/带 空格 的.pdf', '写作/空格2.md', '# 空格2\n\n见[附件](../附件/k/带 空格 的.pdf "标题")。\n'],
  ['文档：尖括号带标题', '附件/k/angle b.png', '写作/尖括号.md', '# 尖括号\n\n![说明](<../附件/k/angle b.png> "标题")\n'],
  ['文档：链接带 #page=', '附件/k/讲义.pdf', '写作/页码.md', '# 页码\n\n看[讲义第 3 页](../附件/k/讲义.pdf#page=3)。\n'],
  ['![[嵌入]] 带扩展名', '附件/k/wiki-ext.png', '写作/嵌入1.md', '# 嵌入1\n\n![[wiki-ext.png]]\n'],
  ['![[嵌入]] 不带扩展名', '附件/k/wiki-noext.png', '写作/嵌入2.md', '# 嵌入2\n\n![[wiki-noext]]\n'],
  ['![[嵌入]] 带 |尺寸', '附件/k/wiki-size.png', '写作/嵌入3.md', '# 嵌入3\n\n![[wiki-size.png|300]]\n'],
  ['[[双链]] 带扩展名和 #页', '附件/k/wiki-link.pdf', '写作/双链1.md', '# 双链1\n\n[[wiki-link.pdf#page=2|讲义]]\n'],
  ['[[双链]] 带路径不带扩展名', '附件/k/深/wiki-path.png', '写作/双链2.md', '# 双链2\n\n![[附件/k/深/wiki-path]]\n'],
  ['HTML 的 <img src> 双引号', '附件/k/html-dq.png', '写作/网页1.md', '# 网页1\n\n<img src="../附件/k/html-dq.png" width="300">\n'],
  ['HTML 的 <img src> 单引号', '附件/k/html sq.png', '写作/网页2.md', "# 网页2\n\n<img src='../附件/k/html sq.png'>\n"],
  ['HTML 的 <img src> 不带引号', '附件/k/html-unq.png', '写作/网页3.md', '# 网页3\n\n<img src=../附件/k/html-unq.png alt=x>\n'],
  ['库里的 .html 文件', '附件/k/in-html.png', '网页/存档.html', '<html><body><img src="../附件/k/in-html.png"></body></html>'],
  ['属性里的封面', '附件/k/fm-cover.png', '写作/封面.md', '---\ncover: 附件/k/fm-cover.png\n---\n# 封面\n'],
  ['属性里的图标（双链）', '附件/k/fm-icon.png', '写作/图标.md', '---\nicon: "[[fm-icon.png]]"\n---\n# 图标\n'],
  ['属性里带空格的相对路径', '附件/k/fm 空格.jpg', '数据库/书单/三体.md', '---\n封面: "../../附件/k/fm 空格.jpg"\n---\n# 三体\n'],
  ['属性里没加引号、带空格的相对路径', '附件/k/fm 无引号.jpg', '数据库/书单/流浪地球.md', '---\n封面: ../../附件/k/fm 无引号.jpg\n---\n# 流浪地球\n'],
  ['白板：卡片里的图', '附件/白板/计划/card.png', '白板/计划.md', '---\ntype: board\n---\n# 计划\n\n<!-- card id=a1 x=120 y=300 w=280 color=yellow -->\n![](../附件/白板/计划/card.png)\n'],
  ['文档里的白板位置行后面那张卡', '附件/k/pos-card.png', '写作/摆过的.md', '# 摆过的\n\n<!-- card id=c3 x=40 y=80 -->\n![卡](../附件/k/pos-card.png)\n'],
  ['PDF 的配对笔记', '附件/课程/讲义.pdf/p1-1.png', '课程/讲义 笔记.md', '# 讲义 笔记\n\n## 第 1 页\n\n![](../附件/课程/讲义.pdf/p1-1.png)\n'],
  ['数据库 .base 文件', '附件/k/base-img.png', '数据库/书单.base', 'views:\n  - type: cards\n    image: 附件/k/base-img.png\n'],
  ['文档里的 ```base 块', '附件/k/base-block.png', '数据库/看板.md', '# 看板\n\n```base\nviews:\n  - type: cards\n    image: "附件/k/base-block.png"\n```\n'],
  ['数据库记录笔记的正文', '附件/k/record.png', '数据库/书单/球状闪电.md', '---\n作者: 刘慈欣\n---\n# 球状闪电\n\n![](../../附件/k/record.png)\n'],
  ['剪藏', '附件/剪藏/网页/文章/图1.webp', '剪藏/网页/文章.md', '---\nsource: https://example.com/a\n---\n# 文章\n\n![图 1](../../附件/剪藏/网页/文章/图1.webp "原图")\n'],
  ['MeetCaption 上课记录的关键画面', '附件/课程/上课记录/画面-09.41.12.jpg', '课程/上课记录.md', '---\nmeetcaption: ["2026-11-04 09.29"]\n录音: [".canvas-notes/录音/课程/上课记录/录音-1.webm"]\n字幕: [".canvas-notes/字幕/meetcaption/2026-11-04 09.29.vtt"]\n---\n# 上课记录\n\n![关键画面 09:41:12](../%E9%99%84%E4%BB%B6/%E8%AF%BE%E7%A8%8B/%E4%B8%8A%E8%AF%BE%E8%AE%B0%E5%BD%95/%E7%94%BB%E9%9D%A2-09.41.12.jpg)\n'],
  ['画布今日的待办行', '附件/k/today-task.png', '收件箱/待办.md', '# 待办\n\n- [ ] 打印海报 ![](../附件/k/today-task.png) 📅 2026-11-30\n'],
  ['读 PDF 的完整对话', '附件/k/convo.png', '.canvas-notes/对话/t1.md', '# 对话\n\n![](../../附件/k/convo.png)\n'],
  ['软件自己的 JSON（首页底图）', '附件/k/home-bg.png', '.canvas-notes/首页.json', JSON.stringify({ bg: '附件/k/home-bg.png' })],
  ['画布今日 .canvas-tasks/ 里的', '附件/k/tasks-json.png', '.canvas-tasks/plan.json', JSON.stringify({ items: [{ img: '附件/k/tasks-json.png' }] })],
  ['大小写不一样的链接', '附件/k/case.png', '写作/大小写.md', '# 大小写\n\n![](../附件/k/CASE.PNG)\n'],
  ['文件夹路径改过名的旧链接（按名字认）', '附件/新家/搬家.png', '写作/旧链.md', '# 旧链\n\n![](../附件/旧家/搬家.png)\n'],
  ['链着它所在的文件夹', '附件/k/整组/g1.png', '写作/整组.md', '# 整组\n\n[这组图](../附件/k/整组/)\n'],
  ['附件里的 svg 引用别的图', '附件/k/svg-inner.png', '附件/k/外框.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="svg-inner.png"/></svg>'],
  ['文档用的 svg 本身', '附件/k/外框.svg', '写作/svg.md', '# svg\n\n![](../附件/k/外框.svg)\n'],
]

/** 拿不准的：附件 → 为什么 */
const UNSURE: [att: string, k: string][] = [
  ['附件/手写/测试/手写-1.png', 'hand'],
  ['附件/下载/安装包.zip', 'download'],
  ['附件/封面/首页.jpg', 'cover'],
  ['附件/课程/上课记录/画面-10.00.00.jpg', 'frame'],
  ['附件/k/刚粘的.png', 'recent'],
  ['附件/大文件/录像.mov', 'ignored'],
  ['附件/课程/讲义.pdf/p2-1.png', 'owner'],
  ['附件/扫描/报告/第1页.png', 'stem'],
]

/** 真没人用的 */
const UNUSED = ['附件/k/没人用.png', '附件/写作/文档/粘了又删.png', '附件/旧/没主的.jpg', '附件/k/只提到名字.png']

function vault() {
  // 先放附件再放用它的文件：附件自己也是别的附件的使用者时（svg）留文字
  for (const [, att] of KINDS) put(att, png(att))
  for (const [, , file, text] of KINDS) put(file, text)
  put('课程/讲义.pdf', '%PDF-1.4')
  put('写作/测试.md', '# 测试\n')
  put('写作/报告.pdf', '%PDF-1.4')
  // MeetCaption 的录音、字幕在 .canvas-notes/ 里：不在 附件/，从来不列
  put('.canvas-notes/录音/课程/上课记录/录音-1.webm', Buffer.alloc(8))
  put('.canvas-notes/字幕/meetcaption/2026-11-04 09.29.vtt', 'WEBVTT\n')
  put('.gitignore', '附件/大文件/\n')
  for (const [att, k] of UNSURE) put(att, png(att), k !== 'recent')
  for (const p of UNUSED) put(p, png(p))
  // 只是字里提到这个词（不是链接、没写扩展名）不算用着
  put('写作/随手.md', '# 随手\n\n只提到名字 这个词不算。\n')
}

describe('附件用没用（attachUsage）', () => {
  it('每一种引用写法都算用着，没有一个列进能清的', async () => {
    vault()
    const use = await attachUsage(root)
    for (const [kind, att, file] of KINDS) {
      const u = use[att]
      expect(u, `${kind}：${att}`).toBeDefined()
      expect(u!.state, `${kind}：${att} 应该算用着`).toBe('used')
      if (u!.state === 'used' && kind !== '链着它所在的文件夹') expect(u!.by, kind).toContain(file)
    }
  })

  it('真没人用的列进能清的（归一篇还在的笔记、但文中没用到的也算）；拿不准的单列、写为什么', async () => {
    vault()
    const use = await attachUsage(root)
    const unused = Object.entries(use).filter(([, u]) => u.state === 'unused').map(([p]) => p).sort()
    expect(unused).toEqual([...UNUSED].sort())
    for (const [att, k] of UNSURE) {
      const u = use[att]
      expect(u?.state, att).toBe('unsure')
      if (u?.state === 'unsure') expect(u.why.k, att).toBe(k)
    }
    // .canvas-notes/ 里的录音、字幕不是附件，不列
    expect(Object.keys(use).some((p) => p.startsWith('.canvas-notes/'))).toBe(false)
    // 大小写对：大小写不同的同一个名字
    expect(use['附件/k/没人用.png']!.bytes).toBe(png('附件/k/没人用.png').length)
  })

  it('文件名是 NFD（访达、iCloud 写的）、笔记里打的是 NFC：也认得', async () => {
    const nfd = '附件/k/café.png'.normalize('NFD')
    put(nfd, png('nfd'))
    put('写作/咖啡.md', '# 咖啡\n\n![](../附件/k/café.png)\n'.normalize('NFC'))
    const files = readdirSync(join(root, '附件/k'))
    expect(files[0]).toBe('café.png'.normalize('NFD'))
    const use = await attachUsage(root)
    expect(use[nfd]?.state).toBe('used')
  })

  it('5 MB 以上的文字文件不解析，按名字在里面找到也算用着', async () => {
    put('附件/k/大文件里提到.png', png('big'))
    put('附件/k/大文件里没提到.png', png('big2'))
    put('.canvas-notes/大.json', `{"pad":"${'x'.repeat(MAX_TEXT)}","img":"附件/k/大文件里提到.png"}`)
    const use = await attachUsage(root)
    expect(use['附件/k/大文件里提到.png']?.state).toBe('used')
    expect(use['附件/k/大文件里没提到.png']?.state).toBe('unused')
  })

  it('刚加的（1 分钟内）只在还没提交时拿不准；提交过的（撤回、放回刚写回来的）照常能清', async () => {
    put('附件/k/刚写回来.png', png('back'), false)
    let use = await attachUsage(root)
    expect(use['附件/k/刚写回来.png']).toMatchObject({ state: 'unsure', why: { k: 'recent' } })
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '放回'])
    use = await attachUsage(root)
    expect(use['附件/k/刚写回来.png']?.state).toBe('unused')
  })

  it('崩溃残留的回收处（.canvas-notes/回收/）里的旧版不算谁在用', async () => {
    put('附件/k/只在回收里提到.png', png('r'))
    put('.canvas-notes/回收/2026-11-20/写作/旧.md', '# 旧\n\n![](../../../../附件/k/只在回收里提到.png)\n')
    const use = await attachUsage(root)
    expect(use['附件/k/只在回收里提到.png']?.state).toBe('unused')
  })
})

describe('清理（cleanAttachments）', () => {
  it('勾着的没用到的移到废纸篓、一次提交；又有人用了的、拿不准的、用着的不动；撤回（反向提交）原样回来', async () => {
    vault()
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    const before = new Map(UNUSED.map((p) => [p, readFileSync(join(root, p))]))
    // 列出来以后又有一篇链上了「没主的.jpg」
    put('写作/新的.md', '# 新的\n\n![](../附件/旧/没主的.jpg)\n')
    const ask = [...UNUSED, '附件/k/root.png', '附件/下载/安装包.zip']
    const r = await cleanAttachments(new Vault(root), ask, testTrash(trash))
    const gone = UNUSED.filter((p) => p !== '附件/旧/没主的.jpg')
    expect(r.n).toBe(gone.length)
    expect(r.kept).toBe(3)
    for (const p of gone) expect(existsSync(join(root, p)), p).toBe(false)
    for (const p of ['附件/旧/没主的.jpg', '附件/k/root.png', '附件/下载/安装包.zip']) expect(existsSync(join(root, p)), p).toBe(true)
    expect(git(root, ['log', '-1', '--format=%s'])).toBe(`清理没用到的附件 ${gone.length} 个`)
    expect(git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual([...gone].sort())
    // 进了「废纸篓」（测试里是临时文件夹）
    expect(readdirSync(trash).length).toBeGreaterThan(0)
    // 「最近删掉的」里列着，能放回
    const listed = (await recentDeleted(new Vault(root))).flatMap((i) => [i.path, ...(i.with ?? [])])
    for (const p of gone) expect(listed, p).toContain(p)
    // 撤回：反向提交，一个字节不差
    git(root, ['revert', '--no-edit', r.commit!])
    for (const p of gone) expect(readFileSync(join(root, p)).equals(before.get(p)!), p).toBe(true)
  })

  it('还没提交的新图（没用到）先提交一次再清：放回时有那一版', async () => {
    put('写作/a.md', '# a\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    put('附件/写作/a/没提交.png', png('new'))
    const r = await cleanAttachments(new Vault(root), ['附件/写作/a/没提交.png'], testTrash(trash))
    expect(r.n).toBe(1)
    expect(existsSync(join(root, '附件/写作/a/没提交.png'))).toBe(false)
    git(root, ['revert', '--no-edit', r.commit!])
    expect(readFileSync(join(root, '附件/写作/a/没提交.png')).equals(png('new'))).toBe(true)
  })

  it('「最近删掉的」的「没人用的附件」也不列网页里下载的（和这里的拿不准一致）', async () => {
    const { orphanFiles } = await import('../src/main/orphan-attach')
    vault()
    const orphans = (await orphanFiles(root)).map((f) => f.path)
    expect(orphans).not.toContain('附件/下载/安装包.zip')
    expect(orphans).toContain('附件/旧/没主的.jpg')
  })

  it('白板笔迹（附件/<白板>/笔迹.ink）是白板的一部分：不算没用到、清理不列、勾了也不清；. 开头的不算附件', async () => {
    const { orphanFiles } = await import('../src/main/orphan-attach')
    const ink = '{"ink":1}\n{"g":"k2m9q4ta","x":10,"y":20}\n{"id":"r8f2k1zq","g":"k2m9q4ta","pen":"pen","c":"#1d2421","p":"0,0,100,500,0;10,0,0,0,8"}\n'
    put('白板/计划.md', '---\ntype: board\n---\n# 计划\n\n<!-- card id=a1 x=120 y=300 w=280 ink=1 -->\n第一张卡\n')
    put('附件/白板/计划/笔迹.ink', ink)
    put('附件/白板/计划/.DS_Store', 'x')
    put('附件/.obsidian/附件.png', png('ob'))
    // 白板删了（附件文件夹还在）：笔迹也不当成没人用的附件列出来
    put('附件/旧白板/笔迹.ink', ink)
    put('附件/白板/计划/没用的.png', png('loose'))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    const use = await attachUsage(root)
    for (const p of ['附件/白板/计划/笔迹.ink', '附件/旧白板/笔迹.ink', '附件/白板/计划/.DS_Store', '附件/.obsidian/附件.png']) expect(use[p], p).toBeUndefined()
    expect(use['附件/白板/计划/没用的.png']?.state).toBe('unused')
    const r = await cleanAttachments(new Vault(root), ['附件/白板/计划/笔迹.ink', '附件/旧白板/笔迹.ink', '附件/白板/计划/没用的.png'], testTrash(trash))
    expect(r.n).toBe(1)
    expect(readFileSync(join(root, '附件/白板/计划/笔迹.ink'), 'utf8')).toBe(ink)
    expect(readFileSync(join(root, '附件/旧白板/笔迹.ink'), 'utf8')).toBe(ink)
    const orphans = (await orphanFiles(root)).map((f) => f.path)
    expect(orphans).not.toContain('附件/旧白板/笔迹.ink')
    expect(orphans).not.toContain('附件/.obsidian/附件.png')
    // 目录树、⌘O、「附件」筛选里也没有它（不是附件）；删整个文件夹时它照样跟着白板走
    const { attachIndex, listEntries } = await import('../src/main/files')
    const { folderAttachments } = await import('../src/main/note-attach')
    const files = await listEntries(root)
    expect(files.map((f) => f.path).filter((p) => p.endsWith('.ink') || p.split('/').some((s) => s.startsWith('.')))).toEqual([])
    const ix = await attachIndex(root, files)
    expect(ix.orphans.map((o) => o.path)).not.toContain('附件/白板/计划/笔迹.ink')
    expect(Object.keys(ix.usage).filter((p) => p.endsWith('.ink'))).toEqual([])
    expect((await folderAttachments(new Vault(root), '白板')).go).toContain('附件/白板/计划/笔迹.ink')
  })

  it('不在 附件/ 里的、带 .. 的不收', async () => {
    await expect(cleanAttachments(new Vault(root), ['写作/a.md'], testTrash(trash))).rejects.toThrow('要清理的不对')
    await expect(cleanAttachments(new Vault(root), ['附件/../写作/a.md'], testTrash(trash))).rejects.toThrow('要清理的不对')
  })
})
