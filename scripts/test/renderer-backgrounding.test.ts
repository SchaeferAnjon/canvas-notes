// Electron 45 起从没显示过的窗口，渲染进程一开始就按「在后台」降优先级（44 不降），机器一忙它就排不上，新开的隐藏窗口一直停在加载中
// （空 Electron 45 + show:false 在占满 CPU 时 40 秒加载不完，加开关 0.2 秒；MeetCaption 先查到，见 docs/DEVELOPMENT.md「Electron 45」）。
// 画布笔记、画布今日、画布订阅的主进程都在 app ready 之前加 disable-renderer-backgrounding：测试模式窗口从不显示，
// 正式用时主窗口显示前、速记 / 快速加一条小窗、菜单栏弹窗、导图导出 PDF 的窗口也是隐藏的。真开窗口的检查在各自的 e2e hidden-window.spec.ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe.each(['notes', 'today', 'feeds'])('%s 主进程', (app) => {
  test('在 app.whenReady 之前顶格加 disable-renderer-backgrounding（不在 if 里、没被注释掉）', () => {
    const main = readFileSync(join(ROOT, 'apps', app, 'src/main/index.ts'), 'utf8')
    const at = main.search(/^app\.commandLine\.appendSwitch\('disable-renderer-backgrounding'\)$/m)
    expect(at, '没有顶格的 disable-renderer-backgrounding').toBeGreaterThan(0)
    expect(at, '要在 app.whenReady 之前加（之后加不生效）').toBeLessThan(main.indexOf('app.whenReady('))
  })
})
