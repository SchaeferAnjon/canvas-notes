import { expect, it } from 'vitest'
import type { DreamReport } from '../src/shared/api'
import { dreamWhen } from '../src/renderer/dream/useDream'

const at = (h: number, m: number) => new Date(2026, 10, 17, h, m, 30).getTime()

it('梦游跨分钟：「13:57到13:58」，「到」两边不手打空格（第 4 轮美学）；同一分钟只写一个时间', () => {
  const now = new Date(at(13, 59))
  expect(dreamWhen({ started: at(13, 57), finished: at(13, 58) } as DreamReport, now)).toBe('刚才 13:57到13:58')
  expect(dreamWhen({ started: at(13, 58), finished: at(13, 58) } as DreamReport, now)).toBe('刚才 13:58')
  expect(dreamWhen({ started: at(2, 40), finished: at(3, 18) } as DreamReport, now)).toBe('昨夜 02:40到03:18')
})
