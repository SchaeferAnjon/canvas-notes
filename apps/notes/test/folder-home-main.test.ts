import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, ipcMain: {} }))

const { createFolder, htmlMeta, listFolderHomes, propFiles, readFolderHome, renameEmptyFolder, writeFolderHome } = await import('../src/main/folder-home')
const { Vault } = await import('../src/main/vault')
const { defaultFolderHome, addWidget } = await import('../src/shared/folder-home')

const root = mkdtempSync(join(tmpdir(), 'cn-fhome-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const put = (p: string, t: string) => (mkdirSync(dirname(join(root, p)), { recursive: true }), writeFileSync(join(root, p), t))

describe('文件夹首页存盘', () => {
  const v = new Vault(root)
  put('课程/线性代数/第3讲 导图.md', '---\n类型: 导图\n第几讲: 3\n---\n# 第3讲\n')
  put('课程/线性代数/第2讲 向量空间.pdf', '%PDF')
  put('课程/线性代数/.首页/cover.jpg', 'x')
  put('课程/概率论/第1讲.md', '# 第1讲\n')

  it('没存过：用默认；存了以后读回来一样，写盘先临时文件再改名', async () => {
    const r = await readFolderHome(v, '课程/线性代数')
    expect(r).toEqual({ home: defaultFolderHome('course'), saved: false, template: false })
    const next = addWidget(r.home, 'list', 'course').home
    await writeFolderHome(v, '课程/线性代数', next)
    expect((await readFolderHome(v, '课程/线性代数')).home).toEqual(next)
    expect(readdirSync(join(root, '课程/线性代数')).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(join(root, '课程/线性代数/.首页.json'), 'utf8')).order.at(-1)).toBe('list')
  })

  it('没存过、有模板：用模板', async () => {
    const tpl = { ...defaultFolderHome('course'), icon: 'atom', style: 'b' }
    put('课程/.首页模板.json', JSON.stringify(tpl))
    const r = await readFolderHome(v, '课程/概率论')
    expect(r.template).toBe(true)
    expect(r.home.icon).toBe('atom')
  })

  it('不是有首页的文件夹就拒绝', async () => {
    await expect(readFolderHome(v, '课程')).rejects.toThrow('没有首页')
    await expect(writeFolderHome(v, '../外面', {})).rejects.toThrow('没有首页')
  })

  it('列出文件和属性：md 读开头，PDF 当课件、从名字认第几讲，点开头的跳过', async () => {
    const files = await propFiles(v, '课程/线性代数')
    expect(files.map((f) => [f.path, f.props]).sort()).toEqual(
      [
        ['课程/线性代数/第2讲 向量空间.pdf', { 类型: '课件', 第几讲: '2' }],
        ['课程/线性代数/第3讲 导图.md', { 类型: '导图', 第几讲: '3' }],
      ].sort(),
    )
    expect((await propFiles(v, null)).length).toBe(3)
  })

  it('课件问到第几页读旁边那篇笔记的「进度」；做好的可视化（HTML）读 <head> 里的 meta', async () => {
    put('课程/读/第1讲 向量.pdf', '%PDF')
    put('课程/读/第1讲 向量 笔记.md', '---\n类型: 笔记\n第几讲: 1\n进度: 7/10\n---\n# 第1讲 向量 笔记\n')
    put('课程/读/第2讲.pdf', '%PDF')
    put('课程/读/旋转矩阵.html', '<!doctype html><html><head>\n<meta name="类型" content="可视化">\n<meta name="第几讲" content="3">\n<title>旋转矩阵</title></head><body></body></html>')
    const files = await propFiles(v, '课程/读')
    const by = (p: string) => files.find((f) => f.path === `课程/读/${p}`)!.props
    expect(by('第1讲 向量.pdf')).toEqual({ 类型: '课件', 第几讲: '1', 问到: '7', 页数: '10' })
    expect(by('第2讲.pdf')).toEqual({ 类型: '课件', 第几讲: '2' })
    expect(by('旋转矩阵.html')).toEqual({ 类型: '可视化', 第几讲: '3' })
    expect(htmlMeta('<meta name="来源" content="[[a &quot;b&quot;.pdf]]">')).toEqual({ 来源: '[[a "b".pdf]]' })
  })

  it('列出有首页的文件夹：课程、项目下一层，生活、写作本身，带图标和颜色', async () => {
    put('生活/购物.md', '# 购物\n')
    put('项目/毕业论文/.首页.json', JSON.stringify({ ...defaultFolderHome('project'), icon: 'code', color: '#7C9E8A' }))
    put('素材/AI/a.md', '# a\n')
    const list = await listFolderHomes(v)
    expect(list.map((f) => f.folder)).toEqual(['课程/读', '课程/概率论', '课程/线性代数', '项目/毕业论文', '生活'])
    expect(list.find((f) => f.folder === '项目/毕业论文')).toEqual({ folder: '项目/毕业论文', kind: 'project', icon: 'code', color: '#7C9E8A' })
    // 概率论没存过、用的是模板（上面那个测试放的，图标 atom）
    expect(list[1]!.icon).toBe('atom')
  })

  it('新建一门课：名字重了加序号；空的时候能改名，有文件了就不改', async () => {
    const a = await createFolder(v, '课程/新的课程')
    const b = await createFolder(v, '课程/新的课程')
    expect([a, b]).toEqual(['课程/新的课程', '课程/新的课程 2'])
    await expect(createFolder(v, '生活')).rejects.toThrow('只能新建课程和项目')
    expect(await renameEmptyFolder(v, b, '  数值分析 ')).toBe('课程/数值分析')
    expect(existsSync(join(root, '课程/数值分析'))).toBe(true)
    expect(existsSync(join(root, b))).toBe(false)
    await expect(renameEmptyFolder(v, a, '数值分析')).rejects.toThrow('已经有「数值分析」了')
    await expect(renameEmptyFolder(v, a, '../外面')).rejects.toThrow('不能有')
    await expect(renameEmptyFolder(v, '课程/线性代数', '线代')).rejects.toThrow('已经有文件了')
  })
})
