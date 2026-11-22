import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitStatus, launch, pane } from './app'

// 导图节点不截字（task-wuv05，偏好「导图节点不截字」）：节点按字变宽，到最宽 260 换行，整句看得见；
// 变宽、变高以后连线跟着、兄弟节点往下让，不重叠。用户截图里「1. 主题1」显示成「1. 主…」。

const SHOTS = process.env.CN_SHOTS_DIR
const PATH = '收件箱/导图 11-22 17∶51.md'
const MAP = [
  '---',
  'type: board',
  '白板样式: 导图',
  '类型: 导图',
  '---',
  '# 导图 11-22 17∶51',
  '',
  '- 中心主题',
  '  - 1. 主题1',
  '    - 1.1. 子主题',
  '    - 1.2. 子主题',
  '  - 2. 主题二：线性映射的核、像与秩-零化度定理之间的关系，以及它们在解线性方程组时怎么用',
  '    - 2.1. 子主题',
  '  - 3. Antidisestablishmentarianism-Supercalifragilisticexpialidocious',
  '    - 3.1. A very long English sentence that keeps going so it has to wrap onto more than one line',
  '  - 4. 很多层',
  '    - 4.1. 第二层',
  '      - 4.1.1. 第三层，这一层的字也写得很长很长，要换成两到三行才放得下，看连线接不接得上',
  '        - 4.1.1.1. 第四层',
  '          - 4.1.1.1.1. 第五层 deep node',
  '            - 4.1.1.1.1.1. 第六层：最后一层也写长一点，长到要换行',
  '  - 5. 拿不准的长节点：秩-零化渡定理和它的证明思路 <!-- unsure guesses="秩-零化度定理" -->',
  '    - 5.1. 短',
  '  - 6. 短',
  '',
].join('\n')

const MAX_W = 260
const board = (page: Page) => pane(page).getByTestId('board')

function skin(id: 'sky' | 'petrol') {
  return (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: id } }))
  }
}

/** 每个节点：字有没有被截、截没截出省略号、盒子多大；连线两头接没接上节点；节点两两重叠的 */
function inspect(page: Page) {
  return board(page).getByTestId('mindmap').evaluate((layer) => {
    const nodes = [...layer.querySelectorAll<HTMLElement>('.mm-node')].map((n) => {
      const t = n.querySelector<HTMLElement>('.t')!
      const cs = getComputedStyle(t)
      // 字真正画出来的范围（每一行一个框）要在节点盒子里面
      const range = document.createRange()
      range.selectNodeContents(t)
      const nr = n.getBoundingClientRect()
      const lines = [...range.getClientRects()]
      const inside = lines.every((r) => r.left >= nr.left - 0.5 && r.right <= nr.right + 0.5 && r.top >= nr.top - 0.5 && r.bottom <= nr.bottom + 0.5)
      return {
        text: t.textContent!,
        sw: t.scrollWidth,
        cw: t.clientWidth,
        sh: t.scrollHeight,
        ch: t.clientHeight,
        ellipsis: cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible' && t.scrollWidth > t.clientWidth,
        inside,
        lineTops: new Set(lines.map((r) => Math.round(r.top))).size,
        // 卡片样的节点（中心、第一层）字左右空得一样：换了行也按最长那一行定宽，右边不空出一截
        card: /\b(c|l1)\b/.test(n.className) && !n.classList.contains('unsure'),
        padL: Math.min(...lines.map((r) => r.left)) - nr.left,
        padR: nr.right - Math.max(...lines.map((r) => r.right)),
        x: parseFloat(n.style.left),
        y: parseFloat(n.style.top),
        w: parseFloat(n.style.width),
        h: parseFloat(n.style.height),
      }
    })
    const overlaps: string[] = []
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(`${a.text} ⨯ ${b.text}`)
      }
    const loose: string[] = []
    for (const p of layer.querySelectorAll('svg.mm-wires path')) {
      const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number)
      const [x1, y1] = nums
      const [x2, y2] = nums.slice(-2)
      const from = nodes.find((n) => Math.abs(n.x + n.w - x1!) < 0.5 && y1! >= n.y && y1! <= n.y + n.h)
      const to = nodes.find((n) => Math.abs(n.x - x2!) < 0.5 && y2! >= n.y && y2! <= n.y + n.h + 0.5)
      if (!from || !to) loose.push(p.getAttribute('d')!)
    }
    return { nodes, overlaps, loose }
  })
}

async function check(page: Page) {
  const r = await inspect(page)
  for (const n of r.nodes) {
    expect.soft(n.sw, `「${n.text}」横向被截`).toBeLessThanOrEqual(n.cw)
    expect.soft(n.sh, `「${n.text}」竖向被截`).toBeLessThanOrEqual(n.ch)
    expect.soft(n.ellipsis, `「${n.text}」出了省略号`).toBe(false)
    expect.soft(n.inside, `「${n.text}」字出了节点的框`).toBe(true)
    expect.soft(n.w, `「${n.text}」比最宽还宽`).toBeLessThanOrEqual(MAX_W)
    if (n.card) expect.soft(Math.abs(n.padR - n.padL), `「${n.text}」左右空得不一样（左 ${n.padL}、右 ${n.padR}）`).toBeLessThanOrEqual(2)
  }
  expect(r.overlaps).toEqual([])
  expect(r.loose).toEqual([])
  expect(test.info().errors).toEqual([])
  return r
}

for (const [id, name] of [['sky', '天青'], ['petrol', '深湖']] as const) {
  test(`导图节点按字变宽、到 ${MAX_W} 换行，不截字、不重叠、连线接得上（${name}）`, async () => {
    const run = await launch({ [PATH]: MAP }, { CN_AI_FAKE: '1' }, skin(id))
    const { page, vault } = run
    const read = () => readFileSync(join(vault, PATH), 'utf8')
    try {
      await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
      await expect(board(page).locator('.mm-node')).toHaveCount(17)
      await page.waitForTimeout(600)
      if (SHOTS) await board(page).screenshot({ path: join(SHOTS, `${name}-打开.png`) })

      const r = await check(page)
      const by = (t: string) => r.nodes.find((n) => n.text.startsWith(t))!
      // 用户截图里那个：一行放得下，整句都在
      expect(by('1. 主题1').lineTops).toBe(1)
      // 长中文、长英文单词、深层的长句：到最宽换成几行，节点跟着变高
      for (const t of ['2. 主题二', '3. Antidis', '3.1. A very', '4.1.1. 第三层', '4.1.1.1.1.1.', '5. 拿不准']) {
        expect(by(t).lineTops, t).toBeGreaterThan(1)
        expect(by(t).w, t).toBeGreaterThan(MAX_W - 40)
      }
      // 打开不写盘
      expect(read()).toBe(MAP)
      expect(gitStatus(vault)).toBe('')

      // 真改一个节点：双击，打一句长的，回车：写回只改这一行，排版跟着重排
      await board(page).locator('.mm-node', { hasText: /^1\. 主题1$/ }).dblclick()
      const long = '1. 主题1：改成一句很长很长的话，看它会不会跟着换行，下面的兄弟节点有没有往下让'
      await page.getByRole('textbox', { name: '节点的字' }).fill(long)
      await page.keyboard.press('Enter')
      await expect.poll(read).toBe(MAP.replace('  - 1. 主题1\n', `  - ${long}\n`))
      await page.waitForTimeout(300)
      const r2 = await check(page)
      expect(r2.nodes.find((n) => n.text === long)!.lineTops).toBeGreaterThan(1)
      if (SHOTS) await board(page).screenshot({ path: join(SHOTS, `${name}-改长以后.png`) })
    } finally {
      await run.close()
    }
  })
}
