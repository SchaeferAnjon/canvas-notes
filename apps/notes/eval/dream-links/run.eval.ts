/**
 * 梦游补双链、可能重复的小评测（task-eler2）：pnpm eval:dream
 * 用的是软件里真的那两个函数（补双链的候选、找重复），在 cases.ts 的样本库上跑一遍，打印准确率、误报率和每一对的结果。
 * CN_EVAL_OUT=文件 时另存一份 JSON（方案那一路比较新旧判法用）。这里只报数，不判过不过：回归断言在 test/dream-links.test.ts。
 */
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { duplicatesOf, linkCandidates, linkWhy } from '../../src/main/duplicates'
import { DUPS, LINKS, LOOSE, VAULT } from './cases'
import { report, score } from './score'

it('梦游补双链、可能重复：在标注样例上的准确率和误报率', () => {
  const texts = Object.entries(VAULT)
  const links = score(
    LINKS,
    linkCandidates(texts, LOOSE).map((c) => ({ a: c.p, b: c.to, why: `${linkWhy(c.terms)}（${c.score}）` })),
  )
  const dups = score(
    DUPS,
    duplicatesOf(texts.map(([id, text]) => ({ id, text }))).map((d) => ({ a: d.a, b: d.b, why: d.why })),
  )
  console.log(`\n${report('补双链', links)}\n\n${report('可能重复', dups)}\n`)
  if (process.env.CN_EVAL_OUT) writeFileSync(process.env.CN_EVAL_OUT, JSON.stringify({ links, dups }, null, 2))
  expect(links.total).toBe(LINKS.length)
})
