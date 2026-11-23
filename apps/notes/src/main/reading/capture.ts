/**
 * 截屏幕上的一块：网页上框好的那块（右栏 <webview> 的 webContents）、中间栏 HTML 里框好的那块（窗口自己）。
 * 截的是画出来的样子，HTML 跑在沙箱 iframe 里也截得到。
 */
import { type BrowserWindow, ipcMain, webContents } from 'electron'
import { t } from '../../shared/i18n'

export function setupCapture(win: () => BrowserWindow | null) {
  ipcMain.handle('reading:capture', async (_e, wcId: unknown, rect: unknown) => {
    const r = rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error(t('截图的位置不对'))
    const wc = typeof wcId === 'number' ? webContents.fromId(wcId) : win()?.webContents
    if (!wc || wc.isDestroyed()) throw new Error(t('那一页已经关了'))
    const x = Math.max(0, Math.round(r.x as number))
    const y = Math.max(0, Math.round(r.y as number))
    const img = await wc.capturePage({ x, y, width: Math.max(1, Math.round(r.w as number)), height: Math.max(1, Math.round(r.h as number)) })
    if (img.isEmpty()) throw new Error(t('截图是空的（页面还没画出来）'))
    return new Uint8Array(img.toPNG())
  })
}
