/**
 * 梦游「补双链」「可能重复」的标注样例（task-eler2）。文字全是合成的，照用户库里出过错的几种情况造，不抄任何人的笔记。
 *
 * 起因：0.5.1 给《中国用户怎么用上 Claude》的视频字幕补了 [[Geography of Iceland]]，理由是「两篇都讲到『the second』」；
 * 另外两条「第三方 ↔ 未命名」「特朗普… ↔ 第三方」也是只靠一个常见词连上的。
 *
 * 库里的笔记都放在梦游会补双链的文件夹（收件箱/、剪藏/、阅读/），只有「极光预报」是自己写的作品（只当被链的那头）。
 * links：该连 / 不该连；dups：重复 / 不重复。两篇之间不论哪头链哪头都算连上了。
 * 方案那一路（梦游底层方案）拿这份当评测底子：加样例往这里加，标注写清楚为什么。
 */

export interface Labeled {
  a: string
  b: string
  /** true 该连（或该算重复），false 不该 */
  yes: boolean
  why: string
}

const CLAUDE_VIDEO = `---
source: https://www.youtube.com/watch?v=synthetic-claude-cn
created: 2026-11-20 21:00
---
# 中国用户怎么用上 Claude

视频 · youtube.com · 剪于 11-20 21:00

## 字幕原文

00:05 这一期聊一个很多人私信问的问题：在国内到底怎么稳定地用上 Claude。
In this episode, let's talk about how people in mainland China actually manage to use Claude.

00:14 先说背景，Anthropic 从来没有对中国大陆开放服务。
First, some background: Anthropic has never offered its service in mainland China.

00:22 到了 the second half of last year，限制又收紧了一轮，连中资控股的公司也不让用。
In the second half of last year, the rules got tighter again, and companies controlled from China were cut off too.

00:35 大家想出来的办法大概有三类。第一类是网络，换一个干净的海外节点。
The workarounds fall into roughly three groups. The first was the network: finding a clean overseas exit node.

00:48 The second was phone numbers，注册要一个能收验证码的海外手机号，很多人去买接码平台的号。
The second was phone numbers: signing up needs an overseas number that can receive a code, so many people buy numbers from SMS services.

01:02 第三类是付款，Claude Pro 要海外信用卡，于是虚拟信用卡和代充一下子火了起来。
The third was payment: Claude Pro needs a foreign card, so virtual cards and top-up resellers suddenly became popular.

01:15 还有人干脆不注册账号，走 API 中转站，按量付钱，好处是不怕封号。
Others skip the account entirely and go through API relay sites, paying per use, so a ban does not matter.

01:30 封号是绕不开的话题，IP 一跳动、付款地址对不上，账号第二天就没了。
Account bans are unavoidable: if the IP jumps around or the billing address does not match, the account is gone the next day.

01:44 我自己被封过两次，申诉邮件写了一大段，最后只退了当月的订阅费。
I was banned twice myself; I wrote a long appeal and only got that month's subscription refunded.

02:01 所以我的建议是：长期用的话，固定一个地区、固定一张卡、别多人共用账号。
So my advice: if you use it long term, stick to one region, one card, and never share an account.

02:15 最后留个问题：Anthropic 这样封锁，到底是在关门，还是在等一个更好的价钱？
One last question: is Anthropic closing the door with this block, or waiting for a better price?

02:24 欢迎在评论区说说你的看法。
Feel free to share your view in the comments.
`

const ICELAND = `---
source: https://example.org/geography-of-iceland
---
# Geography of Iceland

Iceland is an island country in the North Atlantic Ocean, lying just south of the Arctic Circle. It is the second-largest island in Europe after Great Britain, and most of its people live along the coast because the interior is a high plateau of lava fields, sand and glaciers.

The island sits on the Mid-Atlantic Ridge, where the North American and Eurasian plates pull apart. This is why Iceland has so many volcanoes, hot springs and geysers. Hekla and Katla are among the most active volcanoes, and the eruption of Eyjafjallajökull in 2010 stopped air traffic across Europe for days.

Glaciers cover about a tenth of the land. Vatnajökull is the largest ice cap in Europe by volume. Meltwater feeds fast glacial rivers, and the country has many waterfalls: Dettifoss is the most powerful, and Glymur was long thought to be the second-tallest waterfall in the country. Gullfoss, on the Hvítá river, is often called the second-largest waterfall by visitor numbers.

The coastline is cut by deep fjords, especially in the Westfjords and the East. The climate is subarctic and oceanic: the Gulf Stream keeps winters milder than the latitude suggests, but the weather changes quickly and strong winds are common.

Reykjavík, the capital, is the northernmost capital of a sovereign state. Geothermal energy heats almost every house in the country, and hydropower supplies most of the electricity.
`

const PHYSICAL_GEO = `---
source: https://example.org/geography-of-iceland#physical
---
# Physical geography

The island sits on the Mid-Atlantic Ridge, where the North American and Eurasian plates pull apart. This is why Iceland has so many volcanoes, hot springs and geysers. Hekla and Katla are among the most active volcanoes, and the eruption of Eyjafjallajökull in 2010 stopped air traffic across Europe for days.

Glaciers cover about a tenth of the land. Vatnajökull is the largest ice cap in Europe by volume.
`

const TTRAVEL = `# ttravel

Packing list for the long weekend: rain jacket, wool socks, the second pair of shoes, charger, passport. Book the airport bus the night before. Most of the time the hotel has a kettle, so bring tea.
`

const CLAUDE_BAN = `---
created: 2026-11-19 23:10
---
# Claude 账号被封以后

Claude 账号昨天又被封了，这是第二个号。原因大概是梯子节点换了地区，Anthropic 的风控认为是异常登录。

记一下这次重新注册的流程：
- 海外手机号：接码平台的号不行，改用朋友的英国号收验证码。
- 付款：虚拟信用卡被拒，换成实体的海外信用卡才订上 Claude Pro。
- 节点：固定用一个地区，不再自动切换。

如果再被封，就不注册账号了，改走 API 中转站，按量付费。Anthropic 对中国用户的限制只会越来越严。
`

const THIRD_PARTY = `---
created: 2026-11-18 20:30
---
# 第三方

收房的时候要不要请第三方验房？同事说花两千块请第三方，空鼓、渗水、插座极性都会测，出了报告再跟开发商谈。第三方不站在开发商那边，这是最大的好处。
`

const UNTITLED = `---
created: 2026-11-17 08:12
---
体检报告出来了，血脂偏高。医生说第三方检测机构出的结果医院也认，下次复查可以就近抽血，空腹八小时。
`

const TRUMP = `---
source: https://example.com/news/synthetic-trump
---
# 特朗普返美后中国的反应

特朗普回到白宫后的第一周，就宣布对中国商品加征新一轮关税，理由仍然是贸易逆差和芯片。

中方的回应比上一次快：商务部当天表态会采取对等措施，随后公布了稀土出口管制的新名单。分析认为，稀土是这一轮谈判里中国手上最重的筹码。

市场的反应很直接，人民币汇率走低，一些出口企业开始把订单转到越南、墨西哥，通过第三方国家转口，避开关税。

特朗普在社交媒体上说，愿意和中国领导人见面谈一个「大协议」，但没有给出时间。双方的谈判代表据说已经在日内瓦接触过一次。
`

const TARIFF = `---
created: 2026-11-16 22:00
---
# 关税战时间线

整理一下特朗普和中国这几年的关税来回：

- 第一任期：对中国商品分几批加征关税，中方对等反制，最后签了第一阶段贸易协议。
- 回到白宫以后：又加征一轮关税，中国用稀土出口管制回应，人民币走低。
- 日内瓦谈判：双方代表见面，关税暂停九十天。

看下来，特朗普每次加关税都先放狠话再谈，中国的筹码从大豆换成了稀土。
`

const SPACED = `---
created: 2026-11-15 21:40
---
# 间隔重复

间隔重复就是在快要忘的时候再复习一次。艾宾浩斯的遗忘曲线说，学完一天后就忘掉一大半，但每复习一次，下一次忘掉的速度就慢一点，所以复习间隔可以越拉越长：1 天、3 天、一周、一个月。

Anki 把这个做成了算法：每张卡片按你答得好不好，自动排下一次复习的日期。
`

const MAKE_IT_STICK = `---
source: weread
---
# 《认知天性》书摘

> 检索练习比重复阅读有效：合上书，自己回想一遍，比再读三遍记得牢。

> 间隔重复：把复习分散开，留出一点遗忘再去回想，提取的时候更费力，记得反而更久。遗忘曲线并不是敌人。

> 交错练习：几种题型混在一起练，比一种题型连着练一百道更能分清什么时候用什么方法。

我的想法：Anki 卡片其实就是把检索练习和间隔重复合在一起，复习间隔由算法排。
`

const AURORA_INBOX = `---
created: 2026-11-14 21:20
---
极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。维克附近光污染少。
`

const AURORA_MINE = `# 极光预报

每天下午看冰岛气象局的云量图，云量低于三成、KP 指数到 3 以上就开车去黑沙滩等。
`

const SOURDOUGH = `# Sourdough starter

Day one: mix equal weights of whole wheat flour and water in a jar, cover loosely, and leave it somewhere warm.

The second day you may see a few bubbles. Throw away half of the starter and feed it again with flour and water. Most of the time nothing much happens on the third day, which is normal.

By the end of the first week the starter should double in size within six hours of a feed. That is when it is ready to bake a loaf. Keep it in the fridge between bakes and feed it once a week.
`

const TO_LIVE = `---
source: weread
---
# 《活着》读后

第一次读《活着》是在高中，那时候只觉得福贵一个人太惨了。现在再读，看到的是他怎么一次次接受失去：家珍、有庆、凤霞、二喜，最后只剩一头老牛。

我们总说要活得有意义，可书里的福贵只是活着，这本身就是一种力量。相关的还有《许三观卖血记》，以后接着读。
`

const GYM = `---
created: 2026-11-12 07:30
---
# 健身计划

第一次去健身房，教练给我们排了一个计划：一周三次，每次先练深蹲和卧推，再做二十分钟有氧。

时候到了就去，别找理由。相关的饮食：蛋白质每公斤体重一点五克。
`

const FEYNMAN_TECH = `---
created: 2026-11-11 19:00
---
# Feynman technique

Richard Feynman's way to check if you understand something: explain it in plain words to a beginner. Where you get stuck or reach for jargon, go back to the source and fill the gap, then simplify again.

Feynman taught physics at Caltech, and his lectures are still the model for explaining hard ideas simply.
`

const FEYNMAN_BOOK = `---
source: weread
---
# Surely You're Joking, Mr. Feynman! notes

Feynman tells how he fixed radios as a boy, cracked safes at Los Alamos, and played drums in Brazil. Under the jokes is one habit: he refused to accept an explanation he could not rebuild himself in plain words.

At Caltech he prepared the freshman physics lectures from scratch, because explaining an idea simply was his test of whether he really understood it.
`

const PARIS_A = `---
source: https://example.com/paris
---
# 巴黎深度漫游指南（上）

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
晚上去圣日耳曼的小酒馆吃饭。
`

const PARIS_B = `# 巴黎自由行全景指南

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
第二天去卢浮宫，留一整天。
`

export const P = {
  claudeVideo: '剪藏/视频/中国用户怎么用上 Claude.md',
  iceland: '剪藏/Geography of Iceland.md',
  physicalGeo: '剪藏/Physical geography.md',
  ttravel: '剪藏/ttravel.md',
  claudeBan: '收件箱/Claude 账号被封以后.md',
  thirdParty: '收件箱/第三方.md',
  untitled: '收件箱/未命名.md',
  trump: '剪藏/新闻/特朗普返美后中国的反应.md',
  tariff: '收件箱/关税战时间线.md',
  spaced: '收件箱/间隔重复.md',
  makeItStick: '阅读/《认知天性》书摘.md',
  auroraInbox: '收件箱/极光.md',
  auroraMine: '极光预报.md',
  sourdough: '剪藏/Sourdough starter.md',
  toLive: '阅读/《活着》读后.md',
  gym: '收件箱/健身计划.md',
  feynmanTech: '收件箱/Feynman technique.md',
  feynmanBook: "阅读/Surely You're Joking notes.md",
  parisA: '剪藏/巴黎/巴黎深度漫游指南.md',
  parisB: '收件箱/巴黎自由行全景指南.md',
} as const

/** 整个样本库：路径 → 文字 */
export const VAULT: Record<string, string> = {
  [P.claudeVideo]: CLAUDE_VIDEO,
  [P.iceland]: ICELAND,
  [P.physicalGeo]: PHYSICAL_GEO,
  [P.ttravel]: TTRAVEL,
  [P.claudeBan]: CLAUDE_BAN,
  [P.thirdParty]: THIRD_PARTY,
  [P.untitled]: UNTITLED,
  [P.trump]: TRUMP,
  [P.tariff]: TARIFF,
  [P.spaced]: SPACED,
  [P.makeItStick]: MAKE_IT_STICK,
  [P.auroraInbox]: AURORA_INBOX,
  [P.auroraMine]: AURORA_MINE,
  [P.sourdough]: SOURDOUGH,
  [P.toLive]: TO_LIVE,
  [P.gym]: GYM,
  [P.feynmanTech]: FEYNMAN_TECH,
  [P.feynmanBook]: FEYNMAN_BOOK,
  [P.parisA]: PARIS_A,
  [P.parisB]: PARIS_B,
}

/** 梦游会在这几篇末尾补双链（作品不补） */
export const LOOSE = Object.keys(VAULT).filter((p) => /^(收件箱|剪藏|阅读)\//.test(p))

export const LINKS: Labeled[] = [
  { a: P.claudeVideo, b: P.iceland, yes: false, why: '用户报的那条：只共有「the second」（the second half of last year / the second-largest waterfall）' },
  { a: P.thirdParty, b: P.untitled, yes: false, why: '验房和体检，只共有「第三方」' },
  { a: P.trump, b: P.thirdParty, yes: false, why: '关税新闻和验房，只共有「第三方」' },
  { a: P.sourdough, b: P.iceland, yes: false, why: '烤面包和冰岛地理，只共有 the second / the first / most of the time 这类' },
  { a: P.sourdough, b: P.claudeVideo, yes: false, why: '烤面包和视频字幕，只共有 the second / the first / half' },
  { a: P.ttravel, b: P.iceland, yes: false, why: '打包清单和冰岛地理，只共有 the second' },
  { a: P.toLive, b: P.gym, yes: false, why: '读后感和健身计划，只共有「第一次」「我们」「一个」「相关」「时候」' },
  { a: P.claudeVideo, b: P.claudeBan, yes: true, why: '同一件事：中国用户怎么注册、付款、被封 Claude 账号' },
  { a: P.trump, b: P.tariff, yes: true, why: '同一个人、同一件事：特朗普对中国加关税、稀土反制' },
  { a: P.spaced, b: P.makeItStick, yes: true, why: '同一个概念：间隔重复、遗忘曲线' },
  { a: P.auroraInbox, b: P.auroraMine, yes: true, why: '同一件事：看极光要云量低、KP 指数高' },
  { a: P.feynmanTech, b: P.feynmanBook, yes: true, why: '同一个人：费曼，用大白话讲清楚' },
]

export const DUPS: Labeled[] = [
  { a: P.parisA, b: P.parisB, yes: true, why: '同一段行程剪了两次' },
  { a: P.physicalGeo, b: P.iceland, yes: true, why: '短的那篇是长的那篇里整段剪下来的' },
  { a: P.ttravel, b: P.iceland, yes: false, why: '短的英文清单，常见英文字片在长文里都找得到，但不是同一篇' },
  { a: P.claudeVideo, b: P.claudeBan, yes: false, why: '讲同一件事，但不是重复' },
  { a: P.spaced, b: P.makeItStick, yes: false, why: '讲同一个概念，但不是重复' },
  { a: P.sourdough, b: P.iceland, yes: false, why: '两篇英文，不相干' },
  { a: P.toLive, b: P.gym, yes: false, why: '两篇中文，不相干' },
]
