/**
 * 这个库怎么分（task-h7oy8，shared/vault-roles.ts）在主进程这边：读库里的 .canvas-notes/梦游.md、推断、写回并提交。
 * 梦游（dream.ts，在临时检出里读）和设置 › 梦游「这个库怎么分」（dream-main.ts 的 IPC）都用这一份。不依赖 Electron。
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import { writeQueued } from '@cn/atomic'
import { decodeNote } from '@cn/format'
import { effectiveRoles, inferRoles, parseRolesMd, ROLES, ROLES_FILE, type RoleRow, type RolesConfig, rolesMd, type RolesView, today } from '../shared/vault-roles'

/** 读 .canvas-notes/梦游.md；没有给 null，读不懂的行跳过 */
export async function readRolesFile(root: string): Promise<RolesConfig | null> {
  try {
    return parseRolesMd(await readFile(join(root, ROLES_FILE), 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** 这次用的那一份：文件里的加上新冒出来的文件夹的推断 */
export async function rolesAt(root: string, paths: readonly string[], texts: ReadonlyMap<string, string>): Promise<RolesView> {
  return effectiveRoles(await readRolesFile(root), inferRoles(paths, texts), paths)
}

const SKIP = new Set(['node_modules', '.git'])

/** 库里所有文件（相对路径，隐藏的文件夹不进）：推断要看图片、PDF 占几成 */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    const subs: Promise<void>[] = []
    for (const e of await readdir(dir ? join(root, dir) : root, { withFileTypes: true })) {
      // 隐藏的不进；.gitkeep 留着（只放着它的空文件夹也算一个文件夹，比如还没写过的 02weekly）
      if ((e.name.startsWith('.') && e.name !== '.gitkeep') || SKIP.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) subs.push(walk(rel))
      else if (e.isFile()) out.push(rel)
    }
    await Promise.all(subs)
  }
  await walk('')
  return out.sort()
}

/**
 * 「确认」：写 .canvas-notes/梦游.md（带今天的日期），一次提交「梦游：确认这个库怎么分」。
 * 用户没提交的别的改动不跟着进这次提交
 */
export async function saveRoles(root: string, rows: RoleRow[], now = new Date()): Promise<{ confirmed: string; commit: string | null }> {
  const confirmed = today(now)
  await mkdir(dirname(join(root, ROLES_FILE)), { recursive: true })
  await writeQueued(join(root, ROLES_FILE), rolesMd({ rows, confirmed }), { mkdir: true })
  const commit = await git.commitPaths(root, [ROLES_FILE], `梦游：确认这个库怎么分（${rows.length} 个文件夹）`)
  return { confirmed, commit }
}

/** 设置页看的那一份：读库里所有文件和 md 全文（一次最多同时开 64 个），fresh 是不看文件、重新认一遍 */
export async function rolesOfVault(root: string, fresh = false): Promise<RolesView> {
  const paths = await walkFiles(root)
  const md = paths.filter((p) => p.toLowerCase().endsWith('.md'))
  const texts = new Map<string, string>()
  for (let i = 0; i < md.length; i += 64) {
    const got = await Promise.all(md.slice(i, i + 64).map(async (p) => [p, decodeNote(await readFile(join(root, p))).text] as const))
    for (const [p, t] of got) texts.set(p, t)
  }
  const inferred = inferRoles(paths, texts)
  return effectiveRoles(fresh ? null : await readRolesFile(root), inferred, paths)
}

/** 界面给的一行行：只认库里的相对路径、认得的角色；理由最长 200 字 */
export function checkRows(x: unknown): RoleRow[] {
  if (!Array.isArray(x) || x.length > 500) throw new Error('参数不对')
  const out: RoleRow[] = []
  for (const r of x as Record<string, unknown>[]) {
    const folder = typeof r?.folder === 'string' ? r.folder.trim() : ''
    const id = typeof r?.role === 'string' && (ROLES as readonly string[]).includes(r.role) ? (r.role as RoleRow['role']) : null
    if (!folder || folder.startsWith('/') || folder.split('/').some((s) => !s || s === '..' || s.startsWith('.')) || !id) throw new Error(`这一行不对：${folder || '（空）'}`)
    out.push({ folder, role: id, why: typeof r.why === 'string' ? r.why.replace(/\s+/g, ' ').trim().slice(0, 200) : '', sure: 'high' })
  }
  return out
}
