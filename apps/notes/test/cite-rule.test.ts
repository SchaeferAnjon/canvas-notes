// 让 AI 把库里的东西写成链接（task-3e53q）：每个出回答的地方的系统提示都带链接写法；每条消息开头的【库里的笔记】列哪几篇；
// 步骤里记下这一轮读过的文件（回答里光写名字也认）
import { describe, expect, it } from 'vitest'
import { AGENT_SYSTEM, AGENT_VERSION } from '../src/main/agent'
import { stepPaths } from '../src/main/agent/tools'
import { buildPrompt } from '../src/main/mobile-ai/prompt'
import { TUTOR_SYSTEM, TUTOR_VERSION } from '../src/main/reading/prompts'
import { CITE_FIND, CITE_RULE, notesLine, NOTES_MAX } from '../src/shared/cite-rule'

describe('系统提示', () => {
  it('右栏 AI 对话（含旁支）、读 PDF 都带链接写法和【库里的笔记】那句；版本加过一（接着聊的旧会话不再用旧提示）', () => {
    for (const s of [AGENT_SYSTEM, TUTOR_SYSTEM]) {
      expect(s).toContain(CITE_RULE)
      expect(s).toContain(CITE_FIND)
    }
    expect(CITE_RULE).toContain('[字](路径.md#L起-L止)')
    expect(CITE_RULE).toContain('[第 N 页](路径.pdf#page=N&rect=x,y,w,h)')
    expect(CITE_RULE).toContain('#:~:text=')
    expect(CITE_RULE).toContain('canvas-notes://commit/')
    expect(CITE_RULE).toContain('不编行号、不编页码')
    expect(AGENT_VERSION).toBe(7)
    expect(TUTOR_VERSION).toBe(8)
    // 读 PDF：这份 PDF 的页照旧
    expect(TUTOR_SYSTEM).toContain('[第 4 页](#page=4)')
  })
  it('iPhone / iPad（Mac 转、云端 API 同一份）的两种系统提示也带', () => {
    const chat = buildPrompt({ kind: 'chat', text: '小论文计划写了什么', lang: 'zh' } as Parameters<typeof buildPrompt>[0])
    expect(chat.system).toContain(CITE_RULE)
  })
})

describe('【库里的笔记】', () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `杂/第${i}篇.md`, mtimeMs: i }))
  it('库小全列，写一共几篇；只列 md 和 PDF', () => {
    const s = notesLine({ files: [{ path: '课程/小论文计划.md' }, { path: '课程/第3讲.pdf' }, { path: '可视化/a.html' }, { path: '课程', mtimeMs: 0 }] })
    expect(s.split('\n').slice(1)).toEqual(['课程/小论文计划.md', '课程/第3讲.pdf'])
    expect(s).toContain('库里一共 2 篇，都在这里')
  })
  it('库大：开着的、这句话里写到名字的、最近打开的、同文件夹的、最近改过的先列，最多 200 篇，没列的叫它先 notes_list', () => {
    const all = [...files(500), { path: '课程/小论文计划.md', mtimeMs: -1 }, { path: '课程/同夹.md', mtimeMs: -1 }, { path: '课程/当前.md', mtimeMs: -1 }, { path: '远处/最近开的.md', mtimeMs: -1 }]
    const s = notesLine({ files: all, current: '课程/当前.md', recent: ['远处/最近开的.md', '不在库里.md'], said: '小论文计划写了啥' })
    const list = s.split('\n').slice(1)
    expect(list.slice(0, 4)).toEqual(['课程/当前.md', '课程/小论文计划.md', '远处/最近开的.md', '课程/同夹.md'])
    expect(list).toHaveLength(NOTES_MAX)
    // 余下的按最近改过的
    expect(list[4]).toBe('杂/第499篇.md')
    expect(s).toContain(`库里一共 504 篇，这里列了 ${NOTES_MAX} 篇`)
    expect(s).toContain('notes_list')
  })
  it('空库不写', () => {
    expect(notesLine({ files: [] })).toBe('')
  })
})

describe('步骤里读过的文件', () => {
  const root = '/Users/me/库'
  it('命令行的 Read / Edit 写绝对路径的转成库里的；库外的不算', () => {
    expect(stepPaths('Read', { file_path: '/Users/me/库/课程/小论文计划.md' }, root)).toEqual(['课程/小论文计划.md'])
    expect(stepPaths('Edit', { file_path: '/Users/me/别处/a.md' }, root)).toEqual([])
  })
  it('跑命令：命令里写的 .md / .pdf（带引号、带空格的也认）', () => {
    expect(stepPaths('Bash', { command: 'cat "课程/study project 2/小论文计划.md" | head; grep -n SAGE 阅读/书.md' }, root)).toEqual(['课程/study project 2/小论文计划.md', '阅读/书.md'])
    expect(stepPaths('Bash', { command: 'ls *.md' }, root)).toEqual([])
  })
  it('我们的工具：path 和「建好了：…」', () => {
    expect(stepPaths('note_read', { path: '课程/小论文计划.md' }, root)).toEqual(['课程/小论文计划.md'])
    expect(stepPaths('note_create', { title: '新的' }, root, '建好了：收件箱/新的.md')).toEqual(['收件箱/新的.md'])
  })
})
