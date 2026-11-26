// r172「朋友电脑上认不出原文语言，不能双语」：字幕翻成什么按字幕的字认原文，不只信字幕轨标的语言；和翻成的同一种就换一种
import { describe, expect, it } from 'vitest'
import { videoTarget } from '../src/shared/plugins/translate'

const ZH = ['两国建交30多年了', '我们见证了很多变化', '那么接下来我们看一下']
const EN = ['Welcome to linear transformations.', 'A matrix moves every vector.']

describe('视频字幕翻成什么', () => {
  it('英文视频、翻成中文：照旧翻成中文', () => {
    expect(videoTarget('zh-CN', 'en', EN)).toBe('zh-CN')
  })
  it('中文视频、翻成中文（默认）：换成英文，双语有第二行（以前不翻，只有一行）', () => {
    expect(videoTarget('zh-CN', 'zh-Hans', ZH)).toBe('en')
  })
  it('字幕轨标错了（中文字幕标成英文、标成 und、B 站 ai-zh）：按字认出是中文', () => {
    expect(videoTarget('zh-CN', 'en', ZH)).toBe('en')
    expect(videoTarget('zh-CN', 'und', ZH)).toBe('en')
    expect(videoTarget('zh-CN', 'ai-zh', ZH)).toBe('en')
  })
  it('选了翻成英文的中文视频：翻成英文；英文视频选了英文：换成中文', () => {
    expect(videoTarget('en', 'zh-Hans', ZH)).toBe('en')
    expect(videoTarget('en', 'en', EN)).toBe('zh-CN')
  })
  it('拉丁字母分不出英法德：信轨上标的（法语视频翻成中文；翻成法语时换成中文）', () => {
    const FR = ['Bonjour à tous', 'Aujourd’hui on parle des matrices']
    expect(videoTarget('zh-CN', 'fr', FR)).toBe('zh-CN')
    expect(videoTarget('fr', 'fr', FR)).toBe('zh-CN')
  })
})
