/**
 * 载 node-llama-cpp 的进程（搜索进程，bge-m3）最先引进这个文件。
 */
import fs from 'node:fs'

// 打好的包里：Electron 对 app.asar 里（解出来的也一样）的「文件夹」fs.access 报 ENOENT，existsSync 却是 true。
// node-llama-cpp 用 fs-extra 的 pathExists（就是 fs.access）找自带的 llama/grammars 文件夹，找不到就报「Grammars folder not found」。
// 在载入它之前把 access 补上：asar 里的路径 access 说没有、existsSync 说有时，当作有（fs-extra 载入时会抄一份 fs，所以要赶在 import 前）
const realAccess = fs.access
const inAsar = (p: unknown) => typeof p === 'string' && p.includes('.asar/')
fs.access = ((p: fs.PathLike, mode: unknown, cb?: unknown) => {
  const done = (typeof mode === 'function' ? mode : cb) as (e: NodeJS.ErrnoException | null) => void
  const m = typeof mode === 'number' ? mode : undefined
  realAccess(p, m, (e) => done(e && e.code === 'ENOENT' && inAsar(p) && fs.existsSync(p) ? null : e))
}) as typeof fs.access
const realAccessP = fs.promises.access
fs.promises.access = async (p, mode) => {
  try {
    await realAccessP(p, mode)
  } catch (e) {
    if (!((e as NodeJS.ErrnoException).code === 'ENOENT' && inAsar(p) && fs.existsSync(p))) throw e
  }
}

