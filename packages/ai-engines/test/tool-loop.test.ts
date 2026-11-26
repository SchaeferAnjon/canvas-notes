/**
 * 内置工具循环（tool-loop.ts）：工具调用写在字里认得出、边出字时不漏出半截调用、调完把结果送回去再问、轮数用完照拿到的答、停下就停。
 */
import { describe, expect, it } from 'vitest'
import { type LoopChat, type LoopMsg, runToolLoop, toolCalls, toolProtocol, visibleText } from '../src/tool-loop'

const TOOLS = [{ name: 'class_captions', description: '取字幕', inputSchema: { type: 'object', properties: { from: { type: 'string' } } } }]

/** 假模型：按顺序回 replies，每次一个字一个字地出（onDelta 给累计的全文） */
function fakeChat(replies: string[], seen: LoopMsg[][] = []): LoopChat {
  let n = 0
  return async (o) => {
    seen.push(JSON.parse(JSON.stringify(o.messages)) as LoopMsg[])
    const r = replies[Math.min(n++, replies.length - 1)]!
    let full = ''
    for (const ch of r) {
      full += ch
      o.onDelta(full)
    }
    return full
  }
}

describe('工具调用的写法', () => {
  it('认出一段里的几个调用，坏的记下来', () => {
    const r = toolCalls('我查一下。\n<tool>{"name":"class_captions","args":{"from":"14:00"}}</tool>\n<tool>{"name":"x","args":[]}</tool>\n<tool>不是json</tool>')
    expect(r.calls).toEqual([{ name: 'class_captions', args: { from: '14:00' } }])
    expect(r.bad).toHaveLength(2)
  })
  it('arguments 也认', () => {
    expect(toolCalls('<tool>{"name":"a","arguments":{"q":1}}</tool>').calls).toEqual([{ name: 'a', args: { q: 1 } }])
  })
  it('给用户看的字：去掉调用，末尾写了一半的先不给', () => {
    expect(visibleText('好。<tool>{"name":"a"}</tool>接着说')).toBe('好。接着说')
    expect(visibleText('好。<tool>{"name":"a"')).toBe('好。')
    expect(visibleText('好。<to')).toBe('好。')
    expect(visibleText('a < b')).toBe('a < b')
  })
  it('系统提示里写清工具和写法', () => {
    const s = toolProtocol(TOOLS)
    expect(s).toContain('class_captions：取字幕')
    expect(s).toContain('<tool>{"name":"工具名","args":{参数}}</tool>')
  })
})

describe('runToolLoop', () => {
  it('调工具、结果送回去、再答；边出字时给出去的字只会变长', async () => {
    const seen: LoopMsg[][] = []
    const calls: unknown[] = []
    let streamed = ''
    const text = await runToolLoop({
      chat: fakeChat(['我先看一下刚才的字幕。\n<tool>{"name":"class_captions","args":{"from":"18:12"}}</tool>', '刚才讲的是 TCP 三次握手〔18:15〕。'], seen),
      system: '你是助手',
      prompt: '用户说：\n刚才讲了什么',
      tools: TOOLS,
      call: async (name, args) => (calls.push({ name, args }), { text: '[18:15] 老师：三次握手……' }),
      signal: new AbortController().signal,
      onText: (d) => (streamed += d),
    })
    expect(calls).toEqual([{ name: 'class_captions', args: { from: '18:12' } }])
    expect(text).toBe('我先看一下刚才的字幕。\n\n刚才讲的是 TCP 三次握手〔18:15〕。')
    expect(streamed).not.toContain('<tool')
    expect(streamed.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
    // 第二次问时带着第一次的回答和工具结果
    expect(seen[1]).toHaveLength(3)
    expect(String(seen[1]![2]!.content)).toContain('<result name="class_captions">')
    expect(String(seen[1]![2]!.content)).toContain('三次握手')
  })

  it('没有这个工具、JSON 写坏了：照实告诉模型，不中断', async () => {
    const seen: LoopMsg[][] = []
    const text = await runToolLoop({
      chat: fakeChat(['<tool>{"name":"rm_rf","args":{}}</tool><tool>{坏的}</tool>', '好的，直接答。'], seen),
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      call: async () => ({ text: 'x' }),
      signal: new AbortController().signal,
      onText: () => {},
    })
    expect(text).toBe('好的，直接答。')
    const back = String(seen[1]![2]!.content)
    expect(back).toContain('没有叫 rm_rf 的工具')
    expect(back).toContain('没认出来')
  })

  it('轮数用完：最后一问让它直接答，再写的调用不调', async () => {
    let n = 0
    const text = await runToolLoop({
      chat: fakeChat(['<tool>{"name":"class_captions","args":{}}</tool>']),
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      call: async () => (n++, { text: 'r' }),
      signal: new AbortController().signal,
      onText: () => {},
      maxRounds: 2,
    })
    expect(n).toBe(2)
    expect(text).toBe('')
  })

  it('工具出错：结果标 error 送回去', async () => {
    const seen: LoopMsg[][] = []
    const text = await runToolLoop({
      chat: fakeChat(['<tool>{"name":"class_captions","args":{}}</tool>', '答'], seen),
      system: 's',
      prompt: 'p',
      tools: TOOLS,
      call: async () => {
        throw new Error('读不到这一场')
      },
      signal: new AbortController().signal,
      onText: () => {},
    })
    expect(text).toBe('答')
    expect(String(seen[1]![2]!.content)).toContain('<result name="class_captions" error="true">\n读不到这一场')
  })

  it('停下了：抛 AbortError', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(runToolLoop({ chat: fakeChat(['x']), system: 's', prompt: 'p', tools: [], call: async () => ({ text: '' }), signal: ac.signal, onText: () => {} })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('带图：第一条消息是字和图', async () => {
    const seen: LoopMsg[][] = []
    await runToolLoop({ chat: fakeChat(['好'], seen), system: 's', prompt: 'p', images: [{ mime: 'image/jpeg', data: 'AAA', path: '/x.jpg' }], tools: [], call: async () => ({ text: '' }), signal: new AbortController().signal, onText: () => {} })
    expect(seen[0]![0]!.content).toEqual([
      { type: 'text', text: 'p' },
      { type: 'image', dataUrl: 'data:image/jpeg;base64,AAA' },
    ])
  })
})
