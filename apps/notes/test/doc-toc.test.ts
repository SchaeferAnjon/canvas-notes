import { describe, expect, it } from 'vitest'
import { tocItems } from '../src/renderer/doc-toc'

describe('文档右边的目录（CN-26）', () => {
  it('开头那个独一份的一级标题是名字，不进目录；下面的二级、三级往上提一层', () => {
    const items = tocItems('# Lecture05 笔记\n\n## 第 1 页\n\n### 细节\n\n## 第 3 页\n')
    expect(items.map((i) => [i.text, i.depth])).toEqual([
      ['第 1 页', 0],
      ['细节', 1],
      ['第 3 页', 0],
    ])
  })

  it('好几个一级标题时都留着', () => {
    expect(tocItems('# 一\n\n# 二\n\n## 二点一\n').map((i) => i.text)).toEqual(['一', '二', '二点一'])
  })
})
