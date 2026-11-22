/**
 * 主窗口出了什么事都记进 main.log（task-pyb39）：界面的 console.error、没接住的异常（界面报上来的带堆栈）、
 * 预加载出错、界面进程没了、卡住、页面没载进来；GPU 这些子进程没了也记。右栏网页（webview）的不接：那是网页的事，也不写网页内容。
 */
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { formatReport, type RollingLog } from './crash-log'

export function setupCrashLog(log: RollingLog, mainWin: () => BrowserWindow | null) {
  const isMain = (wc: Electron.WebContents) => mainWin()?.webContents === wc
  ipcMain.on('crash:report', (e, r: unknown) => {
    if (!isMain(e.sender)) return
    const f = formatReport(r)
    if (f) log.write(f.what, f.text)
  })
  ipcMain.handle('crash:reload', (e) => {
    if (isMain(e.sender)) e.sender.reload()
  })
  ipcMain.handle('crash:log-dir', () => log.dir)
  ipcMain.handle('crash:reveal-logs', () => revealLogs(log))
  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') log.write('child-process-gone', `${d.type}${d.name ? ` (${d.name})` : ''} reason=${d.reason} exitCode=${d.exitCode}`)
  })
}

/** 菜单「帮助 › 打开日志文件夹」：还没出过错时文件夹也先建好 */
export async function revealLogs(log: RollingLog) {
  mkdirSync(log.dir, { recursive: true })
  await shell.openPath(log.dir)
}

/** 每建一个主窗口接一次 */
export function watchWindow(log: RollingLog, w: BrowserWindow) {
  const wc = w.webContents
  wc.on('console-message', (e) => {
    if (e.level !== 'error') return
    log.write('renderer-console', `${e.message}${e.sourceId ? `\n(${e.sourceId}:${e.lineNumber})` : ''}`)
  })
  wc.on('preload-error', (_e, path, err) => log.write('preload-error', `${path}\n${err?.stack ?? String(err)}`))
  wc.on('render-process-gone', (_e, d) => log.write('render-process-gone', `reason=${d.reason} exitCode=${d.exitCode}`))
  wc.on('did-fail-load', (_e, code, desc, url, mainFrame) => {
    if (mainFrame) log.write('did-fail-load', `${code} ${desc} ${url}`)
  })
  w.on('unresponsive', () => log.write('unresponsive', '主窗口没有响应'))
  w.on('responsive', () => log.write('responsive', '主窗口又有响应了'))
}
