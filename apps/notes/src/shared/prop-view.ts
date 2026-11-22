/**
 * 「属性」弹层里列哪几行、每行叫什么、值怎么写（DESIGN.v3 1.8「弹层按类型列项」，task-zligc）。
 * 文件里的键不改（视频照旧 site、channel、duration、subtitles，剪藏照旧 source、created：别处的代码和 Obsidian 都认这些），
 * 只是界面上照软件的语言写中文名（偏好「文字跟软件语言」），时长写成 28:39，字幕写「中文 · 人工字幕」。
 * 软件从视频、网页上读来的几项（网站、时长、字幕、来源、剪于）只看不改，改了就和视频对不上了。
 */
import { aiFilled, fileType, HIDDEN_KEYS, readProps } from '@cn/format'
import { fmtTime } from './video'

export interface PropRow {
  /** 文件里的键 */
  key: string
  /** 界面上的名字 */
  label: string
  /** 文件里写的值 */
  raw: string
  /** 弹层里看到的值 */
  shown: string
  /** select：类型、课程下拉；input：直接改；text：只看 */
  kind: 'select' | 'input' | 'text'
  /** AI 认出来填的、用户还没改过 */
  ai: boolean
}

/** 文件里是英文的键，界面上的名字 */
export const LABELS: Record<string, string> = {
  site: '网站',
  channel: '频道',
  duration: '时长',
  subtitles: '字幕',
  translated: '译成',
  source: '来源',
  created: '剪于',
  author: '作者',
  title: '标题',
  tags: '标签',
  aliases: '别名',
  date: '日期',
  url: '网址',
  description: '简介',
  'read-along': '对着看',
}

/** 软件自己读来的，只看不改 */
const READONLY = new Set(['site', 'duration', 'subtitles', 'translated', 'source', 'created'])

/** 常用的放前面，没写的也列出来让人填（类型、课程总列；别的写了才列） */
const COMMON = ['类型', '课程', '第几讲', '来源', '日期']
/** 这几种类型自己的一套，按这个顺序；没写的：书摘的几项照样列出来让人填，视频、剪藏的是软件读来的，没有就不列 */
const KEYS_BY_TYPE: Record<string, { keys: string[]; always: boolean }> = {
  书摘: { keys: ['类型', '作者', '来源', '划线', '想法'], always: true },
  视频: { keys: ['类型', 'site', 'channel', 'duration', 'subtitles', 'translated', 'source'], always: false },
  剪藏: { keys: ['类型', 'source', 'created'], always: false },
}

const SITES: Record<string, string> = { youtube: 'YouTube', bilibili: '哔哩哔哩' }

const zhNames = (() => {
  try {
    return new Intl.DisplayNames(['zh-Hans'], { type: 'language' })
  } catch {
    return null
  }
})()

/** 语言代码的中文名：zh → 中文，en → 英语，zh-CN → 简体中文；认不出原样 */
export function langLabel(code: string): string {
  const c = code.trim()
  if (/^zh[-_](cn|hans|sg)$/i.test(c)) return '简体中文'
  if (/^zh[-_](tw|hant|hk|mo)$/i.test(c)) return '繁体中文'
  try {
    const n = zhNames?.of(c)
    return n && n !== c ? n : c
  } catch {
    return c
  }
}

/** 值在界面上怎么写 */
export function showValue(key: string, raw: string): string {
  if (key === 'site') return SITES[raw.toLowerCase()] ?? raw
  if (key === 'duration' && /^\d+(\.\d+)?$/.test(raw)) return fmtTime(Number(raw))
  if (key === 'subtitles') {
    const [lang, ...rest] = raw.split(' · ')
    return [langLabel(lang ?? ''), ...rest].join(' · ')
  }
  if (key === 'translated') return langLabel(raw)
  return raw
}

/** 这篇的类型：写了「类型」的照写的；没写时视频（type: video）是「视频」、剪下来的网页（有 source 网址）是「剪藏」 */
export function typeOf(text: string): { type: string; written: boolean } {
  const t = fileType(text)
  if (t) return { type: t, written: true }
  const props = readProps(text)
  const machine = props.find((p) => p.key === 'type')?.value
  if (machine === 'video') return { type: '视频', written: false }
  if (props.some((p) => p.key === 'source' && /^https?:\/\//.test(p.value))) return { type: '剪藏', written: false }
  return { type: '', written: false }
}

/** 弹层里的几行，按顺序 */
export function propRows(text: string): PropRow[] {
  const all = readProps(text)
  const ai = aiFilled(text)
  const { type } = typeOf(text)
  const own = Object.hasOwn(KEYS_BY_TYPE, type) ? KEYS_BY_TYPE[type]! : null
  const has = (k: string) => all.some((p) => p.key === k && p.value !== '')
  const head = own ? own.keys.filter((k) => k === '类型' || own.always || has(k)) : COMMON.filter((k) => has(k) || k === '类型' || k === '课程')
  const visible = (k: string) => !HIDDEN_KEYS.has(k)
  const tail = all.map((p) => p.key).filter((k, i, a) => a.indexOf(k) === i && visible(k) && !head.includes(k) && (own !== null || !COMMON.includes(k)))
  return [...head, ...tail].map((key) => {
    const raw = key === '类型' ? type : (all.find((p) => p.key === key)?.value ?? '')
    return {
      key,
      label: LABELS[key] ?? key,
      raw,
      shown: key === '类型' ? type : showValue(key, raw),
      kind: key === '类型' || key === '课程' ? 'select' : READONLY.has(key) ? 'text' : 'input',
      ai: ai.includes(key) && raw !== '',
    }
  })
}
