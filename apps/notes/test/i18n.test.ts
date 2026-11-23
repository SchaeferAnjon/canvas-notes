/**
 * 界面文字的两张表（task-zojmg）：中文表（代码里的原句，scripts/i18n.mjs 扫出来写进 zh.ts）和英文表（shared/i18n/en/）。
 * - 两张表的键一样：中文表每一句英文表都有，英文表没有多出来的；同一个键只在一个分表里。
 * - 整句模板：英文和中文的占位一样；算出来的（单复数）给了参数以后不剩 {}。英文里没有中文。
 * - 不拼句子：抽完的文件里 t() 不和别的字用 + 连、不放进带字的模板里；也没有漏包的中文。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 脚本是 .mjs，没有类型
import { DONE, doneProblems, scanCode, ZH_FILE, zhSource } from '../scripts/i18n.mjs'
import { EN, EN_PARTS } from '../src/shared/i18n/en'
import { count, fill, holes, inline, langOfLocale, listText, translate } from '../src/shared/i18n/core'
import { setUiLang } from '../src/shared/i18n'
import { ZH } from '../src/shared/i18n/zh'
import { clock, dateText, when } from '../src/shared/when'

const HAN = /\p{Script=Han}/u
/** 键里「用在哪::原句」的原句 */
const bare = (k: string) => (k.includes('::') ? k.slice(k.indexOf('::') + 2) : k)

describe('两张表', () => {
  it('zh.ts 是最新的（加了句子要跑 node apps/notes/scripts/i18n.mjs）', () => {
    expect(readFileSync(ZH_FILE, 'utf8')).toBe(zhSource())
  })

  it('中文表每一句英文表都有', () => {
    const missing = ZH.filter((k) => !(k in EN))
    expect(missing, `英文表里缺：\n${missing.join('\n')}`).toEqual([])
  })

  it('英文表没有中文表里没有的句子', () => {
    const zh = new Set(ZH)
    const extra = Object.keys(EN).filter((k) => !zh.has(k))
    expect(extra, `代码里已经不用的：\n${extra.join('\n')}`).toEqual([])
  })

  it('同一个键只在一个分表里', () => {
    const seen = new Map<string, string>()
    const dup: string[] = []
    for (const [part, table] of Object.entries(EN_PARTS)) {
      for (const k of Object.keys(table)) {
        if (seen.has(k)) dup.push(`${k}（${seen.get(k)}、${part}）`)
        seen.set(k, part)
      }
    }
    expect(dup).toEqual([])
  })

  it('占位一样；算出来的给了参数不剩 {}；英文里没有中文', () => {
    const bad: string[] = []
    for (const [k, v] of Object.entries(EN)) {
      const want = holes(bare(k))
      if (typeof v === 'string') {
        if (JSON.stringify(holes(v)) !== JSON.stringify(want)) bad.push(`占位不一样：${k} → ${v}`)
        if (HAN.test(v)) bad.push(`英文里有中文：${k} → ${v}`)
      } else {
        for (const n of [0, 1, 2, 12]) {
          const p = Object.fromEntries(want.map((h) => [h, h === 'n' || h === 'count' ? n : `‹${h}›`]))
          const out = v(p)
          if (/\{\w+\}/.test(out)) bad.push(`算出来还剩占位：${k} → ${out}`)
          if (HAN.test(out)) bad.push(`英文里有中文：${k} → ${out}`)
          for (const h of want) if (h !== 'n' && h !== 'count' && !out.includes(`‹${h}›`)) bad.push(`没用上 {${h}}：${k} → ${out}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('键不以空白开头结尾（拼句子剩下的半截）', () => {
    const bad = ZH.filter((k) => bare(k) !== bare(k).trim() || bare(k) === '')
    expect(bad).toEqual([])
  })
})

describe('抽完的文件', () => {
  it('没有漏包的中文（写进文件、给 AI 的那几处标了「不翻」）', () => {
    const { strays } = doneProblems()
    expect(strays.map((s: { file: string; line: number; text: string }) => `${s.file}:${s.line} ${s.text}`)).toEqual([])
  })

  it('不拼句子：t() 不和别的字用 + 连、不放进带字的模板里', () => {
    const { concat } = doneProblems()
    expect(concat.map((c: { file: string; line: number; why: string }) => `${c.file}:${c.line} ${c.why}`)).toEqual([])
  })

  it('抽完的文件列表里每个都在', () => {
    expect(DONE.length).toBeGreaterThan(0)
  })
})

describe('扫描', () => {
  it('认得 t()、带 ctx 的、tv()、tIn()，拼句子的、漏包的都报', () => {
    const r = scanCode(
      [
        "t('关掉了「{name}」', { name })",
        "t('标题', { ctx: '插入菜单' })",
        "tv('AI 讲解')",
        "tIn('en', '设置')",
        "const a = t('已存') + '：' + x",
        'const b = `${t(\'已存\')}，好了`',
        "const c = '没包的'",
        'const d = <b>也没包</b>',
        "const e = '写进文件的' // 不翻：写进文件",
        "console.log('日志不算')",
        "const f = { kw: '别名 不算' }",
        // 分类的身份（中文名）换成这个库的文件夹名：不是界面字
        "const g = catName('课程') + underCat(p, '周记') + isChildOf(f, '阅读')",
      ].join('\n'),
    )
    expect(r.keys.map((k: { key: string; ctx?: string }) => (k.ctx ? `${k.ctx}::${k.key}` : k.key))).toEqual(['关掉了「{name}」', '插入菜单::标题', 'AI 讲解', '设置', '已存', '已存'])
    expect(r.concat.length).toBe(2)
    expect(r.strays.map((s: { text: string }) => s.text)).toEqual(['${…}，好了', '没包的', '也没包'])
  })
})

describe('日期跟界面语言（shared/when.ts）', () => {
  const now = new Date(2026, 10, 22, 12, 0).getTime() // 周日
  const at = (y: number, m: number, d: number, h = 9, mi = 5) => new Date(y, m - 1, d, h, mi).getTime()
  it('中文照旧', () => {
    expect(when(at(2026, 11, 22, 10, 34), { now })).toBe('10:34')
    expect(when(at(2026, 11, 21, 21, 5), { now, time: true })).toBe('昨天 21:05')
    expect(when(at(2026, 11, 19), { now })).toBe('周四')
    expect(when(at(2026, 11, 6), { now })).toBe('11月6日')
    expect(when(at(2024, 11, 6), { now })).toBe('2024年11月6日')
  })
  it('英文用 Intl：今天钟点、Yesterday、Thu、Nov 6、Nov 6, 2024', () => {
    expect(when(at(2026, 11, 22, 10, 34), { now, lang: 'en' })).toBe('10:34')
    expect(when(at(2026, 11, 22, 10, 34), { now, lang: 'en', time: true })).toBe('Today 10:34')
    expect(when(at(2026, 11, 21, 21, 5), { now, lang: 'en', time: true })).toBe('Yesterday 21:05')
    expect(when(at(2026, 11, 19), { now, lang: 'en' })).toBe('Thu')
    expect(when(at(2026, 11, 6), { now, lang: 'en' })).toBe('Nov 6')
    expect(when(at(2024, 11, 6), { now, lang: 'en' })).toBe('Nov 6, 2024')
    expect(dateText(at(2026, 11, 22), now, 'en')).toBe('Nov 22')
  })
  it('英文界面、系统用 12 小时制时钟点写 AM / PM；中文一直 24 小时制', () => {
    setUiLang('en', { hour12: true })
    try {
      expect(clock(at(2026, 11, 22, 9, 5))).toBe('9:05 AM')
      expect(clock(at(2026, 11, 22, 21, 5))).toBe('9:05 PM')
      expect(clock(at(2026, 11, 22, 21, 5), 'zh')).toBe('21:05')
    } finally {
      setUiLang('zh', { hour12: false })
    }
  })
  it('句子中间的 Today 写小写', () => {
    expect(inline('Today 10:34')).toBe('today 10:34')
    expect(inline('Nov 6 09:30')).toBe('Nov 6 09:30')
  })
})

describe('取字', () => {
  const T = { '关掉了「{name}」': 'Closed “{name}”', '插入菜单::标题': 'Heading', '{n}篇': (p: Record<string, unknown>) => count(p.n, 'note') }
  it('中文就是原句，带上变量', () => {
    expect(translate('zh', T, '关掉了「{name}」', { name: '甲' })).toBe('关掉了「甲」')
    expect(translate('zh', T, '标题', { ctx: '插入菜单' })).toBe('标题')
  })
  it('英文照表，ctx 分开同字不同义，没有的退回中文', () => {
    expect(translate('en', T, '关掉了「{name}」', { name: 'A' })).toBe('Closed “A”')
    expect(translate('en', T, '标题', { ctx: '插入菜单' })).toBe('Heading')
    expect(translate('en', T, '标题')).toBe('标题')
    expect(translate('en', T, '{n}篇', { n: 1 })).toBe('1 note')
    expect(translate('en', T, '{n}篇', { n: 3 })).toBe('3 notes')
  })
  it('没给的、不是字母数字的占位原样留着（设置说明里的 {k:new-note}）', () => {
    expect(fill('按 {k:new-note} 新建 {x}', { y: 1 })).toBe('按 {k:new-note} 新建 {x}')
  })
  it('系统语言：中文（简体、繁体）用简体中文，别的都用 English', () => {
    expect(['zh-Hans-DE', 'zh-CN', 'zh_TW', 'zh'].map(langOfLocale)).toEqual(['zh', 'zh', 'zh', 'zh'])
    expect(['en-US', 'de-DE', 'ja', 'zhx', ''].map(langOfLocale)).toEqual(['en', 'en', 'en', 'en', 'en'])
  })
  it('列举：中文「、」，英文 Intl', () => {
    expect(listText('zh', ['甲', '乙', '丙'])).toBe('甲、乙、丙')
    expect(listText('en', ['A', 'B', 'C'])).toBe('A, B, and C')
  })
})
