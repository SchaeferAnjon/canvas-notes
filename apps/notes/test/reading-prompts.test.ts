import { formulaImagesNote, type PdfBlock } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { askPrompt, fullTextOf, noteDigest, sidePrompt, TUTOR_SYSTEM, TUTOR_VERSION } from '../src/main/reading/prompts'
import { AGENT_SYSTEM, AGENT_VERSION, langTail, modeLine, MODES_RULE } from '../src/main/agent/index'
import { system as commandSystem } from '../src/renderer/ai-commands'
import { setUiLang } from '../src/shared/i18n'
import { MATH_RULE, PRE_MARK, type ReadingMsg, type ReadingThread, readLine, VIZ_MARK } from '../src/shared/reading'

const thread: ReadingThread = { id: '.canvas-notes/对话/L3-p5-1.md', page: 5, rect: [0.1, 0.2, 0.3, 0.4], crop: '附件/L3/p5-1.png', createdAt: 0 }
let n = 0
const u = (text: string): ReadingMsg => ({ id: n++, role: 'user', thread: thread.id, text, time: 0 })
const a = (text: string): ReadingMsg => ({ id: n++, role: 'ai', thread: thread.id, text, time: 0 })
const blocks: PdfBlock[] = [
  { id: 'p5-b1', page: 5, kind: 'heading', text: 'Example 3.4 Rotation', x: 0, y: 0, w: 1, h: 1 },
  { id: 'p5-b2', page: 5, kind: 'image', text: '', x: 0, y: 0, w: 1, h: 1 },
  { id: 'p5-b3', page: 5, kind: 'text', text: 'Rotate the plane.', x: 0, y: 0, w: 1, h: 1 },
]

describe('问 AI 的话', () => {
  it('第一次带全文、笔记里懂了的、这一页的字和框的说明', () => {
    const p = askPrompt({ pdfName: '第3讲', page: 5, pages: 10, pageText: 'Rotate', question: '给我讲解一下', thread, fullText: '--- 第 1 页 ---\nHi\n', digest: '- 第 4 页「列」：…', hasImage: true })
    expect(p).toContain('<pdf>\n--- 第 1 页 ---\nHi\n\n</pdf>')
    expect(p).toContain('他笔记里已经弄懂的：\n- 第 4 页「列」：…')
    expect(p).toContain('他现在在看第 5 页（共 10 页）')
    expect(p).toContain('他在这一页上框了一块，就是附上的图。\n他说：给我讲解一下')
  })
  it('全文还在读：说一声；整页问、选字问、追问说法不一样', () => {
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: '', question: 'q', thread: { ...thread, rect: undefined }, fullPending: true, digest: '', hasImage: true })).toMatch(
      /还在读[\s\S]*没有能选的字[\s\S]*附上的图是整页/,
    )
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: 't', question: 'q', thread: { ...thread, quote: '一段字' }, digest: '', hasImage: false })).toContain('他选中了这段字：「一段字」')
    expect(askPrompt({ pdfName: 'x', page: 1, pages: 2, pageText: 't', question: 'q', thread, digest: '', hasImage: false })).toContain('接着刚才那处在追问')
  })
  it('全文按页写，太长截断', () => {
    const pages = [[blocks[0]!], [{ ...blocks[2]!, page: 6 }]]
    expect(fullTextOf(pages)).toBe('--- 第 5 页 ---\n# Example 3.4 Rotation\n--- 第 6 页 ---\nRotate the plane.\n')
    expect(fullTextOf(pages, 40)).toContain('后面的页太长')
  })
  it('视频问答块「接着问」：说附的图是那一帧，带上那一问、当时的回答和前后字幕', () => {
    const t: ReadingThread = { id: 'x', page: 0, quote: '框里这两个箭头为什么能决定整个网格怎么动？', web: { url: 'https://www.youtube.com/watch?v=abc', title: '线性变换', t: 6, answer: '框里是 i 帽和 j 帽变换后的位置。' }, createdAt: 0 }
    const p = askPrompt({ pdfName: '线性变换', page: 0, pages: 0, pageText: '', question: '那第三个箭头呢', thread: t, web: t.web!, subs: '00:05 the basis vectors', digest: '', hasImage: true })
    expect(p).toContain('在 00:06 那一帧框了一块问过：「框里这两个箭头为什么能决定整个网格怎么动？」')
    expect(p).toContain('附上的图是 00:06 那一帧')
    expect(p).toContain('<answer>\n框里是 i 帽和 j 帽变换后的位置。\n</answer>')
    expect(p).toContain('<subs>\n00:05 the basis vectors\n</subs>')
    expect(p.endsWith('他说：那第三个箭头呢')).toBe(true)
  })
  it('笔记摘要一段一行：新格式用每轮小结，以前的笔记用讲通的讲法', () => {
    const old = { id: 'x', file: 'a.pdf', page: 4, title: '列', good: '列就是\n基向量去哪', figures: [], doubts: [], points: [], failed: [], rounds: 1, links: [] }
    const doc = { ...old, id: 'y', page: 5, title: '旋转', good: '回答开头', qas: [{ q: '给我讲解一下', a: '回答开头', sides: [] }], recap: '转一个角度：列是基向量转完的位置。' }
    expect(noteDigest([old, doc])).toBe('- 第 4 页「列」：列就是 基向量去哪\n- 第 5 页「旋转」：转一个角度：列是基向量转完的位置。')
  })
  it('旁支的第一问：告诉 AI 被问的那句和它所在的那一轮；接着问的只说接着这条旁支', () => {
    const first = sidePrompt({ first: true, quote: '水位一到门槛就发一个 spike', page: 28, title: 'LIF 神经元', ask: '给我讲解一下', question: '为什么减掉门槛？' })
    expect(first).toContain('这是一条旁支')
    expect(first).toContain('那一轮在第 28 页「LIF 神经元」，他问的是：给我讲解一下')
    expect(first).toContain('他选中的那句：「水位一到门槛就发一个 spike」')
    expect(first.endsWith('他说：为什么减掉门槛？')).toBe(true)
    const more = sidePrompt({ first: false, quote: '水位一到门槛就发一个 spike', page: 28, question: '那门槛是多少？' })
    expect(more).toBe('（接着这条旁支问，问的还是「水位一到门槛就发一个 spike」这句。）\n他说：那门槛是多少？')
  })
})

describe('AI 看得到公式（2026-11-24）', () => {
  const thread: ReadingThread = { id: 'x', page: 3, createdAt: 0 }
  it('带了公式截图：这一页的字后面说附图第几张是哪个公式、以图为准；没带不说', () => {
    const note = formulaImagesNote(1, ['第 3 页公式 (1)'])
    const p = askPrompt({ pdfName: 'x', page: 3, pages: 7, pageText: 'αij = exp LeakyReLU a [W h ∥ W h ] (1)', question: '公式 (1) 是什么', thread, digest: '', hasImage: false, formulaNote: note })
    expect(p).toContain('</page>\n\n附图第 1 张依次是原文公式的截图：第 3 页公式 (1)。')
    expect(p).toContain('以这几张图为准')
    expect(p.indexOf('附图第 1 张')).toBeLessThan(p.indexOf('他说：公式 (1) 是什么'))
    expect(askPrompt({ pdfName: 'x', page: 3, pages: 7, pageText: 't', question: 'q', thread, digest: '', hasImage: false })).not.toContain('原文公式的截图')
  })
})

describe('回答上面那一行', () => {
  it('提到的别的页笔记里弄懂过，就说用到了；没弄懂过的、这一页自己不算', () => {
    const sec = (page: number) => ({ id: String(page), file: 'a.pdf', page, title: '', good: '', figures: [], doubts: [], points: [], failed: [], rounds: 1, links: [] })
    expect(readLine(5, '用你在 [第 4 页](#page=4) 弄懂的，再看 [第 7 页](#page=7) 和 [第 5 页](#page=5)', [sec(4), sec(5)])).toBe('读了第5页 · 用到第4页你弄懂的那条')
    expect(readLine(5, '没提别的页', [sec(4)])).toBe('读了第5页')
  })
})

describe('CN-89 讲透：读 PDF 的讲法', () => {
  it('附在 Claude Code 自己的系统提示后面的那几条：notes.md 给的四行原样在前，去掉「300 字以内」「不要 LaTeX」，留着笔记里弄懂的直接用、还是不懂换角度、可视化标记', () => {
    const lines = TUTOR_SYSTEM.split('\n')
    expect(lines.slice(0, 4)).toEqual([
      '你在 Canvas Notes 里陪一个人读 PDF 课件。他在 PDF 上框一块、或在你的回答里选一句来问你。',
      '把这件事真讲明白：先一句话说清它是什么，再按一条线讲下去：为什么要有它、每一项在干什么、拿一个具体数字或例子走一遍。需要时用小标题和列表。',
      '长短看问题：整块的「讲解一下」要讲透，不怕长；旁支里的小追问简短回答。',
      // task-3e53q：页码一律写成链接（章节地图、第二次提到、「下一页」也写），真对话里没链的就是这几种
      `${MATH_RULE}提到这份 PDF 的别的页一律写成链接：[第 4 页](#page=4)；页码范围写 [第 1–2 页](#page=1)，开头的章节地图、列表里的每一项、长讲解里第二次提到同一页、「对照第 4 页的表 II」这种带尾巴的、「下一页」「上一页」这种说法（写成 [下一页](#page=5)）都要写成链接。`,
    ])
    // 例句也带链接（以前不带链接的「用你在第 4 页弄懂的那条」AI 照抄了 3 次）
    expect(TUTOR_SYSTEM).toContain('「用你在 [第 4 页](#page=4) 弄懂的那条」')
    expect(TUTOR_SYSTEM).not.toMatch(/300 字|不要 LaTeX|Unicode/)
    expect(TUTOR_SYSTEM).toContain('他笔记里已经弄懂的（每次会附上），直接拿来用')
    expect(TUTOR_SYSTEM).toContain('「还是不懂」「换个方式讲」')
    expect(TUTOR_SYSTEM).toContain(`单独一行写 ${VIZ_MARK}`)
    // 框了图的那一问照旧让 AI 写配图的框（在每一问的话里）
    expect(askPrompt({ pdfName: 'L3', page: 5, pages: 10, pageText: '字', question: '给我讲解一下', thread, digest: '', hasImage: true })).toContain('〔配图 左,上,宽,高')
  })
})

describe('公式的写法（真 AI 写了 `$dV/dt = $ 输入`，$ 里头结尾留了空格，渲染不认，原样露着；渲染规则不放宽，钱数「$5 和 $6」会误判）', () => {
  it('发给 AI 的提示词里写明：行内 $…$、$ 里面紧贴公式不留空格，单独一行 $$…$$；读 PDF、AI 对话、/ 命令三处都有', () => {
    expect(MATH_RULE).toContain('行内写 $…$')
    expect(MATH_RULE).toContain('开头结尾都不留空格')
    expect(MATH_RULE).toContain('不写 $ dV/dt $ 或 $dV/dt = $')
    expect(MATH_RULE).toContain('单独一行的写 $$…$$')
    for (const p of [TUTOR_SYSTEM, AGENT_SYSTEM, commandSystem()]) expect(p).toContain(MATH_RULE)
    // 讲法改了：旧会话不再接着用记下的旧系统提示（4：能动手、两种模式；5：库里的东西写成链接，task-3e53q；6：页码链接带引的那句原文；7：前置知识标记）
    expect(TUTOR_VERSION).toBe(8)
    // 前置知识标签：讲论文外的基础知识时回答末尾单独一行〔前置知识〕
    expect(TUTOR_SYSTEM).toContain('在回答最后单独一行写 〔前置知识〕')
    // 页码链接跳到段：说某一段时链接接 &text=原文开头几个词，抄原文不抄译文
    expect(TUTOR_SYSTEM).toContain('[第 2 页](#page=2&text=We%20additionally%20extract%20a%20static%20feature%20stream)')
    expect(TUTOR_SYSTEM).toContain('照 PDF 原文的语言一字不改地抄（不是你的译文）')
  })
})

describe('两种模式怎么告诉 AI（2026-11-19，全能模式默认开）', () => {
  it('AI 对话、读 PDF 的系统提示都写着两种模式各能做什么、以每条消息开头的【模式】为准；做不了时让用户打开「全能模式」，不再建议改命令行的权限设置', () => {
    for (const p of [AGENT_SYSTEM, TUTOR_SYSTEM]) expect(p).toContain(MODES_RULE)
    expect(MODES_RULE).toContain('以它为准')
    expect(MODES_RULE).toContain('请用户在 AI 输入框下面打开「全能模式」再说一次')
    expect(MODES_RULE).toContain('不要建议用户去改 Claude Code、Codex 这些命令行的权限或设置文件')
    // 以前那句「不要自己写文件、不要跑命令」不在了（全能模式下能）
    expect(AGENT_SYSTEM).not.toContain('不要自己写文件')
    // 笔记和文件夹那组工具写进去了
    expect(AGENT_SYSTEM).toContain('note_*、folder_create')
    expect(TUTOR_SYSTEM).toContain('新建、改写、改名、挪动、删笔记')
    // 往笔记里新加的段落写成 [!ai] 块，头一行照每条消息开头的【AI 块】（task-dtc34）
    expect(AGENT_SYSTEM).toContain('一律写成 AI 块')
    // 系统提示改了：AI 对话的旧会话不再接着用（3：改了开着的文件编辑器当场换，2026-11-21；4：回答的语言照每条消息开头的【语言】，task-zojmg；5：AI 块，task-dtc34；6：库里的东西写成链接，task-3e53q；7：前置知识标记，功能小三件）
    expect(AGENT_VERSION).toBe(7)
    // 网页、视频、文档的问答也标前置知识（回答末尾〔前置知识〕，记进笔记那一问带 #前置知识）
    expect(AGENT_SYSTEM).toContain(PRE_MARK)
  })

  it('AI 改了开着的文件：系统提示说清编辑器当场换成新内容、用户正在打的字合并进来，不叫用户关掉标签再打开（2026-11-21 task-wnbi1）', () => {
    expect(AGENT_SYSTEM).toContain('开着的编辑器当场换成新内容')
    expect(AGENT_SYSTEM).toContain('不用叫用户关掉标签再打开')
  })

  it('每条消息开头的【模式】：开着说能做什么、工作目录是库；关着说做不了什么、怎么打开', () => {
    const on = modeLine(true, 'claude', '/库')
    expect(on.split('\n')[0]).toBe('【模式】全能模式开着：和在终端里用 Claude Code 一样，能读写这台 Mac 上的文件、跑命令、上网、开子 Agent，不用先问；工作目录是库（/库）。')
    const off = modeLine(false, 'codex', '/库')
    expect(off).toContain('【模式】全能模式关着：只在库里动手')
    expect(off).toContain('在 AI 输入框下面打开「全能模式」')
    expect(modeLine(true, 'codex', '/库')).toContain('和在终端里用 Codex 一样')
  })

  it('回答用什么语言（task-zojmg）：默认跟界面语言，用别的语言问就跟着问的语言；写在每条消息开头的【语言】，系统提示里不再写死「用中文回答」', () => {
    expect(AGENT_SYSTEM).not.toContain('用中文回答，平实')
    expect(AGENT_SYSTEM).toContain('照每条消息开头的【语言】')
    // 命令没有用户自己的话：照界面语言，中文界面和以前一字不差
    expect(commandSystem()).toContain('\n用中文回答；平实、直接')
    expect(modeLine(false, 'claude', '/库').split('\n')[1]).toBe('【语言】用中文回答。')
    expect(modeLine(false, 'claude', '/库', 'What is two plus three?').split('\n')[1]).toBe('【语言】Answer in the language the user’s own words are written in (most likely English).')
    setUiLang('en')
    try {
      expect(modeLine(false, 'claude', '/库', '123').split('\n')[1]).toBe('【语言】Answer in English.')
      expect(modeLine(false, 'claude', '/库', '二加三等于几？一句话回答。').split('\n')[1]).toBe('【语言】用中文回答。')
      expect(commandSystem()).toContain('\nAnswer in English；平实、直接')
    } finally {
      setUiLang('zh')
    }
  })

  it('消息最后再写一遍【语言】（task-zojmg：只写在开头时，真 Claude 在英文界面 9 次里有 1 次照样用中文答「123」）', () => {
    expect(langTail('What is two plus three?')).toBe('\n\n【语言】Answer in the language the user’s own words are written in (most likely English).')
    setUiLang('en')
    try {
      expect(langTail('123')).toBe('\n\n【语言】Answer in English.')
      expect(langTail('二加三等于几？')).toBe('\n\n【语言】用中文回答。')
    } finally {
      setUiLang('zh')
    }
  })
})
