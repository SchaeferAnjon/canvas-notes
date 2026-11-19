// 顶级分类（2026-11-18 用户定：方向 A 活动栏平铺 + C 首页分类卡，方案 3「分两组」）：分类表、「放什么」、打开老库时整理一次
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CATEGORIES, descsJson, descOf, groupLeft, isCategory, normalizeDescs } from '../src/shared/categories'
import { organizeCategories, readDescs, writeDesc } from '../src/main/categories'
import { moveMany } from '../src/main/folder-ops'
import { Vault } from '../src/main/vault'

describe('分类表', () => {
  it('八个分类按「收件箱 | 读进来的 课程 阅读 剪藏 | 自己写的 周记 写作 项目 生活」排；每类有图标、颜色、一句「放什么」', () => {
    expect(CATEGORIES.map((c) => [c.name, c.group, c.icon])).toEqual([
      ['收件箱', '', 'inbox'],
      ['课程', '读进来的', 'folder-library'],
      ['阅读', '读进来的', 'book'],
      ['剪藏', '读进来的', 'bookmark'],
      ['周记', '自己写的', 'calendar'],
      ['写作', '自己写的', 'edit'],
      ['项目', '自己写的', 'project'],
      ['生活', '自己写的', 'heart'],
    ])
    expect(isCategory('阅读')).toBe(true)
    expect(isCategory('素材')).toBe(false)
    expect(isCategory('写作/游记')).toBe(false)
  })

  it('活动栏分段：分类按组、组里按 left 的先后，自己摘的文件夹在最后一段；空的组不出现', () => {
    expect(groupLeft(['写作', '收件箱', '阅读/人类简史', '课程', '生活'])).toEqual([['收件箱'], ['课程'], ['写作', '生活'], ['阅读/人类简史']])
    expect(groupLeft([])).toEqual([])
  })

  it('「放什么」只存改过的；跟默认一样的、不是自带分类的、空的不存；写进文件的顺序照分类表', () => {
    const d = normalizeDescs({ 放什么: { 生活: ' 身体和钱 ', 课程: CATEGORIES[1]!.desc, 素材: 'x', 阅读: '' } })
    expect(d).toEqual({ 生活: '身体和钱' })
    expect(descOf(d, '生活')).toBe('身体和钱')
    expect(descOf(d, '阅读')).toBe('读的书和划线；微信读书同步进来的也放这里')
    expect(descsJson({ 生活: '身体和钱', 收件箱: '先放这里' })).toBe('{\n  "放什么": {\n    "收件箱": "先放这里",\n    "生活": "身体和钱"\n  }\n}\n')
    expect(normalizeDescs('{坏')).toEqual({})
  })
})

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
function vaultWith(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'cn-cat-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  return { root, v: new Vault(root) }
}
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const status = (root: string) => g(root, 'status', '--porcelain', '--untracked-files=all').trim()

describe('打开老库时整理一次（素材 → 剪藏，素材/微信读书 → 阅读）', () => {
  const OLD = {
    '素材/微信读书/人类简史.md': '---\n书名: 人类简史\n---\n> 我们没有驯化小麦\n',
    '素材/冰岛旅行/住哪.md': '# 住哪\n\n![](../../附件/素材/冰岛旅行/住哪/1.png)\n',
    '附件/素材/冰岛旅行/住哪/1.png': 'png',
    '写作/游记.md': '# 游记\n\n见 [住哪](../素材/冰岛旅行/住哪.md)、[书](../素材/微信读书/人类简史.md)，还有 [[人类简史]]。\n',
    '.canvas-notes/置顶.json': JSON.stringify(['素材/微信读书/人类简史.md', '素材/冰岛旅行/']),
    '.canvas-notes/左栏.json': JSON.stringify({ 左边: ['课程', '收件箱', '素材/微信读书'], 图标: { '素材/冰岛旅行': { icon: 'map', color: 'green' } } }),
  }

  it('一次提交：文件夹、附件文件夹一起挪，链接、置顶、左栏跟着改；什么都不丢，再开一次什么都不做', async () => {
    const { root, v } = vaultWith(OLD)
    const before = Number(g(root, 'rev-list', '--count', 'HEAD').trim())
    const moved: [string, string][] = []
    const r = await organizeCategories(v, (a, b) => moved.push([a, b]))
    expect(r!.moves).toEqual([
      { from: '素材/微信读书', to: '阅读' },
      { from: '素材', to: '剪藏' },
    ])
    expect(Number(g(root, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('整理顶级分类：素材/微信读书/ → 阅读/，素材/ → 剪藏/（链接、附件、置顶、左栏跟着改）')
    expect(status(root)).toBe('')
    expect(existsSync(join(root, '素材'))).toBe(false)
    expect(read(root, '阅读/人类简史.md')).toBe(OLD['素材/微信读书/人类简史.md'])
    expect(read(root, '剪藏/冰岛旅行/住哪.md')).toBe('# 住哪\n\n![](../../附件/剪藏/冰岛旅行/住哪/1.png)\n')
    expect(read(root, '附件/剪藏/冰岛旅行/住哪/1.png')).toBe('png')
    expect(read(root, '写作/游记.md')).toBe('# 游记\n\n见 [住哪](../剪藏/冰岛旅行/住哪.md)、[书](../阅读/人类简史.md)，还有 [[人类简史]]。\n')
    expect(JSON.parse(read(root, '.canvas-notes/置顶.json'))).toEqual(['阅读/人类简史.md', '剪藏/冰岛旅行/'])
    const left = JSON.parse(read(root, '.canvas-notes/左栏.json'))
    expect(left['左边']).toEqual(['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'])
    expect(left['图标']).toEqual({ '剪藏/冰岛旅行': { icon: 'map', color: 'green' } })
    expect(moved).toContainEqual(['素材/微信读书/人类简史.md', '阅读/人类简史.md'])
    expect(await organizeCategories(v)).toBeNull()
  })

  it('新名字已经有了：一样一样挪进去，重名的留在原处不覆盖；没有「素材」的新库什么都不做', async () => {
    const { root, v } = vaultWith({ '素材/a.md': '# 素材的a\n', '素材/b.md': '# b\n', '剪藏/a.md': '# 剪藏的a\n', '写作/x.md': '# x\n' })
    const r = await organizeCategories(v)
    expect(r!.moves).toEqual([{ from: '素材/b.md', to: '剪藏/b.md' }])
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('整理顶级分类：素材/b.md → 剪藏/b.md（链接、附件、置顶、左栏跟着改）')
    expect(read(root, '剪藏/a.md')).toBe('# 剪藏的a\n')
    expect(read(root, '剪藏/b.md')).toBe('# b\n')
    expect(read(root, '素材/a.md')).toBe('# 素材的a\n')
    expect(status(root)).toBe('')
    const fresh = vaultWith({ '写作/x.md': '# x\n' })
    expect(await organizeCategories(fresh.v)).toBeNull()
    expect(status(fresh.root)).toBe('')
  })

  it('改「放什么」：写进 .canvas-notes/分类.json，空的是恢复默认；不是自带的分类拒绝', async () => {
    const { root, v } = vaultWith({ 'a.md': '# a\n' })
    expect(await readDescs(v)).toEqual({})
    expect(await writeDesc(v, '阅读', '纸书和电子书')).toEqual({ 阅读: '纸书和电子书' })
    expect(JSON.parse(read(root, '.canvas-notes/分类.json'))).toEqual({ 放什么: { 阅读: '纸书和电子书' } })
    expect(await writeDesc(v, '阅读', '')).toEqual({})
    await expect(writeDesc(v, '素材', 'x')).rejects.toThrow('不是自带的分类')
  })
})

describe('文件树选了好几个一起挪（CN-105）', () => {
  it('五篇连附件一起挪进别的文件夹：别处指向它们的链接改好，一次提交；PDF 不挪', async () => {
    const files: Record<string, string> = { '写作/索引.md': '# 索引\n\n' }
    for (const n of [1, 2, 3, 4, 5]) {
      files[`收件箱/第${n}篇.md`] = `# 第${n}篇\n\n![](../附件/收件箱/第${n}篇/图.png)\n`
      files[`附件/收件箱/第${n}篇/图.png`] = 'png'
      files['写作/索引.md'] += `- [第${n}篇](../收件箱/第${n}篇.md)\n`
    }
    files['收件箱/资料.pdf'] = '%PDF'
    const { root, v } = vaultWith(files)
    const before = Number(g(root, 'rev-list', '--count', 'HEAD').trim())
    const paths = [1, 2, 3, 4, 5].map((n) => `收件箱/第${n}篇.md`)
    const r = await moveMany(v, [...paths, '收件箱/资料.pdf'], '项目/冰岛旅行')
    expect(r.moves.map((m) => m.to)).toEqual([1, 2, 3, 4, 5].map((n) => `项目/冰岛旅行/第${n}篇.md`))
    expect(r.skipped).toEqual(['收件箱/资料.pdf'])
    expect(Number(g(root, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('移动 5 个：第1篇、第2篇、第3篇、第4篇、第5篇 → 项目/冰岛旅行')
    expect(status(root)).toBe('')
    expect(read(root, '写作/索引.md')).toBe('# 索引\n\n' + [1, 2, 3, 4, 5].map((n) => `- [第${n}篇](../项目/冰岛旅行/第${n}篇.md)\n`).join(''))
    expect(read(root, '项目/冰岛旅行/第3篇.md')).toBe('# 第3篇\n\n![](../../附件/项目/冰岛旅行/第3篇/图.png)\n')
    expect(read(root, '附件/项目/冰岛旅行/第3篇/图.png')).toBe('png')
    expect(existsSync(join(root, '收件箱/资料.pdf'))).toBe(true)
  })
})
