import { describe, expect, it } from 'vitest'
import { runTool, type ToolHost, toolLabel, toolSpecs } from '../src/main/agent/tools'
import { keyName, parseKeys } from '../src/main/agent/web-keys'
import { pageFor, pagesSaid, webPages } from '../src/shared/web-pages'

describe('AI 操纵哪个网页（shared/web-pages.ts）', () => {
  const right = { open: true, shown: true, url: 'https://r.test/' }
  it('右栏、中间栏各一个：用户最后点进的那个是默认；都没点过时现在的栏是中间就中间，不然右栏', () => {
    const center = [{ key: 't1', url: 'https://c.test/', pane: 0 as const }]
    const base = { right, center, split: null, focus: 0 as const, live: false, last: null }
    expect(webPages(base).map((p) => [p.page, !!p.default])).toEqual([['center', false], ['right', true]])
    expect(webPages({ ...base, live: true }).find((p) => p.default)!.page).toBe('center')
    expect(webPages({ ...base, last: 't1' }).find((p) => p.default)!.page).toBe('center')
    expect(webPages({ ...base, live: true, last: 'right' }).find((p) => p.default)!.page).toBe('right')
  })
  it('右栏网页在 AI 后面看不见：中间有网页时默认中间；只有它时默认还是它（AI 刚开的）', () => {
    const hidden = { ...right, shown: false }
    const center = [{ key: 't1', url: 'https://c.test/', pane: 0 as const }]
    expect(webPages({ right: hidden, center, split: null, focus: 0, live: false, last: 'right' }).find((p) => p.default)!.page).toBe('center')
    const only = webPages({ right: hidden, center: [], split: null, focus: 0, live: false, last: null })
    expect(only).toEqual([{ page: 'right', key: 'right', url: 'https://r.test/', shown: false, default: true }])
  })
  it('分屏：左右两格叫 center-left / center-right（上下是 center-top / center-bottom）；center 认当前格', () => {
    const center = [
      { key: 'a', url: 'https://a.test/', pane: 1 as const },
      { key: 'b', url: 'https://b.test/', pane: 0 as const },
    ]
    const row = webPages({ right: null, center, split: 'row', focus: 1, live: true, last: null })
    expect(row.map((p) => p.page)).toEqual(['center-right', 'center-left'])
    expect(row.find((p) => p.default)!.key).toBe('a')
    expect(pageFor(row, 'center')!.key).toBe('a')
    expect(pageFor(row, 'center-left')!.key).toBe('b')
    expect(pageFor(row, 'right')).toBeUndefined()
    const col = webPages({ right: null, center, split: 'col', focus: 0, live: false, last: null })
    expect(col.map((p) => p.page)).toEqual(['center-bottom', 'center-top'])
  })
  it('交给 AI 的那几行：page、在哪、网址，默认的标出来，看不见的写清楚', () => {
    const pages = webPages({ right: { ...right, shown: false }, center: [{ key: 't1', url: 'https://c.test/', title: '中间那页', pane: 0 }], split: null, focus: 0, live: true, last: null })
    expect(pagesSaid(pages)).toEqual(['- page=center：中间栏「中间那页」 https://c.test/  ← 默认（不给 page 就是它）', '- page=right：右栏（在 AI 后面，用户现在看不见） https://r.test/'])
  })
})

describe('web_press 的键（agent/web-keys.ts）', () => {
  it('几种写法认成同一个键：⌘A、Meta+A、Cmd+a；Shift+Tab；ArrowDown；Esc', () => {
    expect(parseKeys('⌘A')).toEqual({ key: 'A', mods: ['meta'] })
    expect(parseKeys('Meta+A')).toEqual({ key: 'A', mods: ['meta'] })
    expect(parseKeys('cmd+a')).toEqual({ key: 'A', mods: ['meta'] })
    expect(parseKeys('⌘⇧Z')).toEqual({ key: 'Z', mods: ['meta', 'shift'] })
    expect(parseKeys('Shift+Tab')).toEqual({ key: 'Tab', mods: ['shift'] })
    expect(parseKeys('ArrowDown')).toEqual({ key: 'Down', mods: [] })
    expect(parseKeys('Esc')).toEqual({ key: 'Escape', mods: [] })
    expect(parseKeys('F5')).toEqual({ key: 'F5', mods: [] })
    expect(parseKeys('Hyper+A')).toBeNull()
    expect(parseKeys('Enterr')).toBeNull()
  })
  it('写回 Mac 的符号（步骤行）：⌃⌥⇧⌘ 的顺序', () => {
    expect(keyName(parseKeys('Shift+Cmd+Z')!)).toBe('⇧⌘Z')
    expect(keyName(parseKeys('Enter')!)).toBe('↵')
    expect(keyName(parseKeys('ctrl+alt+Delete')!)).toBe('⌃⌥⌦')
  })
})

describe('网页工具（agent/tools.ts）', () => {
  const calls: [string, ...unknown[]][] = []
  const rec =
    (name: string, out: unknown = '好了') =>
    async (...a: unknown[]) => (calls.push([name, ...a]), out)
  const host = {
    web: {
      open: rec('open', { url: 'https://x.test/', title: '标题', where: '中间栏' }),
      read: rec('read', {
        url: 'https://x.test/',
        title: '表单',
        text: '正文',
        where: '右栏',
        selection: '',
        items: [
          { ref: 1, kind: 'select', text: '城市', value: '北京', options: ['北京', '上海'] },
          { ref: 2, kind: 'select', text: '标签', value: '', options: ['海边', '山里'], multiple: true },
          { ref: 3, kind: 'checkbox', text: '同意条款', checked: false },
          { ref: 4, kind: 'radio', text: '自取', checked: true, group: 'ship' },
          { ref: 5, kind: 'input', type: 'date', text: '出发日期', value: '2026-12-01' },
          { ref: 6, kind: 'file', text: '附件', risk: 'upload' },
          { ref: 7, kind: 'button', text: '登录', risk: 'login' },
          { ref: 8, kind: 'drag', text: '苹果' },
          { ref: 9, kind: 'button', text: '付款', risk: 'pay', disabled: true },
        ],
      }),
      click: rec('click', { ask: '这一下是登录，先问用户', label: '等你点头：点「登录」', risk: 'login' }),
      type: rec('type'),
      select: rec('select'),
      check: rec('check'),
      upload: rec('upload'),
      hover: rec('hover'),
      press: rec('press'),
      drag: rec('drag'),
      scroll: rec('scroll'),
      clip: rec('clip', '收件箱/x.md'),
    },
  } as unknown as ToolHost

  it('web_read 写出每一样的种类、值、选项、勾没勾、要先问的；读的是哪个网页', async () => {
    const r = await runTool('web_read', { page: 'right' }, host)
    expect(calls.pop()).toEqual(['read', { page: 'right' }])
    expect(r.text).toContain('哪个网页：右栏')
    expect(r.text.split('能点能填的：\n')[1]!.split('\n')).toEqual([
      '[1] 下拉框 城市：选着「北京」；选项：北京 / 上海',
      '[2] 下拉框 标签（能多选）：没选；选项：海边 / 山里',
      '[3] 勾选框 同意条款：没勾',
      '[4] 单选 自取（组 ship）：选着',
      '[5] 输入框 出发日期（date）：现在是「2026-12-01」',
      '[6] 上传文件 附件  ⚠ 点了会选文件上传，先问用户',
      '[7] 按钮 登录  ⚠ 点了会登录，先问用户',
      '[8] 能拖的 苹果',
      '[9] 按钮 付款（灰着）  ⚠ 点了会付款，先问用户',
    ])
  })

  it('要先问的那一下：步骤行换成「等你点头：…」（黄色问号，ask 带是哪一种，回答下面换成两颗按钮），回给 AI 的是先问的那句（不算出错）', async () => {
    const r = await runTool('web_click', { text: '登录' }, host)
    expect(r).toEqual({ text: '这一下是登录，先问用户', label: '等你点头：点「登录」', ask: 'login' })
    expect(calls.pop()).toEqual(['click', { ref: undefined, text: '登录' }, {}])
  })

  it('参数原样交下去：page 只认那几种，confirmed 只认 true；表单那几样按 label 找', async () => {
    await runTool('web_select', { label: '城市', option: '上海', page: 'center' }, host)
    expect(calls.pop()).toEqual(['select', { ref: undefined, text: '城市' }, '上海', { page: 'center' }])
    await runTool('web_select', { ref: 2, option: ['海边', '城里'], page: 'nowhere' }, host)
    expect(calls.pop()).toEqual(['select', { ref: 2, text: undefined }, ['海边', '城里'], {}])
    await runTool('web_check', { label: '同意', checked: false }, host)
    expect(calls.pop()).toEqual(['check', { ref: undefined, text: '同意' }, false, {}])
    await runTool('web_upload', { ref: 6, files: ['资料/a.pdf'], confirmed: true }, host)
    expect(calls.pop()).toEqual(['upload', { ref: 6, text: undefined }, ['资料/a.pdf'], { confirmed: true }])
    await runTool('web_press', { keys: 'Meta+A', times: 2, confirmed: 'yes' }, host)
    expect(calls.pop()).toEqual(['press', 'Meta+A', undefined, 2, {}])
    await runTool('web_drag', { from_text: '苹果', to_x: 10, to_y: 20 }, host)
    expect(calls.pop()).toEqual(['drag', { ref: undefined, text: '苹果' }, { ref: undefined, text: undefined, x: 10, y: 20 }, {}])
    await runTool('web_scroll', { text: '第九段' }, host)
    expect(calls.pop()).toEqual(['scroll', { ref: undefined, text: '第九段' }, {}])
    await runTool('web_scroll', { to: 'bottom', page: 'right' }, host)
    expect(calls.pop()).toEqual(['scroll', 'bottom', { page: 'right' }])
    await runTool('web_hover', { ref: 3 }, host)
    expect(calls.pop()).toEqual(['hover', { ref: 3, text: undefined }, {}])
    const opened = await runTool('web_open', { url: 'https://x.test/', page: 'center' }, host)
    expect(opened.text).toBe('打开了：标题（中间栏）\nhttps://x.test/')
  })

  it('勾选的步骤行照做了什么写：单选是「选上」，本来就是了写「本来就勾着」', async () => {
    const said = (out: string) => runTool('web_check', { label: 'x', checked: true }, { web: { check: async () => out } } as unknown as ToolHost)
    expect(await said('「自取」选上了')).toEqual({ text: '「自取」选上了', label: '选上「自取」' })
    expect(await said('「同意条款」本来就勾上了，没动')).toEqual({ text: '「同意条款」本来就勾上了，没动', label: '「同意条款」本来就勾着' })
    expect(await said('「同意条款」勾上了')).toEqual({ text: '「同意条款」勾上了' })
  })

  it('缺参数时说清楚', async () => {
    await expect(runTool('web_check', { label: '同意' }, host)).rejects.toThrow('缺参数 checked')
    await expect(runTool('web_select', { option: '上海' }, host)).rejects.toThrow('要给 ref 或 label')
    await expect(runTool('web_upload', { ref: 1, files: [] }, host)).rejects.toThrow('缺参数 files')
    await expect(runTool('web_drag', { to_ref: 1 }, host)).rejects.toThrow('要给 from_ref 或 from_text')
    await expect(runTool('web_scroll', { to: 'left' }, host)).rejects.toThrow('to 只能是')
  })

  it('步骤行的说法', () => {
    expect(toolLabel('web_select', { option: '上海' })).toBe('选「上海」')
    expect(toolLabel('web_check', { label: '同意条款', checked: true })).toBe('勾上「同意条款」')
    expect(toolLabel('web_check', { label: '订阅', checked: false })).toBe('去掉「订阅」的勾')
    expect(toolLabel('web_upload', { files: ['资料/行程单.txt', '/Users/x/护照.pdf'] })).toBe('上传 行程单.txt、护照.pdf')
    expect(toolLabel('web_hover', { text: '更多操作' })).toBe('移到「更多操作」上')
    expect(toolLabel('web_press', { keys: 'Meta+A' })).toBe('按 ⌘A')
    expect(toolLabel('web_press', { keys: 'Tab', times: 3 })).toBe('按 Tab ×3')
    expect(toolLabel('web_drag', { from_text: '香蕉', to_text: '回收站' })).toBe('拖「香蕉」到「回收站」')
    expect(toolLabel('web_drag', { from_ref: 4, to_x: 10, to_y: 20 })).toBe('拖「#4」到(10, 20)')
    expect(toolLabel('web_scroll', { text: '目标在这里' })).toBe('滚到「目标在这里」')
  })

  it('每个网页工具都能给 page（同一份 enum）', () => {
    const web = toolSpecs().filter((t) => t.name.startsWith('web_'))
    expect(web.map((t) => t.name)).toEqual(['web_open', 'web_read', 'web_click', 'web_type', 'web_select', 'web_check', 'web_upload', 'web_hover', 'web_press', 'web_drag', 'web_scroll', 'web_clip'])
    for (const t of web) expect((t.inputSchema.properties as Record<string, { enum?: string[] }>).page!.enum).toEqual(['right', 'center', 'center-left', 'center-right', 'center-top', 'center-bottom'])
  })
})
