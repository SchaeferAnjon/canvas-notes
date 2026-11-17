import { describe, expect, it } from 'vitest'
import { openCursor } from '../src/renderer/open-cursor'

const at = (text: string, pos: number) => text.slice(0, pos) + '|' + text.slice(pos)

describe('打开一篇时光标放哪', () => {
  it('没有记录：标题下面第一段的末尾，不在「# 」前面', () => {
    const t = '# 日记\n\n今天下雪了。\n'
    expect(at(t, openCursor(t))).toBe('# 日记\n\n今天下雪了。|\n')
  })

  it('第一段有好几行：到这一段最后一行末尾', () => {
    const t = '# 甲\n\n第一行\n第二行\n\n第二段\n'
    expect(at(t, openCursor(t))).toBe('# 甲\n\n第一行\n第二行|\n\n第二段\n')
  })

  it('只有标题：标题行末尾', () => {
    expect(at('# 慢慢走\n\n', openCursor('# 慢慢走\n\n'))).toBe('# 慢慢走|\n\n')
    expect(at('# 慢慢走', openCursor('# 慢慢走'))).toBe('# 慢慢走|')
  })

  it('第一段是代码块、表格、图片：放标题行末尾，不打进代码块的围栏', () => {
    for (const body of ['```base\nfilters:\n```', '| a | b |\n|---|---|', '![](a.png)', '<details>\n<summary>折叠</summary>']) {
      const t = `# 表\n\n${body}\n`
      expect(at(t, openCursor(t))).toBe(`# 表|\n\n${body}\n`)
    }
  })

  it('跳过藏着的位置行', () => {
    const t = '# 合并\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n'
    expect(at(t, openCursor(t))).toBe('# 合并\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。|\n')
  })

  it('有 frontmatter：从它后面算', () => {
    const t = '---\ntags: [a]\n---\n# 题\n\n正文\n'
    expect(at(t, openCursor(t))).toBe('---\ntags: [a]\n---\n# 题\n\n正文|\n')
  })

  it('没有标题：第一段末尾；第一行是二级标题也跳过，落在下面正文末尾；只有二级标题时在它末尾', () => {
    expect(at('就一句\n', openCursor('就一句\n'))).toBe('就一句|\n')
    const t = '## 小节\n\n内容\n'
    expect(at(t, openCursor(t))).toBe('## 小节\n\n内容|\n')
    expect(at('## 小节\n', openCursor('## 小节\n'))).toBe('## 小节|\n')
  })

  it('上次离开的位置：照用；在「# 」记号里或前面就挪到记号后面；超出全文就放末尾', () => {
    const t = '# 日记\n\n今天下雪了。\n\n## 晚上\n\n看书。\n'
    expect(openCursor(t, t.indexOf('下雪'))).toBe(t.indexOf('下雪'))
    expect(at(t, openCursor(t, t.indexOf('## 晚上')))).toContain('## |晚上')
    expect(at(t, openCursor(t, t.indexOf('## 晚上') + 1))).toContain('## |晚上')
    expect(openCursor(t, 9999)).toBe(t.length)
  })

  it('记下的是 0（打开就在最前面）当没记：放正文开头', () => {
    const t = '# 日记\n\n今天下雪了。\n'
    expect(at(t, openCursor(t, 0))).toBe('# 日记\n\n今天下雪了。|\n')
  })

  it('记下的位置落在 frontmatter 里：放正文开头', () => {
    const t = '---\ntags: [a]\n---\n# 题\n\n正文\n'
    expect(at(t, openCursor(t, 5))).toBe('---\ntags: [a]\n---\n# 题\n\n正文|\n')
  })

  it('空文件：0', () => {
    expect(openCursor('')).toBe(0)
  })

  describe('第 4 轮：开头是下划线标题、分隔线、属性下面空一行再写标题，都落在第一段正文末尾', () => {
    const cases: [string, string][] = [
      // 下划线标题（Setext）：一级 ====、二级 ----，长短不限
      ['游记总目\n====\n\n第一段。\n', '游记总目\n====\n\n第一段。|\n'],
      ['标题用下划线\n----------\n\n第一段。\n', '标题用下划线\n----------\n\n第一段。|\n'],
      ['总目\n=\n第一段紧挨着。\n', '总目\n=\n第一段紧挨着。|\n'],
      // 下划线标题下面没有正文：在标题字末尾，不在下划线后面
      ['只有标题\n====\n', '只有标题|\n====\n'],
      // # 标题下面先一条分隔线（*** ___ --- 和带空格的）
      ['# 分隔线一\n\n***\n\n正文。\n', '# 分隔线一\n\n***\n\n正文。|\n'],
      ['# 分隔线二\n\n___\n\n正文。\n', '# 分隔线二\n\n___\n\n正文。|\n'],
      ['# 分隔线三\n\n---\n\n正文。\n', '# 分隔线三\n\n---\n\n正文。|\n'],
      ['# 分隔线四\n\n* * *\n\n正文。\n', '# 分隔线四\n\n* * *\n\n正文。|\n'],
      // 第一块就是分隔线
      ['***\n\n正文。\n', '***\n\n正文。|\n'],
      // 分隔线下面没有正文：标题末尾
      ['# 只有线\n\n___\n', '# 只有线|\n\n___\n'],
      // 属性下面空一行再写标题
      ['---\ncreated: 2026-11-17\n---\n\n# 极光六\n\n第一段。\n', '---\ncreated: 2026-11-17\n---\n\n# 极光六\n\n第一段。|\n'],
      ['---\ncreated: 2026-11-17\n---\n\n\n# 极光四\n', '---\ncreated: 2026-11-17\n---\n\n\n# 极光四|\n'],
      // 属性 + 空行 + 下划线标题 + 分隔线
      ['---\ntags: [a]\n---\n\n极光七\n====\n\n***\n\n正文。\n', '---\ntags: [a]\n---\n\n极光七\n====\n\n***\n\n正文。|\n'],
      // 只有属性没有标题（《极光》）
      ['---\ncreated: 2026-11-17\n---\n第一段。\n', '---\ncreated: 2026-11-17\n---\n第一段。|\n'],
      // 标题前面有空行
      ['\n\n# 空行开头\n\n正文。\n', '\n\n# 空行开头\n\n正文。|\n'],
      // 好几个标题连着：跳到第一段正文
      ['# 甲\n\n## 小节\n\n### 再小\n\n内容。\n', '# 甲\n\n## 小节\n\n### 再小\n\n内容。|\n'],
      // 引用、列表、待办照旧是第一段（列表下面的 --- 是分隔线，不当下划线）
      ['# 甲\n\n> 引一句\n', '# 甲\n\n> 引一句|\n'],
      ['# 甲\n\n- 一条\n- 两条\n', '# 甲\n\n- 一条\n- 两条|\n'],
      ['# 甲\n\n- [ ] 待办\n', '# 甲\n\n- [ ] 待办|\n'],
      ['- 一条\n---\n\n正文。\n', '- 一条|\n---\n\n正文。\n'],
    ]
    for (const [text, want] of cases)
      it(JSON.stringify(text.slice(0, 24)), () => {
        expect(at(text, openCursor(text))).toBe(want)
      })

    it('记下的位置在下划线、分隔线上：挪到标题字末尾 / 第一段末尾', () => {
      const t = '游记总目\n====\n\n第一段。\n'
      expect(at(t, openCursor(t, t.indexOf('====') + 2))).toBe('游记总目|\n====\n\n第一段。\n')
      const h = '# 分隔线二\n\n___\n\n正文。\n'
      expect(at(h, openCursor(h, h.indexOf('___') + 3))).toBe('# 分隔线二\n\n___\n\n正文。|\n')
    })
  })
})
