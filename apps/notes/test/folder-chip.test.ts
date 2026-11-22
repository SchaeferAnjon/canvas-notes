import { setVaultName } from '../src/renderer/vault-name'
import { describe, expect, it } from 'vitest'
import type { MenuEntry } from '../src/renderer/ctx/menu'
import { allFolders, moveMenu } from '../src/renderer/ctx/move-menu'

/** 菜单读成字：子菜单写成「写作 › 游记」 */
function labels(m: MenuEntry[], pre = ''): string[] {
  return m.flatMap((e) => {
    if (!e || e === '-' || typeof e !== 'object' || !('label' in e)) return []
    if ('submenu' in e) return labels(e.submenu, pre + e.label + ' › ')
    return [pre + e.label]
  })
}

describe('「移到」菜单（笔记右键、文件夹右键、标题下所在文件夹 ▾）', () => {
  const folders = allFolders(['写作/游记/冰岛.md', '写作/书评/a.md', '收件箱/x.md', '课程/ecp/讲义.pdf', '日记.md'], ['剪藏/冰岛旅行', '旧东西'])

  it('库里每一层文件夹都在，空文件夹也算', () => {
    expect(folders).toEqual(['剪藏', '剪藏/冰岛旅行', '旧东西', '课程', '课程/ecp', '收件箱', '写作', '写作/书评', '写作/游记'])
  })

  it('一层层排成子菜单，子文件夹能选；现在这个文件夹灰着列出来、点不了（task-5yp97「藏之后」图）；最前面是库名（CN-106），再按分类表的先后，别的文件夹在后', () => {
    setVaultName('canvas-note-test')
    const picked: string[] = []
    const m = moveMenu(folders, '收件箱', (f) => picked.push(f))
    const here = m.find((e) => e && typeof e === 'object' && 'label' in e && e.label === '收件箱') as { enabled?: boolean; run(): void }
    expect(here.enabled).toBe(false)
    here.run()
    expect(picked).toEqual([])
    expect(labels(m)).toEqual([
      'canvas-note-test',
      '收件箱',
      '课程 › 放进「课程」',
      '课程 › ecp',
      '剪藏 › 放进「剪藏」',
      '剪藏 › 冰岛旅行',
      '写作 › 放进「写作」',
      '写作 › 书评',
      '写作 › 游记',
      '旧东西',
    ])
    const write = m.find((e) => e && typeof e === 'object' && 'label' in e && e.label === '写作') as { submenu: MenuEntry[] }
    const trip = write.submenu.find((e) => e && typeof e === 'object' && 'label' in e && e.label === '游记') as { run(): void }
    trip.run()
    expect(picked).toEqual(['写作/游记'])
  })

  it('在最外层的不列库名那一项；文件夹不能挪进自己里面', () => {
    expect(labels(moveMenu(folders, '', () => undefined))[0]).toBe('收件箱')
    const m = moveMenu(folders, '', () => undefined, (f) => f === '写作' || f.startsWith('写作/'))
    expect(labels(m).some((l) => l.startsWith('写作'))).toBe(false)
  })
})
