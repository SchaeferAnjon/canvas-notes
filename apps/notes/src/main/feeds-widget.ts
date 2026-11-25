/**
 * 文件夹首页的「画布订阅」组件（画布订阅第二批，设计页 135「文件夹首页『订阅』组件」）：画布笔记这边只加的这一层接口。
 * 画布订阅把每个订阅文件夹（和「全部」）最新的几篇写进它设置目录里的 widget.json（apps/feeds/src/main/widget.ts，写法两边各认一份），
 * 这里只读它；点一篇走 canvas-feeds://item/<编号>，在画布订阅里打开。没装、没打开过画布订阅时读不到，组件说一句。
 * CN_FEEDS_DATA 换画布订阅的设置目录（测试一律给临时的）。
 */
import { app, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FeedsWidgetData } from '../shared/feeds-widget'

const dataDir = () => process.env.CN_FEEDS_DATA || join(app.getPath('appData'), 'canvas-feeds')

/** 读画布订阅写的那一份；没有（没装、没打开过）是 null，写坏的也当没有 */
export async function readFeedsWidget(dir = dataDir()): Promise<FeedsWidgetData | null> {
  try {
    const d = JSON.parse(await readFile(join(dir, 'widget.json'), 'utf8')) as FeedsWidgetData
    return d && d.v === 1 && Array.isArray(d.groups) ? d : null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
    throw e
  }
}

export const isFeedsItemUrl = (url: unknown): url is string => typeof url === 'string' && /^canvas-feeds:\/\/item\/[A-Za-z0-9_%-]{1,80}$/.test(url)

export function registerFeedsWidget() {
  ipcMain.handle('feeds:widget', () => readFeedsWidget())
  ipcMain.handle('feeds:open', async (_e, id: unknown) => {
    const url = `canvas-feeds://item/${encodeURIComponent(String(id))}`
    if (typeof id !== 'string' || !isFeedsItemUrl(url)) throw new Error('不是画布订阅的文章')
    await shell.openExternal(url)
  })
  ipcMain.handle('feeds:openApp', () => shell.openExternal('canvas-feeds://'))
}
