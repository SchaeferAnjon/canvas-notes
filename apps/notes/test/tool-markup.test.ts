import { describe, expect, it } from 'vitest'
import { hideToolMarkup } from '../src/shared/tool-markup'

// 用户截图里那一段（task-ne7cw）：模型把一次工具调用写成了普通文字，夹在回答前面
const LEAK = `<invoke name="Bash">
<parameter name="command">cat "/Users/u/canvas-note-test/阅读/杀死一只知更鸟（同名电影原著）.md"</parameter>
<parameter name="description">Read the current book note</parameter>
</invoke>`

describe('回答里成段的工具调用标记不显示（task-ne7cw）', () => {
  it('截图那一段：去掉 invoke 块，正常回答照常', () => {
    expect(hideToolMarkup(`${LEAK}\n我在文末加了一节「评价」，共两段。`)).toBe('我在文末加了一节「评价」，共两段。')
    expect(hideToolMarkup(`${LEAK}\n\n我在文末加了一节「评价」。`)).toBe('我在文末加了一节「评价」。')
  })

  it('夹在两段中间、外面包着 function_calls、带命名空间前缀的也去掉，前后两段之间只留一个空行', () => {
    expect(hideToolMarkup(`先读一下。\n\n<function_calls>\n${LEAK}\n</function_calls>\n\n\n改好了。`)).toBe('先读一下。\n\n改好了。')
    const ns = LEAK.replace(/<(\/?)(invoke|parameter)/g, '<$1x:$2')
    expect(hideToolMarkup(`${ns}\n改好了。`)).toBe('改好了。')
    expect(hideToolMarkup('改好了。<function_results>\nok\n</function_results>')).toBe('改好了。')
  })

  it('一个字都不剩时是空的', () => {
    expect(hideToolMarkup(LEAK)).toBe('')
  })

  it('代码块、行内代码里的原样留着', () => {
    const fenced = '这样写：\n\n```xml\n' + LEAK + '\n```\n\n就行。'
    expect(hideToolMarkup(fenced)).toBe(fenced)
    const tilde = '~~~\n<invoke name="Read">\n</invoke>\n~~~'
    expect(hideToolMarkup(tilde)).toBe(tilde)
    const inline = '标记长这样：`<parameter name="command">ls</parameter>`，别照抄。'
    expect(hideToolMarkup(inline)).toBe(inline)
    // 代码块外面那段照样去掉
    expect(hideToolMarkup(`${LEAK}\n看这里：\n\n\`\`\`\n<invoke name="x"></invoke>\n\`\`\``)).toBe('看这里：\n\n```\n<invoke name="x"></invoke>\n```')
  })

  it('用户正常写的尖括号、没配成对的不动', () => {
    for (const s of ['a <b> c', '比较 1 < 2 和 3 > 2', '<invoke name="Bash">\n没写完', '用 <parameter> 标签', '<div>网页</div>', 'List<String> x']) expect(hideToolMarkup(s)).toBe(s)
  })

  it('还在答的时候：末尾刚开头、还没收尾的那一段先不显示；答完了没收尾的照原样', () => {
    const half = '先读一下。\n\n<invoke name="Bash">\n<parameter name="command">cat a.md'
    expect(hideToolMarkup(half, true)).toBe('先读一下。')
    expect(hideToolMarkup(half)).toBe(half)
    expect(hideToolMarkup('先读一下。\n<inv', true)).toBe('先读一下。')
    expect(hideToolMarkup('先读一下。\n<functio', true)).toBe('先读一下。')
    expect(hideToolMarkup('先读一下。\n<invoke ', true)).toBe('先读一下。')
    expect(hideToolMarkup('先读一下。\n<invoke name', true)).toBe('先读一下。')
    expect(hideToolMarkup('先读一下。\n<x:parameter name="comm', true)).toBe('先读一下。')
    // 不是那几个词开头的尖括号照常显示
    expect(hideToolMarkup('1 <', true)).toBe('1 <')
    expect(hideToolMarkup('看 <b', true)).toBe('看 <b')
    // 代码块里的半截照常显示
    expect(hideToolMarkup('```\n<invoke name="x">', true)).toBe('```\n<invoke name="x">')
  })

  it('没有标记的回答原样返回（同一个字符串）', () => {
    const s = '普通回答\n\n第二段 `code` 和 <b>。'
    expect(hideToolMarkup(s)).toBe(s)
  })
})
