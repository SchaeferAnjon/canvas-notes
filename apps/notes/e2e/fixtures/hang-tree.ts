/**
 * 文件树里挂着子文件的样本（task-wuv05）：白板下的导图和子白板（属性 所属白板）、PDF 下的笔记、笔记下的可视化、笔记下的数据库记录文件夹。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { newReadingNote, renderSection, withDerived, type AskSection } from '@cn/format'
import { LECTURE } from './pdf'

export const DIR = '课程/线性代数'
export const PDF = `${DIR}/Lecture05.pdf`
export const NOTE = `${DIR}/Lecture05 笔记.md`
export const VIZ = `${DIR}/旋转矩阵.html`
export const BOARD = `${DIR}/复习.md`
export const MAP = `${DIR}/导图 11-22 17∶51.md`
export const SUB = `${DIR}/第三讲细节.md`
export const PLAN = `${DIR}/学习计划.md`
export const DB = `${DIR}/未命名数据库`

const sec: AskSection = withDerived({
  id: '.canvas-notes/对话/Lecture05-p2-1.md',
  file: PDF,
  page: 2,
  title: '旋转矩阵',
  time: '10:20',
  figures: [],
  doubts: [],
  good: '',
  points: [],
  failed: [],
  rounds: 0,
  links: [],
  qas: [{ q: '为什么列是基向量的像？', a: '因为矩阵乘基向量就取出那一列。', sides: [] }],
  recap: '第 2 页讲旋转。',
  viz: { path: VIZ, title: '旋转矩阵 · 拖动角度看基向量', embed: true },
})

export const FILES: Record<string, string | Uint8Array> = {
  [BOARD]: '---\ntype: board\n---\n# 复习\n\n## 第三讲\n\n[[导图 11-22 17∶51]]\n\n[[第三讲细节]]\n',
  [MAP]: '---\ntype: board\n白板样式: 导图\n类型: 导图\n所属白板: "[[复习]]"\n---\n# 导图 11-22 17∶51\n\n- 线性映射\n  - 定义\n  - 核与像\n',
  [SUB]: '---\ntype: board\n所属白板: "[[复习]]"\n---\n# 第三讲细节\n\n## 例子\n\n旋转。\n',
  [PDF]: LECTURE,
  [NOTE]: newReadingNote(PDF, new Date(2026, 10, 21)) + '\n' + renderSection(sec, NOTE),
  [VIZ]: '<!doctype html><title>旋转矩阵</title><meta name="类型" content="可视化"><p>旋转</p>',
  [PLAN]: '# 学习计划\n\n```base\nfilters:\n  and:\n    - file.inFolder("' + DB + '")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```\n',
  [`${DB}/第一周.md`]: '---\n状态: 进行中\n---\n# 第一周\n',
  [`${DIR}/第4讲 特征值.md`]: '# 第4讲 特征值\n',
}

export const settings = (appearance: Record<string, unknown>) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}

