/**
 * 「打开再保存文件不变」用的样本：各种容易被改坏的写法。单元测试和端到端测试共用。
 */
const enc = (s: string) => new TextEncoder().encode(s)

const frontmatterBoard = `---
type: board
links:
  - a1 -> a2
---
# 冰岛自驾

<!-- card id=a1 x=120 y=300 w=280 color=yellow -->
> 冰洞只在冬天开放，要跟向导进去
> —— [Ice caves](https://example.com/ice)

<!-- card id=a2 x=460 y=300 w=280 -->
2.27 和 2.28 的住处还没订。

<!-- column id=c1 x=800 y=80 w=280 title="要订的" -->
<!-- card id=a4 in=c1 -->
- [ ] 车
- [x] 机票

<!-- columns widths=40,30,30 -->
左栏……
<!-- col -->
中栏……
<!-- col -->
右栏……
<!-- /columns -->

<!-- card id=a3 没有配对的注释也要原样留着
[[所思所想]] 和 ^abc123 块编号
`

export const FIXTURES: Record<string, Uint8Array> = {
  'plain.md': enc('# 所思所想\n\n最近在看纳瓦尔宝典。\n\n**财富**是靠专长、杠杆。\n'),
  'no-trailing-newline.md': enc('最后一行没有换行'),
  'trailing-spaces.md': enc('行尾两个空格  \n\t缩进用 tab\n\n\n\n多个空行\n   '),
  'crlf.md': enc('# Windows 换行\r\n\r\n第一段\r\n第二段\r\n'),
  'bom.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# 带 BOM 的文件\n\n内容\n')]),
  'bom-crlf.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# BOM 加 CRLF\r\n内容\r\n')]),
  'mixed-eol.md': enc('混用换行\r\n这一行是 LF\n这一行是 CRLF\r\n'),
  'emoji-cjk.md': enc('表情 👨‍👩‍👧‍👦 和 𠮷 和组合字 é́\n全角，标点。「引号」\n'),
  'board.md': enc(frontmatterBoard),
  'html-and-tables.md': enc('| a | b |\n|---|:-:|\n| 1 | 2 |\n\n<details><summary>折叠</summary>\n\n里面\n\n</details>\n\n```js\nconst x = 1\r\n```\n'),
  'empty.md': new Uint8Array(),
  'only-newlines.md': enc('\n\n\n'),
  'lone-cr.md': enc('老 Mac 换行\r第二行\r'),
  'invalid-utf8.md': new Uint8Array([...enc('坏字节：'), 0xff, 0xfe, ...enc('\n')]),
}
