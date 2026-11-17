import { expect, it } from 'vitest'
import { aiErrorCode, aiErrorView } from '../src/shared/ai-errors'

// 录屏 ② 3:37 浮窗里那段原话（编号换成假的）
const BLOCKED =
  "Claude Code 没认完：API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). Please try rephrasing your request. Details: [reasoning_extraction] Request ID: req_011CXYZabc Message ID: msg_01ABCdef"

it('CN-75：录屏里的英文报错认成「被安全检查拦下」，一句中文 + 再问一次 / 换个问法，原话收起来', () => {
  expect(aiErrorCode(BLOCKED)).toBe('blocked')
  const v = aiErrorView(BLOCKED, { id: 'claude', label: 'Claude Code' })
  expect(v.title).toBe('被Claude的安全检查拦下了，常是误拦')
  expect(v.title).not.toMatch(/req_|msg_/)
  expect(v.acts).toEqual(['retry', 'rephrase'])
  expect(v.raw).toBe(BLOCKED)
})

it('CN-75：没登录、网络、模型不对、超时各有一句中文和下一步', () => {
  const eng = { id: 'claude', label: 'Claude Code' }
  expect(aiErrorView('Invalid API key · Please run /login', eng)).toMatchObject({ code: 'not-logged-in', title: 'Claude Code还没登录：在终端里运行claude登录一下', acts: ['retry'] })
  expect(aiErrorView('fetch failed: getaddrinfo ENOTFOUND api.anthropic.com', eng)).toMatchObject({ code: 'network', title: '网络断了，没问成', acts: ['retry'] })
  expect(aiErrorView('There is an issue with the selected model (claude-haiku-9). It may not exist', eng)).toMatchObject({ code: 'bad-model', acts: ['settings'] })
  expect(aiErrorView('等了 120 秒没回应', eng)).toMatchObject({ code: 'timeout', acts: ['retry'] })
})

it('我们自己写的中文短话原样显示，不收「看原话」', () => {
  expect(aiErrorView('先打开一块白板')).toMatchObject({ title: '先打开一块白板', raw: null, acts: [] })
  expect(aiErrorView('没答完（软件关了）', { label: 'Claude Code' })).toMatchObject({ code: 'exited', title: '没答完（软件关了）', raw: null })
})
