import { describe, expect, it } from 'vitest'
import { extThemeCss, sanitizeExtTheme } from '../src/shared/ext-theme'

describe('书签管家新标签页跟着主题', () => {
  it('只收我们的键、像颜色的值', () => {
    const t = sanitizeExtTheme({ tone: 'dark', vars: { win: '#2D353B', t1: ' #E2D9C2 ', line2: 'rgba(211, 198, 170, 0.17)', evil: 'red', red: 'x; } body { display:none', t2: '' } })
    expect(t).toEqual({ tone: 'dark', vars: { win: '#2D353B', t1: '#E2D9C2', line2: 'rgba(211, 198, 170, 0.17)' } })
    expect(sanitizeExtTheme({ tone: 'grey', vars: {} })).toBeNull()
    expect(sanitizeExtTheme('x')).toBeNull()
  })

  it('样式把插件的米白底和墨色换成主题变量，修窄宽排版', () => {
    const css = extThemeCss({ tone: 'dark', vars: { win: '#2D353B', t1: '#E2D9C2' } })
    expect(css).toContain('--cn-win: #2D353B;')
    expect(css).toContain('--paper: var(--cn-win)')
    expect(css).toContain('--ink: var(--cn-t1)')
    expect(css).toContain('color-scheme: dark')
    expect(css).toMatch(/\.bk-tools a \{ white-space: nowrap/)
    expect(css).toMatch(/max-width: 800px\) \{\s*html \.dashboard-columns \.active-section \{ min-width: 0; \}/)
    // 中文提示不用斜体（中文没有斜体字形，硬斜出来笔画发歪），弱化用 --t3
    expect(css).toMatch(/html \.bk-quick-empty, html \.bk-empty \{ font-style: normal; color: var\(--cn-t3\)/)
    // 搜不到快捷书签的那句是搜索的回答，不是占位：--t2（够 4.5:1，task-4xtbp 设计复审）；结果里的分组名也是 --t2，不用绿
    expect(css).toMatch(/html \.bk-noresult \{ font-style: normal; color: var\(--cn-t2\)/)
    expect(css).toMatch(/html \.bk-result \.bk-r-sub b \{ color: var\(--cn-t2\); font-weight: 500/)
    // 整理书签页、设置页的变量也换成主题的；整理书签页窄于 600 单栏
    expect(css).toContain('--panel-bg: var(--cn-side)')
    expect(css).toContain('--fg: var(--cn-t1)')
    expect(css).toMatch(/max-width: 600px\) \{\s*html body:has\(> \.sidebar\) \{ flex-direction: column; \}/)
    // 插件自己的颜色值不能漏到样式里
    expect(css).not.toMatch(/#f8f5f0|#fffdf9/i)
  })
})
