import { expect, it } from 'vitest'
import { toastParts } from '../src/renderer/video/toast-parts'

it('CN-85：底部提示拆成状态词、文档名、时间、附带说明，拼回去和原话一样', () => {
  const text = '记进了《未命名 3》 · 00:01 · 截了这一帧和前后 4 行'
  const p = toastParts(text)!
  expect(p).toEqual({ verb: '记进了', doc: '未命名 3', rest: ['00:01', '截了这一帧和前后 4 行'] })
  expect(`${p.verb}《${p.doc}》${p.rest.map((x) => ' · ' + x).join('')}`).toBe(text)
  expect(toastParts('记进了《Linear transformations and matrices》 · 00:10')).toEqual({ verb: '记进了', doc: 'Linear transformations and matrices', rest: ['00:10'] })
  expect(toastParts('撤回了')).toBeNull()
})
