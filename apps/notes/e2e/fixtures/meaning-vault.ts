/**
 * 量「意思相近」门槛用的库：像用户真库的一小份，中英混着写的课程笔记、书摘（微信读书写法）、视频字幕笔记、
 * 网页剪藏、白板、工作周报、一份英文讲义 PDF，再加几十篇只写「随便写点。」的空笔记当噪声。
 * 再配两组查询：沾边的（换了说法、同义词、中英对照、错一两个字）和不沾边的（库里没有的话题、很短的泛词、人名地名）。
 * test/search-model.test.ts 拿它断言门槛；CN_MEASURE=1 跑同一个文件会把每个查询的分数打成表。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DOC as MING, PATH as MING_PATH } from './book-digest'
import { ICELAND, LODGING } from './board'
import { LECTURE, lecturePdf } from './pdf'

const NOTES: Record<string, string> = {
  '课程/线性代数/第3讲 笔记.md': '# 线性映射\n\n满足 T(u+v)=T(u)+T(v) 和 T(cv)=cT(v) 的映射叫线性映射，每个线性映射在一组基下都能写成一个矩阵。\n\n核是被送到零的向量，像是 T 能到达的全部。\n',
  '课程/线性代数/第4讲 特征值.md': '# 第4讲 特征值\n\n如果 Av = λv 而且 v 不是零向量，λ 叫特征值，v 叫对应的特征向量。\n\n求法：解 det(A − λI) = 0。对称矩阵的特征值都是实数，可以正交对角化。\n',
  '课程/概率论/贝叶斯公式.md': '# 贝叶斯公式\n\nP(A|B) = P(B|A)P(A) / P(B)。\n\n先验 P(A) 是看到证据之前的相信程度，看到 B 以后更新成后验 P(A|B)。例子：检测阳性时真患病的概率。\n',
  '课程/机器学习/梯度下降.md': '# Gradient descent 梯度下降\n\n沿着损失函数梯度的反方向走一小步，步长叫 learning rate（学习率）。学习率太大会震荡、发散，太小收敛很慢。\n\nSGD 每次只用一小批样本（mini-batch）估计梯度。\n',
  '课程/机器学习/Transformer 笔记.md': '# Transformer 笔记\n\nSelf-attention：每个词拿自己的 query 去和所有词的 key 算相似度，softmax 以后对 value 加权求和。\n\nMulti-head 把这件事并排做几遍。位置编码告诉模型词的顺序。\n',
  '课程/英语/雅思写作.md': '# 雅思写作 Task 2\n\n开头一段改写题目、表明立场；主体两段各一个论点加例子；结尾总结。\n\n常用连接词：however, moreover, on the other hand。\n',
  '读书/人类简史 书摘.md': '---\n类型: 书摘\n作者: 尤瓦尔·赫拉利\n---\n# 人类简史\n\n> 智人之所以能统治世界，是因为只有智人能编织出想象的故事，让成千上万的陌生人一起合作。\n\n> 农业革命是史上最大的骗局。\n\n我的想法：货币、国家、公司都是大家一起相信的故事。\n',
  '读书/Atomic Habits 摘录.md': '---\n类型: 书摘\n作者: James Clear\n---\n# Atomic Habits\n\n> You do not rise to the level of your goals. You fall to the level of your systems.\n\n> Every action you take is a vote for the type of person you wish to become.\n\n我的想法：把新习惯绑在已有的习惯后面（habit stacking），比靠意志力管用。\n',
  '读书/卡片笔记写作法.md': '# 卡片笔记写作法\n\n卢曼的 Zettelkasten：每张卡片只写一个想法，用自己的话写，卡片之间互相链接。\n\n闪念笔记、文献笔记、永久笔记三种。\n',
  '视频/3Blue1Brown 线性代数的本质 字幕.md': '---\n来源: https://www.bilibili.com/video/BV1ys411472E\n---\n# 线性代数的本质 第3集 字幕\n\n[00:12] 矩阵可以看成对空间的一种变换。\n[00:31] 看 i 帽和 j 帽落在哪里，这两个位置就是矩阵的两列。\n[01:05] 网格线保持平行且等距分布，原点保持不动。\n',
  '视频/手冲咖啡入门 字幕.md': '---\n来源: https://www.youtube.com/watch?v=pourover01\n---\n# How to make pour-over coffee\n\n[00:05] Start with 15 grams of medium-fine ground coffee.\n[00:20] Bloom with 30 grams of water and wait 30 seconds.\n[00:55] Pour slowly in circles until you reach 250 grams. Water at 92 degrees.\n',
  '视频/红烧肉做法 字幕.md': '---\n来源: https://www.bilibili.com/video/BV1hongshao\n---\n# 红烧肉 家常做法\n\n[00:10] 五花肉切块，冷水下锅焯水，撇掉浮沫。\n[00:45] 冰糖小火炒出糖色，下肉翻炒上色。\n[01:30] 加生抽老抽、八角桂皮，热水没过肉，小火炖一个小时，大火收汁。\n',
  '旅行/京都五日.md': '# 京都五日\n\n第一天清水寺、二年坂；第二天岚山竹林和天龙寺；第三天伏见稻荷千本鸟居，早上七点前去人少。\n\n交通：买 ICOCA 卡，公交一日券 700 日元。\n',
  '生活/周末.md': '周末去爬山，带上水和三明治，山顶看日落。\n',
  '生活/购物.md': '今天的购物清单：牛奶、鸡蛋、面包。\n',
  '生活/健身计划.md': '# 健身计划\n\n周一、三、五力量训练：深蹲、卧推、硬拉各 5 组；周二、四慢跑 5 公里。每周称一次体重。\n',
  '生活/猫咪疫苗.md': '# 猫咪疫苗\n\n团子三月打了猫三联第二针，明年三月加强。狂犬疫苗每年一次。驱虫：体内三个月一次、体外每月一次。\n',
  '工作/周报 W45.md': '# 周报 W45\n\n这周把登录页改完了，下周做支付。\n\n风险：支付接口的沙箱环境还没申请下来。\n',
  '工作/会议 产品评审.md': '# 产品评审会议记录\n\n结论：首页信息太多，砍掉推荐位；新用户引导从五步改成三步。\n\n待办：小王出新版原型，周四再评。\n',
  '项目/canvas-notes/v0.4.0 发版.md': '# v0.4.0 发版\n\n清单：跑全量测试、更新 CHANGELOG、打 tag、签名公证、上传 GitHub Release。\n',
  '项目/canvas-notes/Node.js.md': '# Node.js\n\n事件循环：同步代码先跑完，再依次处理微任务（Promise）和宏任务（setTimeout、IO）。\n',
  '项目/canvas-notes/Rust 所有权.md': '# Rust 所有权\n\n每个值只有一个所有者，所有者离开作用域值就被释放。借用分不可变借用和可变借用，同一时间只能有一个可变借用。\n',
  '项目/canvas-notes/Git 常用命令.md': '# Git 常用命令\n\n撤销上一次提交但保留改动：git reset --soft HEAD~1。查看某行是谁改的：git blame。\n',
  '剪藏/咖啡因与睡眠.md': '---\n来源: https://example.com/caffeine-sleep\n---\n# 咖啡因对睡眠的影响\n\n咖啡因的半衰期大约五到六个小时，下午三点以后喝咖啡会让入睡变慢、深睡变少。\n',
  '剪藏/The Bitter Lesson.md': '---\n来源: http://www.incompleteideas.net/IncIdeas/BitterLesson.html\n---\n# The Bitter Lesson\n\nThe biggest lesson from 70 years of AI research is that general methods that leverage computation are ultimately the most effective.\n',
  '投资/指数基金定投.md': '# 指数基金定投\n\n每月 15 号定投沪深 300 和标普 500 各一千，不择时。估值高的时候少投一点。\n',
  '日记/2026-11-20.md': '# 2026-11-20\n\n下午下雨，在咖啡馆把卡片笔记整理了一遍，晚上和小林视频。\n',
  '想法/随手记.md': '# 随手记\n\n正文。\n',
  'readme.md': '# readme\n\n说明。\n',
}

/** 英文讲义之外再来一份英文论文段落 PDF */
const SLEEP = lecturePdf([
  { title: 'Sleep and Memory', lines: ['During deep sleep the brain replays what was learned during the day.', 'Students who slept after studying recalled more words the next morning.'] },
  { title: 'Methods', lines: ['Forty volunteers learned word pairs in the evening.', 'Half of them stayed awake overnight.'] },
])

export function makeMeaningVault(root: string, noise = 40) {
  const put = (p: string, t: string | Buffer) => {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  for (const [p, t] of Object.entries(NOTES)) put(p, t)
  put(MING_PATH, MING)
  put('旅行/冰岛环岛.md', ICELAND)
  put('旅行/住宿.md', LODGING)
  put('课程/线性代数/Lecture 3.pdf', LECTURE)
  put('论文/Sleep and Memory.pdf', SLEEP)
  for (let i = 0; i < noise; i++) put(`收件箱/笔记${i}.md`, `# 笔记${i}\n\n` + '随便写点。\n'.repeat(30))
}

/** 沾边的：[查询, 最该出的那一篇]（两篇都算对的写「a|b」） */
export const RELATED: [string, string][] = [
  ['矩阵怎么变换', '课程/线性代数/第3讲 笔记.md|视频/3Blue1Brown 线性代数的本质 字幕.md'],
  ['linear transformation', '课程/线性代数/Lecture 3.pdf'],
  ['特征向量是什么', '课程/线性代数/第4讲 特征值.md'],
  ['特征直', '课程/线性代数/第4讲 特征值.md'],
  ['先验和后验概率', '课程/概率论/贝叶斯公式.md'],
  ['贝叶思', '课程/概率论/贝叶斯公式.md'],
  ['学习率太大', '课程/机器学习/梯度下降.md'],
  ['注意力机制', '课程/机器学习/Transformer 笔记.md'],
  ['how to write an essay', '课程/英语/雅思写作.md'],
  ['朱高煦造反', MING_PATH],
  ['怎么养成好习惯', '读书/Atomic Habits 摘录.md'],
  ['人为什么能合作', '读书/人类简史 书摘.md'],
  ['zettelkasten', '读书/卡片笔记写作法.md'],
  ['手冲咖啡', '视频/手冲咖啡入门 字幕.md'],
  ['五花肉怎么炖', '视频/红烧肉做法 字幕.md'],
  ['红绕肉', '视频/红烧肉做法 字幕.md'],
  ['看极光', '旅行/冰岛环岛.md'],
  ['日本旅游攻略', '旅行/京都五日.md'],
  ['周末去哪玩', '生活/周末.md'],
  ['减肥锻炼', '生活/健身计划.md'],
  ['宠物打针', '生活/猫咪疫苗.md'],
  ['支付功能进度', '工作/周报 W45.md'],
  ['新用户引导', '工作/会议 产品评审.md'],
  ['发版清单', '项目/canvas-notes/v0.4.0 发版.md'],
  ['javascript 事件循环', '项目/canvas-notes/Node.js.md'],
  ['borrow checker', '项目/canvas-notes/Rust 所有权.md'],
  ['撤销提交', '项目/canvas-notes/Git 常用命令.md'],
  ['睡前喝咖啡', '剪藏/咖啡因与睡眠.md'],
  ['sleep and learning', '论文/Sleep and Memory.pdf'],
  ['基金怎么投', '投资/指数基金定投.md'],
]

/**
 * 沾边、但本机小模型认不出来的（2026-11-21 量的，见 indexer MEANING）：最像的那篇比套话只高 0.03 上下，和不沾边的分不开；
 * 有的最像的还不是它（「看极光」最像 readme，「how to write an essay」最像线性代数讲义）。门槛收紧以后这几个意思相近一条不出，
 * 要找它们靠 ⌥↵ 让 Claude 找
 */
export const MISSED = ['特征直', '看极光', 'how to write an essay', 'borrow checker']

/** 不沾边的：库里根本没有的话题、很短的泛词、人名地名 */
export const UNRELATED = [
  '特斯拉股价',
  '老布什abc',
  '没有这个qq',
  '天气预报',
  '量子力学',
  '篮球比赛',
  '区块链',
  '世界杯',
  '高考志愿',
  '钢琴调音',
  '离婚协议',
  '好',
  '笔记',
  '今天',
  '嗯',
  'test',
  'hello',
  '张三',
  '李白',
  '巴黎',
  '马斯克',
  'Taylor Swift',
  '纽约',
]
