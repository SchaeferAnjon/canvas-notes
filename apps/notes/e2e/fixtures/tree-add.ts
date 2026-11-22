/**
 * 左栏只加不改（task-4891y）的样本库：照 /private/tmp/canvas-notes-visual/06-文件管理/4-加进左栏-浅.png 那张图摆，
 * 收件箱两篇、课程三门（study project 里一篇带数据库、一块白板；study project 2 里一份长名字的 PDF 和它的笔记，问了 6 问）、
 * 阅读、剪藏、周记、写作、项目（冰岛自驾）、生活各一篇。置顶（钉住）的两样写在 .canvas-notes/置顶.json 里（只有 PINNED 给了才写）。
 */
import { type AskQa, type AskSection, newReadingNote, upsertSection } from '@cn/format'
import { lecturePdf } from './pdf'

export const LONG_PDF = '课程/study project 2/YitingWei_2026_C72_Lecture_Notes.pdf'
export const LONG_NOTE = '课程/study project 2/YitingWei_2026_C72_Lecture_Notes 笔记.md'
export const DB_NOTE = '课程/study project/学习笔记：动手学深度学习.md'
export const DB_DIR = '课程/study project/未命名数据库'
export const BOARD = '课程/study project/小论文计划.md'
export const INBOX_NOTE = '收件箱/周三组会要问的.md'

const qa = (q: string): AskQa => ({ q, a: `关于「${q}」的回答。`, sides: [] })

function section(page: number, qas: AskQa[]): AskSection {
  return {
    id: `.canvas-notes/对话/YitingWei-p${page}-1.md`,
    file: LONG_PDF,
    page,
    rect: [0.1, 0.2, 0.8, 0.2],
    title: `第 ${page} 页`,
    time: '20:21',
    crop: '',
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas,
    recap: '',
  }
}

function readingNote(): string {
  let t = newReadingNote(LONG_PDF, new Date(2026, 10, 21))
  t = upsertSection(t, section(1, [qa('这一页讲什么'), qa('为什么这样定义'), qa('举个例子')]), LONG_NOTE)
  t = upsertSection(t, section(2, [qa('和上一页什么关系'), qa('公式怎么推'), qa('考试会怎么考')]), LONG_NOTE)
  return t
}

const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("' + DB_DIR + '")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'
const board = (color: string) => `---\ntype: board\ncolor: ${color}\n---\n<!-- card id=c0 x=0 y=0 w=220 -->\n## 提纲\n\n<!-- card id=c1 x=260 y=0 w=220 -->\n先列提纲。\n`

export function treeAddVault(o: { pins?: boolean } = {}): Record<string, string | Uint8Array> {
  return {
    [INBOX_NOTE]: '# 周三组会要问的\n\n问老师第三章。\n',
    '收件箱/Kindle 导出的标注.md': '# Kindle 导出的标注\n\n几段划线。\n',
    '课程/ecp/第5讲.md': '# 第5讲\n\n注意力。\n',
    [DB_NOTE]: `# 学习笔记：动手学深度学习\n\n2.1 数据操作。\n\n${BASE}\n`,
    [`${DB_DIR}/第一条.md`]: '# 第一条\n',
    [`${DB_DIR}/第二条.md`]: '# 第二条\n',
    [`${DB_DIR}/第三条.md`]: '# 第三条\n',
    [BOARD]: board('#2E7FA3'),
    [LONG_PDF]: lecturePdf([{ title: 'Lecture Notes', lines: ['Week 1.'] }]),
    [LONG_NOTE]: readingNote(),
    '阅读/置身事内.md': '# 置身事内\n\n第一章。\n',
    '剪藏/冰岛旅行.md': '# 冰岛旅行\n\n十天。\n',
    '周记/第47周.md': '# 第47周\n\n这周。\n',
    '写作/草稿.md': '# 草稿\n\n还没写完。\n',
    '项目/冰岛自驾/行程.md': '# 行程\n\n第一天。\n',
    '项目/搬家/清单.md': '# 清单\n\n纸箱。\n',
    '生活/菜谱.md': '# 菜谱\n\n番茄炒蛋。\n',
    ...(o.pins ? { '.canvas-notes/置顶.json': JSON.stringify(['课程/study project 2/', BOARD], null, 2) + '\n' } : {}),
  }
}
