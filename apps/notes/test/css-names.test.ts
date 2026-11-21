/**
 * 第 8 轮：太通用的类名撞了。设置外观页主题小样的 `.mini`（settings.css，不带前缀，样式表一直载着）盖到了白板「未整理」的 `.mini` 上，
 * 卡被压成 72 高的三行网格，字和「收件箱」叠在一起；同样还有首页的 `.cover`（高 220）压到白板视频卡封面、
 * 首页的 `.th`、`.thumbs` 压到读 PDF 笔记的可视化卡、文件夹组件、删笔记时的图。
 * 这些名字现在只许它们自己那一处用；别处要用同样的东西，起带前缀的名字。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const SRC = join(__dirname, '../src/renderer')

/** 裸定义（选择器以它开头、不嵌在别的类下面）的通用名字 → 只许出现在这些文件的 className 里 */
const OWNERS: Record<string, string[]> = {
  mini: ['Settings.tsx'],
  cover: ['HomeView.tsx', 'folder-home/FolderHomeView.tsx'],
  th: ['HomeView.tsx', 'folder-home/cover.tsx'],
  thumbs: ['HomeView.tsx'],
  // 梦游报告的清单（dream.css 里裸定义）：白板收件箱一格曾经也叫 .dlist，被它的样式压歪（2026-11-21）
  dlist: ['dream/DreamPanel.tsx'],
  // 首页组件（home.css 里裸定义 .wd）：选 AI 的选择器上的小红点曾经也叫 .wd，被拉成一大块红（task-m55m7）
  wd: ['HomeView.tsx', 'folder-home/FolderHomeView.tsx'],
}

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) files(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

it('通用类名（.mini、.cover、.th、.thumbs、.dlist、.wd）只在它自己那一处用，别处起带前缀的名字', () => {
  const hits: string[] = []
  for (const f of files(SRC)) {
    const rel = relative(SRC, f)
    const text = readFileSync(f, 'utf8')
    // className="a b"、className={'a' + …}、className={`a ${…}`}、el.className = 'a'
    for (const m of text.matchAll(/className\s*=\s*(?:\{\s*)?(["'`])([^"'`]*)\1/g)) {
      for (const name of m[2]!.split(/\s+/)) {
        const owners = OWNERS[name]
        if (owners && !owners.includes(rel)) hits.push(`${rel}: ${name}`)
      }
    }
  }
  expect(hits).toEqual([])
})
