/**
 * 测试用的 Wiki 判断（CN_AI_FAKE=1 和单元测试）：照软件猜的级别判，一句只链第一个说得通的候选：
 * - 整篇：这句里出现了那篇的名字（去掉开头编号、「：」前面那截也算）；
 * - 这一节：这句里出现了那一节标题里能单独认的一截；
 * - 这一段：这句和那段共有的最长一串汉字（至少 3 个字），把握 4 个字以上 0.9、3 个字 0.6（进「拿不准」）。
 * thing 写链上的那几个字；一句都没链时写这句里「」括起来的词或 #标签的最后一截。
 */
import { headingParts } from '@cn/format'

const longestCommon = (a: string, b: string): string => {
  let best = ''
  for (let i = 0; i < a.length; i++)
    for (let j = i + best.length + 1; j <= a.length; j++) {
      const s = a.slice(i, j)
      if (!/^\p{Script=Han}+$/u.test(s)) break
      if (b.includes(s)) best = s
      else break
    }
  return best
}

export function fakeWiki(prompt: string): string {
  const notes = new Map<number, { title: string; headings: string[] }>()
  for (const m of prompt.matchAll(/^N(\d+)《(.+?)》(?:\n {2}这篇的标题：(.*))?/gm)) notes.set(Number(m[1]), { title: m[2]!, headings: m[3] ? m[3].split('｜') : [] })
  const out: unknown[] = []
  const blocks = prompt.split(/\n(?=C\d+：)/).slice(1)
  for (const b of blocks) {
    const head = /^C(\d+)：(.*?)(?:（A 里所在的节：.*）)?$/m.exec(b)!
    const c = Number(head[1])
    const text = head[2]!
    const links: unknown[] = []
    const cands = [...b.matchAll(/^ {2}P(\d+)（N(\d+)(?: › (.*?))?；软件猜：(整篇|这一节|这一段)）(.*)$/gm)]
    // 一段一段比时挑共有的字最长的那段（不是排在最前的那段）
    const common = (m: RegExpMatchArray) => (m[4] === '这一段' ? longestCommon(text, m[5]!).length : 99)
    cands.sort((x, y) => common(y) - common(x) || Number(x[1]) - Number(y[1]))
    for (const m of cands) {
      const note = notes.get(Number(m[2]))!
      const heading = m[3] ?? ''
      const guess = m[4]!
      const ptext = m[5]!
      if (guess === '整篇') {
        const t = note.title.replace(/^\s*\d+[-_.、\s]+/, '')
        const name = [note.title, t, t.split(/[：:（(]/)[0]!].find((n) => n && text.includes(n))
        if (name) links.push({ p: Number(m[1]), level: '整篇', heading: '', words: name, quote: note.title, confidence: 0.9, reason: `「${note.title}」整篇讲的就是它` })
      } else if (guess === '这一节') {
        const part = headingParts(heading).find((x) => text.includes(x))
        if (part) links.push({ p: Number(m[1]), level: '这一节', heading, words: part, quote: heading, confidence: 0.9, reason: `「${note.title}」的「${heading}」一节专讲${part}` })
      } else {
        const w = longestCommon(text, ptext)
        if (w.length >= 3) {
          const quote = ptext.split(/(?<=[。！？；])/).find((s) => s.includes(w)) ?? ptext
          links.push({ p: Number(m[1]), level: '这一段', heading: '', words: w, quote: quote.replace(/…$/, '').slice(0, 60), confidence: w.length >= 4 ? 0.9 : 0.6, reason: `「${note.title}」里有一段讲${w}` })
        }
      }
      if (links.length) break
    }
    const thing = (links[0] as { words?: string } | undefined)?.words ?? /「([^」]{2,12})」/.exec(text)?.[1] ?? ''
    out.push({ c, links, thing })
  }
  return '```json\n' + JSON.stringify(out) + '\n```'
}
