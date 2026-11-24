/**
 * 和小样 proposals2/D-读书与AI入口/v2/review/proto-a.html 同一份书摘（微信读书同步来的写法）：
 * 第一条引文挂着微信读书的想法，第三条挂着我的评价，第二、四条什么都没挂。同步时间是今天 21:25
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const today = new Date()
const p2 = (x: number) => String(x).padStart(2, '0')
const STAMP = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())} 21:25`
export const BOOK = '趣说明朝276年（微信读书出品）'
export const Q = ['接到叔叔谋反的消息，朱瞻基立刻下令御驾亲征，大军行动神速，很快就到达了乐安城下。', '见面后，叔侄俩开聊，也不知是交谈不太愉快还是怎么地，朱高煦突然伸出一脚，把朱瞻基勾倒在地。', '莫名其妙地吃了个狗啃泥，再好脾气的人也得发飙，何况他还是个皇帝。', '永乐皇帝朱棣去世以后，他的大儿子朱高炽当了皇帝。']
/** 和小样同一份书摘（微信读书同步来的写法） */
export const DOC = [
  '---',
  '类型: 书摘',
  '作者: 关丁',
  '来源: https://weread.qq.com/web/reader/394323d0813ab8286g',
  '划线: 8',
  '想法: 1',
  'bookId: 3300064831',
  `updated: ${STAMP}`,
  '---',
  `# ${BOOK}`,
  '',
  '## 3 作死小能手朱高煦，千古难找第二个',
  '',
  `> ${Q[0]}`,
  '',
  '微信读书的想法：御驾亲征这一下，比朝堂上吵三个月都管用。',
  '',
  `> ${Q[1]}`,
  '',
  `> ${Q[2]}`,
  '',
  '我的评价：皇帝可以输道理，不能输面子。',
  '',
  '我自己的想法：这一家子打架都这么接地气',
  '',
  '## 4 来自亲爹的愤怒',
  '',
  `> ${Q[3]}`,
  '',
].join('\n')
export const PATH = `阅读/${BOOK}.md`

/** 天青（浅）/ 深湖（深）、浮岛书桌，和小样同一套 */
export function skinned(skin: 'sky' | 'petrol' | 'mint') {
  return (v: string) => {
    const ud = join(v, '..', 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
  }
}

