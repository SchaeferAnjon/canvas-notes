// 网页图拖进对话：AI 输入框里那张图的来源一行、剪进文档的说明和来源，从那篇里认回剪过的图（网页上标「剪过」）。
import { describe, expect, it } from 'vitest'
import { figName, figNumber, imgChipLabel, imgClip, siteOf, webImgOf } from '../src/shared/web-img'
import { webEntries } from '../src/shared/web-notes'
import { imageMarkdown } from '../src/renderer/web/image-drop'

const PAGE = 'https://zh.d2l.ai/chapter_convolutional-neural-networks/conv-layer.html'
const TITLE = '6.2. 图像卷积 — 动手学深度学习 2.0.0 documentation'
const CAP = '图6.2.1 二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张量元素和核张量元素：0×0+1×1+3×2+4×3=19.'
const D2L = { src: 'https://zh.d2l.ai/_images/correlation.svg', alt: '../_images/correlation.svg', caption: CAP, head: '6.2.1. 互相关运算', url: PAGE, title: TITLE }

describe('网页图的名字', () => {
  it('图注开头的图号：图6.2.1 → 图 6.2.1，Figure 3: → Figure 3；没有图号是 null', () => {
    expect(figNumber(CAP)).toBe('图 6.2.1')
    expect(figNumber('Figure 3: The Transformer')).toBe('Figure 3')
    expect(figNumber('Fig. 2-1 overview')).toBe('Fig. 2-1')
    expect(figNumber('二维互相关运算')).toBeNull()
  })
  it('没有图号用图注、alt 的头 16 个字，再不然上面的小标题', () => {
    expect(figName({ caption: '一只在雪地里奔跑的北极狐，背景是冰川和远山', alt: '', head: undefined })).toBe('一只在雪地里奔跑的北极狐，背景是…')
    expect(figName({ caption: '', alt: '黑沙滩远景', head: '南岸' })).toBe('黑沙滩远景')
    expect(figName({ caption: '', alt: '', head: '2.2.1. 读取数据集' })).toBe('2.2.1 读取数据集')
    expect(figName({ caption: '', alt: '', head: undefined })).toBe('')
  })
  it('AI 输入框里的来源一行「图 6.2.1 · zh.d2l.ai」；www. 去掉；什么都没有时写「网页上的图」', () => {
    expect(imgChipLabel(D2L)).toBe('图 6.2.1 · zh.d2l.ai')
    expect(siteOf('https://www.example.com/a')).toBe('example.com')
    expect(imgChipLabel({ src: 'data:image/png;base64,AAAA', alt: '', caption: '', url: 'about:blank', title: '' })).toBe('网页上的图')
  })
  it('网页预加载报来的查一遍：地址、网址不是字给 null，太长的截短', () => {
    expect(webImgOf({ src: 1, url: PAGE })).toBeNull()
    expect(webImgOf({ src: 'https://a/b.png', url: PAGE, caption: 'x'.repeat(900), title: 3 })).toEqual({ src: 'https://a/b.png', alt: '', caption: 'x'.repeat(400), url: PAGE, title: '' })
  })
})

describe('剪进文档', () => {
  it('说明是图注（120 字以内），来源「图 6.2.1 · 动手学深度学习」，链接回到图注开头', () => {
    const c = imgClip(D2L)
    expect(c.alt).toBe(CAP)
    expect(c.source.title).toBe('图 6.2.1 · 动手学深度学习')
    // 那段开头照剪藏的写法（第一句太短时带到 40 字以内，网页上照它找回图注）
    expect(c.source.url).toBe(`${PAGE}#:~:text=图6.2.1%20二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张`)
  })
  it('没有图号用上面的小标题；只有 alt 时链接照 alt', () => {
    const c = imgClip({ ...D2L, caption: '', alt: '黑沙滩远景' })
    expect(c.alt).toBe('黑沙滩远景')
    expect(c.source.title).toBe('6.2.1 互相关运算 · 动手学深度学习')
    expect(c.source.url).toBe(`${PAGE}#:~:text=黑沙滩远景`)
  })
  it('写进那篇的图从那篇里认回来：剪藏、图「…」、引着图注，网页上照它认回那张图', () => {
    const c = imgClip(D2L)
    const md = `# 学习笔记\n\n第一段。\n\n${imageMarkdown('学习笔记.md', '附件/学习笔记/correlation.svg', c, '\n\n')}\n\n后面的字。\n`
    const [e, ...rest] = webEntries(md, PAGE)
    expect(rest).toEqual([])
    expect(e).toMatchObject({ kind: 'clip', label: '剪藏', img: true, head: '图 6.2.1', text: '图6.2.1 二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张', line: 4, keyAt: 6 })
    expect(e!.quote.startsWith('图6.2.1 二维互相关运算。')).toBe(true)
    expect(e!.title.startsWith('图「图6.2.1')).toBe(true)
    // 白板卡片里来源紧跟在图下一行也认
    expect(webEntries(`${imageMarkdown('板.md', '附件/板/a.png', c)}\n`, PAGE)[0]).toMatchObject({ img: true, line: 0, keyAt: 1 })
    // 别的网页、没有 #:~:text= 的来源（以前拖进来的图）不认
    expect(webEntries(md, 'https://zh.d2l.ai/other.html')).toEqual([])
    expect(webEntries(`![a](附件/a.png)\n\n—— [冰岛](${PAGE})\n`, PAGE)).toEqual([])
  })
})
