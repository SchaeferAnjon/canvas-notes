// 底栏「后台在做的事」里建索引那一件的字（renderer/shell/index-job.ts）：在建、在下模型时一句话带百分比，闲着时没有
import { expect, it } from 'vitest'
import { indexJobText } from '../src/renderer/shell/index-job'
import { t } from '../src/shared/i18n'
import type { EmbedModelStatus, SearchStatus } from '../src/shared/search'

const s = (phase: SearchStatus['phase'], done = 0, total = 0): SearchStatus => ({ phase, done, total, files: 0 })
const e = (phase: EmbedModelStatus['phase'], o: Partial<EmbedModelStatus> = {}): EmbedModelStatus => ({ phase, model: 'e5', semantic: true, got: 0, size: 0, done: 0, total: 0, ...o })

it('建索引、下模型时一句话带百分比；闲着、只是在等时没有', () => {
  expect(indexJobText(s('text', 3, 18), e('e5'), t)).toEqual({ icon: 'search', text: '正在建搜索索引 16%' })
  expect(indexJobText(s('embed', 320, 1000), e('e5'), t)?.text).toBe('正在建搜索索引 32%')
  // 算完最后一段到报「好了」之间不写 100%
  expect(indexJobText(s('embed', 1000, 1000), e('e5'), t)?.text).toBe('正在建搜索索引 99%')
  expect(indexJobText(s('ready'), e('downloading', { got: 242, size: 605 }), t)).toEqual({ icon: 'cloud-download', text: '正在下载本机模型 40%' })
  expect(indexJobText(s('ready'), e('verifying'), t)?.text).toBe('正在校验本机模型')
  expect(indexJobText(s('ready'), e('indexing', { done: 5, total: 10 }), t)?.text).toBe('正在建搜索索引 50%')
  // 还没切出段数：不写一直不动的 0%
  expect(indexJobText(s('embed', 0, 0), e('indexing', { done: 0, total: 0 }), t)?.text).toBe('正在建搜索索引…')
  expect(indexJobText(s('ready'), e('ready'), t)).toBeNull()
  expect(indexJobText(s('embed', 0, 0), e('e5'), t)).toBeNull()
  expect(indexJobText(s('loading'), null, t)).toBeNull()
  expect(indexJobText(s('off'), e('e5', { semantic: false }), t)).toBeNull()
})
