// 真的让本机 Claude Code 给导入的旧笔记归类（要联网、花额度）：CN_REAL_DREAM=1 才跑。
// 一个临时库（已有几门课、项目、生活、写作）+ 40 条编出来的备忘录（课程、项目、日常、写作、读书、随手记混在一起），
// 走真的导入（读测试造的备忘录数据库、写进收件箱、一次提交）和真的梦游，按每条该去哪打分、量时间。
// 模型和软件里梦游用的一样（CN_AI_MODEL，默认 claude-opus-5-5）；CN_REAL_OUT=<文件> 把结果写成 JSON。
// CN_REAL_DREAM=1 npx vitest run apps/notes/test/real-import-dream.test.ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeNotesFolder, type FakeNote, type FakePara } from '../e2e/fixtures/apple-notes'

/** [原文件夹, 段落, 该去哪（几种都算对；'收件箱' = 拿不准留着也对）] */
type Case = [string, FakePara[], string[]]
const t = (text: string, style?: number): FakePara => ({ text, style })
const todo = (text: string, done = false): FakePara => ({ text, style: 103, done })
const img = (name: string): FakePara => ({ image: name, bytes: Buffer.from('fake-jpeg-' + name) })

const CASES: Case[] = [
  ['学习', [t('线代 第4讲 特征值', 0), t('特征值 λ 满足 det(A-λI)=0'), t('特征向量不唯一，可以乘常数'), img('IMG_2201.jpeg')], ['课程/线性代数']],
  ['学习', [t('Jordan 标准形 没懂的地方', 0), t('为什么不能对角化的矩阵也能写成 J？'), t('广义特征向量是啥')], ['课程/线性代数']],
  ['学习', [t('ECP 第2周 需求曲线', 0), t('需求曲线向下倾斜：价格越高需求量越低'), t('收入效应 + 替代效应')], ['课程/ECP']],
  ['学习', [t('ECP 作业3', 0), todo('读第5章', true), todo('做习题 5.2 5.4'), todo('周五前交到 Moodle'), { table: [['题', '状态'], ['5.2', '做完'], ['5.4', '没做']] }], ['课程/ECP']],
  ['学习', [t('贝叶斯公式 例题', 0), t('P(A|B) = P(B|A)P(A)/P(B)'), t('概率论第3讲，检测阳性但真患病的概率只有 9%')], ['课程/概率论']],
  ['学习', [t('期末复习计划', 0), todo('线代 第1到6讲'), todo('ECP 期中卷子再做一遍'), todo('概率论 例题')], ['课程/线性代数', '课程/ECP', '课程/概率论', '生活', '收件箱']],
  ['学习', [t('矩阵求逆的三种方法', 0), t('1. 伴随矩阵'), t('2. 初等行变换'), t('3. 分块')], ['课程/线性代数']],
  ['学习', [t('弹性 elasticity', 0), t('价格弹性 = 需求量变化率 / 价格变化率'), t('|E|>1 富有弹性')], ['课程/ECP']],
  ['工作', [t('毕设 开题报告提纲', 0), t('1 研究背景'), t('2 国内外现状'), t('3 方法'), t('4 进度安排')], ['项目/毕业设计']],
  ['工作', [t('11.2', 0), t('和王老师开会：数据集换成公开的那个，下周给第一版结果'), t('毕设的实验部分先做基线')], ['项目/毕业设计']],
  ['工作', [t('实验记录 第3次', 0), t('lr=1e-4 batch 32，准确率 81.2%'), t('比第2次高 2 个点，毕设表格里更新')], ['项目/毕业设计']],
  ['工作', [t('个人网站 待办', 0), todo('买域名', true), todo('Next.js 搭首页'), todo('放作品集')], ['项目/个人网站']],
  ['工作', [t('网站配色', 0), t('主色深蓝 #1F3A5F，强调色橙'), t('参考 linear.app 的留白'), img('截图 2023-05-02.png')], ['项目/个人网站']],
  ['工作', [t('简历要改的地方', 0), t('项目经历写成果不写过程'), t('一页以内')], ['生活', '项目/求职', '项目/简历', '项目/找工作', '收件箱']],
  ['生活', [t('超市', 0), todo('牛奶'), todo('鸡蛋', true), todo('洗衣液')], ['生活']],
  ['生活', [t('10月房租水电', 0), t('房租 3200，水 46，电 128，已转给房东')], ['生活']],
  ['生活', [t('体检预约', 0), t('11月20日 上午 8:30 空腹，社区医院二楼')], ['生活']],
  ['生活', [t('周末去花市', 0), t('买绣球，看看多肉，顺便买花盆')], ['生活']],
  ['生活', [t('妈妈生日礼物', 0), t('围巾？按摩仪？问问姐姐')], ['生活']],
  ['生活', [t('健身', 0), t('周一三五 跑步 5km，周二四 力量')], ['生活']],
  ['生活', [t('WiFi 和门禁', 0), t('WiFi: home-5G / 门禁 #2580')], ['生活']],
  ['读书', [t('《思考，快与慢》摘抄', 0), { text: '“我们对自己认为熟知的事情确信无疑，却看不清自己的无知。”', quote: true }, t('系统1 快、系统2 慢')], ['素材/*']],
  ['读书', [t('穷查理宝典', 0), { text: '反过来想，总是反过来想。', quote: true }, { text: '如果我知道我会死在哪里，我就永远不去那个地方。', quote: true }], ['素材/*']],
  ['读书', [t('读人类简史', 0), t('农业革命让人更辛苦了——这个说法我不太同意，至少……'), t('想写一篇读后感')], ['素材/*', '写作']],
  ['写作灵感', [t('小说开头', 0), t('那年冬天，镇上最后一家书店关门的那天，下了第一场雪。')], ['写作']],
  ['写作灵感', [t('慢下来 随笔 草稿', 0), t('我们总在赶路，地铁上刷手机、吃饭时回消息……'), t('（还没写完）')], ['写作']],
  ['写作灵感', [t('公众号选题', 0), t('- 学线代的三个误区'), t('- 一个人做饭的一周'), t('- 读书笔记怎么记')], ['写作']],
  ['随手记', [t('冰岛 极光', 0), t('9 月底到 3 月能看到，KP 指数 3 以上；冰洞只在冬天开放')], ['素材/旅行', '生活']],
  ['随手记', [t('docker', 0), t('docker ps -a'), t('docker compose up -d'), t('docker system prune')], ['素材/*', '项目/个人网站', '项目/毕业设计', '收件箱']],
  ['随手记', [t('快递', 0), t('顺丰 SF1234567890 买的显示器')], ['生活', '收件箱']],
  ['随手记', [t('好句子', 0), t('“世上只有一种英雄主义，就是在认清生活真相之后依然热爱生活。”')], ['写作', '素材/*']],
  ['随手记', [t('想看的电影', 0), todo('奥本海默'), todo('坠落的审判', true), todo('海边的曼彻斯特')], ['生活', '素材/*']],
  ['随手记', [t('线代小测', 0), t('老师说下周二小测，考第3、4讲')], ['课程/线性代数']],
  ['随手记', [t('1', 0)], ['收件箱', '生活']],
  ['随手记', [t('随便记一下', 0), t('ok')], ['收件箱', '生活']],
  ['Notes', [t('巴黎 博物馆', 0), t('卢浮宫要提前在官网预约，周二闭馆；奥赛周一闭馆')], ['素材/旅行', '生活']],
  ['Notes', [t('presentation 分工', 0), t('ECP 小组展示：我做市场结构那部分，小李做数据')], ['课程/ECP']],
  ['Notes', [t('参考文献', 0), t('[1] Vaswani et al. Attention is all you need'), t('毕设第二章要引')], ['项目/毕业设计']],
  ['Notes', [t('番茄炒蛋', 0), t('先炒蛋盛出，再炒番茄加糖，最后合一起'), img('IMG_3310.jpeg')], ['生活', '素材/*']],
  ['Notes', [t('新备忘录', 0), t('车位 B2-118')], ['生活', '收件箱']],
]

const EXISTING: Record<string, string> = {
  '课程/线性代数/第1讲 线性映射.md': '---\n类型: 笔记\n课程: 线性代数\n第几讲: 1\n---\n# 第1讲 线性映射\n\n线性映射的定义、核与像。\n',
  '课程/线性代数/第3讲 线性映射 导图.md': '---\n类型: 导图\n课程: 线性代数\n第几讲: 3\n---\n- 线性映射\n',
  '课程/ECP/第1周 导论.md': '---\n类型: 笔记\n课程: ECP\n---\n# 第1周 导论\n\nEconomics: Concepts and Principles。\n',
  '项目/毕业设计/进度.md': '# 进度\n\n- 10 月：开题\n',
  '生活/旅行清单.md': '# 旅行清单\n',
  '写作/草稿 一个人的城市.md': '---\ndraft: true\n---\n# 一个人的城市\n',
  '素材/旅行/冰洞.md': '> 冰洞只在冬天开放\n—— [Ice caves](https://www.safetravel.is/ice-caves)\n',
}

const inFolder = (path: string) => path.split('/').slice(0, -1).join('/')
const ok = (want: string[], got: string) => want.some((w) => (w.endsWith('/*') ? got.startsWith(w.slice(0, -1)) : got === w))

describe.skipIf(!process.env.CN_REAL_DREAM)('真的梦游：导入的 40 条旧笔记归类', () => {
  it('分到对的地方，量时间', async () => {
    const { claudeEngine, CLAUDE_MODEL } = await import('../src/main/agent/engines')
    const { NoteStore } = await import('../src/main/import/apple-notes')
    const { writeImport } = await import('../src/main/import/write')
    const { runDream } = await import('../src/main/dream')
    const root = mkdtempSync(join(tmpdir(), 'cn-real-dream-'))
    const vault = join(root, '库')
    const g = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' })
    mkdirSync(vault)
    g('init', '-q', '-b', 'main')
    g('config', 'user.name', 'T')
    g('config', 'user.email', 't@e.x')
    // CN_REAL_EMPTY=1：从空库开始（用户「从头开始」的样子），课程、项目的名字由 AI 自己起，打分只看大类
    const empty = !!process.env.CN_REAL_EMPTY
    for (const [p, s] of Object.entries(empty ? { 'README.md': '# 我的库\n' } : EXISTING)) {
      mkdirSync(dirname(join(vault, p)), { recursive: true })
      writeFileSync(join(vault, p), s)
    }
    g('add', '-A')
    g('commit', '-q', '-m', '已有的')

    // 1. 导入
    const data = join(root, 'group.com.apple.notes')
    const folders = [...new Set(CASES.map((c) => c[0]))].map((name) => ({ name }))
    const day = (i: number) => new Date(Date.UTC(2023, 0, 1 + i * 9, 2, 30))
    fakeNotesFolder(data, folders, CASES.map(([folder, paras], i): FakeNote => ({ folder, paras, created: day(i), modified: day(i + 1) })))
    const store = new NoteStore(data)
    const fs = store.folders()
    const rows = store.noteRows(fs.map((f) => f.id))
    const notes = rows.map((r) => store.read(r, fs.find((f) => f.id === String(r.folder))!.path, '备忘录'))
    store.close()
    const w = await writeImport({ root: vault, source: '备忘录', notes, message: '导入旧笔记' })
    expect(w.paths.filter((p) => p.endsWith('.md'))).toHaveLength(CASES.length)
    /** 收件箱里的路径 → 该去哪 */
    const want = new Map(rows.map((r, i) => [w.paths.filter((p) => p.endsWith('.md'))[i]!, CASES.find((c) => c[1][0] && 'text' in c[1][0] && c[1][0].text === r.title)![2]]))

    // 2. 梦游（真的 AI）
    const model = CLAUDE_MODEL
    const asks: number[] = []
    const ask = async (system: string, prompt: string) => {
      const t0 = Date.now()
      const r = await claudeEngine().run({ prompt, system, cwd: vault, signal: AbortSignal.timeout(10 * 60_000), onText: () => {}, model })
      asks.push(Date.now() - t0)
      return r.text
    }
    const t0 = Date.now()
    const report = await runDream({ root: vault, scratch: join(root, 'scratch'), ask, trigger: 'manual' })
    const total = Date.now() - t0

    // 3. 打分
    const moved = new Map(report.items.filter((i) => i.move).map((i) => [i.move!.from, i]))
    const rowsOut = [...want].map(([from, w]) => {
      const it = moved.get(from)
      const to = it ? inFolder(it.move!.to) : '收件箱'
      const loose = empty ? w.map((x) => x.replace(/^(课程|项目)\/.+$/, '$1/*')) : w
      return { from: from.replace('收件箱/导入/备忘录/', ''), to, name: it ? it.title : null, why: it?.why ?? '', want: loose, ok: ok(loose, to) }
    })
    const right = rowsOut.filter((r) => r.ok).length
    const stayed = rowsOut.filter((r) => r.to === '收件箱').length
    const out = { model, notes: CASES.length, right, stayed, wrong: rowsOut.filter((r) => !r.ok), totalSec: total / 1000, askSec: asks.map((a) => a / 1000), dreamNotes: report.notes, rows: rowsOut }
    console.log(JSON.stringify(out, null, 1))
    if (process.env.CN_REAL_OUT) writeFileSync(process.env.CN_REAL_OUT, JSON.stringify(out, null, 1))
    expect(right).toBeGreaterThanOrEqual(CASES.length * 0.8)
  }, 30 * 60_000)
})
