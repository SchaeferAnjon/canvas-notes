/**
 * 网页的笔记什么时候记的（右栏「笔记」里每条右边的「12:47」，task-6cxtc）：时间不写进 md（那篇是人自己的字），
 * 这台 Mac 上按「那篇 + 那一条的头一行」记着（块头、剪藏的来源那一行），最多记 800 条。这里记着的优先；没有的（别处写的经 git 同步过来、
 * 清过本机记录、改过头一行的）用 git 里那一行所在提交的作者时间（WebNotes.tsx 的 useGitTimes）；还没提交、这里也没记的不写。
 */
/** 写进那篇了、拿掉了（问完、剪完、撤回、换一篇）：笔记标签重读那篇，网页上的记号重画 */
export const WEB_NOTES_CHANGED = 'cn:web-notes-changed'
export const notesChanged = () => window.dispatchEvent(new Event(WEB_NOTES_CHANGED))

const KEY = 'cn.webNoteAt'
const MAX = 800

function read(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** 头一行：[!ai] 块是块头那一行，剪藏是来源那一行（引文下面「—— […](…)」） */
export function keyLine(md: string): string {
  const lines = md.trimEnd().split('\n')
  return lines.find((l) => /^——\s/.test(l)) ?? lines[0] ?? ''
}

/** 记下这一条现在写进了这篇 */
export function noteTime(path: string, md: string, at = Date.now()) {
  const all = read()
  all[`${path}\n${keyLine(md)}`] = at
  const keys = Object.keys(all)
  if (keys.length > MAX) for (const k of keys.sort((a, b) => all[a]! - all[b]!).slice(0, keys.length - MAX)) delete all[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 记不住：那一条不写时间
  }
}

/** 这一条（那篇里这一行）什么时候记的；不知道是 null */
export const timeOf = (path: string, line: string): number | null => read()[`${path}\n${line}`] ?? null
