/**
 * 打包好的画布笔记只用安装包里的 git（2026-11-26 用户选「带上」）：没装苹果命令行工具的 Mac 上，/usr/bin/git 只是个壳，
 * 一跑就弹「安装命令行开发者工具」的窗口，软件又不停地调 git（0.5.13 朋友首开 CPU 占满）。
 * 安装包里那份在 Resources/git（scripts/fetch-git.mjs 下好，electron-builder 的 extraResources 带进去）。
 * 主进程、对外接口的小程序（mcp-stdio，用 Electron 当 Node 跑）一开头各调一次 useBundledGit(__dirname)：
 * 设好 CN_GIT_DIR，@cn/git 的 gitProgram 就只起这一份，找不到就报错、不退回系统 git；生长图这些子进程继承这个环境变量。
 * 开发时（不在 app.asar 里跑）不设，用 PATH 里系统的 git；测试要用自带那份就自己给 CN_GIT_DIR。不依赖 Electron
 */
import { dirname, join, sep } from 'node:path'

/** here 是 Resources/app.asar/out/main 这样的目录时，自带 git 在 Resources/git；不在 app.asar 里（开发）是 null */
export function bundledGitDir(here: string): string | null {
  const i = here.indexOf(`${sep}app.asar${sep}`)
  if (i < 0 && !here.endsWith(`${sep}app.asar`)) return null
  const asar = i < 0 ? here : here.slice(0, i + `${sep}app.asar`.length)
  return join(dirname(asar), 'git')
}

export function useBundledGit(here: string): void {
  const dir = bundledGitDir(here)
  if (dir) process.env.CN_GIT_DIR = dir
}
