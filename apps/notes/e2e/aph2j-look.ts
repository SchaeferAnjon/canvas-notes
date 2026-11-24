/** 主题渐变那几份测试共用（task-aph2j）：一篇像设计稿那样的文档、按外观设置开软件、存截图 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

const DOC = `# 小论文计划

截稿前把实验和初稿弄完，周五交给导师。

## 这周

- [ ] 读完三篇相关论文
- [ ] 交论文初稿
- [x] 和导师约时间

## 下周

先把第二章的实验图补上，再改摘要。引用的几篇放在参考文献那一节，格式统一成 APA。

> 写作不是把想好的东西抄下来，是在写的时候想清楚。
`
export const VAULT = {
  '写作/小论文计划.md': DOC,
  '写作/冰岛.md': '# 冰岛\n\n一月的雷克雅未克。\n',
  '课程/第 3 讲 笔记.md': '# 第 3 讲\n\n练习 5.1\n',
}

export async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

export async function open(look: Record<string, unknown>) {
  const run = await launch(VAULT, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, wallMix: 'mid', wallMove: false, ...look } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(run.page, '小论文计划')
  await openAi(run.page)
  await run.page.waitForTimeout(500)
  return run
}

