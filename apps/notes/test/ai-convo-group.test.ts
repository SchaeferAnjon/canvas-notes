// 对话菜单里一段归哪一组（shared/ai-chats.ts convoGroup，2026-11-25 对话菜单分组）
import { describe, expect, it } from 'vitest'
import { convoGroup, type ConvPages, NO_PAGE } from '../src/shared/ai-chats'

describe('convoGroup', () => {
  const pages: ConvPages = {
    'conv:1': { page: NO_PAGE, label: '', at: 1 },
    'conv:2': { page: 'file:课程/生物/丁篇.md', label: '丁篇', at: 1 },
    'today:a': { page: 'file:周记.md', label: '周记', at: 1 },
  }

  it('画布今日问的（一段一个 key）都进同一组，不拿自己的 key 当一组', () => {
    expect(convoGroup('today:x1', {})).toEqual({ kind: 'today', key: 'today:' })
    expect(convoGroup('today:x2', {}).key).toBe(convoGroup('today:x1', {}).key)
  })

  it('不挂任何页的、表里丢了的搬出来的那段进「没挂页面」', () => {
    expect(convoGroup('conv:1', pages)).toEqual({ kind: 'nopage', key: NO_PAGE })
    expect(convoGroup('conv:9', {})).toEqual({ kind: 'nopage', key: NO_PAGE })
  })

  it('挂到别页的跟着那页（画布今日的搬过来也一样）', () => {
    expect(convoGroup('conv:2', pages)).toEqual({ kind: 'page', key: 'file:课程/生物/丁篇.md', page: 'file:课程/生物/丁篇.md', path: ['课程', '生物'] })
    expect(convoGroup('today:a', pages)).toMatchObject({ kind: 'page', key: 'file:周记.md', path: [] })
  })

  it('文件夹、PDF 带路径；首页、收件箱是自己一组', () => {
    expect(convoGroup('folder:课程/ecp', {})).toMatchObject({ kind: 'page', path: ['课程'] })
    expect(convoGroup('read:课程/ecp/Lecture05.pdf', {})).toMatchObject({ kind: 'page', path: ['课程', 'ecp'] })
    expect(convoGroup('home', {})).toEqual({ kind: 'page', key: 'home', page: 'home', path: [] })
    expect(convoGroup('inbox', {})).toMatchObject({ kind: 'page', key: 'inbox' })
  })

  it('网页按网站：读 PDF 那套框着问的和右栏网页标签上问的同一组', () => {
    expect(convoGroup('read:web:https://www.zh.d2l.ai/a.html', {})).toEqual({ kind: 'site', key: 'site:zh.d2l.ai', host: 'zh.d2l.ai' })
    expect(convoGroup('page:https://zh.d2l.ai/b.html', {}).key).toBe('site:zh.d2l.ai')
  })

  it('找回的对话一组', () => {
    expect(convoGroup('x', { x: { page: 'recovered', label: '', at: 1 } })).toEqual({ kind: 'recovered', key: 'recovered' })
  })
})
