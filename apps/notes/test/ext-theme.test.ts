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
    expect(css).toMatch(/html \.bk-quick-empty, html \.bk-noresult, html \.bk-empty \{ font-style: normal;/)
    // 插件自己的颜色值不能漏到样式里
    expect(css).not.toMatch(/#f8f5f0|#fffdf9/i)
  })
})
