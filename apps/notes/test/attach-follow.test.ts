// 附件跟着笔记走（2026-11-23）：删文件夹时里面笔记的附件一起进废纸篓、一次提交、能撤回；
// 「谁在用这个附件」认得 md 链接、[[嵌入]]、HTML 的 src、属性里的封面、白板卡片；没人用的附件宁可少列不可误列。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachOwner, fileNameIndex, fileRefs, refHits } from '@cn/format'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, shell: {} }))

const { trashFolder, testTrash } = await import('../src/main/folder-ops')
const { noteAttachments } = await import('../src/main/note-attach')
const { orphanFiles, orphanGroups, trashOrphans } = await import('../src/main/orphan-attach')
const { recentDeleted } = await import('../src/main/trash-recent')
const { Vault } = await import('../src/main/vault')

const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@e', ...args], { encoding: 'utf8' }).trim()

describe('引用判断（format 的 fileRefs / refHits / attachOwner）', () => {
  const files = ['附件/a/截图 1.png', '附件/b/截图 1.png', '附件/c/图.png', '附件/封面/首页.jpg', '附件/d/x.png', '附件/e/卡片.png', '附件/f/封面.png', '附件/g/坏链.png']
  const set = new Set(files)
  const idx = fileNameIndex(files)
  const hits = (text: string, from = '笔记/一篇.md') => [...refHits(fileRefs(text, from), set, idx)].sort()

  it('md 链接按路径认：同名的别的文件不算', () => {
    expect(hits('![](../附件/a/截图%201.png)')).toEqual(['附件/a/截图 1.png'])
  })
  it('按名字的 ![[嵌入]] 认所有同名的（宁可多认）；带路径的认尾巴', () => {
    expect(hits('![[截图 1.png]]')).toEqual(['附件/a/截图 1.png', '附件/b/截图 1.png'])
    expect(hits('![[b/截图 1.png|300]]')).toEqual(['附件/b/截图 1.png'])
  })
  it('HTML 的 src（带空格也认）、属性里的封面、白板卡片的注释和正文', () => {
    expect(hits('<img src="../附件/c/图.png" width=3>')).toEqual(['附件/c/图.png'])
    expect(hits('---\ncover: 附件/f/封面.png\n---\n# 一篇\n')).toEqual(['附件/f/封面.png'])
    expect(hits('<!-- card id=a1 x=1 y=2 -->\n![](../附件/e/卡片.png)\n')).toEqual(['附件/e/卡片.png'])
  })
  it('写坏了的链接（路径对不上）按名字认', () => {
    expect(hits('![](../旧地方/坏链.png)')).toEqual(['附件/g/坏链.png'])
  })
  it('JSON 里的路径（首页、左栏这些软件自己的文件）', () => {
    expect(hits('{"cover":"附件/d/x.png"}', '.canvas-notes/首页.json')).toEqual(['附件/d/x.png'])
  })
  it('网址不算', () => {
    expect(hits('![](https://example.com/附件/c/图.png)')).toEqual([])
  })
  it('附件归哪篇：最长的那层还在的笔记', () => {
    const notes = new Set(['剪藏/冰岛旅行.md', '剪藏/冰岛旅行/ttravel.md'])
    const has = (n: string) => notes.has(n)
    expect(attachOwner('附件/剪藏/冰岛旅行/ttravel/1.png', has)).toBe('剪藏/冰岛旅行/ttravel.md')
    expect(attachOwner('附件/剪藏/冰岛旅行/2.png', has)).toBe('剪藏/冰岛旅行.md')
    expect(attachOwner('附件/剪藏/第三方/冰岛/3.png', has)).toBe(null)
    expect(attachOwner('课程/x.png', has)).toBe(null)
  })
})

let base: string
let root: string
let trash: string
const put = (f: string, data: string | Buffer) => {
  mkdirSync(dirname(join(root, f)), { recursive: true })
  writeFileSync(join(root, f), data)
}
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cn-follow-'))
  root = join(base, '库')
  trash = join(base, 'trash')
  mkdirSync(trash, { recursive: true })
  mkdirSync(root, { recursive: true })
  git(root, ['init', '-q', '-b', 'main'])
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

/** 用户真库里的样子：剪藏/冰岛旅行/ 里两篇带图，一张图收件箱那篇也在用，视频时刻的图放在 附件/视频/ */
function clipVault() {
  put('剪藏/冰岛旅行/ttravel.md', '# ttravel\n\n![](../../附件/剪藏/冰岛旅行/ttravel/1.png)\n\n![](../../附件/视频/yt-1/01-02.jpg)\n')
  put('附件/剪藏/冰岛旅行/ttravel/1.png', Buffer.alloc(10))
  put('附件/剪藏/冰岛旅行/ttravel/2.png', Buffer.from('two'))
  put('附件/视频/yt-1/01-02.jpg', Buffer.alloc(12))
  put('剪藏/冰岛旅行/第三方.md', '# 第三方\n\n![](../../附件/剪藏/冰岛旅行/第三方/共用.png)\n')
  put('附件/剪藏/冰岛旅行/第三方/共用.png', Buffer.alloc(13))
  put('收件箱/摘一张.md', '# 摘一张\n\n![](../附件/剪藏/冰岛旅行/第三方/共用.png)\n')
  put('写作/别的.md', '# 别的\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', '建好'])
}

describe('删文件夹：里面笔记的附件一起进废纸篓', () => {
  it('附件/<文件夹>/ 和文中用到的 附件/ 别处的一起走，外面也在用的留下；一次提交；撤回（反向提交）都回来', async () => {
    clipVault()
    const v = new Vault(root)
    const r = await trashFolder(v, '剪藏/冰岛旅行', testTrash(trash))
    expect(r).toEqual({ files: 2, attachments: 3, kept: 1 })
    expect(existsSync(join(root, '剪藏/冰岛旅行'))).toBe(false)
    expect(existsSync(join(root, '附件/剪藏/冰岛旅行/ttravel'))).toBe(false)
    expect(existsSync(join(root, '附件/视频'))).toBe(false)
    expect(readdirSync(join(root, '附件/剪藏/冰岛旅行/第三方'))).toEqual(['共用.png'])
    expect(git(root, ['status', '--porcelain'])).toBe('')
    expect(git(root, ['log', '-1', '--format=%s'])).toBe('移到废纸篓：剪藏/冰岛旅行（2 个文件，连同 3 个附件）')
    expect(git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual(
      ['剪藏/冰岛旅行/ttravel.md', '剪藏/冰岛旅行/第三方.md', '附件/剪藏/冰岛旅行/ttravel/1.png', '附件/剪藏/冰岛旅行/ttravel/2.png', '附件/视频/yt-1/01-02.jpg'].sort(),
    )
    // 「最近删掉的」：图跟着那一篇（和 N 张图），放回时一起回来
    const items = await recentDeleted(v)
    expect(items.find((i) => i.path === '剪藏/冰岛旅行/ttravel.md')?.with?.sort()).toEqual(['附件/剪藏/冰岛旅行/ttravel/1.png', '附件/剪藏/冰岛旅行/ttravel/2.png', '附件/视频/yt-1/01-02.jpg'])
    git(root, ['revert', '--no-edit', 'HEAD'])
    expect(existsSync(join(root, '附件/剪藏/冰岛旅行/ttravel/2.png'))).toBe(true)
    expect(existsSync(join(root, '附件/视频/yt-1/01-02.jpg'))).toBe(true)
  })

  it('笔记和同名文件夹都在时（数据库挂在笔记下面）：删文件夹不带走那篇笔记自己的图', async () => {
    put('项目/计划.md', '# 计划\n\n![](../附件/项目/计划/封面图.png)\n')
    put('附件/项目/计划/封面图.png', Buffer.alloc(5))
    put('项目/计划/第一条.md', '# 第一条\n\n![](../../附件/项目/计划/第一条/图.png)\n')
    put('附件/项目/计划/第一条/图.png', Buffer.alloc(6))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    const r = await trashFolder(new Vault(root), '项目/计划', testTrash(trash))
    expect(r).toEqual({ files: 1, attachments: 1, kept: 1 })
    expect(existsSync(join(root, '附件/项目/计划/封面图.png'))).toBe(true)
    expect(existsSync(join(root, '附件/项目/计划/第一条'))).toBe(false)
    // 反过来删那篇笔记：文件夹里那篇的图不算它的
    const a = await noteAttachments(new Vault(root), '项目/计划.md', true)
    expect(a.items.map((i) => i.path)).toEqual(['附件/项目/计划/封面图.png'])
  })

  it('![[嵌入]] 用到的图也跟着这篇走；别的笔记按名字嵌着同一张时留下', async () => {
    put('导入/一篇.md', '# 一篇\n\n![[老图.png]]\n\n![[独有.png]]\n')
    put('附件/导入/老图.png', Buffer.alloc(3))
    put('附件/导入/独有.png', Buffer.alloc(3))
    put('写作/也用.md', '# 也用\n\n![[老图.png]]\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    const a = await noteAttachments(new Vault(root), '导入/一篇.md', true)
    expect(a.items.map((i) => [i.path, i.mine, i.sharedWith ?? []])).toEqual([
      ['附件/导入/老图.png', true, ['写作/也用.md']],
      ['附件/导入/独有.png', true, []],
    ])
  })
})

describe('没人用的附件', () => {
  /** 删过一轮以后留下来的：剪藏两篇的附件文件夹、视频时刻的图；还有不能列的几种 */
  function leftover() {
    put('剪藏/第三方/冰岛.md', '# 冰岛\n\n![](../../附件/剪藏/第三方/冰岛/a.png)\n')
    put('附件/剪藏/第三方/冰岛/a.png', Buffer.from('aaaa'))
    put('附件/剪藏/第三方/冰岛/b.png', Buffer.from('bbbb'))
    put('剪藏/视频/讲座.md', '# 讲座\n\n![](../../附件/视频/yt-9/03-04.jpg)\n')
    put('附件/视频/yt-9/03-04.jpg', Buffer.alloc(4))
    // 还在用的：链着的、![[按名字]]、HTML、属性封面、JSON、PDF 截图、iPad 手写、首页封面、写坏的链接
    put('写作/游记.md', '---\ncover: 附件/封皮/c.png\n---\n# 游记\n\n![](../附件/写作/游记/d.png)\n\n![[e.png]]\n\n<img src="../附件/杂/f g.png">\n\n![](../旧/坏链.png)\n')
    put('附件/写作/游记/d.png', Buffer.alloc(4))
    put('附件/杂/e.png', Buffer.alloc(4))
    put('附件/杂/f g.png', Buffer.alloc(4))
    put('附件/封皮/c.png', Buffer.alloc(4))
    put('附件/杂/坏链.png', Buffer.alloc(4))
    put('.canvas-notes/首页.json', JSON.stringify({ bg: '附件/杂/首页底.png' }))
    put('附件/杂/首页底.png', Buffer.alloc(4))
    put('课程/讲义.pdf', '%PDF')
    put('附件/课程/讲义.pdf/p1.png', Buffer.alloc(4))
    put('写作/测试.md', '# 测试\n')
    put('附件/手写/测试/手写-1.png', Buffer.alloc(4))
    put('附件/手写/测试/手写-1.drawing', Buffer.alloc(4))
    put('附件/封面/首页.jpg', Buffer.alloc(4))
    put('附件/写作/游记/没链着也算它的.png', Buffer.alloc(4))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', '建好'])
    // 只删了笔记，附件留下（修好以前的样子）
    git(root, ['rm', '-q', '剪藏/第三方/冰岛.md', '剪藏/视频/讲座.md'])
    git(root, ['commit', '-q', '-m', '移到废纸篓：剪藏'])
  }

  it('只列真没人用的；按原来属于哪篇分组（附件文件夹对得上名字的、链着那组图的删掉的笔记）', async () => {
    leftover()
    expect((await orphanFiles(root)).map((f) => f.path).sort()).toEqual(['附件/剪藏/第三方/冰岛/a.png', '附件/剪藏/第三方/冰岛/b.png', '附件/视频/yt-9/03-04.jpg'])
    const g = await orphanGroups(new Vault(root))
    expect(g.map((x) => [x.dir, x.note, x.items.length])).toEqual([
      ['附件/剪藏/第三方/冰岛', '剪藏/第三方/冰岛.md', 2],
      ['附件/视频/yt-9', '剪藏/视频/讲座.md', 1],
    ])
  })

  it('点一下一起进废纸篓、一次提交；又有人用了的不动；撤回（反向提交）都回来', async () => {
    leftover()
    const v = new Vault(root)
    const all = (await orphanGroups(v)).flatMap((g) => g.items.map((i) => i.path))
    // 列出来以后又有一篇链上了 b.png
    put('写作/新的.md', '# 新的\n\n![](../附件/剪藏/第三方/冰岛/b.png)\n')
    const r = await trashOrphans(v, all, testTrash(trash))
    expect(r.n).toBe(2)
    expect(existsSync(join(root, '附件/剪藏/第三方/冰岛/b.png'))).toBe(true)
    expect(existsSync(join(root, '附件/剪藏/第三方/冰岛/a.png'))).toBe(false)
    expect(existsSync(join(root, '附件/视频'))).toBe(false)
    expect(git(root, ['log', '-1', '--format=%s'])).toBe('移到废纸篓：没人用的附件 2 个')
    expect(git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual(['附件/剪藏/第三方/冰岛/a.png', '附件/视频/yt-9/03-04.jpg'])
    git(root, ['revert', '--no-edit', r.commit!])
    expect(existsSync(join(root, '附件/剪藏/第三方/冰岛/a.png'))).toBe(true)
    expect(existsSync(join(root, '附件/视频/yt-9/03-04.jpg'))).toBe(true)
  })

  it('「最近删掉的」里同一次删的附件按文件夹合成一条（「冰岛」的附件），放回一起回来', async () => {
    leftover()
    const v = new Vault(root)
    await trashOrphans(v, ['附件/剪藏/第三方/冰岛/a.png', '附件/剪藏/第三方/冰岛/b.png'], testTrash(trash))
    const items = (await recentDeleted(v)).filter((i) => i.path.startsWith('附件/'))
    expect(items).toHaveLength(1)
    expect([items[0]!.path, ...(items[0]!.with ?? [])].sort()).toEqual(['附件/剪藏/第三方/冰岛/a.png', '附件/剪藏/第三方/冰岛/b.png'])
    expect(items[0]!.attachOf).toBe('剪藏/第三方/冰岛.md')
  })

  // 用户真库的只读副本（CN_REAL_VAULT 指着它时才跑）：11-23 删剪藏以后留下的那些
  it.skipIf(!process.env.CN_REAL_VAULT)('真库副本：列出来的数和分组', async () => {
    const g = await orphanGroups(new Vault(process.env.CN_REAL_VAULT!))
    const rows = g.map((x) => `${x.items.length}\t${x.dir}\t${x.note ?? '（认不出）'}`)
    if (process.env.CN_REAL_VAULT_OUT) writeFileSync(process.env.CN_REAL_VAULT_OUT, `没人用的附件 ${g.reduce((n, x) => n + x.items.length, 0)} 个\n${rows.join("\n")}\n`)
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBeGreaterThan(0)
  })
})
