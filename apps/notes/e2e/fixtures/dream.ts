import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 梦游用的样本库：两篇作品、收件箱三条（一条和作品讲同一件事、一条和素材重复）、素材一篇 */
export const DREAM_VAULT: Record<string, string> = {
  '所思所想.md': '# 所思所想\n\nSeek wealth, not money or status.\n',
  '极光预报.md': '# 极光预报\n\n每天下午看冰岛气象局的云量图，云量低于三成、KP 指数到 3 以上就开车去黑沙滩等。\n',
  '收件箱/极光.md': '---\ncreated: 2026-11-14 21:20\n---\n极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。维克附近光污染少。\n',
  '收件箱/冰洞.md': '---\ncreated: 2026-11-14 21:10\n---\n冰洞只在冬天开放，必须跟导游进去，提前两周订。\n',
  '收件箱/巴黎自由行全景指南.md':
    '# 巴黎自由行全景指南\n\n第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。\n第二天去卢浮宫，留一整天。\n',
  '素材/巴黎/巴黎深度漫游指南.md':
    '# 巴黎深度漫游指南（上）\n\n第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。\n晚上去圣日耳曼的小酒馆吃饭。\n',
}

/** 用户自己写的作品（不在 收件箱/ 素材/ 周记/ 里）每个文件的哈希 */
export function worksHash(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const rel = p.slice(root.length + 1)
        if (!/^(收件箱|素材|周记)\//.test(rel)) out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex')
      }
    }
  }
  walk(root)
  return out
}
