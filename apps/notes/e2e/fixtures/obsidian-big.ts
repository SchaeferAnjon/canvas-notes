/**
 * 造一个和用户那个 Obsidian 库同规模的样本库（2026-11-26「导入 Obsidian 库卡死」）：默认 3000 篇 md、2700 张图、300 份 PDF，
 * 约 300 MB；图是能打开的 PNG 后面接着随机字节（像照片一样压不小，git 存它和存真照片一样费劲），PDF 每份几页真字。
 * 库根上有 .git 指针文件（指到别的电脑上的路径，和用户那份一样）和 .obsidian/（设置、插件），还有 .trash/。
 * 笔记之间有双链、嵌图（带宽的）、链 PDF、链不到的；一部分名字是分解写法（NFD）的韩文；文件夹照用户那份的样子分几层，附件放在各自的 attachments/ 和库根的 附件/ 里。
 * 同一个 seed 造出来的一模一样。不碰用户的真库。
 *
 * 命令行：node --experimental-strip-types apps/notes/e2e/fixtures/obsidian-big.ts <文件夹> [篇数] [图数] [PDF 数]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { solidPng } from './png'
import { lecturePdf } from './pdf'

export interface ObsidianBig {
  dir: string
  notes: number
  images: number
  pdfs: number
  bytes: number
  /** 所有笔记和附件的相对路径（造占位文件时从里面挑） */
  files: string[]
}

const FOLDERS = ['00-Inbox', '10-Journal/2024', '10-Journal/2025', '10-Journal/2026', '20-Projects/Alpha', '20-Projects/Beta', '20-Projects/Gamma/设计', '30-Courses/线性代数', '30-Courses/机器学习', '30-Courses/写作课', '40-Clippings', '40-Clippings/网页', '50-Series/读书', '50-Series/电影', '50-Series/播客', '60-Creative', '80-Meta', '80-Meta/模板', '']
const EN = 'matrix eigenvalue gradient descent learning model data function test design product note card board inbox reading writing habit time memory review project report meeting record'.split(' ')
const WORDS = '今天 想到 一个 问题 为什么 我们 总是 先 规划 再 动手 其实 随手 记下来 更 重要 冰岛 自驾 极光 预报 读书 笔记 产品 设计 卡片 白板 收件箱 整理 素材 引用 文章 写作 习惯 时间 管理 工具 软件 记忆 复习 灵感 项目 周报 会议 记录 学习 编程 函数 测试 数据 模型 矩阵 特征值 梯度 下降'.split(' ')

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function makeObsidianBig(dir: string, o: { notes?: number; images?: number; pdfs?: number; seed?: number; imageKb?: number } = {}): ObsidianBig {
  const N = o.notes ?? 3000
  const IMG = o.images ?? 2700
  const PDF = o.pdfs ?? 300
  const r = rng(o.seed ?? 11)
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]!
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join('')
  const en = (n: number) => Array.from({ length: n }, () => pick(EN)).join(' ')
  let bytes = 0
  const files: string[] = []
  const put = (rel: string, data: string | Buffer, track = true) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), data)
    if (track) {
      files.push(rel)
      bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.length
    }
  }
  // 库根的 .git 是指针文件，指向别的电脑上的仓库（用户的库是这样：git -C 库 log 报 not a git repository）
  put('.git', 'gitdir: /Volumes/old-mac/.vault-git\n', false)
  put('.gitignore', '.obsidian/workspace.json\n.trash/\n', false)
  put('.obsidian/app.json', JSON.stringify({ attachmentFolderPath: '附件', newLinkFormat: 'shortest' }), false)
  put('.obsidian/appearance.json', '{"theme":"obsidian"}', false)
  put('.obsidian/workspace.json', '{"main":{}}', false)
  for (const p of ['dataview', 'templater-obsidian', 'obsidian-git']) {
    put(`.obsidian/plugins/${p}/manifest.json`, JSON.stringify({ id: p, version: '1.0.0' }), false)
    put(`.obsidian/plugins/${p}/main.js`, '// plugin\n'.repeat(2000), false)
  }
  put('.trash/删掉的.md', '# 删掉的\n', false)

  // 附件：一半放各自文件夹的 attachments/，一半放库根的 附件/
  const png = solidPng(8, 8, [120, 160, 200])
  const kb = o.imageKb ?? 80
  const atts: string[] = []
  for (let i = 0; i < IMG; i++) {
    const folder = pick(FOLDERS)
    const rel = r() < 0.5 ? `附件/Pasted image ${20240000 + i}.png` : `${folder ? folder + '/' : ''}attachments/图${i}.png`
    const tail = Buffer.alloc(Math.floor((kb * 256 * (0.4 + r() * 1.2))) * 4)
    for (let k = 0; k < tail.length; k += 4) tail.writeUInt32LE((r() * 2 ** 32) >>> 0, k)
    put(rel, Buffer.concat([png, tail]))
    atts.push(rel)
  }
  const pdfs: string[] = []
  for (let i = 0; i < PDF; i++) {
    const folder = pick(FOLDERS.filter((f) => f.startsWith('30-') || f.startsWith('40-') || f.startsWith('50-')))
    const rel = `${folder}/资料${i}.pdf`
    put(rel, lecturePdf(Array.from({ length: 3 + Math.floor(r() * 6) }, (_, p) => ({ title: `Page ${p + 1} ${en(3)}`, lines: Array.from({ length: 12 }, () => en(12)) }))))
    pdfs.push(rel)
  }

  const names: string[] = []
  // 每 40 篇有一篇名字带韩文、写成分解形式（NFD）：用户的库里访达、iCloud 来的名字就是这样，git 的名单要换成合成形式才认
  for (let i = 0; i < N; i++) names.push(i % 40 === 7 ? `${words(1)} ${i} 아요어요`.normalize('NFD') : `${words(2)} ${i}`)
  for (let i = 0; i < N; i++) {
    const folder = FOLDERS[i % FOLDERS.length]!
    const rel = `${folder ? folder + '/' : ''}${names[i]}.md`
    const body: string[] = [`---`, `created: 2024-0${1 + (i % 9)}-1${i % 9} 10:0${i % 10}`, `tags: [${pick(['读书', '项目', '课程', '日记'])}]`, `---`, '', `# ${names[i]}`, '']
    for (let p = 0; p < 4 + Math.floor(r() * 8); p++) {
      let line = words(20 + Math.floor(r() * 30))
      const x = r()
      if (x < 0.35) line += ` 见 [[${pick(names)}]]`
      else if (x < 0.45) line += ` 另见 [[${pick(names)}|别名]]`
      else if (x < 0.5) line += ` 链不到 [[不存在的笔记 ${i}]]`
      body.push(line, '')
    }
    if (r() < 0.6) body.push(`![[${pick(atts).split('/').pop()}${r() < 0.3 ? '|300' : ''}]]`, '')
    if (r() < 0.15) body.push(`[[${pick(pdfs).split('/').pop()}]]`, '')
    if (r() < 0.1) body.push(`%%\n这一段是注释\n%%`, '')
    put(rel, body.join('\n'))
  }
  return { dir, notes: N, images: IMG, pdfs: PDF, bytes, files }
}

if (process.argv[1]?.endsWith('obsidian-big.ts') && process.argv[2]) {
  const [, , d, n, i, p] = process.argv
  const s = makeObsidianBig(d!, { notes: n ? Number(n) : undefined, images: i ? Number(i) : undefined, pdfs: p ? Number(p) : undefined })
  console.log(`${s.notes} 篇、${s.images} 张图、${s.pdfs} 份 PDF，${(s.bytes / 1e6).toFixed(0)} MB → ${d}`)
}
