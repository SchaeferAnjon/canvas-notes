/**
 * 课程术语表：库里 `课程/<课>/术语表.md`，普通 md，一张表（原文 | 译法 | 备注），跟着 Git 走。
 * 用哪张：中间栏开着的文件在哪门课里就用哪门课的；不在课程里用上一次用过的那张；都没有就不用。
 * 没有时可以让 AI 起个头：读这门课文件夹里的笔记、PDF 和当前网页，挑 10 到 40 个专业词写成表，作为一次提交。
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { courseOf, glossaryMd, glossaryPath, parseGlossary, type Term } from '../../../shared/plugins/translate'

/** 读库里文件要的几样（Vault 的一部分，测试里给假的） */
export interface GlossaryVault {
  root: string
  abs(rel: string): string
  read(rel: string): Promise<{ text: string }>
  write(rel: string, text: string, base: string): Promise<{ ok: boolean }>
}

/** 用 macOS 自带的 PDFKit 取 PDF 里的字（osascript 的 JavaScript），最多 max 个字；取不到给空的 */
export function pdfText(abs: string, max: number): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve('')
  const script =
    'function run(argv){ObjC.import("PDFKit");const d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));' +
    'if(!d||d.isNil())return "";const s=d.string;return s.isNil()?"":ObjC.unwrap(s).slice(0,Number(argv[1]))}'
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, abs, String(max)], { timeout: 15_000, maxBuffer: 4 * max + 1024 }, (err, out) => resolve(err ? '' : out.trim()))
  })
}

/** 这门课的材料：笔记（md）和 PDF 里的字，加上当前网页；一共最多 maxChars 个字 */
export async function courseMaterial(v: GlossaryVault, course: string, page: string, maxChars = 24_000): Promise<{ text: string; files: number }> {
  const dir = v.abs(`课程/${course}`)
  const files: string[] = []
  const walk = async (d: string, depth: number) => {
    let ents
    try {
      ents = await readdir(d, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1)
      else if (e.isFile() && /\.(md|pdf)$/i.test(e.name) && e.name !== '术语表.md') files.push(p)
    }
  }
  await walk(dir, 0)
  const parts: string[] = []
  let left = maxChars
  if (page.trim()) {
    const t = page.trim().slice(0, Math.min(8000, left))
    parts.push(`【当前网页】\n${t}`)
    left -= t.length
  }
  const per = Math.max(2000, Math.floor(left / Math.max(1, files.length)))
  for (const f of files) {
    if (left <= 0) break
    const take = Math.min(per, left)
    const t = /\.pdf$/i.test(f) ? await pdfText(f, take) : (await readFile(f, 'utf8')).slice(0, take)
    if (!t.trim()) continue
    parts.push(`【${f.slice(dir.length + 1)}】\n${t}`)
    left -= t.length
  }
  return { text: parts.join('\n\n'), files: files.length }
}

export function draftPrompt(course: string, material: string, target: string): string {
  return [
    '命令：起术语表',
    `课程：${course}`,
    `从下面这门课的材料里挑 10 到 40 个专业词（外文原词），给出${target === 'zh-CN' ? '简体中文' : target}里的标准译法；容易译错的在备注里写一句（比如「不译「特性方程」」）。`,
    '每个词输出一行 JSON：{"src":"原词","dst":"译法","note":"备注，没有就空"}，一词一行；不要代码块，不要别的话。',
    '材料：',
    material,
  ].join('\n')
}

/** 拆 AI 回的一行一个 {"src","dst","note"}；重复的、空的不要 */
export function parseDraft(out: string): Term[] {
  const seen = new Set<string>()
  const terms: Term[] = []
  for (const line of out.split('\n')) {
    const s = line.trim().replace(/^```(json)?|```$/g, '').trim().replace(/,$/, '')
    if (!s.startsWith('{')) continue
    try {
      const o = JSON.parse(s) as { src?: unknown; dst?: unknown; note?: unknown }
      if (typeof o.src !== 'string' || typeof o.dst !== 'string' || !o.src.trim() || !o.dst.trim()) continue
      const k = o.src.trim().toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      terms.push({ src: o.src.trim(), dst: o.dst.trim(), note: typeof o.note === 'string' ? o.note.trim() : '' })
    } catch {
      // 不是这样的一行：跳过
    }
  }
  return terms.slice(0, 40)
}

/** 术语表的读取（按修改时间缓存）和「上一次用的那门课」 */
export class Glossaries {
  private cache = new Map<string, { mtimeMs: number; terms: Term[] }>()
  /** 中间栏现在开着的文件（界面报上来） */
  activePath: string | null = null
  lastCourse: string | null = null

  /** 现在用哪门课：中间栏的文件在课程里就是那门课，否则上一次用过的 */
  course(): string | null {
    return courseOf(this.activePath) ?? this.lastCourse
  }

  async terms(v: GlossaryVault | null, course: string | null): Promise<Term[]> {
    if (!v || !course) return []
    const abs = v.abs(glossaryPath(course))
    let st
    try {
      st = await stat(abs)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.delete(abs)
        return []
      }
      throw e
    }
    const hit = this.cache.get(abs)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.terms
    const terms = parseGlossary(await readFile(abs, 'utf8'))
    this.cache.set(abs, { mtimeMs: st.mtimeMs, terms })
    if (terms.length) this.lastCourse = course
    return terms
  }

  /** 菜单、设置里显示的：哪门课、有没有表、几条 */
  async info(v: GlossaryVault | null): Promise<{ course: string | null; path: string | null; exists: boolean; count: number }> {
    const course = this.course()
    if (!v || !course) return { course, path: null, exists: false, count: 0 }
    const path = glossaryPath(course)
    let exists = true
    try {
      await stat(v.abs(path))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      exists = false
    }
    return { course, path, exists, count: exists ? (await this.terms(v, course)).length : 0 }
  }
}

/** 往术语表里加一行（译法先留空）；没有表就新建。返回表的路径 */
export async function appendTerm(v: GlossaryVault, course: string, src: string): Promise<string> {
  const path = glossaryPath(course)
  let text = ''
  try {
    text = (await v.read(path)).text
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const word = src.replace(/\s+/g, ' ').trim()
  const terms = parseGlossary(text)
  if (terms.some((t) => t.src.toLowerCase() === word.toLowerCase())) return path
  let next: string
  if (!text.trim()) next = glossaryMd([]) + `| ${word.replace(/\|/g, '\\|')} |  |  |\n`
  else {
    // 加在表的最后一行后面（表后面还有别的字也不动它们）
    const lines = text.split('\n')
    let last = -1
    for (let i = 0; i < lines.length; i++) if (lines[i]!.trim().startsWith('|')) last = i
    const row = `| ${word.replace(/\|/g, '\\|')} |  |  |`
    if (last === -1) next = text.replace(/\n*$/, '\n\n') + glossaryMd([]).replace(/^# 术语表\n/, '') + row + '\n'
    else {
      lines.splice(last + 1, 0, row)
      next = lines.join('\n')
    }
  }
  await mkdir(dirname(v.abs(path)), { recursive: true })
  const r = await v.write(path, next, text)
  if (!r.ok) throw new Error('术语表刚被改过，再加一次')
  return path
}
