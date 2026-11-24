/** 梦游 Wiki 化的样本库（e2e/h7oy8-wiki.spec.ts、h7oy8-wiki-shots.spec.ts 共用）：两篇日记、解剖课、三分化计划、欧洲史第 1 天、两篇带 #地方/海德堡 的生活笔记 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DAY = '收件箱/2026-10-11.md'
export const TRIP = '收件箱/2026-10-18.md'
export const ANAT = '课程/解剖02-练胸.md'
export const PLAN = '剪藏/三分化训练计划.md'
export const EURO = '课程/欧洲史/Day-001.md'

export const WIKI_FILES: Record<string, string> = {
  [DAY]: '---\ntags: [日记]\n---\n# 2026-10-11\n\n- 训练：胸·三头——杠铃卧推 60kg×6×3、上斜哑铃卧推 26kg×8×3、双杠臂屈伸 自重×5、蝴蝶机夹胸 45kg。\n- 今天晚上去海德堡老城区玩了。\n',
  [TRIP]: '# 2026-10-18\n\n朋友来了，带他去海德堡老城区走了一圈，桥上人很多。\n',
  [ANAT]:
    '# 解剖02-练胸\n\n胸大肌分锁骨部和胸肋部，练法各不相同。\n\n## 八、动作评述③：杠铃卧推（多关节）\n\n杠铃卧推是胸肌的基础多关节动作，肩胛后缩下沉。\n\n## 九、动作评述④：双杠臂屈伸（多关节） 52:56\n\n双杠臂屈伸身体前倾练胸，直立练三头。\n\n第二段：退阶用辅助器械。\n',
  [PLAN]:
    '# 三分化训练计划\n\n新老派结合的增肌方案，一周三练。\n\n## 补充：胸肩三头技术详解\n\n- 上斜哑铃卧推（辅助）：角度三十度，握距略宽于肩，下落要慢。\n- 绳索下压：大臂夹紧，只动小臂。\n- 侧平举：肘略高于手腕。\n',
  [EURO]:
    '# Day-001 Geographic Skeleton\n\n## 3. 欧洲的地理骨架\n\n莱茵河从阿尔卑斯山流到北海，沿岸城市一个接一个。\n\n海德堡注脚：1689 年和 1693 年法军两次攻破这里，城堡残垣立在海德堡老城区上方。\n\n多瑙河向东流进黑海，是另一条大动脉。\n',
  '生活/搬家.md': '# 搬家\n\n#地方/海德堡 找房子太难了，海德堡的学生宿舍排队一年。\n',
  '生活/语言班.md': '# 语言班\n\n#地方/海德堡 语言班在老城旁边，每天走过海德堡的老桥。\n',
  // 同名的另一个东西（海德堡大学）：建词条页后链过去时，假 AI 判拿不准
  '生活/选课.md': '# 选课\n\n海德堡大学的选课系统很难用，第二周才选上。\n',
}

/** 只开补双链（Wiki 化在这一步里）；按意思找关着（向量那一路单元测试里测） */
export const onlyLinks = (vaultDir: string) => {
  const ud = join(dirname(vaultDir), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: { semantic: false }, dream: { steps: { file: false, rename: false, week: false, viz: false, attach: false, dup: false, video: false } } }))
}

