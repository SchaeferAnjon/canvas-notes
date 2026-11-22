/**
 * 打开一篇笔记时光标放哪（第 3 轮：文件树点开直接打字，字插到「# 」前面，标题变成「今# 日记」）。
 * - 上次离开时的位置（记在这台机器上，按路径；改名跟着走）；
 * - 没有记录：正文第一段看得见的字末尾，开头的标题（# 写法、下划线写法）、分隔线、属性、空行都跳过（第 4 轮：下划线标题、分隔线、
 *   属性下面空一行再写标题时，字粘在 ==== / ___ 后面或打进标题）；第一段不是普通字（代码块、表格、图片），放在标题行末尾；
 * - 无论哪种，都不落在标题的「# 」记号前面或里面（文档模式里它藏着，字打进去标题就坏了），不落在下划线、分隔线上，也不落在 frontmatter 里。
 * 新建的笔记不走这里（NoteTab 把标题里的「未命名」整个选上，光标在标题行末尾，打字就替换）。
 */

const KEY = 'cn.openCursor'
/** 最多记这么多篇，多了丢最早的 */
const MAX = 400

/** frontmatter 结束后的位置（没有 frontmatter 是 0） */
function bodyStart(text: string): number {
  const m = /^---\n[\s\S]*?\n---(\n|$)/.exec(text)
  return m ? m[0].length : 0
}

/** 这一行开头的标题记号（「# 」「## 」……）有几个字；不是标题返回 0 */
const markLen = (line: string) => /^#{1,6} /.exec(line)?.[0].length ?? 0

/** 普通的一段字（光标放在它末尾接着打字不会打坏别的写法） */
const plain = (line: string) => !/^(```|~~~|\||<|!\[|\$\$|---|\s*$)/.test(line)

const blank = (line: string) => /^\s*$/.test(line)
/** 藏着的位置行（<!-- card … -->） */
const cardLine = (line: string) => /^<!--.*-->\s*$/.test(line)
/** 分隔线：*** ___ ---（中间可以有空格） */
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
/** 下划线标题（Setext）的下划线：上面一行是字时的 ==== 或 ---- */
const SETEXT = /^ {0,3}(=+|-+)\s*$/
/** 列表、引用的行：下面的 --- 是分隔线，不是下划线 */
const listOrQuote = (line: string) => /^\s*([-*+]|\d+[.)])\s|^\s*>/.test(line)

/**
 * 没有记录时的位置：正文第一段看得见的字末尾。开头的标题（# 写法、下划线写法，哪一级都算）、分隔线、空行、藏着的位置行都跳过；
 * 第一块不是普通字（代码块、表格、图片、折叠块）或者只有标题，放在第一个标题行末尾
 */
function defaultCursor(text: string): number {
  const start = bodyStart(text)
  const lines = text.slice(start).split('\n')
  const from: number[] = []
  let p = start
  for (const l of lines) {
    from.push(p)
    p += l.length + 1
  }
  const end = (k: number) => from[k]! + lines[k]!.length
  let titleEnd: number | null = null
  let i = 0
  while (i < lines.length) {
    const l = lines[i]!
    if (blank(l) || cardLine(l) || HR.test(l)) {
      i++
      continue
    }
    if (markLen(l)) {
      titleEnd ??= end(i)
      i++
      continue
    }
    if (!plain(l)) break
    // 这一段连着的几行
    let k = i
    while (k + 1 < lines.length && !blank(lines[k + 1]!) && !SETEXT.test(lines[k + 1]!) && !HR.test(lines[k + 1]!) && plain(lines[k + 1]!)) k++
    // 下面一行是 ==== / ----：这一段是下划线标题，接着往下找正文
    if (k + 1 < lines.length && SETEXT.test(lines[k + 1]!) && !listOrQuote(lines[i]!)) {
      titleEnd ??= end(k)
      i = k + 2
      continue
    }
    return end(k)
  }
  return titleEnd ?? Math.min(start, text.length)
}

/** 把 pos 挪出 frontmatter、标题记号、下划线标题的下划线和分隔线 */
function safe(text: string, pos: number): number {
  const start = bodyStart(text)
  if (pos < start) return defaultCursor(text)
  const lineFrom = text.lastIndexOf('\n', pos - 1) + 1
  const lineTo = text.indexOf('\n', lineFrom)
  const line = text.slice(lineFrom, lineTo === -1 ? text.length : lineTo)
  const prev = lineFrom > start ? text.slice(text.lastIndexOf('\n', lineFrom - 2) + 1, lineFrom - 1) : null
  // 下划线：放到上面那行标题字末尾
  if (prev !== null && SETEXT.test(line) && !blank(prev) && plain(prev) && !listOrQuote(prev)) return lineFrom - 1
  if (HR.test(line)) return defaultCursor(text)
  const mark = markLen(line)
  return mark && pos < lineFrom + mark ? lineFrom + mark : pos
}

/** 打开时光标放在哪；saved：上次离开时记下的位置 */
export function openCursor(text: string, saved?: number | null): number {
  // 记下的是 0（旧版本打开就在最前面）和没记一样
  // 记坏了的（不是数字，task-pyb39）也当没记：NaN 当光标位置给编辑器会抛错
  if (typeof saved !== 'number' || !Number.isFinite(saved) || saved <= 0) return safe(text, defaultCursor(text))
  return safe(text, Math.min(saved, text.length))
}

function load(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    // 不是对象（null、数组）当没记：后面要往里写
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function store(m: Record<string, number>) {
  const keys = Object.keys(m)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete m[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // 存不下（隐私模式之类）：下次打开放在正文开头
  }
}

export function savedCursor(path: string): number | null {
  return load()[path] ?? null
}

/** 记下这一篇光标在哪（最近记的排在最后，满了丢最早的） */
export function saveCursor(path: string, pos: number) {
  const m = load()
  delete m[path]
  m[path] = pos
  store(m)
}

/** 改名、挪走：记录跟着新路径 */
export function moveCursor(from: string, to: string) {
  const m = load()
  if (!(from in m)) return
  m[to] = m[from]!
  delete m[from]
  store(m)
}
